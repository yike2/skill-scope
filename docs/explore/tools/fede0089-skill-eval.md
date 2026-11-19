# fede0089/skill-eval

- Repository: <https://github.com/fede0089/skill-eval>
- commit: `bc7b1395857bddd6fa482b7ec867d8823aae0432`, 2026-09-02
- stars: 5; language: TypeScript; license: MIT; npm `@fede0089/skill-eval` v4.0.0
- In one sentence: runs Gemini CLI / Codex / Claude Code locally and headless in a git worktree, programmatically parses the event stream to detect whether a skill triggered (`trigger`), uses another agent CLI as an LLM judge to check expectations one by one (`functional`), and with `evolve` lets an optimizer agent propose changes that are auto-committed after validation through "pre-declared predictions + frozen evals".

Permalink prefix: `FE = https://github.com/fede0089/skill-eval/blob/bc7b1395857bddd6fa482b7ec867d8823aae0432`. Note that the repository also commits `node_modules/`; only `src/` is analyzed below.

## Features

| Command / option | Purpose |
|---|---|
| `skill-eval trigger <workspace> <skill>` | Runs each eval N times and programmatically decides whether the skill was activated; negative cases with `should_trigger:false` require no activation |
| `skill-eval functional <workspace> <skill>` | Runs the eval prompt with the skill, then a judge agent checks each `expectations` item |
| `skill-eval evolve <workspace> <skill>` | Evolution session: compares the working-tree changes (or the optimizer's proposal) against `HEAD`, commits if the acceptance rules are met, otherwise restores |
| `--trials` (default 5) `--agents` (concurrency, default 4) `--timeout` | Repetitions / concurrency / per-agent timeout |
| `--eval-id` `--eval-file` | Run only one eval or one file under `evals/` |
| `--compare-ref <refs...>` | Uses `git archive` to pull historical versions of the skill as extra variants (trigger/functional) |
| `--compare-baseline` | functional additionally runs a baseline without the skill |
| `--executor-agent` `--judge-agent` `--optimizer-agent` | Choose a backend for each of the three roles: `gemini-cli` (default) / `codex` / `claude-code` ([FE/src/runners/registry.ts#L50-L57](https://github.com/fede0089/skill-eval/blob/bc7b1395857bddd6fa482b7ec867d8823aae0432/src/runners/registry.ts#L50-L57)) |
| `--proposals` (default 3) `--predict <evalId>#<n>` | evolve: cap on optimizer calls; when the working tree has uncommitted changes, you must declare which expectations you predict will improve |
| HTML report | Summary, per-trial anomaly flags, manual Exclude (stored only in browser localStorage), per-expectation pass rates |

Command definitions: [FE/src/index.ts#L62-L129](https://github.com/fede0089/skill-eval/blob/bc7b1395857bddd6fa482b7ec867d8823aae0432/src/index.ts#L62-L129).

## Architecture and data flow

```
skill/evals/*.json ─loadEvalSuite─▶ EvalSuite ─freezeEvals─▶ runDir/evals (one frozen copy of evals shared by all variants)
                                          │ materializeImplementation: copies the skill but drops evals/ (agent cannot see scoring criteria)
variants: local / ref:<x> (git archive) / baseline
   │ for each (eval, variant, trial): EvalEnvironment.createWorktree → runner.linkSkill → applyRunnerConfig
   ▼
AgentRunner.runPrompt (spawn CLI, stream-json) → normalize*Jsonl → unified NDJSON contract
   │   {type:message|tool_use|tool_result|result, ...}
   ├─ trigger:    TriggerGrader.gradeTrigger / detectSkillAttempt
   └─ functional: trigger check first → git diff as context → ModelBasedGrader (judge agent runs in the same worktree)
   ▼
EvalTrial{assertionResults[], trialPassed, isError, tokenStats, summary}
   ▼ statistics.ts (isCounted excludes isError) → EvalSuiteReport → HtmlReporter (recomputed after anomalies + manual exclude)
   ▼ evolve: evolution.decide(report, candidate='local', incumbent='ref:HEAD', predictions) → commit / restore
```

Key files: [FE/src/core/eval-runner.ts](https://github.com/fede0089/skill-eval/blob/bc7b1395857bddd6fa482b7ec867d8823aae0432/src/core/eval-runner.ts), [evaluator.ts](https://github.com/fede0089/skill-eval/blob/bc7b1395857bddd6fa482b7ec867d8823aae0432/src/core/evaluator.ts), [statistics.ts](https://github.com/fede0089/skill-eval/blob/bc7b1395857bddd6fa482b7ec867d8823aae0432/src/core/statistics.ts), [evolution.ts](https://github.com/fede0089/skill-eval/blob/bc7b1395857bddd6fa482b7ec867d8823aae0432/src/core/evolution.ts), [runners/](https://github.com/fede0089/skill-eval/tree/bc7b1395857bddd6fa482b7ec867d8823aae0432/src/runners).

## Core mechanisms

### 1. Input: test cases

`<skill>/evals/*.json`; multiple files are merged and `skill_name` must match ([FE/src/utils/eval-loader.ts#L21-L104](https://github.com/fede0089/skill-eval/blob/bc7b1395857bddd6fa482b7ec867d8823aae0432/src/utils/eval-loader.ts#L21-L104)).

```json
{"skill_name":"license-generator","evals":[
  {"id":1,"prompt":"Create an MIT license for Globex Corporation, year 2023.",
   "expectations":["A file named LICENSE was created in the working directory", "..."]},
  {"id":10,"prompt":"What is the capital of France?","should_trigger":false}]}
```

Fields: `id` (number, required), `prompt`, `expectations` (internal name `assertions`), `should_trigger` (boolean, default true); `expected_output` and `files` are read in but nothing in `src/` uses them ([eval-loader.ts#L82-L89](https://github.com/fede0089/skill-eval/blob/bc7b1395857bddd6fa482b7ec867d8823aae0432/src/utils/eval-loader.ts#L82-L89)). `evals/config/<runner>/` is copied verbatim into the worktree's `.gemini/`, `.codex/`, `.claude/`, for permission policies and similar configuration.

### 2. Session / log parsing

Each runner normalizes its CLI's event stream into a minimal NDJSON contract (`message` / `tool_use{tool_id,tool_name,parameters}` / `tool_result{tool_id,status}` / `result{status,stats,error}`):

- **Gemini CLI**: `gemini -p … --approval-mode auto_edit --output-format stream-json`; its native output already matches the contract, and the dispatch tool name is `activate_skill` ([FE/src/runners/gemini-cli/runner.ts#L10](https://github.com/fede0089/skill-eval/blob/bc7b1395857bddd6fa482b7ec867d8823aae0432/src/runners/gemini-cli/runner.ts#L10), [#L85](https://github.com/fede0089/skill-eval/blob/bc7b1395857bddd6fa482b7ec867d8823aae0432/src/runners/gemini-cli/runner.ts#L85)).
- **Claude Code**: `claude -p --output-format stream-json --verbose --permission-mode bypassPermissions --no-session-persistence`. `normalizeClaudeJsonl()` reads `text` and `tool_use` from `assistant.message.content[]` and remaps the `Skill` tool's `input.skill` to `parameters.name`; reads `tool_result` from `user.message.content[]`, recording `error` when `is_error===true` or the parent event's `tool_use_result.success===false`; and reads `usage` from the `result` event ([FE/src/runners/claude-code/runner.ts#L61-L156](https://github.com/fede0089/skill-eval/blob/bc7b1395857bddd6fa482b7ec867d8823aae0432/src/runners/claude-code/runner.ts#L61-L156)). The dispatch tool name is `Skill` ([#L159](https://github.com/fede0089/skill-eval/blob/bc7b1395857bddd6fa482b7ec867d8823aae0432/src/runners/claude-code/runner.ts#L159)).
- **Codex**: `codex exec --json --sandbox workspace-write -c approval_policy="never" --ephemeral`, additionally passing `-c skills.config=[{path=…,enabled=true}]` and `-c model_instructions_file=…` ([FE/src/runners/codex/runner.ts#L225-L246](https://github.com/fede0089/skill-eval/blob/bc7b1395857bddd6fa482b7ec867d8823aae0432/src/runners/codex/runner.ts#L225-L246)). This instructions file says "Use the configured skill when it applies. If you use a skill, read and follow its SKILL.md instructions." ([#L366-L374](https://github.com/fede0089/skill-eval/blob/bc7b1395857bddd6fa482b7ec867d8823aae0432/src/runners/codex/runner.ts#L366-L374)), which nudges the agent toward "use the skill", so trigger results skew optimistic [Inferred]. Codex skill activation is synthesized heuristically; see §3.

Text extraction `parseStreamResult()` concatenates the assistant `message`s and returns `{error}` when `result.status==='error'` ([FE/src/utils/ndjson.ts#L29-L65](https://github.com/fede0089/skill-eval/blob/bc7b1395857bddd6fa482b7ec867d8823aae0432/src/utils/ndjson.ts#L29-L65)).

### 3. Skill trigger detection (focus)

`TriggerGrader` ([FE/src/core/evaluator.ts#L9-L136](https://github.com/fede0089/skill-eval/blob/bc7b1395857bddd6fa482b7ec867d8823aae0432/src/core/evaluator.ts#L9-L136)) targets the keys `[skillName, skillName.replace(/-/g,'_')]`, compared case-insensitively and requiring exact equality.

- **Successful activation** `gradeTrigger()` ([#L25-L107](https://github.com/fede0089/skill-eval/blob/bc7b1395857bddd6fa482b7ec867d8823aae0432/src/core/evaluator.ts#L25-L107)):
  1. Find `type==='tool_use' && tool_name===dispatchTool && parameters.name ∈ keys` among the normalized events;
  2. After it, find a `tool_result` with the same `tool_id` and `status==='success'`; if found, return true;
  3. If any NDJSON events were parsed at all, stop here and return false ("do NOT fall back to legacy");
  4. Only when not a single event was parsed does it take the legacy fallback: first check `stats.tools.byName`, then do a **substring search in the raw text** (dispatch tool name or skill name), so mentioning the skill name in text also counts as a trigger. Normalized runners always emit a `result` event, so normally this step is never reached.
- **Attempted activation** `detectSkillAttempt()` ([#L124-L135](https://github.com/fede0089/skill-eval/blob/bc7b1395857bddd6fa482b7ec867d8823aae0432/src/core/evaluator.ts#L124-L135)): only requires a matching `tool_use`, regardless of outcome.
- **Asymmetry between positive and negative cases** ([FE/src/core/eval-runner.ts#L130-L179](https://github.com/fede0089/skill-eval/blob/bc7b1395857bddd6fa482b7ec867d8823aae0432/src/core/eval-runner.ts#L130-L179)):
  - `should_trigger` true: `passed = gradeTrigger()`, i.e. activation must **succeed**;
  - `should_trigger` false: first checks `hasParsableEvents()`; with no parsable events at all it is recorded as `isError` ("absence proves nothing") and does not pass; otherwise `passed = !detectSkillAttempt()`, so **an attempt alone counts as a misfire**.
- **Codex heuristic** `eventSignalsSkill()` ([codex/runner.ts#L71-L92](https://github.com/fede0089/skill-eval/blob/bc7b1395857bddd6fa482b7ec867d8823aae0432/src/runners/codex/runner.ts#L71-L92)): any event not of type `agent_message/assistant_message/message` whose serialization contains both the skill name and `skill` (or `"activate_skill"`/`"use_skill"`) counts as an activation, e.g. a command_execution event for `cat .codex/skills/<name>/SKILL.md`. Only the first is recorded; `tool_use` + `tool_result{success|error}` are synthesized from the event's status ([#L160-L173](https://github.com/fede0089/skill-eval/blob/bc7b1395857bddd6fa482b7ec867d8823aae0432/src/runners/codex/runner.ts#L160-L173)). **Excluding assistant text happens only in the Codex adapter**; Claude and Gemini don't need this step because they only recognize the dispatch tool's `tool_use`. The README also admits Codex negative cases are unreliable.
- Skill installation: Claude uses a symlink `.claude/skills/<frontmatter name>`; Gemini uses `.agents/skills/<dirname>`; Codex uses `.codex/skills/<name>`.

### 4. Grading (focus)

#### 4.1 trigger scoring path (purely programmatic)

`runTriggerTask()` ([eval-runner.ts#L83-L209](https://github.com/fede0089/skill-eval/blob/bc7b1395857bddd6fa482b7ec867d8823aae0432/src/core/eval-runner.ts#L83-L209)): create worktree → linkSkill → `runPrompt(task.prompt)` (the raw prompt, with no hints appended) → delete worktree → if `result.status==='error'`, write it into `transcript.error` → decide per §3; each trial yields one `AssertionResult{assertion:'Skill was triggered'|'Skill was not triggered', passed, reason, graderType:'programmatic'}`. Agent error, timeout, or no transcript → `isError:true`.

#### 4.2 functional scoring path

`runFunctionalTask()` ([eval-runner.ts#L211-L444](https://github.com/fede0089/skill-eval/blob/bc7b1395857bddd6fa482b7ec867d8823aae0432/src/core/eval-runner.ts#L211-L444)):

1. **Rewrite the prompt** ([#L214-L216](https://github.com/fede0089/skill-eval/blob/bc7b1395857bddd6fa482b7ec867d8823aae0432/src/core/eval-runner.ts#L214-L216)): with the skill, append `IMPORTANT: You must use the '<skill>' skill/tool to solve this task.`; for the baseline, append `IMPORTANT: For this task, you MUST NOT use the '<skill>' skill/tool, even if it appears available.`, and the baseline doesn't linkSkill at all.
2. Run the agent and take token stats from the stream (agent only, judge excluded).
3. **Trigger precondition check** ([#L273-L304](https://github.com/fede0089/skill-eval/blob/bc7b1395857bddd6fa482b7ec867d8823aae0432/src/core/eval-runner.ts#L273-L304)): `detectSkillAttempt` in the baseline → `Invalid Without Skill`; `gradeTrigger` false with the skill → `Invalid With Skill`. Both produce only one synthetic assertion with `trialPassed:false`, and **isError is not set, so they count as failures in the denominator**.
4. Context: run `git diff HEAD` and `git ls-files --others --exclude-standard` in the worktree, producing something like `[DIFF]…[UNTRACKED FILES]…` ([#L306-L317](https://github.com/fede0089/skill-eval/blob/bc7b1395857bddd6fa482b7ec867d8823aae0432/src/core/eval-runner.ts#L306-L317)).
5. Call the judge, retrying up to 2 times with exponential backoff of 1s, 2s ([#L327-L352](https://github.com/fede0089/skill-eval/blob/bc7b1395857bddd6fa482b7ec867d8823aae0432/src/core/eval-runner.ts#L327-L352)). The judge's `runPrompt` gets no timeoutMs, so **the judge has no timeout** ([evaluator.ts#L180](https://github.com/fede0089/skill-eval/blob/bc7b1395857bddd6fa482b7ec867d8823aae0432/src/core/evaluator.ts#L180)).
6. After retries are exhausted: every expectation is recorded as `passed:false, reason=error message`, **deliberately without isError**, so the outer withRetry doesn't rerun the expensive agent ([#L354-L370](https://github.com/fede0089/skill-eval/blob/bc7b1395857bddd6fa482b7ec867d8823aae0432/src/core/eval-runner.ts#L354-L370)). As a result, judge infrastructure failures are counted as agent failures.
7. `trialPassed = assertionResults.every(r => r.passed)`; true when there are no expectations ([#L372-L375](https://github.com/fede0089/skill-eval/blob/bc7b1395857bddd6fa482b7ec867d8823aae0432/src/core/eval-runner.ts#L372-L375)).

#### 4.3 judge prompt and schema

The judge is itself an agent CLI (by default the same as the executor), running in **the same worktree**, and can read files with tools ([evaluator.ts#L159-L222](https://github.com/fede0089/skill-eval/blob/bc7b1395857bddd6fa482b7ec867d8823aae0432/src/core/evaluator.ts#L159-L222)). Full prompt ([#L224-L254](https://github.com/fede0089/skill-eval/blob/bc7b1395857bddd6fa482b7ec867d8823aae0432/src/core/evaluator.ts#L224-L254)):

```
You are a Functional Quality Judge for AI Agent Skills.
Your task is to evaluate if a skill execution met its functional assertions.

Original Prompt: "${prompt}"
Agent Response: "${response}"

Workspace Context (Changes detected):
${context}

Assertions to evaluate:
1. ...
2. ...

INSTRUCTIONS:
1. Analyze the Agent Response and the Workspace Context below.
   You are running in the directory where the agent worked. If any assertion references file content or file existence, you MUST use the read_file tool to verify directly — do not rely solely on the agent's response text.
   IMPORTANT: The Agent Response string might contain CLI system noise, telemetry errors, or tool status warnings (e.g., initialization logs) prepended or appended to the actual reply. You MUST ignore any system-level noise and evaluate the assertions STRICTLY against the agent's intended message and actions.
2. For each assertion, determine if it was met (passed: true) or not (passed: false).
3. Provide a brief reasoning for your judgment.
4. Output your evaluation ONLY as a JSON array of objects with the following structure:
[
  {
    "assertion": "the exact text of assertion 1",
    "passed": true,
    "reason": "why it passed or failed"
  },
  ...
]

Do not include any other text in your response, only the JSON array.
```

- `Original Prompt` is the raw prompt, without the appended "MUST use skill"; `Agent Response` is the assistant text extracted by `parseStreamResult`. The judge cannot see the tool-call sequence, only the final text, the git diff, and files it reads itself.
- `read_file` is Gemini's tool name; when Claude or Codex is the judge the name doesn't match, and it relies on the model to understand [Inferred].
- Output schema: `[{assertion, passed: bool, reason}]`.

**Parsing** ([#L182-L221](https://github.com/fede0089/skill-eval/blob/bc7b1395857bddd6fa482b7ec867d8823aae0432/src/core/evaluator.ts#L182-L221)): empty judge output, `judgeRawOutput.error`, or `result.status==='error'` in the stream → throws, triggering a retry; takes the final text, greedily matches `/\[[\s\S]*\]/`, passes it through `sanitizeJsonControlChars()` (escapes bare newlines and tabs inside string literals and deletes other control characters, [#L143-L151](https://github.com/fede0089/skill-eval/blob/bc7b1395857bddd6fa482b7ec867d8823aae0432/src/core/evaluator.ts#L143-L151)), then `JSON.parse`; **aligns by array index**: `assertion = r.assertion || r.expectation || assertions[i]`, `passed = !!r.passed`. A JSON parse failure **neither throws nor retries**; all expectations are simply judged false ("Judge agent response was not valid JSON."). The number of returned items is not checked; when the judge returns fewer, the missing expectations simply don't appear in the results, and `every()` can still be true.

`validateAssertion()` (contains / not_contains / regex / json, [#L265-L283](https://github.com/fede0089/skill-eval/blob/bc7b1395857bddd6fa482b7ec867d8823aae0432/src/core/evaluator.ts#L265-L283)) has no caller in `src/`; it is dead code.

#### 4.4 From trials to report metrics

- **isCounted**: `!trial.isError`. Infrastructure errors stay out of the denominator ([FE/src/core/trial-utils.ts#L51-L53](https://github.com/fede0089/skill-eval/blob/bc7b1395857bddd6fa482b7ec867d8823aae0432/src/core/trial-utils.ts#L51-L53)). isError trials are rerun in full via `withRetry`, up to 2 times, backoff 1s, 2s ([#L66-L82](https://github.com/fede0089/skill-eval/blob/bc7b1395857bddd6fa482b7ec867d8823aae0432/src/core/trial-utils.ts#L66-L82)); trials aborted midway are padded with isError entries, and the report shows n=2/5 ([#L96-L116](https://github.com/fede0089/skill-eval/blob/bc7b1395857bddd6fa482b7ec867d8823aae0432/src/core/trial-utils.ts#L96-L116)).
- `computePassAtK(trials) = #passed / #counted`, **actually pass@1**; the `_k` parameter is unused ([statistics.ts#L34-L38](https://github.com/fede0089/skill-eval/blob/bc7b1395857bddd6fa482b7ec867d8823aae0432/src/core/statistics.ts#L34-L38)); yet the README calls it "pass@k".
- `computeAssertionPassRate = Σpassed assertions / Σassertions`, over counted trials only ([#L8-L15](https://github.com/fede0089/skill-eval/blob/bc7b1395857bddd6fa482b7ec867d8823aae0432/src/core/statistics.ts#L8-L15)).
- Suite level: both are **simple averages of per-eval rates** (macro average, [#L20-L57](https://github.com/fede0089/skill-eval/blob/bc7b1395857bddd6fa482b7ec867d8823aae0432/src/core/statistics.ts#L20-L57)). An eval with no counted trials contributes 0.
- The report's main score `scores[variant]`: trigger uses pass@1 ([FE/src/commands/trigger.ts#L258-L268](https://github.com/fede0089/skill-eval/blob/bc7b1395857bddd6fa482b7ec867d8823aae0432/src/commands/trigger.ts#L258-L268)), functional uses assertion pass rate ([FE/src/commands/functional.ts#L357-L385](https://github.com/fede0089/skill-eval/blob/bc7b1395857bddd6fa482b7ec867d8823aae0432/src/commands/functional.ts#L357-L385)). `passedCount` is the number of evals where all trials of the local variant passed.
- **Positive and negative cases are mixed into one score**: the trigger suite doesn't report recall and misfire rate separately, and the README states "feed a single success rate"; `TaskResult.shouldTrigger` enters the report only as a polarity label.
- No threshold or CI exit-code logic; commands don't fail because of low scores.

#### 4.5 Anomaly flags and manual review

`detectAnomalies(trial, cohort)`, where the cohort is the sibling trials of the same eval and variant, compared against the cohort median ([FE/src/core/anomalies.ts#L51-L94](https://github.com/fede0089/skill-eval/blob/bc7b1395857bddd6fa482b7ec867d8823aae0432/src/core/anomalies.ts#L51-L94)):
- `degenerate-output`: output length < median × 0.15;
- `zero-assertions`: 0 passed while the median > 0;
- `premature-stop`: output length 0 or stopStatus ≠ success;
- `resource-outlier`: tokens > median × 2.5.

These flags are only hints. A human clicks Exclude in the HTML report, and excluded trials leave the denominator just like isError, with the frontend recomputing ([FE/src/reporters/html-reporter.ts#L583-L624](https://github.com/fede0089/skill-eval/blob/bc7b1395857bddd6fa482b7ec867d8823aae0432/src/reporters/html-reporter.ts#L583-L624)). Exclusions live in localStorage, are not written back to JSON, and **do not affect evolve's decisions**.

Pseudocode:

```
for eval in evals, variant in {local, ref:*, baseline?}, t in 1..N:
  trial = withRetry(≤2, on isError):
    wt = git worktree; link skill (baseline doesn't link)
    tr = agent(prompt [+ MUST/MUST NOT use skill])
    if tr.error / result.status=error: return isError
    trigger:    pos → pass = success(tool_use(Skill|activate_skill,name)→tool_result ok)
                neg → no events → isError ; else pass = !attempt
    functional: baseline&attempt → fail ; with-skill&!success → fail
                verdicts = judge(prompt, text, git diff, expectations) with ≤2 retries
                judge retries exhausted → all false (counted) ; bad JSON → all false
                pass = all(verdicts)
rate(variant) = mean_over_evals( Σpass / #counted )          # trigger
              = mean_over_evals( Σpassed_assert / Σassert )   # functional
```

### 5. Baselines and version comparison (focus)

- **Frozen evals**: at the start of each run, `evals/` is copied into runDir (`freezeEvals`, [FE/src/core/skill-parts.ts#L39-L57](https://github.com/fede0089/skill-eval/blob/bc7b1395857bddd6fa482b7ec867d8823aae0432/src/core/skill-parts.ts#L39-L57)), and all variants are measured against this one copy of evals and `evals/config`; historical refs contribute only the implementation. `materializeImplementation` drops the top-level `evals/` when copying the skill, so the agent under test cannot see the scoring criteria ([#L87-L102](https://github.com/fede0089/skill-eval/blob/bc7b1395857bddd6fa482b7ec867d8823aae0432/src/core/skill-parts.ts#L87-L102)).
- **`--compare-ref`**: `git archive <ref> | tar -x` extracts the whole repository, then `git rev-parse --show-prefix` locates the skill subdirectory ([FE/src/utils/git.ts#L17-L45](https://github.com/fede0089/skill-eval/blob/bc7b1395857bddd6fa482b7ec867d8823aae0432/src/utils/git.ts#L17-L45)); the variant is named `ref:<x>`, and the worktree is still created from the current working tree ([functional.ts#L143-L171](https://github.com/fede0089/skill-eval/blob/bc7b1395857bddd6fa482b7ec867d8823aae0432/src/commands/functional.ts#L143-L171)).
- **`--compare-baseline`** (functional only): doesn't link the skill and also forbids it in the prompt; if an attempt is still detected in the baseline, that trial is judged a failure (see 4.2).
- **`evolve`** ([FE/src/commands/evolve.ts#L151-L389](https://github.com/fede0089/skill-eval/blob/bc7b1395857bddd6fa482b7ec867d8823aae0432/src/commands/evolve.ts#L151-L389)):
  - Evals are frozen only once for the whole session ([#L174-L175](https://github.com/fede0089/skill-eval/blob/bc7b1395857bddd6fa482b7ec867d8823aae0432/src/commands/evolve.ts#L174-L175)); the candidate variant is `local` (the working tree) and the incumbent is `ref:HEAD`.
  - **`--predict`**: when the working tree has uncommitted changes, you must declare the expected-to-improve expectations as `<evalId>#<n>`, otherwise it errors and lists all frozen expectations ([#L177-L208](https://github.com/fede0089/skill-eval/blob/bc7b1395857bddd6fa482b7ec867d8823aae0432/src/commands/evolve.ts#L177-L208)); `parseDeclaredPrediction` parses with the regex `^(\d+)#(\d+)$`, `resolvePredictions` resolves by position or exact text, and anything unresolvable is an error ([FE/src/core/evolution.ts#L96-L144](https://github.com/fede0089/skill-eval/blob/bc7b1395857bddd6fa482b7ec867d8823aae0432/src/core/evolution.ts#L96-L144)).
  - **optimizer**: the prompt gives only where the evidence lives (report.html, transcripts directory, editable implementation path, read-only evals path), asks it to propose "exactly one hypothesis", and to end with `{"hypothesis": "...", "predictions": [{"eval": 1, "expectation": "exact text"}]}` ([FE/src/core/optimizer.ts#L42-L77](https://github.com/fede0089/skill-eval/blob/bc7b1395857bddd6fa482b7ec867d8823aae0432/src/core/optimizer.ts#L42-L77)), parsed with the same tolerance as the judge ([#L88-L116](https://github.com/fede0089/skill-eval/blob/bc7b1395857bddd6fa482b7ec867d8823aae0432/src/core/optimizer.ts#L88-L116)). The following all count as invalid proposals: out-of-bounds changes (which get reverted), no changes, no declaration, declaring a nonexistent expectation, timeout ([evolve.ts#L316-L349](https://github.com/fede0089/skill-eval/blob/bc7b1395857bddd6fa482b7ec867d8823aae0432/src/commands/evolve.ts#L316-L349)). Invalid proposals are not measured but still consume one proposal from the budget.
  - **Inconclusive check** `isInconclusive`: any variant with no counted trial in any eval → throws and restores, no decision made ([evolution.ts#L154-L160](https://github.com/fede0089/skill-eval/blob/bc7b1395857bddd6fa482b7ec867d8823aae0432/src/core/evolution.ts#L154-L160)).
  - **Acceptance rules** `decide()` ([evolution.ts#L175-L211](https://github.com/fede0089/skill-eval/blob/bc7b1395857bddd6fa482b7ec867d8823aae0432/src/core/evolution.ts#L175-L211)), checked in order:
    1. `effectiveness(candidate) > effectiveness(incumbent)`, where effectiveness is the unrounded aggregateAssertionPassRate; otherwise `not-better`;
    2. Every prediction satisfies `candidateRate > incumbentRate`, where rate is "trials where that expectation passed / all counted trials of that eval". The denominator includes trials where the skill wasn't activated (those trials have only one synthetic assertion), so "not activated" also counts as that expectation failing ([#L35-L88](https://github.com/fede0089/skill-eval/blob/bc7b1395857bddd6fa482b7ec867d8823aae0432/src/core/evolution.ts#L35-L88)). Otherwise `unattributable`;
    3. No "collapse": there is no expectation that the incumbent passed in all counted trials while the candidate failed in all trials. Partial declines are deliberately tolerated, because with nondeterministic agents "reject on any decline" would mean nothing could ever be accepted ([#L190-L202](https://github.com/fede0089/skill-eval/blob/bc7b1395857bddd6fa482b7ec867d8823aae0432/src/core/evolution.ts#L190-L202)). Otherwise `total-regression`;
    4. All of the above met: `accepted` → commit only the skill implementation, with the commit message recording both effectiveness values (4 decimal places), the confirmed predictions, and runDir ([evolve.ts#L110-L140](https://github.com/fede0089/skill-eval/blob/bc7b1395857bddd6fa482b7ec867d8823aae0432/src/commands/evolve.ts#L110-L140)).
  - **End-to-end re-measurement**: at session end, if HEAD changed, it reruns a comparison between the initial sha and the final version, to avoid accumulating the selection bias introduced by each round's acceptance ([evolve.ts#L371-L382](https://github.com/fede0089/skill-eval/blob/bc7b1395857bddd6fa482b7ec867d8823aae0432/src/commands/evolve.ts#L371-L382)).
  - All comparisons are **strict greater-than on point estimates**, with no significance test or minimum difference; at 5 trials per variant, noise is enough for rules 1 and 2 to hold by chance [Inferred].

### 6. Repeated runs and statistics

Default 5 trials, adjustable concurrency. Metrics are all averages of rates; no CI, standard deviation, Wilson interval or bootstrap. True pass@k is not implemented.

### 7. Cost / token accounting

Reads real tokens from the agent's `result.stats` / `usage` (for Claude `total = input + output`, `cached` from `cache_read_input_tokens`, [claude-code/runner.ts#L118-L133](https://github.com/fede0089/skill-eval/blob/bc7b1395857bddd6fa482b7ec867d8823aae0432/src/runners/claude-code/runner.ts#L118-L133)), averaged per variant over trials with data ([statistics.ts#L78-L89](https://github.com/fede0089/skill-eval/blob/bc7b1395857bddd6fa482b7ec867d8823aae0432/src/core/statistics.ts#L78-L89)). Duration is also recorded. Judge and optimizer usage is not tracked. No conversion to money.

### 8. Rule files

Not applicable. The user's own CLAUDE.md/AGENTS.md in the worktree is loaded naturally by the agent ("resolve its ambient configuration exactly as it would in the author's real use"), but rules are not graded in any way.

### 9. Privacy and data flow

Everything runs locally; data leaves only through each agent CLI's own model calls (executor, judge, optimizer). Logs and reports go to `~/.skill-eval` by default, and `--output` must be outside the working tree and the skill directory ([FE/src/core/output-location.ts](https://github.com/fede0089/skill-eval/blob/bc7b1395857bddd6fa482b7ec867d8823aae0432/src/core/output-location.ts)). No telemetry.

## Limitations (observed in source)

1. Judge infrastructure failures (retries exhausted) and JSON parse failures are both recorded as "all expectations failed" and enter the denominator, indistinguishable from "the agent didn't do it"; the judge has no timeout.
2. The number of items the judge returns is not checked, and alignment is by index; missing expectations vanish from the results.
3. Positive and negative cases are mixed into one trigger score, so misfires and missed uses offset each other.
4. The so-called "pass@k" is actually pass@1; comparisons are strict greater-than on point estimates with no statistical test.
5. With-skill functional runs force "You must use the skill" in the prompt, so they measure "how well it works when forced", not natural use; likewise the baseline explicitly forbids it in the prompt.
6. Codex triggering is heuristic, and the instructions file encourages using the skill.
7. Manual excludes exist only in the browser and don't flow back to JSON or evolve.
8. The `expected_output` and `files` fields and `validateAssertion` are dead code.
