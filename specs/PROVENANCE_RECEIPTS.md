# Provenance And Usage Receipts

SpecNode artifacts should be auditable even when the first MVP does not yet
implement cryptographic signing.

Digest fields use the canonical string form
`sha256:<64 lowercase hex characters>`.

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
    "commit": "8f3a1c0d2e4f67890123456789abcdef01234567",
    "tree_hash": "sha256:1111111111111111111111111111111111111111111111111111111111111111"
  },
  "provider": {
    "kind": "ollama",
    "model": "qwen3:4b"
  },
  "job": {
    "type": "specpm.build_package_manifest",
    "policy_hash": "sha256:2222222222222222222222222222222222222222222222222222222222222222",
    "prompt_set_hash": "sha256:3333333333333333333333333333333333333333333333333333333333333333"
  },
  "artifacts": [
    {
      "path": "spec-package.yaml",
      "digest": "sha256:4444444444444444444444444444444444444444444444444444444444444444"
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
  "provider": {
    "kind": "ollama",
    "model": "qwen3:4b"
  },
  "input_tokens": 8421,
  "output_tokens": 612,
  "duration_ms": 18422,
  "cache_hit": false,
  "artifact_digest": "sha256:4444444444444444444444444444444444444444444444444444444444444444",
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
