# Elegant Objects refactoring guide

This is the target style for refactoring work in SpecNode. It is the "how to
shape code" companion to the deterministic quality harness (size, coupling, and
complexity limits) and the three-layer model (protocol/SDK → bridge runtime →
demo): the harness is the guardrail, Elegant Objects is the intent.

Treat this as guidance for refactoring tasks, not a mandate to rewrite working
code on sight.

## Behavior first

- Preserve observable behavior first. Refactor in small, reviewable steps.
- The existing `node:test` suite under `tests/` is a set of characterization
  tests unless a task explicitly asks to change behavior. If coverage is missing,
  add the smallest tests needed to pin current behavior before changing structure.

## Model the domain before choosing classes

- Identify domain invariants and state transitions first, then choose objects.
- Model aggregate behavior explicitly. Check constraints against the relevant
  whole state, not one raw input item at a time.
- For state-changing behavior, separate decision from mutation: validate guards
  against the current aggregate, then produce the next state only after the
  operation is allowed. Keep caller payloads immutable, and update aggregate state
  after each accepted item in a batch.

## Elegant Objects as the refactoring target

- Move behavior out of procedural helpers, renderers, controllers, dictionaries,
  and raw primitives into focused objects.
- Prefer immutable values and explicit dependencies.
- Avoid getters/setters in domain code when the behavior can be asked of the
  object instead.
- Avoid `Utils`, `Helpers`, `Managers`, `Processors`, and broad `Services`.
- Avoid constructor work: a constructor assigns dependencies and values; I/O,
  parsing, caching, and heavy validation belong in behavior or collaborators.
- Prefer composition and decorators over inheritance trees, flags, casts, and
  type-branching ladders.
- Keep boundary DTOs at the boundary and convert them into behavior-rich objects
  before running domain behavior. In SpecNode the wire envelope and payload types
  are boundary DTOs; the bridge runtime should turn them into behavior-rich
  objects rather than threading raw records through the logic.

## Keep the refactor narrow

- Do not change the public API unless the task explicitly permits it.
- Do not refactor unrelated modules.
- Do not chase EO purity beyond the requested transformation.
- Do not rename external protocol fields, generated code, test fixture names, or
  serialization keys. This reinforces the repository rule to preserve stable
  terminology and protocol contracts.

## Before finishing

- Prefer a small runnable object model over a larger EO-shaped rewrite that does
  not pass checks.
- Run the relevant checks: `npm run typecheck` and `npm test` (and the quality
  harness gate once it lands).
- Review the diff for: behavior changes, over-refactoring, DTO leakage,
  static-helper relapse, mutable setters, and naming dogmatism.
- Report any larger EO opportunities separately instead of applying them in the
  same change.
