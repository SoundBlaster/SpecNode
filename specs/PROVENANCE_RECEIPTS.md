# Provenance And Usage Receipts

SpecNode artifacts should be auditable even when the first MVP does not yet
implement cryptographic signing.

## Artifact Set

A complete local run should be able to produce:

- `specgraph.json`
- `spec-package.yaml`
- `provenance.json`
- `usage_receipt.json`
- optional conformance tests or hints
- optional signature bundle

## Provenance Fields

```json
{
  "generated_by": {
    "tool": "specnode",
    "version": "0.1.0"
  },
  "source": {
    "repo": "https://github.com/org/project",
    "commit": "8f3a1c",
    "tree_hash": "sha256:example"
  },
  "provider": {
    "kind": "ollama",
    "model": "qwen3:4b"
  },
  "job": {
    "type": "specpm.build_package_manifest",
    "policy_hash": "sha256:example",
    "prompt_set_hash": "sha256:example"
  },
  "artifacts": [
    {
      "path": "spec-package.yaml",
      "sha256": "example"
    }
  ],
  "generated_at": "2026-04-26T00:00:00Z"
}
```

## Usage Receipt Fields

```json
{
  "job_id": "job_01H00000000000000000000000",
  "node_id": "node_01H00000000000000000000000",
  "provider": "ollama",
  "model": "qwen3:4b",
  "input_tokens": 8421,
  "output_tokens": 612,
  "duration_ms": 18422,
  "cache_hit": false,
  "artifact_sha256": "sha256:example",
  "created_at": "2026-04-26T00:00:00Z"
}
```

## Signing Stages

Stage 0:

- unsigned receipts
- schema validation
- artifact hashes

Stage 1:

- local node keypair
- signed artifact bundle
- public key registered during pairing

Stage 2:

- Agent Passport identity
- issuer chain
- expiration and revocation metadata
- registry-side signature verification

## Resource Ledger

SpecGraph UI should show resource usage as an estimate, not as an invoice:

```text
AI processing powered by your node
Jobs completed: 18
Input tokens: 184220
Output tokens: 11930
Device time: 7m 42s
Cache hits: 6
Estimated equivalent cloud inference cost: ~$0.38
Model: qwen3:4b
Provider: Ollama
```
