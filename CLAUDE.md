# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Skill Scope evaluates how **Skills**, **Subagents** and individual **Rule Items** (single instructions inside `CLAUDE.md` / `AGENTS.md`) perform in _real_ coding-agent sessions, and compares results across versions of those files. Read `docs/prd.md` for scope and `GLOSSARY.md` for terminology; use the glossary's terms and avoid its listed alternatives (e.g. "Session" not "transcript", "Grader" not "judge", "Evaluation Result" not "score").

The repo is at an early stage: only the tooling skeleton and a placeholder `packages/core` exist.

## Commands

Node 22 (`.nvmrc`), pnpm 9.15.9 (pinned via `packageManager`).

```sh
pnpm install
pnpm format:check        # prettier --check .   (pnpm format to write)
pnpm lint                # eslint . (flat config)
pnpm typecheck           # pnpm -r typecheck → tsc --noEmit in each package
pnpm test:unit           # vitest run --coverage, from the root

pnpm exec vitest run packages/core/src/index.test.ts   # single file
pnpm exec vitest run -t "greets by name"               # single test by name
```

There is no build step: packages export their TypeScript source directly (`"exports": { ".": "./src/index.ts" }`) and each package only has a `typecheck` script.

## Layout and conventions

- pnpm workspace over `packages/*` and `apps/*`. Planned (per PRD §5, not yet created): adapter, grader, cli, daemon packages and `apps/web`. Don't scaffold these unless the task asks for it.
- Vitest runs once from the root config (`vitest.config.ts`); tests live next to source as `src/**/*.test.ts`. Coverage thresholds are 70% for lines/functions/branches/statements — `test:unit` fails below that.
- TypeScript is strict with `noUncheckedIndexedAccess`, `verbatimModuleSyntax` and `NodeNext` modules: relative imports need the `.js` extension, and type-only imports must use `import type`.
- New packages: name `@skill-scope/<name>`, `"type": "module"`, a `tsconfig.json` extending `../../tsconfig.base.json`, and a `typecheck` script so `pnpm -r typecheck` picks it up.
- Dependencies are pinned to exact versions (no `^`/`~`) and all dev tooling lives in the root `devDependencies`. When adding or bumping a dependency, check release dates with `pnpm view <pkg> time --json` and pick a version released more than two weeks ago; check peer ranges (e.g. TypeScript is held at 6.0.x because typescript-eslint 8.72.1 requires `<6.1.0`).
- Prettier: single quotes, print width 100.

## Docs

- `docs/`, `GLOSSARY.md` and `pnpm-lock.yaml` are excluded from Prettier and ESLint on purpose — never reformat them. Don't edit `docs/` or `GLOSSARY.md` unless the task is about them.
- `docs/explore/` holds research and per-tool source analyses of existing evaluation tools (`docs/explore/tools/README.md` is the index).
- Architecture diagrams in `docs/archify/` follow `docs/archify/rule.md` (one stable folder per diagram, edit `candidate.json` and re-finalize in place, `meta.locale: "en"`, `visual_preset: "editorial"`, run `default-light.py` after every finalize; `index.*.json` receipts are git-ignored).

## Git

Work is tracked by GitHub issues. Branches are named `<type>/<issue#>-<slug>` (e.g. `chore/1-monorepo-skeleton`), and commits use Conventional Commits with a scope and the issue number, e.g. `chore(repo): pnpm monorepo skeleton with lint, format and test tooling (#1)`.
