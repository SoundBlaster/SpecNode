# SpecNode Agent Instructions

SpecNode is the personal compute adapter for SpecGraph and SpecPM.

## Layers

SpecNode is organized in three layers. Keep them separated; dependencies only
ever point downward.

- **Protocol / SDK** — the stable wire contract: message types, the envelope
  codec, the handshake/capability helpers, and the runtime interfaces
  (`PolicyEngine`, `AgentAdapter`, `AuditSink`, `ApprovalResolver`). This is the
  package entry point. It depends on nothing in the other layers.
- **Bridge runtime** — the reusable local execution authority: outbound transport
  and reconnection, session orchestration, local approval, revoke/reconnect,
  audit, and default policy. It depends only on the protocol/SDK layer and
  contains no demo-specific code.
- **Demo** — runnable examples that wire the bridge to a concrete agent and a
  stand-in control plane. It may depend on the SDK and bridge layers; those two
  layers must never depend on the demo. A demo must not hold reusable bridge
  logic — extract such logic into the bridge runtime.

## Repository Rules

- Merge into `main` only through a pull request.
- Keep protocol and security contracts specification-first; land runtime code
  together with the spec and docs it changes.
- Preserve stable terminology: `SpecNode`, `SpecGraph`, `SpecPM`, `Agent Passport`, `job protocol`, `usage receipt`, `provenance`.
- Keep proposals under `docs/proposals`.
- Keep stable protocol and security contracts under `specs`.
- Protocol/SDK code belongs under `src`, with the public surface in `src/index.ts`.
- Bridge runtime code belongs under `src/bridge`.
- Runnable demos and examples belong under `examples`, and must not contain
  reusable bridge logic.
- Tool-related code belongs under `tools`.
- Test-related code belongs under `tests`.
- Generated local runtime artifacts are not tracked by default, including `.specnode/`, `runs/`, and `.worktrees/`.
- Do not edit unrelated files.

## Design Rules

- SpecNode opens outbound connections to the control plane. Do not require inbound access to a user's machine.
- Jobs must be typed protocol messages, not arbitrary prompts.
- Treat repository content as untrusted input.
- Do not let LLM output directly invoke shell commands, access files, or call network tools.
- Prefer deterministic analyzers before LLM inference where practical.
- Every accepted artifact should be traceable to source commit, tool version, model/provider, policy, and hashes.
- Security-sensitive changes must name the trust boundary and the failure mode they address.

## Validation Expectations

- Run `npm run typecheck` and `npm test` before opening a PR that touches `src`, `examples`, or `tests`.
- Documentation changes should pass `git diff --check`.
- Protocol examples should be valid JSON or YAML when possible.
- Runtime changes should add focused tests for the behavior being introduced.
- Security model changes should include at least one negative case or abuse scenario.
