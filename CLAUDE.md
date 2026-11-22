# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Context imports

- @docs/prd.md: product requirements, user stories, scope and what is out of scope.
- @GLOSSARY.md: the project's terms. Use them, and avoid the alternatives it lists ("Session" not
  "transcript", "Grader" not "judge", "Evaluation Result" not "score", "Rule Item" not "rule").
- @docs/dev/workflow.md: branch names, commit format, staging, PR template, merging, evidence.
- @docs/dev/security.md: OWASP Top 10:2025 as it applies to Skill Scope, plus the review checklist.

Skill Scope evaluates how **Skills**, **Subagents** and individual **Rule Items** perform in
_real_ coding-agent Sessions, and compares Evaluation Results across versions of those files.
The repo is at an early stage: only the tooling skeleton and a placeholder `packages/core` exist.

## Core principles: KISS and YAGNI

These come first. When another rule or a skill pulls toward more, they win.

- **KISS**: choose the simplest design that meets the current task. Plain functions and data over
  classes, layers and patterns; one obvious way over a configurable one.
- **YAGNI**: build only what the current task and its tests require. Add options, extension
  points, abstractions and generalisations (other agents, the daemon, the server) only when a task
  asks for them.
- In review, code the task does not need is a finding, and removing it is the fix.

## Architecture decisions

- **Two run modes.**
  - **Local mode**: the user starts grading manually through the CLI. The CLI calls the Session
    Reader and the Grader directly; results stay in the local store; no background process.
  - **Runtime connected mode**: Local mode plus a background Runtime daemon. The CLI logs in
    through the browser to get a token; the daemon registers with the team server, queues each
    finished Session, runs Session Reader → Grader, enforces the spending cap and uploads results
    read from the local store.
- **Grading is local.** The Grader runs on the user's machine with the user's own model key.
- **Raw Sessions never leave the machine.** The server receives only Evaluation Results and
  excerpts the user explicitly approved. Never design a code path that uploads raw Session
  content, code or model keys.
- **Versions are recorded at Session start** by a hook (Skill, Subagent and Rule File versions).
  Sessions from before installation are not processed.
- **Agents:** Claude Code only for now; the PRD lists the longer-term batch. Other agents plug in
  later through the same Session Reader interface, so keep agent-specific parsing inside that
  agent's Session Reader.
- Agent log formats and hook mechanisms are not stable public interfaces; treat parsing as
  fallible and test Session Readers against real logs.

## Tech stack

Current:

- TypeScript (strict, `NodeNext` modules), Node 22 (`.nvmrc`)
- pnpm 9.15.9 workspace over `packages/*` and `apps/*` (pinned via `packageManager`)
- Vitest with v8 coverage, ESLint (flat config), Prettier

Planned (not created yet; don't scaffold unless the task asks):

- Packages: session-reader, grader, cli, daemon
- Local store: SQLite
- `apps/web`: Next.js + Postgres + auth (team server and web UI)
- Deployment: **TBD**. Either the partner's VPS (Docker Compose + Caddy) as in our previous
  project, or Vercel with preview deploys as the course rubric expects. Don't pick one or add
  deployment config without a decision.

## Commands

```sh
pnpm install
pnpm format:check        # prettier --check .   (pnpm format to write)
pnpm lint                # eslint . (flat config)
pnpm typecheck           # pnpm -r typecheck → tsc --noEmit in each package
pnpm test:unit           # vitest run --coverage, from the root
pnpm audit --audit-level high

pnpm exec vitest run packages/core/src/index.test.ts   # single file
pnpm exec vitest run -t "greets by name"               # single test by name
```

There is no build step: packages export their TypeScript source directly
(`"exports": { ".": "./src/index.ts" }`) and each package only has a `typecheck` script.

## Coding conventions

- Relative imports need the `.js` extension (`NodeNext`); type-only imports must use
  `import type` (`verbatimModuleSyntax`).
- `noUncheckedIndexedAccess` is on: indexed reads are `T | undefined`, so handle the undefined case.
- New packages: name `@skill-scope/<name>`, `"type": "module"`, `"private": true`, a
  `tsconfig.json` extending `../../tsconfig.base.json`, and a `typecheck` script so
  `pnpm -r typecheck` picks it up.
- Tests live next to source as `src/**/*.test.ts`; Vitest runs once from the root
  `vitest.config.ts`.
- Dependencies are pinned to exact versions (no `^`/`~`); all dev tooling lives in the root
  `devDependencies`. When adding or bumping one, check `pnpm view <pkg> time --json` and pick a
  version released more than two weeks ago. Check peer ranges: TypeScript is held at 6.0.x
  because typescript-eslint 8.72.1 requires `<6.1.0`.
- Prettier: single quotes, print width 100.

## Testing strategy

- **Strict TDD.** Commit the failing tests first, then the minimum implementation that makes them
  pass, then refactor. The history should read `test(...)` → `feat(...)` → `refactor(...)`.
- Unit and integration tests with Vitest. Playwright E2E for `apps/web` later.
- Coverage minimum is 70% for lines, functions, branches and statements, enforced in
  `vitest.config.ts`; `pnpm test:unit` fails below it.
- **Never change a test to make it pass.** If a test is wrong, fixing it is its own `test(...)`
  commit with the reason in the message.
- Test data must include items that should be filtered out, not only the happy path: e.g.
  Sessions from before installation, Skills that were never relevant, Rule Items that don't
  apply, malformed log lines, excerpts the user did not approve.

## Feature workflow

The parent agent orchestrates and talks to the user. Planning, writing tests, implementing and
reviewing each run in a **new subagent**, so every review comes from an agent that did not write
the work. To fix work after a review, or to re-review after a fix, continue the original subagent
(`SendMessage`) instead of starting a new one.

1. **Explore**: run the `grilling` or `brainstorming` skill with the user until the scope is
   settled and open questions are listed.
2. **Plan**: a new subagent writes the plan.
3. **Plan review**: a new subagent reviews the plan; the planner applies the fixes; the user
   reviews and approves.
4. **Test case list**: a new subagent writes one description per test case, including items that
   should be filtered out (see Testing strategy).
5. **Test case list review**: a new subagent reviews the list; its author applies the fixes; the
   user reviews and approves.
6. **Test files**: a new subagent writes the test files from the approved list. They fail (red).
7. **Test review**: a new subagent reviews the test files; the test author applies the fixes;
   commit `test(...)`.
8. **Implement**: a new subagent implements; a new subagent reviews the code; the implementer
   applies the fixes until the review is clean and all Definition of Done checks are green.
9. **Commit**: `feat(...)`, then `refactor(...)` if the review led to one.

The commits in steps 7 and 9 need no extra approval. Push and merge still do.

## Do's and don'ts

Do:

- Show a plan and wait for approval before editing files.
- List unclear points as open questions instead of inventing answers.
- Keep changes scoped to the task and the files it names.
- Use the glossary terms in code, comments, docs and commit messages.

Don't:

- Read or print `.env` files, tokens, model keys or other secrets.
- Work around the permission rules in `.claude/settings.json` (shared; personal overrides go in
  the git-ignored `.claude/settings.local.json`).
- Commit, push or merge without explicit approval (except the Feature workflow commits).
- Edit `docs/` or `GLOSSARY.md` unless the task is about them. `docs/`, `GLOSSARY.md` and
  `pnpm-lock.yaml` are excluded from Prettier and ESLint on purpose: never reformat them.
- Scaffold planned packages or pick a deployment target unprompted.
- Write anything in the repo in a language other than English.

## Definition of Done

- [ ] `pnpm format:check`, `pnpm lint`, `pnpm typecheck` and `pnpm test:unit` pass
- [ ] Coverage is at least 70%
- [ ] `pnpm audit` reports no high or critical issues
- [ ] The checklist in `docs/dev/security.md` has been reviewed for the change
- [ ] Related docs are updated (this file, `docs/dev/`, PRD or glossary if the task covers them)
- [ ] CI is green (`.github/workflows/ci.yml`)

## Docs

- `docs/explore/`: research and per-tool source analyses of existing evaluation tools
  (`docs/explore/tools/README.md` is the index).
- `docs/archify/`: architecture diagrams following `docs/archify/rule.md` (one stable folder per
  diagram, edit `candidate.json` and re-finalize in place, `meta.locale: "en"`,
  `visual_preset: "editorial"`, run `default-light.py` after every finalize; `index.*.json`
  receipts are git-ignored).
- `docs/tech/`: one design doc per module, written from `docs/tech/TEMPLATE.md`.
- `docs/evidence/`: session logs and screenshots per assignment.
- Git workflow (branches, commits, PRs): see `docs/dev/workflow.md`.
