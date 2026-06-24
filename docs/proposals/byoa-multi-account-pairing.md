# BYOA Multi-Account Pairing and Token Issuance

Status: draft. Proposed next step after the BYOA bridge MVP.

This proposal turns the demo's single shared connection into a real multi-account
model: each account explicitly issues a revocable device token, the user delivers
that token to their SpecNode, and the bridge can serve more than one account from
the same machine.

## Motivation

The current example bridge takes two deliberate shortcuts that block real use:

- The control plane compares an inbound connection against one static token
  (`SPECNODE_DEV_TOKEN`, default `"dev"`) and stores exactly one global `bridge`.
  There is no notion of which account a connection belongs to.
- The token is a constant the operator types into an environment variable. There
  is no explicit issuance, no expiry, and no revocation.

The `byoa-bridge-mvp` proposal already names device pairing (`specnode login`),
a per-account device token, and revocation as MVP capabilities. This document
specifies that flow concretely and extends it so a single node can be paired to
several accounts.

## Goals

- Each account can pair one or more SpecNode devices.
- A single device (bridge) can be paired to several accounts and route sessions
  per account, with isolated workspaces and agents per binding.
- Tokens are explicitly issued by the control plane, scoped, expiring, and
  revocable from both the server and the local node.
- Token delivery to the bridge is a deliberate, auditable step. The token never
  travels in a URL or query string.

## Non-Goals

- No marketplace, billing, or usage-receipt changes here.
- No identity-provider / SSO federation specifics.
- No Agent Passport runtime yet; this proposal stays compatible with it (see
  "Agent Passport alignment").
- No change to the run-event or session protocol shapes.

## Model

```text
Account ──< DeviceToken >── Node (SpecNode install)
   |                          |
   |                          └─ Profile: server origin, token, workspaces, agents
   └─ Device list (issue / list / revoke)
```

- `Account`: a user or org on the control plane.
- `Node`: one SpecNode install, identified by a stable `nodeId`.
- `DeviceToken`: the credential that binds one `Node` to one `Account` with a set
  of scopes. The `(accountId, nodeId)` pair is the binding key.
- `BridgeProfile`: local config on the node for one binding — server origin,
  device token, allowlisted workspaces, and enabled agents.

A node paired to N accounts holds N profiles and N tokens. One account binding is
fully isolated from another: a session started by account A can never reach a
workspace or agent that the user exposed only to account B.

On the server, the single global `bridge` becomes a registry keyed by binding:

```text
connections: Map<accountId, Map<nodeId, BridgeConnection>>
```

The Bearer token is resolved to `(accountId, nodeId, scopes)` instead of being
compared against a constant.

## Pairing and Token Issuance Flow

A device-code style flow keeps the secret off the URL and makes delivery explicit.

```text
Browser (signed in)        Control plane                 SpecNode (bridge)
      |                          |                              |
      | 1. "connect a device"    |                              |
      |------------------------->|                              |
      | 2. pairing code + expiry |                              |
      |<-------------------------|                              |
      |                                                         |
      |          3. user enters code on the device             |
      |- - - - - - - - - - - - - - - - - - - - - - - - - - - -->|
      |                          | 4. POST /devices/redeem      |
      |                          |    { pairingCode, nodeId }   |
      |                          |<-----------------------------|
      |                          | 5. device token (long-lived) |
      |                          |----------------------------->|
      |                          |                              | 6. store in profile
      |                          | 7. outbound WSS + Bearer      |
      |                          |<-----------------------------|
      |                          | 8. resolve token -> account   |
      |                          |    register connection        |
```

1. The user opens "Connect a device" in the app.
2. The control plane mints a short-lived `pairingCode` bound to the account and
   the requested scopes, and shows it (plus a `verification_uri`) to the user.
3. The user runs `specnode login --server https://app.example` and enters the
   pairing code. The device contributes its own `nodeId`.
4. The bridge redeems the code at the control plane.
5. The control plane issues a long-lived, revocable `deviceToken` bound to
   `(accountId, nodeId, scopes)` and returns it once over the redeem response.
6. The bridge stores the token in a local profile (see "Token storage").
7. The bridge dials out and presents `Authorization: Bearer <deviceToken>`.
8. The control plane resolves the token to its binding and registers the
   connection under that account.

### Server endpoints (control-plane side, referenced here, not part of SpecNode)

```http
POST   /devices            issue a pairing code for the signed-in account
POST   /devices/redeem     exchange { pairingCode, nodeId } for a device token
GET    /devices            list the account's paired devices
DELETE /devices/{id}       revoke a device token immediately
```

### Bridge CLI

```bash
specnode login --server https://app.example   # redeem a pairing code -> profile
specnode accounts list                          # show local bindings and status
specnode logout <account>                        # delete the local token
```

## Token Model

```json
{
  "tokenId": "dev_tok_123",
  "accountId": "acct_42",
  "nodeId": "node_abc",
  "scopes": ["sessions.start", "sessions.cancel", "events.stream"],
  "issuedAt": "2026-06-24T00:00:00.000Z",
  "expiresAt": "2026-09-24T00:00:00.000Z",
  "lastSeenAt": "2026-06-24T00:00:00.000Z",
  "revokedAt": null
}
```

- The long-lived `deviceToken` authenticates the outbound WSS connection.
- Session work continues to use short-lived session tokens (already an MVP
  security constraint) so a leaked session token expires quickly.
- Tokens are rotatable: the control plane may issue a new token and mark the old
  one for expiry without re-pairing.
- `scopes` are a subset of the node's advertised capabilities; the server must
  reject any `node.hello` capability or session that exceeds the token scope.

## Token Storage and Delivery

- The token is delivered to the bridge only through the redeem response over TLS,
  never in a connect URL or query string (consistent with the protocol's
  header-only auth rule).
- Stored per profile under the node's local config (default `~/.specnode/`,
  already gitignored as local runtime state), with file permissions restricted to
  the user. A later phase moves this to the OS keychain.
- Tokens are never written to logs or audit records; only `tokenId` is logged.

## Multi-Account on One Bridge

- The bridge holds one profile per binding and opens one outbound connection per
  binding. One connection per account keeps account contexts isolated and avoids
  multiplexing account identity inside messages.
- Each profile carries its own workspace and agent allowlist, so the user can
  expose a work repo to the company account and a personal repo to a personal
  account from the same machine without cross-exposure.
- `specnode accounts list` shows, per binding: account, server origin, connection
  state, token expiry, and exposed workspaces/agents.

## Revocation

Revocation must be effective immediately from either side, matching the local
execution-authority principle:

- Server side: `DELETE /devices/{id}` invalidates the token, drops any open
  connection for that binding, and removes it from the registry.
- Local side: `specnode logout <account>` (and the local revoke control on the
  bridge) deletes the stored token and closes the connection; the node refuses to
  reconnect for that binding until re-paired.

## Security Constraints

- Trust boundary: cloud control plane vs. local execution authority, now
  multiplied per account. Failure mode addressed: a stolen or misissued token
  must not grant access beyond one account's declared scopes and workspaces.
- A stolen device token is bounded by scope, expiry, and immediate revocation; it
  cannot reach another account's bindings on the same node.
- The pairing code is short-lived, single-use, and bound to the issuing account.
- Header-only auth: no token in URLs, logs, or query strings.
- Per-binding isolation: resolving the token fixes the account context for the
  whole connection; a session cannot cross into another account's workspaces.
- The local revoke authority and local audit log from the bridge control surface
  remain in force per binding (see related work below).

## Agent Passport Alignment

The device token is the MVP stand-in for a signed identity envelope. The token
fields (`accountId`, `nodeId`, `scopes`, `expiresAt`, `revokedAt`) are chosen to
map forward onto Agent Passport identity, capabilities, and revocation state when
that runtime is introduced.

## Phased Plan

1. Per-account token resolution: replace the static token compare and the single
   global `bridge` with a token-to-binding registry; allow several connected
   nodes. (Server demo and protocol resolution rule.)
2. Explicit issuance and delivery: pairing-code redeem flow and `specnode login`.
3. Multi-account profiles on one bridge: multiple bindings, per-binding workspace
   and agent allowlists.
4. Token lifecycle: expiry, rotation, and revocation surfaced in the account
   device list and the bridge CLI.
5. Agent Passport alignment: replace the opaque token with a signed envelope.

## Open Questions

- Device-code redemption versus paste-a-token for the first cut.
- OS keychain versus restricted-permission file for token storage.
- One outbound connection per binding versus one multiplexed connection.
- Org/team accounts and shared nodes, and whether a node may be owned by an org
  rather than a single user.

## Related Work

- `docs/proposals/byoa-bridge-mvp.md` — device pairing and the broader MVP.
- `specs/byoa-bridge-protocol.md` — the outbound handshake this flow authenticates.
- `specs/SECURITY_MODEL.md` — outbound-only posture, revocation, and audit.
- The bridge local control surface (local approval, revoke, and audit) is the
  per-binding counterpart of this server-side issuance work.
