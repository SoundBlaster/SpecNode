import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Envelope, RunEvent } from "../src/index.js";
import { WireSink, type OutboundChannel } from "../src/bridge.js";

describe("WireSink", () => {
  it("routes on the admitted session id, not adapter-supplied event data", async () => {
    const messages: Envelope<unknown>[] = [];
    const channel: OutboundChannel = { deliver: (message) => messages.push(message) };
    const sink = new WireSink(channel, "sess_admitted");

    // A reused or buggy adapter emits an event carrying a different sessionId.
    const event: RunEvent = { type: "text.delta", sessionId: "sess_other", text: "hi" };
    await sink.record(event);

    assert.equal(messages.length, 1);
    assert.equal(messages[0].type, "session.event");
    const payload = messages[0].payload as { sessionId: string; event: RunEvent };
    assert.equal(payload.sessionId, "sess_admitted"); // outer routing key is the admitted id
    assert.equal(payload.event.sessionId, "sess_other"); // inner event is preserved verbatim
  });

  it("delivers each event over the channel's current target, never a captured one", async () => {
    // Simulate a reconnect: the channel's destination changes between sends.
    const sent: string[] = [];
    let target = "socketA";
    const channel: OutboundChannel = { deliver: () => sent.push(target) };
    const sink = new WireSink(channel, "sess_1");

    await sink.record({ type: "session.started", sessionId: "sess_1" });
    target = "socketB"; // the bridge reconnected onto a new socket
    await sink.record({ type: "session.completed", sessionId: "sess_1" });

    assert.deepEqual(sent, ["socketA", "socketB"]);
  });
});
