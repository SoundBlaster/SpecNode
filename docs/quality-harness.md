# Quality harness

A deterministic gate that keeps cohesion, coupling, size, and complexity in
check. One command runs everything; the same command runs in CI on every PR.

```bash
npm run verify
```

`verify` runs, in order: `typecheck`, `lint`, `depcruise`, `betterer:ci`, `test`.
The first failure stops the gate.

## What each check enforces

### Dependency direction and cycles — dependency-cruiser

`.dependency-cruiser.cjs` enforces the three-layer model (protocol/SDK → bridge
runtime → demo), with dependencies pointing downward only:

- `no-circular` — no import cycles anywhere.
- `src-not-to-examples` — `src` (protocol/SDK and bridge runtime) must not import
  the demo (`examples`).
- `protocol-stays-pure` — the SDK entry (`src/index.ts`) must not import the rest
  of `src` (the bridge runtime).

### Coupling, size, and complexity — ESLint

`.eslintrc.cjs`. Coupling and the suppression audit apply everywhere; size and
complexity are strict in `src` and relaxed in `examples`/`tests`.

| Rule | Limit | Scope |
| --- | --- | --- |
| `max-params` | 8 | everywhere |
| `import/max-dependencies` | 15 | everywhere |
| `complexity` | 10 | `src` (off in demo/tests) |
| `max-lines` | 400 | `src` |
| `max-lines-per-function` | 50 | `src` |

The demo owns a large HTML generator, so size/complexity there is ratcheted
instead of hard-failed (below).

### Suppression audit — eslint-comments

Every `eslint-disable` must carry a written justification
(`@eslint-community/eslint-comments/require-description`). Silent suppressions
fail the lint step.

### Ratchet baseline — Betterer

`.betterer.cjs` applies the strict size/complexity rules to `examples` and holds
the current violations as a baseline in `.betterer.results`. New violations fail
`betterer:ci`; the count can only go down. The demo can grow features but its
files and functions can only get smaller, never larger.

To intentionally re-baseline after a legitimate change, run `npm run betterer`
and commit the updated `.betterer.results`.

## Tuning

Thresholds live in `.eslintrc.cjs` (and mirrored for the ratchet in
`.betterer.cjs`). They are intentionally simple and per-repo tunable; adjust the
numbers rather than disabling a rule. If a rule genuinely must be suppressed,
suppress the single line with a written reason so the suppression audit records
why.
