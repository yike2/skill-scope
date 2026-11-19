# Claude Code built-ins: `claude plugin eval` and `/skill-doctor`

- Repository: Claude Code is **closed source**. `anthropics/claude-code` (about 156k★) publishes only the CHANGELOG, plugin examples and issues, not the implementation. This document is **based entirely on official docs, the CHANGELOG and local `--help` output**; there is no source to cite.
- Versions relied on:
  - CHANGELOG: `anthropics/claude-code@9cf919afe52f17a76dcd66aa9a3bd3df619d2a5d` (2026-11-19)
  - Docs: <https://code.claude.com/docs/en/plugin-evals>, <https://code.claude.com/docs/en/skills>, <https://code.claude.com/docs/en/plugins/measure> (fetched 2026-11-19)
  - Local `claude --version` = 2.1.325; only `claude plugin eval --help` and `claude plugin eval init --help` were run
- Language: TypeScript (the repository's main language); license: proprietary (no SPDX declared in the repository)
- In one sentence: `claude plugin eval` runs scripted cases against a plugin in isolated `claude -p` subprocesses, scores them with 6 kinds of graders, and automatically adds a no-plugin baseline to compute Δ; `/skill-doctor` reports each local skill's context cost and invocation count and flags skills that were never invoked.

> CHANGELOG permalink prefix: `CL = https://github.com/anthropics/claude-code/blob/9cf919afe52f17a76dcd66aa9a3bd3df619d2a5d/CHANGELOG.md`

## Features

| Feature | Version added | What it does | Source |
|---|---|---|---|
| `claude plugin eval [target]` | 2.1.269 | Runs `<eval dir>/**/prompt.md|case.yaml` cases, outputs a summary table, `aggregate-result.json`, `report.html` | [CL#L4713](https://github.com/anthropics/claude-code/blob/9cf919afe52f17a76dcd66aa9a3bd3df619d2a5d/CHANGELOG.md#L4713); docs "How an eval run works" |
| `claude plugin eval init [name]` | Same | Interactive interview: reads the plugin, proposes prompts that should/should not trigger, designs graders, does a trial run, writes files; `--bare` writes an empty template | `--help`; docs "Create your first eval suite" |
| `--disallow-tools` / `disallowed_tools` | 2.1.299 | Disables specified built-in tools | [CL#L2417](https://github.com/anthropics/claude-code/blob/9cf919afe52f17a76dcd66aa9a3bd3df619d2a5d/CHANGELOG.md#L2417) |
| API errors scored 0 | 2.1.299 | A run that ends on an API error is not graded, is scored 0, and the suite exits 1 | [CL#L2500](https://github.com/anthropics/claude-code/blob/9cf919afe52f17a76dcd66aa9a3bd3df619d2a5d/CHANGELOG.md#L2500) |
| git ≥ 2.31 check | 2.1.283 | Disables repository git hooks via environment variables; refuses to run on older git | [CL#L3818](https://github.com/anthropics/claude-code/blob/9cf919afe52f17a76dcd66aa9a3bd3df619d2a5d/CHANGELOG.md#L3818) |
| Permission hooks cannot override deny | 2.1.327 | Calls allowed by a plugin's permission hook are flagged | [CL#L302](https://github.com/anthropics/claude-code/blob/9cf919afe52f17a76dcd66aa9a3bd3df619d2a5d/CHANGELOG.md#L302) |
| `/skill-doctor` | CHANGELOG lists 2.1.261; docs say "requires v2.1.252 or later" (inconsistent) | Per-skill context cost, usage frequency, never-invoked flag; recently unused plugins | [CL#L5033](https://github.com/anthropics/claude-code/blob/9cf919afe52f17a76dcd66aa9a3bd3df619d2a5d/CHANGELOG.md#L5033); skills docs "Find unused skills" |
| Related: `/doctor prompt-audit` | 2.1.283 | Audits CLAUDE.md, skills, agents and commands for "prompt patterns written for older models" | [CL#L3752](https://github.com/anthropics/claude-code/blob/9cf919afe52f17a76dcd66aa9a3bd3df619d2a5d/CHANGELOG.md#L3752) |
| Related: `/usage` breakdown | — | Attributes recent usage share by skill, subagent, plugin, MCP server | [CL#L7446](https://github.com/anthropics/claude-code/blob/9cf919afe52f17a76dcd66aa9a3bd3df619d2a5d/CHANGELOG.md#L7446) |
| Related: OTel `claude_code.skill_activated` | Carries `invocation_trigger` since 2.1.126 | `user-slash` / `claude-proactive` / `nested-skill` | [CL#L7980](https://github.com/anthropics/claude-code/blob/9cf919afe52f17a76dcd66aa9a3bd3df619d2a5d/CHANGELOG.md#L7980) |

## Architecture and data flow (per docs)

```
evals/<case>/prompt.md (frontmatter + prompt)        evals/mocks/<server>/<tool>.md
evals/<case>/graders/*.md (type + rubric)             evals/<case>/case.yaml (context.*)
          │
          ▼  for each case × each arm(with / without) × runs(default 3)
  temp HOME + temp working directory + temp config; [scaffold_script]; [resume history_file]
  claude -p subprocess (loads only the plugin under test; no user CLAUDE.md/settings/MCP/memory)
          │  final reply / trace / newly created files / mock calls
          ▼
  graders: regex | tool_used | tool_order | file_exists  (free)
           llm | baseline (judge model, 3 votes each)
          ▼
  run score = weighted pass ratio → case score = mean over runs → Δ = WITH − W/OUT
          ▼
  summary table + aggregate-result.json (schemaVersion 1) + report.html [+ published to claude.ai]
```

## Core mechanisms

### 1. Input

- A case = a directory containing `prompt.md` and/or `case.yaml` and at least one grader; otherwise loading fails (docs "Write and refine cases").
- `prompt.md` frontmatter fields: `schema_version` ("1.1"), `name`, `description`, `tags`, `plugins`, `runs` (default 3, 1–50), `expected_outcome` (for humans only), `model`, `max_turns` (default 10, ≤200), `timeout_seconds` (default 300, ≤3600), `allowed_tools`, `append_system_prompt`, `env` (keys must match `EVAL_[A-Z0-9_]*`). Unknown keys are an error (docs "prompt.md frontmatter").
- Specific to `case.yaml`: `context.scaffold_script` (executed only with `--scaffold`, 120-second limit, a non-zero exit scores that run 0), `context.history_file`, `context.add_dirs`, `execution.prompt`, `graders` list (docs "case.yaml fields").
- Source: handwritten, or generated by the `init` interview. The official docs state explicitly, regarding skill-creator's `evals/evals.json`, that "neither tool reads the other's case files".

#### How `context.history_file` works

Docs verbatim: "save the transcript as a `.jsonl` file and name it in `context.history_file`, and the case's prompt becomes the next user turn"; the table says "A `.jsonl` transcript in the case directory to resume" ("Seed the workspace or conversation", "case.yaml fields"). What the docs confirm is only:

1. The file must be inside the case directory and be a `.jsonl` transcript ([Inferred] i.e. Claude Code's own session JSONL, otherwise it could not be resumed).
2. The case prompt is sent as the next user message after resuming, and grading covers only the turn after that.
3. When the target is a path, such cases **run only the with-arm by default**, "on the assumption that the recorded conversation already reflects the plugin", and print `single-arm (no Δ)` to stderr; comparison requires an explicit `--ablation with-without` ("Score against the no-plugin baseline").
4. Each run is still a fresh isolated environment; files referenced in the recorded session are **not** restored and must be prepared separately with `scaffold_script`. [Inferred]
5. The docs do not say: whether the JSONL is validated/sanitized, whether recorded tool_use is replayed, or how a mismatch with the current plugin version is handled.

So history_file means "re-run one turn starting from a real session", not "grade a session that has already happened".

### 2. Session / log parsing

Graders read the output of the current run itself, with optional `target`/`focus` (docs "What a grader can look at"):

| Value | Content |
|---|---|
| `last_message` (default) | Final reply text |
| `trace` | Session JSON, one message per line; `regex` sees all of it, `llm` sees only the **first 12 and last 12 messages**; quotes are JSON-escaped |
| `files` | List of paths of files newly created in this run (no content, excludes files that were only modified) |
| `{source: file, path}` | Content of a given file after the run; PNG/JPEG/GIF/WebP are given to the llm judge as images, other binaries are rejected |
| `mock_calls` | Each call to a mock MCP tool (input + return) |

### 3. Skill trigger detection

The recommended approach is a `tool_used` grader (docs "Write a case manually"):

```yaml
type: tool_used
tool: Skill
input_match: '"skill"\s*:\s*"(?:[\w-]+:)?your-skill-name"'
```

- Rule: count calls whose `tool` name is `Skill` and whose **JSON-encoded input** matches the `input_match` regex; pass if the count falls within `[min=1, max=∞]`; "at least once", including the `plugin-name:skill-name` namespaced form ("Grader types").
- It counts attempts: the docs do not mention checking whether the call succeeded. [Inferred]
- Asserting "should not trigger": `min: 0, max: 0`, plus `arm: both` so it is scored in both arms (2.1.319 fixed a wrong warning that previously claimed `max: 0` could never pass, [CL#L1311](https://github.com/anthropics/claude-code/blob/9cf919afe52f17a76dcd66aa9a3bd3df619d2a5d/CHANGELOG.md#L1311)).
- In two-arm mode, all `tool_used` graders with `tool: Skill` are automatically `scored: false` and shown only as a "plugin-fired indicator", **not scored** (see §4.4).

Unlike skill-creator's `run_eval.py`, this looks at all calls in the whole run, not just the first tool call.

### 4. Grading

Everything below is **as described in the docs**; the judge prompt and vote-parsing code are not visible.

#### 4.1 Six grader types and pass conditions (docs "Grader types")

| type | Options | Pass condition | Costs money |
|---|---|---|---|
| `regex` | `pattern`, `flags`, `match`, `target` | JS regex found in target; `match: not_contains` requires absence; `match: "count:N"` requires exactly N occurrences; use `flags: i` for case-insensitive, `(?i)` not supported | No |
| `tool_used` | `tool`, `input_match`, `min`, `max` | Number of calls with matching input ∈ [min (default 1), max (default unlimited)] | No |
| `tool_order` | `before`, `after` | Both are called, and the first call matching `before` precedes the first call matching `after` | No |
| `file_exists` | `path`, `exists` | Some file newly created in this run matches the glob (or none does when `exists: false`) | No |
| `llm` | `criteria`, `focus` | Judge gives **at least two of three votes PASS**; in the `.md` layout the file body is the criteria | Yes |
| `baseline` | `baseline_file`, `criteria` | Judge considers this run to satisfy the criteria **no worse than** the reference transcript `baseline_file` (`.jsonl`) in the case directory | Yes |

"There are no custom-code graders." ("Choose and weight graders")

#### 4.2 Judge model and rubric

- Default judge: the docs say "the model Claude Code uses for background tasks"; local `--help` says `--judge-model <model>  Override LLM-grader model (default: haiku)`. They presumably mean the same thing (the background-task model is the Haiku tier), but the wording differs. The CI example pins `--judge-model claude-haiku-4-5`.
- The rubric is written by the user; the official template (generated by `init --bare`):

  ```markdown
  ---
  type: llm
  ---

  PASS if <what a correct response contains>.
  FAIL if <what a wrong or missing response looks like>.
  ```

- Official stability advice ("Choose graders that give a stable signal"): use `regex` rather than `llm` for long outputs; one outcome grader + one process grader (`tool_used`/`tool_order`) per case; if `tool_used: Skill` passes but Δ is negative, "suspect the judge before the plugin. A small judge model can mark a correct answer wrong because it's formatted differently", and consider switching to `--judge-model sonnet`.
- **The judge system prompt, single-vote output format and parsing are not public**. The report shows each llm grader's "votes" and "the excerpt it judged" ("Create your first eval suite" step 4); [Inferred] each vote is a binary PASS/FAIL plus an explanation.

#### 4.3 From graders to run score, case score and suite metrics (docs "How a case is scored", "JSON result")

```
grader_i ∈ {pass, fail}, weight_i default 1 (any positive number)
run_score   = Σ(weight_i · pass_i) / Σ weight_i      # only over scored graders
case_score  = mean(run_score over runs in with-arm)  # cases[].aggregates.score
case_delta  = mean(with runs) − mean(without runs)   # cases[].aggregates.delta; omitted for single arm or when not comparable
case_pass   = case_score ≥ --threshold (default 1.0)
overallScore = mean(case_score)                       # aggregates.overallScore
meanDelta    = mean(case_delta)                       # aggregates.meanDelta
casesPassed / casesTotal
Perfect runs = share of with-arm runs where all graders pass (report only)
```

Exit codes: 0 all met; 1 any case below threshold, load failure, run could not start, API error, etc.; 2 exceeded `--max-cost-usd` or credentials rejected (`partial: true`); 130 interrupted; 143 terminated. "The with-minus-without delta is reported but never changes the exit code" ("Run evals in CI").

#### 4.4 Which graders are not scored in two-arm mode

In two-arm mode, the following graders are `scored: false`, not scored in either arm, and only their pass/fail is shown in the with-arm ("Score against the no-plugin baseline"):

- All `tool_used` with `tool: Skill`;
- When every mock server in the case is declared by the plugin, `regex` with `target: mock_calls` and `llm` with `focus: mock_calls`;
- Those marked `arm: with-only`.

Exceptions: when **all** graders in a case are in the excluded set, they are scored as usual; `arm: both` forces scoring; under `--ablation none` no grader is excluded, "so the same suite can produce a different absolute score in the two modes".

Rationale verbatim: "A check like 'the skill was invoked' can never pass without the plugin, so counting it would push the without-arm toward zero and inflate `Δ`."

#### 4.5 Errors, timeouts, unknowns

| Situation | Handling | Source |
|---|---|---|
| Run ends on an API error (rate limit, quota) | Not graded, scored 0, suite exits non-zero; in two-arm mode the case's W/OUT and Δ show `—`. Before 2.1.299, whatever had been produced was graded | "ended on an API error"; [CL#L2500](https://github.com/anthropics/claude-code/blob/9cf919afe52f17a76dcd66aa9a3bd3df619d2a5d/CHANGELOG.md#L2500) |
| Timeout, reaching `max_turns` | Recorded in `error` (e.g. `timed out after 300s`), **content produced so far is still graded**; "a non-null error doesn't imply score 0" | "JSON result" |
| Mock `expect:` not met, `abort_when`, agent-mock call budget (4×max_turns) exhausted | Run aborted, scored 0, `aborted` field states the reason, `error` is null | "Mock MCP servers", "JSON result" |
| Scaffold fails or exceeds 120 seconds | That run scored 0, `scaffold failed` | "Seed the workspace" |
| Runs still going after the cost cap is exceeded | Paid graders skipped, scored with free graders only, marked `skippedPaidGraders: true`; "its score isn't comparable" | `--help`; "JSON result" |
| Bash granted but no sandbox backend | Refuses to run, shows a run error, usually scored 0 | "Shell grants need a sandbox" |

There is no explicit "unknown" grader result; the docs recommend excluding `partial: true` and `skippedPaidGraders` results from trend charts.

#### 4.6 Pseudocode

```
for case in cases(filtered by --case/--tag):
    arms = [with] + ([without] if ablation==with-without else [])
    for arm in arms:
        for r in 1..runs:
            env = fresh_tmp_home_workdir(); [scaffold]; [resume history_file]
            out = claude_p(prompt, plugin if arm==with, allowed_tools ∩ grants,
                           max_turns, timeout)
            if out.api_error: score=0; continue
            if out.aborted:   score=0; continue
            results = [g.eval(out) for g in graders]        # llm: 3 votes, ≥2 PASS
            scored  = [g for g in graders if counts(g, arm, mode)]
            score   = Σ w·pass / Σ w over scored
    case.score = mean(with scores); case.delta = mean(with) − mean(without)
exit 1 if any case.score < threshold
```

### 5. Baselines and version comparison

- The default comparison is **with plugin vs without plugin** (ablation), not old vs new version. Comparing two versions requires running each separately and comparing the two `aggregate-result.json` files by hand (the docs mention no built-in version diff).
- The `baseline` grader offers another kind of comparison: whether this run is "no worse than" a reference transcript.
- The docs advise pinning `--model` and `--judge-model` in CI "so a model rollout isn't mistaken for a plugin regression".

### 6. Repeated runs and statistics

- 3 runs per arm by default (overridden by `--runs` or `runs`); `llm`/`baseline` take a 3-vote majority each time.
- Metrics are only means and differences; no variance, confidence intervals, pass@k or significance tests (not mentioned in the docs). The docs warn "A single run is noisy, so confirm any change at the default three runs".

### 7. Cost / token accounting

- `costUsd` is a cost estimate at **list price** (including judge calls); `durationSeconds` and `claudeVersion` are also written to the results.
- Call volume estimate: cases × runs × 2 agent runs, plus 3 judge calls per llm/baseline grader per run ("How a case is scored").
- `/skill-doctor` reports each skill's context cost (tokens of the skill listing that occupy every turn); `claude plugin details <name>` gives "Every turn" and "When invoked" token estimates for a plugin (measure docs).

### 8. Rule files (CLAUDE.md/AGENTS.md)

- For each `plugin eval` run, "Nothing personal or project-level loads… `CLAUDE.md` files… are absent"; even a CLAUDE.md written by the scaffold is not loaded ("How runs are isolated"). So **it cannot be used to test rule files**; the only approximation is `append_system_prompt`.
- `/skill-doctor` does not deal with rule files. The related tool is `/doctor`: it checks for duplicate local CLAUDE.md files and content derivable from code, and proposes moving always-on guidance into skills or nested CLAUDE.md files (skills docs "Check your setup with /doctor"); plus `/doctor prompt-audit` (2.1.283). Neither judges compliance item by item.

### 9. Privacy and data flow

- All runs and judge calls use the user's own credentials.
- **`report.html` is published to claude.ai by default**: when logged in with a claude.ai subscription and the account supports artifacts, it is published as a private artifact and `Published: <url>` is printed; `--no-publish` keeps it local; runs started from a Claude Code session default to local ("HTML report"). The report contains prompts, grader rubrics, and the excerpts the judge saw.
- The local `report.html` is self-contained with no external requests.
- `/skill-doctor`: runs locally, data stays local; requires a feature-flag fetch and is not available via Remote Control (skills docs). Plugin authors cannot get users' usage data: "Claude Code doesn't report a plugin's usage back to its author"; organizations can collect it themselves via OTel events (`skill_activated`, `plugin_loaded`, `plugin.name` on the cost counter) (measure docs).

### `/skill-doctor` summary (per docs)

- Covers all skills except bundled and enterprise skills, including plugin skills; in interactive mode it opens in the **Stats** tab of `/plugin`, and in `-p` mode it outputs text.
- Content: per-skill context cost and usage frequency; flags skills that are "in the skill list but never invoked" and points to where to turn them off; also lists recently unused plugins (the "Not used recently" threshold for plugins is unused for at least 14 days and 10 sessions).
- The statistics window and how "invocations" are counted (whether slash commands or failed calls are included) are **not documented**. [Inferred] Possibly the same source as the OTel `skill_activated` event (which distinguishes `user-slash`/`claude-proactive`/`nested-skill`).
- Makes no right/wrong judgments.

## Limitations (per docs)

1. Closed source: the judge prompt, vote parsing and history_file replay details cannot be audited.
2. Can only test components inside a plugin; rule files and user-level skills are out of scope (user skills must be turned off manually with `skillOverrides` for comparison).
3. `tool_used: Skill` is not scored in two-arm mode; trigger rate does not enter the score and is only an indicator.
4. Statistics are only means and differences; the default threshold of 1.0 is strict.
5. The llm judge sees only the first and last 12 messages of the trace; the middle of long sessions is invisible.
6. Reports are published to claude.ai by default; privacy-sensitive teams need to turn this off explicitly.
7. `/skill-doctor` only counts; it does not judge whether usage was correct.
