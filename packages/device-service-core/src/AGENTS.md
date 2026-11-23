# device-service-core source

## OVERVIEW

Composes service operations over mutually authenticated transports, bounded requests, and typed wire validation.

**Score:** 11; distinct domain: security-sensitive local client implementation.

## WHERE TO LOOK

| Task | Location | Contract |
|------|----------|----------|
| High-level operations | `device-service.ts` | Device/session listing, endpoint commands, state-directory helpers |
| Remote attach lifecycle | `remote-attach.ts` | Attach events and terminal command states |
| Delegated routing | `delegated-channel.ts` | Reply and located-session correlation |
| Token proof and access | `local-api/access.ts`, `local-api/dacl.ts` | POSIX permissions and Windows ACL verdicts |
| Welcome/authentication | `local-api/client.ts` | Validate welcome, prove owner, authenticate client |
| Request correlation | `local-api/client-connection.ts` | Pending ids, request deadlines, late responses |
| Socket/port boundary | `local-api/transport.ts` | Unix socket or Windows loopback endpoint |
| Framing and upload | `local-api/framing.ts`, `local-api/upload.ts` | LF-delimited JSON and bounded command parts |
| Wire types | `local-api/protocol*.ts`, `local-api/vocabulary.ts` | Request, response, event, and enum vocabulary |
| Boundary validation | `local-api/validate*.ts` | Per-request, response, event, and shape checks |
| Listing/read assembly | `local-api/client-assembly.ts`, `local-api/client-listing.ts` | Revision and chunk assembly |
| Signed acquisition | `release/acquire.ts`, `release/release-signature.ts` | Download and verification boundary |
| Strict primitives | `strict-ed25519/` | Pinned corpus and canonical key/signature checks |

## CONVENTIONS

- Relative runtime imports use explicit `.ts` suffixes.
- Handshake and request deadlines are separate injectable timers: 10 seconds and 30 seconds.
- The owner proves its fresh per-boot token before client authentication; only hello precedes that proof.
- `close` means orderly transport shutdown; `destroy` means protocol or transport failure.
- `onAnswer` runs before the next decoded line so subscribers can observe immediately following events.
- Expired requests retain their id until a late answer or connection close; late answers are dropped.

## ANTI-PATTERNS

- Do not turn a POSIX handshake timeout into proof that the running service needs reinstalling.
- Do not accept malformed responses as empty results; protocol violations fail pending requests and destroy the transport.
- Never feed secrets into the variable-time strict-Ed25519 group arithmetic; it handles public values only.
- Do not invoke native signature verification before strict canonical/subgroup prechecks.
