# Session logs and skill invocation by agent

Research as of 2026-11-19, for reference when writing adapters. What you see on a real install when writing the adapter takes precedence.

| Agent | Session logs | How a skill invocation appears in the log | Source |
|---|---|---|---|
| Claude Code | `~/.claude/projects/<slug>/<uuid>.jsonl`; subagents under `<uuid>/subagents/` | `Skill` tool call; also `skill_listing` (skills offered in this session) and `instructions` (rule files loaded) records | Local logs |
| Codex CLI | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` | No dedicated tool; shows up as a shell read of SKILL.md | Official docs |
| Antigravity | `~/.gemini/antigravity/brain/<uuid>/.system_generated/logs/transcript.jsonl` | `read_file` of `.../skills/<name>/SKILL.md` | Local logs |
| DeepSeek Harness (`dsh`) | `$DSH_HOME/sessions/*/session.jsonl.zstd` | Unknown | Secondary sources |
| WorkBuddy / CodeBuddy | Possibly the same layout as Claude Code | Docs mention a Skill tool | Official docs |
| Gemini CLI | `~/.gemini/tmp/<project_hash>/chats/*.json` | `activate_skill` tool | Official docs |
| OpenCode | `~/.local/share/opencode/opencode.db` (SQLite) | `skill` tool | Official docs |

For the paths each agent loads rule files and skills from, see rulesync's path constants in [tools/rulesync.md](tools/rulesync.md).
