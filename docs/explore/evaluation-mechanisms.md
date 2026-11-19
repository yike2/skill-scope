# How others judge whether a Skill / Rule File is good

2026-11-19 · Scope: existing skill evaluation tools, analysis tools that read real sessions, and research on how well AGENTS.md / CLAUDE.md / Skills work. Organized around three questions:

1. **Data source**: what data is used for evaluation.
2. **Localization**: how to establish that the evaluated skill or rule appeared in this run, took effect, and whether it should have taken effect.
3. **Evaluation dimensions**: which aspects are used to judge quality, and how each dimension is scored.

Source-level details for each tool (verbatim prompts, formulas, code locations) are in [tools/](tools/README.md); this document only compares across tools. Tags: [Observed] visible in a primary source; [Inferred] reasoned or calculated from it.

## 1. Data sources

### 1.1 Five kinds of data source

| Type | Approach | Examples |
|---|---|---|
| **Prepared tasks + sandboxed runs** | Write prompts and expected results in advance; each time, actually launch the agent in a fresh directory or container | skillgrade, fede0089/skill-eval, aws-samples, tardigrde, Caliper, skill-creator, `claude plugin eval` |
| **Prepared tasks + direct model calls** | No agent; put SKILL.md in the prompt and call a chat API once | darkrishabh/agent-skills-eval |
| **Real local sessions** | Read history under `~/.claude/projects`, `~/.codex/sessions`, etc., and analyze after the fact | warp skill-doctor, skill-retro, PRISM, cc-skill-usage, session-report, `/skill-doctor`, Opaline |
| **Tasks derived from real sessions** | Extract tasks from real sessions, then re-run them offline | skillopt-sleep, `history_file` in `claude plugin eval` |
| **Research benchmarks** | Build experiments from real PRs in open-source repos or scripted tasks, run under multiple conditions | Lulla et al., Khatri, McMillan, SkillsBench |

### 1.2 Where prepared tasks come from [Observed]

- **Hand-written case files**: skillgrade uses `eval.yaml` (instruction + workspace fixtures + `expected`, shown only to the grader); fede0089 and tardigrde use `evals.json` (prompt, assertions, `should_trigger`); Caliper uses `.eval.yaml` (task, skill under test, "neighbor" skills, a seeded conversation `history:`).
- **LLM-generated, human-reviewed**:
  - skill-creator generates 20 trigger queries, 8–10 each that should and should not trigger, and requires the negatives to be hard cases that "look relevant but should not trigger";
  - Caliper's `grill-skill` first interviews the author, then generates normal, edge and adversarial tasks;
  - both `skillgrade init` and `claude plugin eval init` can draft cases.
- **Dataset expansion**: skillgrade can generate tasks in bulk from JSONL or CSV.
- **Forced invocation**: tardigrde's `force_skill_invocation` prepends "Use the $skill skill." to the prompt; skill-creator writes the skill path straight into the prompt for functional evaluation. This measures "how well it works once used", not whether it gets selected.
- **Isolation**: expected results and grading scripts are hidden from the agent under test (fede0089 does not copy `evals/` into the run directory). There are leaks too: skillgrade's Docker image copies the rubric in; a tardigrde report records the agent following the directory tree and reading the grader file.

### 1.3 How real sessions are collected [Observed]

- **warp skill-doctor**:
  - Range: last 45 days (by file modification time), limited to the current repo, excluding sessions with no tool calls;
  - Sampling: at most 12, preferring sessions that used a skill, at most 3 per skill, then up to 4 more without skill use;
  - Compression: each message truncated to 1500 characters, tool calls to 500 characters; above 160 messages only the first 100 and last 40 are kept.
- **session-report**: parses Claude Code JSONL, deduplicates by requestId and uuid, handles main sessions and subagent sessions separately, defaults to the last 7 days.
- **Opaline**: uploads the full session transcript to a server in real time via a hook and analyzes it server-side.
- **PRISM, cc-skill-usage**: scan all local history directly.

### 1.4 How research benchmarks are built [Observed]

- **Lulla et al.** (arXiv:2601.20404): 10 repos, 124 PRs.
- **Khatri** (arXiv:2607.27250): 17 tasks, 288 runs.
- **McMillan** (arXiv:2605.10039): 1650 Claude Code sessions; tasks are scripted, with one detectable instruction deliberately planted in the config file.
- **SkillsBench** (arXiv:2602.12670): 87 tasks, 18 model–harness combinations.

## 2. Localization: establishing that the evaluated thing took effect

### 2.1 Was the Skill used

| Tool | Detection rule | Attempt or success | When unobservable |
|---|---|---|---|
| Caliper | Dedicated tool call (`Skill` / `skill` / `skill_view`) **or** any tool argument matching the suffix `<name>/SKILL.md` | Attempt | Three states: unobservable / not used / which ones were used |
| fede0089 | `Skill` / `activate_skill`, exact name match | Positives require success; for negatives an attempt counts | Recorded as an infrastructure error, excluded from rates |
| tardigrde | Per agent; Claude Code output contains no tool events | Success for OpenCode | unknown, excluded from the denominator |
| skill-creator | The **first** tool call is `Skill` or `Read` and its arguments contain the temporary skill name | Attempt | Exceptions and timeouts count as "not triggered" |
| aws-samples | Any `Skill` call, any SKILL.md read, or running a skill script; for positives even a text mention counts | Attempt | Kept in the denominator |
| warp skill-doctor | `skills/<name>/`, `<name>/SKILL.md` or `"skill": "<name>"` appearing in tool arguments | No distinction | — |
| cc-skill-usage | Only `name=="Skill"` with non-empty `input.skill` | No distinction | — |
| session-report | `Skill` call or slash command | No distinction | — |

The common practice is to look only at tool calls, not at whether the reply mentions the skill name. cc-skill-usage counted this: in one project, 2330 text mentions versus only 11 actual invocations. [Observed]

One counterexample to note: aws-samples injects SKILL.md into the system prompt in every trigger test, including negatives that should not trigger, so it cannot measure "whether the description gets the agent to select this skill". [Observed]

### 2.2 Should the rule apply (applicability)

- **Fixed by the test case**: offline tools mark positives and negatives with `should_trigger: true/false`, so applicability is set when the cases are designed. Caliper also adds "neighbor" skills to check whether another skill steals the task. [Observed]
- **Decided by the judge**: warp's procedure-compliance rubric says to "only judge rules and skills that came into scope in the transcript"; e.g. PR rules apply only if a PR was opened. If no rule applies, it gives the top score `fully_compliant` outright. [Observed]
- **Keyword rules**: PRISM treats lines starting with Never/Always/Use etc. as rules, but actually checks only 3 hard-coded rules (editing migration files, interactive commands, TypeScript `any`); all other rules count as followed. [Observed]
- **Planted detectable instructions**: McMillan puts an annotation instruction in the config file that can be checked mechanically from the output, so both applicability and compliance are known. [Observed]

### 2.3 Attributing effects to a skill or rule

- **With/without baseline**: the same tasks run with and without the skill installed; the difference is the skill's effect. fede0089, tardigrde, aws-samples, darkrishabh and `claude plugin eval` all do this. [Observed]
- **Ablation**: Caliper's `--ablate <skill>` or `--ablate mcp:<server>` removes one component, re-runs, and compares task by task. [Observed]
- **Old vs. new version**:
  - when improving an existing skill, skill-creator uses a snapshot of the old version as the baseline;
  - fede0089's `--compare-ref` uses a historical version from git as the baseline, and `evolve` requires that improvements the new version declared in advance actually show up;
  - Caliper's `compare` warns when the two runs' conditions differ, e.g. a different judge or a different k.

  [Observed]
- **Time-window attribution**: session-report charges the tokens of every API call after a skill is invoked to that skill, until the next ordinary user message. It does not check whether the invocation succeeded, and subagent usage is not included. [Observed]
- **Real sessions have no baseline**: warp and skill-retro can only rely on a judge reading the sessions; there is no baseline. [Observed]

## 3. Evaluation dimensions

### 3.1 Dimensions and metrics

| Dimension | Metrics | Examples |
|---|---|---|
| **Trigger accuracy** | Positive trigger rate and negative false-trigger rate reported separately; per-skill recall, precision and unwanted rate (share of triggers that should not have happened) | Caliper, tardigrde, skill-creator (each query run 3 times; trigger rate ≥ 0.5 counts as triggered) |
| **Task outcome** | pass rate, weighted reward, pass@k, pass^k; whether all tests pass (resolve rate) | skillgrade, tardigrde, Caliper |
| **Relative improvement** | with minus without, or new version minus old version | fede0089, tardigrde, aws-samples, skill-creator, `claude plugin eval` |
| **Compliance** | Session-level compliance labels; rule compliance score; odds of following a single instruction | warp, PRISM, McMillan |
| **Process quality** | Efficiency (rework, trial and error, timing of verification), code quality, verbosity of replies; blind content and structure scores; instruction-following score | warp, skill-retro, skill-creator's comparator and analyzer |
| **Cost** | Tokens, duration, dollar cost, steps, tool-call count; Pareto classification of cost vs. effect | Nearly all tools; Caliper deliberately records no dollars; aws-samples does Pareto |
| **Security** | Static scan of skill content, deducting from 100 | aws-samples |
| **Usage** | Invocation counts, skills never invoked, context occupied | `/skill-doctor`, cc-skill-usage, session-report |

### 3.2 How each dimension is scored [Observed]

- **Deterministic checks**: file existence, whether a command ran, whether tests pass, git state, JSON paths, regex matches, tool calls and their arguments. tardigrde has 11 kinds of structured assertion, darkrishabh has 6 tool assertions, and `claude plugin eval` has four: regex, tool_used, tool_order, file_exists.
- **LLM judging**: the judge reads the transcript and rubric and outputs `{passed, reason}` per assertion, or a single score.
  - in `claude plugin eval`, each judge grader votes 3 times and needs at least 2 passes to pass;
  - Caliper lets the judge write a Python assertion script that runs in the working directory;
  - warp and skill-retro have the LLM output only labels; scores are computed by code or formula.
- **Human review**: skill-creator makes human feedback a core step: the user writes feedback item by item, and the next iteration is driven mainly by it; skillgrade supports human graders.
- **Example aggregation formulas**:
  - skillgrade: reward = Σ score × weight / Σ weight; reward ≥ 0.5 passes;
  - Caliper: successes / usable attempts;
  - warp: overall = 0.25·efficiency + 0.25·code quality + 0.2·compliance + 0.15·concision + 0.15·skill coverage, each term first transformed by 0.5 + 0.5s;
  - aws-samples: passes only if mean_with ≥ mean_without and mean_with ≥ 0.5.
- **Errors and undecidable cases**:
  - Caliper excludes infrastructure failures from the success rate;
  - tardigrde records undecidable assertions as skipped, excluded from the denominator;
  - skillgrade, darkrishabh and aws-samples count API errors and timeouts as failures.

Verbatim judge prompts, output formats and parsing for each tool are in [tools/README.md](tools/README.md#key-design-points-compared).

### 3.3 Repeated runs and statistics [Observed]

- **Tools**:
  - each case repeated 3 to 30 times: skillgrade presets 5/15/30, Caliper defaults to 3, fede0089 to 5, `claude plugin eval` to 3;
  - confidence intervals: only tardigrde gives Wilson intervals and bootstrap (2000 resamples);
  - significance tests: no tool does them.
- **Research**: Khatri uses equivalence testing to argue for "no effect".

## 4. Main research findings

| Study | What was evaluated | Findings |
|---|---|---|
| Lulla et al. (arXiv:2601.20404) | With vs. without AGENTS.md | Median runtime −28.64%, output tokens −16.58%, task completion comparable |
| Khatri (arXiv:2607.27250) | Different context strategies | No measurable effect on correctness (effect bounded within about 10–15 percentage points) |
| McMillan (arXiv:2605.10039) | Config file size, instruction position, file structure, conflicts with adjacent files | No effect from any of the four variables; each additional function generated in a session lowers the odds of compliance by about 5.6% |
| SkillsBench (arXiv:2602.12670) | With vs. without curated Skills | Average pass rate rose from 33.9% to 50.5%; small skills work better |
