# AgentSync (dallay/agentsync)

- Repository: https://github.com/dallay/agentsync
- commit: `4ea5a2d340fc3356ddb8c0377cd2007f33a6e107` (2026-11-18)
- stars: about 77 / language: Rust (plus an npm wrapper) / license: MIT
- In one sentence: uses `.agents/` (or `source_dir`) as the single source and, per the targets declared in `agentsync.toml`, **symlinks** `AGENTS.md`, skills and commands into each agent's conventional locations, while also generating MCP config, managing `.gitignore`, and shipping a skill installer and a plugin system. It does no evaluation, but has two check commands: `status` (drift check) and `doctor` (health diagnostics).

Link prefix: `https://github.com/dallay/agentsync/blob/4ea5a2d340fc3356ddb8c0377cd2007f33a6e107/`

## Features

| Command | Purpose |
| --- | --- |
| `init` | Generates `agentsync.toml` (built-in template in [init.rs#L152-L275](https://github.com/dallay/agentsync/blob/4ea5a2d340fc3356ddb8c0377cd2007f33a6e107/src/init.rs#L152-L275)); can migrate existing files |
| `apply` | Creates or refreshes symlinks per config, generates MCP config, updates `.gitignore`; options include `--dry-run`, `--offline`, MCP journal rebase |
| **`status`** | Checks that each managed symlink exists, has the right type and points to the expected source; exits with an error when there are problems (`--json`) |
| **`doctor`** | Diagnoses config, source files, target conflicts, MCP, gitignore, unmanaged skills |
| `inspect` | Prints the resolved managed-config projection for a given assistant |
| `clean` / `revert` | Deletes symlinks / deletes and restores from `.bak` |
| `skill install/update/uninstall/suggest/list` | Installs skills from skills.sh or a custom provider, writes `registry.json` |
| Registry validation subcommand under `skill` | Validates the curated registry manifest and regenerates the lockfile |
| `plugin` | Handles "repo-owned, vendor-neutral" plugins: reads the manifest, validates, copies skills, returns MCP declarations ([plugins.rs#L1-L5](https://github.com/dallay/agentsync/blob/4ea5a2d340fc3356ddb8c0377cd2007f33a6e107/src/plugins.rs#L1-L5)) |

Commands are defined in [main.rs#L112-L246](https://github.com/dallay/agentsync/blob/4ea5a2d340fc3356ddb8c0377cd2007f33a6e107/src/main.rs#L112-L246).

## Architecture and data flow

```
agentsync.toml (.agents/agentsync.toml takes precedence)
  [agents.<id>.targets.<name>] source / destination / type
        │ parsed by config.rs
        ▼
linker/ (discovery → enumerate → apply → symlinks) ──► target path = symlink → .agents/...
mcp.rs + mcp_ownership.rs ──► .mcp.json / .codex/config.toml / ... (generation + ownership journal)
gitignore.rs ──► managed marker block
status.rs / inspect.rs ──► derive the "expected state" from the same config and compare with the filesystem
```

## Core mechanisms

### Source of truth layout

- Config file: `agentsync.toml` (can also live at `.agents/agentsync.toml`). `source_dir` defaults to the config file's directory ([config.rs#L21-L36](https://github.com/dallay/agentsync/blob/4ea5a2d340fc3356ddb8c0377cd2007f33a6e107/src/config.rs#L21-L36)).
- Typical source files: `.agents/AGENTS.md`, `.agents/skills/`, `.agents/commands/`.
- **Entirely config-driven**: which files each agent gets and where they go are declared explicitly in `[agents.X.targets.Y]`; the only built-ins are the default template and a "conventional file name" table.

### Target agents and paths

Conventional Rule File names ([agent_ids.rs#L98-L116](https://github.com/dallay/agentsync/blob/4ea5a2d340fc3356ddb8c0377cd2007f33a6e107/src/agent_ids.rs#L98-L116)): claude→`CLAUDE.md`, copilot→`.github/copilot-instructions.md`, codex→`AGENTS.md`, gemini→`GEMINI.md`, cursor→`.cursor/rules/agentsync.mdc`, windsurf→`.windsurfrules`, opencode/zcode/minimax→`AGENTS.md`, crush→`CRUSH.md`, warp→`WARP.md`, amp→`AMPCODE.md`.

Targets in the default template relevant to us (init.rs L204-L275):

| Agent | instructions | skills | commands |
| --- | --- | --- | --- |
| Claude Code | `AGENTS.md` → `CLAUDE.md` (symlink) | `skills` → `.claude/skills` (whole-directory symlink) | `.claude/commands` (symlink-contents) |
| Codex | No instructions target (uses the root `AGENTS.md` directly) | `skills` → **`.codex/skills`** | - |
| Gemini | → `GEMINI.md` | → `.gemini/skills` | `.gemini/commands` |
| Antigravity | The gitignore table lists `.agent/rules/`, `.agent/skills` ([agent_ids.rs#L155](https://github.com/dallay/agentsync/blob/4ea5a2d340fc3356ddb8c0377cd2007f33a6e107/src/agent_ids.rs#L155)) | | |

**Divergence:** AgentSync puts Codex skills in `.codex/skills` by default, while Ruler and rulesync use `.agents/skills`; for Antigravity it uses `.agent/` (singular), while rulesync uses `.agents/`. This shows tools disagree on paths for the same agent, and the paths also change across agent versions. DeepSeek Harness and WorkBuddy are not in the table.

### Sync method

Four `SyncType`s ([config.rs#L138-L152](https://github.com/dallay/agentsync/blob/4ea5a2d340fc3356ddb8c0377cd2007f33a6e107/src/config.rs#L138-L152)):

- `symlink`: a single symlink (file or whole directory)
- `symlink-contents`: one symlink for each item in the source directory
- `nested-glob`: recursive glob match, creating a symlink for each match using the `{relative_path}/{file_name}` template (suits multiple `AGENTS.md` files in a monorepo)
- `module-map`: maps centrally maintained source files into specific module directories, using the agent's conventional file name

The exception is **`compress_agents_md = true`**: it generates a compressed `AGENTS.compact.md` (collapses blank lines, strips trailing whitespace, leaves fenced blocks untouched) and points the symlink at it instead ([apply.rs#L526-L560](https://github.com/dallay/agentsync/blob/4ea5a2d340fc3356ddb8c0377cd2007f33a6e107/src/linker/apply.rs#L526-L560), [linker/mod.rs#L36](https://github.com/dallay/agentsync/blob/4ea5a2d340fc3356ddb8c0377cd2007f33a6e107/src/linker/mod.rs#L36)). In this case the content the agent reads differs byte-wise from the source file.

- MCP: generates each agent's config from `[mcp_servers]` (merge or overwrite).
- Hooks / Subagents: no dedicated support; users can only configure them with generic symlink targets.
- Skills: whole-directory symlink; `skill install` writes `registry.json`; the plugin lock records `content_sha256` ([plugins.rs#L110-L160](https://github.com/dallay/agentsync/blob/4ea5a2d340fc3356ddb8c0377cd2007f33a6e107/src/plugins.rs#L110-L160)).

### Conflict handling

- When a real file already exists at the target, it is renamed to `.bak` before creating the symlink ([symlinks.rs#L60-L75](https://github.com/dallay/agentsync/blob/4ea5a2d340fc3356ddb8c0377cd2007f33a6e107/src/linker/symlinks.rs#L60-L75), [L170-L190](https://github.com/dallay/agentsync/blob/4ea5a2d340fc3356ddb8c0377cd2007f33a6e107/src/linker/symlinks.rs#L170-L190)) and restored on `revert`.
- MCP ownership journal: under the data directory (overridable with `AGENTSYNC_DATA_DIR`), in a subdirectory per `sha256(project_root)`, it stores `ownership.json`. Each config file records `original_content`, `pre_write_sha256` and `applied_sha256`. On the next apply, if the current hash matches neither (the user edited it by hand), it refuses to write unless a rebase is explicitly requested ([mcp_ownership.rs#L15-L30](https://github.com/dallay/agentsync/blob/4ea5a2d340fc3356ddb8c0377cd2007f33a6e107/src/mcp_ownership.rs#L15-L30), [L205-L250](https://github.com/dallay/agentsync/blob/4ea5a2d340fc3356ddb8c0377cd2007f33a6e107/src/mcp_ownership.rs#L205-L250)).
- `doctor` uses `validate_destinations` to find conflicts where multiple targets write the same destination.

### Validation / check (key point)

1. **`status`: drift check.** Derives each managed entry's expected symlink target from config and compares it with the actual filesystem state; problem types include `MissingDestination`, `InvalidDestinationType`, `MissingExpectedChild`, `ChildNotSymlink`, `IncorrectLinkTarget`, `MissingExpectedSource` ([status.rs#L32-L47](https://github.com/dallay/agentsync/blob/4ea5a2d340fc3356ddb8c0377cd2007f33a6e107/src/status.rs#L32-L47)). When there are problems it returns `Err("status found N problem(s)")` and the process exits non-zero, so it can go into CI ([commands/status.rs#L20-L62](https://github.com/dallay/agentsync/blob/4ea5a2d340fc3356ddb8c0377cd2007f33a6e107/src/commands/status.rs#L20-L62)). Because sync relies on symlinks, "is the content consistent" is equivalent to "are the links correct", so no content comparison is needed.
2. **`doctor`:** checks in turn the source directory, whether each target's source exists, destination conflicts, whether MCP server commands are on PATH, the gitignore managed block, and unmanaged Claude skills ([doctor.rs#L19-L322](https://github.com/dallay/agentsync/blob/4ea5a2d340fc3356ddb8c0377cd2007f33a6e107/src/commands/doctor.rs#L19-L322)). Note that it **always returns `Ok(())`**, only printing the number of problems and never exiting non-zero (L267-L322), so it is not suitable as a CI gate.
3. **Skill manifest validation:** parses `SKILL.md` frontmatter; `name` must follow the naming rules and `version` must be valid semver ([skills/manifest.rs#L27-L60](https://github.com/dallay/agentsync/blob/4ea5a2d340fc3356ddb8c0377cd2007f33a6e107/src/skills/manifest.rs#L27-L60)). The plugin lock validates the `content_sha256` format and its consistency with provenance (plugins.rs L212-L214).

### Version / history

No version history of rule or skill files is recorded. Only three things touch on versions: the hashes in the MCP ownership journal (for detecting manual edits), the `content_sha256` and Git SHA in the plugin / skill lock, and the skill `version` in `registry.json`.

### Remaining template items

Session parsing / grading / statistics / cost: not applicable. Privacy: network access when installing skills / plugins; everything else is local.

## Limitations (observed in source)

- Relies on symlinks: Windows requires permissions; some agents or IDEs handle symlinks poorly.
- The default path table is thin and most of it must be configured by the user; the Codex skills path is inconsistent with other tools.
- `doctor` does not return a failure exit code.
