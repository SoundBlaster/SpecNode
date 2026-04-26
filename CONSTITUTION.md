# SpecNode Constitution

SpecNode exists to let a user or open-source maintainer donate compute to their
own SpecGraph and SpecPM workflows without turning their device into a public
worker.

## Mission

SpecNode provides a local, policy-bounded execution layer for repository
analysis and LLM-backed specification extraction.

The cloud services remain responsible for orchestration, validation, registry
state, search, and observability. The user's machine remains responsible for
local compute, local repository access, and local provider selection.

## Product Invariants

- SpecNode is personal-first, not marketplace-first.
- SpecNode uses outbound-only connectivity to the service control plane.
- SpecNode receives typed jobs, not arbitrary remote prompts.
- SpecNode returns structured artifacts, not opaque transcripts.
- SpecNode treats repository content as hostile until validated.
- SpecNode never exposes a local LLM endpoint directly to the cloud.
- SpecNode must make local resource usage visible to the user.

## Trust Model

SpecGraph and SpecPM should not trust a node because it exists. They should
trust bounded claims about artifacts:

- source repository URL and commit
- tool and protocol versions
- job policy
- local provider and model identifier
- artifact hashes
- usage receipt
- optional Agent Passport identity
- optional artifact signature

The first MVP may use unsigned receipts, but the protocol must leave room for
signed provenance and revocation.

## Governance Loop

SpecNode changes should follow a small loop:

1. Observe a product or protocol need.
2. Propose the smallest spec change that captures the boundary.
3. Validate the example contract.
4. Implement only the slice needed to exercise the contract.
5. Feed implementation evidence back into the spec.

## Non-Goals For The First Phase

- No public worker network.
- No compute marketplace.
- No payments.
- No mobile worker mode.
- No trusted execution environment requirement.
- No remote shell execution.
- No general-purpose agent tool execution from LLM output.
