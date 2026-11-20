# Security

How the OWASP Top 10:2025 applies to Skill Scope. The core promise: raw Sessions, code and model
keys never leave the user's machine.

## OWASP Top 10:2025

**A01 Broken Access Control** (now includes SSRF)
The team server must isolate teams: every query is scoped by team, and members see only excerpts
their owners approved. Any server-side fetch of a user-supplied URL is allowlisted (SSRF).

**A02 Security Misconfiguration**
Safe defaults for the server, Next.js and reverse proxy: no debug output in production, strict
CORS, security headers, no default credentials.

**A03 Software Supply Chain Failures**
Exact version pins, the two-week release-age rule, lockfile changes reviewed, `pnpm audit` with no
high or critical issues.

**A04 Cryptographic Failures**
TLS only between daemon and server. The CLI login token is stored in the OS keychain or a file
with `0600` permissions. Model keys are never uploaded.

**A05 Injection**
Parameterized SQL only, in both the local SQLite store and server Postgres. No shell
interpolation of Session paths in hooks or adapters. Session content passed to the Grader is
untrusted input (prompt injection) and must not drive tool calls or uploads.

**A06 Insecure Design**
Raw Sessions stay local by design. Uploads go through an explicit allowlist of fields
(Evaluation Results and approved excerpts); the user can see everything that was uploaded.

**A07 Authentication Failures**
Browser-based CLI login issues scoped, expiring, revocable tokens. Daemon registration is bound
to a user and team.

**A08 Software or Data Integrity Failures**
Hooks installed into agent config are minimal, idempotent and fully removable, and never
overwrite the user's existing hooks. The server validates the shape of every uploaded payload.

**A09 Security Logging and Alerting Failures**
Log events (login, registration, upload, failures), never Session content, prompts, code, tokens
or keys. Log auth failures and cross-team access attempts on the server.

**A10 Mishandling of Exceptional Conditions**
Adapter parse failures fail closed: skip the Session, never upload partial raw data. Hooks must
never block, slow down or crash the agent; errors are caught and logged locally.

## Review checklist (Definition of Done)

- [ ] No code path uploads raw Session content, code, tokens or model keys
- [ ] Server queries are scoped by team; new endpoints check authorization
- [ ] All SQL is parameterized; no shell string interpolation of external input
- [ ] No secrets or Session content in logs, errors, tests or fixtures
- [ ] Hook changes are idempotent, removable and fail without affecting the agent
- [ ] New or bumped dependencies are pinned, at least two weeks old, and `pnpm audit` is clean
