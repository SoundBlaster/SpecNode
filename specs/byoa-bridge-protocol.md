# BYOA Bridge Protocol Sketch

Status: draft.

This document defines the smallest protocol surface for a cloud-connected
SpecNode that acts as a local execution bridge for user-owned agents.

## Roles

- **Control plane**: the web application backend that authenticates users,
  tracks devices, starts sessions, and fans events out to browsers.
- **SpecNode**: the local bridge running on a user's device.
- **Agent adapter**: a local integration boundary for Claude Code, Codex CLI,
  ACP-compatible agents, or custom commands.
- **Browser client**: the user-facing application UI. It talks only to the
  control plane in the cloud-connected MVP.

## Transport

The MVP transport is a persistent outbound WebSocket from SpecNode to the control
plane.

```text
specnode -> wss://<control-plane>/specnode/connect
```

All messages are JSON objects with:

```ts
interface Envelope<TPayload> {
  id: string;
  type: string;
  timestamp: string;
  payload: TPayload;
}
```

Message IDs are unique per connection and may be used for acknowledgement,
tracing, and replay protection.

## Handshake

SpecNode sends `node.hello` immediately after connection.

```json
{
  "id": "msg_1",
  "type": "node.hello",
  "timestamp": "2026-06-24T00:00:00.000Z",
  "payload": {
    "nodeId": "node_123",
    "protocolVersion": "0.1",
    "capabilities": [
      "sessions.start",
      "sessions.cancel",
      "agents.list",
      "workspaces.list",
      "events.stream"
    ],
    "agents": [
      { "id": "claude-code", "kind": "coding-agent", "transport": "adapter" },
      { "id": "codex-cli", "kind": "coding-agent", "transport": "adapter" }
    ],
    "workspaces": [
      { "id": "ws_my_project", "name": "MyProject" }
    ]
  }
}
```

The control plane responds with `node.accepted` or closes the connection.

## Session Start

The control plane sends `session.start`.

```json
{
  "id": "msg_2",
  "type": "session.start",
  "timestamp": "2026-06-24T00:00:01.000Z",
  "payload": {
    "sessionId": "sess_123",
    "agentId": "claude-code",
    "workspaceId": "ws_my_project",
    "task": {
      "kind": "repository.review",
      "goal": "Review the diff and propose a safe patch.",
      "inputs": {
        "pullRequest": 12
      }
    },
    "policy": {
      "filesystem": "workspace-read",
      "shell": "ask",
      "network": "deny"
    }
  }
}
```

SpecNode must reject the session if:

- `agentId` is unknown or disabled;
- `workspaceId` is unknown;
- requested policy exceeds local policy;
- a local approval policy requires preflight confirmation and the user rejects it.

## Session Events

SpecNode emits `session.event` messages.

```json
{
  "id": "msg_3",
  "type": "session.event",
  "timestamp": "2026-06-24T00:00:02.000Z",
  "payload": {
    "sessionId": "sess_123",
    "event": {
      "type": "text.delta",
      "text": "I will inspect the repository state first."
    }
  }
}
```

Known event types:

- `session.started`
- `session.rejected`
- `text.delta`
- `action.requested`
- `approval.required`
- `approval.resolved`
- `artifact.produced`
- `session.completed`
- `session.failed`
- `session.cancelled`

## Approval Flow

SpecNode may require local approval before executing risky operations.

```json
{
  "type": "approval.required",
  "approvalId": "appr_123",
  "risk": "high",
  "operation": {
    "kind": "shell.run",
    "command": "npm test"
  },
  "reason": "The selected agent wants to run the project test suite."
}
```

The approval must be resolved locally. The server may display approval state, but
high-risk approvals should not rely only on browser-side confirmation.

## Cancellation

The control plane may send `session.cancel`.

```json
{
  "id": "msg_4",
  "type": "session.cancel",
  "timestamp": "2026-06-24T00:00:10.000Z",
  "payload": {
    "sessionId": "sess_123",
    "reason": "user_requested"
  }
}
```

SpecNode should forward cancellation to the active adapter and eventually emit
`session.cancelled` or `session.failed`.

## Audit Record

At the end of each run, SpecNode should produce a local audit record and may send
a redacted summary to the control plane.

```json
{
  "sessionId": "sess_123",
  "nodeId": "node_123",
  "agentId": "claude-code",
  "workspaceId": "ws_my_project",
  "startedAt": "2026-06-24T00:00:01.000Z",
  "finishedAt": "2026-06-24T00:01:00.000Z",
  "outcome": "completed",
  "operations": [
    { "kind": "adapter.start" },
    { "kind": "shell.run", "approved": true },
    { "kind": "artifact.produced" }
  ]
}
```

## Open Questions

- Whether payloads need end-to-end encryption between browser and SpecNode.
- How much raw agent transcript is safe to retain.
- Whether Agent Passport should be required for non-local custom agents.
- How to normalize ACP, MCP, and custom-command adapter events.
