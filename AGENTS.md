# SpecNode Agent Instructions

SpecNode is the personal compute adapter for SpecGraph and SpecPM.

## Repository Rules

- Merge into `main` only through a pull request.
- Prefer specification-first changes until the first MVP runtime slice is chosen.
- Preserve stable terminology: `SpecNode`, `SpecGraph`, `SpecPM`, `Agent Passport`, `job protocol`, `usage receipt`, `provenance`.
- Keep proposals under `docs/proposals`.
- Keep stable protocol and security contracts under `specs`.
- Runtime code, once introduced, belongs under `src`.
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

- Documentation changes should pass `git diff --check`.
- Protocol examples should be valid JSON or YAML when possible.
- Runtime changes should add focused tests for the behavior being introduced.
- Security model changes should include at least one negative case or abuse scenario.
