# SpecNode Handoff

This file is the minimal context needed to continue SpecNode work in a fresh
Codex project or a new local checkout.

## Current State

SpecNode is at the specification bootstrap stage. The repository defines the
product boundary, governance rules, protocol sketch, security model, roadmap,
and provenance expectations, but it does not yet contain runtime code.

Open pull request:

- https://github.com/SoundBlaster/SpecNode/pull/1

Current branch:

- `codex/specnode-baseline`

## Concept Source

The initial concept came from the SpecGraph repository:

- `/Users/egor/Development/GitHub/0AL/SpecGraph/docs/0001_specnode.md`
- Important section starts around line 1688, after:

```text
Я бы хотел сделать такой адаптер для своих веб сервисов: SpecGraph и SpecPM.
Это может быть полезно для экономии в случае SpecGraph (и прозрачности экономики),
для Open Source в случае SpecPM - так как там надо будет качать и обрабатывать
репозитории в большом количестве
```

Core product formulation:

```text
SpecNode is a personal compute adapter for SpecGraph and SpecPM, allowing users
and open-source maintainers to run repository analysis and LLM-based
specification extraction on their own devices, while SpecGraph/SpecPM provide
orchestration, validation, registry, provenance, and observability.
```

## Required Reading

Read these files before making the next substantial change:

- `README.md`
- `AGENTS.md`
- `CONSTITUTION.md`
- `docs/proposals/0001_personal_compute_adapter.md`
- `docs/ROADMAP.md`
- `specs/JOB_PROTOCOL.md`
- `specs/SECURITY_MODEL.md`
- `specs/PROVENANCE_RECEIPTS.md`

## Architectural Summary

SpecNode is not a distributed compute marketplace. It is a personal-first local
agent that connects outbound to SpecGraph or SpecPM and executes allowlisted,
typed jobs on the user's machine.

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

## Initial MVP Slice

The next practical slice should be intentionally small:

1. Choose the first runtime language and package layout.
2. Implement a CLI skeleton.
3. Implement `specnode providers list`.
4. Implement an Ollama/OpenAI-compatible healthcheck.
5. Add a fixture-backed test for provider discovery.
6. Keep job execution, pairing, signing, and repository processing as follow-up
   slices unless the runtime choice naturally requires a small interface stub.

Suggested first user-visible commands:

```bash
specnode --help
specnode providers list
specnode test --provider ollama --model qwen3:4b
```

## Non-Goals To Preserve

Do not expand the first implementation into:

- public worker network
- compute marketplace
- payment layer
- mobile worker mode
- trusted execution environment requirement
- remote shell execution
- arbitrary prompt execution API
- direct cloud access to local LLM endpoints
- general-purpose LLM tool execution

## Security Assumptions

- Repository content is untrusted input.
- LLM output is untrusted output.
- Jobs must be typed protocol messages.
- Shell access is denied by default.
- Filesystem access is workspace-bound.
- Network access is deny-by-default except for the control plane, localhost
  provider access, and narrowly allowed repository hosts.
- Output must validate against schemas before upload.

## First Validation Targets

For documentation-only changes:

```bash
rtk proxy git diff --check
```

For Markdown files with fenced JSON examples:

```bash
rtk python3 - <<'PY'
import json
import pathlib
import re

errors = []
for path in pathlib.Path('.').rglob('*.md'):
    if '.git' in path.parts:
        continue
    text = path.read_text(encoding='utf-8')
    for index, match in enumerate(re.finditer(r'```json\n(.*?)\n```', text, re.S), start=1):
        try:
            json.loads(match.group(1))
        except Exception as exc:
            errors.append(f'{path}: json block {index}: {exc}')

if errors:
    print('\n'.join(errors))
    raise SystemExit(1)
print('json examples ok')
PY
```

## Transfer Note

A new Codex project can continue from this repository without the original chat
history if it starts by reading the required files above. The only external
context worth preserving is the source concept in the SpecGraph draft file
listed in this handoff.
