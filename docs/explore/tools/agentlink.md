# agentlink (martinmose/agentlink)

- Repository: https://github.com/martinmose/agentlink
- commit: `9950cbc80090b3943b0be112c5eb070fff763e3c` (2025-08-11, no updates since)
- stars: about 6 / language: Go (about 1.8k lines including tests) / license: MIT
- In one sentence: one real instruction file plus a set of symlink aliases (`AGENTS.md`, `GEMINI.md`, `.github/copilot-instructions.md`, etc.), configured in `.agentlink.yaml`. It handles only Rule Files, not MCP / skills / hooks. It does no evaluation and has one `check` command (checks link status, CI-friendly).

Link prefix: `https://github.com/martinmose/agentlink/blob/9950cbc80090b3943b0be112c5eb070fff763e3c/`

## Features

| Command | Purpose |
| --- | --- |
| `init` | Generates `.agentlink.yaml` (default `source: CLAUDE.md`, `links: [AGENTS.md]`) |
| `sync` | Creates or repairs symlinks; `--dry-run`, `--force` replaces wrong links or real files |
| **`check`** | Reports the status of each link, non-zero exit code when there are problems ([check.go#L12-L117](https://github.com/martinmose/agentlink/blob/9950cbc80090b3943b0be112c5eb070fff763e3c/internal/cli/check.go#L12-L117)) |
| `clean` | Deletes only managed symlinks that point to the source |
| `doctor` | Environment self-check: OS, symlink support, whether the binary is on PATH, config directory ([doctor.go](https://github.com/martinmose/agentlink/blob/9950cbc80090b3943b0be112c5eb070fff763e3c/internal/cli/doctor.go#L32-L90)) |

## Architecture and data flow

```
.agentlink.yaml (CWD) or ~/.config/agentlink/config.yaml (global, auto-created if missing)
  source: CLAUDE.md
  links: [AGENTS.md, GEMINI.md, ...]
        │ config.LoadConfig → Validate → ExpandPaths(~ and relative paths)
        ▼
symlink.Manager.CheckLink / FixLink  ──►  <link> -> <source>
```

Three modules: `internal/config`, `internal/symlink`, `internal/cli` (cobra).

## Core mechanisms

### Source of truth layout

- One real file chosen by the user serves as `source` (`CLAUDE.md`, `AGENTS.md` or any path); everything else is an alias. The config structure has only two fields, `Source` / `Links` ([config.go#L13-L53](https://github.com/martinmose/agentlink/blob/9950cbc80090b3943b0be112c5eb070fff763e3c/internal/config/config.go#L13-L53)).
- Project mode and global mode (`~/.config/...`) are mutually exclusive: if CWD has `.agentlink.yaml` it is used, otherwise the global config (`FindConfigPath`, config.go L96-L108).

### Target agents and paths

**No built-in agent path table**; everything is written by the user in `links`. Examples in the README and default template: `AGENTS.md` (Codex / OpenCode), `.github/copilot-instructions.md`, `.cursorrules`, `GEMINI.md`, `.agent/AGENTS.md` ([config.go#L110-L150](https://github.com/martinmose/agentlink/blob/9950cbc80090b3943b0be112c5eb070fff763e3c/internal/config/config.go#L110-L150)).

### Sync method

Symlinks only; no content is generated or transformed. Missing parent directories are created automatically (`CreateLink`, manager.go L137-L160).

### Conflict handling

`FixLink` ([manager.go#L178-L226](https://github.com/martinmose/agentlink/blob/9950cbc80090b3943b0be112c5eb070fff763e3c/internal/symlink/manager.go#L178-L226)):

- `Missing`: create
- `Broken`: delete and recreate
- `WrongTarget`: error without `--force`, recreate with it
- `NotSymlink` (a real file with the same name): error without `--force`; with `--force` it is **deleted outright via `os.RemoveAll`, with no backup**
- Refuses when the source itself is a symlink, unless `--force` (manager.go L62-L84)

### Validation (check)

- **`agentlink check`:** first `ValidateSource` (must exist and be a regular file), then `CheckLink` for each link: `Lstat` determines whether it exists and is a symlink, `Readlink` gets the target and compares it with the expected source, yielding 5 states `OK / Missing / WrongTarget / NotSymlink / Broken` ([manager.go#L9-L35](https://github.com/martinmose/agentlink/blob/9950cbc80090b3943b0be112c5eb070fff763e3c/internal/symlink/manager.go#L9-L35), [L86-L135](https://github.com/martinmose/agentlink/blob/9950cbc80090b3943b0be112c5eb070fff763e3c/internal/symlink/manager.go#L86-L135)). If any is not OK it returns an error and exits non-zero.
- Config validation only checks that `source` and `links` are non-empty (config.go L44-L53).
- No content comparison, because the symlink itself guarantees identical content.

### Version / history

None.

### Remaining template items

Input / session parsing / Skill / grading / baselines / statistics / cost: not applicable. Privacy: purely local.

## Limitations (observed in source)

- Handles only a single Rule File; no skills, subagents, MCP or hooks.
- No knowledge of agent paths; correctness depends entirely on user config.
- `--force` deletes real files without backup.
- Unmaintained since 2025-08.
