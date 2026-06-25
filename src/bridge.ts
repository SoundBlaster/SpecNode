import { WebSocket } from "ws";
import {
  createEnvelope,
  createNodeHello,
  parseEnvelope,
  type AgentAdapter,
  type AgentRunContext,
  type AuditSink,
  type BridgeRuntimeOptions,
  type Envelope,
  type RunEvent,
  type SessionStartPayload,
} from "./index.js";
import {
  CompositeAuditSink,
  NodeController,
  createApprovalRequest,
  type ApprovalResolver,
} from "./local-control.js";

export interface BridgeConfig {
  readonly serverUrl: string;
  readonly deviceToken: string;
  readonly runtime: BridgeRuntimeOptions;
  readonly approvals: ApprovalResolver;
  readonly log?: (message: string) => void;
}

// The bridge's outbound channel. Implemented by `Bridge` so a sink resolves the
// live socket at send time instead of capturing one a reconnect can close.
export interface OutboundChannel {
  deliver(message: Envelope<unknown>): void;
}

// A run-event sink that records by putting the event on the wire, keyed by the
// admitted session id so events route correctly regardless of adapter-supplied
// event data.
export class WireSink implements AuditSink {
  constructor(
    private readonly channel: OutboundChannel,
    private readonly sessionId: string,
  ) {}

  async record(event: RunEvent): Promise<void> {
    this.channel.deliver(createEnvelope("session.event", { sessionId: this.sessionId, event }));
  }
}

// The outcome of admitting a session: ask it to settle itself rather than
// branching on a flag at the call site.
interface Admission {
  settle(): Promise<void>;
}

class RejectedSession implements Admission {
  constructor(
    private readonly sink: AuditSink,
    private readonly sessionId: string,
    private readonly reason: string,
  ) {}

  async settle(): Promise<void> {
    await this.sink.record({ type: "session.rejected", sessionId: this.sessionId, reason: this.reason });
  }
}

class AdmittedSession implements Admission {
  constructor(
    private readonly adapter: AgentAdapter,
    private readonly payload: SessionStartPayload,
    private readonly context: AgentRunContext,
  ) {}

  async settle(): Promise<void> {
    await this.adapter.start(this.payload, this.context);
  }
}

// Reusable bridge runtime: the outbound connection and session admission. Demo
// and real adapters wire it through `BridgeConfig`.
export class Bridge implements OutboundChannel {
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

  // Send over the current connection, read at call time so an in-flight session
  // keeps reaching the control plane across a reconnect.
  deliver(message: Envelope<unknown>): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
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
        await this.start(message.payload as SessionStartPayload);
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

  private async start(payload: SessionStartPayload): Promise<void> {
    const sink = new CompositeAuditSink([this.config.runtime.audit, new WireSink(this, payload.sessionId)]);
    const admission = await this.admit(payload, sink);
    await admission.settle();
  }

  private async admit(payload: SessionStartPayload, sink: AuditSink): Promise<Admission> {
    const { sessionId } = payload;

    if (!this.controller.canAcceptSession()) {
      return new RejectedSession(sink, sessionId, "Node is revoked by the local user.");
    }

    const decision = await this.config.runtime.policy.evaluateSession(payload);

    if (!decision.allowed) {
      return new RejectedSession(sink, sessionId, decision.reason ?? "Local policy rejected the session.");
    }

    if (decision.approvalRequired && !(await this.preflightApproved(payload, sink, decision.reason))) {
      return new RejectedSession(sink, sessionId, "Local user rejected the preflight session approval.");
    }

    const adapter = this.config.runtime.agents.find((candidate) => candidate.descriptor.id === payload.agentId);

    if (!adapter) {
      return new RejectedSession(sink, sessionId, `Unknown agent: ${payload.agentId}`);
    }

    return new AdmittedSession(adapter, payload, this.contextFor(payload, sink));
  }

  private async preflightApproved(payload: SessionStartPayload, sink: AuditSink, reason?: string): Promise<boolean> {
    const approval = createApprovalRequest(payload.sessionId, {
      risk: "high",
      operation: { kind: "session.start", policy: payload.policy },
      reason: reason ?? "Local policy requires approval before starting this session.",
    });

    await sink.record({ type: "approval.required", ...approval });
    const approved = await this.config.approvals.resolve(approval);
    await sink.record({
      type: "approval.resolved",
      sessionId: payload.sessionId,
      approvalId: approval.approvalId,
      approved,
    });

    return approved;
  }

  private contextFor(payload: SessionStartPayload, sink: AuditSink): AgentRunContext {
    return {
      emit: (event) => sink.record(event),
      evaluateOperation: (operation) => this.config.runtime.policy.evaluateOperation(operation),
    };
  }
}
