#!/usr/bin/env bash
# Single quality gate. Run on every PR (locally and in CI).
set -euo pipefail

run() {
  echo ""
  echo "==> $1"
  shift
  "$@"
}

run "typecheck"                  npm run --silent typecheck
run "lint (size/coupling/complexity + suppression audit)" npm run --silent lint
run "dependencies (layers + cycles)" npm run --silent depcruise
run "ratchet baseline (betterer)" npm run --silent betterer:ci
run "tests"                      npm run --silent test

echo ""
echo "All quality checks passed."
