# Anthropic skill-creator

- Repository: <https://github.com/anthropics/skills/tree/e4bb5d960d87126ff3b3a8af1a104b7db67560ba/skills/skill-creator> (`anthropics/skills`, about 197k★; the same content is also published as a plugin at `anthropics/claude-plugins-official/plugins/skill-creator`, byte-for-byte identical except for LICENSE.txt, checked with `diff -rq`)
- commit: `e4bb5d960d87126ff3b3a8af1a104b7db67560ba`, 2026-11-16 (shallow clone; HEAD is the latest commit for this directory)
- Language: Markdown instructions + Python scripts (stdlib, no third-party dependencies) + a single-file HTML viewer
- license: `LICENSE.txt` inside the skill directory is Apache-2.0 (the repository root declares no SPDX)
- In one sentence: a Skill that guides Claude, inside a conversation, to draft/improve a skill, run with/without comparisons using subagents, score against assertions, aggregate statistics, and hand off to a human for review; it also ships a script loop that measures trigger rates with `claude -p` and automatically rewrites the description.

> Permalink prefix used below: `SC = https://github.com/anthropics/skills/blob/e4bb5d960d87126ff3b3a8af1a104b7db67560ba/skills/skill-creator`

## Features

| Feature | Entry point | What it does | Deterministic program? |
|---|---|---|---|
| Draft a skill | `SKILL.md` "Creating a skill" ([SC/SKILL.md#L45-L139](https://github.com/anthropics/skills/blob/e4bb5d960d87126ff3b3a8af1a104b7db67560ba/skills/skill-creator/SKILL.md#L45-L139)) | Interviews for intent, writes SKILL.md | No, Claude follows instructions |
| Test cases | `evals/evals.json` ([SC/SKILL.md#L141-L161](https://github.com/anthropics/skills/blob/e4bb5d960d87126ff3b3a8af1a104b7db67560ba/skills/skill-creator/SKILL.md#L141-L161)) | 2–3 realistic prompts, assertions added afterwards | No |
| With/without comparison runs | SKILL.md Step 1 ([#L169-L197](https://github.com/anthropics/skills/blob/e4bb5d960d87126ff3b3a8af1a104b7db67560ba/skills/skill-creator/SKILL.md#L169-L197)) | Dispatches with-skill and baseline subagents concurrently in the same turn | No |
| Assertion scoring | `agents/grader.md` | Grader subagent gives PASS/FAIL + evidence per item, writes `grading.json` | LLM |
| Benchmark aggregation | `scripts/aggregate_benchmark.py` | Reads all `grading.json`, computes mean/stddev/min/max and delta, writes `benchmark.json/.md` | Yes |
| Analysis notes | Second half of `agents/analyzer.md` | Finds non-discriminating assertions, high-variance evals, etc. | LLM |
| Human review | `eval-viewer/generate_review.py` + `viewer.html` | Local 127.0.0.1 HTTP server or static HTML, collects `feedback.json` | Yes (UI) |
| Blind A/B | `agents/comparator.md` + first half of `agents/analyzer.md` | Compares two outputs without revealing their source, then analyzes why the winner won | LLM |
| Trigger evaluation | `scripts/run_eval.py` | Runs `claude -p` N times per query, measures trigger rate | Yes (calls real Claude) |
| Description optimization | `scripts/run_loop.py` + `improve_description.py` | 60/40 stratified holdout, up to 5 rewrite iterations, picks the best by holdout score | Yes + LLM |
| Report | `scripts/generate_report.py` | HTML report for each trigger-optimization iteration | Yes |
| Package/validate | `package_skill.py`, `quick_validate.py` | Builds a .skill package, validates frontmatter | Yes |

## Architecture and data flow

```
                ┌──────────── Output-quality evaluation (orchestrated by Claude in conversation) ────────────┐
evals.json ──▶ subagent(with_skill) ─▶ outputs/ + transcript ─┐
          └──▶ subagent(without_skill|old_skill) ─▶ outputs/ ─┤
     task-completion notice total_tokens/duration_ms ─▶ timing.json      │
                                                             ▼
                              grader subagent (agents/grader.md) ─▶ run-K/grading.json
                                                             ▼
                     aggregate_benchmark.py ─▶ benchmark.json / benchmark.md
                                                             ▼
                analyzer (notes) ─▶ generate_review.py ─▶ browser ─▶ feedback.json ─▶ edit skill next iteration

                ┌──────────── Trigger evaluation (pure script) ────────────┐
eval_set.json [{query, should_trigger}]
   └▶ run_loop.split_eval_set (stratified, seed=42, holdout=0.4)
        └▶ each iteration: run_eval.run_eval(train+test) ── each query ×3 claude -p ── trigger_rate
             └▶ improve_description(sees train results only) ─▶ new description
        └▶ best = max(history, key=test_passed) ─▶ best_description
```

Directory convention: `<skill>-workspace/iteration-N/eval-<name>/{with_skill,without_skill|old_skill}/run-K/{outputs/,grading.json,timing.json}` ([SC/SKILL.md#L165-L167](https://github.com/anthropics/skills/blob/e4bb5d960d87126ff3b3a8af1a104b7db67560ba/skills/skill-creator/SKILL.md#L165-L167), [SC/scripts/aggregate_benchmark.py#L15-L35](https://github.com/anthropics/skills/blob/e4bb5d960d87126ff3b3a8af1a104b7db67560ba/skills/skill-creator/scripts/aggregate_benchmark.py#L15-L35)).

## Core mechanisms

### 1. Input

- **Output-quality evaluation**: `evals/evals.json`, fields `skill_name`, `evals[].{id, prompt, expected_output, files, expectations}` ([SC/references/schemas.md#L7-L37](https://github.com/anthropics/skills/blob/e4bb5d960d87126ff3b3a8af1a104b7db67560ba/skills/skill-creator/references/schemas.md#L7-L37)). Each eval directory also has `eval_metadata.json`: `{eval_id, eval_name, prompt, assertions}` ([SC/SKILL.md#L188-L197](https://github.com/anthropics/skills/blob/e4bb5d960d87126ff3b3a8af1a104b7db67560ba/skills/skill-creator/SKILL.md#L188-L197)).
  - Inconsistency: the SKILL.md body and `eval_metadata.json` use `assertions`, while `schemas.md` and the grader input use `expectations`. Claude reconciles them in conversation; no code enforces it.
  - Source: drafted by Claude, confirmed by the user; assertions are drafted only while the subagents are running ([SC/SKILL.md#L199-L205](https://github.com/anthropics/skills/blob/e4bb5d960d87126ff3b3a8af1a104b7db67560ba/skills/skill-creator/SKILL.md#L199-L205)).
- **Trigger evaluation**: `[{query, should_trigger}]`. SKILL.md asks for 20 entries (8–10 positive, 8–10 negative), with negatives being "near-miss"; the user edits them in `assets/eval_review.html` and exports ([SC/SKILL.md#L337-L373](https://github.com/anthropics/skills/blob/e4bb5d960d87126ff3b3a8af1a104b7db67560ba/skills/skill-creator/SKILL.md#L337-L373)).

### 2. Session / log parsing

Does not read `~/.claude/projects`. On the output-quality side, the "transcript" is Markdown written by the subagent itself during execution (the grader input `transcript_path` points to a markdown file, [SC/agents/grader.md#L11-L17](https://github.com/anthropics/skills/blob/e4bb5d960d87126ff3b3a8af1a104b7db67560ba/skills/skill-creator/agents/grader.md#L11-L17)), with no fixed format. The trigger side only parses the live event stream of `claude -p --output-format stream-json` (see §3).

### 3. Skill trigger detection (`run_eval.py`, deterministic)

**Code path**: `main` → `run_eval` → for each query × `runs_per_query`, submit `run_single_query` to a `ProcessPoolExecutor` (10 workers by default) ([SC/scripts/run_eval.py#L184-L256](https://github.com/anthropics/skills/blob/e4bb5d960d87126ff3b3a8af1a104b7db67560ba/skills/skill-creator/scripts/run_eval.py#L184-L256)).

**`run_single_query` step by step** ([SC/scripts/run_eval.py#L35-L181](https://github.com/anthropics/skills/blob/e4bb5d960d87126ff3b3a8af1a104b7db67560ba/skills/skill-creator/scripts/run_eval.py#L35-L181)):

1. Generate a unique name `clean_name = f"{skill_name}-skill-{uuid8}"` and write `.claude/commands/<clean_name>.md` at the project root (the directory found by searching upward for `.claude/`). The content is only the frontmatter `description: |` (the description under test) + `# {skill_name}` + `This skill handles: {description}` (L51-L68). **The body of the skill under test is not included**; what is tested is only "whether the name + description gets Claude to pick it".
2. Run `claude -p <query> --output-format stream-json --verbose --include-partial-messages [--model M]`, removing `CLAUDECODE` from the environment to allow nesting (L70-L91).
3. Read stream events line by line with `select`, using these rules:
   - `stream_event/content_block_start` with block type `tool_use`: if the tool name is `Skill` or `Read`, enter a pending state; **for any other tool, `return False` immediately** (L133-L141).
   - `content_block_delta/input_json_delta`: accumulate the partial JSON; as soon as it contains `clean_name`, `return True` (L143-L148).
   - `content_block_stop`/`message_stop`: if pending, return `clean_name in accumulated_json`; reaching `message_stop` without any tool call returns False (L150-L154).
   - Fallback: for the first `tool_use` in a complete `assistant` event, check whether `input.skill` (for `Skill`) or `input.file_path` (for `Read`) contains `clean_name`, then return immediately (L157-L168); a `result` event returns the current value (L170-L171).
4. On timeout (30s by default), exit the loop and return `triggered` (usually False); `finally` kills the process and deletes the command file (L172-L181).

**Meaning**: it only determines "whether the **first** tool call is loading this skill". Running `Glob`/`Bash`/`ToolSearch` first and then loading the skill is recorded as not triggered. It judges the attempt (issuing the call), not whether the tool result succeeded.

**From single booleans to a per-query conclusion** (L213-L242):

```
trigger_rate = sum(triggers) / len(triggers)
should_trigger=True  → pass = trigger_rate >= threshold   (default 0.5)
should_trigger=False → pass = trigger_rate <  threshold
```

- A single `future.result()` that raises is recorded as `False` (not triggered) (L221-L225), so **errors count as passes for negatives and failures for positives**; there is no unknown state.
- Results are aggregated by the `query` string, so duplicate queries are merged.
- The summary has only `passed/failed/total` (L244-L256); precision/recall are printed to stderr only under `run_loop --verbose`, counted per "run" (run level): `precision = tp/(tp+fp)`, `recall = tp/(tp+fn)`, recorded as 1.0 when the denominator is 0 ([SC/scripts/run_loop.py#L154-L167](https://github.com/anthropics/skills/blob/e4bb5d960d87126ff3b3a8af1a104b7db67560ba/skills/skill-creator/scripts/run_loop.py#L154-L167)).

### 4. Grading

skill-creator has three kinds of "grading": assertion scoring (grader), blind comparison (comparator), and trigger scoring (§3, pure rules). The focus below is on the first two, and how their numbers become report metrics.

#### 4.1 Assertion scoring: grader subagent

**Who runs it**: Claude, in conversation, will "spawn a grader subagent (or grade inline) that reads `agents/grader.md`" ([SC/SKILL.md#L225](https://github.com/anthropics/skills/blob/e4bb5d960d87126ff3b3a8af1a104b7db67560ba/skills/skill-creator/SKILL.md#L225)). The model is whatever the current session/subagent uses; the scripts specify no judge model. SKILL.md also says: "For assertions that can be checked programmatically, write and run a script rather than eyeballing it", so deterministic checks are **ad-hoc scripts**, not a built-in library of assertion types.

**Input**: `expectations` (list of strings), `transcript_path`, `outputs_dir` ([SC/agents/grader.md#L11-L17](https://github.com/anthropics/skills/blob/e4bb5d960d87126ff3b3a8af1a104b7db67560ba/skills/skill-creator/agents/grader.md#L11-L17)).

**Prompt structure** (223 lines total, [SC/agents/grader.md](https://github.com/anthropics/skills/blob/e4bb5d960d87126ff3b3a8af1a104b7db67560ba/skills/skill-creator/agents/grader.md)), 8 steps: read the transcript → examine output files → grade each assertion → extract and verify implicit claims → read `user_notes.md` → critique the evals themselves → write results → read metrics/timing. Key quotes:

> You have two jobs: grade the outputs, and critique the evals themselves. A passing grade on a weak assertion is worse than useless — it creates false confidence. (L9)

> - **PASS**: Clear evidence the expectation is true AND the evidence reflects genuine task completion, not just surface-level compliance
> - **FAIL**: No evidence, or evidence contradicts the expectation, or the evidence is superficial (e.g., correct filename but empty/wrong content) (L38-L40)

> Read/examine each file relevant to the expectations. If outputs aren't plain text, use the inspection tools provided in your prompt — don't rely solely on what the transcript says the executor produced. (L30)

> **FAIL when**: … The expectation cannot be verified from available information … The output appears to meet the assertion by coincidence rather than by actually doing the work
> **When uncertain**: The burden of proof to pass is on the expectation. (L92-L99)

> - **No partial credit**: Each expectation is pass or fail, not partial (L223)

Implicit claims fall into three types, factual / process / quality; each is verified, and those that cannot be verified are flagged (L43-L59). Eval critique is raised only for a "clear gap": an assertion that would also pass an obviously wrong output, an important outcome not covered by any assertion, or an assertion that cannot be verified from the outputs (L68-L79).

**Output schema** (written to `{outputs_dir}/../grading.json`, [SC/agents/grader.md#L106-L184](https://github.com/anthropics/skills/blob/e4bb5d960d87126ff3b3a8af1a104b7db67560ba/skills/skill-creator/agents/grader.md#L106-L184)):

```json
{
  "expectations": [{"text": "...", "passed": true, "evidence": "..."}],
  "summary": {"passed": 2, "failed": 1, "total": 3, "pass_rate": 0.67},
  "execution_metrics": {"tool_calls": {...}, "total_tool_calls": 15, "total_steps": 6,
                        "errors_encountered": 0, "output_chars": 12450, "transcript_chars": 3200},
  "timing": {"executor_duration_seconds": 165.0, "grader_duration_seconds": 26.0, "total_duration_seconds": 191.0},
  "claims": [{"claim": "...", "type": "factual|process|quality", "verified": true, "evidence": "..."}],
  "user_notes_summary": {"uncertainties": [], "needs_review": [], "workarounds": []},
  "eval_feedback": {"suggestions": [{"assertion": "...", "reason": "..."}], "overall": "..."}
}
```

SKILL.md stresses that the field names must be `text/passed/evidence`: "the viewer depends on these exact field names" ([SC/SKILL.md#L225](https://github.com/anthropics/skills/blob/e4bb5d960d87126ff3b3a8af1a104b7db67560ba/skills/skill-creator/SKILL.md#L225)).

**Parsing and validation**: no JSON schema validation, and the summary is not recomputed. `load_run_results` reads each `run-*/grading.json` with `json.load` ([SC/scripts/aggregate_benchmark.py#L111-L171](https://github.com/anthropics/skills/blob/e4bb5d960d87126ff3b3a8af1a104b7db67560ba/skills/skill-creator/scripts/aggregate_benchmark.py#L111-L171)):
- Missing file → prints a Warning and **skips that run** (L115-L117); invalid JSON → Warning and skip (L122-L124). Skipped runs do not enter the denominator and are not scored 0.
- `pass_rate` is taken directly from the grader's self-reported `summary.pass_rate`, defaulting to `0.0` if missing (L130). In other words, **the run score is computed by the LLM itself and written in**; the script does not check that it equals `passed/total`.
- An expectation missing `text` or `passed` only triggers a Warning and is kept anyway (L157-L161).

**From assertions to run score**: `pass_rate = passed / total`, every assertion weighted equally, binary, no partial credit (computed by the grader).

**From runs to report metrics** (`aggregate_results`, [SC/scripts/aggregate_benchmark.py#L176-L224](https://github.com/anthropics/skills/blob/e4bb5d960d87126ff3b3a8af1a104b7db67560ba/skills/skill-creator/scripts/aggregate_benchmark.py#L176-L224)):
- Each configuration (directory name, discovered dynamically: `with_skill`, `without_skill`, `old_skill`, `new_skill`, ...) **pools all runs of all evals together** and computes `calculate_stats` for `pass_rate`, `time_seconds` and `tokens`:
  ```
  mean   = Σx / n
  stddev = sqrt(Σ(x-mean)² / (n-1))   (n>1, otherwise 0; sample standard deviation)
  min, max; all rounded to 4 places
  ```
  ([SC/scripts/aggregate_benchmark.py#L45-L64](https://github.com/anthropics/skills/blob/e4bb5d960d87126ff3b3a8af1a104b7db67560ba/skills/skill-creator/scripts/aggregate_benchmark.py#L45-L64))
- `delta = mean(configs[0]) - mean(configs[1])`, formatted as a signed string (`+.2f` / `+.1f` / `+.0f`) (L206-L222). The order of `configs` is the order of first appearance after **sorting by name** within each eval directory; `with_skill` happens to sort before `without_skill` and `new_skill` before `old_skill`, so the delta direction is "coincidentally" correct; other names could reverse it. SKILL.md only advises "Put each with_skill version before its baseline counterpart" (L232).
- stddev is the pooled dispersion across evals, **not** the variance of repeated runs of the same eval; there are no per-eval stratified statistics, no confidence intervals, and no significance tests.
- `metadata.runs_per_configuration` is **hard-coded to 3** (L271), regardless of the actual number of runs; `executor_model` and similar fields are the placeholder `<model-name>`.
- `benchmark.md` displays `mean% ± stddev%` (`generate_markdown`, from L281).

**Pseudocode**:

```
for eval in evals:                       # orchestrated by Claude
    for config in [with_skill, baseline]:
        for k in runs:                   # count decided by Claude, example 3
            outputs, transcript = spawn_subagent(config, eval.prompt)
            timing.json ← task notice(total_tokens, duration_ms)
            grading.json ← grader_llm(eval.expectations, transcript, outputs)
                           # PASS/FAIL+evidence per item; summary.pass_rate=passed/total
benchmark = aggregate_benchmark(dir):
    for config: stats(pass_rate over all (eval,run)), stats(time), stats(tokens)
    delta = mean[config0] - mean[config1]
analyzer_notes(benchmark); human_review(viewer) → feedback.json
```

#### 4.2 Blind comparison: comparator + analyzer

Used only when the user asks "is the new version really better?" ([SC/SKILL.md#L325-L331](https://github.com/anthropics/skills/blob/e4bb5d960d87126ff3b3a8af1a104b7db67560ba/skills/skill-creator/SKILL.md#L325-L331)); **no script drives it**, and its output does not go into `aggregate_benchmark`.

Key comparator rules ([SC/agents/comparator.md](https://github.com/anthropics/skills/blob/e4bb5d960d87126ff3b3a8af1a104b7db67560ba/skills/skill-creator/agents/comparator.md)):
- Inputs `output_a_path`, `output_b_path`, `eval_prompt`, optional `expectations`; "You receive two outputs labeled A and B, but you do NOT know which skill produced which" (L7).
- First **generates its own rubric** from the task: Content (Correctness/Completeness/Accuracy) and Structure (Organization/Formatting/Usability), each scored 1–5; dimensions can be adapted to the task (L37-L58).
- Scoring: "Calculate dimension totals … overall score: Average of dimension scores, scaled to 1-10" (L60-L66).
- Decision order: "Primary: Overall rubric score … Secondary: Assertion pass rates … Tiebreaker: If truly equal, declare a TIE", plus "Be decisive - ties should be rare" (L77-L85).
- Output: `{winner: "A"|"B"|"TIE", reasoning, rubric{A,B:{content{},structure{},content_score,structure_score,overall_score}}, output_quality{A,B:{score,strengths,weaknesses}}, expectation_results?}` (L95-L192).
- Note: A/B assignment and position-bias control (re-grading with the order swapped) are **not specified**; the orchestrator decides.

The analyzer (first half), after unblinding, reads both skill versions and both transcripts, gives each side an **instruction following score of 1–10** with a list of issues, and produces `winner_strengths`, `loser_weaknesses`, and `improvement_suggestions` with priority/category ([SC/agents/analyzer.md#L49-L153](https://github.com/anthropics/skills/blob/e4bb5d960d87126ff3b3a8af1a104b7db67560ba/skills/skill-creator/agents/analyzer.md#L49-L153)). The grading questions verbatim:

> - Did the agent follow the skill's explicit instructions?
> - Did the agent use the skill's provided tools/scripts?
> - Were there missed opportunities to leverage skill content?
> - Did the agent add unnecessary steps not in the skill? (L51-L55)

These four questions ask whether a skill was followed fully, partly or not at all, but the output is a 1–10 score rather than a category.

The analyzer (second half, "Analyzing Benchmark Results") produces only free-text notes, looking at five patterns per assertion: always passes on both sides (non-discriminating), always fails on both sides, passes with skill but not without, the reverse, and high variance ([SC/agents/analyzer.md#L211-L218](https://github.com/anthropics/skills/blob/e4bb5d960d87126ff3b3a8af1a104b7db67560ba/skills/skill-creator/agents/analyzer.md#L211-L218)).

#### 4.3 Human review

SKILL.md treats human feedback as central: the viewer has two tabs (Outputs for per-case feedback, Benchmark for statistics), and `feedback.json` looks like `{reviews:[{run_id, feedback, timestamp}]}`; "Empty feedback means the user thought it was fine" ([SC/SKILL.md#L253-L282](https://github.com/anthropics/skills/blob/e4bb5d960d87126ff3b3a8af1a104b7db67560ba/skills/skill-creator/SKILL.md#L253-L282)). In the next iteration, `--previous-feedback` shows the previous feedback side by side with the outputs ([SC/eval-viewer/generate_review.py#L213-L247](https://github.com/anthropics/skills/blob/e4bb5d960d87126ff3b3a8af1a104b7db67560ba/skills/skill-creator/eval-viewer/generate_review.py#L213-L247)).

### 5. Baselines and version comparison

- New skill: the baseline is `without_skill` (no skill) and stays the same across iterations. Improving an existing skill: take a `cp -r` snapshot first, and the baseline is `old_skill`; the previous iteration can also be chosen ([SC/SKILL.md#L184-L186](https://github.com/anthropics/skills/blob/e4bb5d960d87126ff3b3a8af1a104b7db67560ba/skills/skill-creator/SKILL.md#L184-L186), [#L313](https://github.com/anthropics/skills/blob/e4bb5d960d87126ff3b3a8af1a104b7db67560ba/skills/skill-creator/SKILL.md#L313)).
- Comparison method: only `delta = mean − mean` (§4.1) and an optional blind win/loss. `schemas.md` describes a `history.json` (`version/parent/expectation_pass_rate/grading_result: baseline|won|...`, [SC/references/schemas.md#L39-L84](https://github.com/anthropics/skills/blob/e4bb5d960d87126ff3b3a8af1a104b7db67560ba/skills/skill-creator/references/schemas.md#L39-L84)), but **no script reads or writes it**.
- **Description optimization loop** ([SC/scripts/run_loop.py#L47-L241](https://github.com/anthropics/skills/blob/e4bb5d960d87126ff3b3a8af1a104b7db67560ba/skills/skill-creator/scripts/run_loop.py#L47-L241)):
  1. `split_eval_set`: stratify by `should_trigger`, shuffle with `random.seed(42)`, put `max(1, int(n*holdout))` from each stratum into the test set; default holdout 0.4 (L24-L44).
  2. Each iteration sends train+test together to `run_eval` (in parallel), then splits them back into the two groups by query (L86-L119).
  3. All train cases pass → stop early; stop at `max_iterations` (default 5) (L177-L187).
  4. Otherwise call `improve_description`, passing a history with all `test_`-prefixed fields removed ("Strip test scores from history so improvement model can't see them", L194-L198).
  5. At the end, `best = max(history, key=lambda h: h["test_passed"] or 0)`, ties going to the earliest iteration; without a test set, train is used (L216-L222).
  - Key points of the rewrite prompt ([SC/scripts/improve_description.py#L79-L142](https://github.com/anthropics/skills/blob/e4bb5d960d87126ff3b3a8af1a104b7db67560ba/skills/skill-creator/scripts/improve_description.py#L79-L142)): lists "FAILED TO TRIGGER" and "FALSE TRIGGERS" (each with `triggered x/y times`), lists previous attempts and asks "do NOT repeat these — try something structurally different"; asks to "generalize from the failures to broader categories of user intent" rather than piling up specific queries; 100–200 words, hard limit of 1024 characters; returned in a `<new_description>` tag.
  - Parsing: regex extracts `<new_description>(.*?)</new_description>`, falling back to the whole output if not found (L146-L147); if over 1024 characters, another call asks for a shorter version (L163-L182). It is invoked via `claude -p --output-format text`, with the prompt on stdin (L20-L47).
  - Note: when picking the best, the test set has only 40% × 20 ≈ 8 entries, the score is an integer count, and there is no variance estimate.

### 6. Repeated runs and statistics

- Trigger: 3 runs per query by default, threshold 0.5 (2/3 needed to count as triggered) ([SC/scripts/run_eval.py#L264-L267](https://github.com/anthropics/skills/blob/e4bb5d960d87126ff3b3a8af1a104b7db67560ba/skills/skill-creator/scripts/run_eval.py#L264-L267)).
- Output quality: the number of repetitions is decided by Claude (schema example: 3); statistics are only mean / sample stddev / min / max / delta. No pass@k, confidence intervals or significance tests.

### 7. Cost / token accounting

- The source is `total_tokens` and `duration_ms` from the subagent task-completion notice, written into `timing.json` by hand by Claude; "This is the only opportunity to capture this data … isn't persisted elsewhere" ([SC/SKILL.md#L207-L219](https://github.com/anthropics/skills/blob/e4bb5d960d87126ff3b3a8af1a104b7db67560ba/skills/skill-creator/SKILL.md#L207-L219)).
- **Source bug (observed)**: `load_run_results` reads `timing.json` only when `timing.total_duration_seconds == 0` in `grading.json`, and `tokens` is assigned only in that branch ([SC/scripts/aggregate_benchmark.py#L136-L153](https://github.com/anthropics/skills/blob/e4bb5d960d87126ff3b3a8af1a104b7db67560ba/skills/skill-creator/scripts/aggregate_benchmark.py#L136-L153)). But the grader's Step 8 asks for timing to be copied into grading.json, so the duration is usually non-zero, and `tokens` falls back to `execution_metrics.output_chars` (character count of output files). As a result, "Tokens" in the report is often a character count, and the same table may mix both units.
- Trigger evaluation does not count tokens.

### 8. Rule files (CLAUDE.md/AGENTS.md)

Not applicable. Only SKILL.md is evaluated. Trigger evaluation runs `claude -p` at the current project root, so the user's CLAUDE.md and other skills are all loaded; **they affect the results but are not controlled for**. [Inferred] This means the trigger rate depends on the runner's local environment and is not portable.

### 9. Privacy and data flow

- All runs use the user's own Claude Code / `claude -p` credentials and call the Anthropic API.
- The viewer binds to `127.0.0.1` ([SC/eval-viewer/generate_review.py#L443-L449](https://github.com/anthropics/skills/blob/e4bb5d960d87126ff3b3a8af1a104b7db67560ba/skills/skill-creator/eval-viewer/generate_review.py#L443-L449)), but `viewer.html` loads resources from Google Fonts and `cdn.sheetjs.com` ([SC/eval-viewer/viewer.html#L7-L10](https://github.com/anthropics/skills/blob/e4bb5d960d87126ff3b3a8af1a104b7db67560ba/skills/skill-creator/eval-viewer/viewer.html#L7-L10)), which makes external requests but does not upload evaluation content.
- No telemetry, no team aggregation.

## Limitations (observed in source)

1. The output-quality evaluation flow depends on Claude executing SKILL.md; the number of runs, choice of baseline and wording of assertions may differ each time, so it is not reproducible.
2. Run scores are self-reported by the grader LLM, and the aggregation script does not check `pass_rate == passed/total`; missing or corrupt grading.json files are silently skipped rather than scored 0.
3. stddev pools different evals together; `runs_per_configuration` is hard-coded to 3; the delta direction depends on directory-name sorting.
4. The tokens field usually degrades to `output_chars` (see §7).
5. Trigger detection looks only at the first tool call; the temporary command file does not contain the skill body and may compete with a really installed skill of the same name; errors are recorded as not triggered; there is no unknown state.
6. `history.json` and blind-comparison results are not consumed by any program.
7. Does not read real Sessions and does not evaluate rule files.
