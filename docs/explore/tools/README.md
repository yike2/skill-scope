# Source analysis of existing tools: index and cross-comparison

2026-11-19. One analysis per tool, each written from reading the source at each repo's HEAD in mid-November 2026; every conclusion has a permalink with a commit. Code was only read, not run. The focus is **how evaluation is implemented**. For the overall landscape and related research see [../evaluation-mechanisms.md](../evaluation-mechanisms.md).

## File index

| Category | Tool | File | One-liner |
|---|---|---|---|
| Offline evaluation | mgechev/skillgrade (formerly skill-eval) | [skillgrade.md](skillgrade.md) | Runs the agent in Docker; weighted scoring from deterministic scripts + LLM rubric |
| Offline evaluation | fede0089/skill-eval | [fede0089-skill-eval.md](fede0089-skill-eval.md) | Trigger tests + functional tests; `evolve` does version comparison with pre-declared expectations |
| Offline evaluation | aws-samples/sample-agent-skill-eval | [aws-skill-eval.md](aws-skill-eval.md) | Four-dimension scoring: security scan + with/without + triggering + cost |
| Offline evaluation | tardigrde/agent-skill-eval | [tardigrde-agent-skill-eval.md](tardigrde-agent-skill-eval.md) | 11 kinds of deterministic assertion first, LLM fills gaps; Wilson intervals and bootstrap |
| Offline evaluation | darkrishabh/agent-skills-eval | [darkrishabh-agent-skills-eval.md](darkrishabh-agent-skills-eval.md) | No agent; a single chat API call comparing with vs. without SKILL.md |
| Offline evaluation | edonadei/caliper | [caliper.md](caliper.md) | Most rigorous outcome classification; trigger detection and success rate scored separately; ablation + compare |
| Offline evaluation | Anthropic skill-creator | [anthropic-skill-creator.md](anthropic-skill-creator.md) | A workflow Claude executes from SKILL.md; grader / comparator / description optimization |
| Offline evaluation | Claude Code `claude plugin eval`, `/skill-doctor` | [claude-code-builtins.md](claude-code-builtins.md) | Closed source, documentation only: 6 grader types, 3-vote LLM judge, with/without |
| Real sessions | warpdotdev skill-doctor | [warp-skill-doctor.md](warp-skill-doctor.md) | Agent reads real sessions and assigns session-level labels per 4 rubrics, including procedure-compliance |
| Real sessions | skill-retro | [skill-retro.md](skill-retro.md) | Rewrite of an early warp version, no rule grading; a programmatic gate validates the LLM's labels |
| Real sessions | skillopt-sleep | [skillopt-sleep.md](skillopt-sleep.md) | Mines tasks from real sessions, "replays" them as single text completions, picks the best on a held-out set |
| Real sessions | PRISM | [prism.md](prism.md) | Splits rules by line, actually checks only 3 keyword rules |
| Real sessions | cc-skill-usage | [cc-skill-usage.md](cc-skill-usage.md) | Counts only real `Skill` calls; Codex relies on a wrapper command |
| Real sessions | Opaline (formerly Rudel) | [opaline.md](opaline.md) | Open-source part is only the upload CLI, no grading; the server is now closed source |
| Real sessions | Anthropic session-report | [anthropic-session-report.md](anthropic-session-report.md) | Attributes token usage per skill, no grading |
| Rule sync | ruler / rulesync / agentsync / glooit / agentlink | [ruler.md](ruler.md) · [rulesync.md](rulesync.md) · [agentsync.md](agentsync.md) · [glooit.md](glooit.md) · [agentlink.md](agentlink.md) | None evaluate; rulesync has the most complete agent path table |

## Common skeleton of evaluation implementations

Offline evaluation tools are basically all this pipeline:

```
cases (prompt + assertions/rubric) ─┐
                                    ├─▶ run agent in fresh sandbox (with / without / old version) × k
skill installed into sandbox ───────┘            │
                                                 ▼
                      parse transcript: trigger detection + collect output/files/commands
                                                 │
                        ┌────────────────────────┴────────────────────────┐
                        ▼                                                 ▼
          deterministic checks (files, commands, regex,          LLM judge (rubric → JSON)
          git state, tests_pass…)                                         │
                        └────────────────────────┬────────────────────────┘
                                                 ▼
     single assertion → per-run score → per-case score → aggregate metrics → threshold / Δ
```

Tools that read real sessions (warp, skill-retro) replace "run the agent" with "collect and compress local sessions", and replace the judge with "the agent running this skill itself"; labels are session-level.

## Key design points compared

### 1. Skill trigger detection

| Tool | Rule | Attempt or success | When unobservable |
|---|---|---|---|
| Caliper | Dedicated tool (`Skill` / `skill` / `skill_view`) **or** any tool argument matching the suffix `<name>/SKILL.md` | Attempt only | Three states: unobservable / not used / which ones were used |
| fede0089 | `Skill` / `activate_skill` with exact name match; positives require the matching tool_result to succeed | Success for positives, attempt for negatives | Unparseable events recorded as infrastructure errors, excluded from rates |
| tardigrde | Differs per agent; Claude Code with `-p --output-format json` yields no tool events | Success for OpenCode | Recorded as unknown, excluded from the denominator |
| skill-creator | Only whether the **first** tool call is `Skill` / `Read` and contains the temporary name | Attempt | Exceptions and timeouts count as "not triggered" |
| aws-samples | Any `Skill`, any SKILL.md read, script name; for positives even a text mention counts | Attempt | Runs that errored or timed out stay in the denominator |
| warp skill-doctor | `skills/<name>/`, `<name>/SKILL.md`, `"skill": "<name>"` in tool arguments; even `ls` counts | No distinction | — |
| cc-skill-usage | Only `name=="Skill"` with non-empty `input.skill` | No distinction | — |
| skillgrade | Only the Codex adapter does regex matching, and the result is discarded | — | — |

**Conclusion**: Caliper's union rule plus fede0089's "success for positives, attempt for negatives" is the most sensible. aws-samples injects SKILL.md into the system prompt in every trigger test, so it cannot measure "whether the description gets the agent to select the skill".

### 2. Grading: deterministic first, LLM fills gaps

- **Deterministic check types**: tardigrde has 11 (`file_*`, `command_ran`, `tests_pass`, `git_clean`, `json_path`…); darkrishabh has 6 tool assertions (`tool-called`, `tool-arg-matches`…); `claude plugin eval` has regex, tool_used, tool_order, file_exists; aws-samples uses regex to turn natural-language assertions like "contains / starts with" into rules.
- **LLM judge output**: always per-assertion `{passed, reason}`, or per-run `{score, reasoning}`. Caliper also lets the judge write a Python assertion script that runs in the working directory.
- **Matching judge output to assertions**: darkrishabh, fede0089 and aws-samples all align **by array position**; if the judge skips one, everything after it is misaligned. tardigrde matches by normalized assertion text and retries the missing ones once.
- **Judge input**: fede0089 lets the judge read files itself to verify; aws-samples looks only at the final reply text; `claude plugin eval` gives the judge only the first 12 and last 12 messages.
- **Rule text**: warp's judge **cannot see** the rule text or the full SKILL.md; injected text is filtered out and SKILL.md is truncated to 500 characters.

### 3. How errors, timeouts and undecidable cases count

| Approach | Tools |
|---|---|
| Counted as failure (in the denominator) | skillgrade (401, missing key, parse failure all score 0), darkrishabh (target-model error output still gets judged), aws-samples, fede0089 (judge errors) |
| Excluded | Caliper (infra_error / unusable excluded from success rate), tardigrde (skipped excluded from `pass_rate`), fede0089 (trigger event parse failures) |
| Inconsistent between metrics | tardigrde: skipped is excluded in `pass_rate` but counted as failure in pass^k |

**Conclusion**: only Caliper fully separates "infrastructure failure" from "task failure", with one function, `assemble_attempt`, classifying each attempt in a fixed order.

### 4. Aggregation formulas

- **skillgrade**: reward = Σ score × weight / Σ weight; reward ≥ 0.5 passes; `pass_rate` is the mean reward; k = n, so pass@k and pass^k both degenerate.
- **Caliper**: main metric = successes / usable attempts; triggering scored separately, with per-skill recall, precision and unwanted rate (rate of "triggered when it should not have").
- **warp**: curve(s) = 0.5 + 0.5s; overall = 0.25·eff + 0.25·cq + 0.2·pc + 0.15·verb + 0.15·coverage. Sessions with no applicable rules also get the top score.
- **skill-creator**: `pass_rate` is computed by the LLM itself and not checked by the aggregation script; the sign of delta depends on directory-name sort order.
- **aws-samples**: pass condition is mean_with ≥ mean_without and mean_with ≥ 0.5.

### 5. Version comparison and statistics

- **fede0089 `evolve`**: eval cases are frozen within one session; a new version must meet all three: better overall, assertions pre-declared via `--predict` actually improved, and no previously all-passing assertion became all-failing.
- **Caliper `compare`**: pairs by task name. Refuses to compare two runs with different loading mechanisms; warns when k, spec, skill set or judge differ.
- **skill-creator**: when improving an existing skill, uses a snapshot of the old version as the baseline; optional blind comparator.
- **Statistics**: almost all point estimates. Only tardigrde has Wilson intervals and bootstrap (2000 resamples), and none do significance tests.
