# glooit (nikuscs/glooit)

- Repository: https://github.com/nikuscs/glooit
- commit: `94c357c97fc0464594bca47e22727b60d3db471d` (2026-05-12)
- stars: about 24 / language: TypeScript (Bun) / license: `package.json` says MIT, but there is no LICENSE file in the repository and the GitHub API returns null
- In one sentence: a single TypeScript config file, `glooit.config.ts`, declares "which source Markdown goes to which agents and where it is written"; it distributes rules, commands, skills, agents, MCP, Claude/Cursor hooks and settings by copy or symlink, and can rewrite content with transforms before distribution. It does no evaluation and has one `validate` command (config validation).

Link prefix: `https://github.com/nikuscs/glooit/blob/94c357c97fc0464594bca47e22727b60d3db471d/`

## Features

| Command | Purpose |
| --- | --- |
| `init` | Generates `glooit.config.ts` |
| `sync` | Takes a snapshot first if `backup` is configured, then distributes ([cli/index.ts#L272-L286](https://github.com/nikuscs/glooit/blob/94c357c97fc0464594bca47e22727b60d3db471d/src/cli/index.ts#L272-L286)) |
| **`validate`** | Validates the config, exit code 1 on errors ([cli/index.ts#L288-L303](https://github.com/nikuscs/glooit/blob/94c357c97fc0464594bca47e22727b60d3db471d/src/cli/index.ts#L288-L303)) |
| `backup list` / `restore <ts>` | Lists / restores `.agents/backups/<timestamp>.json` snapshots |
| `clean` / `reset` / `unlink` / `link` | Deletes generated files per the manifest, resets, manages symlinks |
| `upgrade` | Self-update |

## Architecture and data flow

```
glooit.config.ts (dynamic import via jiti, i.e. executes user TS code)
  rules[] {file|file[], to, targets[], mode, globs, hooks[]}
  commands / skills / agents directories, mcps[], hooks[], settings, transforms{before,after,error}
        │ ConfigLoader → validateRule (types/index.ts)
        ▼
AIRulesCore.sync()  (core/index.ts)
  ├─ transforms.before
  ├─ manifest.pruneStaleFiles(expected)    ← deletes old generated files no longer in config
  ├─ AgentDistributor.distributeRule()     ← copy / symlink / multi-file merge + content hooks
  ├─ syncDirectories()                     ← commands/skills/agents
  ├─ distributeMcps / hooksDistributor / settingsDistributor
  └─ gitignore + manifest.updateManifest
```

Orchestration is in [core/index.ts#L46-L94](https://github.com/nikuscs/glooit/blob/94c357c97fc0464594bca47e22727b60d3db471d/src/core/index.ts#L46-L94).

## Core mechanisms

### Source of truth layout

- The only config is `glooit.config.ts` (or `.js`), loaded by executing it via `jiti` ([config-loader.ts#L9-L45](https://github.com/nikuscs/glooit/blob/94c357c97fc0464594bca47e22727b60d3db471d/src/core/config-loader.ts#L9-L45)).
- Source Markdown files can live anywhere, specified by `rules[].file`; `configDir` defaults to `.agents` and holds `manifest.json` and `backups/`.

### Target agents and paths

[agents/index.ts#L9-L82](https://github.com/nikuscs/glooit/blob/94c357c97fc0464594bca47e22727b60d3db471d/src/agents/index.ts#L9-L82):

| Agent | Rule File | skills | agents | commands | MCP |
| --- | --- | --- | --- | --- | --- |
| claude | `CLAUDE.md` | `.claude/skills` | `.claude/agents` | `.claude/commands` | `.mcp.json` |
| cursor | `.cursor/rules/{name}.mdc` (frontmatter) | `.cursor/skills` | `.cursor/agents` | `.cursor/commands` | `~/.cursor/mcp.json` |
| codex | `AGENTS.md` | `.codex/skills` | - | `.codex/prompts` | `.codex/config.toml` |
| opencode | `AGENTS.md` | `.claude/skills` | `.opencode/agent` | `.opencode/command` | `opencode.jsonc` |
| roocode | `.roo/rules/{name}.md` | - | - | - | `.roo/mcp.json` |
| factory | `AGENTS.md` | `.factory/skills` | `.factory/droids` | - | `.factory/settings.json` |
| generic | `{name}.md` | | | | `mcp.json` |

Only 7 targets are supported; Antigravity, DeepSeek Harness and WorkBuddy are not. Like AgentSync, the Codex skills path is `.codex/skills`. `rules[].to` specifies the output directory and can point to a subdirectory to generate nested Rule Files.

### Sync method

- **copy (default) or symlink**, set via `mode` per rule or globally.
- **transform:** when multiple source files are merged into one, each one's YAML frontmatter is stripped and they are joined with `---`, **without preserving source markers** ([distributor.ts#L245-L290](https://github.com/nikuscs/glooit/blob/94c357c97fc0464594bca47e22727b60d3db471d/src/agents/distributor.ts#L245-L290)). For Cursor it automatically adds `description` / `globs` / `alwaysApply` frontmatter (`writers/cursor.ts` L13-L19).
- **Content hooks / transforms:** built-in `compact` (collapses blank lines, merges lists, optionally removes filler words like "basically" and "really"), `addTimestamp`, `replaceEnv`, `replaceStructure` (injects the project directory tree) ([hooks/compact.ts](https://github.com/nikuscs/glooit/blob/94c357c97fc0464594bca47e22727b60d3db471d/src/hooks/compact.ts#L1-L40), run in sequence in `distributor.ts` L370-L385). Symlink mode cannot apply these hooks, and it also falls back to copy when merging is specified (distributor.ts L27-L34).
- **Agent hooks:** unified event names are mapped to Claude events (`PreToolUse` / `PostToolUse` / `Stop` / `UserPromptSubmit`) and Cursor events ([hooks-distributor.ts#L5-L35](https://github.com/nikuscs/glooit/blob/94c357c97fc0464594bca47e22727b60d3db471d/src/agents/hooks-distributor.ts#L5-L35)).
- skills / agents / commands directories: copied file by file (`.md` files go through hooks), or symlinked as a whole directory (distributor.ts L55-L130).

### Conflict handling

- Overwrites directly, with no per-file `.bak`; a whole snapshot backup is taken before `sync` (see below).
- `.agents/manifest.json` records `generatedFiles` / `generatedDirectories` / `generatedSymlinks`, and the next sync deletes old generated files that no longer appear in the config ([manifest.ts#L4-L40](https://github.com/nikuscs/glooit/blob/94c357c97fc0464594bca47e22727b60d3db471d/src/core/manifest.ts#L4-L40)).
- MCP is merged by writing `mcpServers[name]` per server name (`writers/cursor.ts` L30-L45).

### Validation (validate / check)

- **`glooit validate`** → `ConfigValidator.validate` ([validation.ts#L11-L84](https://github.com/nikuscs/glooit/blob/94c357c97fc0464594bca47e22727b60d3db471d/src/core/validation.ts#L11-L84)) only checks: whether `mode` is copy / symlink, whether rule source files exist, whether `targets` is non-empty, whether `to` starts with `./` or `/`, whether directory sync paths are directories, and the `configDir` format.
- `validateRule` at load time does type assertions ([types/index.ts#L227-L285](https://github.com/nikuscs/glooit/blob/94c357c97fc0464594bca47e22727b60d3db471d/src/types/index.ts#L227-L285)).
- **No drift / sync check**, and no validation of skill or agent frontmatter.

### Version / history

- **Snapshot-style history:** `sync` first calls `createBackup`, saving the **full content** of all generated targets as `.agents/backups/<ISO timestamp>.json` (`{timestamp, files:[{path, content}]}`), and prunes old snapshots per `backup.retention` ([backup.ts#L14-L45](https://github.com/nikuscs/glooit/blob/94c357c97fc0464594bca47e22727b60d3db471d/src/core/backup.ts#L14-L45)). This requires a `backup` block in the config: when the block is present, `enabled` defaults to true and `retention` to 10 ([config-loader.ts#L105-L108](https://github.com/nikuscs/glooit/blob/94c357c97fc0464594bca47e22727b60d3db471d/src/core/config-loader.ts#L105-L108)); with no `backup` at all, `createBackup` returns immediately and no backup is made (core/index.ts L96-L103). It is the only one of the 5 tools that keeps multiple versions of generated content, but it has no hashes and is not linked to sessions.

### Remaining template items

Session parsing / grading / statistics / cost: not applicable. Privacy: runs locally. Loading the config executes the user's TS code.

## Limitations (observed in source)

- Few target agents and a thin path table (e.g. opencode skills are written to `.claude/skills`).
- Merging multiple files keeps no source markers, so Rule Items in the output cannot be attributed back to source files.
- `compact`'s filler-word removal rewrites the meaning of instruction text.
- The config is executable TS, so external tools can hardly read it statically without running code.
