# Opaline CLI (formerly Rudel, obsessiondb/rudel → evrendom/opaline)

- Repository: <https://github.com/evrendom/opaline> (`obsessiondb/rudel` now redirects here)
- commit: `f0dcb43f4ab71f6fde684755874b7eb28f39de1b` (HEAD, 2026-11-09, opaline-cli 0.17.1), 528 commits, first commit 2026-02-16
- stars: 310 / language: TypeScript (built with Bun, runs on Node ≥20) / license: MIT
- In one sentence: an **uploader** CLI. It discovers local Claude Code / Codex sessions, lets you toggle them per repository, and after installing hooks uploads the **full transcript** (including subagents and tool output) plus repository context evidence (CLAUDE.md/AGENTS.md, SKILL.md contents, Git status and patches) to the hosted opaline.so. **The analysis app opaline.so is closed source**; the CLI itself only discovers, filters, uploads and counts, with no grading logic.

All links below are permalinks to the HEAD above (historical files cite the corresponding commit).

## Deployment

- Only the CLI is open source. The analysis server is the closed-source hosted `https://opaline.so`, with no self-hosting instructions (README, [docs/usage.md](https://github.com/evrendom/opaline/blob/f0dcb43f4ab71f6fde684755874b7eb28f39de1b/docs/usage.md)).
- The server code (`apps/api`, `apps/web`, `docker-compose.yml`, `docs/self-hosting.md`, etc.) was removed from the repository on 2026-08-25 in `e55f55e` ("feat!: rebrand CLI to @opalinehq/cli with rudel alias"). The repository now contains only `apps/cli` and `packages/{opaline,rudel-alias}`.
- The CLI can still point to another server via `OPALINE_API_BASE` (`RUDEL_API_BASE` also accepted) (usage.md L153).

## Features

| Command | What it does |
|---|---|
| `npx opaline@latest` / `upload` | Repository picker (groups sessions by repository, shows local/uploaded counts); after confirmation, logs in, installs hooks and uploads past sessions |
| `--code <code>` / `login` / `logout` / `whoami` / `set-org` | Browser device-flow pairing, identity and workspace |
| `doctor` | Read-only diagnostics: auth, API, config, version, hooks |
| `update` | After confirmation, updates the global install and the hook runtime kept in `~/.rudel/runtime` |
| `import <session|path> [--analysis id]` | Historical import; attaches a conversation to an Opaline analysis, and hooks keep uploading later turns for 7 days |
| `upload --retry` | Retries failed/pending uploads |
| `sql "<SELECT>" --out` | Runs a read-only query against the server's Opaline views and exports all rows |
| `pull --repo --from --to` | Copies a time range of sessions plus runs/calls/git/CI/setup rows from the server to local `~/.cache/opaline/pulls/` |
| `count --pattern <regex>` | Regex count over the most recent local pull, outputs `{count, sessions, definition, examples[3], scanned}` |
| `hooks claude session-start/session-end`, `hooks codex turn-complete` | Hook entry points (internal) |

([docs/usage.md L91-L104](https://github.com/evrendom/opaline/blob/f0dcb43f4ab71f6fde684755874b7eb28f39de1b/docs/usage.md#L91-L104))

## Architecture and data flow

```
Claude Code: ~/.claude/projects/<encoded>/<id>.jsonl (+ <id>/subagents/*.jsonl)
Codex:       $CODEX_HOME/sessions/**/rollout-*.jsonl (attributed to repo by session_meta.cwd)
   │
   ├─ SessionStart hook / Codex notify → live-follow background process: each new complete line → per-line redaction → streamed
   ├─ SessionEnd hook / Codex turn-complete → uploadSession(): whole transcript redacted (filter v7) → R2 chunks or legacy ingest
   ├─ session-evidence: extractObservedSkills() → decides which SKILL.md contents get upload priority
   │      + CLAUDE.md/AGENTS.md contents, agent/MCP config, Git status and safe patches, sha256 of skill resources
   └─ session-inventory (≤ every 30 min): per-session id/agent/line count/byte count/times, no content
                    ▼
            opaline.so (closed source: storage, analysis, MCP, dashboards)
```

## Core mechanisms

### 1. Input
Real local sessions. Repository attribution: Claude uses `cwd` in the JSONL, Codex uses `session_meta.payload.cwd`; Git worktrees are merged into the same repository ([codex/index.ts L55-L205](https://github.com/evrendom/opaline/blob/f0dcb43f4ab71f6fde684755874b7eb28f39de1b/apps/cli/src/internal/agent-adapters/adapters/codex/index.ts#L55-L205), [claude-code/index.ts L160-L270](https://github.com/evrendom/opaline/blob/f0dcb43f4ab71f6fde684755874b7eb28f39de1b/apps/cli/src/internal/agent-adapters/adapters/claude-code/index.ts#L160-L270)).

### 2. Session / log parsing
The CLI does no semantic parsing; the whole JSONL is uploaded as is (after redaction and image slimming). Locally it only parses: Claude `cwd`/session id/subagent files; Codex `session_meta`; Claude `CLAUDE_CONFIG_DIR/projects` and Codex `CODEX_HOME/sessions` as the directories live follow is allowed to read ([live-session-paths.ts L23-L25](https://github.com/evrendom/opaline/blob/f0dcb43f4ab71f6fde684755874b7eb28f39de1b/apps/cli/src/lib/live-session-paths.ts#L23-L25)). Codex scans only `sessions/`, not `archived_sessions/`.

### 3. Skill usage detection (the only skill logic in the CLI)
[transcript-skills.ts L1-L106](https://github.com/evrendom/opaline/blob/f0dcb43f4ab71f6fde684755874b7eb28f39de1b/apps/cli/src/lib/transcript-skills.ts#L1-L106): `extractObservedSkills(session)` takes the union over the main transcript and all subagent transcripts:
- First detects the format: any record with `type ∈ {session_meta, turn_context, response_item, event_msg}` → Codex.
- **Recursively walks every nested object in each record** (L49-L95); for each object with a `name`:
  - The tool name is the last segment of `name` split on `.` or `__`, lowercased; if it equals `skill`, take `input.skill` (L69-L74). This covers both the Claude `Skill` tool and MCP-style `xxx__skill`.
  - If `input.file_path` or `input.path` matches `/(?:^|\/)([^/]+)\/SKILL(?:\.md)?$/i` → take the parent directory name (L75-L76, L97-L102). In other words, **reading a SKILL.md file also counts**.
  - Codex: `function_call` `arguments` are JSON-parsed first; when the tool name is `exec_command`/`shell`/`shell_command` and the command starts with `cat|head|tail|less|more|sed|awk|rg|grep|bat` (or follows `; & |`), the command is split into words on separators and each word is matched against the SKILL.md path (L77-L92).
- It does not look at assistant text, does not check whether the skill is installed, does not distinguish success from failure, and does not recognize slash commands (`<command-name>`).
- **Purpose**: only to set priority when uploading repository evidence ([session-evidence.ts L266](https://github.com/evrendom/opaline/blob/f0dcb43f4ab71f6fde684755874b7eb28f39de1b/apps/cli/src/lib/session-evidence.ts#L266)). In [capture-policy.ts L85-L115](https://github.com/evrendom/opaline/blob/f0dcb43f4ab71f6fde684755874b7eb28f39de1b/apps/cli/src/internal/local-context-source/capture-policy.ts#L85-L115), top-level repository instruction files get priority −1, nested instructions and Claude rule files 0, **SKILL.md of observed skills 1**, MCP config 2, agent definitions 3, other skill definitions 4; user-level directories have their own ranking (observed skill definitions 3, others 4, observed skill resources 6, others 7, [L200-L225](https://github.com/evrendom/opaline/blob/f0dcb43f4ab71f6fde684755874b7eb28f39de1b/apps/cli/src/internal/local-context-source/capture-policy.ts#L200-L225)). Each capture is capped at 256 blobs and 2 MiB of content; for skill resource files only path, size, SHA-256 and Git origin are sent.

### 4. Grading
**Not applicable in the CLI**. No rubric, no LLM, no scoring. All analysis (session browsing, token/cost, skill usage stats, etc.) happens in the closed-source opaline.so and is known only from documentation (README "How it works", data-handling.md); **its algorithms cannot be verified**.

The CLI "counts" in only three places, defined as follows:
1. **Session counts in the picker**: per repository, the number of local session files and the number already uploaded to the server (a repository discovered multiple times is counted once).
2. **Session inventory** ([session-inventory.ts L86-L113, L379-L401](https://github.com/evrendom/opaline/blob/f0dcb43f4ab71f6fde684755874b7eb28f39de1b/apps/cli/src/lib/session-inventory.ts#L86-L113)): for each session that "would be uploaded under current settings", it records the main transcript's **non-empty line count and byte count**, the subagent transcripts' total lines, total bytes and file count, start time and last-modified time, and sends them with session id, agent and CLI version to the server, so answers can state "which sessions are not covered". Cached by file change (`session-inventory-cache.json`), at most once every 30 minutes, disabled with `OPALINE_SESSION_INVENTORY=0`.
3. **The `count` command** ([count.ts L106-L170](https://github.com/evrendom/opaline/blob/f0dcb43f4ab71f6fde684755874b7eb28f39de1b/apps/cli/src/lib/count.ts#L106-L170)): regex matching on the local JSONL fetched by `pull`. `--in` selects output (tool results)/command (tool call input)/prompt ("genuine prompts": `user_prompt` excluding `subtype=="delegation"`)/agent_message/any; `--unit` selects call/prompt/message/session; `--level` agent/inner (commands inside Codex scripts)/all; `--stream` all/main. The output carries an auto-generated `definition` text (e.g. "sessions with a genuine prompt whose text matches …"), and users are asked to post the definition together with the number. The data structure (`kind`, `subtype`, etc.) is produced by the server-side pull, which shows the server has normalized sessions into tables such as runs/calls/prompts.

### 5. Baselines and version comparison
Not applicable in the CLI. Notably, the CLI uploads CLAUDE.md/AGENTS.md contents and SKILL.md contents with their SHA-256, so the server has the data needed to distinguish file versions by content hash. The deleted open-source server schema already had two tables, `skill_uses` ("Versioned session skill uses bound to an exact completed extraction receipt") and `skill_version_contents` ("SKILL.md bodies keyed by workspace, exact skill name, SHA-256, and uploader") ([e2e5884 snapshot.json L508-L627](https://github.com/evrendom/opaline/blob/e2e5884e69f56bc64e375723487e29d7993a4ba8/packages/ch-schema/chx/meta/snapshot.json#L508-L627)). [Inferred] The closed-source server very likely keeps the ability to count usage per skill version, but whether it does before/after comparison cannot be confirmed from the open-source part.

### 6. Repeated runs and statistics
Not applicable.

### 7. Cost / token accounting
The CLI does not compute this; the README says the app lets you "see model usage, tokens, and API costs in context" (server side, closed source).

### 8. Rule files
The CLI uploads the contents of the repository's `CLAUDE.md`/`AGENTS.md` (including nested and local variants), `.claude/CLAUDE.md`, Claude rule files, `.claude/agents/*.md`, Codex `rules/` (exec-policy), etc. ([data-handling.md "Repository context evidence"](https://github.com/evrendom/opaline/blob/f0dcb43f4ab71f6fde684755874b7eb28f39de1b/docs/data-handling.md)). It makes no per-rule judgments.

### 9. Privacy and data flow (the core of this tool)
**What is uploaded** ([README L59-L67](https://github.com/evrendom/opaline/blob/f0dcb43f4ab71f6fde684755874b7eb28f39de1b/README.md#L59-L67), [data-handling.md](https://github.com/evrendom/opaline/blob/f0dcb43f4ab71f6fde684755874b7eb28f39de1b/docs/data-handling.md)):
- **Full transcripts**: prompts, model replies, source code, tool output, file contents, command output, URLs, repository metadata, subagent transcripts. For running sessions each new line is streamed within seconds (live updates), and the whole session is uploaded again when it ends.
- **Repository context evidence**: Git status and "safe patches", instruction and skill file contents, package config, filtered transcript revisions; credential-like paths (including `.env.example`) are excluded.
- **Session inventory**: metadata (see §4).
- **Usage analytics (PostHog)**: first run, login result, auto-upload setup result (version, OS, number of selected repositories, number of local sessions, per-repository session counts anonymized); disabled with `DO_NOT_TRACK=1`.
- **Redaction**: filter v7, applied once on the client and once on the server; covers Anthropic/OpenAI/AWS/GitHub/GitLab/npm/Google/SendGrid/Slack/Stripe/Twilio keys, JWTs, PEM private keys, connection-string passwords, Authorization headers; matches inside JSON-escaped text; aborts the upload if the redaction ratio is too high. The docs state outright "Filtering is best-effort and cannot guarantee that every sensitive value is removed".

**Installed hooks**:
- Claude Code: written to the **global** `~/.claude/settings.json` ([settings.ts L95-L99](https://github.com/evrendom/opaline/blob/f0dcb43f4ab71f6fde684755874b7eb28f39de1b/apps/cli/src/internal/agent-adapters/adapters/claude-code/settings.ts#L95-L99)), events `SessionStart` (`async: true`, registers live follow) and `SessionEnd` (`async: true`, `timeout: 60` seconds, upload + evidence capture); the command is the CLI path kept in `~/.rudel/runtime` + `hooks claude session-start|session-end` ([L18-L29](https://github.com/evrendom/opaline/blob/f0dcb43f4ab71f6fde684755874b7eb28f39de1b/apps/cli/src/internal/agent-adapters/adapters/claude-code/settings.ts#L18-L29), [L210-L222](https://github.com/evrendom/opaline/blob/f0dcb43f4ab71f6fde684755874b7eb28f39de1b/apps/cli/src/internal/agent-adapters/adapters/claude-code/settings.ts#L210-L222)). Hooks installed in project-level settings by older versions are migrated away ([auto-upload-hooks.ts L8-L58](https://github.com/evrendom/opaline/blob/f0dcb43f4ab71f6fde684755874b7eb28f39de1b/apps/cli/src/lib/auto-upload-hooks.ts#L8-L58)), with full rollback on failure. The hook itself decides whether to upload based on the per-repository toggle.
- Codex: rewrites `notify` in `~/.codex/config.toml` to `<cli> hooks codex turn-complete --previous-notify <original command JSON>`, chaining and preserving the existing notifier (the Computer Use notify stays outermost) ([codex/config.ts L15-L37, L118-L120](https://github.com/evrendom/opaline/blob/f0dcb43f4ab71f6fde684755874b7eb28f39de1b/apps/cli/src/internal/agent-adapters/adapters/codex/config.ts#L15-L37)).

## Limitations (observed in source)
- The CLI does no grading at all; all analysis lives in the closed-source server and cannot be audited.
- Skill detection treats "reading SKILL.md" as usage; Codex matches paths by splitting shell commands into words, so a lookup like `grep foo skills/x/SKILL.md` may also count as usage.
- Codex reads only `sessions/`; archived sessions are not covered.
- All raw text leaves the machine, with redaction relying on pattern matching.
