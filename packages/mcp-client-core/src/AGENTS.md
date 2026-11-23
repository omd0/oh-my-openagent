# MCP client internals

## OVERVIEW
Session-scoped connection state coordinates transport shutdown, OAuth renewal, environment authorization, and durable grants.

Score: 11; distinct domain: connection and authorization state machines.
Measured: 59 files, 98% code, 223 AST declarations, 127 exported declarations; graph centrality unmeasured.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Inspect client registry state | `skill-mcp-manager/{manager,types}.ts` | Managed clients and per-operation access |
| Choose transport | `skill-mcp-manager/connection-type.ts` | Explicit type, then URL, then command |
| Construct local process client | `skill-mcp-manager/stdio-client.ts` | Shutdown generation, policy signal, failed-connect cleanup |
| Construct remote client | `skill-mcp-manager/http-client.ts` | Streamable HTTP or explicit SSE |
| Normalize protocol behavior | `skill-mcp-manager/protocol-transport.ts` | Transport compatibility boundary |
| Apply authorization changes | `skill-mcp-manager/{env-policy,policy-connection}.ts` | Effective env and policy cancellation |
| Adapt grants storage | `skill-mcp-manager/env-grant-store.ts` | Observer lifecycle and inode revision metadata |
| Maintain vendored grants code | `skill-mcp-manager/env-grants-store.ts`, `skill-mcp-manager/changes.md` | Upstream provenance and drift notes |
| Disconnect and evict | `skill-mcp-manager/cleanup.ts` | Session/all-client close and idle timer |
| Discover OAuth metadata | `mcp-oauth/discovery.ts` | Protected resource and authorization server metadata |
| Register/login/step up | `mcp-oauth/{dcr,oauth-authorization-flow,step-up}.ts` | Client ID, browser callback, scope merge |
| Serialize refresh | `mcp-oauth/refresh-mutex.ts` | One in-flight refresh per server |
| Persist token/index | `mcp-oauth/{storage,storage-index}.ts` | URL-keyed token files and atomic index writes |
| Normalize resource identity | `mcp-oauth/resource-indicator.ts` | Drops query, hash and trailing slash |
| Configure callback and schema | `mcp-oauth/{callback-server,schema}.ts` | Local ports and OAuth options |
| Resolve shared identity | `config-dir.ts`, `plugin-identity.ts`, `logger.ts` | Canonical config path and logger seam |

## CONVENTIONS
- Stdio connection snapshots `shutdownGeneration`; a connection finishing after shutdown closes its resources.
- A supplied effective environment takes precedence over constructing one from `config.env`.
- `GrantStore.watch` returns an unsubscribe closure even while asynchronous observer setup is pending.
- Grant snapshot `revision` is observer metadata and is never serialized into grants.
- Token index writes use atomic rename and restrictive permissions.
- OAuth authorization has a five-minute timeout; step-up merges requested scopes.

## ANTI-PATTERNS
- Never release a proper-lockfile lock after ownership loss.
- Never write or rename grants after `GrantsLockLostError`/`ELOCKLOST`; clean orphan temporary files.
- Never publish a post-shutdown client into the registry.
- Never discard vendored provenance when updating grants storage.

## CHECKS
Transport changes need protocol/connection tests; grant changes need drift, observer and cross-process coverage.
