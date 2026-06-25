import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  type AgentAdapter,
  type AgentRunContext,
  type AuditSink,
  type BridgeRuntimeOptions,
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
  createApprovalRequest,
  decideApprovalMode,
  tailAuditLog,
  type ApprovalResolver,
} from "../src/local-control.js";
import { Bridge } from "../src/bridge.js";

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

function fakeSha(input: string): string {
  const bytes = Buffer.from(input, "utf8");
  let hash = 0;

  for (const byte of bytes) {
    hash = (hash * 31 + byte) >>> 0;
  }

  return hash.toString(16).padStart(64, "0");
}

// Wire the reusable bridge runtime to the demo adapter, demo policy, and the local
// control surface, then open the outbound connection.
let bridge: Bridge;

const interactiveControl = new InteractiveControl({
  onRevoke: () => bridge.revoke(),
  onReconnect: () => bridge.reconnect(),
  onStatus: () => printStatus(),
  onAudit: () => void printAudit(),
  onQuit: () => shutdown(),
  onHelp: () => printHelp(),
});

const approvalResolver: ApprovalResolver =
  APPROVAL_MODE === "interactive" ? interactiveControl : new AutoApprovalResolver(APPROVAL_MODE === "auto-allow");

const runtime: BridgeRuntimeOptions = {
  nodeId: NODE_ID,
  agents: [new DemoAgentAdapter()],
  workspaces,
  policy: new LocalPolicyEngine(workspaces),
  audit: new CompositeAuditSink([new ConsoleAuditSink(), new FileAuditSink(AUDIT_FILE)]),
};

bridge = new Bridge({
  serverUrl: SERVER_URL,
  deviceToken: DEV_BRIDGE_TOKEN,
  runtime,
  approvals: approvalResolver,
  log: (message) => console.log(message),
});

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
  console.log(
    [
      "Bridge status:",
      `  connection:   ${bridge.isConnected() ? "online" : "offline"}${bridge.isRevoked() ? " (revoked)" : ""}`,
      `  server:       ${SERVER_URL}`,
      `  nodeId:       ${NODE_ID}`,
      `  agents:       ${runtime.agents.map((agent) => agent.descriptor.id).join(", ")}`,
      `  workspaces:   ${runtime.workspaces.map((workspace) => `${workspace.name} (${workspace.id})`).join(", ")}`,
      "  policy:       network=deny, shell=ask(local approval), workspace-write=ask(local approval)",
      `  approval:     ${APPROVAL_MODE}`,
      `  pendingApprovals: ${interactiveControl.pendingApprovalCount()}`,
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
  bridge.revoke();
  process.exit(0);
}

// Read local commands and approval answers from stdin. A human at the terminal
// gets full control; a headless run simply never receives lines.
const localInput = createInterface({ input: process.stdin, terminal: false });
localInput.on("line", (line) => interactiveControl.handleLine(line));

printHelp();
bridge.connect();
