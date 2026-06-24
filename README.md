# SpecNode

Personal compute adapter for SpecGraph and SpecPM.

SpecNode lets users and open-source maintainers run repository analysis and
LLM-backed specification extraction on their own devices while SpecGraph and
SpecPM provide orchestration, validation, registry, provenance, and
observability.

License: MIT. See `LICENSE`.

## Status

This repository is at the specification bootstrap stage. There is no installable
runtime yet.

The first implementation target is a local CLI or daemon that connects to a
SpecGraph/SpecPM control plane through an outbound job channel and executes a
small allowlisted set of typed jobs.

## Core Idea

```text
SpecGraph / SpecPM control plane
        |
        | outbound WSS session from node
        v
specnode on user's device
        |
        | localhost only
        v
Ollama / LM Studio / llama.cpp / custom OpenAI-compatible endpoint
```

SpecNode should return structured artifacts:

- `specgraph.json`
- `spec-package.yaml`
- `provenance.json`
- `usage_receipt.json`

It should not return unrestricted local filesystem state, raw secrets, or
unbounded LLM transcripts.

## BYOA Bridge Direction

SpecNode can also serve as a local execution bridge for **Bring Your Own Agent**
flows.

In that mode, the browser talks only to the application server. SpecNode keeps an
outbound connection to the server, enforces local policy, and invokes a
user-owned local agent through an adapter such as Claude Code, Codex CLI, an
ACP-compatible agent, or a custom command.

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
Claude Code / Codex CLI / ACP agent / custom command
```

The core rule is:

> Cloud control plane, local execution authority.

See:

- `docs/proposals/byoa-bridge-mvp.md`
- `specs/byoa-bridge-protocol.md`
- `examples/README.md`

## Runnable BYOA Demo

This branch includes a small browser/server/bridge demo.

```bash
npm install
npm run dev:server
# in another terminal
npm run dev:bridge
```

Open `http://localhost:8787`, then start a session from the browser. The demo
server sends a typed task to the local bridge over an outbound WebSocket, and the
bridge runs a no-side-effects demo adapter that emits progress, local approval,
audit, and artifact events.

## MVP Shape

The smallest useful slice is:

- pair a local node with a user account
- discover one local OpenAI-compatible provider
- execute one SpecGraph extraction job
- execute one SpecPM package-build job
- validate structured output against schemas
- produce a usage receipt with provider, model, duration, token counts, and
  artifact hash

Target CLI shape:

```bash
specnode connect --code 8K4P-X2Q9
specnode providers list
specnode test --model qwen3:4b
specnode specpm build --repo . --model qwen3:4b
specnode specpm validate ./dist/spec-package.yaml
```

## Repository Layout

```text
docs/
  proposals/          Product and architecture proposals.
examples/             Runnable browser/server/bridge demos.
specs/                Protocol, security, and artifact contracts.
src/                  Runtime implementation, once selected.
tests/                Conformance and regression tests, once runtime exists.
tools/                Developer or validation tooling.
```

## Design Constraints

- Outbound-only connection from node to service.
- Typed jobs only.
- No arbitrary shell from remote jobs.
- No LLM tool execution in the MVP.
- Repository content is untrusted input.
- Deterministic analyzers should run before LLM inference where practical.
- Artifacts should be hashable, schema-valid, and provenance-linked.

## Related Systems

- SpecGraph: executable product ontology and governed intent graph.
- SpecPM: intent-level package manager and registry for specification bundles.
- Agent Passport: future identity and policy envelope for verifiable local
  agents.
