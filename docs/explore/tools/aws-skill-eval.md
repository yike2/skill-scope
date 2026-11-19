# aws-samples/sample-agent-skill-eval (CLI name `skill-eval`)

- Repository: <https://github.com/aws-samples/sample-agent-skill-eval>
- commit: `13b2277b300d2beafa09bbbe425ca0cc41f34c8d`, 2026-05-27
- stars: 29; language: Python; license: MIT-0
- In one sentence: a Python CLI (also shipped as a SKILL.md) that scores a skill on four dimensions, namely security audit (static scanning), functionality (with/without skill comparison + assertion grading), triggering (relevant and irrelevant queries), and cost efficiency (Pareto classification), and combines them into an A–F grade. Only a `claude -p` agent backend is implemented so far.

Permalink prefix: `AW = https://github.com/aws-samples/sample-agent-skill-eval/blob/13b2277b300d2beafa09bbbe425ca0cc41f34c8d`.

## Features

| Command | Purpose | Needs agent |
|---|---|---|
| `audit <paths...>` | Static security scan (secrets, injection, unsafe install methods, permissions) + structural checks, scored out of 100 (`--fail-on-warning`, `--min-score`, `--ignore`, `--allowlist`, `--format html`) | No |
| `init <skill>` | Generates `evals/evals.json` and `evals/eval_queries.json` templates | No |
| `snapshot` / `regression` | Saves audit findings as a baseline; compares against the baseline, treating any new finding as a regression | No |
| `functional <skill>` | Runs each case once with and once without the skill, grades assertions, computes 4 dimension scores and a Pareto classification (`--runs` default 1) | Yes |
| `trigger <skill>` | Runs each query N times (default 3) and computes the activation rate | Yes |
| `report <skill>` | Weighted total of audit 40% + functional 40% + trigger 20% + letter grade | Yes |
| `compare <A> <B>` | Runs two skills on the same cases and picks the winner by "tokens consumed per passing assertion" | Yes |
| `lifecycle [--save] [--history] [--auto-regression]` | SHA-256 fingerprints the skill files, detects version changes, and can automatically trigger audit regression | No |

Subcommand definitions: [AW/skill_eval/cli.py#L123-L260](https://github.com/aws-samples/sample-agent-skill-eval/blob/13b2277b300d2beafa09bbbe425ca0cc41f34c8d/skill_eval/cli.py#L123-L260).

## Architecture and data flow

```
evals/evals.json ─_load_evals─▶ EvalCase{id,prompt,files,assertions}
evals/eval_queries.json ─_load_queries─▶ TriggerQuery{query,should_trigger}
          │
AgentRunner(ClaudeRunner).run_prompt(prompt, skill_path?) ─ subprocess `claude -p … [--append-system-prompt SKILL.md]`
          │  parse_output(stream-json) → {events, tool_calls[], text, token_counts}
          ├─ functional: grade_output(text, assertions) ─ deterministic rules ▶ remaining assertions batched to a `claude -p` judge
          │       → GradingResult.pass_rate → _aggregate_benchmark → 4 dimension scores + Pareto + passed
          ├─ trigger:    _classify_trigger_signal(parsed) → tool/text/none → trigger_rate → passed(≥0.5)
          └─ compare:    both skills run with skill → tokens_per_passing_assertion
          ▼
benchmark.json / trigger_report.json (written back to <skill>/evals/ by default) → unified_report.compute_weighted_score
```

Key files: [agent_runner.py](https://github.com/aws-samples/sample-agent-skill-eval/blob/13b2277b300d2beafa09bbbe425ca0cc41f34c8d/skill_eval/agent_runner.py), [functional.py](https://github.com/aws-samples/sample-agent-skill-eval/blob/13b2277b300d2beafa09bbbe425ca0cc41f34c8d/skill_eval/functional.py), [grading.py](https://github.com/aws-samples/sample-agent-skill-eval/blob/13b2277b300d2beafa09bbbe425ca0cc41f34c8d/skill_eval/grading.py), [trigger.py](https://github.com/aws-samples/sample-agent-skill-eval/blob/13b2277b300d2beafa09bbbe425ca0cc41f34c8d/skill_eval/trigger.py), [compare.py](https://github.com/aws-samples/sample-agent-skill-eval/blob/13b2277b300d2beafa09bbbe425ca0cc41f34c8d/skill_eval/compare.py), [unified_report.py](https://github.com/aws-samples/sample-agent-skill-eval/blob/13b2277b300d2beafa09bbbe425ca0cc41f34c8d/skill_eval/unified_report.py).

## Core mechanisms

### 1. Input: test cases

- `evals/evals.json`: an array of `{id, prompt, expected_output?, files?, assertions?}`, with `id` and `prompt` required ([AW/skill_eval/eval_schemas.py#L14-L28](https://github.com/aws-samples/sample-agent-skill-eval/blob/13b2277b300d2beafa09bbbe425ca0cc41f34c8d/skill_eval/eval_schemas.py#L14-L28), [functional.py#L195-L211](https://github.com/aws-samples/sample-agent-skill-eval/blob/13b2277b300d2beafa09bbbe425ca0cc41f34c8d/skill_eval/functional.py#L195-L211)). `assertions` are natural-language strings; those matching fixed phrasings are graded deterministically (see 4.2). `files` are relative to the evals directory and copied flat by filename into the workspace. `expected_output` is read in but never used.
- `evals/eval_queries.json`: an array `[{query, should_trigger}]` ([trigger.py#L122-L140](https://github.com/aws-samples/sample-agent-skill-eval/blob/13b2277b300d2beafa09bbbe425ca0cc41f34c8d/skill_eval/trigger.py#L122-L140)).

### 2. Session / log parsing

Parses only the output of its own `claude -p --output-format stream-json --verbose` calls. `ClaudeRunner.parse_output()` ([AW/skill_eval/agent_runner.py#L216-L304](https://github.com/aws-samples/sample-agent-skill-eval/blob/13b2277b300d2beafa09bbbe425ca0cc41f34c8d/skill_eval/agent_runner.py#L216-L304)) handles two formats:
- Raw Anthropic stream: `content_block_start{tool_use}`, `content_block_delta{text_delta}`, `message_start/message_delta.usage`;
- Claude CLI stream-json: `tool_use{name,input,id}` and `text` in `assistant.message.content[]`; `result.usage` and `result.result` (used only when there is no other text).

It doesn't read `tool_result`, so it **cannot tell whether a tool call succeeded**. There are no adapters for other agents; `register_runner()` is left as an extension point ([#L311-L347](https://github.com/aws-samples/sample-agent-skill-eval/blob/13b2277b300d2beafa09bbbe425ca0cc41f34c8d/skill_eval/agent_runner.py#L311-L347)).

### 3. Skill trigger detection (focus)

**Premise: the skill is not installed for the agent to discover; instead the full SKILL.md is appended to the system prompt** ([agent_runner.py#L125-L170](https://github.com/aws-samples/sample-agent-skill-eval/blob/13b2277b300d2beafa09bbbe425ca0cc41f34c8d/skill_eval/agent_runner.py#L125-L170)):

```
claude -p <prompt> --permission-mode bypassPermissions
       --allowedTools Read Glob Grep Bash Write Edit
       --append-system-prompt "<full SKILL.md>\n\n---\nNote: The skill's scripts/, references/, and assets/ directories are available in your current working directory. You can execute scripts directly, e.g. `python3 scripts/example.py`."
```

A comment explains why: Claude Code has no `--plugin-dir`, and this approach avoids depending on symlinks in `~/.claude/skills/`, which suits CI. The consequence: **the `trigger` command does not test "whether the description gets the agent to select the skill"**, because the skill's full instructions are already in context every time; it tests "after receiving the skill's instructions, does the agent show traces of acting on the skill". `trigger` passes `skill_path` on every run ([trigger.py#L179-L184](https://github.com/aws-samples/sample-agent-skill-eval/blob/13b2277b300d2beafa09bbbe425ca0cc41f34c8d/skill_eval/trigger.py#L179-L184)), so negative queries carry SKILL.md too. The README calls this "Trigger precision — does the skill activate when it should?", which doesn't match the implementation. trigger runs don't set workspace_dir; cwd is inherited from the caller.

`_classify_trigger_signal()` ([trigger.py#L260-L377](https://github.com/aws-samples/sample-agent-skill-eval/blob/13b2277b300d2beafa09bbbe425ca0cc41f34c8d/skill_eval/trigger.py#L260-L377)) returns `tool` / `text` / `none`. The skill name is the **directory name** (`skill_path.name`), not the frontmatter name. Tool calls are checked one by one, returning on the first hit:
1. `name.lower()=="skill"` → `tool`. **Any** Skill tool call counts; it doesn't check whether `input.skill` is this skill;
2. `Read` with `file_path` containing `"SKILL.md"` → `tool`, again without checking whose SKILL.md it is;
3. `Bash/shell/terminal`:
   - a filename under `scripts/` appears in the command **and** one of the execution prefixes `python3 `/`python `/`bash `/`sh `/`./`/`node ` appears anywhere in the command, or `scripts/<file>` appears → `tool`;
   - regex `(?:^|[|;&]\s*)<skill_name>(?:\s|$)`: the skill name used as a command;
   - `-m <skill_name in underscore form>`: invoked as a Python module;
   - the command contains the skill's absolute path;
4. When none of the above hit, check text (weak signal): `skill:<name>`, `using <name>`, `\b<name>\b`, or `scripts/<file>` appearing in text → `text`.

The result is used asymmetrically ([trigger.py#L199-L208](https://github.com/aws-samples/sample-agent-skill-eval/blob/13b2277b300d2beafa09bbbe425ca0cc41f34c8d/skill_eval/trigger.py#L199-L208)):
- `should_trigger=true`: `signal != "none"` counts as triggered, **so mentioning the skill name in text counts too**;
- `should_trigger=false`: only `signal == "tool"` counts as triggered (comment's rationale: text mentions in negative cases are too noisy).

No distinction between attempt and success, because `tool_result` isn't parsed at all.

### 4. Grading (focus)

#### 4.1 functional scoring path (step by step)

`run_functional_eval()` → runs `_execute_eval_pair()` `runs_per_eval` times per case ([functional.py#L107-L114](https://github.com/aws-samples/sample-agent-skill-eval/blob/13b2277b300d2beafa09bbbe425ca0cc41f34c8d/skill_eval/functional.py#L107-L114)):

1. Create two temp directories: `skill-eval-with-*` and `skill-eval-without-*`. Both get `files`; **only the with side** gets the skill's `scripts/ references/ assets/`, `SKILL.md` and the skill's own `.claude/` directory ([functional.py#L247-L289](https://github.com/aws-samples/sample-agent-skill-eval/blob/13b2277b300d2beafa09bbbe425ca0cc41f34c8d/skill_eval/functional.py#L247-L289)).
2. With side: `run_prompt(prompt, skill_path=…)`, SKILL.md injected via `--append-system-prompt`, with another copy of SKILL.md in the workspace; without side: `skill_path=None`, cwd is a clean directory ([#L291-L309](https://github.com/aws-samples/sample-agent-skill-eval/blob/13b2277b300d2beafa09bbbe425ca0cc41f34c8d/skill_eval/functional.py#L291-L309)). Neither side adds anything like "must / must not use the skill" to the prompt. The with side **also doesn't check whether the skill was actually used**.
3. **Return codes, timeouts and stderr are all ignored**: on timeout `run_prompt` returns `("", "Timed out…", -1, t)` ([agent_runner.py#L207-L214](https://github.com/aws-samples/sample-agent-skill-eval/blob/13b2277b300d2beafa09bbbe425ca0cc41f34c8d/skill_eval/agent_runner.py#L207-L214)), `parse_output("")` yields empty text, and it is scored as usual.
4. `grade_output(text, assertions)` scores each side's **final assistant text** ([functional.py#L311-L316](https://github.com/aws-samples/sample-agent-skill-eval/blob/13b2277b300d2beafa09bbbe425ca0cc41f34c8d/skill_eval/functional.py#L311-L316)). **It doesn't look at the filesystem**: files the agent wrote and commands it ran play no part in grading unless the agent restates them in its reply.
5. Each run yields `GradingResult{pass_rate, assertion_results, execution_metrics{tool_calls, token_counts}, timing, raw_output[:2000]}`; after pairing, `delta_pass_rate = with − without` is computed ([#L318-L354](https://github.com/aws-samples/sample-agent-skill-eval/blob/13b2277b300d2beafa09bbbe425ca0cc41f34c8d/skill_eval/functional.py#L318-L354)).
6. `_aggregate_benchmark()` aggregates; see 4.4.

Pseudocode:

```
for case in evals, r in 1..runs(=1):
  with_ws  = files + scripts/references/assets + SKILL.md + .claude/
  without_ws = files
  tw = text(claude -p prompt --append-system-prompt SKILL.md, cwd=with_ws)   # rc/timeout ignored
  to = text(claude -p prompt, cwd=without_ws)
  for side in (tw, to):
    det = [rule(a) for a in assertions if rule matches]
    llm = claude -p judge(side[:16000], remaining assertions)   # one batched call
    pass_rate = #passed / #assertions   (no assertions → 1.0)
mean_with, mean_without, stddev
passed = mean_with >= mean_without AND mean_with >= 0.5
```

#### 4.2 Deterministic assertions

`_deterministic_grade()` ([AW/skill_eval/grading.py#L56-L201](https://github.com/aws-samples/sample-agent-skill-eval/blob/13b2277b300d2beafa09bbbe425ca0cc41f34c8d/skill_eval/grading.py#L56-L201)) lowercases the assertion and matches it against phrasings; a hit returns `AssertionResult{passed, evidence, method:'deterministic'}`, otherwise None, handing it to the LLM:
- `contains X` / `contains "X"`: case-insensitive substring match;
- `does not contain X`;
- `is valid json` / `output is valid json`: `json.loads` on the **entire output**;
- `has at least N lines`;
- `starts with X` / `ends with X` (trimmed, case-insensitive);
- `matches regex /X/` / `matches pattern /X/`: `re.search` using the assertion in its original case; an invalid regex is a fail;
- compound `A or B or …`: when every branch is one of the above phrasings, passes if any passes.

Note: when the agent fails and output is empty, `does not contain X` **passes**.

#### 4.3 LLM judge (`claude -p`)

`_llm_grade()` ([grading.py#L208-L322](https://github.com/aws-samples/sample-agent-skill-eval/blob/13b2277b300d2beafa09bbbe425ca0cc41f34c8d/skill_eval/grading.py#L208-L322)): all assertions that couldn't be graded deterministically are merged into **one** call; output is truncated to 16000 characters. Full prompt ([#L236-L262](https://github.com/aws-samples/sample-agent-skill-eval/blob/13b2277b300d2beafa09bbbe425ca0cc41f34c8d/skill_eval/grading.py#L236-L262)):

```
You are an evaluation judge. Determine whether each assertion is satisfied by the given output.

OUTPUT:
{truncated}

ASSERTIONS:
  1. ...
  2. ...

Respond with ONLY a JSON array where each element has:
  {"index": <1-based>, "passed": true/false, "confidence": 0.0-1.0, "evidence": "brief reason"}

Here are examples of how to judge assertions:

Example 1 (PASS with high confidence):
  Output: "The weather in Tokyo is 22°C and sunny"
  Assertion: "mentions temperature"
  Result: {"index": 1, "passed": true, "confidence": 0.95, "evidence": "output explicitly states 22°C"}

Example 2 (FAIL with high confidence):
  Output: "Here is your CSV summary"
  Assertion: "includes a bar chart"
  Result: {"index": 1, "passed": false, "confidence": 0.9, "evidence": "output only contains CSV summary, no bar chart"}

Example 3 (UNCERTAIN - low confidence):
  Output: "The data shows an upward trend with some fluctuations"
  Assertion: "provides statistical analysis"
  Result: {"index": 1, "passed": true, "confidence": 0.4, "evidence": "mentions trend but lacks formal statistical measures"}
```

- The judge model is simply the local `claude -p` default model, with no `--model` passed, so results aren't reproducible; `run_claude_prompt(prompt, timeout)` is called **without workspace_dir**, so the judge runs in the caller's cwd, with `bypassPermissions` and the Read/Bash/Write/Edit tools (the same command construction as the agent under test, [agent_runner.py#L164-L170](https://github.com/aws-samples/sample-agent-skill-eval/blob/13b2277b300d2beafa09bbbe425ca0cc41f34c8d/skill_eval/agent_runner.py#L164-L170)). Judge output is stdout in `text` format.
- Output schema: `[{index, passed, confidence, evidence}]`.
- Parsing: takes the content from the first `[` to the last `]` in stdout and runs `json.loads`; **aligns by `index`** (`index == i+1`); no matching entry → that assertion fails ("LLM judge did not return result for this assertion"); `confidence` defaults to 1.0, `uncertain = confidence < 0.5` ([#L279-L312](https://github.com/aws-samples/sample-agent-skill-eval/blob/13b2277b300d2beafa09bbbe425ca0cc41f34c8d/skill_eval/grading.py#L279-L312)). **`uncertain` is only stored; nothing in the repository reads it**; a low-confidence `passed:true` counts as a pass as usual.
- Failure handling: claude unavailable, rc≠0 or empty stdout, JSON parse failure → **all assertions in the batch `passed:false`**, with the reason in evidence. No retry.
- Result order: deterministic results first, LLM results after, which doesn't match the original assertion order.

#### 4.4 From assertions to scores and conclusions

- Single run: `pass_rate = #passed / #results`; 1.0 when there are no assertions ([grading.py#L45-L49](https://github.com/aws-samples/sample-agent-skill-eval/blob/13b2277b300d2beafa09bbbe425ca0cc41f34c8d/skill_eval/grading.py#L45-L49)).
- Aggregation ([functional.py#L357-L497](https://github.com/aws-samples/sample-agent-skill-eval/blob/13b2277b300d2beafa09bbbe425ca0cc41f34c8d/skill_eval/functional.py#L357-L497)): `mean_with` / `mean_without` are averages of pass_rate over all runs (weighted by run, not by case), with sample standard deviation using n−1.
- **4 dimension scores** ([#L413-L417](https://github.com/aws-samples/sample-agent-skill-eval/blob/13b2277b300d2beafa09bbbe425ca0cc41f34c8d/skill_eval/functional.py#L413-L417), [#L477-L483](https://github.com/aws-samples/sample-agent-skill-eval/blob/13b2277b300d2beafa09bbbe425ca0cc41f34c8d/skill_eval/functional.py#L477-L483)):
  - `outcome = mean_with`;
  - `process = min(1, mean_tool_calls_with / max(1, mean_tool_calls_without))`. **More** tool calls score higher, a questionable meaning;
  - `style = mean_with`, identical to outcome (comment: "Use pass rate as proxy");
  - `efficiency`: `r = (p_w/t_w)/(p_wo/t_wo)`, `clamp(2r/(1+r), 0, 1)`; when `p_wo=0`, it is 1.0 if the with side has any pass, otherwise 0.5 ([#L500-L524](https://github.com/aws-samples/sample-agent-skill-eval/blob/13b2277b300d2beafa09bbbe425ca0cc41f34c8d/skill_eval/functional.py#L500-L524));
  - `overall = mean of the four`. In effect pass rate carries half the weight.
- **Pass condition**: `passed = mean_with >= mean_without and mean_with >= 0.5` ([#L420](https://github.com/aws-samples/sample-agent-skill-eval/blob/13b2277b300d2beafa09bbbe425ca0cc41f34c8d/skill_eval/functional.py#L420)); `passed` determines the exit code (0/1).
- **Pareto cost classification** `classify_cost_efficiency(Δquality, Δcost%)` ([#L139-L188](https://github.com/aws-samples/sample-agent-skill-eval/blob/13b2277b300d2beafa09bbbe425ca0cc41f34c8d/skill_eval/functional.py#L139-L188)): `Δq ≤ −0.05` → REJECT; `Δq≥0 & Δc≤0` → PARETO_BETTER; `Δq>0 & Δc>0` → TRADEOFF; `Δq≤0 & Δc<0` → CHEAPER_BUT_WEAKER; everything else → PARETO_WORSE. Δc is computed from total tokens (input+output, excluding cache).
- **trigger scoring** ([trigger.py#L161-L239](https://github.com/aws-samples/sample-agent-skill-eval/blob/13b2277b300d2beafa09bbbe425ca0cc41f34c8d/skill_eval/trigger.py#L161-L239)): `trigger_rate = trigger_count / runs`; positive cases need `≥ 0.5` to pass, negative cases `< 0.5`. **Runs with rc≠0 or empty output don't count as triggered but stay in the denominator**, so agent errors or timeouts make negative cases easier to pass and positive cases harder. In the summary, `trigger_precision = positive passes / positives` (actually recall), `no_trigger_precision = negative passes / negatives` (actually specificity); `report.passed` requires all queries to pass ([#L392-L443](https://github.com/aws-samples/sample-agent-skill-eval/blob/13b2277b300d2beafa09bbbe425ca0cc41f34c8d/skill_eval/trigger.py#L392-L443)). Positives and negatives are reported separately.
- **Unified report** ([AW/skill_eval/unified_report.py#L42-L66](https://github.com/aws-samples/sample-agent-skill-eval/blob/13b2277b300d2beafa09bbbe425ca0cc41f34c8d/skill_eval/unified_report.py#L42-L66)): `overall = Σ s_i·w_i / Σ w_i`, where w = audit 0.4, functional 0.4, trigger 0.2, and skipped items are left out of the weights; audit score = `(100 − 25·CRITICAL − 10·WARNING − 2·INFO)/100` ([AW/skill_eval/schemas.py#L107-L117](https://github.com/aws-samples/sample-agent-skill-eval/blob/13b2277b300d2beafa09bbbe425ca0cc41f34c8d/skill_eval/schemas.py#L107-L117)); functional uses `scores.overall`; trigger uses `passed/total_queries` ([unified_report.py#L286-L323](https://github.com/aws-samples/sample-agent-skill-eval/blob/13b2277b300d2beafa09bbbe425ca0cc41f34c8d/skill_eval/unified_report.py#L286-L323)); letter-grade cutoffs are 0.9/0.8/0.7/0.6.

### 5. Baselines and version comparison

- **with/without**: see 4.1. Key points: (a) the with side puts SKILL.md in the system prompt, effectively "force loading" it rather than letting the agent choose; (b) the without side has neither the skill in the system prompt nor skill files in the workspace; (c) it doesn't verify the with side acted on the skill; (d) each pair runs only once (default `--runs 1`).
- **compare A B** ([AW/skill_eval/compare.py#L165-L349](https://github.com/aws-samples/sample-agent-skill-eval/blob/13b2277b300d2beafa09bbbe425ca0cc41f34c8d/skill_eval/compare.py#L165-L349)): both skills run with skill; the eval set defaults to A's evals.json, and the workspace contains only `files` (scripts/ is not copied). Winner rule: `tppa = mean total tokens / total passing assertions`; a winner is declared only if the ratio exceeds 1.05, otherwise tie ([#L303-L320](https://github.com/aws-samples/sample-agent-skill-eval/blob/13b2277b300d2beafa09bbbe425ca0cc41f34c8d/skill_eval/compare.py#L303-L320)). In other words **the winner is decided by cost efficiency, not quality**: if A has a higher pass rate but is more expensive, B may win.
- **regression / lifecycle**: cover only the **static audit**. regression keys on `(code, file, line, title)` and compares added and removed findings ([AW/skill_eval/regression.py#L232-L300](https://github.com/aws-samples/sample-agent-skill-eval/blob/13b2277b300d2beafa09bbbe425ca0cc41f34c8d/skill_eval/regression.py#L232-L300)); lifecycle SHA-256s all non-hidden files in the skill directory and combines them into one fingerprint ([AW/skill_eval/lifecycle.py#L67-L120](https://github.com/aws-samples/sample-agent-skill-eval/blob/13b2277b300d2beafa09bbbe425ca0cc41f34c8d/skill_eval/lifecycle.py#L67-L120)). No version comparison of functional or trigger results.

### 6. Repeated runs and statistics

functional defaults to 1 run, trigger to 3 per query. Only mean and stddev; no pass@k, intervals or tests.

### 7. Cost / token accounting

Tokens come from stream-json `result.usage` (and message_start/delta), `total = input + output`, with cache recorded separately and not included in total ([agent_runner.py#L79-L84](https://github.com/aws-samples/sample-agent-skill-eval/blob/13b2277b300d2beafa09bbbe425ca0cc41f34c8d/skill_eval/agent_runner.py#L79-L84)). Money is estimated from a hard-coded price table, defaulting to "sonnet" at $3/$15 per million tokens ([AW/skill_eval/cost.py#L11-L22](https://github.com/aws-samples/sample-agent-skill-eval/blob/13b2277b300d2beafa09bbbe425ca0cc41f34c8d/skill_eval/cost.py#L11-L22)); judge usage is not tracked; duration and tool-call counts are also recorded.

### 8. Rule files

Not applicable. The with side copies the skill directory's `.claude/` (settings, MCP, etc.), but CLAUDE.md entries are not involved.

### 9. Privacy and data flow

Runs locally; data leaves only through `claude -p` model calls (agent under test and judge). Reports are written back to `<skill>/evals/` by default (benchmark.json, trigger_report.json), with optional HTML output. No telemetry.

## Limitations (observed in source)

1. trigger injects SKILL.md into the system prompt every time, so it can't measure the "description selection" step; the README's "activate when it should" doesn't match the implementation.
2. Trigger rules are too broad: any Skill call, reading any SKILL.md, or a command containing both a script name and any execution prefix counts as a trigger; for positive cases even a text mention counts.
3. functional grades only the final text and can't see files or commands; when the agent fails or times out, the empty text is scored as usual (`does not contain` passes).
4. The judge runs in the caller's cwd with write permissions and bypassPermissions, and the model isn't pinned; the `uncertain` flag is ignored; judge failures collapse into fails.
5. Among the 4 dimension scores, style duplicates outcome and process rewards more tool calls; default 1 run, no statistical tests.
6. compare decides winners by token efficiency; regression and lifecycle cover only the static audit.
7. Only a Claude Code adapter exists.
