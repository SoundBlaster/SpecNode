import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ApprovalRequest, AuditSink, RunEvent } from "./index.js";

// Local control surface for the SpecNode bridge ("Role B" — the owner of the
// device the bridge runs on).
//
// Trust boundary: the cloud control plane may *request* work, but execution
// authority lives on the device. This module gives the local user the controls
// the security model requires but the headless bridge lacked:
//
//   - interactive per-operation approval (instead of a hardcoded auto-deny);
//   - node revoke/reconnect (refuse new sessions and drop the outbound session);
//   - a persistent, user-visible local activity log.
//
// Failure mode addressed: a compromised or buggy control plane that streams
// risky operations (shell, workspace writes) to a node whose owner had no way to
// inspect, deny, or cut off the session locally.

export type ApprovalMode = "interactive" | "auto-allow" | "auto-deny";

/** Resolves an approval request to a local allow/deny decision. */
export interface ApprovalResolver {
  resolve(request: ApprovalRequest): Promise<boolean>;
}

/**
 * Choose the approval mode. An explicit `SPECNODE_APPROVAL` value always wins;
 * otherwise default to interactive when a human is attached to stdin and to the
 * safe `auto-deny` posture when running headless (CI, daemon, preview).
 */
export function decideApprovalMode(value: string | undefined, interactiveStdin: boolean): ApprovalMode {
  if (value === "interactive" || value === "auto-allow" || value === "auto-deny") {
    return value;
  }

  return interactiveStdin ? "interactive" : "auto-deny";
}

/** Non-interactive resolver for headless runs. */
export class AutoApprovalResolver implements ApprovalResolver {
  constructor(
    private readonly approved: boolean,
    private readonly out: (message: string) => void = console.log,
  ) {}

  async resolve(request: ApprovalRequest): Promise<boolean> {
    const label = this.approved ? "auto-allow" : "auto-deny";
    this.out(
      `[approval:${label}] ${request.reason} ` +
        `operation=${JSON.stringify(request.operation)} risk=${request.risk}`,
    );
    return this.approved;
  }
}

export interface ControlCommandHandlers {
  onRevoke(): void;
  onReconnect(): void;
  onStatus(): void;
  onAudit(): void;
  onQuit(): void;
  onHelp(): void;
}

/**
 * Interactive console surface: turns local stdin lines into either an answer to
 * a pending approval or a control command. It is also the `ApprovalResolver`
 * used in interactive mode, so a high-risk operation blocks until the local user
 * decides — approvals are never silently inherited from the browser.
 */
export class InteractiveControl implements ApprovalResolver {
  private pending?: (approved: boolean) => void;

  constructor(
    private readonly handlers: ControlCommandHandlers,
    private readonly out: (message: string) => void = console.log,
  ) {}

  hasPendingApproval(): boolean {
    return this.pending !== undefined;
  }

  resolve(request: ApprovalRequest): Promise<boolean> {
    this.out(`\n[approval needed] ${request.reason}`);
    this.out(`  operation=${JSON.stringify(request.operation)} risk=${request.risk}`);
    this.out("  type 'y' to allow, anything else to deny");

    return new Promise<boolean>((resolve) => {
      this.pending = resolve;
    });
  }

  /** Feed one line of local input. Answers a pending approval first, else runs a command. */
  handleLine(line: string): void {
    const trimmed = line.trim();

    if (this.pending) {
      const approved = /^y(es)?$/i.test(trimmed);
      const resolve = this.pending;
      this.pending = undefined;
      this.out(approved ? "  -> approved" : "  -> denied");
      resolve(approved);
      return;
    }

    switch (trimmed.toLowerCase()) {
      case "":
        return;
      case "r":
      case "revoke":
        this.handlers.onRevoke();
        return;
      case "c":
      case "reconnect":
        this.handlers.onReconnect();
        return;
      case "s":
      case "status":
        this.handlers.onStatus();
        return;
      case "a":
      case "audit":
        this.handlers.onAudit();
        return;
      case "q":
      case "quit":
      case "exit":
        this.handlers.onQuit();
        return;
      case "h":
      case "help":
      case "?":
        this.handlers.onHelp();
        return;
      default:
        this.out(`unknown command: ${trimmed} (type 'help')`);
    }
  }
}

/** Abstracts the outbound bridge connection so revoke/reconnect is testable. */
export interface ConnectionTransport {
  open(): void;
  close(): void;
}

/**
 * Holds the local revoke authority. While revoked the node refuses new sessions
 * and does not reconnect, so the device owner can cut the cloud off immediately.
 */
export class NodeController {
  private revoked = false;

  constructor(
    private readonly transport: ConnectionTransport,
    private readonly out: (message: string) => void = () => {},
  ) {}

  isRevoked(): boolean {
    return this.revoked;
  }

  /** Whether a session.start should be accepted right now. */
  canAcceptSession(): boolean {
    return !this.revoked;
  }

  /** Whether the bridge should reconnect after the socket closes. */
  shouldReconnect(): boolean {
    return !this.revoked;
  }

  revoke(): void {
    if (this.revoked) {
      this.out("node already revoked");
      return;
    }

    this.revoked = true;
    this.out("node revoked: closing connection and refusing new sessions until reconnect");
    this.transport.close();
  }

  reconnect(): void {
    if (!this.revoked) {
      this.out("node is already active");
      return;
    }

    this.revoked = false;
    this.out("revoke cleared: reconnecting node");
    this.transport.open();
  }
}

/** Appends each run event to a local JSONL activity log the user can inspect. */
export class FileAuditSink implements AuditSink {
  constructor(private readonly filePath: string) {}

  async record(event: RunEvent): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const line = `${JSON.stringify({ at: new Date().toISOString(), event })}\n`;
    await appendFile(this.filePath, line, "utf8");
  }
}

/** Fans a run event out to several sinks (e.g. console + file). */
export class CompositeAuditSink implements AuditSink {
  constructor(private readonly sinks: readonly AuditSink[]) {}

  async record(event: RunEvent): Promise<void> {
    for (const sink of this.sinks) {
      await sink.record(event);
    }
  }
}

/** Read the last `count` lines of the local audit log for the `audit` command. */
export async function tailAuditLog(filePath: string, count: number): Promise<readonly string[]> {
  try {
    const text = await readFile(filePath, "utf8");
    const lines = text.split("\n").filter((line) => line.length > 0);
    return lines.slice(-count);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}
