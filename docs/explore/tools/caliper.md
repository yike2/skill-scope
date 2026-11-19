# Caliper (edonadei/caliper)

- Repository: <https://github.com/edonadei/caliper>
- commit: `d4515192ee6e180ec6d789949d1c4db3da676b35` (2026-11-15)
- stars: 236 / language: Python / license: MIT / PyPI: `caliper-eval`
- In one sentence: runs the tasks in a `.eval.yaml` through real agent CLIs (claude-code, codex, opencode, pi, hermes, antigravity) in throwaway working directories, k times per task. Skills are only "installed", never "preloaded"; the agent has to discover them itself. Each attempt yields a typed Outcome, and two scoreboards are kept strictly separate: execution (`expect:` LLM judge / `assert:` Python) and activation (`activates:` exact set match). `--ablate` produces a control-group run, and `caliper compare` then compares task by task.

All links below are permalinks to the commit above.

## Features

| Command / component | Purpose |
|---|---|
| `caliper run <spec>` | Runs a spec: `--k` (default 3), `--workers` (default 4, parallelized per attempt), `--timeout` (default 120 seconds per attempt), `--fail-fast N` (stop a task after N consecutive infra_error/timeout), `--ablate <skill|mcp:server|skill:name>` (repeatable), `--model backend:model[@effort]`, `--judge-model`, `--no-user-customizations` ([commands/run.py L83-L130](https://github.com/edonadei/caliper/blob/d4515192ee6e180ec6d789949d1c4db3da676b35/caliper/commands/run.py#L83-L130)) |
| `caliper compare A B` | Compares two saved runs, `--format json`; **deliberately has no threshold flag and does not express a verdict through the exit code** ([commands/compare.py L70-L74](https://github.com/edonadei/caliper/blob/d4515192ee6e180ec6d789949d1c4db3da676b35/caliper/commands/compare.py#L70-L74)) |
| `caliper report` / `list` / `validate` | Render saved results, list specs and past runs, validate a spec |
| `caliper login/logout` | Lets codex log in with a ChatGPT subscription |
| `caliper telemetry` | Toggle for anonymous usage telemetry (PostHog; on by default, prompted on first run, off by default in CI) |
| Exit codes | 0 OK; 1 input error; 2 could not run cleanly (including when no attempt was usable); 3 reserved for "declared threshold not met" (README "Exit codes") |
| Bundled skills | `grill-skill` (generates a spec through an interview), `evaluate-skill` (runs run/validate on your behalf), `hillclimb-skill` (the agent iterates on SKILL.md itself: stratified train/held-out split + noise floor, see [hillclimb-skill/REFERENCE.md L58-L68](https://github.com/edonadei/caliper/blob/d4515192ee6e180ec6d789949d1c4db3da676b35/skills/hillclimb-skill/REFERENCE.md#L58-L68)) |

## Architecture and data flow

```
.eval.yaml ──► EvalSpec / TaskSpec (schema/spec.py)
   │ environment.py: resolves skills: (path or git), mcp:, ablation, user customizations
   ▼
runner.py: fresh workdir per (task, attempt) (ADR 0046), installs skills into the backend's native skills root
   │  setup: hook → harness.run (CLI subprocess; retried on rate limit, invocations merged into 1 attempt, ADR 0019)
   ▼
harness/<backend>.py: parses the CLI's streaming output → AttemptResult{transcript: [ConversationTurn], usage, exit_code, timed_out, refusal, ...}
   ▼
attempt.py: assemble_attempt  ← the only place an Outcome is decided
   │  _classify_pre_judge → ActivationDetector.detect → Sandbox.violations(cheat) → NOT_CHECKED → EvalJudge.evaluate
   ▼
schema/results.py: AttemptRecord → TaskResult (all metrics derived from attempts) → AggregateScore → RunResults (JSON)
   ▼
compare.py: diff_runs(a, b) → RunComparison (per-task delta, regression, various mismatch warnings)
```

## Core mechanisms

### 1. Input: test cases

Fields of `TaskSpec` ([schema/spec.py L157-L232](https://github.com/edonadei/caliper/blob/d4515192ee6e180ec6d789949d1c4db3da676b35/caliper/schema/spec.py#L157-L232)): `name` (stable identifier across runs), `prompt`, `expect?` (description of the expectation handed to the LLM judge), `assert?` (the YAML field name is `assert`; inline Python or `./check.py`), `activates?: list[str]` (`None` means no assertion, `[]` means nothing is expected to fire), `history?` (pre-seeded conversation history, ADR 0036), `setup?` / `cleanup?`. `extra="forbid"` prevents typos like `asert:` from silently dropping a check; `expect` and `assert` cannot be empty; at least one of `expect`, `assert`, `activates` is required. At the `EvalSpec` level there are also `skills:` (the "neighbourhood", a set of peer skills), `sandbox.forbidden_files` (regex), `mcp:`, `user_customizations`.

### 2. Session / log parsing

Each backend parses its CLI's stream into a uniform `ConversationTurn(role ∈ user/assistant/tool_use/tool_result, tool_name, tool_input, tool_output)`:
- **claude-code**: `claude -p --output-format stream-json --verbose --dangerously-skip-permissions --mcp-config …`, plus `--strict-mcp-config --settings {"syncClaudeAiSkills":false,...}` in isolated mode. Reads `text` / `tool_use{name,input}` from `assistant.message.content[]`, `tool_result` blocks from `user`, `result` (final answer, `is_error`, usage), and `system/init` (MCP servers and exposed skills) ([harness/claude_code.py L330-L370](https://github.com/edonadei/caliper/blob/d4515192ee6e180ec6d789949d1c4db3da676b35/caliper/harness/claude_code.py#L330-L370), [L643-L717](https://github.com/edonadei/caliper/blob/d4515192ee6e180ec6d789949d1c4db3da676b35/caliper/harness/claude_code.py#L643-L717)).
- **codex**: `codex exec --json`. In `item.completed`, `agent_message` becomes an assistant turn, `command_execution{command, aggregated_output, exit_code}` becomes `tool_name="shell"`, and MCP calls become qualified names; the last `turn.completed.usage` is taken ([harness/codex.py L286-L330](https://github.com/edonadei/caliper/blob/d4515192ee6e180ec6d789949d1c4db3da676b35/caliper/harness/codex.py#L286-L330)).
- antigravity / opencode / pi / hermes each have their own `_read_stream`.

### 3. Skill trigger detection (`activation.py`, 164 lines total)

Rules ([activation.py L1-L23](https://github.com/edonadei/caliper/blob/d4515192ee6e180ec6d789949d1c4db3da676b35/caliper/activation.py#L1-L23), [L61-L104](https://github.com/edonadei/caliper/blob/d4515192ee6e180ec6d789949d1c4db3da676b35/caliper/activation.py#L61-L104)): iterate over every turn with a non-empty `tool_input`, taking the **union of two conditions**:
1. `turn.tool_name ∈ backend.activation_tool_names`, and the value of one of the keys `skill` / `name` / `skill_name` in `tool_input` is a declared skill name. Tool names per backend: claude-code is `{"Skill"}` ([claude_code.py L105](https://github.com/edonadei/caliper/blob/d4515192ee6e180ec6d789949d1c4db3da676b35/caliper/harness/claude_code.py#L105)), opencode is `{"skill"}`, hermes is `{"skill_view"}`; codex, pi and antigravity are empty sets and can rely only on condition 2.
2. Recursively (depth at most 5) extract every string in `tool_input` and regex-match a `<name>/SKILL.md` **suffix**: it must be preceded by line start, `/`, `\`, whitespace or a quote, and must not be followed by `.?[\w/\\-]`, which excludes `SKILL.md.bak` and `some-unit-normalizer/SKILL.md` ([L36-L44](https://github.com/edonadei/caliper/blob/d4515192ee6e180ec6d789949d1c4db3da676b35/caliper/activation.py#L36-L44)). Only the suffix is matched because codex sometimes emits absolute paths and sometimes relative ones. Plugin skills use a namespaced path pattern, and the match is removed from the string first so it is not double-counted as a declared skill of the same name.

Three meanings of the return value: `None` means "not observable" (no skills installed, so nothing to choose from); `[]` means "skills were available but none was used"; otherwise a sorted list of names. `check_activation(observed, expected)`: returns None (no verdict) if either is None, otherwise performs an **exact set equality** comparison ([L154-L164](https://github.com/edonadei/caliper/blob/d4515192ee6e180ec6d789949d1c4db3da676b35/caliper/activation.py#L154-L164)). There is also `detect_builtin`, which uses the same rule to count the CLI's built-in skills, for display only, not scored.

It detects only "attempts", not "successes": a failed tool call still counts as an activation (the code does not look at tool_result).

### 4. Grading

#### 4.1 Attempt decision order (`assemble_attempt`, [attempt.py L70-L218](https://github.com/edonadei/caliper/blob/d4515192ee6e180ec6d789949d1c4db3da676b35/caliper/attempt.py#L70-L218))

```
assemble_attempt(ended, task, expected_activation, activation, sandbox, judge):
  if ended is SetupFailed:  return INFRA_ERROR(evidence="setup exited 7"/"timed out")   # the agent never ran
  if result.cancelled:      return None                                               # killed by user Ctrl-C: no record kept
  pre = _classify_pre_judge(result)            # L257-L295
        timed_out                → TIMEOUT
        exit_code != 0           → INFRA_ERROR
        refusal (rate-limit/quota problem reported by the CLI itself) → INFRA_ERROR
        no answer parsed and tokens == 0       → INFRA_ERROR ("no model call observed")
  observed = activation.detect(transcript, +user skills)
  if pre is None: activated = observed; activation_passed = check_activation(observed, expected)
  else:           activated = observed or None; activation_passed = None    # transcript may be truncated: no verdict
  if pre:                        return pre.outcome
  if sandbox.violations(transcript): return CHEAT(cheat_evidence=matched path)
  if not (task.expect or task.assert_script): return NOT_CHECKED          # tasks with only activates:
  jr = judge.evaluate(task, transcript, workdir, history)
  return JUDGE_ERROR if jr.errored else (PASS if jr.passed else TASK_FAIL)
```

The activation result **does not affect** the Outcome: `activation_passed` is a separate field that feeds the second scoreboard. Cheat detection ([sandbox.py L112-L126](https://github.com/edonadei/caliper/blob/d4515192ee6e180ec6d789949d1c4db3da676b35/caliper/sandbox.py#L112-L126), [L155-L180](https://github.com/edonadei/caliper/blob/d4515192ee6e180ec6d789949d1c4db3da676b35/caliper/sandbox.py#L155-L180)) extracts every "path-like string" from tool_input (under a path-type key, or containing `/` or `.`); if any matches a `forbidden_files` regex, the spec file's own path, or the saved results directory, the attempt is judged CHEAT. The read itself counts as cheating, regardless of whether it succeeded.

#### 4.2 `EvalJudge.evaluate` ([judge/eval_judge.py L342-L380](https://github.com/edonadei/caliper/blob/d4515192ee6e180ec6d789949d1c4db3da676b35/caliper/judge/eval_judge.py#L342-L380))

```
assert_passed = _run_assert_from_task(task, workdir)   # runs the static assert: in the attempt workdir, 30-second limit
autorater_passed = None
if task.expect:
    v = _llm_evaluate(...)
    autorater_passed = None if v.errored else v.passed
checks = [c for c in (assert_passed, autorater_passed) if c is not None]     # "Rule B"
passed  = all(checks) if checks else False
errored = not checks                                                           # judge_error only when neither check gave a verdict
```

`_run_inline_script` ([L180-L194](https://github.com/edonadei/caliper/blob/d4515192ee6e180ec6d789949d1c4db3da676b35/caliper/judge/eval_judge.py#L180-L194)): exit code 0 means True; non-zero means False, with the last 500 characters of output as evidence (the last lines of the traceback show which assert failed); a timeout returns **None**, i.e. "no verdict", not a failure (ADR 0029). A missing assert file means False.

#### 4.3 Full Autorater (LLM judge) prompt ([L23-L71](https://github.com/edonadei/caliper/blob/d4515192ee6e180ec6d789949d1c4db3da676b35/caliper/judge/eval_judge.py#L23-L71))

```
You are an evaluation judge for an AI assistant. You will be shown the user's request, the transcript
of the assistant's attempt at it, and an expectation describing what success looks like.

You have two response modes:

1. **Direct verdict** — if you can tell from the transcript alone whether the expectation was met,
respond with:
   {"mode": "verdict", "passed": true|false, "reasoning": "<one or two sentences>"}

2. **Assertion script** — if verifiable facts (files exist, output matches a pattern, a value equals
something) would make your judgment more reliable, write a Python script that asserts those facts and
respond with:
   {"mode": "script", "code": "<python script>", "reasoning": "<why you chose this>"}

The script must use `assert` statements. `assert` failure = task failed. The script runs with no extra
imports beyond the standard library, in the directory the assistant worked in, so relative paths name
the files it wrote.

Respond with valid JSON only — no markdown fences, no extra text.


<expectation>
{expect}
</expectation>
[<prior_context>
Earlier turns of this conversation, written by the eval author, not the agent's. Use them as context;
grade only the transcript below.
[user] … / [assistant] … / [tool_use: shell] … / [tool_result] …
</prior_context>]
<request>
{task.prompt}
</request>

<transcript>
[assistant] …
[tool_use: <tool_name>] <tool_input JSON>
[tool_result] <first 2000 characters>
</transcript>

Evaluate the transcript. Respond with JSON.
```

Transcript formatting rules (`_format_transcript`, [L100-L111](https://github.com/edonadei/caliper/blob/d4515192ee6e180ec6d789949d1c4db3da676b35/caliper/judge/eval_judge.py#L100-L111)): keeps assistant text, tool_use names and JSON inputs, and the first 2000 characters of tool_result; user turns are dropped because the request is given separately. The system and user parts are concatenated into **one string** and sent as a single bare prompt to the judge backend's CLI (e.g. `claude -p --output-format json --strict-mcp-config …`, with no MCP and no account content, `cwd` set to the attempt workdir, 60-second timeout); see [claude_code.py L522-L534](https://github.com/edonadei/caliper/blob/d4515192ee6e180ec6d789949d1c4db3da676b35/caliper/harness/claude_code.py#L522-L534). In other words, the judge is itself an agent CLI process. [Inferred] In `-p` mode it may still be able to use read-only tools to inspect the workdir; the code does not explicitly disable tools.

**Prompt version**: `JUDGE_PROMPT_VERSION = sha256(prompt rendered with a fixed probe input)[:12]`. It hashes the rendered output rather than the source, so changing the template or the truncation length automatically yields a new version, which is recorded in `RunMeta.judge_prompt_version` ([L162-L177](https://github.com/edonadei/caliper/blob/d4515192ee6e180ec6d789949d1c4db3da676b35/caliper/judge/eval_judge.py#L162-L177)). `render_judge_prompt` is a public function that can rebuild the input the judge saw from the saved `TaskResult.expect/prompt` and `AttemptRecord.transcript`.

#### 4.4 Output schema and parsing (`_parse_rich_response`, [L237-L275](https://github.com/edonadei/caliper/blob/d4515192ee6e180ec6d789949d1c4db3da676b35/caliper/judge/eval_judge.py#L237-L275))

- Strip markdown code fences first (`_strip_markdown_fence`), then `json.loads`. On failure → error ("unparseable").
- Parsed result is not a dict → error.
- `mode` defaults to `"verdict"`:
  - `"script"`: `code` must be a non-empty string, otherwise error; it runs in the workdir as the `check` step (30-second limit): pass → passed=True; assert failure → passed=False; timeout → error. The generated code is saved in `autorater_script` because the workdir gets deleted.
  - `"verdict"`: `passed` **must be of type bool** (`isinstance`, "Not bool(): the string 'false' is truthy"), otherwise error.
  - Any other mode → error.
- CLI call failure (`result.error`, including timeout) → error. Problems that would make the judge fail on every attempt (model unavailable, quota exhausted, etc.) are already raised at the harness layer and abort the whole run (ADR 0030).
- An error only sets `autorater_passed=None`; if `assert:` gave a verdict, the attempt is still scored PASS or TASK_FAIL from the assert result.

#### 4.5 Outcome classification and scoring (ADR 0001 / 0007 / 0014)

`Outcome` ([schema/results.py L21-L78](https://github.com/edonadei/caliper/blob/d4515192ee6e180ec6d789949d1c4db3da676b35/caliper/schema/results.py#L21-L78)):

| Outcome | is_usable (enters execution denominator) | is_execution_noise (reported as anomaly) | is_activation_usable |
|---|---|---|---|
| `pass` | Yes | No | Yes |
| `task_fail` | Yes | No | Yes |
| `cheat` | Yes (counts as failure) | No | Yes |
| `judge_error` | No | Yes | **Yes** (transcript is complete; only the judge failed) |
| `infra_error` | No | Yes | No (transcript may be truncated) |
| `timeout` | No | Yes | No |
| `not_checked` | No | No | Yes |

Formulas ([results.py L366-L400](https://github.com/edonadei/caliper/blob/d4515192ee6e180ec6d789949d1c4db3da676b35/caliper/schema/results.py#L366-L400), [L463-L532](https://github.com/edonadei/caliper/blob/d4515192ee6e180ec6d789949d1c4db3da676b35/caliper/schema/results.py#L463-L532)):

```
usable    = #{pass, task_fail, cheat}
score     = successes / usable            (None when usable=0, not 0) ← primary metric (ADR 0007)
pass_at_k = 1 − (1 − score)^usable        (the exponent is usable, not the requested k)
pass_hat_k = score^usable
activation_usable    = #{attempt : outcome ∉ {infra_error, timeout} and activation_passed is not None}
activation_score     = #{those attempts with activation_passed=True} / activation_usable
AggregateScore.avg_score = mean(score over tasks whose score is not None); scored_tasks = number of tasks in the average
avg_activation_score     = mean(activation_score over tasks where it is not None), otherwise None
```

ADR 0007's rationale: pass@k inflates the score of unstable skills (passing 1 of 3 shows 70.4%), while a skill usually runs only once in production, so the primary metric is the raw success rate. It is independent of k, so runs with different k can be compared directly. The average is "the mean of per-task success rates"; `PooledCount` (pooled successes/usable) is shown only as a side note ([L434-L460](https://github.com/edonadei/caliper/blob/d4515192ee6e180ec6d789949d1c4db3da676b35/caliper/schema/results.py#L434-L460)).

**Per-skill activation diagnostics** (`SkillActivationStats`, [L823-L886](https://github.com/edonadei/caliper/blob/d4515192ee6e180ec6d789949d1c4db3da676b35/caliper/schema/results.py#L823-L886); counted per attempt, only attempts that assert `activates:` and are activation-usable):

```
recall        = hits / expected
precision     = hits / fired
unwanted      = fired − hits                 # number of "hijacks"
unwanted_rate = unwanted / (total − expected)   # not equal to 1 − precision
```

Example: a skill that misfires once in 50 opportunities where it should not fire has a precision of 50% and an unwanted_rate of 2%.

### 5. Baselines and version comparison

- **Ablation** (ADR 0015 / 0025): `--ablate <skill>` removes the named skill when installing the neighbourhood; `--ablate mcp:<server>` removes the named server (a `skill:` or `mcp:` qualifier is required on name collisions). The ablation result is saved as an ordinary run and can be compared against every later skill iteration (paid for only once). A run that ablates a skill **drops** the `activates:` expectations (no verdict, but observations are kept), because filtering out the removed skill would amount to writing an expectation on the author's behalf that they never wrote; ablating a server does not affect activation expectations ([environment.py L137-L152](https://github.com/edonadei/caliper/blob/d4515192ee6e180ec6d789949d1c4db3da676b35/caliper/environment.py#L137-L152)). The old `--baseline` was removed. The reason: under install-and-discover, if the with-skill group never activated the skill, both groups are bare agents and the delta is structurally close to 0, which would be misread as "the skill is useless".
- **`diff_runs(a, b)`** ([compare.py L314-L457](https://github.com/edonadei/caliper/blob/d4515192ee6e180ec6d789949d1c4db3da676b35/caliper/compare.py#L314-L457)):
  1. `_check_era`: **refuses to compare** when the two runs used different loading modes (install-and-discover or not). This is the only hard refusal.
  2. Pairs by `task_name`; duplicate names are paired in order of appearance; unpaired ones are listed as unmatched.
  3. Per task: `delta = b.score − a.score`; `regression = both sides have a score and b < a` (the "any-below" rule: no threshold, no statistical test). The activation scoreboard computes `activation_delta` / `activation_regression` independently.
  4. Aggregate: `aggregate_delta = mean(B's score on comparable tasks) − mean(A's)`, counting only tasks scored on both sides ([results.py L1383-L1420](https://github.com/edonadei/caliper/blob/d4515192ee6e180ec6d789949d1c4db3da676b35/caliper/schema/results.py#L1383-L1420)).
  5. Warnings: different specs, `k_mismatch` (pass@k and pass^k cannot be compared across k), one side interrupted, different neighbourhoods, different MCP servers, different user customizations or cross-backend, **content drift in git-sourced skills** (by file hash), `judge_mismatch` (both sides actually ran the autorater and their `backend:model@effort` differ; whether the autorater ran is judged from `judge_seconds`, [L167-L208](https://github.com/edonadei/caliper/blob/d4515192ee6e180ec6d789949d1c4db3da676b35/caliper/compare.py#L167-L208)).
  6. Ablation pair detection (`_ablation_labels`): one side ablated, the other complete, and the records are checked: the complete side's neighbourhood minus the removed skill must equal the ablated side's neighbourhood. Only if the check passes are the "with X / without X" labels added to both sides.
- compare deliberately offers no threshold flag: at small k, the any-below rule "is noise as often as signal".

### 6. Repeated runs and statistics

`--k` defaults to 3. On rate limits, a single attempt retries internally at most 2 times (backoff 2 s, 4 s, with jitter); the retry count is recorded in `retries` and does not consume k (ADR 0019). **There are no confidence intervals or significance tests**; a code comment says CIs "belong on the score itself", but this is not implemented yet. `hillclimb-skill` substitutes an empirical noise floor: `floor = max(|baseline1 − baseline2|, 2 × 100/(tasks×k))`, combined with a stratified train/held-out split ([climb.py L34-L82](https://github.com/edonadei/caliper/blob/d4515192ee6e180ec6d789949d1c4db3da676b35/skills/hillclimb-skill/climb.py#L34-L82)).

### 7. Cost / token accounting

ADR 0006: records only tokens (input / output / cache_read / cache_creation / total) and wall-clock time, not dollars, because backends report amounts on different bases and a price table would go stale. Judge tokens are not counted; `judge_seconds` counts only the time of the autorater model call itself (ADR 0033). compare shows token and time deltas but never counts them toward regression.

### 8. Rule files

No per-item verdicts. ADR 0028 specifies that the user's own skills, plugins, **rules**, settings and connectors are loaded by default (reflecting "the agent you actually use"), and RunMeta records what was loaded; compare warns when the two sides differ. ADR 0047: the user's own skills also compete for activation, and an extra user skill firing makes the `activates:` exact match fail.

### 9. Privacy and data flow

The agent CLI and the judge CLI each talk to their own model service. Telemetry goes to PostHog and contains only the command, backend, outcome and duration, with no installation identifier (ADR 0041 / 0042, `telemetry.py`). Results are stored locally.

## ADR summary (mechanism-related parts, 48 ADRs in total)

| ADR | Key points |
|---|---|
| 0001 | Outcome classification replaces `passed: bool`; decided in one place only; order is setup failed → cancelled → timeout → infra_error → cheat → not_checked → judge; "Rule B": only checks that gave a verdict count |
| 0006 | Record tokens and wall-clock time, not dollars |
| 0007 | Primary metric is the raw success rate; pass@k and pass^k are secondary views; every number is derived from attempts, no counts are stored |
| 0013 | install-and-discover is the only loading mode: never preload, so the execution score is a joint "activation × execution" measure (a cost deliberately accepted) |
| 0014 | `activates:` is a third kind of check alongside expect/assert; the two scoreboards are never merged; exact set match; skills that delegate must list the whole chain, because at the transport level "a read caused by the skill" and "a read the agent chose itself" are indistinguishable |
| 0015 / 0025 | `--ablate` names its target at invocation and produces an ordinary run; ablating a skill drops activation expectations, ablating a server keeps them |
| 0019 / 0030 | attempt ≠ invocation; rate-limit retries are merged into one attempt; refusals are read from what the CLI actually wrote, so an agent answer that talks about a "rate limit" is not misclassified |
| 0028 / 0047 | User customizations loaded by default; user skills compete for activation; compare warns on settings differences |
| 0029 | Uniform rule per step: setup/cleanup limited to 600 seconds, assert/check to 30 seconds; assert timeout = no verdict |
| 0033 / 0034 | Judge time counts only the model call; the judge follows the backend under test by default (using that CLI's default model), so watch for `judge_mismatch` in cross-backend comparisons |
| 0036 | `history:` is written as each CLI's native session file and continued with `--resume` (rather than pasting history into the prompt); the judge sees prior_context but does not grade it |

## Limitations (observed in source)

- Activation looks only at "was it attempted", not whether the tool_result succeeded; codex, pi and antigravity rely solely on the path suffix, so an agent scanning the skill directory with `ls` or `grep` does not count as an activation, but `cat .../x/SKILL.md` does.
- The execution score is by default a joint "activation × execution" measure; `--force-load` is not implemented yet.
- Regression uses only the any-below rule, with no statistical test at all; pass@k is computed by plugging the observed success rate into the formula, not an unbiased estimator.
- The judge is a full CLI process, slower than a direct API call; the grading basis is a single free-text `expect` at whole-task granularity, not per-item assertions.
