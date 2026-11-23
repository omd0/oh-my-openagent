# senpi-desktop-xpc - macOS Identity and Transport

**Generated:** 2026-11-17. **Score:** 10; distinct domain: sealed peer identity and authenticated XPC sessions.

## OVERVIEW

macOS Security.framework verification and opt-in XPC transport for the desktop engine's native-controller boundary.

## WHERE TO LOOK

| Task | Location | Contract |
|------|----------|----------|
| Public API and platform gates | `src/lib.rs` | AgentTransport, Incoming, transport error, roles, identity |
| Release identities | `src/roles.rs` | Team 523JNR86LZ; native-controller/server IDs; epoch xpc-1 |
| Verify actual peers | `src/identity.rs`, `src/audit.rs`, `src/security.rs` | Sealed verifier over kernel-delivered identity |
| Evaluate signing policy | `src/policy.rs`, `src/signing_info.rs` | Requirements, roles, flags, entitlements, epoch |
| Confine libxpc objects | `src/native.rs`, `src/dictionary.rs` | Native ownership and field decoding |
| Gate connection frames | `src/connection.rs`, `src/capability.rs` | Challenge, approval hashes, capability, sequence, TTL |
| Serve and forward | `src/agent.rs`, `src/listener.rs`, `src/stream.rs` | Per-connection transport lifetime |
| Exercise real identity | `tests/real_identity.rs`, `tests/real_xpc.rs` | macOS integration tests |
| Exercise crash teardown | `src/crash_tests.rs`, `src/transport_tests.rs` | Real-child and transport regressions |
| Run signed acceptance | `scripts/signed-*.sh`, `examples/` | Temporary signed fixtures and owned Mach services |
| Understand the protocol | `TRANSPORT.md` | Inactive O2 mode, framing, stop persistence, known residual |

## CONVENTIONS

- Modules using Security/libxpc are macOS-gated; roles remain available outside macOS.
- The engine is the external Cargo consumer. The xpc-agent mode is opt-in, installs no job, and is not selected by existing clients.
- Verify each received dictionary's real sender before decoding its fields or JSON; require reciprocal server identity and matching EUID.
- Only the native-controller role is eligible as a privileged client; engine-server identity is not a client role.
- Approval authenticates a finite immutable batch of exact frame hashes; discovery carries no approval, tokens, or RPC.
- Each connection owns session state and sequences; disconnect releases held input and closes only that session.
- TRANSPORT.md documents the global-stop marker and its same-user deletion residual; missing markers are not proof of an external reset authority.

## ANTI-PATTERNS

- Never fabricate audit identity from JSON, select an arbitrary verifier role, cache a VerifiedPeer, or reuse it for another message.
- Never let raw XPC objects escape native.rs or decode signing policy from an on-disk plist.
- Never accept forbidden entitlements based on a false value; their presence is disqualifying.
- Never add reconnect/replay, trust a proposal-source approved boolean, or expose a production stop-path override.
- Never let a connection resume token clear the global stop latch; publication/acknowledgement follows durable commit.
- Never add hard/kill signing flags to hide runtime-only fixture failures.

## CHECKS

- `cargo test -p senpi-desktop-xpc`; real-child tests require macOS.
- Signed macOS acceptance: `TMPDIR=/tmp/cu10207 bash crates/senpi-desktop-xpc/scripts/signed-transport.sh`.
- Also run `signed-latch.sh` and `signed-fixtures.sh` for affected stop/signing behavior; signed-transport invokes signed-crash.
