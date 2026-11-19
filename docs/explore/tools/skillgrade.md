# skillgrade (formerly mgechev/skill-eval)

- Repository: <https://github.com/mgechev/skillgrade> (the old address `mgechev/skill-eval` redirects here)
- commit: `ab2afd7c13e56c4bf9db173d68752a931cc8a400`, 2026-10-11
- stars: 737; language: TypeScript; license: MIT; npm `skillgrade` v0.5.0
- In one sentence: a CLI for writing "unit tests" for skills. It runs the scripted tasks in `eval.yaml` with a real agent CLI inside Docker or a local temp directory, scores them with a weighted mix of three grader kinds (deterministic scripts, LLM rubric, human), and after multiple trials reports pass_rate / pass@k / pass^k.

Permalink prefix below: `SG = https://github.com/mgechev/skillgrade/blob/ab2afd7c13e56c4bf9db173d68752a931cc8a400`.

## Features

| Command / option | Purpose |
|---|---|
| `skillgrade` (default) | Reads `eval.yaml`, runs N trials per task and scores them ([SG/src/commands/run.ts#L145-L308](https://github.com/mgechev/skillgrade/blob/ab2afd7c13e56c4bf9db173d68752a931cc8a400/src/commands/run.ts#L145-L308)) |
| `skillgrade init [--force]` | Detects SKILL.md; when an API key is present, has an LLM generate `eval.yaml` ([SG/src/commands/init.ts#L180-L240](https://github.com/mgechev/skillgrade/blob/ab2afd7c13e56c4bf9db173d68752a931cc8a400/src/commands/init.ts#L180-L240)) |
| `skillgrade preview [browser]` | View results in the CLI or a browser |
| `--smoke` / `--reliable` / `--regression` | Presets of 5 / 15 / 30 trials ([SG/src/skillgrade.ts#L69-L81](https://github.com/mgechev/skillgrade/blob/ab2afd7c13e56c4bf9db173d68752a931cc8a400/src/skillgrade.ts#L69-L81)) |
| `--trials` `--parallel` | Override the trial count; run trials concurrently |
| `--agent=gemini\|claude\|codex\|acp\|opencode\|command` | Choose the agent under test; if unspecified, picks automatically based on the single API key present ([run.ts#L178-L191](https://github.com/mgechev/skillgrade/blob/ab2afd7c13e56c4bf9db173d68752a931cc8a400/src/commands/run.ts#L178-L191)) |
| `--provider=docker\|local` | Isolation method |
| `--grader=TYPE` | Run only one grader type |
| `--eval` / `--filter` / `--not-filter` | Select tasks by name or `metadata` |
| `--validate` | Runs the task's `solution` script in place of the agent, to verify the graders themselves can award full marks ([run.ts#L244-L269](https://github.com/mgechev/skillgrade/blob/ab2afd7c13e56c4bf9db173d68752a931cc8a400/src/commands/run.ts#L244-L269)) |
| `--ci --threshold=0.8` | Exits non-zero if any task's pass_rate is below the threshold ([run.ts#L291-L318](https://github.com/mgechev/skillgrade/blob/ab2afd7c13e56c4bf9db173d68752a931cc8a400/src/commands/run.ts#L291-L318)) |
| `--format=json,junit,csv,markdown` | Export reports ([SG/src/reporters/index.ts](https://github.com/mgechev/skillgrade/blob/ab2afd7c13e56c4bf9db173d68752a931cc8a400/src/reporters/index.ts)) |
| eval.yaml: multi-turn `turns`, `dataset` (JSONL/CSV expansion), `expected`, `metadata`, `$import` for splitting files | See README "eval.yaml Reference" |
| Extension points | `registerGrader()`, `registerReporter()` ([SG/src/graders/index.ts#L11-L17](https://github.com/mgechev/skillgrade/blob/ab2afd7c13e56c4bf9db173d68752a931cc8a400/src/graders/index.ts#L11-L17)) |

## Architecture and data flow

```
eval.yaml ──loadConfig/resolveTask──▶ ResolvedTask
   │                                    │ prepareTempTaskDir: writes tests/test*.sh, prompts/quality*.md, Dockerfile
   ▼                                    ▼
detectSkills() ──skillsPaths──▶ Provider.prepare/setup (in the Docker image, copies skills to .agents/skills and .claude/skills)
                                        │
                     EvalRunner.runEval ── for trial in 1..N ──▶ runSingleTrial
                                        │   agent.run(instruction) → sessionLog: agent_start / command / agent_result
                                        │   executeGraders(): grade in order → GraderResult{score,weight,details}
                                        │   finalizeTrial(): reward = Σ score·w / Σ w
                                        ▼
                         EvalReport{pass_rate, pass_at_k, pass_pow_k, trials[]} → JSON to disk / reporters / CI decision
```

- Entry point and task loop: [SG/src/commands/run.ts](https://github.com/mgechev/skillgrade/blob/ab2afd7c13e56c4bf9db173d68752a931cc8a400/src/commands/run.ts)
- Trial execution and aggregation: [SG/src/evalRunner.ts](https://github.com/mgechev/skillgrade/blob/ab2afd7c13e56c4bf9db173d68752a931cc8a400/src/evalRunner.ts)
- Grader dispatch, statistics functions: [SG/src/evalHelpers.ts](https://github.com/mgechev/skillgrade/blob/ab2afd7c13e56c4bf9db173d68752a931cc8a400/src/evalHelpers.ts)
- The three graders: [graders/index.ts](https://github.com/mgechev/skillgrade/blob/ab2afd7c13e56c4bf9db173d68752a931cc8a400/src/graders/index.ts) (LLM), [deterministic.ts](https://github.com/mgechev/skillgrade/blob/ab2afd7c13e56c4bf9db173d68752a931cc8a400/src/graders/deterministic.ts), [human.ts](https://github.com/mgechev/skillgrade/blob/ab2afd7c13e56c4bf9db173d68752a931cc8a400/src/graders/human.ts)
- Agent adapters: [SG/src/agents/](https://github.com/mgechev/skillgrade/tree/ab2afd7c13e56c4bf9db173d68752a931cc8a400/src/agents)

## Core mechanisms

### 1. Input: test cases

- `tasks[]` in `eval.yaml`, with fields defined in [SG/src/core/config.types.ts#L53-L93](https://github.com/mgechev/skillgrade/blob/ab2afd7c13e56c4bf9db173d68752a931cc8a400/src/core/config.types.ts#L53-L93): `name`, `instruction` or `turns[]`, `workspace[]` (eval fixtures), `context[]` (files for the agent to reference), `graders[]`, `solution`, `expected`, `metadata`, `dataset`, plus per-task overrides such as agent/model/trials/timeout/grader_model/grader_provider.
- Grader definition: `{type: deterministic|llm_rubric|human, run?, rubric?, model?, provider?, weight, prompt?, setup?}` ([config.types.ts#L16-L26](https://github.com/mgechev/skillgrade/blob/ab2afd7c13e56c4bf9db173d68752a931cc8a400/src/core/config.types.ts#L16-L26)).
- Defaults: agent `gemini`, provider `docker`, trials 5, timeout 300s, threshold 0.8 ([SG/src/core/config.ts#L25-L38](https://github.com/mgechev/skillgrade/blob/ab2afd7c13e56c4bf9db173d68752a931cc8a400/src/core/config.ts#L25-L38)).
- `expected` goes only to graders: deterministic via the `SKILLGRADE_INPUT` environment variable, llm_rubric by splicing it into the prompt; it is not written into the workspace. **But rubric files and grader scripts do enter the workspace**: `prepareTempTaskDir` writes them to `tests/` and `prompts/`, and the `COPY . .` at the end of the Dockerfile copies the whole directory into `/workspace` ([run.ts#L358-L392](https://github.com/mgechev/skillgrade/blob/ab2afd7c13e56c4bf9db173d68752a931cc8a400/src/commands/run.ts#L358-L392), [#L466](https://github.com/mgechev/skillgrade/blob/ab2afd7c13e56c4bf9db173d68752a931cc8a400/src/commands/run.ts#L466)), so the agent under test can read the scoring criteria. A code comment itself says the rubric "lands in the workspace" ([graders/index.ts#L110-L111](https://github.com/mgechev/skillgrade/blob/ab2afd7c13e56c4bf9db173d68752a931cc8a400/src/graders/index.ts#L110-L111)).

### 2. Session / log parsing

It does not read real sessions. Each trial generates its own internal `sessionLog`, with entry types `agent_start`, `command`, `agent_result`, `grader`, `reward`, `turn_start/turn_end` ([evalRunner.ts#L134-L154](https://github.com/mgechev/skillgrade/blob/ab2afd7c13e56c4bf9db173d68752a931cc8a400/src/evalRunner.ts#L134-L154), [#L339-L359](https://github.com/mgechev/skillgrade/blob/ab2afd7c13e56c4bf9db173d68752a931cc8a400/src/evalRunner.ts#L339-L359)).

Each agent adapter receives only the CLI's stdout:
- Claude: `claude -p --dangerously-skip-permissions "$(cat /tmp/.prompt.md)"`, returns `stdout + stderr` as plain text, without stream-json, so tool calls are invisible ([SG/src/agents/claude.ts#L17-L37](https://github.com/mgechev/skillgrade/blob/ab2afd7c13e56c4bf9db173d68752a931cc8a400/src/agents/claude.ts#L17-L37)).
- Gemini: `gemini -y --sandbox=none -p ...`, also plain text ([gemini.ts](https://github.com/mgechev/skillgrade/blob/ab2afd7c13e56c4bf9db173d68752a931cc8a400/src/agents/gemini.ts)).
- Codex: `codex exec --json`, parses `item.completed` (`agent_message`, `command_execution`) and `turn.completed.usage` from the JSONL ([SG/src/agents/codex.ts#L15-L88](https://github.com/mgechev/skillgrade/blob/ab2afd7c13e56c4bf9db173d68752a931cc8a400/src/agents/codex.ts#L15-L88)).

So the `command` entries in sessionLog are in practice only two: the base64 command that writes the prompt to `/tmp/.prompt.md` and the agent CLI invocation itself, not every shell command the agent runs internally.

### 3. Skill trigger detection

- How skills are installed: copied into the workspace's `.agents/skills/<name>` and `.claude/skills/<name>`, for the agent to discover on its own (Docker: [SG/src/providers/docker.ts#L43-L70](https://github.com/mgechev/skillgrade/blob/ab2afd7c13e56c4bf9db173d68752a931cc8a400/src/providers/docker.ts#L43-L70); local: [local.ts#L12-L25](https://github.com/mgechev/skillgrade/blob/ab2afd7c13e56c4bf9db173d68752a931cc8a400/src/providers/local.ts#L12-L25)).
- Only the Codex adapter performs detection: the command text of `command_execution` is matched against the regex `(?:\.claude\/skills|\.agents\/skills|\.codefuse\/fuse\/skills)\/([^/\s]+)`, deduplicated by skill name, and recorded as `{source:'file_read'}` ([codex.ts#L46-L62](https://github.com/mgechev/skillgrade/blob/ab2afd7c13e56c4bf9db173d68752a931cc8a400/src/agents/codex.ts#L46-L62)). It looks only at commands, not agent_message, so an agent mentioning a skill in text does not count. It does not distinguish "attempted" from "succeeded".
- **Detection results are discarded**: `runSingleTrial` writes only `agentResult.output` into sessionLog ([evalRunner.ts#L353-L359](https://github.com/mgechev/skillgrade/blob/ab2afd7c13e56c4bf9db173d68752a931cc8a400/src/evalRunner.ts#L353-L359)); `skills_triggered` does not enter the report or scoring, and apart from the type definition nothing in the repository reads it. The report's `skills_used` is only "which skills were installed" (directory names from `skillsPaths`, [evalRunner.ts#L100](https://github.com/mgechev/skillgrade/blob/ab2afd7c13e56c4bf9db173d68752a931cc8a400/src/evalRunner.ts#L100)), not evidence the agent used them.
- To check "was the skill used", the author's approach is to put it in the rubric (README example "Did the agent follow the mandatory 3-step workflow?") or write a deterministic script that checks the artifacts.

### 4. Grading (focus)

#### 4.1 Main scoring path (step by step)

1. `runEval()` first calls `provider.prepare()` to build the image once, then calls `runSingleTrial()` N times, serially or concurrently ([evalRunner.ts#L49-L88](https://github.com/mgechev/skillgrade/blob/ab2afd7c13e56c4bf9db173d68752a931cc8a400/src/evalRunner.ts#L49-L88)).
2. `runSingleTrial()`: writes `agent_start`, runs the agent with `withTimeout(agent.run(...), timeout*1000)`, writes `agent_result` ([evalRunner.ts#L318-L359](https://github.com/mgechev/skillgrade/blob/ab2afd7c13e56c4bf9db173d68752a931cc8a400/src/evalRunner.ts#L318-L359)).
3. `executeGraders()` runs graders one by one in eval.yaml order. The i-th deterministic grader maps to `bash tests/test.sh` or `tests/test_i.sh`, the j-th llm_rubric to `prompts/quality.md` or `quality_j.md`; each grader receives `input = {task, trial, expected, metadata}`; each grader is wrapped in `withTimeout`, default 120s; results are also appended to sessionLog, so later LLM graders can see earlier graders' results ([SG/src/evalHelpers.ts#L68-L122](https://github.com/mgechev/skillgrade/blob/ab2afd7c13e56c4bf9db173d68752a931cc8a400/src/evalHelpers.ts#L68-L122)).
4. `finalizeTrial()` computes the trial reward, see 4.5 ([evalRunner.ts#L157-L196](https://github.com/mgechev/skillgrade/blob/ab2afd7c13e56c4bf9db173d68752a931cc8a400/src/evalRunner.ts#L157-L196)).
5. Back in `runEval()`, results are aggregated into task-level metrics ([evalRunner.ts#L90-L101](https://github.com/mgechev/skillgrade/blob/ab2afd7c13e56c4bf9db173d68752a931cc8a400/src/evalRunner.ts#L90-L101)), and `run.ts` compares pass_rate with the threshold.

Pseudocode:

```
for task in tasks:
  trials = []
  repeat N:
    ws = provider.setup()                       # fresh container / temp directory
    try:
      out = timeout(agent.run(instr), T_agent)  # timeout or exception → whole trial reward=0
      results = []
      for g in graders:                         # sequential; LLM graders see earlier results
        r = timeout(g.grade(ws, log), 120s)     # throws (incl. timeout) → whole trial reward=0
        results.append(r)                       # failures inside a grader return score=0, no throw
      reward = Σ r.score·r.weight / Σ r.weight  (Σw=0 → 0)
    except: reward = 0, grader_results = []
    trials.append(reward)
  pass_rate = mean(reward)                      # mean reward, not a pass proportion
  successes = #(reward >= 0.5)
  pass@k = 1 - C(n-c,n)/C(n,n)  (k=n, i.e. 1 if reward>=0.5 at least once)
  pass^k = (c/n)^n
  CI fails ⇔ pass_rate < threshold(0.8)
```

#### 4.2 deterministic grader

[SG/src/graders/deterministic.ts#L15-L72](https://github.com/mgechev/skillgrade/blob/ab2afd7c13e56c4bf9db173d68752a931cc8a400/src/graders/deterministic.ts#L15-L72)
- Runs a script in the workspace (default `bash tests/test.sh`), with the task context as JSON in the `SKILLGRADE_INPUT` environment variable.
- Greedily matches `/\{[\s\S]*\}/` in stdout, then `JSON.parse`; `score = clamp(parseFloat(score)||0, 0, 1)`; `checks[]` is only concatenated into the details text (`✓/✗ name: message`) and **does not count toward the score**. The score is computed entirely by the script; the spec recommends score = passed checks / total ([skills/skillgrade-graders/references/grader-output-schema.md](https://github.com/mgechev/skillgrade/blob/ab2afd7c13e56c4bf9db173d68752a931cc8a400/skills/skillgrade-graders/references/grader-output-schema.md)).
- Failure handling: no JSON in stdout → score 0, with stdout/stderr in details; JSON parse failure → score 0. **The exit code is ignored**, even though the schema doc says "a non-zero exit code indicates grader failure"; the prompt `init` uses to generate scripts also demands "Do NOT use exit codes for scoring".
- Output schema: `{score: 0..1, details: string, checks?: [{name, passed, message}]}`.

#### 4.3 llm_rubric grader

[SG/src/graders/index.ts#L49-L170](https://github.com/mgechev/skillgrade/blob/ab2afd7c13e56c4bf9db173d68752a931cc8a400/src/graders/index.ts#L49-L170)

The transcript is assembled ([#L71-L108](https://github.com/mgechev/skillgrade/blob/ab2afd7c13e56c4bf9db173d68752a931cc8a400/src/graders/index.ts#L71-L108)) in four sections: `## Task Instruction` (agent_start), `## Commands Executed` (each `$ cmd`, stdout, STDERR, `[exit code]`, excluding the base64 prompt-writing command matching `PROMPT_DELIVERY_COMMAND`, [#L36](https://github.com/mgechev/skillgrade/blob/ab2afd7c13e56c4bf9db173d68752a931cc8a400/src/graders/index.ts#L36)), `## Agent Output`, `## Prior Grader Results (automated tests)` (earlier graders' `type: score=0.xx — details`). When `expected` exists, `## Expected Output` is added ("The reference answer for this task. The agent never saw it.").

Full judge prompt ([#L120-L130](https://github.com/mgechev/skillgrade/blob/ab2afd7c13e56c4bf9db173d68752a931cc8a400/src/graders/index.ts#L120-L130)):

```
You are an evaluation judge. Score the following agent session on a scale from 0.0 to 1.0 based on the rubric below.

IMPORTANT CONTEXT: The agent runs inside a CLI wrapper (e.g., Gemini CLI). The agent's tool calls (file edits, shell commands) appear as text in the "Agent Output" section. This is a real execution trace, not hallucination — the "Commands Executed" section shows the CLI invocation and its captured output. The "Prior Grader Results" section shows objective automated test results that verify the actual filesystem state after the agent ran.

## Rubric
${rubric}${expectedSection}

## Session Transcript
${transcript}

Respond with ONLY a JSON object: {"score": <number>, "reasoning": "<brief explanation>"}
```

- The rubric is free-form text written by the user; the README example splits the score into sub-items ("Workflow Compliance (0-0.5) … Efficiency (0-0.5)"), which the LLM sums itself.
- Model selection: `config.model` first, then the `GEMINI_MODEL` environment variable / the corresponding provider's variable, otherwise it calls the provider's models list endpoint and picks dynamically: Gemini picks the highest-versioned `gemini-*-flash`, Anthropic the latest `haiku`, OpenAI the latest `mini/nano/flash` ([SG/src/utils/models.ts#L4-L138](https://github.com/mgechev/skillgrade/blob/ab2afd7c13e56c4bf9db173d68752a931cc8a400/src/utils/models.ts#L4-L138)). The default provider is `gemini` ([index.ts#L132](https://github.com/mgechev/skillgrade/blob/ab2afd7c13e56c4bf9db173d68752a931cc8a400/src/graders/index.ts#L132)). **Run the same eval.yaml at a different time and the judge model may have changed**; the report does not record the model actually used.
- Call parameters: Gemini and OpenAI set `temperature: 0`; Anthropic sets no temperature, `max_tokens 4096`, and takes the first content block with `type==='text'` (skipping thinking) ([#L198-L311](https://github.com/mgechev/skillgrade/blob/ab2afd7c13e56c4bf9db173d68752a931cc8a400/src/graders/index.ts#L198-L311)). One call per trial, no retries.
- Parsing and validation in `parseResponse()` ([#L313-L362](https://github.com/mgechev/skillgrade/blob/ab2afd7c13e56c4bf9db173d68752a931cc8a400/src/graders/index.ts#L313-L362)) tries four fallback levels in order:
  1. Strip ``` code fences, greedily match `{…}` then `JSON.parse`, `score = clamp(parseFloat||0)`, `details = reasoning`;
  2. When JSON parsing fails (usually truncated output), take the score with the regex `"score"\s*:\s*([\d.]+)` and `reasoning` up to the truncation point;
  3. When there is no JSON at all in the text, extract the score from plain text with `/"score"\s*:\s*([\d.]+)|score[:\s]+(\d+\.?\d*)/i`;
  4. All fail: score 0, details `Failed to parse LLM response: …`.
- Error handling: missing API key, non-2xx HTTP (`httpError()` writes the status code into details, [#L179-L196](https://github.com/mgechev/skillgrade/blob/ab2afd7c13e56c4bf9db173d68752a931cc8a400/src/graders/index.ts#L179-L196)), network exceptions, missing rubric file, unknown provider: **all return score 0 without throwing**. So "the judge is broken" and "the agent did badly" are indistinguishable in the reward; only the details text tells them apart.

#### 4.4 human grader

[SG/src/graders/human.ts#L19-L130](https://github.com/mgechev/skillgrade/blob/ab2afd7c13e56c4bf9db173d68752a931cc8a400/src/graders/human.ts#L19-L130)
- Writes `{prompt, instruction, agent_output, commands, expected}` to `<workspace>/.review/<task>-<trial>.json`, prints a prompt box, and polls `<task>-<trial>.result.json` (format `{score, details}`) every 2s for up to 30 minutes; timeout scores 0.
- **Conflict at the code level**: the outer `executeGraders` wraps each grader in a `withTimeout` defaulting to 120s ([evalHelpers.ts#L108-L113](https://github.com/mgechev/skillgrade/blob/ab2afd7c13e56c4bf9db173d68752a931cc8a400/src/evalHelpers.ts#L108-L113)), and `graderTimeoutSec` is never assigned in `run.ts` (the whole repository has only its declaration and this one read). So if the human does not fill in a result within 120s, a timeout error is thrown and the whole trial scores 0; the 30-minute polling is never actually used. Also, under the Docker provider `workspace` is a container ID, while writing `.review/` uses the host fs, so the path semantics are questionable [Inferred, not verified by running].

#### 4.5 From grader scores to report metrics

- Trial reward: `reward = Σ(score_i × weight_i) / Σ weight_i`, 0 when Σweight=0 ([evalRunner.ts#L166-L169](https://github.com/mgechev/skillgrade/blob/ab2afd7c13e56c4bf9db173d68752a931cc8a400/src/evalRunner.ts#L166-L169)). Multi-turn tasks weight each turn's grader results together with the top-level graders' results ([#L288-L310](https://github.com/mgechev/skillgrade/blob/ab2afd7c13e56c4bf9db173d68752a931cc8a400/src/evalRunner.ts#L288-L310)).
- Trial PASS/FAIL: `reward >= 0.5` ([#L183](https://github.com/mgechev/skillgrade/blob/ab2afd7c13e56c4bf9db173d68752a931cc8a400/src/evalRunner.ts#L183), [#L91](https://github.com/mgechev/skillgrade/blob/ab2afd7c13e56c4bf9db173d68752a931cc8a400/src/evalRunner.ts#L91)).
- `pass_rate = Σreward / n`, the mean reward, not a pass proportion.
- `pass_at_k = calculatePassAtK(n, c, k=n)`, using the unbiased estimator `1 − Π_{i<k}(n−c−i)/(n−i)` ([evalHelpers.ts#L35-L42](https://github.com/mgechev/skillgrade/blob/ab2afd7c13e56c4bf9db173d68752a931cc8a400/src/evalHelpers.ts#L35-L42)). k is always passed as n, so the result degenerates to "1 if c≥1, otherwise 0".
- `pass_pow_k = (c/n)^n` ([#L45-L48](https://github.com/mgechev/skillgrade/blob/ab2afd7c13e56c4bf9db173d68752a931cc8a400/src/evalHelpers.ts#L45-L48)), also with k=n. With 30 trials, even p=0.9 leaves pass^k at only about 0.04.
- CI: each task's `pass_rate < threshold` is checked separately, and any failing task fails the run ([run.ts#L291-L293](https://github.com/mgechev/skillgrade/blob/ab2afd7c13e56c4bf9db173d68752a931cc8a400/src/commands/run.ts#L291-L293)); no cross-task aggregate.
- Errors and timeouts: agent timeout, agent exception, grader timeout or exception all go through `handleTrialError()`: reward 0, `grader_results: []`, tokens recorded as 0, plus provider diagnostics ([evalRunner.ts#L198-L238](https://github.com/mgechev/skillgrade/blob/ab2afd7c13e56c4bf9db173d68752a931cc8a400/src/evalRunner.ts#L198-L238)). **Infrastructure errors still enter the denominator**; there is no "excluded" or "unknown" state and no retry. A non-zero agent CLI exit code only prints an error line and scoring proceeds normally ([claude.ts#L32-L34](https://github.com/mgechev/skillgrade/blob/ab2afd7c13e56c4bf9db173d68752a931cc8a400/src/agents/claude.ts#L32-L34)).

### 5. Baselines and version comparison

- The CLI has no with/without or version comparison. `AnalyticsEngine` implements Normalized Gain `NG = (p_with − p_without)/(1 − p_without)` and splits reports into with-skill and without-skill groups by whether `skills_used` is empty ([SG/src/analytics/engine.ts#L18-L90](https://github.com/mgechev/skillgrade/blob/ab2afd7c13e56c4bf9db173d68752a931cc8a400/src/analytics/engine.ts#L18-L90)), but nothing in `src/` calls it (only tests use it); it is dead code. For a baseline, users must remove the skill themselves, run again, and compare by hand.
- `--validate` verifies graders against a reference solution, which serves as a kind of control for the graders themselves.

### 6. Repeated runs and statistics

Presets of 5/15/30 trials; statistics as in 4.5. No confidence intervals, standard deviations or significance tests; trials within a task are independent (each gets a fresh container).

### 7. Cost / token accounting

Estimates: `input_tokens = ceil(len(instruction)/4)`, `output_tokens = Σ ceil(len(output+stdout+stderr)/4)` ([evalHelpers.ts#L51-L53](https://github.com/mgechev/skillgrade/blob/ab2afd7c13e56c4bf9db173d68752a931cc8a400/src/evalHelpers.ts#L51-L53), [evalRunner.ts#L178-L181](https://github.com/mgechev/skillgrade/blob/ab2afd7c13e56c4bf9db173d68752a931cc8a400/src/evalRunner.ts#L178-L181)). The Codex adapter parses the real `usage`, but it is discarded too. Duration and `n_commands` are also recorded. Judge cost is not tracked.

### 8. Rule files

Not applicable. There is no CLAUDE.md/AGENTS.md logic; `context[]` can place arbitrary files in the workspace, but nothing grades individual rules.

### 9. Privacy and data flow

- The agent under test calls its own cloud API (API key environment variables are injected into the Docker container).
- The LLM judge sends the instruction, agent output, command stdout/stderr and expected to Gemini/Anthropic/OpenAI (or a self-hosted endpoint pointed to by `*_BASE_URL`).
- Reports are written locally to `$TMPDIR/skillgrade`; before writing, `sanitizeReport()` replaces env values longer than 5 characters with `[REDACTED]` ([evalHelpers.ts#L125-L156](https://github.com/mgechev/skillgrade/blob/ab2afd7c13e56c4bf9db173d68752a931cc8a400/src/evalHelpers.ts#L125-L156)). No telemetry.

## Limitations (observed in source)

1. Only the Codex adapter has trigger detection, and its results are discarded; Claude and Gemini run in plain-text mode and cannot even see tool calls. So skillgrade effectively cannot tell whether a skill was used; it grades only outcome quality.
2. The "Commands Executed" the LLM judge sees contains only the agent CLI invocation itself, not the agent's internal tool calls; yet the prompt claims "agent's tool calls appear as text". That holds only when the agent prints its tool calls to stdout.
3. All failures (judge HTTP 401, parse failure, missing key) collapse to score 0, indistinguishable from genuinely low scores; infrastructure errors enter the denominator and are not retried.
4. The judge model is resolved dynamically to "latest Flash/Haiku" and not recorded in the report, so results are not reproducible across versions.
5. The human grader is cut off by the 120s outer timeout (see 4.4); the deterministic grader ignores exit codes, contradicting the schema doc.
6. pass@k and pass^k fix k=n, which degenerates their meaning; no confidence intervals.
7. Rubrics and grader scripts are copied into the agent's workspace by `COPY . .`, so the agent can see the scoring criteria (the README only guarantees `expected` stays out of the workspace).
8. NG / with-without analysis is dead code; the README does not mention this.
