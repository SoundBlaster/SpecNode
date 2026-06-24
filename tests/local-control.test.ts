import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { ApprovalRequest } from "../src/index.js";
import {
  AutoApprovalResolver,
  CompositeAuditSink,
  FileAuditSink,
  InteractiveControl,
  NodeController,
  decideApprovalMode,
  tailAuditLog,
  type ConnectionTransport,
  type ControlCommandHandlers,
} from "../src/local-control.js";

const sampleApproval: ApprovalRequest = {
  sessionId: "sess_1",
  approvalId: "appr_1",
  risk: "high",
  operation: { kind: "shell.run", command: "npm test" },
  reason: "wants to run tests",
};

function noopHandlers(): ControlCommandHandlers {
  return {
    onRevoke() {},
    onReconnect() {},
    onStatus() {},
    onAudit() {},
    onQuit() {},
    onHelp() {},
  };
}

describe("decideApprovalMode", () => {
  it("honors an explicit mode regardless of stdin", () => {
    assert.equal(decideApprovalMode("auto-allow", false), "auto-allow");
    assert.equal(decideApprovalMode("auto-deny", true), "auto-deny");
    assert.equal(decideApprovalMode("interactive", false), "interactive");
  });

  it("defaults to interactive only when a human is on stdin", () => {
    assert.equal(decideApprovalMode(undefined, true), "interactive");
  });

  it("defaults to the safe auto-deny posture when headless", () => {
    assert.equal(decideApprovalMode(undefined, false), "auto-deny");
    assert.equal(decideApprovalMode("bogus", false), "auto-deny");
  });
});

describe("AutoApprovalResolver", () => {
  it("denies by default posture", async () => {
    const resolver = new AutoApprovalResolver(false, () => {});
    assert.equal(await resolver.resolve(sampleApproval), false);
  });

  it("allows when configured", async () => {
    const resolver = new AutoApprovalResolver(true, () => {});
    assert.equal(await resolver.resolve(sampleApproval), true);
  });
});

describe("InteractiveControl", () => {
  it("resolves a pending approval from the next line", async () => {
    const control = new InteractiveControl(noopHandlers(), () => {});
    const decision = control.resolve(sampleApproval);
    assert.equal(control.hasPendingApproval(), true);

    control.handleLine("y");
    assert.equal(await decision, true);
    assert.equal(control.hasPendingApproval(), false);
  });

  it("treats anything other than yes as a deny", async () => {
    const control = new InteractiveControl(noopHandlers(), () => {});
    const decision = control.resolve(sampleApproval);
    control.handleLine("no");
    assert.equal(await decision, false);
  });

  it("answers a pending approval before interpreting commands", () => {
    let revoked = false;
    const handlers = { ...noopHandlers(), onRevoke: () => (revoked = true) };
    const control = new InteractiveControl(handlers, () => {});

    void control.resolve(sampleApproval);
    // "r" would be the revoke command, but a pending approval must consume it.
    control.handleLine("r");
    assert.equal(revoked, false);
  });

  it("queues concurrent approvals and resolves them FIFO without dropping any", async () => {
    const control = new InteractiveControl(noopHandlers(), () => {});
    const first: ApprovalRequest = { ...sampleApproval, approvalId: "appr_first" };
    const second: ApprovalRequest = { ...sampleApproval, approvalId: "appr_second" };

    const d1 = control.resolve(first);
    const d2 = control.resolve(second);
    assert.equal(control.pendingApprovalCount(), 2);

    control.handleLine("y");
    assert.equal(await d1, true);
    assert.equal(control.pendingApprovalCount(), 1);

    control.handleLine("n");
    assert.equal(await d2, false);
    assert.equal(control.pendingApprovalCount(), 0);
  });

  it("dispatches control commands when idle", () => {
    const calls: string[] = [];
    const handlers: ControlCommandHandlers = {
      onRevoke: () => calls.push("revoke"),
      onReconnect: () => calls.push("reconnect"),
      onStatus: () => calls.push("status"),
      onAudit: () => calls.push("audit"),
      onQuit: () => calls.push("quit"),
      onHelp: () => calls.push("help"),
    };
    const control = new InteractiveControl(handlers, () => {});

    control.handleLine("revoke");
    control.handleLine("c");
    control.handleLine("status");
    control.handleLine("a");
    control.handleLine("q");
    control.handleLine("help");

    assert.deepEqual(calls, ["revoke", "reconnect", "status", "audit", "quit", "help"]);
  });
});

describe("NodeController", () => {
  function fakeTransport(): { transport: ConnectionTransport; opens: number; closes: number } {
    const state = { opens: 0, closes: 0 };
    return {
      transport: {
        open: () => void state.opens++,
        close: () => void state.closes++,
      },
      get opens() {
        return state.opens;
      },
      get closes() {
        return state.closes;
      },
    };
  }

  it("starts active and accepting sessions", () => {
    const t = fakeTransport();
    const controller = new NodeController(t.transport, () => {});
    assert.equal(controller.isRevoked(), false);
    assert.equal(controller.canAcceptSession(), true);
    assert.equal(controller.shouldReconnect(), true);
  });

  it("revoke closes the connection and blocks sessions and reconnect", () => {
    const t = fakeTransport();
    const controller = new NodeController(t.transport, () => {});

    controller.revoke();

    assert.equal(t.closes, 1);
    assert.equal(controller.isRevoked(), true);
    assert.equal(controller.canAcceptSession(), false);
    assert.equal(controller.shouldReconnect(), false);
  });

  it("is idempotent: a second revoke does not close again", () => {
    const t = fakeTransport();
    const controller = new NodeController(t.transport, () => {});
    controller.revoke();
    controller.revoke();
    assert.equal(t.closes, 1);
  });

  it("reconnect clears the revoke and reopens", () => {
    const t = fakeTransport();
    const controller = new NodeController(t.transport, () => {});
    controller.revoke();
    controller.reconnect();

    assert.equal(t.opens, 1);
    assert.equal(controller.isRevoked(), false);
    assert.equal(controller.canAcceptSession(), true);
  });

  it("reconnect on an active node does not reopen", () => {
    const t = fakeTransport();
    const controller = new NodeController(t.transport, () => {});
    controller.reconnect();
    assert.equal(t.opens, 0);
  });
});

describe("local audit log", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "specnode-audit-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("appends JSONL entries that parse back", async () => {
    const file = join(dir, "nested", "audit.jsonl");
    const sink = new FileAuditSink(file);

    await sink.record({ type: "session.started", sessionId: "sess_1" });
    await sink.record({ type: "session.completed", sessionId: "sess_1" });

    const text = await readFile(file, "utf8");
    const lines = text.split("\n").filter((line) => line.length > 0);
    assert.equal(lines.length, 2);

    const first = JSON.parse(lines[0]) as { at: string; event: { type: string } };
    assert.equal(first.event.type, "session.started");
    assert.ok(typeof first.at === "string");
  });

  it("composite sink fans out to every sink", async () => {
    const fileA = join(dir, "a.jsonl");
    const fileB = join(dir, "b.jsonl");
    const composite = new CompositeAuditSink([new FileAuditSink(fileA), new FileAuditSink(fileB)]);

    await composite.record({ type: "artifact.produced", sessionId: "sess_1", name: "demo.json" });

    assert.equal((await tailAuditLog(fileA, 10)).length, 1);
    assert.equal((await tailAuditLog(fileB, 10)).length, 1);
  });

  it("tailAuditLog returns the last N entries and tolerates a missing file", async () => {
    const file = join(dir, "audit.jsonl");
    const sink = new FileAuditSink(file);

    for (let index = 0; index < 5; index++) {
      await sink.record({ type: "text.delta", sessionId: "sess_1", text: `line ${index}` });
    }

    const tail = await tailAuditLog(file, 2);
    assert.equal(tail.length, 2);
    assert.match(tail[1], /line 4/);

    assert.deepEqual(await tailAuditLog(join(dir, "missing.jsonl"), 10), []);
  });
});
