# SpecNode

Local execution bridge for SpecGraph and SpecPM.

SpecNode runs on a user's device, keeps an outbound connection to a
SpecGraph/SpecPM control plane, enforces local policy, and executes work locally.
The core rule is:

> Cloud control plane, local execution authority.

License: MIT. See `LICENSE`.

## What SpecNode does

SpecNode has one core — an outbound-only connection and local execution authority
— and two modes:

- **BYOA execution bridge (primary; built today).** The browser talks only to the
  application server. SpecNode keeps an outbound WebSocket to the server, enforces
  local policy, and invokes a user-owned local agent through an adapter such as
  Claude Code, Codex CLI, an ACP-compatible agent, or a custom command.
- **Personal compute adapter (planned).** The same node runs repository analysis
  and LLM-backed specification extraction against a local provider (Ollama,
  LM Studio, llama.cpp, or an OpenAI-compatible endpoint) and returns structured
  artifacts: `specgraph.json`, `spec-package.yaml`, `provenance.json`,
  `usage_receipt.json`.

In either mode SpecNode never returns unrestricted local filesystem state, raw
secrets, or unbounded LLM transcripts.

```text
Browser application
        |
        v
SpecGraph / SpecPM / app control plane
        ^
        | outbound WSS session from node
        v
specnode on user's device
        |
        v
Claude Code / Codex CLI / ACP agent / custom command   (BYOA bridge)
Ollama / LM Studio / llama.cpp / OpenAI-compatible      (compute adapter)
```

## Status

Early, but runnable. What exists today:

- A typed BYOA bridge protocol and SDK — wire types, the `createNodeHello`
  handshake helper, and the runtime interfaces (`src/index.ts`).
- A bridge runtime with a local control surface: interactive per-operation
  approval, node revoke/reconnect, and a durable local audit log
  (`src/local-control.ts`).
- A runnable browser/server/bridge demo with a no-side-effects demo adapter
  (`examples/`).

Not built yet: a published package, a `specnode` CLI, persisted device login, real
agent adapters, and the compute-adapter (spec-extraction) runtime.

## Quick start (BYOA demo)

```bash
npm install
npm run dev:server
# in another terminal
npm run dev:bridge
```

Open `http://localhost:8787` and start a session from the browser. The server
sends a typed task to the local bridge over an outbound WebSocket; the bridge runs
a demo adapter that streams progress, local approval, audit, and artifact events
without side effects.

Run the bridge in a real terminal to use the local controls (`help`, `status`,
`audit`, `revoke`, `reconnect`). See `examples/README.md` for the full walkthrough
and environment variables.

## Architecture

SpecNode is organized in three layers, with dependencies pointing downward only:

- **Protocol / SDK** (`src/index.ts`) — wire types, the `createNodeHello` helper,
  and the runtime interfaces (`PolicyEngine`, `AgentAdapter`, `AuditSink`,
  `ApprovalResolver`).
- **Bridge runtime** (`src/local-control.ts`; consolidating under `src/bridge`) —
  outbound transport, session orchestration, approval, revoke, and audit.
- **Demo** (`examples/`) — a stand-in control plane and a demo adapter wired to the
  bridge.

The bridge opens only outbound connections; the browser never talks to the local
node. See `AGENTS.md` for the layering rules and `specs/byoa-bridge-protocol.md`
for the wire protocol.

## Repository layout

```text
docs/
  proposals/            Product and architecture proposals.
  elegant-objects.md    Refactoring style guide.
examples/               Runnable browser/server/bridge demo (BYOA mode).
specs/                  Protocol, security, and artifact contracts.
src/                    Protocol/SDK and bridge runtime.
tests/                  Unit tests (node:test).
```

## Roadmap

Next slices, in rough order (details under `docs/proposals/`):

- Multi-account pairing and explicit device-token issuance
  (`docs/proposals/byoa-multi-account-pairing.md`).
- Real agent adapters: `custom-command`, `claude-code`, `codex-cli`, `acp-stdio`.
- The compute-adapter mode: pair a node, discover a local provider, run a
  SpecGraph extraction and a SpecPM package build, validate output against
  schemas, and emit a usage receipt with provider, model, duration, token counts,
  and artifact hash.

Planned compute-adapter CLI shape:

```bash
specnode connect --code 8K4P-X2Q9
specnode providers list
specnode test --model qwen3:4b
specnode specpm build --repo . --model qwen3:4b
specnode specpm validate ./dist/spec-package.yaml
```

## Design constraints

- Outbound-only connection from node to control plane; no inbound access to the
  device.
- Typed jobs only; no arbitrary shell from remote jobs.
- Repository content and app-provided task text are untrusted input.
- High-risk operations require local approval; the node holds final authority.
- No LLM tool execution in the MVP.
- Artifacts should be hashable, schema-valid, and provenance-linked.

## Documentation

- `specs/byoa-bridge-protocol.md` — outbound handshake and session protocol.
- `specs/SECURITY_MODEL.md` — trust boundaries, threats, and controls.
- `docs/proposals/byoa-bridge-mvp.md` — the BYOA bridge MVP.
- `docs/proposals/byoa-multi-account-pairing.md` — multi-account pairing and token issuance.
- `docs/elegant-objects.md` — code style for refactors.
- `examples/README.md` — running the demo and the local control surface.
- `AGENTS.md` — repository rules and the three-layer model.

## Related systems

- SpecGraph: executable product ontology and governed intent graph.
- SpecPM: intent-level package manager and registry for specification bundles.
- Agent Passport: future identity and policy envelope for verifiable local agents.
