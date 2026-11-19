# Anthropic session-report plugin

- Repository: <https://github.com/anthropics/claude-plugins-official/tree/df9699a55c56707e9948a32951ea356638ea8519/plugins/session-report> (`anthropics/claude-plugins-official`, about 47.7k★)
- commit: `df9699a55c56707e9948a32951ea356638ea8519`, 2026-11-19 (shallow clone HEAD)
- Language: single-file Node.js ESM script (`analyze-sessions.mjs`, 875 lines, uses only `fs/os/path/readline`) + HTML template + SKILL.md
- license: Apache-2.0 (`LICENSE` in the plugin directory)
- In one sentence: a Skill that runs a local script to scan `~/.claude/projects/**/*.jsonl` and tally tokens, cache hits and duration by project, subagent type, skill and prompt; Claude then fills the JSON into an HTML template and writes 3–5 "findings".

> Permalink prefix: `SR = https://github.com/anthropics/claude-plugins-official/blob/df9699a55c56707e9948a32951ea356638ea8519/plugins/session-report/skills/session-report`

## Features

| Feature | Entry point | What it does |
|---|---|---|
| `/session-report` skill | [SR/SKILL.md](https://github.com/anthropics/claude-plugins-official/blob/df9699a55c56707e9948a32951ea356638ea8519/plugins/session-report/skills/session-report/SKILL.md) | Runs the script (default `--since 7d`), copies the template into the current directory, fills in data and commentary, reports the file path |
| Text report | `node analyze-sessions.mjs` | Prints OVERALL, cache breaks, most expensive prompts, etc. to the terminal |
| JSON report | `--json` | `overall / by_project / by_subagent_type / by_skill / cache_breaks / top_prompts / by_day` |
| Time window | `--since 7d|24h|<ISO>` | Drops entries with timestamps earlier than the window |
| Other options | `--dir` (default `~/.claude/projects`), `--top N` (15), `--cache-break` (100000) | |
| HTML template | `template.html` | Sorting, expanding, character bar charts; the two slots `<!-- AGENT: anomalies -->` and `<!-- AGENT: optimizations -->` are filled in by Claude |

CLI definition: [SR/analyze-sessions.mjs#L38-L61](https://github.com/anthropics/claude-plugins-official/blob/df9699a55c56707e9948a32951ea356638ea8519/plugins/session-report/skills/session-report/analyze-sessions.mjs#L38-L61).

## Architecture and data flow

```
~/.claude/projects/<project>/<sessionId>.jsonl                 (main)
~/.claude/projects/<project>/<sessionId>/subagents/agent-*.jsonl (+ .meta.json)
~/.claude/projects/<project>/<sessionId>/workflows/...           (treated as subagent "workflow")
        │ walk() + classifyFile()
        ▼
 Ordering: main before subagent; subagents by file birthtime ascending
        │ processFile() streaming line-by-line parse
        ├─ user entry  → handleUser(): human message count / prompt start / slash command→skill
        ├─ assistant entry → recognize Skill/Agent/Task tool_use; buffer usage deduped by requestId
        └─ commit at end of file → overall / project / subagentType / skill / prompt buckets
        ▼
 summarize() → printJson()/printText()
        ▼
 Claude: puts the JSON into template.html's <script id="report-data">, writes anomalies/optimizations
```

Main function and ordering: [SR/analyze-sessions.mjs#L535-L598](https://github.com/anthropics/claude-plugins-official/blob/df9699a55c56707e9948a32951ea356638ea8519/plugins/session-report/skills/session-report/analyze-sessions.mjs#L535-L598).

## Core mechanisms

### 1. Input

Real local Sessions: Claude Code JSONL transcripts (main session, subagents, workflows). The subagent type comes from `agentType` in the same-named `.meta.json`; failing that, from the label in the filename `agent-a<label>-<hex>`; failing that, by looking up `subagent_type` in the parent session's `Agent/Task` call; and finally falls back to `fork` ([SR/analyze-sessions.mjs#L111-L156](https://github.com/anthropics/claude-plugins-official/blob/df9699a55c56707e9948a32951ea356638ea8519/plugins/session-report/skills/session-report/analyze-sessions.mjs#L111-L156), [#L560-L570](https://github.com/anthropics/claude-plugins-official/blob/df9699a55c56707e9948a32951ea356638ea8519/plugins/session-report/skills/session-report/analyze-sessions.mjs#L560-L570)).

### 2. Session / log parsing (Claude Code only)

The file header comment records the empirically discovered JSONL structure ([SR/analyze-sessions.mjs#L14-L28](https://github.com/anthropics/claude-plugins-official/blob/df9699a55c56707e9948a32951ea356638ea8519/plugins/session-report/skills/session-report/analyze-sessions.mjs#L14-L28)), which is useful for anyone writing a parser:

> One API response is split into MULTIPLE `type:"assistant"` entries (one per content block). They share the same `requestId` / `message.id`, and only the LAST one carries the final `output_tokens`. We dedupe by requestId and keep the max output_tokens to avoid 3-10x overcounting.

> Resumed sessions can re-serialize prior entries into a new file; we dedupe globally by entry `uuid` so replayed history isn't double-counted.

Fields read:

| Field | Purpose | Location |
|---|---|---|
| `uuid` | Global dedup (resumed sessions, fork subagents replaying parent entries) | L226-L230 |
| `timestamp` | `--since` filtering; wall clock; active time (accumulated only when the gap between adjacent entries is <5 minutes) | L232-L245 |
| `type: user` + `toolUseResult.agentId` + `message.content[0].tool_use_id` | Links a subagent's agentId to the parent session's Agent call (type and prompt attribution) | L247-L265 |
| `isMeta`, `isCompactSummary`, `isSidechain` | Exclude non-human messages | L427, L465 |
| `message.content` (string or first text block) | Human prompt text, slash commands | L428-L462 |
| `type: assistant` + `message.content[].tool_use` | `Skill` (`input.skill`), `Agent`/`Task` (`input.subagent_type`) | L280-L302 |
| `message.usage.{input_tokens, cache_creation_input_tokens, cache_read_input_tokens, output_tokens}` | Token accounting | L86-L92, L303-L321 |
| `requestId` / `message.id` (starting with `msg_0` and longer than 10) | API call dedup key, falling back to `file path:uuid` | L304-L309 |

What counts as a "human message": not `isMeta/isCompactSummary`; the first content block is not `tool_result`; does not start with `<task-notification`, `<scheduled-wakeup` or `<background-task` (these automatic continuations are folded into the previous prompt); does not start with `[Request interrupted`; and counted only in main files and outside sidechains ([SR/analyze-sessions.mjs#L420-L480](https://github.com/anthropics/claude-plugins-official/blob/df9699a55c56707e9948a32951ea356638ea8519/plugins/session-report/skills/session-report/analyze-sessions.mjs#L420-L480)).

### 3. Skill trigger detection and usage attribution (the core "decision" of this tool)

This tool makes no right/wrong judgments at all; its only "decision" is **which skill a given API call's tokens are charged to**. Walking through the code step by step:

**(a) Counting: two signals**

1. The model invokes a skill: in an assistant entry, `tool_use.name === 'Skill' && input.skill` → `bumpSkill(overall|project|subagent, name)`, and set `currentSkill = name` ([SR/analyze-sessions.mjs#L284-L293](https://github.com/anthropics/claude-plugins-official/blob/df9699a55c56707e9948a32951ea356638ea8519/plugins/session-report/skills/session-report/analyze-sessions.mjs#L284-L293)).
2. The user types a slash command: the human message text matches `/<command-(?:name|message)>\/?([^<]+)<\/command-/` → count it and set `currentSkill` ([SR/analyze-sessions.mjs#L451-L457](https://github.com/anthropics/claude-plugins-official/blob/df9699a55c56707e9948a32951ea356638ea8519/plugins/session-report/skills/session-report/analyze-sessions.mjs#L451-L457)).

Notes:
- Does not look at `Read`s of SKILL.md paths and does not check whether the tool_result reported an error. It counts **attempts**.
- The slash regex matches **all** slash commands, including built-ins like `/clear`, `/model` and `/compact`; they all show up in `skill_invocations` and `by_skill`.
- An ordinary human message calls `setSkill(null)` to reset attribution (L458-L460); `tool_result`, meta and automatic continuation messages do not reset it.

**(b) Attribution: the "current skill" state machine**

```
currentSkill = null                         # per file; also null at the start of a subagent file
for entry in file:
    if user:
        if human message contains <command-name>/X  → currentSkill = X
        elif ordinary human message                 → currentSkill = null
        # tool_result / isMeta / continuation → unchanged
    if assistant:
        if content contains Skill(tool_use, skill=X) → currentSkill = X   # before recording usage
        fileApiCalls[requestId] = {usage, skill: currentSkill, prompt: currentPrompt}
                                  # for the same requestId, keep the entry with the largest output_tokens
commit at end of file:
    for each (key, call) not in seenRequestIds:
        addUsage(overall, project, subagentType?, perSkill[call.skill]?)
```

([SR/analyze-sessions.mjs#L204](https://github.com/anthropics/claude-plugins-official/blob/df9699a55c56707e9948a32951ea356638ea8519/plugins/session-report/skills/session-report/analyze-sessions.mjs#L204), [#L303-L321](https://github.com/anthropics/claude-plugins-official/blob/df9699a55c56707e9948a32951ea356638ea8519/plugins/session-report/skills/session-report/analyze-sessions.mjs#L303-L321), [#L348-L366](https://github.com/anthropics/claude-plugins-official/blob/df9699a55c56707e9948a32951ea356638ea8519/plugins/session-report/skills/session-report/analyze-sessions.mjs#L348-L366))

Resulting attribution semantics:
- The API request that issues the `Skill` call is itself charged to that skill (because content is scanned before usage is recorded).
- All subsequent tool round-trip API calls keep being charged to that skill **until the next ordinary human message**. If the agent does unrelated work in the same turn after the skill is done, that is counted too; when a second skill is invoked in the same turn, attribution switches to the new skill.
- Subagents dispatched from within a skill: `currentSkill` starts at null in the subagent file, so **subagent tokens are not attributed to the parent skill** (but they are attributed to the prompt, see below).
- For multiple assistant entries with the same requestId, the `skill` value of the entry with the largest output_tokens is used.

**(c) Output semantics**

- `by_skill[name]` is a full `summarize()` (api_calls, input breakdown, pct_cached, output, etc.), but `sessions` is **always 0** in skill buckets because `sessions.add` runs only for overall/project/subagent ([SR/analyze-sessions.mjs#L407-L417](https://github.com/anthropics/claude-plugins-official/blob/df9699a55c56707e9948a32951ea356638ea8519/plugins/session-report/skills/session-report/analyze-sessions.mjs#L407-L417)); skill invocation counts live in `overall.skill_invocations` / `by_project[*].skill_invocations`, not in the `by_skill` bucket's own `skill_invocations`.
- Empty buckets (`apiCalls===0 && sessions.size===0`) are deleted (L586-L591).

**(d) Prompt attribution (related mechanism)**

Each human message creates a `promptKey` (`e.uuid` or `sessionId:timestamp`), and subsequent API calls are attributed to it; `tool_use.id → promptKey` is recorded for `Agent/Task` calls in the parent session, and when the subagent's tool_result brings back the `agentId`, `agentId → promptKey` is established, so all calls in the subagent file are also attributed to the prompt that launched it ([SR/analyze-sessions.mjs#L163-L169](https://github.com/anthropics/claude-plugins-official/blob/df9699a55c56707e9948a32951ea356638ea8519/plugins/session-report/skills/session-report/analyze-sessions.mjs#L163-L169), [#L205-L210](https://github.com/anthropics/claude-plugins-official/blob/df9699a55c56707e9948a32951ea356638ea8519/plugins/session-report/skills/session-report/analyze-sessions.mjs#L205-L210), [#L248-L265](https://github.com/anthropics/claude-plugins-official/blob/df9699a55c56707e9948a32951ea356638ea8519/plugins/session-report/skills/session-report/analyze-sessions.mjs#L248-L265)). To ensure parents are processed before children, subagent files are processed in birthtime order (L541-L554). `top_prompts` takes the top 100 by tokens, with 2 user messages before and after each as context (L492-L512, L728-L749).

### 4. Grading

**Not applicable**: no judge and no LLM scoring. The only "judgment" is the 3–5 findings Claude writes when filling the template, for which SKILL.md gives heuristic thresholds ([SR/SKILL.md#L27-L32](https://github.com/anthropics/claude-plugins-official/blob/df9699a55c56707e9948a32951ea356638ea8519/plugins/session-report/skills/session-report/SKILL.md#L27-L32)):

> Look for: a project or skill eating a disproportionate share, cache-hit <85%, a single prompt >2% of total, subagent types averaging >1M tokens/call, cache breaks clustering.

The only deterministic "check" is the cache break: a single call with `input_tokens + cache_creation_input_tokens > 100000` counts as one cache break ([SR/analyze-sessions.mjs#L386-L404](https://github.com/anthropics/claude-plugins-official/blob/df9699a55c56707e9948a32951ea356638ea8519/plugins/session-report/skills/session-report/analyze-sessions.mjs#L386-L404)).

### 5. Baselines and version comparison

Not applicable. There is no concept of skill versions and no before/after comparison; the only option is to change the `--since` window and compare by hand.

### 6. Repeated runs and statistics

Not applicable. There are only sums, percentages (`pct_cached = cache_read / (uncached+create+read)`) and averages (`avg_tokens_per_call = subagentTokens / subagentCalls`) ([SR/analyze-sessions.mjs#L616-L649](https://github.com/anthropics/claude-plugins-official/blob/df9699a55c56707e9948a32951ea356638ea8519/plugins/session-report/skills/session-report/analyze-sessions.mjs#L616-L649)). `by_day` uses 10-minute buckets to compute the peak number of concurrent sessions within a day (L681-L720).

### 7. Cost / token accounting

- Reads the four `message.usage` fields directly; dedups by requestId, keeping the largest output_tokens; buffers within a file and commits at the end of the file; then dedups across files with `seenRequestIds` ([SR/analyze-sessions.mjs#L197-L199](https://github.com/anthropics/claude-plugins-official/blob/df9699a55c56707e9948a32951ea356638ea8519/plugins/session-report/skills/session-report/analyze-sessions.mjs#L197-L199), [#L348-L352](https://github.com/anthropics/claude-plugins-official/blob/df9699a55c56707e9948a32951ea356638ea8519/plugins/session-report/skills/session-report/analyze-sessions.mjs#L348-L352)).
- Counts only tokens, no conversion to dollars.
- Time: wall clock = difference between the first and last timestamps in a file; active = sum of gaps between adjacent entries that are <5 minutes (L50, L238-L241).

### 8. Rule files (CLAUDE.md/AGENTS.md)

Not applicable. Does not recognize rule files and does not measure their context cost.

### 9. Privacy and data flow

- The script is purely local, with no network calls.
- However, SKILL.md has Claude read `/tmp/session-report.json` (which contains 240-character prompt previews and context snippets) and write commentary based on it, so this content is sent to the model as ordinary session context.
- The generated HTML loads fonts from Google Fonts (`template.html` L7-L9), which makes external requests but does not upload data.
- The JSON is first written to the world-readable `/tmp/session-report.json` (SKILL.md L14), which is a leak surface on multi-user machines.

## Limitations (observed in source)

1. Supports only Claude Code JSONL; the field structure was "discovered empirically", so format changes cause silent undercounting.
2. Skill attribution uses a coarse "until the next human message" window, which includes unrelated work after the skill and does not attribute subagent usage to the parent skill.
3. Built-in slash commands are counted as skills.
4. `by_skill[*].sessions` is always 0; skill invocation counts are not in the `by_skill` buckets.
5. Does not distinguish successful from failed skill invocations, and does not recognize usage via `Read` of SKILL.md.
6. Entries without timestamps are not filtered by `--since`.
7. No judgment at all of "was it used correctly".
