# BYOA Bridge MVP Proposal

## Source Context

SpecNode already targets a local CLI or daemon that connects to a SpecGraph or
SpecPM control plane through an outbound job channel and executes a small
allowlisted set of typed jobs.

The related product question is broader: can a normal web application let a user
bring their own local or remote agent, such as Claude Code, Codex CLI, a custom
ACP-compatible coding agent, or an internal company agent, and let that agent act
inside the application without the application owning the model, runtime, or
inference bill?

This proposal defines the smallest useful SpecNode slice for that pattern.

## Goal

Turn SpecNode into a local execution bridge for **Bring Your Own Agent** flows.

The web application remains the cloud control plane. SpecNode remains the local
execution authority. External agents remain user-owned or company-owned
runtimes.

```text
Browser application
        |
        | HTTPS / SSE / WebSocket
        v
SpecGraph / SpecPM / app control plane
        ^
        | outbound WSS session from node
        v
specnode on user's device
        |
        | adapter boundary
        v
Claude Code / Codex CLI / ACP agent / custom command
```

## Non-Goals

- Do not build another agent framework.
- Do not expose arbitrary shell execution from the cloud.
- Do not require the browser to connect to `localhost`.
- Do not require the application to pay for user-owned inference.
- Do not implement a marketplace in the MVP.
- Do not standardize all agent-to-agent communication.

## MVP User Story

1. A user installs `specnode` on their computer.
2. The user runs `specnode login` and pairs the node with an account.
3. The node opens an outbound WebSocket session to the application server.
4. The node reports available local agent adapters and allowlisted workspaces.
5. In the browser, the user sees `SpecNode online`.
6. The user selects a workspace and an agent.
7. The application sends a typed task to SpecNode.
8. SpecNode checks local policy before executing anything.
9. SpecNode runs the selected agent through an adapter.
10. SpecNode streams run events back to the server.
11. Risky actions require local approval.
12. SpecNode and the server both retain an audit trail.

## Trust Boundary

The central rule is:

> Cloud control plane, local execution authority.

The server may request work. SpecNode decides whether the request is allowed.

SpecNode must enforce local policy even when the server is compromised or a web
session is malicious.

## Minimal Capabilities

### Device Pairing

```bash
specnode login
specnode status
specnode logout
```

The node receives a device token and appears in the user's account as a connected
device. Tokens must be revocable from both the server and the local node.

Next step: the concrete multi-account pairing, explicit token issuance, and
token-to-bridge delivery flow are specified in
`docs/proposals/byoa-multi-account-pairing.md`. It replaces the demo's single
static token and global connection with per-account, scoped, revocable tokens.

### Workspace Allowlist

```bash
specnode workspace add ~/Development/MyProject
specnode workspace list
specnode workspace remove my-project
```

The server never sends raw filesystem paths. It sends `workspaceId`; SpecNode
maps that ID to a local path.

### Agent Discovery

```bash
specnode agents list
specnode agents test claude-code
specnode agents test codex
```

Initial adapters:

- `custom-command`: user-configured local command.
- `claude-code`: adapter for Claude Code or Claude Agent SDK when available.
- `codex-cli`: adapter for local Codex CLI when available.
- `acp-stdio`: adapter for local ACP-compatible agents over stdio.

### Typed Sessions

The server starts sessions with a typed payload, not with free-form shell
commands.

```json
{
  "type": "session.start",
  "sessionId": "sess_123",
  "workspaceId": "ws_my_project",
  "agentId": "claude-code",
  "task": {
    "kind": "repository.review",
    "goal": "Review the diff and propose a safe patch.",
    "inputs": {
      "pullRequest": 12
    }
  },
  "policy": {
    "filesystem": "workspace-read",
    "shell": "ask",
    "network": "deny"
  }
}
```

### Run Events

SpecNode streams normalized events back to the server:

```json
{ "type": "session.started", "sessionId": "sess_123" }
{ "type": "text.delta", "sessionId": "sess_123", "text": "I will inspect the diff first." }
{ "type": "approval.required", "sessionId": "sess_123", "approvalId": "appr_1" }
{ "type": "session.completed", "sessionId": "sess_123" }
```

## Local Policy

The MVP policy file should be explicit and local-first.

```yaml
server:
  origin: https://specgraph.example

workspaces:
  ws_my_project:
    path: ~/Development/MyProject
    filesystem: workspace-only

agents:
  claude-code:
    enabled: true
  codex-cli:
    enabled: true

shell:
  default: ask
  deny:
    - rm -rf
    - curl
    - ssh
    - chmod 777

network:
  default: deny

approval:
  local_required_for:
    - file.write
    - shell.run
    - git.commit
    - network.request
```

## Security Constraints

- Bind no public local server in cloud-connected MVP mode.
- Keep the outbound connection authenticated and revocable.
- Require local confirmation for high-risk operations.
- Use short-lived session tokens.
- Reject unknown workspace IDs.
- Reject unknown agent IDs.
- Persist a local audit log.
- Do not let the cloud send arbitrary executable commands.
- Treat repository content and app-provided task text as untrusted input.

## Future Protocol Adapters

- MCP: expose application actions and resources to agents.
- ACP: communicate with local coding agents that support Agent Client Protocol.
- AG-UI: normalize user-facing run events and interactive state.
- Agent Passport: signed identity and capability envelope for external agents.

## Success Criteria

The MVP is successful when a user can:

1. Pair a local SpecNode with a web account.
2. Register one workspace.
3. Discover one external local agent.
4. Start a repository task from the browser.
5. Stream progress back to the browser through the server.
6. Require local approval before any file write or shell command.
7. Produce an audit record for the whole run.
