# BYOA Bridge Example

This example demonstrates the smallest cloud-connected SpecNode BYOA loop:

```text
Browser
  -> control-plane server
  <-> outbound WebSocket from local bridge
  -> demo local agent adapter
```

The browser never talks to `localhost` bridge APIs. It only talks to the control
plane. The bridge connects outbound to the server and enforces local policy before
running a local agent adapter.

This is a localhost demo only. Do not copy the control-plane server into
production without real application authentication, per-user bridge ownership
checks, CSRF protection, rate limits, durable audit storage, and encrypted device
tokens.

## Install

```bash
npm install
```

## Run

Terminal 1:

```bash
npm run dev:server
```

Terminal 2:

```bash
npm run dev:bridge
```

Then open:

```text
http://localhost:8787
```

Click **Start session**. You should see:

1. The bridge reports `node.hello`.
2. The control plane responds with `node.accepted`.
3. The browser starts a typed session through the server.
4. The bridge accepts the session.
5. The demo adapter emits progress events.
6. The bridge emits a local approval request for shell execution.
7. The local user resolves that approval at the bridge terminal. Interactive is the
   default when a human is attached to stdin: type `y` to allow or anything else to
   deny. Denying continues with a no-side-effects artifact; approving lets the demo
   adapter proceed (it still performs no real shell side effects).

## Local Control Surface

The bridge is the device owner's control point ("Role B"). Cloud control plane,
local execution authority: the server may *request* work, but the local user
authorizes, observes, and can cut it off.

While the bridge runs, type a command and press Enter at its terminal:

```text
status (s)     connection, node identity, policy, pending approval, audit path
audit (a)      tail of the local activity log
revoke (r)     cut the cloud off: drop the session and refuse new sessions
reconnect (c)  clear a revoke and reconnect
quit (q)       disconnect and exit
help (h)       show the command list
```

When a risky operation needs approval, the bridge prints the request and waits;
`y` allows it, anything else denies. High-risk approvals are resolved locally and
are never inherited from the browser.

Every run event is appended to a local JSONL activity log (default
`.specnode/audit.jsonl`, gitignored) so the user has a durable, inspectable record.

## Environment

```bash
PORT=8787 npm run dev:server
SPECNODE_SERVER_URL="ws://localhost:8787/bridge/connect" npm run dev:bridge
SPECNODE_DEV_TOKEN="dev" npm run dev:bridge
SPECNODE_WORKSPACE_NAME="MyProject" npm run dev:bridge
SPECNODE_APPROVAL="interactive" npm run dev:bridge   # interactive | auto-allow | auto-deny
SPECNODE_AUDIT_FILE="./.specnode/audit.jsonl" npm run dev:bridge
```

`SPECNODE_DEV_TOKEN` is passed by the bridge as an `Authorization: Bearer ...`
header. The demo intentionally avoids token-in-query auth so URLs can be logged
without leaking device tokens.

`SPECNODE_APPROVAL` selects how local approvals are resolved. It defaults to
`interactive` when stdin is a TTY and to the safe `auto-deny` posture when the
bridge runs headless (CI, daemon, preview). `SPECNODE_AUDIT_FILE` overrides the
local activity log path.

## What This Does Not Do Yet

- No real Claude Code or Codex CLI invocation.
- No persisted device login.
- No encrypted payload relay.
- No graphical local approval UI; approvals are resolved at the bridge terminal.
- No workspace path mapping beyond the demo descriptor.

## Next Adapters

The current `DemoAgentAdapter` is intentionally no-side-effects. Replace it with:

- `custom-command`: spawn an allowlisted local command.
- `codex-cli`: invoke Codex CLI in an allowlisted workspace.
- `claude-code`: invoke Claude Code or Claude Agent SDK.
- `acp-stdio`: talk to ACP-compatible local agents over stdio.
