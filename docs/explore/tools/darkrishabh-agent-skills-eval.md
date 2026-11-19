# darkrishabh/agent-skills-eval

- Repository: <https://github.com/darkrishabh/agent-skills-eval>
- commit: `9724511694ca0a2e8342816118412a3909186a95` (2026-11-16)
- stars: 817 / language: TypeScript / license: MIT / npm: `agent-skills-eval` v0.1.1
- In one sentence: an SDK + CLI that reads `evals/evals.json` in agentskills.io format and **calls an OpenAI-compatible chat API directly** (no agent harness involved): with_skill mode stuffs `SKILL.md` together with references and scripts into the system message, without_skill mode leaves it out; a judge model then grades pass/fail per assertion, plus deterministic `tool_assertions` on the tool-call requests the model returns.

All links below are permalinks to the commit above.

## Features

| Feature | Purpose |
|---|---|
| CLI `agent-skills-eval <root>` | Discovers skills under root that have `evals/evals.json` and evaluates each; options: `--baseline`, `--target` (default `gpt-4o-mini`), `--judge` (defaults to target), `--base-url`, `--api-key-env`, `--include/--exclude`, `--eval-id`, `--concurrency` (default 4), `--layout iteration|flat`, `--strict`, `--log-format pretty|jsonl|silent`, `--report/--no-report` ([cli.ts L56-L84](https://github.com/darkrishabh/agent-skills-eval/blob/9724511694ca0a2e8342816118412a3909186a95/src/cli.ts#L56-L84)) |
| Exit code | exit 1 if any with_skill assertion fails ([cli.ts L171](https://github.com/darkrishabh/agent-skills-eval/blob/9724511694ca0a2e8342816118412a3909186a95/src/cli.ts#L171)) |
| SDK `evaluateSkills` / `runEval` / `gradeOutputs` / `runToolAssertions` | Programmatic use; `gradeOutputs`' `gradingPrompt` parameter can replace the default rubric, but neither the CLI nor `evaluateSkills` passes it through |
| Static HTML report | `report/index.html` |
| `--loop` (SDK) | Snapshots this run's artifacts into `.history/iteration-N/` |
| `experimental/runtime` | Experimental native agent runtime lifecycle (isolated workspace, event recording, verifier). **Not wired into the CLI or `evaluateSkills`** ([docs/runtime-foundation.md](https://github.com/darkrishabh/agent-skills-eval/blob/9724511694ca0a2e8342816118412a3909186a95/docs/runtime-foundation.md), [agent-runtime.ts L1](https://github.com/darkrishabh/agent-skills-eval/blob/9724511694ca0a2e8342816118412a3909186a95/src/agent-runtime.ts#L1)) |

## Architecture and data flow

```
discoverSkills(root) → loadSkill(dir)   (skill.ts: SKILL.md frontmatter + references/ + scripts/ + evals/evals.json)
   └─ evaluateSkills (evaluate-skills.ts): each (skill, eval) is a task, concurrency pool runPool(n=4)
        └─ runEval (run-eval.ts): for each mode ∈ {with_skill[, without_skill]}
             ├─ system = with_skill ? renderSkillSystemMessage(skill) : undefined
             ├─ completeWithFallback → OpenAICompatibleProvider.completeChat (one chat completion, tools not executed)
             ├─ gradeOutputs (grade.ts): runToolAssertions + LLM rubric
             └─ writeRunArtifacts: outputs/, grading.json, timing.json, prompts.json, tool_calls.json
        └─ buildBenchmark (artifacts.ts) → benchmark.json (mean/stddev + delta)
   └─ generateReport → report/index.html
```

## Core mechanisms

### 1. Input: test cases

The structure of `evals/evals.json` is `{ evals: [...], defaults?: {target.params, judge.params, tools} }` ([skill.ts L350-L360](https://github.com/darkrishabh/agent-skills-eval/blob/9724511694ca0a2e8342816118412a3909186a95/src/skill.ts#L350-L360)). Each case (`AgentSkillsEval`, [types.ts L26-L42](https://github.com/darkrishabh/agent-skills-eval/blob/9724511694ca0a2e8342816118412a3909186a95/src/types.ts#L26-L42)) has `id`, `name`, `prompt`, `expected_output?`, `files?` (read in as attachments, inlined into the user message when the provider doesn't support attachments), `assertions?: string[]`, `params?`, `tools?` (OpenAI function definitions), `tool_choice?`, `tool_assertions?`.

### 2. Session / log parsing

Not applicable. There is no agent session, only one chat completion's `message.content` and `message.tool_calls`. A tool call's `arguments` is `JSON.parse`d into `parsedArguments` when possible, and is undefined if parsing fails ([openai-compatible-provider.ts L80-L95](https://github.com/darkrishabh/agent-skills-eval/blob/9724511694ca0a2e8342816118412a3909186a95/src/openai-compatible-provider.ts#L80-L95)). **Tools the model requests are not executed, and there is no multi-turn conversation**.

### 3. Skill trigger detection

Not applicable. In with_skill mode the full skill is always in the system message ([run-eval.ts L70-L93](https://github.com/darkrishabh/agent-skills-eval/blob/9724511694ca0a2e8342816118412a3909186a95/src/run-eval.ts#L70-L93), formatted as `<skill name><description><instructions>SKILL.md</instructions><references>…<scripts>…</skill>`), so there is no "was the skill selected" step. The experimental runtime's types define `skillLoading: loaded|failed|not_observed|unknown`, but no implementation produces it.

### 4. Grading

#### 4.1 Main path (step by step)

```
runEval(skill, case, modes):                                  # run-eval.ts L164-L285
  for mode in modes:
    completion = completeWithFallback(system?, case.prompt, files, tools, toolChoice, params)
    rawOutput  = completion.error ? "ERROR: " + error : completion.output
    assertions = case.assertions non-empty ? case.assertions
               : case.expected_output ? ["The output satisfies this expected output: " + expected_output]
               : []                                            # L221-L226
    grading = gradeOutputs(rawOutput, assertions, completion.toolCalls, case.tool_assertions, judge)

gradeOutputs:                                                 # grade.ts L390-L428
  toolResults = runToolAssertions(toolCalls, toolAssertions)   # local deterministic checks
  if assertions is empty: return summarize(toolResults)
  for attempt in 0..1:                                         # judge called at most 2 times
    prompt = renderRubricPrompt(args, previousBadResponse)
    text   = judge's returned text or error message
    try: rubric = normalizeRubricGrading(JSON.parse(extractJsonObject(text)), assertions); break
    catch: badResponse = text
  if no rubric: rubric = failClosed(assertions)                # all judged failed
  combined = rubric ++ toolResults
  return { assertion_results: combined, summary: summarize(combined) }
```

**Discrepancy with the README**: the README's "How it works" says "The judge sees the eval's `expected_output` and `assertions`" ([README L118](https://github.com/darkrishabh/agent-skills-eval/blob/9724511694ca0a2e8342816118412a3909186a95/README.md#L118)). In the code, `expected_output` is turned into an assertion only when `assertions` is empty ([run-eval.ts L221-L226](https://github.com/darkrishabh/agent-skills-eval/blob/9724511694ca0a2e8342816118412a3909186a95/src/run-eval.ts#L221-L226)); whenever assertions exist, the judge **cannot see** expected_output. README L331 describes the "turned into an assertion" behavior correctly. Also, `renderRubricPrompt` supports an "Output files" section, but `runEval` never passes `outputFiles`, so that section is always "No output files were captured.".

#### 4.2 Judge prompt (default rubric, full text)

`callJudge` uses a system message when the provider supports the system role: `"You are a strict JSON-only evaluator."` ([grade.ts L157-L170](https://github.com/darkrishabh/agent-skills-eval/blob/9724511694ca0a2e8342816118412a3909186a95/src/grade.ts#L157-L170)). The user content is assembled by `renderRubricPrompt` ([grade.ts L101-L155](https://github.com/darkrishabh/agent-skills-eval/blob/9724511694ca0a2e8342816118412a3909186a95/src/grade.ts#L101-L155)):

```
You are grading an agentskills.io evaluation run.

Grading principles:
- Require concrete evidence for every PASS; quote or reference the output.
- Do not give the benefit of the doubt.
- PASS an assertion only if every condition in the assertion text holds.
- A label without substance is a FAIL.
- Tool calls (when present) are authoritative evidence of model behavior.

Return STRICT JSON only. No markdown. Shape:
{"assertion_results":[{"text":"...","passed":true,"evidence":"..."}],"summary":{"passed":0,"failed":0,"total":0,"pass_rate":0}}

Rules:
- Include every assertion exactly once and copy the full assertion text verbatim into text.
- Use short concrete evidence: quote, snippet, or file reference.
- Summary may be included, but it will be recomputed by the caller.
[on retry] Previous response was not parseable JSON. Try again. Bad response: <first 500 characters>

Assertions:
[ "...", "..." ]                      ← JSON.stringify(assertions)

Model output:
<rawOutput or "(empty output)">

Tool calls (structured):              ← only present when there are tool calls
[1] <name>
<JSON of parsedArguments, or raw arguments>

Output files:
No output files were captured.
```

No `response_format`, temperature or similar parameters are set; judge parameters are passed through entirely from `judgeParams`.

#### 4.3 Output schema and parsing

- `extractJsonObject`: if the text as a whole starts with `{` and ends with `}`, use it directly; otherwise take the content from the first `{` to the last `}` ([grade.ts L43-L50](https://github.com/darkrishabh/agent-skills-eval/blob/9724511694ca0a2e8342816118412a3909186a95/src/grade.ts#L43-L50)).
- `normalizeRubricGrading` ([grade.ts L59-L82](https://github.com/darkrishabh/agent-skills-eval/blob/9724511694ca0a2e8342816118412a3909186a95/src/grade.ts#L59-L82)): the parse result must be an object containing an `assertion_results` array, otherwise it throws, triggering a retry. **Aligned by index**, not by text: the i-th assertion takes `rawResults[i]`; missing or non-object → `passed:false, evidence:"judge omitted this assertion result"`; `passed` counts as a pass only if strictly equal to `true`; empty `evidence` is recorded as `"judge did not provide concrete evidence"`, but `passed` is **not** changed to false in that case (the prompt requires evidence for every PASS, but the code doesn't enforce it). `text` always uses the original text passed in by the caller.
- The `summary` returned by the judge is discarded and recomputed by the caller.
- `failClosed`: when both parse attempts fail, all rubric assertions are judged `passed:false`, with evidence `"judge returned unparseable response: …"` ([grade.ts L84-L87](https://github.com/darkrishabh/agent-skills-eval/blob/9724511694ca0a2e8342816118412a3909186a95/src/grade.ts#L84-L87)).

#### 4.4 `tool_assertions` (deterministic checks, no LLM)

Type definitions in [types.ts L18-L24](https://github.com/darkrishabh/agent-skills-eval/blob/9724511694ca0a2e8342816118412a3909186a95/src/types.ts#L18-L24), grading logic in `gradeToolAssertion` ([grade.ts L249-L377](https://github.com/darkrishabh/agent-skills-eval/blob/9724511694ca0a2e8342816118412a3909186a95/src/grade.ts#L249-L377)):

| type | fields | rule |
|---|---|---|
| `tool-called` | `name` | number of same-name calls > 0 |
| `tool-not-called` | `name` | number of same-name calls = 0 |
| `tool-arg-equals` | `name, path, value` | in any same-name call, `getByPath(parsedArguments, path)` `deepEqual`s `value`: objects ignore key order, arrays respect order ([L196-L219](https://github.com/darkrishabh/agent-skills-eval/blob/9724511694ca0a2e8342816118412a3909186a95/src/grade.ts#L196-L219)) |
| `tool-arg-contains` | `name, path, value` | in any same-name call, the value at that path is a string containing `value` |
| `tool-arg-matches` | `name, path, pattern, flags?` | in any same-name call, the value at that path is a string matching the regex; an invalid regex fails |
| `tool-call-count` | `name?, min?, max?` | number of same-name calls (all calls if no name is given) falls within [min, max] |

`path` syntax is dots plus `[i]`, e.g. `input.command`, `files[0]` ([L175-L190](https://github.com/darkrishabh/agent-skills-eval/blob/9724511694ca0a2e8342816118412a3909186a95/src/grade.ts#L175-L190)). Calls whose `parsedArguments` is undefined (arguments not valid JSON) are skipped. Each tool assertion produces an ordinary `AssertionResult{text, passed, evidence}`, with evidence stating which tool names or argument values were observed.

#### 4.5 From assertions to scores to metrics

```
summary.pass_rate = passed / total (total = rubric count + tool count; 1 when total is 0)     # grade.ts L52-L57
benchmark.run_summary[mode].pass_rate = { mean, stddev (population std dev) } over each eval's pass_rate  # artifacts.ts L75-L99
delta.pass_rate = with.mean − without.mean (same for time_seconds, tokens)                    # artifacts.ts L101-L119
skill.passRate = Σpassed / Σ(passed+failed), with_skill only, aggregated over assertions      # evaluate-skills.ts L296-L307
```

Two aggregation conventions coexist: benchmark is "the mean of per-case pass_rate", while the CLI summary is "the pooled assertion-level proportion". There is no threshold and no binary "case passed / failed" verdict; the exit code depends only on whether with_skill has any failed assertion.

#### 4.6 Error handling

- Target call failure: the provider first retries per `retry.attempts` (default 2) and `backoffMs` (default 1500); on final failure it returns `error`, `rawOutput="ERROR: <msg>"`, which is **sent to the judge for grading as usual** and usually gets FAIL, thereby counting infrastructure errors as skill failures ([openai-compatible-provider.ts L215-L240](https://github.com/darkrishabh/agent-skills-eval/blob/9724511694ca0a2e8342816118412a3909186a95/src/openai-compatible-provider.ts#L215-L240), [run-eval.ts L219](https://github.com/darkrishabh/agent-skills-eval/blob/9724511694ca0a2e8342816118412a3909186a95/src/run-eval.ts#L219)).
- Judge call failure: `lastText = response.error`, which can't be parsed, so it calls once more; if that still fails, `failClosed` judges all assertions FAIL.
- No unknown or skipped state.

### 5. Baselines and version comparison

With `--baseline`, each case runs `with_skill` and `without_skill`, the only difference being whether the skill is in the system message. `--loop` only saves snapshots; there is no logic to compare two iterations (the HTML report can read the history directory).

### 6. Repeated runs and statistics

None. Each case runs only once per mode; stddev is dispersion across cases, not variance across repeated runs. No pass@k, confidence intervals or significance tests.

### 7. Cost / token accounting

`total_tokens = prompt_tokens + completion_tokens`, `duration_ms = latency` ([run-eval.ts L157-L162](https://github.com/darkrishabh/agent-skills-eval/blob/9724511694ca0a2e8342816118412a3909186a95/src/run-eval.ts#L157-L162)). The provider reads `usage.costs`, but that value is not written into the benchmark; judge tokens are not tracked.

### 8. Rule files

Not applicable.

### 9. Privacy and data flow

The full skill, cases and attachments are sent to the target endpoint; model output is sent to the judge endpoint (by default the same base URL). Requests carry a User-Agent containing the package name and Node version. No telemetry.

## Limitations (observed in source)

- It measures "the quality of the model's single-turn answer after SKILL.md is stuffed into context", not the process of an agent discovering, loading and executing a skill in a real harness; tool calls are only "requests" and are never executed.
- Infrastructure errors and judge errors are both treated as FAIL (fail-closed), which drags scores down and can't be distinguished from real failures.
- Judge results are aligned by index: if the judge omits one item in the middle, all subsequent results shift out of place; the code doesn't check that `text` matches.
- `expected_output` and assertions are mutually exclusive (README description and code disagree); no repeated runs.
