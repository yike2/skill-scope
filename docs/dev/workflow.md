# Development workflow

Every change is tracked by a GitHub issue.

## Branches

`<type>/<issue#>-<slug>`, e.g. `chore/1-monorepo-skeleton`, `docs/2-claude-md`.

## Commits

Format: `type(scope): summary (#issue)`

- `type` is one of: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `ci`.
- `scope` is required (e.g. `repo`, `claude`, `core`, `session-reader`, `grader`).
- The title is at most 72 characters and has exactly one issue number.
- Example: `chore(repo): pnpm monorepo skeleton with lint, format and test tooling (#1)`
- TDD order for feature work: `test(...)` with failing tests → `feat(...)` with the minimum
  implementation → `refactor(...)`. Fixing a wrong test is its own `test(...)` commit.

## Staging

- Stage files by name. Never `git add -A` or `git add .`.
- Check what's staged before committing: `git diff --cached --stat`.

## Pull requests

PRs target `main`. The body uses these sections:

```md
## Summary
What changed and why.

## Commits
One line per commit.

## Checks
format:check, lint, typecheck, test:unit (coverage), pnpm audit, security checklist.

## Out of scope
What this PR deliberately does not do.

## AI Disclosure
- Tool: e.g. Claude Code (model)
- Approx. % AI-generated:
- Human review: what was reviewed and changed by hand

Closes #N   (or: Part of #N)
```

## Merging

Merge with a merge commit (no squash, no rebase), so the test → feat → refactor history survives.

## Evidence

Session logs and screenshots go in `docs/evidence/` (e.g. `docs/evidence/hw4/`).
