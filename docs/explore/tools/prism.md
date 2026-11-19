# PRISM (jakeefr/prism)

- Repository: <https://github.com/jakeefr/prism>
- commit: `b4af0c1c8e6b06b3b386f78bf5e549f631d95ede` (HEAD, 2026-06-07; no commits in nearly 5 months)
- stars: 21 / language: Python ≥3.11 (Typer + Rich + Textual) / license: MIT
- In one sentence: reads local Claude Code session JSONL (or agentsview's SQLite), gives each project a 0–100 health score and letter grade across five dimensions, and suggests changes to CLAUDE.md; **fully deterministic, no LLM**.

All links below are permalinks to the commit above.

## Features

| Command | What it does | Location |
|---|---|---|
| `prism` | Textual TUI: project list + grades, drill into sessions, live watching | [prism/app.py](https://github.com/jakeefr/prism/blob/b4af0c1c8e6b06b3b386f78bf5e549f631d95ede/prism/app.py) |
| `prism analyze [--project] [--json]` | Prints the five-dimension score table and top issues, and regenerates the HTML dashboard along the way | [cli.py L118](https://github.com/jakeefr/prism/blob/b4af0c1c8e6b06b3b386f78bf5e549f631d95ede/prism/cli.py#L118) |
| `prism advise [--apply]` | Generates CLAUDE.md suggestions (ADD / WARN / TRIM / RESTRUCTURE); `--apply` writes ADD items into CLAUDE.md | [advisor.py](https://github.com/jakeefr/prism/blob/b4af0c1c8e6b06b3b386f78bf5e549f631d95ede/prism/advisor.py) |
| `prism replay` | Session timeline replay | [cli.py L402](https://github.com/jakeefr/prism/blob/b4af0c1c8e6b06b3b386f78bf5e549f631d95ede/prism/cli.py#L402) |
| `prism watch` | Follows a session file as it is being written (`SessionTail`) | [cli.py L432](https://github.com/jakeefr/prism/blob/b4af0c1c8e6b06b3b386f78bf5e549f631d95ede/prism/cli.py#L432) |
| `prism projects` | Lists projects | [cli.py L465](https://github.com/jakeefr/prism/blob/b4af0c1c8e6b06b3b386f78bf5e549f631d95ede/prism/cli.py#L465) |
| `prism dashboard [--serve]` | Generates `~/.claude/prism/dashboard.html`, optionally served on localhost:19821 | [cli.py L515](https://github.com/jakeefr/prism/blob/b4af0c1c8e6b06b3b386f78bf5e549f631d95ede/prism/cli.py#L515) |
| `--source agentsview` | Reads from agentsview's `~/.agentsview/sessions.db` instead | [cli.py L54-L80](https://github.com/jakeefr/prism/blob/b4af0c1c8e6b06b3b386f78bf5e549f631d95ede/prism/cli.py#L54-L80), [agentsview.py](https://github.com/jakeefr/prism/blob/b4af0c1c8e6b06b3b386f78bf5e549f631d95ede/prism/agentsview.py) |

## Architecture and data flow

```
~/.claude/projects/<encoded>/*.jsonl  (+ <session>/subagents/*.jsonl merged in)
        │ parser.parse_session_file → UserRecord / AssistantRecord / SystemRecord
        ▼
analyze_project(project, max_sessions=50)
   ├─ analyze_token_efficiency   (20%)
   ├─ analyze_tool_health        (25%)
   ├─ analyze_context_hygiene    (20%)
   ├─ analyze_claude_md_adherence(20%)  ← <cwd>/CLAUDE.md as currently on disk
   └─ analyze_session_continuity (15%)
        ▼
ProjectHealthReport{per-dimension score/grade/issues, overall, top_issues[:10]}
        ▼
CLI table / TUI / dashboard.html / advisor suggestions
```

## Core mechanisms

### 1. Input
Reads local sessions only; for each project, takes the latest 50 sessions by mtime ([analyze_project L770-L839](https://github.com/jakeefr/prism/blob/b4af0c1c8e6b06b3b386f78bf5e549f631d95ede/prism/analyzer.py#L770-L839); note that `load_all_sessions` parses all files first and slices afterwards).

### 2. Session / log parsing (Claude Code only)
- Path: `~/.claude/projects/<encoded>/*.jsonl`; subagent files `<session-uuid>/subagents/*.jsonl` are merged into the parent session while keeping their grouping, so order-dependent detections do not cross boundaries ([parser.py L458-L530](https://github.com/jakeefr/prism/blob/b4af0c1c8e6b06b3b386f78bf5e549f631d95ede/prism/parser.py#L458-L530)).
- Envelope fields: `uuid`, `parentUuid`, `isSidechain`, `sessionId`, `timestamp`, `version`, `cwd`, `gitBranch`, `type` ([L169-L182](https://github.com/jakeefr/prism/blob/b4af0c1c8e6b06b3b386f78bf5e549f631d95ede/prism/parser.py#L169-L182)).
- `type=="user"` text starting with `This session is being continued` / `<local-command-caveat>` / `[Request interrupted` / `<task-notification>` / `Stop hook feedback:` is classified as a SystemRecord with a continuation/resume/interrupted etc. subtype ([L134-L150](https://github.com/jakeefr/prism/blob/b4af0c1c8e6b06b3b386f78bf5e549f631d95ede/prism/parser.py#L134-L150)). For `type=="system"`, `subtype` (e.g. `compact_boundary`) and `summary` are read.
- For assistant entries, reads `message.usage.output_tokens` (output tokens only); everything else is estimated as chars/4 ([analyzer.py L32-L59](https://github.com/jakeefr/prism/blob/b4af0c1c8e6b06b3b386f78bf5e549f631d95ede/prism/analyzer.py#L32-L59)).
- Last line not valid JSON → `truncated=True`.
- Codex not supported.

### 3. Skill trigger detection
**Not applicable**. The code contains no skill-related logic at all.

### 4. Grading (the focus of this section)

Entirely deterministic heuristics. Each dimension starts at 100 and deducts points; `score_to_grade`: A+ ≥95, A ≥90, A- ≥85, B+ ≥80 … D- ≥40, otherwise F ([L66-L79](https://github.com/jakeefr/prism/blob/b4af0c1c8e6b06b3b386f78bf5e549f631d95ede/prism/analyzer.py#L66-L79)).

#### 4.1 CLAUDE.md Adherence (most relevant to us)
**Rule extraction** ([_extract_rules L540-L551](https://github.com/jakeefr/prism/blob/b4af0c1c8e6b06b3b386f78bf5e549f631d95ede/prism/analyzer.py#L540-L551)): after stripping leading `- * #` from each line, any line starting with `Never|Always|Don't|Use|Avoid|Run|NEVER|ALWAYS|DO NOT|Prefer|Must|Ensure` (case-insensitive) is a rule ([RULE_PREFIXES L513-L516](https://github.com/jakeefr/prism/blob/b4af0c1c8e6b06b3b386f78bf5e549f631d95ede/prism/analyzer.py#L513-L516)). This is a rudimentary per-Rule Item split, but it misses rules that do not start with these verbs (e.g. "run lint before committing", "Tests go in tests/").

**Violation detection** ([_check_rule_violation L554-L605](https://github.com/jakeefr/prism/blob/b4af0c1c8e6b06b3b386f78bf5e549f631d95ede/prism/analyzer.py#L554-L605)): check functions are attached based on keywords in the rule text; there are only three:

| Rule text trigger | Check (the session is a violation if any assistant `tool_use` hits) |
|---|---|
| Contains `migration` and `never` or `don't` | `file_path` of `Write`/`Edit` contains `migration` or `/migrations/` |
| Contains `interactive` (including `non-interactive`) | `Bash.command` matches an interactive pattern: `npm init` (no args), `apt` (no -y), `git commit` (no -m), `--watch`, `yarn add`, and contains none of `--yes/-y/--non-interactive/--no-input/-n/--assume-yes` ([L220-L244](https://github.com/jakeefr/prism/blob/b4af0c1c8e6b06b3b386f78bf5e549f631d95ede/prism/analyzer.py#L220-L244)) |
| Contains `any` and `typescript` | `new_string`+`content` of `Write`/`Edit` contains `: any` or `:any` |

Other rules: `return 0  # Can't check this rule automatically` (L589). Return value = number of violating sessions.

**Applicability**: not judged. Checkers run against every session; "no migration file was edited" cannot be distinguished from "the session had nothing to do with migrations".

**Key defect** ([analyze_claude_md_adherence L608-L669](https://github.com/jakeefr/prism/blob/b4af0c1c8e6b06b3b386f78bf5e549f631d95ede/prism/analyzer.py#L608-L669)):
```python
for rule in rules:
    violations = _check_rule_violation(rule, sessions)
    if violations > 0: m.rules_violated += 1 ...
    else:              m.rules_followed += 1          # L648: rules that cannot be checked are also counted as followed
m.rules_unchecked = m.rules_found - m.rules_violated - m.rules_followed   # always 0
```
The `rules_unchecked` field exists but is always 0; rules that cannot be checked are treated as "followed", inflating the score. In effect, "not applicable" and "cannot be judged" are counted as "followed".

**Score**:
```
score = 100 - 60 * (rules_violated / rules_found)
        - 15 if lines > 80        # the "Mr. Tinkleberry test" is implemented only as a line-count threshold
        - 10 if lines > 120
no CLAUDE.md → grade "N/A", counted as 70 in overall
```
The README claims PRISM "automates this test [Mr. Tinkleberry] across all your real sessions" ([README L244](https://github.com/jakeefr/prism/blob/b4af0c1c8e6b06b3b386f78bf5e549f631d95ede/README.md#L244)), but the code only deducts points for >80 lines; **the README does not match the code**.

**Locating CLAUDE.md**: takes the `cwd` of the first record in the project's 3 most recent sessions and checks whether `<cwd>/CLAUDE.md` exists ([datasource.py L45-L53](https://github.com/jakeefr/prism/blob/b4af0c1c8e6b06b3b386f78bf5e549f631d95ede/prism/datasource.py#L45-L53)). It reads the **current on-disk version**, unrelated to the version in effect when the session happened; it does not read subdirectory CLAUDE.md files, `~/.claude/CLAUDE.md` or `.claude/rules/`.

#### 4.2 The other four dimensions (brief; all in [analyzer.py](https://github.com/jakeefr/prism/blob/b4af0c1c8e6b06b3b386f78bf5e549f631d95ede/prism/analyzer.py))
- **Token Efficiency** (L115-L213): CLAUDE.md injection cost = `(1 + compactions) × CLAUDE.md tokens`, counted only for sessions ≥2k tokens; a single session >15% is recorded as an issue. Deductions: compaction rate >2/>1/>0.5 deducts 30/15/8; sidechain record share >0.3/>0.1 deducts 20/10; CLAUDE.md cost share >0.3/>0.15 deducts 25/12. (The README says "Every tool call … re-reads your CLAUDE.md", while the code models it as "once per session + once per compaction"; the two disagree, and the code is more reasonable.)
- **Tool Health** (L259-L388): retry loops (3 consecutive calls to the same tool with the first two inputs identical, counted once per transcript), migration file edits (recorded as an issue only, no deduction), interactive Bash, edit-revert (the same file Written/Edited again within 3 tool calls), ≥3 consecutive tool failures (preferring `is_error`, otherwise regex-matching error/failed/exception). `score = 100 - min(40,15·retry) - min(20,8·interactive) - min(15,8·edit_revert) - min(20,10·consec_fail)`.
- **Context Hygiene** (L445-L510): `score = 100 - min(35, 20·compaction rate) - min(20, 15·mid_task) - min(15, 10·long sessions (>100 turns))`; mid-task compaction = the first 5 tool names after the boundary overlap with the last 10 tool names before it by ≥2.
- **Session Continuity** (L690-L753): truncation rate, and phrases like "what is / could you tell me / let me start by" in the first 3 assistant turns after a resume. `score = 100 - min(20, 40·truncation rate) - min(30, 40·context loss rate)`.

#### 4.3 Overall score ([L801-L809](https://github.com/jakeefr/prism/blob/b4af0c1c8e6b06b3b386f78bf5e549f631d95ede/prism/analyzer.py#L801-L809))
```
overall = 0.20·token_eff + 0.25·tool_health + 0.20·context_hygiene
        + 0.20·(adherence if grade != "N/A" else 70) + 0.15·continuity
top_issues = all issues sorted by high/medium/low, top 10
```

#### 4.4 Suggestion generation (advisor)
- ADD: interactive commands detected → suggest adding "Always use non-interactive flags…"; migration edits detected → suggest adding a migration rule.
- WARN: each rule judged violated (at most 5): "Rule appears violated — review sessions and reinforce" ([L150-L166](https://github.com/jakeefr/prism/blob/b4af0c1c8e6b06b3b386f78bf5e549f631d95ede/prism/advisor.py#L150-L166)), with an empty `session_evidence`.
- RESTRUCTURE: >60 lines and ≥2 lines mentioning `src/`, `tests/`, etc. → suggest moving to a subdirectory CLAUDE.md; **"attention dead zone"**: when the file is ≥20 lines, lines within the 20%–75% line range that contain NEVER/CRITICAL/DO NOT/ALWAYS/MUST NOT → suggest moving them to the start or end ([L208-L259](https://github.com/jakeefr/prism/blob/b4af0c1c8e6b06b3b386f78bf5e549f631d95ede/prism/advisor.py#L208-L259)). Purely static rules, not validated against session data.
- `--apply` writes only ADD items, with confirmation.

#### 4.5 Evaluation loop pseudocode
```
for project in discover_projects():
    sessions = load_all_sessions(project)[:50]
    md = <first-session cwd>/CLAUDE.md (current disk)
    rules = [line for line in md if line starts with Never|Always|Use|...]
    for r in rules:
        checks = keyword→checker(r)          # 3 kinds
        r.violations = #sessions where any tool_use hits a checker (0 if no checker)
    adherence = 100 - 60*violated/len(rules) - line_penalty
    overall = weighted(5 dims)
```

### 5. Baselines and version comparison
Not applicable. No CLAUDE.md version history, and no comparison by time period.

### 6. Repeated runs and statistics
Not applicable.

### 7. Cost / token accounting
`usage.output_tokens` (output only) or chars/4; CLAUDE.md cost is estimated as file characters/4 × number of injections. The agentsview backend has real token counts.

### 8. Rule files
See 4.1: line-by-line splitting + 3 hard-coded keyword checkers + line-count penalty + placement suggestions. It is the only tool seen so far that outputs a "number of violating sessions" per individual rule, but its coverage is extremely narrow.

### 9. Privacy and data flow
README L193, L342: makes no network requests, everything is local. The dashboard is written to `~/.claude/prism/`.

## Limitations (observed in source)
- Rule compliance detection covers only 3 keyword categories; all other rules are counted as followed, and `rules_unchecked` is always 0.
- No applicability judgment and no insufficient-evidence state; uses the current CLAUDE.md to judge historical sessions.
- Reads only the project-root CLAUDE.md; does not support Codex or AGENTS.md.
- Two README claims, "automates the Mr. Tinkleberry test" and "every tool call re-reads CLAUDE.md", do not match the code.
- The project has not been updated in about 5 months.
