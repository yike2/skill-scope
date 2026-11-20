# Plan: issue #2 — revise CLAUDE.md, add docs/dev/workflow.md and docs/dev/security.md

## Context
The /init CLAUDE.md (45 lines, committed in 1b0e940) covers commands and conventions only. The course needs a fuller CLAUDE.md (~150 lines, max 200) with imports, architecture decisions, stack, testing strategy, do's/don'ts and a Definition of Done. Longer details move into two new imported files. Only these three files change.

## Files

### 1. `CLAUDE.md` — rewrite, about 150 lines
| Section | Content | Est. lines |
|---|---|---|
| Header | Required /init header | 4 |
| Context imports | `@docs/prd.md`, `@GLOSSARY.md`, `@docs/dev/workflow.md`, `@docs/dev/security.md`, one line each saying what each covers; glossary-terms rule | 12 |
| Architecture decisions | Local mode vs Runtime connected mode (CLI → Adapter → Grader; daemon adds queue, spending cap, upload); grading on the user's machine with the user's own model key; raw Sessions never leave the machine, server gets only Evaluation Results and approved excerpts; Rule File/Skill/Subagent versions recorded by a session-start hook; Claude Code adapter only for now, other agents later through the same adapter interface; current state = skeleton + placeholder `packages/core` | 18 |
| Tech stack | Current: TypeScript (strict, NodeNext), Node 22, pnpm 9 workspace, Vitest + v8 coverage, ESLint flat config, Prettier. Planned: SQLite local store; `apps/web` with Next.js + Postgres + auth; packages adapter/grader/cli/daemon. Deployment: TBD, either partner's VPS (Docker Compose + Caddy) or Vercel with preview deploys; don't pick one without a decision | 16 |
| Commands | Keep the current block as is (install, format:check, lint, typecheck, test:unit, single file, single test), plus `pnpm audit --audit-level high`; no build step | 16 |
| Coding conventions | Keep the current accurate bullets: .js relative imports, `import type`, `noUncheckedIndexedAccess`, package template, exact-version deps with the 2-week rule and the TS 6.0.x peer pin, Prettier settings, tests next to source | 14 |
| Testing strategy | Strict TDD: failing test commit → minimum implementation → refactor (history reads test → feat → refactor); Vitest unit + integration, Playwright E2E later; 70% coverage enforced by `vitest.config.ts`; never change a test to make it pass, a wrong test gets its own `test(...)` commit; test data must include items that should be filtered out (e.g. Sessions from before install, unrelated Skills, Rule Items that don't apply) | 16 |
| Do's and don'ts | Show a plan and wait for approval before editing; list unclear points as open questions; never read or print `.env` files or secrets; never commit/push/merge without approval; don't edit `docs/` or `GLOSSARY.md` unless the task is about them (`docs/dev/` and `docs/evidence/` when the task calls for it); never reformat docs; everything in English; don't scaffold planned packages unless asked; use glossary terms | 16 |
| Definition of Done | Checklist: format:check, lint, typecheck, test:unit pass; coverage ≥ 70%; `pnpm audit` no high/critical; `docs/dev/security.md` checklist reviewed; related docs updated; CI green | 12 |
| Docs pointers | `docs/explore/` index, `docs/archify/rule.md` diagram rules (short, kept from the current file), `docs/evidence/` | 8 |
| **Total** | | **~150** |

Git branch/commit/PR details move to workflow.md; CLAUDE.md keeps a one-line pointer.

### 2. `docs/dev/workflow.md` — new, about 45 lines
- Branches: `<type>/<issue#>-<slug>`.
- Commits: `type(scope): summary (#issue)`; scope required; types limited to feat, fix, docs, test, refactor, chore, ci; title ≤ 72 chars; exactly one issue number; example from history.
- TDD commit order (test → feat → refactor), cross-referenced to CLAUDE.md.
- Staging: add files by name (never `git add -A` / `.`), then check `git diff --cached --stat`.
- PR body template: Summary / Commits / Checks / Out of scope / AI Disclosure (tool, approx. % AI-generated, human review), plus `Closes #N` or `Part of #N`.
- Merge with a merge commit (no squash or rebase).
- Evidence: session logs and screenshots go in `docs/evidence/` (existing `docs/evidence/hw4/`).

### 3. `docs/dev/security.md` — new, about 50 lines
OWASP Top 10:2025 (released Nov 2025, the current edition as far as I know), 1–2 lines each mapped to Skill Scope:
- A01 Broken Access Control: team server isolates teams; every query is scoped by team; members see only approved excerpts.
- A02 Security Misconfiguration: safe defaults for server/Caddy/Next.js, no debug in prod, CORS limits.
- A03 Software Supply Chain Failures: exact pins, 2-week rule, `pnpm audit`, lockfile reviewed.
- A04 Cryptographic Failures: CLI login token stored with 0600 perms or the OS keychain; TLS only; model keys never uploaded.
- A05 Injection: parameterized SQL in the SQLite store and Postgres; no shell interpolation of Session paths in hooks/adapters; prompt injection from Session content into the Grader treated as untrusted.
- A06 Insecure Design: raw Sessions stay local by design; upload allowlist; user approves excerpts.
- A07 Authentication Failures: browser-login token flow, expiry/revocation, daemon registration.
- A08 Software or Data Integrity Failures: hooks installed into agent config are idempotent, minimal and removable; validate uploaded payload shape.
- A09 Security Logging and Alerting Failures: log events, never Session content, prompts, code or keys.
- A10 Mishandling of Exceptional Conditions: adapter parse failures fail closed (skip, don't upload partial raw data); hooks never block or crash the agent.
Then a short "review checklist" used by the Definition of Done.

## Open questions (I'll note these in the files rather than invent answers)
1. **PRD conflict:** PRD §5 lists five first-batch adapters; you want CLAUDE.md to say Claude Code only for now. I'll write "Claude Code only for now; PRD lists the longer-term batch". PRD stays unchanged as instructed. OK?
2. **CI:** no `.github/workflows` exists yet, so "CI green" in the DoD can't be met. I'll keep the item and add "(CI not set up yet)". OK?
3. **Prettier:** `docs/` is in `.prettierignore`, so the new `docs/dev/*.md` won't be format-checked. That's fine unless you want them formatted.
4. **OWASP edition:** I'm fairly confident 2025 is current, with the list above. I can confirm with one web search before writing if you want.

## Verification
- `wc -l CLAUDE.md` → 130–170, under 200.
- `grep '^@\|@docs\|@GLOSSARY' CLAUDE.md` shows all four imports.
- `pnpm format:check` (CLAUDE.md passes; the only known failure is the untracked hw4 plan file, if it still exists), `pnpm lint`.
- `git status` shows only the three files changed. No commit until you approve.
