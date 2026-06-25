import { randomUUID } from "node:crypto";

export type RiskLevel = "low" | "medium" | "high";

export type FilesystemPolicy = "none" | "workspace-read" | "workspace-write";
export type ShellPolicy = "deny" | "ask" | "allow";
export type NetworkPolicy = "deny" | "ask" | "allow";

export interface BridgePolicy {
  readonly filesystem: FilesystemPolicy;
  readonly shell: ShellPolicy;
  readonly network: NetworkPolicy;
}

export interface AgentDescriptor {
  readonly id: string;
  readonly kind: "coding-agent" | "custom-agent" | "unknown";
  readonly transport: "adapter" | "stdio" | "http" | "websocket";
  readonly displayName?: string;
}

export interface WorkspaceDescriptor {
  readonly id: string;
  readonly name: string;
}

export interface NodeHelloPayload {
  readonly nodeId: string;
  readonly protocolVersion: "0.1";
  readonly capabilities: readonly string[];
  readonly agents: readonly AgentDescriptor[];
  readonly workspaces: readonly WorkspaceDescriptor[];
}

export interface NodeAcceptedPayload {
  readonly nodeId: string;
  readonly serverTime: string;
}

export interface SessionTask {
  readonly kind: string;
  readonly goal: string;
  readonly inputs?: Readonly<Record<string, unknown>>;
}

export interface SessionStartPayload {
  readonly sessionId: string;
  readonly agentId: string;
  readonly workspaceId: string;
  readonly task: SessionTask;
  readonly policy: BridgePolicy;
}

export interface ApprovalRequest {
  readonly sessionId: string;
  readonly approvalId: string;
  readonly risk: RiskLevel;
  readonly operation: Readonly<Record<string, unknown>>;
  readonly reason: string;
}

export type RunEvent =
  | { readonly type: "session.started"; readonly sessionId: string }
  | { readonly type: "session.rejected"; readonly sessionId: string; readonly reason: string }
  | { readonly type: "text.delta"; readonly sessionId: string; readonly text: string }
  | ({ readonly type: "approval.required" } & ApprovalRequest)
  | { readonly type: "approval.resolved"; readonly sessionId: string; readonly approvalId: string; readonly approved: boolean }
  | { readonly type: "artifact.produced"; readonly sessionId: string; readonly name: string; readonly sha256?: string }
  | { readonly type: "session.completed"; readonly sessionId: string }
  | { readonly type: "session.failed"; readonly sessionId: string; readonly error: string }
  | { readonly type: "session.cancelled"; readonly sessionId: string; readonly reason?: string };

export interface Envelope<TPayload> {
  readonly id: string;
  readonly type: string;
  readonly timestamp: string;
  readonly payload: TPayload;
}

export type BridgeMessage =
  | Envelope<NodeHelloPayload>
  | Envelope<NodeAcceptedPayload>
  | Envelope<SessionStartPayload>
  | Envelope<{ readonly sessionId: string; readonly reason?: string }>
  | Envelope<{ readonly sessionId: string; readonly event: RunEvent }>;

export interface PolicyDecision {
  readonly allowed: boolean;
  readonly reason?: string;
  readonly approvalRequired?: boolean;
}

export interface PolicyEngine {
  evaluateSession(payload: SessionStartPayload): Promise<PolicyDecision>;
  evaluateOperation(operation: Readonly<Record<string, unknown>>): Promise<PolicyDecision>;
}

export interface AgentRunContext {
  emit(event: RunEvent): Promise<void>;
  evaluateOperation(operation: Readonly<Record<string, unknown>>): Promise<PolicyDecision>;
}

export interface AgentAdapter {
  readonly descriptor: AgentDescriptor;
  start(payload: SessionStartPayload, context: AgentRunContext): Promise<void>;
  cancel(sessionId: string): Promise<void>;
}

export interface AuditSink {
  record(event: RunEvent): Promise<void>;
}

export interface BridgeRuntimeOptions {
  readonly nodeId: string;
  readonly agents: readonly AgentAdapter[];
  readonly workspaces: readonly WorkspaceDescriptor[];
  readonly policy: PolicyEngine;
  readonly audit: AuditSink;
}

export function createNodeHello(options: BridgeRuntimeOptions): NodeHelloPayload {
  return {
    nodeId: options.nodeId,
    protocolVersion: "0.1",
    capabilities: [
      "sessions.start",
      "sessions.cancel",
      "agents.list",
      "workspaces.list",
      "events.stream",
    ],
    agents: options.agents.map((adapter) => adapter.descriptor),
    workspaces: options.workspaces,
  };
}

/** Wrap a typed payload in a transport envelope. */
export function createEnvelope<TPayload>(type: string, payload: TPayload): Envelope<TPayload> {
  return {
    id: randomUUID(),
    type,
    timestamp: new Date().toISOString(),
    payload,
  };
}

/** Parse and validate a transport envelope from its JSON wire form. */
export function parseEnvelope(raw: string): Envelope<unknown> {
  const value = JSON.parse(raw) as Partial<Envelope<unknown>>;

  if (!value.id || !value.type || !value.timestamp || value.payload === undefined) {
    throw new Error("Invalid envelope");
  }

  return value as Envelope<unknown>;
}
