import { randomUUID } from "node:crypto";
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

const SERVER_URL = process.env.SPECNODE_SERVER_URL ?? "ws://localhost:8787/bridge/connect";
const DEV_BRIDGE_TOKEN = process.env.SPECNODE_DEV_TOKEN ?? "dev";
const NODE_ID = process.env.SPECNODE_NODE_ID ?? `node_${randomUUID()}`;
const WORKSPACE_ID = process.env.SPECNODE_WORKSPACE_ID ?? "current";
const WORKSPACE_NAME = process.env.SPECNODE_WORKSPACE_NAME ?? process.cwd().split(/[\\/]/).at(-1) ?? "current";

const workspaces: readonly WorkspaceDescriptor[] = [
  {
    id: WORKSPACE_ID,
    name: WORKSPACE_NAME,
  },
];

const demoAgent = new DemoAgentAdapter();
const runtime: BridgeRuntimeOptions = {
  nodeId: NODE_ID,
  agents: [demoAgent],
  workspaces,
  policy: new LocalPolicyEngine(workspaces),
  audit: new ConsoleAuditSink(),
};

connect();

function connect(): void {
  const socket = new WebSocket(SERVER_URL, {
    headers: {
      Authorization: `Bearer ${DEV_BRIDGE_TOKEN}`,
    },
  });

  socket.on("open", () => {
    console.log(`Connected to ${SERVER_URL}`);
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
    console.log("Disconnected from control plane. Reconnecting in 1s...");
    setTimeout(connect, 1000);
  });

  socket.on("error", (error) => {
    console.error(`Bridge socket error: ${error.message}`);
  });
}

async function handleSessionStart(socket: WebSocket, payload: SessionStartPayload): Promise<void> {
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
    const approved = await requestLocalApproval(approval);
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

      const approved = await requestLocalApproval(approval);
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

async function requestLocalApproval(request: ApprovalRequest): Promise<boolean> {
  console.log(
    `[approval][${request.sessionId}] ${request.reason} ` +
      `operation=${JSON.stringify(request.operation)} risk=${request.risk}`,
  );

  // MVP demo policy: print the local approval request, deny it, and continue with
  // no side effects. A real bridge should show a local OS/UI prompt here.
  return false;
}

function fakeSha(input: string): string {
  const bytes = Buffer.from(input, "utf8");
  let hash = 0;

  for (const byte of bytes) {
    hash = (hash * 31 + byte) >>> 0;
  }

  return hash.toString(16).padStart(64, "0");
}
