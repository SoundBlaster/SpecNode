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
7. The demo bridge denies shell execution and completes with a no-side-effects artifact.

## Environment

```bash
PORT=8787 npm run dev:server
SPECNODE_SERVER_URL="ws://localhost:8787/bridge/connect" npm run dev:bridge
SPECNODE_DEV_TOKEN="dev" npm run dev:bridge
SPECNODE_WORKSPACE_NAME="MyProject" npm run dev:bridge
```

`SPECNODE_DEV_TOKEN` is passed by the bridge as an `Authorization: Bearer ...`
header. The demo intentionally avoids token-in-query auth so URLs can be logged
without leaking device tokens.

## What This Does Not Do Yet

- No real Claude Code or Codex CLI invocation.
- No persisted device login.
- No encrypted payload relay.
- No real local approval UI.
- No workspace path mapping beyond the demo descriptor.

## Next Adapters

The current `DemoAgentAdapter` is intentionally no-side-effects. Replace it with:

- `custom-command`: spawn an allowlisted local command.
- `codex-cli`: invoke Codex CLI in an allowlisted workspace.
- `claude-code`: invoke Claude Code or Claude Agent SDK.
- `acp-stdio`: talk to ACP-compatible local agents over stdio.
