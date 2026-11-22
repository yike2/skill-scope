# Development workflow

Every change is tracked by a GitHub issue.

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
   should be filtered out (see Testing strategy in `CLAUDE.md`).
5. **Test case list review**: a new subagent reviews the list; its author applies the fixes; the
   user reviews and approves.
6. **Test files**: a new subagent writes the test files from the approved list. They fail (red).
7. **Test review**: a new subagent reviews the test files; the test author applies the fixes;
   commit `test(...)`.
8. **Implement**: a new subagent implements; a new subagent reviews the code; the implementer
   applies the fixes until the review is clean and all Definition of Done checks in `CLAUDE.md`
   are green.
9. **Commit**: `feat(...)`, then `refactor(...)` if the review led to one.

The commits in steps 7 and 9 need no extra approval. Push and merge still do.

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
