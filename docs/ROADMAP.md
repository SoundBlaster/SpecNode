# SpecNode Roadmap

## Phase 1: Personal Node MVP

Goal: prove that one SpecGraph feature can use local inference without a cloud
LLM provider.

Deliverables:

- CLI or daemon bootstrap
- pairing code flow
- outbound WebSocket session
- local provider discovery
- Ollama-compatible provider adapter
- one typed SpecGraph job
- local activity log

Success metrics:

- one user can connect a node from a laptop
- one extraction job completes through a local model
- output validates against a schema
- usage receipt records duration, model, provider, and artifact hash

## Phase 2: SpecGraph Local Pipeline

Goal: process repository fragments into SpecGraph-ready artifacts.

Deliverables:

- file inventory
- deterministic language/symbol detection
- chunk budgeting
- module intent extraction
- graph fragment assembly
- validation report

Success metrics:

- graph fragments include source evidence
- schema validation pass rate is visible
- cache hits and local token usage are recorded

## Phase 3: SpecPM Package Build

Goal: let a maintainer generate a local candidate SpecPackage before registry
submission.

Deliverables:

- `specnode specpm build --repo .`
- package manifest generation
- license metadata capture
- provenance document
- conformance hints or tests
- local validation command

Success metrics:

- SpecPM receives normalized packages instead of raw repository chaos
- rejected packages include actionable validation gaps
- accepted packages include complete provenance

## Phase 4: Open-Source Contributor Mode

Goal: allow contributors to process public repositories without requiring
centralized LLM spend.

Deliverables:

- public repository queue integration
- candidate package submission
- duplicate detection metadata
- community review metadata
- registry acceptance report

Success metrics:

- public packages can be produced by community nodes
- registry compute cost remains near-zero for package generation
- accepted/rejected ratio is measurable
