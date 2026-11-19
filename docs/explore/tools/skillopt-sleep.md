# SkillOpt-Sleep (vendored version in alirezarezvani/claude-skills)

- Repo: <https://github.com/alirezarezvani/claude-skills>, path `engineering/skillopt-sleep`
- Commit: `f8593c4941210a621a6629ce1da9e07897976d5f` (repo HEAD, 2026-11-17); vendored in `cf6ca76` (2026-07-08), followed by several rounds of security patches up to `7eb198f` (2026-07-11)
- Upstream: `skillopt_sleep/` and the Claude Code plugin from **microsoft/SkillOpt** (README lines 1-11); this directory is a "verbatim copy + several security patches"; the design doc is upstream at <https://microsoft.github.io/SkillOpt/docs/guideline.html#sleep>, not vendored
- Stars: 30083 (whole claude-skills repo) / Language: Python (stdlib only) + bash / License: MIT © Microsoft
- One-liner: a "sleep cycle" optimizer: read-only collection of recent Claude Code (or Codex) sessions → mine 0–3 "tasks" per session → **single-turn replay** of those tasks using the current SKILL.md + CLAUDE.md text as the prompt → have the LLM propose bounded edits from the failures → accept only on a **strict improvement** on held-out val tasks → stage, and write only when the user runs `adopt`. It **does not grade whether rules or skills were followed in real sessions**; instead it uses real sessions to generate offline tasks for optimizing guidance text.

Link prefix below: `https://github.com/alirezarezvani/claude-skills/blob/f8593c4941210a621a6629ce1da9e07897976d5f/engineering/skillopt-sleep/` (written as `…/` below; every link gives the full address).

## Features

| Command/feature | What it does | Location |
|---|---|---|
| `sleep.sh status` | Shows past nightly runs | [SKILL.md L44-L51](https://github.com/alirezarezvani/claude-skills/blob/f8593c4941210a621a6629ce1da9e07897976d5f/engineering/skillopt-sleep/skills/skillopt-sleep/SKILL.md#L44-L51) |
| `dry-run` | harvest + mine + replay + consolidate, without staging | [cycle.py L107](https://github.com/alirezarezvani/claude-skills/blob/f8593c4941210a621a6629ce1da9e07897976d5f/engineering/skillopt-sleep/skillopt_sleep/cycle.py#L107) |
| `run` | Full cycle; output written to `<project>/.skillopt-sleep/staging/<date>/` | [cycle.py L93-L397](https://github.com/alirezarezvani/claude-skills/blob/f8593c4941210a621a6629ce1da9e07897976d5f/engineering/skillopt-sleep/skillopt_sleep/cycle.py#L93-L397) |
| `adopt` | After backing up, copies `proposed_*.md` to live (redacting once more) | [staging.py L217](https://github.com/alirezarezvani/claude-skills/blob/f8593c4941210a621a6629ce1da9e07897976d5f/engineering/skillopt-sleep/skillopt_sleep/staging.py#L217) |
| `schedule` / `unschedule` | Writes/removes crontab (requires `--yes`) | `scheduler.py`, `scripts/install-cron.sh` |
| `SessionEnd` hook | Async; only appends "timestamp + PWD" to `~/.skillopt-sleep/session-end.log`, does not run optimization | [hooks/hooks.json](https://github.com/alirezarezvani/claude-skills/blob/f8593c4941210a621a6629ce1da9e07897976d5f/engineering/skillopt-sleep/hooks/hooks.json), [on-session-end.sh](https://github.com/alirezarezvani/claude-skills/blob/f8593c4941210a621a6629ce1da9e07897976d5f/engineering/skillopt-sleep/hooks/on-session-end.sh) |
| `experiments/*` | Deterministic demos with persona (researcher/programmer) synthetic tasks, gbrain benchmark, transfer experiments | `skillopt_sleep/experiments/` |
| Backends | `mock` (default, no API), `claude` (`claude -p`, default model `sonnet`), `codex` (`codex exec`), `copilot` | [backend.py](https://github.com/alirezarezvani/claude-skills/blob/f8593c4941210a621a6629ce1da9e07897976d5f/engineering/skillopt-sleep/skillopt_sleep/backend.py) |

## Architecture and data flow

```
~/.claude/projects/**/*.jsonl  (or ~/.codex/archived_sessions/*)
   │ harvest.digest_transcript()        → SessionDigest{user_prompts, assistant_finals[-5:], tools_used, feedback_signals…}
   │ filter: the engine's own headless sessions, project scope, ended_at ≥ since
   ▼
mine(): llm_miner (0–3 checkable tasks per session) or heuristic_mine (1 per session)
   │ dedup (same project+intent) → optional keyword filter by target skill → ≤40 → assign_splits (train / val 34%)
   ▼
dream_consolidate() → consolidate():
   baseline = replay(val, skill, memory)             # single-turn prompt, no tools
   failures = replay(train) where hard < 1
   edits = reflect(failures) → apply_edits (only the "Learned preferences" block)
   cand = replay(val, skill', memory)   ── kept only if cand > baseline, otherwise goes to rejected
   (skill first, then memory (CLAUDE.md), each gated once)
   ▼
write_staging(): proposed_SKILL.md / proposed_CLAUDE.md / diff / report.md / diagnostics.json (redacted, 0600)
   ▼
adopt (manual or --auto-adopt)
```

## Core mechanisms

### 1. Input
Real sessions (read-only); the first run looks back 72 hours (`lookback_hours`), later runs start from the last harvest time ([cycle.py L166-L174](https://github.com/alirezarezvani/claude-skills/blob/f8593c4941210a621a6629ce1da9e07897976d5f/engineering/skillopt-sleep/skillopt_sleep/cycle.py#L166-L174)). `--tasks-file` can also supply human-reviewed TaskRecord JSON directly.

### 2. Session / log parsing
**Claude Code** ([harvest.py L167-L242](https://github.com/alirezarezvani/claude-skills/blob/f8593c4941210a621a6629ce1da9e07897976d5f/engineering/skillopt-sleep/skillopt_sleep/harvest.py#L167-L242)): **all** `.jsonl` under `os.walk(~/.claude/projects)` (including subagents subdirectories); reads `type`, `timestamp`, `cwd` (as project), `gitBranch`, the first 20 keys of `file-history-snapshot.snapshot` (files_touched), `message.role/content`. User text is skipped if wrapped in `<…>`, a `/command` of ≤3 words, or starting with `[Pasted text` or `Caveat:` ([L101-L112](https://github.com/alirezarezvani/claude-skills/blob/f8593c4941210a621a6629ce1da9e07897976d5f/engineering/skillopt-sleep/skillopt_sleep/harvest.py#L101-L112)); for assistant only text and `tool_use.name` are recorded; **tool_result is not read**. Only the last 5 assistant texts are kept.
- Feedback signals: substring matching in user text, negative such as "still broken", "wrong", "no,", "revert", positive such as "thanks", "perfect", "lgtm" ([L30-L48](https://github.com/alirezarezvani/claude-skills/blob/f8593c4941210a621a6629ce1da9e07897976d5f/engineering/skillopt-sleep/skillopt_sleep/harvest.py#L30-L48)); phrases in other languages can be added via environment variables.
- Excludes sessions the engine itself produced: only 1 user turn containing markers such as `"## CURRENT SKILL"` or `"You are a strict grader"`, or <3 seconds with a prompt <200 characters ([L121-L164](https://github.com/alirezarezvani/claude-skills/blob/f8593c4941210a621a6629ce1da9e07897976d5f/engineering/skillopt-sleep/skillopt_sleep/harvest.py#L121-L164)).
- The SKILL.md docs say it also reads `~/.claude/history.jsonl`, but in the code `history_path` is just an attribute that is never called ([config.py L110-L111](https://github.com/alirezarezvani/claude-skills/blob/f8593c4941210a621a6629ce1da9e07897976d5f/engineering/skillopt-sleep/skillopt_sleep/config.py#L110-L111)) — **docs and code disagree**.

**Codex** (`harvest_codex.py`): reads only `~/.codex/archived_sessions/` (not `sessions/`); `payload.type` is `user_message`/`agent_message`/`message`, tool names come from `exec_command_end`, `patch_apply_end`, etc.; for injected messages starting with `# AGENTS.md instructions`, only the tail after `</INSTRUCTIONS>` is kept ([harvest_codex.py L62-L79](https://github.com/alirezarezvani/claude-skills/blob/f8593c4941210a621a6629ce1da9e07897976d5f/engineering/skillopt-sleep/skillopt_sleep/harvest_codex.py#L62-L79)), and secret redaction happens here.

### 3. Skill trigger detection
**Not applicable**. It does not detect whether a skill was invoked in a session. It only optimizes **one** "managed skill" (default `~/.claude/skills/skillopt-sleep-learned/SKILL.md`, or set by `--target-skill-path`) and the project-root `CLAUDE.md` ([config.py L118-L128](https://github.com/alirezarezvani/claude-skills/blob/f8593c4941210a621a6629ce1da9e07897976d5f/engineering/skillopt-sleep/skillopt_sleep/config.py#L118-L128), [cycle.py L142-L152](https://github.com/alirezarezvani/claude-skills/blob/f8593c4941210a621a6629ce1da9e07897976d5f/engineering/skillopt-sleep/skillopt_sleep/cycle.py#L142-L152)). When a target skill is given, it uses the skill path/title/frequent words as keywords to rank relevant tasks first ([mine.py L81-L134](https://github.com/alirezarezvani/claude-skills/blob/f8593c4941210a621a6629ce1da9e07897976d5f/engineering/skillopt-sleep/skillopt_sleep/mine.py#L81-L134)).

### 4. Grading (the focus of this section)

#### 4.1 Sessions → tasks (selection and excerpting)
- Excerpt: the LLM miner gets only the first 6 user prompts (240 characters each) + the last assistant text (400 characters) + the first 6 feedback signals ([llm_miner.py L60-L69](https://github.com/alirezarezvani/claude-skills/blob/f8593c4941210a621a6629ce1da9e07897976d5f/engineering/skillopt-sleep/skillopt_sleep/llm_miner.py#L60-L69)). No tool calls, code or rule files.
- **Full LLM miner prompt** ([llm_miner.py L29-L57](https://github.com/alirezarezvani/claude-skills/blob/f8593c4941210a621a6629ce1da9e07897976d5f/engineering/skillopt-sleep/skillopt_sleep/llm_miner.py#L29-L57)):

```
You are mining a user's past AI-assistant sessions to find RECURRING tasks
worth optimizing a skill for. From the session below, extract 0-3 reusable tasks.

A good task is something the user asks for repeatedly or had to correct, where a
GENERAL rule would help next time (formatting, structure, tool-use, conventions).
Skip one-off or purely exploratory requests.

For each task return:
  - "intent": the reusable request, generalized (no one-off specifics)
  - "checks": a list of programmatic success checks a grader can run on a future
     answer. Each check is one of:
        {"op":"section_present","arg":"<heading text>"}
        {"op":"regex","arg":"<python regex the answer must match>"}
        {"op":"contains","arg":"<substring the answer must contain>"}
        {"op":"max_chars","arg":<int>}
     Only include checks you are confident a GOOD answer must satisfy.
  - "rubric": a one-sentence description of what a good answer looks like
  - "satisfied": true/false — did the user seem satisfied with the assistant's answer?

Return ONLY a JSON array (possibly empty). No prose.

# Session
project: __PROJECT__
user prompts:
__PROMPTS__
assistant final (last):
__FINAL__
feedback signals: __FEEDBACK__
```
- Parsing: `_extract_json(raw, "array")` uses the greedy regex `\[.*\]` to take from the first to the last square bracket, then `json.loads`; on failure the session is skipped ([backend.py L273-L282](https://github.com/alirezarezvani/claude-skills/blob/f8593c4941210a621a6629ce1da9e07897976d5f/engineering/skillopt-sleep/skillopt_sleep/backend.py#L273-L282)). `_mk_task` keeps only checks whose op is whitelisted; with checks → `reference_kind="rule"`; only a rubric → `"rubric"`; neither → dropped; `intent` < 8 characters dropped ([L72-L105](https://github.com/alirezarezvani/claude-skills/blob/f8593c4941210a621a6629ce1da9e07897976d5f/engineering/skillopt-sleep/skillopt_sleep/llm_miner.py#L72-L105)). "Recurring" relies only on the prompt's request; **in code each session is mined independently**, and dedup is only exact matching on `sha256(project+intent)` ([mine.py L205-L218](https://github.com/alirezarezvani/claude-skills/blob/f8593c4941210a621a6629ce1da9e07897976d5f/engineering/skillopt-sleep/skillopt_sleep/mine.py#L205-L218)).
- With the mock backend or when LLM mining fails, `heuristic_mine` is used: one task per session, intent = the first substantive prompt, outcome inferred from feedback signals (negative→fail, positive and no negative→success, ≥3 turns→mixed, otherwise unknown), `reference_kind="none"` ([mine.py L137-L202](https://github.com/alirezarezvani/claude-skills/blob/f8593c4941210a621a6629ce1da9e07897976d5f/engineering/skillopt-sleep/skillopt_sleep/mine.py#L137-L202)).

#### 4.2 Train / val / test split ([assign_splits L221-L278](https://github.com/alirezarezvani/claude-skills/blob/f8593c4941210a621a6629ce1da9e07897976d5f/engineering/skillopt-sleep/skillopt_sleep/mine.py#L221-L278))
```
bucket = int(sha256(str(seed) + task.id), 16) % 100        # seed defaults to 42
split  = val   if bucket < round(val_fraction*100)          # default 34
         test  if bucket < val_cut + round(test_fraction*100)  # default 0 → no test
         train otherwise
dream tasks (synthetic rewrites) always go to train, never val/test
guarantee: with ≥2 real tasks, val is non-empty and train is non-empty
```
Hashing by task id means the same task lands in the same split across nights.

#### 4.3 What "replay" actually means
[replay_one L29-L67](https://github.com/alirezarezvani/claude-skills/blob/f8593c4941210a621a6629ce1da9e07897976d5f/engineering/skillopt-sleep/skillopt_sleep/replay.py#L29-L67) → `backend.attempt()`: a **single text completion**, not re-running the agent in the repo. Generic prompt ([backend.py L380-L392](https://github.com/alirezarezvani/claude-skills/blob/f8593c4941210a621a6629ce1da9e07897976d5f/engineering/skillopt-sleep/skillopt_sleep/backend.py#L380-L392)):

> Complete the following task for the user. Follow the skill and memory guidance below, including any output-format and length requirements. When a 'Learned preferences' rule sets an explicit limit (e.g. a length cap), prefer that rule over more general advice it refines.
> `# Skill` {skill} `# Memory` {memory} `# Task` {intent} {context_excerpt}
> Return ONLY the final answer text, nothing else.

The Claude backend runs `claude -p --disable-slash-commands --disallowedTools '*' --exclude-dynamic-system-prompt-sections` (adding `--bare` when an API key is present) in an empty temp directory, **disabling all tools and skills** ([L612-L652](https://github.com/alirezarezvani/claude-skills/blob/f8593c4941210a621a6629ce1da9e07897976d5f/engineering/skillopt-sleep/skillopt_sleep/backend.py#L612-L652)). Only when a check contains `tool_called` does it use a tool loop with a shell shim. `replay_mode="fresh"` (worktree replay) is declared in config but **not implemented**; the code writes a note saying so ([cycle.py L232-L242](https://github.com/alirezarezvani/claude-skills/blob/f8593c4941210a621a6629ce1da9e07897976d5f/engineering/skillopt-sleep/skillopt_sleep/cycle.py#L232-L242)). Responses are cached by prompt hash, so re-scoring the baseline within the same night is deterministic and free.

#### 4.4 Scoring (label/score schema)
`ReplayResult{hard, soft, fail_reason, judge_rationale, tokens, latency_ms}` ([types.py L91-L107](https://github.com/alirezarezvani/claude-skills/blob/f8593c4941210a621a6629ce1da9e07897976d5f/engineering/skillopt-sleep/skillopt_sleep/types.py#L91-L107)).
- **rule** (local, deterministic, [judges.py L234-L280](https://github.com/alirezarezvani/claude-skills/blob/f8593c4941210a621a6629ce1da9e07897976d5f/engineering/skillopt-sleep/skillopt_sleep/judges.py#L234-L280)): op ∈ `section_present` (markdown heading/bold line/`Name:`), `regex`, `max_chars`, `min_chars`, `contains` (case-insensitive), `tool_called`; unknown ops count as passed. `soft = passed/len(checks)`, `hard = 1 iff all pass`, `fail_reason = "failed: op=arg, …"`.
- **rubric** (LLM, [backend.py L411-L425](https://github.com/alirezarezvani/claude-skills/blob/f8593c4941210a621a6629ce1da9e07897976d5f/engineering/skillopt-sleep/skillopt_sleep/backend.py#L411-L425)), full prompt:
  > Score how well the response satisfies the rubric, 0..1. Return ONLY JSON {"score": <0..1>, "reason": "..."}.
  > `# Rubric` {reference or intent} `# Response` {response}

  Parsing: `_extract_json(raw,"object")`; `soft = float(score)`, `hard = 1 if soft ≥ 0.8 else 0`, reason truncated to 200 characters; parse failure → `(0, 0, "judge-parse-failed")` (failure is treated as a score of 0, not as "insufficient evidence").
- **exact**: exact comparison after normalization; soft = max(hard, keyword coverage).
- The mock backend's judge uses keyword coverage; soft ≥ 0.8 records hard=1 ([L215-L232](https://github.com/alirezarezvani/claude-skills/blob/f8593c4941210a621a6629ce1da9e07897976d5f/engineering/skillopt-sleep/skillopt_sleep/backend.py#L215-L232)).

There is no concept of "not applicable" or "insufficient evidence": every task gets scored.

#### 4.5 Aggregation and gating formula
```
hard_mean, soft_mean = mean over tasks                         # replay.aggregate_scores L103-L108
gate_score = hard                     if metric=="hard"
             soft                     if metric=="soft"
             (1-w)*hard + w*soft      if metric=="mixed" (default, w=0.5)   # gate.select_gate_score
accept edit set  ⇔  gate_score(val, candidate) > gate_score(val, current)  # strictly greater, no significance test
```
See [gate.py L170-L196](https://github.com/alirezarezvani/claude-skills/blob/f8593c4941210a621a6629ce1da9e07897976d5f/engineering/skillopt-sleep/skillopt_sleep/gate.py#L170-L196), [consolidate.py L137-L159](https://github.com/alirezarezvani/claude-skills/blob/f8593c4941210a621a6629ce1da9e07897976d5f/engineering/skillopt-sleep/skillopt_sleep/consolidate.py#L137-L159). Finally `accepted = bool(applied) and final_score > base_score` ([L216-L250](https://github.com/alirezarezvani/claude-skills/blob/f8593c4941210a621a6629ce1da9e07897976d5f/engineering/skillopt-sleep/skillopt_sleep/consolidate.py#L216-L250)). With `gate_mode="off"` it accepts greedily without scoring val.

#### 4.6 Reflection and edits (evidence selection)
- Evidence = **replay results with hard < 1 on the train split**, at most 8, each with "wanted / got / why-wrong" truncated to 160 characters; it also counts rule check failures and translates them into natural-language requirements ("the ENTIRE response must be at most N characters long") ([reflect L427-L561](https://github.com/alirezarezvani/claude-skills/blob/f8593c4941210a621a6629ce1da9e07897976d5f/engineering/skillopt-sleep/skillopt_sleep/backend.py#L427-L561)).
- Key sentences of the reflect prompt (L499-L524):

  > You are SkillOpt's optimizer. The agent keeps failing the recurring tasks below. Propose at most {edit_budget} bounded edits to the {target} document so it stops failing. Each edit MUST be a short, GENERAL, reusable rule or preference (never task-specific, never an answer to a single task). If exact failing criteria are listed, your edits MUST make future outputs satisfy every one of them.
  > BE CONCRETE: quote the exact threshold, section name, or format from the criteria verbatim in your rule …
  > IMPORTANT: your edits are APPENDED to a 'Learned preferences' block; you CANNOT delete the existing instructions above. If the current {target} text conflicts with a criterion … write an explicit, forceful OVERRIDE rule …
  > Return ONLY a JSON array: `[{"op":"add|replace|delete","content":"<rule>","anchor":"<text to replace/delete, optional>","rationale":"<why>"}]`

  On non-JSON output it retries once with a more forceful prompt (L532-L540).
- `apply_edits` only changes the "Learned preferences & procedures" block between `<!-- SKILLOPT-SLEEP:LEARNED … -->` markers; add deduplicates, delete/replace match by normalized anchor substring ([memory.py L73-L113](https://github.com/alirezarezvani/claude-skills/blob/f8593c4941210a621a6629ce1da9e07897976d5f/engineering/skillopt-sleep/skillopt_sleep/memory.py#L73-L113)). User-written content is never changed.
- Edits rejected by the gate are written to the report under "Rejected by gate (kept as negative feedback)".
- Optional: `dream_rollouts>1` runs each train task K times for contrastive reflection; `dream_factor>0` rewrites tasks with three fixed wrapper phrases; `recall_k>0` recalls past tasks by Jaccard word overlap ([dream.py L28-L138](https://github.com/alirezarezvani/claude-skills/blob/f8593c4941210a621a6629ce1da9e07897976d5f/engineering/skillopt-sleep/skillopt_sleep/dream.py#L28-L138)). All of these only enlarge train.

#### 4.7 Evaluation loop pseudocode
```
digests = harvest(since=last_harvest or now-72h, scope=invoked project)
tasks   = llm_mine(digests) or heuristic_mine(digests); dedup; target-filter; [:40]; assign_splits
train, val = split(tasks)
base  = gate(replay(val, S, M))
fails = [r for r in replay(train, S, M) if r.hard < 1]
E_s   = reflect(fails, target=skill);   S' = apply(S, E_s)
if gate(replay(val, S', M)) > base: S = S'; base = new   else: rejected += E_s
fails2 = [r for r in replay(train, S, M) if r.hard < 1]
E_m   = reflect(fails2, target=memory); M' = apply(M, E_m)
if gate(replay(val, S, M')) > base: M = M'                else: rejected += E_m
final = gate(replay(val, S, M)); accepted = applied and final > base0
stage(proposed S/M, diff, report, diagnostics) ; adopt only on user command or --auto-adopt
```

### 5. Baselines and version comparison
Yes, but the object is **replay scores**: "current (S,M)" vs "candidate (S',M')" on the same val tasks. This is a controlled A/B of skill / rule file versions, not an observational comparison of real sessions. The report gives `held-out score: baseline -> candidate`. `state.json` records nightly `baseline/candidate/accepted`, so a history curve can be viewed.

### 6. Repeated runs and statistics
Each (task, text) runs only once by default (and is cached); `dream_rollouts>1` is used only for reflection, not gating. Gating compares means with strict greater-than; **no variance estimate, confidence interval or significance test**; val usually has only ~13 tasks (40×0.34), so a single task flipping can decide acceptance.

### 7. Cost / token accounting
CLI backends estimate tokens as `len(prompt)//4 + len(out)//4` ([L345-L352](https://github.com/alirezarezvani/claude-skills/blob/f8593c4941210a621a6629ce1da9e07897976d5f/engineering/skillopt-sleep/skillopt_sleep/backend.py#L345-L352)); `max_tokens_per_night` defaults to 400k and only took effect after a vendor patch, and it only lowers dream_rollouts, never aborts midway (README deviation 4). `multi_objective_reward` can include tokens and latency in the reward; default weight is 0.

### 8. Rule files
It **rewrites** CLAUDE.md (within the protected block), but does not grade whether individual CLAUDE.md rules were followed. CLAUDE.md as a whole goes into the replay prompt as the "# Memory" text. New rules appear as "Learned preferences" entries, each with a rationale; gating works on whole edit sets (one for skill, one for memory), not per-rule ablation.

### 9. Privacy and data flow
- Session excerpts (prompt snippets, final answer) are sent to the chosen backend's model (`claude -p` / `codex exec` / copilot), i.e. the user's own account.
- Local persistence: the task archive in `~/.skillopt-sleep/state.json` (with intent/context, redacted only after the redaction patch), the staging directory, `diagnostics.json` (0600).
- Secret redaction originally covered only diagnostics; vendor patches extended it to proposed files, adopt and the task archive (README deviations 2, 6, 7).
- Nothing is uploaded to third-party servers.

## Limitations (observed in source)
- "Replay" is a tool-less single-turn text completion, suited to "format/length/structure" preferences; it can hardly reflect the effect of a skill or rule in real coding tasks; the `fresh` worktree mode is not implemented.
- LLM-generated checks can only be `contains`/`regex`/`section_present`/`max_chars`, so the optimization target skews toward surface formatting.
- Each session is mined independently; "recurring" is not guaranteed in code.
- Gating has very weak statistical power (small val, single sample, accept on strictly greater); judge parse failures count as 0, turning noise into signal.
- Docs claim to read `history.jsonl`, but the code does not; Codex reads only archived_sessions.
- Can only optimize one managed skill + CLAUDE.md; does not grade other installed skills.
