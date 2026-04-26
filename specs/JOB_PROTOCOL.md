# SpecNode Job Protocol

This document defines the first draft of the typed job envelope exchanged
between a SpecGraph/SpecPM control plane and a local SpecNode.

## Protocol Goals

- Keep remote work bounded and auditable.
- Avoid arbitrary prompt execution.
- Make policy explicit per job.
- Make output schema validation mandatory.
- Leave room for signed receipts and Agent Passport identity.

## Node Pairing

Pairing starts in the web service and completes from the local node.

```json
{
  "pairing_code": "8K4P-X2Q9",
  "expires_in_seconds": 600,
  "allowed_services": ["specgraph", "specpm"]
}
```

The node registers its capabilities:

```json
{
  "node_name": "Egor MacBook Pro",
  "runtime": {
    "os": "macOS",
    "arch": "arm64",
    "specnode_version": "0.1.0"
  },
  "providers": [
    {
      "type": "ollama",
      "base_url_kind": "localhost",
      "models": ["qwen3:4b", "llama3.2:3b"]
    }
  ],
  "capabilities": [
    "repo.scan",
    "repo.chunk",
    "llm.chat",
    "specgraph.extract",
    "specgraph.build",
    "specpm.package"
  ],
  "limits": {
    "max_concurrent_jobs": 1,
    "max_repo_size_mb": 500,
    "max_job_duration_seconds": 900
  }
}
```

## Job Envelope

```json
{
  "job_id": "job_01H00000000000000000000000",
  "service": "specgraph",
  "type": "specgraph.extract_module_intent",
  "created_at": "2026-04-26T00:00:00Z",
  "repo": {
    "source": "remote",
    "url": "https://github.com/org/project",
    "commit": "8f3a1c"
  },
  "input": {
    "files": [
      {
        "path": "src/parser.ts",
        "content_ref": "workspace://chunks/src_parser_ts_001"
      }
    ]
  },
  "policy": {
    "allow_network": false,
    "allow_shell": false,
    "allow_filesystem_outside_workspace": false,
    "allow_llm_tools": false,
    "max_input_tokens": 12000,
    "max_output_tokens": 1200,
    "timeout_ms": 60000
  },
  "output_schema": {
    "type": "object",
    "required": ["intent", "capabilities", "confidence"],
    "properties": {
      "intent": { "type": "string" },
      "capabilities": { "type": "array" },
      "confidence": { "type": "number" }
    }
  }
}
```

## Job Response

```json
{
  "job_id": "job_01H00000000000000000000000",
  "status": "completed",
  "artifact": {
    "type": "specgraph.module_intent.v1",
    "content": {
      "intent": "Parse markdown documents into an intermediate AST.",
      "capabilities": [
        {
          "name": "parse_markdown",
          "confidence": 0.91,
          "evidence": ["src/parser.ts:12-94"]
        }
      ],
      "confidence": 0.89
    }
  },
  "usage": {
    "provider": "ollama",
    "model": "qwen3:4b",
    "input_tokens": 8421,
    "output_tokens": 612,
    "duration_ms": 18422,
    "cache_hit": false
  },
  "receipt": {
    "node_id": "node_01H00000000000000000000000",
    "repo_commit": "8f3a1c",
    "job_type": "specgraph.extract_module_intent",
    "artifact_sha256": "sha256:example"
  }
}
```

## Lifecycle

Allowed job statuses:

- `queued`
- `running`
- `completed`
- `failed`
- `cancelled`
- `rejected`

The node may reject a job before execution if:

- the job type is not allowlisted
- the policy exceeds local limits
- the requested provider/model is unavailable
- the repository size exceeds local policy
- the output schema is missing or invalid

## Initial Job Types

SpecGraph:

- `specgraph.extract_file_summary`
- `specgraph.extract_module_intent`
- `specgraph.extract_capabilities`
- `specgraph.build_graph_fragment`

SpecPM:

- `specpm.inspect_repo`
- `specpm.extract_package_metadata`
- `specpm.build_package_manifest`
- `specpm.generate_conformance_hints`
