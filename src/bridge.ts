import { WebSocket } from "ws";
import {
  createEnvelope,
  createNodeHello,
  parseEnvelope,
  type AgentRunContext,
  type BridgeRuntimeOptions,
  type RunEvent,
  type SessionStartPayload,
} from "./index.js";
import { NodeController, createApprovalRequest, type ApprovalResolver } from "./local-control.js";

export interface BridgeConfig {
  readonly serverUrl: string;
  readonly deviceToken: string;
  readonly runtime: BridgeRuntimeOptions;
  readonly approvals: ApprovalResolver;
  readonly log?: (message: string) => void;
}

// Reusable bridge runtime: the outbound connection, session orchestration, and
// audited event emission. Demo and real adapters wire it through `BridgeConfig`.
export class Bridge {
  private socket?: WebSocket;
  private readonly controller: NodeController;
  private readonly log: (message: string) => void;

  constructor(private readonly config: BridgeConfig) {
    this.log = config.log ?? (() => {});
    this.controller = new NodeController(
      { open: () => this.connect(), close: () => this.socket?.close() },
      this.log,
    );
  }

  isRevoked(): boolean {
    return this.controller.isRevoked();
  }

  isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  revoke(): void {
    this.controller.revoke();
  }

  reconnect(): void {
    if (this.isConnected()) {
      this.log("Already connected.");
      return;
    }
    this.controller.reconnect();
  }

  connect(): void {
    if (this.controller.isRevoked()) {
      this.log("Node is revoked; not connecting. Type 'reconnect' to resume.");
      return;
    }

    const socket = new WebSocket(this.config.serverUrl, {
      headers: { Authorization: `Bearer ${this.config.deviceToken}` },
    });
    this.socket = socket;

    socket.on("open", () => {
      this.log(`Connected to ${this.config.serverUrl}`);
      socket.send(JSON.stringify(createEnvelope("node.hello", createNodeHello(this.config.runtime))));
    });

    socket.on("message", (data) => void this.dispatch(data.toString()));

    socket.on("close", () => {
      if (this.socket === socket) {
        this.socket = undefined;
      }

      if (!this.controller.shouldReconnect()) {
        this.log("Disconnected (revoked). Not reconnecting until you type 'reconnect'.");
        return;
      }

      this.log("Disconnected from control plane. Reconnecting in 1s...");
      setTimeout(() => this.connect(), 1000);
    });

    socket.on("error", (error) => {
      this.log(`Bridge socket error: ${error.message}`);
    });
  }

  private async dispatch(raw: string): Promise<void> {
    try {
      const message = parseEnvelope(raw);

      if (message.type === "node.accepted") {
        this.log("Control plane accepted node handshake.");
        return;
      }

      if (message.type === "session.start") {
        await this.handleSessionStart(message.payload as SessionStartPayload);
        return;
      }

      if (message.type === "session.cancel") {
        const payload = message.payload as { sessionId: string };
        for (const agent of this.config.runtime.agents) {
          await agent.cancel(payload.sessionId);
        }
        return;
      }

      this.log(`Ignoring unsupported message type: ${message.type}`);
    } catch (error) {
      this.log(error instanceof Error ? error.message : String(error));
    }
  }

  private async reject(sessionId: string, reason: string): Promise<void> {
    await this.auditAndEmit(sessionId, { type: "session.rejected", sessionId, reason });
  }

  private async handleSessionStart(payload: SessionStartPayload): Promise<void> {
    if (!this.controller.canAcceptSession()) {
      return this.reject(payload.sessionId, "Node is revoked by the local user.");
    }

    const sessionDecision = await this.config.runtime.policy.evaluateSession(payload);

    if (!sessionDecision.allowed) {
      return this.reject(payload.sessionId, sessionDecision.reason ?? "Local policy rejected the session.");
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

      await this.auditAndEmit(payload.sessionId, { type: "approval.required", ...approval });
      const approved = await this.config.approvals.resolve(approval);
      await this.auditAndEmit(payload.sessionId, {
        type: "approval.resolved",
        sessionId: payload.sessionId,
        approvalId: approval.approvalId,
        approved,
      });

      if (!approved) {
        return this.reject(payload.sessionId, "Local user rejected the preflight session approval.");
      }
    }

    const adapter = this.config.runtime.agents.find((candidate) => candidate.descriptor.id === payload.agentId);

    if (!adapter) {
      return this.reject(payload.sessionId, `Unknown agent: ${payload.agentId}`);
    }

    const context: AgentRunContext = {
      emit: async (event) => this.auditAndEmit(payload.sessionId, event),
      evaluateOperation: async (operation) => this.config.runtime.policy.evaluateOperation(operation),
    };

    await adapter.start(payload, context);
  }

  private async emit(sessionId: string, event: RunEvent): Promise<void> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    this.socket.send(JSON.stringify(createEnvelope("session.event", { sessionId, event })));
  }

  // Record every run event to the local audit log before sending it, so preflight
  // approvals (emitted here, not via the adapter's context.emit) stay durable.
  private async auditAndEmit(sessionId: string, event: RunEvent): Promise<void> {
    await this.config.runtime.audit.record(event);
    await this.emit(sessionId, event);
  }
}
