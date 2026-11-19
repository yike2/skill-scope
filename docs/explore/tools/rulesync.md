# rulesync (dyoshikawa/rulesync)

- Repository: https://github.com/dyoshikawa/rulesync
- commit: `9bca22fc5f3c634fb32f246ce75dc594bb00a77a` (2026-11-19)
- stars: about 1630 / language: TypeScript / license: MIT
- In one sentence: uses `.rulesync/` as the single source and converts rules, skills, subagents, commands, hooks, MCP, ignore, permissions and checks bidirectionally into the native formats of 60+ coding agents (`generate` to produce, `import` to bring back). It is a sync tool and does no evaluation, but it has two kinds of checks: `generate --check` and `doctor`.

Link prefix: `https://github.com/dyoshikawa/rulesync/blob/9bca22fc5f3c634fb32f246ce75dc594bb00a77a/`

## Features

| Command | Purpose |
| --- | --- |
| `init` | Generates `rulesync.jsonc` and a `.rulesync/` example |
| `generate` | Source → per-tool files; `--targets`, `--features`, `--delete` (clean orphan files), `--retire-targets`, `--global`, `--simulate-skills/subagents/commands`, `--input-roots` (multi-layer overlay), `--dry-run`, **`--check`**, `--watch` ([program.ts#L326-L387](https://github.com/dyoshikawa/rulesync/blob/9bca22fc5f3c634fb32f246ce75dc594bb00a77a/src/cli/program.ts#L326-L387)) |
| `import` | Tool-native files → `.rulesync/` |
| `convert` | Tool A format → tool B format |
| **`doctor`** | Read-only diagnosis of config problems; `--strict` treats warnings as errors ([program.ts#L389-L405](https://github.com/dyoshikawa/rulesync/blob/9bca22fc5f3c634fb32f246ce75dc594bb00a77a/src/cli/program.ts#L389-L405)) |
| `add` / `fetch` / `install` | Pulls skills and rules from GitHub / git / npm and writes `rulesync.lock` |
| `gitignore` | Adds generated files to `.gitignore` |
| `mcp` | Starts an MCP server so agents can list / get / put `.rulesync` source files |
| `docs` / `release-notes` / `update` | View docs / view release notes / self-update (`update --check` only checks for a new version) |

## Architecture and data flow

```
rulesync.jsonc (+ rulesync.local.jsonc)
.rulesync/rules/*.md  skills/*/SKILL.md  subagents/*.md  commands/*.md  checks/*.md
.rulesync/mcp.jsonc  hooks.jsonc  permissions.jsonc  .rulesyncignore
        │  RulesyncXxx.fromFile (zod validates frontmatter)
        ▼
features/<feature>/<feature>-processor.ts ──► <tool>-<feature>.ts (one class per tool)
        │  convertRulesyncFilesToToolFiles
        ▼
FeatureProcessor.writeAiFiles()  → compare with on-disk content, write only changed files → WriteResult{count,paths}
```

- Each tool's path constants live in `src/constants/<tool>-paths.ts`, e.g. [claudecode-paths.ts](https://github.com/dyoshikawa/rulesync/blob/9bca22fc5f3c634fb32f246ce75dc594bb00a77a/src/constants/claudecode-paths.ts).
- Write logic is in [feature-processor.ts#L61-L110](https://github.com/dyoshikawa/rulesync/blob/9bca22fc5f3c634fb32f246ce75dc594bb00a77a/src/types/feature-processor.ts#L61-L110).

## Core mechanisms

### Source of truth layout

- `.rulesync/rules/*.md`: frontmatter fields are `root`, `localRoot`, `targets` (default `["*"]`), `description`, `globs`, plus tool-specific blocks (`claudecode.paths`, `codebuddy.alwaysApply`, `agentsmd.subprojectPath`, etc.) ([rulesync-rule.ts#L38-L100](https://github.com/dyoshikawa/rulesync/blob/9bca22fc5f3c634fb32f246ce75dc594bb00a77a/src/features/rules/rulesync-rule.ts#L38-L100)).
- Other sources: `skills/<name>/SKILL.md`, `subagents/*.md`, `commands/*.md`, `checks/*.md` (review checklist), `mcp.jsonc`, `hooks.jsonc` ([rulesync-paths.ts#L7-L60](https://github.com/dyoshikawa/rulesync/blob/9bca22fc5f3c634fb32f246ce75dc594bb00a77a/src/constants/rulesync-paths.ts#L7-L60)).
- `--input-roots` supports a multi-layer overlay of source directories; later files at the same path override earlier ones.

### Target agents and paths (excerpt)

The README support matrix is at [README.md#L89-L168](https://github.com/dyoshikawa/rulesync/blob/9bca22fc5f3c634fb32f246ce75dc594bb00a77a/README.md#L89-L168). The table below is taken from `src/constants/*-paths.ts`:

| Tool | Rule File (project) | Global | Skills | Subagents |
| --- | --- | --- | --- | --- |
| Claude Code | `CLAUDE.md` (also accepts `.claude/CLAUDE.md`); non-root rules go to `.claude/rules/*.md`, `localRoot` goes to `CLAUDE.local.md` | `~/.claude/CLAUDE.md`, `~/.claude/rules/` ([claudecode-rule.ts#L108-L135](https://github.com/dyoshikawa/rulesync/blob/9bca22fc5f3c634fb32f246ce75dc594bb00a77a/src/features/rules/claudecode-rule.ts#L108-L135)) | `.claude/skills/` | `.claude/agents/` |
| Codex CLI | `AGENTS.md` (nested) | | `.agents/skills/` (+ `agents/openai.yaml` sidecar) | `.codex/agents/` |
| Antigravity IDE/CLI | Root `AGENTS.md`, plus `.agents/rules/*.md` (`trigger` frontmatter) | `~/.gemini/GEMINI.md` | `.agents/skills/` | `.agents/agents/` |
| CodeBuddy Code | `CODEBUDDY.md`, `.codebuddy/rules/`, `CODEBUDDY.local.md` | | `.codebuddy/skills/` | `.codebuddy/agents/` |
| DeepSeek Harness (`dsh`) | Root `AGENTS.md`, nested `<dir>/AGENTS.md`, `AGENTS.local.md` | `~/.dsh/AGENTS.md` | `.dsh/skills/` | Not supported |

The comment in [dsh-rule.ts#L5-L20](https://github.com/dyoshikawa/rulesync/blob/9bca22fc5f3c634fb32f246ce75dc594bb00a77a/src/features/rules/dsh-rule.ts#L5-L20) spells out DeepSeek Harness's load chain: first `$DSH_HOME/AGENTS.md`, then `~/.agents/AGENTS.md`, then the chain of `AGENTS.md` / `AGENTS.local.md` from the `.git` root to cwd; it also reads `CLAUDE.md` / `CLAUDE.local.md`, and files with identical content are merged. `docs/reference/file-formats.md` has a "note" per tool explaining the load chain with links to upstream docs (e.g. L234 Antigravity, L252 dsh). WorkBuddy is not in the table; whether CodeBuddy is the same as WorkBuddy needs separate confirmation.

### Sync method

- **transform + generate.** Each tool class converts frontmatter in both directions (e.g. `globs` → Claude's `paths`, Antigravity's `trigger: glob`). Tools that only recognize a single file, like Codex, get non-root rules merged into the root file.
- **Skill: copy plus frontmatter adaptation.** For tools that lack a capability, `--simulate-*` simulates it as rule text.
- **Symlink:** follows symlinks when reading sources and **copies the resolved content** to the output; on the output side it refuses links that would write outside the output root (docs/reference/file-formats.md L3-L19).
- **Hooks:** `.rulesync/hooks.jsonc` is converted into each tool's hooks config via an event mapping table (file-formats.md L294-L560, including a "Hook event × tool matrix").
- **MCP / permissions:** merged into shared config files (`shouldMergeExistingFileContent`), preserving the user's existing keys.

### Conflict handling

- `writeAiFiles` first reads existing on-disk content and uses `fileContentsEquivalent` to decide whether it is semantically equivalent; if so it skips ([content-equivalence.ts#L190](https://github.com/dyoshikawa/rulesync/blob/9bca22fc5f3c634fb32f246ce75dc594bb00a77a/src/utils/content-equivalence.ts#L190)), otherwise it overwrites. No `.bak` backup.
- `--delete` / orphan sweep deletes extra files under rulesync-managed directories; it refuses to clean directories reached through a symlink.
- `fetch --conflict skip|overwrite`.

### Validation / check (key point)

1. **`generate --check`: sync check.** Runs a full generation in preview mode; each processor uses `writeAiFiles` to compare "content that should be written" with on-disk content, and `count>0` is recorded as `hasDiff` ([generate.ts (lib)#L150-L165](https://github.com/dyoshikawa/rulesync/blob/9bca22fc5f3c634fb32f246ce75dc594bb00a77a/src/lib/generate.ts#L150-L165)). Any diff (including deletion-only diffs) throws `Files are not up to date` with exit code 1 ([cli/commands/generate.ts#L207-L221](https://github.com/dyoshikawa/rulesync/blob/9bca22fc5f3c634fb32f246ce75dc594bb00a77a/src/cli/commands/generate.ts#L207-L221)). Suitable for CI.
2. **`doctor`: config lint.** Read-only, produces diagnostics with a `code`: `config/unknown-target`, `unknown-feature`, `deprecated-feature`, `invalid-value`, `conflicting-targets`, `missing-schema`/`outdated-schema`, `unknown-key`, `token-env-*`, `input-root-*`, plus JSON-schema validation ([doctor.ts#L150-L600](https://github.com/dyoshikawa/rulesync/blob/9bca22fc5f3c634fb32f246ce75dc594bb00a77a/src/lib/doctor.ts#L150-L600), entry point [L959-L1030](https://github.com/dyoshikawa/rulesync/blob/9bca22fc5f3c634fb32f246ce75dc594bb00a77a/src/lib/doctor.ts#L959-L1030)).
3. **Instruction budget:** checks whether the total bytes of `AGENTS.md` files on Codex's root-to-cwd chain exceed `project_doc_max_bytes` (default 32 KiB, [codexcli-paths.ts#L15](https://github.com/dyoshikawa/rulesync/blob/9bca22fc5f3c634fb32f246ce75dc594bb00a77a/src/constants/codexcli-paths.ts#L15)); anything beyond is truncated by Codex and not loaded. `generate` warns, and `doctor` reads on-disk content and checks again ([doctor.ts#L864-L915](https://github.com/dyoshikawa/rulesync/blob/9bca22fc5f3c634fb32f246ce75dc594bb00a77a/src/lib/doctor.ts#L864-L915), `src/features/rules/instruction-budget.ts`).
4. **Frontmatter schema:** all source and tool files are validated with zod/mini schemas (e.g. `RulesyncRuleFrontmatterSchema`), with `validate: true` passed at construction.

### Version / history

- No version history of rule or skill files is recorded.
- `rulesync.lock` records `resolvedRef` (40-character SHA) for remote sources and an `integrity` for each skill / rule ([sources-lock.ts#L16-L58](https://github.com/dyoshikawa/rulesync/blob/9bca22fc5f3c634fb32f246ce75dc594bb00a77a/src/lib/sources-lock.ts#L16-L58)). `computeInstallContentHash` computes `sha256:` over the sequence `path\0content\0` ([install-content-hash.ts#L10-L28](https://github.com/dyoshikawa/rulesync/blob/9bca22fc5f3c634fb32f246ce75dc594bb00a77a/src/lib/install-content-hash.ts#L10-L28)), used for tamper protection in `--frozen` installs. This only covers "version pinning of external sources".

### Remaining template items

Session parsing / trigger detection / grading / baselines / statistics / cost: not applicable. Privacy: accesses GitHub / npm only during fetch / install / update; no telemetry.

## Limitations (observed in source)

- Very large: 60+ tools, one class per tool per feature; path rules are scattered across constants and each rule class's `getSettablePaths()`, with no single machine-readable table.
- It only handles writing, not what the agent actually reads: user-written files like `~/.agents/AGENTS.md` are outside its view (the dsh comment explicitly says "never writes").
- No version history; `--check` only answers "is it in sync".
