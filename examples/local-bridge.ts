import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocket } from "ws";
import {
  createNodeHello,
  type AgentAdapter,
  type AgentRunContext,
  type ApprovalRequest,
  type AuditSink,
  type BridgeRuntimeOptions,
  type Envelope,
  type PolicyDecision,
  type PolicyEngine,
  type RunEvent,
  type SessionStartPayload,
  type WorkspaceDescriptor,
} from "../src/index.js";
import {
  AutoApprovalResolver,
  CompositeAuditSink,
  FileAuditSink,
  InteractiveControl,
  NodeController,
  decideApprovalMode,
  tailAuditLog,
  type ApprovalResolver,
} from "../src/local-control.js";

const SERVER_URL = process.env.SPECNODE_SERVER_URL ?? "ws://localhost:8787/bridge/connect";
const DEV_BRIDGE_TOKEN = process.env.SPECNODE_DEV_TOKEN ?? "dev";
const NODE_ID = process.env.SPECNODE_NODE_ID ?? `node_${randomUUID()}`;
const WORKSPACE_ID = process.env.SPECNODE_WORKSPACE_ID ?? "current";
const WORKSPACE_NAME = process.env.SPECNODE_WORKSPACE_NAME ?? process.cwd().split(/[\\/]/).at(-1) ?? "current";
const AUDIT_FILE = process.env.SPECNODE_AUDIT_FILE ?? join(process.cwd(), ".specnode", "audit.jsonl");
const APPROVAL_MODE = decideApprovalMode(process.env.SPECNODE_APPROVAL, Boolean(process.stdin.isTTY));

const workspaces: readonly WorkspaceDescriptor[] = [
  {
    id: WORKSPACE_ID,
    name: WORKSPACE_NAME,
  },
];

// `demoAgent`, `runtime`, the local control surface, and the initial `connect()`
// call live at the bottom of this file. Class declarations are not hoisted, so
// they must be evaluated before the adapters and policy engine below are
// instantiated.
let demoAgent: DemoAgentAdapter;
let runtime: BridgeRuntimeOptions;
let controller: NodeController;
let approvalResolver: ApprovalResolver;
let activeSocket: WebSocket | undefined;

function connect(): void {
  if (controller.isRevoked()) {
    console.log("Node is revoked; not connecting. Type 'reconnect' to resume.");
    return;
  }

  const socket = new WebSocket(SERVER_URL, {
    headers: {
      Authorization: `Bearer ${DEV_BRIDGE_TOKEN}`,
    },
  });
  activeSocket = socket;

  socket.on("open", () => {
    console.log(`Connected to ${SERVER_URL} (approval mode: ${APPROVAL_MODE})`);
    send(socket, "node.hello", createNodeHello(runtime));
  });

  socket.on("message", async (data) => {
    try {
      const message = parseEnvelope(data.toString());

      if (message.type === "node.accepted") {
        console.log("Control plane accepted node handshake.");
        return;
      }

      if (message.type === "session.start") {
        await handleSessionStart(socket, message.payload as SessionStartPayload);
        return;
      }

      if (message.type === "session.cancel") {
        const payload = message.payload as { sessionId: string };
        await demoAgent.cancel(payload.sessionId);
        return;
      }

      console.warn(`Ignoring unsupported message type: ${message.type}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
    }
  });

  socket.on("close", () => {
    if (activeSocket === socket) {
      activeSocket = undefined;
    }

    if (!controller.shouldReconnect()) {
      console.log("Disconnected (revoked). Not reconnecting until you type 'reconnect'.");
      return;
    }

    console.log("Disconnected from control plane. Reconnecting in 1s...");
    setTimeout(connect, 1000);
  });

  socket.on("error", (error) => {
    console.error(`Bridge socket error: ${error.message}`);
  });
}

async function handleSessionStart(socket: WebSocket, payload: SessionStartPayload): Promise<void> {
  if (!controller.canAcceptSession()) {
    await emit(socket, payload.sessionId, {
      type: "session.rejected",
      sessionId: payload.sessionId,
      reason: "Node is revoked by the local user.",
    });
    return;
  }

  const sessionDecision = await runtime.policy.evaluateSession(payload);

  if (!sessionDecision.allowed) {
    await emit(socket, payload.sessionId, {
      type: "session.rejected",
      sessionId: payload.sessionId,
      reason: sessionDecision.reason ?? "Local policy rejected the session.",
    });
    return;
  }

  if (sessionDecision.approvalRequired) {
    const approval = createApprovalRequest(payload.sessionId, {
      risk: "high",
      operation: {
        kind: "session.start",
        policy: payload.policy,
      },
      reason: sessionDecision.reason ?? "Local policy requires approval before starting this session.",
    });

    await emit(socket, payload.sessionId, { type: "approval.required", ...approval });
    const approved = await approvalResolver.resolve(approval);
    await emit(socket, payload.sessionId, {
      type: "approval.resolved",
      sessionId: payload.sessionId,
      approvalId: approval.approvalId,
      approved,
    });

    if (!approved) {
      await emit(socket, payload.sessionId, {
        type: "session.rejected",
        sessionId: payload.sessionId,
        reason: "Local user rejected the preflight session approval.",
      });
      return;
    }
  }

  const adapter = runtime.agents.find((candidate) => candidate.descriptor.id === payload.agentId);

  if (!adapter) {
    await emit(socket, payload.sessionId, {
      type: "session.rejected",
      sessionId: payload.sessionId,
      reason: `Unknown agent: ${payload.agentId}`,
    });
    return;
  }

  const context: AgentRunContext = {
    emit: async (event) => {
      await runtime.audit.record(event);
      await emit(socket, payload.sessionId, event);
    },
    evaluateOperation: async (operation) => runtime.policy.evaluateOperation(operation),
  };

  await adapter.start(payload, context);
}

async function emit(socket: WebSocket, sessionId: string, event: RunEvent): Promise<void> {
  if (socket.readyState !== WebSocket.OPEN) {
    return;
  }

  const message = envelope("session.event", { sessionId, event });
  socket.send(JSON.stringify(message));
}

function send<TPayload>(socket: WebSocket, type: string, payload: TPayload): void {
  socket.send(JSON.stringify(envelope(type, payload)));
}

function envelope<TPayload>(type: string, payload: TPayload): Envelope<TPayload> {
  return {
    id: randomUUID(),
    type,
    timestamp: new Date().toISOString(),
    payload,
  };
}

function parseEnvelope(raw: string): Envelope<unknown> {
  const value = JSON.parse(raw) as Partial<Envelope<unknown>>;

  if (!value.id || !value.type || !value.timestamp || value.payload === undefined) {
    throw new Error("Invalid envelope from control plane");
  }

  return value as Envelope<unknown>;
}

class DemoAgentAdapter implements AgentAdapter {
  readonly descriptor = {
    id: "demo-agent",
    kind: "coding-agent" as const,
    transport: "adapter" as const,
    displayName: "Demo local BYOA agent",
  };

  private readonly cancelledSessions = new Set<string>();

  async start(payload: SessionStartPayload, context: AgentRunContext): Promise<void> {
    this.cancelledSessions.delete(payload.sessionId);

    await context.emit({ type: "session.started", sessionId: payload.sessionId });
    await delay(250);

    if (this.cancelledSessions.has(payload.sessionId)) {
      await context.emit({ type: "session.cancelled", sessionId: payload.sessionId, reason: "cancelled_before_start" });
      return;
    }

    await context.emit({
      type: "text.delta",
      sessionId: payload.sessionId,
      text: `Accepted ${payload.task.kind} for workspace ${payload.workspaceId}. Goal: ${payload.task.goal}`,
    });

    await delay(250);

    const shellOperation = {
      kind: "shell.run",
      command: "npm test",
    };
    const shellDecision = await context.evaluateOperation(shellOperation);

    if (shellDecision.approvalRequired || !shellDecision.allowed) {
      const approval = createApprovalRequest(payload.sessionId, {
        risk: "medium",
        operation: shellOperation,
        reason: shellDecision.reason ?? "The selected agent wants to run tests.",
      });

      await context.emit({ type: "approval.required", ...approval });
      await delay(250);

      const approved = await approvalResolver.resolve(approval);
      await context.emit({
        type: "approval.resolved",
        sessionId: payload.sessionId,
        approvalId: approval.approvalId,
        approved,
      });

      if (!approved) {
        await context.emit({
          type: "text.delta",
          sessionId: payload.sessionId,
          text: "Demo bridge denied shell execution through PolicyEngine and continued with a no-side-effects plan.",
        });
      }
    }

    await delay(250);

    await context.emit({
      type: "artifact.produced",
      sessionId: payload.sessionId,
      name: "demo-plan.json",
      sha256: fakeSha(payload.sessionId),
    });

    await context.emit({
      type: "text.delta",
      sessionId: payload.sessionId,
      text: "Next implementation step: replace DemoAgentAdapter with a Codex CLI, Claude Code, ACP, or custom-command adapter.",
    });

    await context.emit({ type: "session.completed", sessionId: payload.sessionId });
  }

  async cancel(sessionId: string): Promise<void> {
    this.cancelledSessions.add(sessionId);
  }
}

class LocalPolicyEngine implements PolicyEngine {
  constructor(private readonly allowedWorkspaces: readonly WorkspaceDescriptor[]) {}

  async evaluateSession(payload: SessionStartPayload): Promise<PolicyDecision> {
    const workspaceAllowed = this.allowedWorkspaces.some((workspace) => workspace.id === payload.workspaceId);

    if (!workspaceAllowed) {
      return { allowed: false, reason: `Unknown workspace: ${payload.workspaceId}` };
    }

    if (payload.policy.network === "allow") {
      return { allowed: false, reason: "Network access is denied by local MVP policy." };
    }

    if (payload.policy.filesystem === "workspace-write") {
      return {
        allowed: true,
        approvalRequired: true,
        reason: "Workspace writes require local approval.",
      };
    }

    return { allowed: true };
  }

  async evaluateOperation(operation: Readonly<Record<string, unknown>>): Promise<PolicyDecision> {
    if (operation.kind === "shell.run") {
      return { allowed: false, approvalRequired: true, reason: "Shell execution requires local approval." };
    }

    return { allowed: true };
  }
}

class ConsoleAuditSink implements AuditSink {
  async record(event: RunEvent): Promise<void> {
    console.log(`[audit][${event.sessionId}] ${event.type}`, JSON.stringify(event));
  }
}

function createApprovalRequest(
  sessionId: string,
  input: Omit<ApprovalRequest, "sessionId" | "approvalId">,
): ApprovalRequest {
  return {
    sessionId,
    approvalId: randomUUID(),
    ...input,
  };
}

function fakeSha(input: string): string {
  const bytes = Buffer.from(input, "utf8");
  let hash = 0;

  for (const byte of bytes) {
    hash = (hash * 31 + byte) >>> 0;
  }

  return hash.toString(16).padStart(64, "0");
}

// Instantiate adapters and the policy engine now that their classes are declared,
// then wire the local control surface and open the outbound connection.
demoAgent = new DemoAgentAdapter();
runtime = {
  nodeId: NODE_ID,
  agents: [demoAgent],
  workspaces,
  policy: new LocalPolicyEngine(workspaces),
  audit: new CompositeAuditSink([new ConsoleAuditSink(), new FileAuditSink(AUDIT_FILE)]),
};

// The local owner ("Role B") controls execution from here: revoke cuts the cloud
// off, and an interactive resolver puts every risky operation behind a local
// decision instead of a hardcoded auto-deny.
controller = new NodeController(
  {
    open: () => connect(),
    close: () => activeSocket?.close(),
  },
  (message) => console.log(message),
);

const interactiveControl = new InteractiveControl({
  onRevoke: () => controller.revoke(),
  onReconnect: () => {
    if (activeSocket && activeSocket.readyState === WebSocket.OPEN) {
      console.log("Already connected.");
      return;
    }
    controller.reconnect();
  },
  onStatus: () => printStatus(),
  onAudit: () => void printAudit(),
  onQuit: () => shutdown(),
  onHelp: () => printHelp(),
});

approvalResolver =
  APPROVAL_MODE === "interactive"
    ? interactiveControl
    : new AutoApprovalResolver(APPROVAL_MODE === "auto-allow");

function printHelp(): void {
  console.log(
    [
      "Local bridge controls:",
      "  status (s)     show connection, node identity, policy, and pending approval",
      "  audit (a)      show the tail of the local activity log",
      "  revoke (r)     cut the cloud off: drop the session and refuse new sessions",
      "  reconnect (c)  clear a revoke and reconnect",
      "  quit (q)       disconnect and exit",
      "  help (h)       show this help",
      APPROVAL_MODE === "interactive"
        ? "  on an approval prompt: 'y' allows, anything else denies"
        : `  approval mode is '${APPROVAL_MODE}' (non-interactive)`,
    ].join("\n"),
  );
}

function printStatus(): void {
  const connected = Boolean(activeSocket && activeSocket.readyState === WebSocket.OPEN);
  console.log(
    [
      "Bridge status:",
      `  connection:   ${connected ? "online" : "offline"}${controller.isRevoked() ? " (revoked)" : ""}`,
      `  server:       ${SERVER_URL}`,
      `  nodeId:       ${NODE_ID}`,
      `  agents:       ${runtime.agents.map((agent) => agent.descriptor.id).join(", ")}`,
      `  workspaces:   ${runtime.workspaces.map((workspace) => `${workspace.name} (${workspace.id})`).join(", ")}`,
      "  policy:       network=deny, shell=ask(local approval), workspace-write=ask(local approval)",
      `  approval:     ${APPROVAL_MODE}`,
      `  pendingApproval: ${interactiveControl.hasPendingApproval() ? "yes" : "no"}`,
      `  auditLog:     ${AUDIT_FILE}`,
    ].join("\n"),
  );
}

async function printAudit(): Promise<void> {
  const lines = await tailAuditLog(AUDIT_FILE, 10);

  if (lines.length === 0) {
    console.log(`No audit entries yet at ${AUDIT_FILE}`);
    return;
  }

  console.log(`Last ${lines.length} audit entries (${AUDIT_FILE}):`);
  for (const line of lines) {
    console.log(`  ${line}`);
  }
}

function shutdown(): void {
  console.log("Shutting down local bridge.");
  controller.revoke();
  activeSocket?.close();
  process.exit(0);
}

// Read local commands and approval answers from stdin. A human at the terminal
// gets full control; a headless run simply never receives lines.
const localInput = createInterface({ input: process.stdin, terminal: false });
localInput.on("line", (line) => interactiveControl.handleLine(line));

printHelp();
connect();
