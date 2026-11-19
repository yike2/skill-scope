# cc-skill-usage (FlorianBruniaux/cc-skill-usage)

- Repository: <https://github.com/FlorianBruniaux/cc-skill-usage>
- commit: `01c801ecbc64be9f7a3d592447be790ab107b260` (HEAD, 2026-09-28); VERSION 0.3.0
- stars: 9 / language: Python 3 (single file, stdlib only) / license: MIT
- In one sentence: an 899-line single-file CLI that counts **only genuine skill invocations** from historical transcripts (Claude Code's `Skill` tool_use; for Codex, an event log written by a "loader" command, plus optional "inferred" reads), reported separately by evidence category. It makes no quality judgments.

All links below point to the commit above.

## Features

| Command | What it does |
|---|---|
| `cc-skill-usage` | Leaderboard: count, number of projects, first/last date per (host, skill, evidence) |
| `cc-skill-usage <skill>` | Single-skill detail: by project, by args, daily histogram |
| `--all recent N` | Most recent N invocations |
| `--since 7d/24h/2w/YYYY-MM-DD`, `--project NAME`, `--include-subagents`, `--host claude\|codex\|all` | Filters |
| `--include-inferred-codex` | Adds SKILL.md reads inferred from Codex sessions (`observed_load`) |
| `--show-context` | Shows the most recent user message before each invocation (≤200 characters) |
| `--json`, `--no-cache`, `--rebuild` | Machine-readable output, cache control |
| `cc-skill-usage load --skill X --path …/SKILL.md` | Loader for Codex: validates, prints SKILL.md verbatim, and appends an `instrumented_invocation` event |
| `.claude/skills/skill-usage-report` | Companion skill: requires "cross-checking with grep+jq whenever the numbers look suspicious" |

## Architecture and data flow

```
~/.claude/projects/**/*.jsonl ──parse_file()──► native_invocation events ─┐
~/.local/state/ai-agents/skill-usage/events.jsonl ──► instrumented_invocation ─┤──► apply_filters ──► leaderboard / detail / recent
~/.codex/sessions/**/*.jsonl ──parse_codex_file()──► observed_load (optional) ────┘
                 (mtime cache: ~/.cache/cc-skill-usage/index.json)
```

## Core mechanisms

### 1. Input
Reads only local transcripts and the local event log; no test cases.

### 2. Session / log parsing

**Claude Code** ([parse_file L239-L308](https://github.com/FlorianBruniaux/cc-skill-usage/blob/01c801ecbc64be9f7a3d592447be790ab107b260/cc-skill-usage#L239-L308))
- Path: `rglob("*.jsonl")` under `$CC_PROJECTS_DIR` (default `~/.claude/projects`), including `subagents/` subdirectories (any path containing `subagents` is marked as a subagent and filtered out by default) ([L216-L217](https://github.com/FlorianBruniaux/cc-skill-usage/blob/01c801ecbc64be9f7a3d592447be790ab107b260/cc-skill-usage#L216-L217)).
- Applies a **string pre-filter** before `json.loads`:
  - user lines (containing `"type":"user"`): skipped outright if they contain `"tool_result"` or are longer than 20000; otherwise parsed, recording the last user text (as context).
  - Other lines: parsed only if they contain `"name":"Skill"`.
- Fields read: `input.skill` and `input.args` from blocks in `message.content[]` with `type=="tool_use"` and `name=="Skill"`; the record's `timestamp` and `cwd` (basename used as project); the file path's stem as the session id; the first-level directory name under `~/.claude/projects/` as `repo_hint` (different worktrees of the same repository share a prefix, which helps `--project` matching) ([L189-L213](https://github.com/FlorianBruniaux/cc-skill-usage/blob/01c801ecbc64be9f7a3d592447be790ab107b260/cc-skill-usage#L189-L213)).
- mtime cache: if a file's mtime is unchanged, the previously extracted events are reused ([collect_claude_events L486-L513](https://github.com/FlorianBruniaux/cc-skill-usage/blob/01c801ecbc64be9f7a3d592447be790ab107b260/cc-skill-usage#L486-L513)).

**Codex inferred reads** ([parse_codex_file L372-L446](https://github.com/FlorianBruniaux/cc-skill-usage/blob/01c801ecbc64be9f7a3d592447be790ab107b260/cc-skill-usage#L372-L446))
- Path: `~/.codex/sessions/**/*.jsonl`; `id`/`session_id` taken from `session_meta.payload`; `subagent` or `thread_spawn` in `source`/`thread_source` marks a subagent.
- Looks only at records with `payload.type=="item_completed"`, `item.type=="CommandExecution"`, `item.status=="completed"`, `item.exit_code==0`, iterating over items in `item.parsed_cmd[]` with `type=="read"` and a `path` whose filename is `SKILL.md`; resolves them to absolute paths using `item.cwd`; they **must lie inside an allowed skill root**; then reads `name` from the frontmatter. Deduplicated by `(session_id, turn_id, path)`. Evidence category `observed_load`, not counted by default.

**Codex loader events** ([load_skill_command L155-L183](https://github.com/FlorianBruniaux/cc-skill-usage/blob/01c801ecbc64be9f7a3d592447be790ab107b260/cc-skill-usage#L155-L183), [read_instrumented_events L320-L362](https://github.com/FlorianBruniaux/cc-skill-usage/blob/01c801ecbc64be9f7a3d592447be790ab107b260/cc-skill-usage#L320-L362))
- The user (or AGENTS.md instructing Codex) uses `cc-skill-usage load` instead of a plain `cat SKILL.md`. It validates that the path is inside an allowed root, the filename is `SKILL.md`, and the frontmatter `name` is valid and matches the requested name (a final-segment match on `plugin:name` is allowed); it **writes the event first, then prints the full text**; a failure to write the event only warns and does not block.
- Event schema: `{schema:1, timestamp, host:"codex", session_id(argument or $CODEX_THREAD_ID/$CODEX_SESSION_ID), skill, declared_name, evidence:"instrumented_invocation", source_path_hash:"sha256:…", project: cwd basename, subagent}`; written with O_APPEND, 4096-byte limit per line, file mode 0600. On read it checks `schema==1`, `host=="codex"` and the skill-name regex; anything that fails is counted as malformed.

### 3. Skill trigger detection (the entirety of this tool's "grading")
Three evidence categories, **never silently merged**:

| evidence | Source | Decision rule | Counted as |
|---|---|---|---|
| `native_invocation` | Claude Code transcript | In an assistant record, `tool_use.name == "Skill"` and `input.skill` is non-empty | invocations (exact) |
| `instrumented_invocation` | Local event log | A validated complete read via the `load` command | invocations (exact) |
| `observed_load` | Codex session | A `CommandExecution` with exit code 0 whose `parsed_cmd` contains a `read` pointing at a `SKILL.md` inside an allowed root | observed_loads (inferred, must be explicitly enabled) |

`EXACT_EVIDENCE = {"native_invocation", "instrumented_invocation"}` ([L47](https://github.com/FlorianBruniaux/cc-skill-usage/blob/01c801ecbc64be9f7a3d592447be790ab107b260/cc-skill-usage#L47)); each leaderboard row shows three columns, `events`, `invocations` and `observed_loads` ([view_leaderboard L589-](https://github.com/FlorianBruniaux/cc-skill-usage/blob/01c801ecbc64be9f7a3d592447be790ab107b260/cc-skill-usage#L589)).

What exact counting means:
- **Text mentions do not count**: skill names appearing in assistant replies, file contents or casual user mentions are not counted. The README gives a measurement: in one project, a skill's name appeared verbatim 2330 times while there were 11 genuine invocations (a 212× gap), and it claims the counts were checked one by one against an independent grep+jq pipeline and matched ([README L46-L64](https://github.com/FlorianBruniaux/cc-skill-usage/blob/01c801ecbc64be9f7a3d592447be790ab107b260/README.md#L46-L64)).
- **"Attempts", not "successes"**: on the Claude side it does not check whether the corresponding `tool_result` reported an error; a Codex loader event only proves a "complete read", and the README states "A loader event records a validated read, not proof that the model followed the skill" ([README L280-L285](https://github.com/FlorianBruniaux/cc-skill-usage/blob/01c801ecbc64be9f7a3d592447be790ab107b260/README.md#L280-L285)).
- **Slash commands are not counted**: when the user types `/skill-name` directly, the transcript does not necessarily contain a `Skill` tool_use (it appears as a user message injected with `<command-name>`), which this tool does not recognize; the README lists this as a known limitation (L209-L217).
- Skills that are "installed but never invoked" are not reported (there is no inventory); only skills that appeared are listed.

### 4. Grading
Not applicable (counting only). No LLM, no rubric, no scores.

### 5. Baselines and version comparison
Not applicable. Two `--json` results can be compared across projects by hand (EXAMPLES.md), but there is no version dimension.

### 6. Repeated runs and statistics
Not applicable.

### 7. Cost / token accounting
Not applicable.

### 8. Rule files
Not applicable.

### 9. Privacy and data flow
No network calls. Writes locally: `~/.cache/cc-skill-usage/index.json` (cache), `~/.local/state/ai-agents/skill-usage/events.jsonl` (Codex events, containing only identifiers and metadata, no skill body or prompt). **Installs no hooks** (README L288-L289).

## Limitations (observed in source)
- On the Claude side only the `Skill` tool is recognized; slash-command invocations and reads of SKILL.md files are not counted.
- Does not distinguish successful from failed invocations.
- Exact Codex counts depend on the user changing how skills are loaded (via the `load` command); historical data can only be inferred; and Codex inference reads only `~/.codex/sessions`, not `archived_sessions`.
- `--show-context` takes the last user text that is ≤20KB and contains no tool_result, which may pick up an earlier message.
