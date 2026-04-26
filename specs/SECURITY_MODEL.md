# SpecNode Security Model

SpecNode runs on a user's machine and receives work from a remote control plane.
The default posture is deny-by-default with explicit capabilities per job.

## Trust Boundaries

```text
SpecGraph/SpecPM cloud
        |
        | typed jobs over outbound WSS
        v
specnode process
        |
        | bounded local workspace
        v
repository content and generated artifacts

specnode process
        |
        | localhost only
        v
local LLM provider
```

The cloud does not receive direct access to the local provider endpoint. The
provider base URL is local configuration, not remote authority.

## Threats

- malicious repository content
- prompt injection inside source files, README files, issues, or docs
- malicious or compromised control plane job
- accidental overuse of local CPU/GPU resources
- artifact forgery or stale provenance
- leakage of local secrets from outside the workspace

## MVP Controls

- outbound-only connection
- typed jobs only
- allowlisted job types
- workspace-only file access
- no shell by default
- no LLM tools in MVP
- no filesystem access for LLM output
- no network access unless job policy explicitly allows it
- maximum repository size
- maximum job duration
- maximum token budget
- schema validation before artifact upload
- local activity log visible to user
- node revoke/disconnect operation

## Repository Content Handling

Repository content is data, not instruction.

The node must not obey instructions found in repository files that ask it to:

- ignore system policy
- reveal local secrets
- access files outside the workspace
- run shell commands
- call network services
- alter provenance
- disable validation

## Filesystem Policy

Default allowed path:

```text
~/.specnode/workspaces/<job_id>/
```

Default denied paths include:

- `~/.ssh`
- `~/.aws`
- `~/Documents`
- parent directories outside the job workspace
- environment files outside the workspace

## Network Policy

Default network behavior:

- allow outbound WSS/HTTPS to the configured control plane
- allow localhost provider calls
- deny other network access unless job policy grants a narrow allowlist

Repository checkout jobs may allow specific hosts such as:

- `github.com`
- `gitlab.com`

## Agent Passport Alignment

The first MVP does not require a full Agent Passport runtime. The protocol
should still preserve fields that can later map to:

- agent identity
- capabilities
- resource requirements
- file and network policy
- code integrity hash
- issuer signature
- revocation state
