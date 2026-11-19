# warpdotdev skill-doctor

- Repo: <https://github.com/warpdotdev/common-skills>, path `.agents/skills/skill-doctor`
- Commit: `8792394ff1b655e0af451b8fabb68ef0cfcbd208` (repo HEAD, 2026-10-20); last change to this skill `7c4eb85` (2026-10-09, added Hermes)
- Stars: 712 (queried 2026-11-19) / Language: Python (scripts) + Markdown (agent instructions and rubrics) / License: MIT
- History: `737129f` (2026-08-21, first version, only efficiency + code-quality) → `0254cbe` (2026-08-28, added curve and "use only failed sessions as evidence") → **`69b4753` (2026-09-16, added procedure-compliance and verbosity)** → afterwards only harnesses added
- One-liner: an **agent skill** (not a standalone program). Python scripts only collect and compress real local sessions; **grading is done by the agent executing this skill** (labeling each session against 4 rubrics). The aggregation formula is written in SKILL.md and computed by hand by the agent; a script then renders a one-page HTML report.

All links below are permalinks to the commit above.

## Features

| Feature | What it does | Location |
|---|---|---|
| Startup questions | Asks "which sessions to evaluate" (this repo / all / a given project) and "which skills to evaluate" (project + global / project only) | [SKILL.md L21-L51](https://github.com/warpdotdev/common-skills/blob/8792394ff1b655e0af451b8fabb68ef0cfcbd208/.agents/skills/skill-doctor/SKILL.md#L21-L51) |
| Harness gate | If the harness executing the skill is not in the support table, stops immediately without reading any session | [supported-harnesses.md L5-L21](https://github.com/warpdotdev/common-skills/blob/8792394ff1b655e0af451b8fabb68ef0cfcbd208/.agents/skills/skill-doctor/references/supported-harnesses.md#L5-L21) |
| `collect_sessions.py` | Scans 7 local session sources, filters by project, samples, writes condensed transcripts and `inventory.json` | [collect_sessions.py](https://github.com/warpdotdev/common-skills/blob/8792394ff1b655e0af451b8fabb68ef0cfcbd208/.agents/skills/skill-doctor/scripts/collect_sessions.py) |
| 4 scorers | efficiency / code-quality / procedure-compliance / verbosity, each a Markdown rubric with a label table | [scorers/](https://github.com/warpdotdev/common-skills/tree/8792394ff1b655e0af451b8fabb68ef0cfcbd208/.agents/skills/skill-doctor/scorers) |
| Aggregation and failed sessions | Mean → curve → weighted overall; filters `failed_conversations` by per-session raw scores | [SKILL.md L101-L120](https://github.com/warpdotdev/common-skills/blob/8792394ff1b655e0af451b8fabb68ef0cfcbd208/.agents/skills/skill-doctor/SKILL.md#L101-L120) |
| Drafting skill edits | Writes `proposed/<skill>/SKILL.md` and `diff -u` based only on failed sessions | [SKILL.md L122-L132](https://github.com/warpdotdev/common-skills/blob/8792394ff1b655e0af451b8fabb68ef0cfcbd208/.agents/skills/skill-doctor/SKILL.md#L122-L132), [skill-improvements.md](https://github.com/warpdotdev/common-skills/blob/8792394ff1b655e0af451b8fabb68ef0cfcbd208/.agents/skills/skill-doctor/references/skill-improvements.md) |
| `render_report.py` | `report.json` → single-page `report.html` (letter grade, findings, diffs, PNG export) | [render_report.py](https://github.com/warpdotdev/common-skills/blob/8792394ff1b655e0af451b8fabb68ef0cfcbd208/.agents/skills/skill-doctor/scripts/render_report.py) |

Collector parameters: `--days` (default 45), `--max-sessions` (default 12), `--per-skill` (default 3), `--no-skill` (default 4), `--include-subagents`, `--include-global-skills`, `--harness auto|all|<id>`, plus per-harness home overrides ([L99-L104](https://github.com/warpdotdev/common-skills/blob/8792394ff1b655e0af451b8fabb68ef0cfcbd208/.agents/skills/skill-doctor/scripts/collect_sessions.py#L99-L104)).

## Architecture and data flow

```
~/.claude/projects/*/*.jsonl ┐
~/.codex/{sessions,archived_sessions}/**/rollout-*.jsonl ┤
Warp sqlite / Pi / Grok / ZCode / Hermes ┘
        │ parse_*_session()  → (meta, stats, entries[], skills_used)
        ▼
  repo filter (cwd) → drop sessions with 0 tool calls → skill detection ∩ installed skills
        ▼
  sampling (newest first: ≤3 per skill, then ≤4 no-skill sessions, total ≤12)
        ▼
  $REPORT_DIR/transcripts/<harness>-<id>.md  +  inventory.json
        ▼  -- everything below is executed by the agent itself per SKILL.md, no code --
  agent reads each transcript × 4 rubrics → {label, score, reason}
        ▼
  mean/curve/weighting → failed_conversations → findings + suggestions + proposed diffs
        ▼
  report.json → render_report.py → report.html (opened locally)
```

## Core mechanisms

### 1. Input
Real local sessions; no test cases needed. The time window filters by **file mtime** ([L186-L222](https://github.com/warpdotdev/common-skills/blob/8792394ff1b655e0af451b8fabb68ef0cfcbd208/.agents/skills/skill-doctor/scripts/collect_sessions.py#L186-L222)), not by timestamps inside the session.

### 2. Session / log parsing

**Claude Code** ([parse_claude_session L300-L431](https://github.com/warpdotdev/common-skills/blob/8792394ff1b655e0af451b8fabb68ef0cfcbd208/.agents/skills/skill-doctor/scripts/collect_sessions.py#L300-L431))
- Paths: `<claude_home>/projects/*/*.jsonl`; with `--include-subagents` it also reads `projects/*/*/subagents/*.jsonl` ([L203-L222](https://github.com/warpdotdev/common-skills/blob/8792394ff1b655e0af451b8fabb68ef0cfcbd208/.agents/skills/skill-doctor/scripts/collect_sessions.py#L203-L222)).
- Record fields: `timestamp`, `isSidechain` (if true and the subagent option is off, the whole file is skipped), `sessionId`, `agentId`, `cwd`, `version`, `entrypoint`, `type` (only `user`/`assistant`), `message.role`, `message.id` (assistant turns are deduplicated and counted by message id), `message.content[]`.
- Blocks: `text` (truncated to 1500 characters; **text starting with tags such as `<system-reminder` / `<environment_context` / `<user_instructions` is treated as injected content and dropped**, [looks_injected L434-L443](https://github.com/warpdotdev/common-skills/blob/8792394ff1b655e0af451b8fabb68ef0cfcbd208/.agents/skills/skill-doctor/scripts/collect_sessions.py#L434-L443)), `tool_use` (`name` + `input` JSON truncated to 500 characters; sha1 over `name+args` to count repeated calls), `tool_result` (truncated to 500 characters; `is_error`, or error/failed/traceback in the first 2000 characters, records one error_output).
- `has_code_edits` = used `Edit/MultiEdit/NotebookEdit/Write`, or hint words such as `apply_patch`, `str_replace` appear in arguments ([L36-L38](https://github.com/warpdotdev/common-skills/blob/8792394ff1b655e0af451b8fabb68ef0cfcbd208/.agents/skills/skill-doctor/scripts/collect_sessions.py#L36-L38), [L427-L430](https://github.com/warpdotdev/common-skills/blob/8792394ff1b655e0af451b8fabb68ef0cfcbd208/.agents/skills/skill-doctor/scripts/collect_sessions.py#L427-L430)).

**Codex** ([parse_codex_session L446-L537](https://github.com/warpdotdev/common-skills/blob/8792394ff1b655e0af451b8fabb68ef0cfcbd208/.agents/skills/skill-doctor/scripts/collect_sessions.py#L446-L537))
- Paths: `<codex_home>/sessions/**/rollout-*.jsonl` and `archived_sessions/**`.
- `session_meta.payload`: `id`/`session_id`, `cwd`, `timestamp`, `originator`, `thread_source`, `cli_version`, `source` (`thread_source=="subagent"` or `source` containing `subagent` is treated as a child session).
- `event_msg.payload.type`: `user_message` / `agent_message` used only to count turns.
- `response_item.payload.type`: `message` (role user/assistant; the user side is likewise filtered for injections), `function_call`/`custom_tool_call`/`local_shell_call` (`name`, `arguments`/`input`), `function_call_output`/`custom_tool_call_output` (`output`).

**Compression**: above 160 entries, `TranscriptBuffer` keeps only the first 100 + last 40, writing `[... N entries omitted ...]` in between ([L262-L286](https://github.com/warpdotdev/common-skills/blob/8792394ff1b655e0af451b8fabb68ef0cfcbd208/.agents/skills/skill-doctor/scripts/collect_sessions.py#L262-L286)). The rendered transcript header has a stats line: turns, tool calls (repeats), error outputs, whether code was edited, detected skills ([render_transcript L1440-L1460](https://github.com/warpdotdev/common-skills/blob/8792394ff1b655e0af451b8fabb68ef0cfcbd208/.agents/skills/skill-doctor/scripts/collect_sessions.py#L1440-L1460)).

### 3. Skill trigger detection
Two steps, finally intersected with installed skill names ([L1843-L1851](https://github.com/warpdotdev/common-skills/blob/8792394ff1b655e0af451b8fabb68ef0cfcbd208/.agents/skills/skill-doctor/scripts/collect_sessions.py#L1843-L1851)):
1. During parsing, [detect_skill_candidates L289-L297](https://github.com/warpdotdev/common-skills/blob/8792394ff1b655e0af451b8fabb68ef0cfcbd208/.agents/skills/skill-doctor/scripts/collect_sessions.py#L289-L297) runs on **the argument text of every tool call**: regex `(?:^|/)skills/+([^/]+)/+` (path contains `skills/<name>/`) and `"(skill|name|bundled_skill_id)": "<x>"`; for Claude Code's `Skill` tool it also takes `input.skill` ([L399-L402](https://github.com/warpdotdev/common-skills/blob/8792394ff1b655e0af451b8fabb68ef0cfcbd208/.agents/skills/skill-doctor/scripts/collect_sessions.py#L399-L402)).
2. After collection, [detect_skills_from_entries L1519-L1536](https://github.com/warpdotdev/common-skills/blob/8792394ff1b655e0af451b8fabb68ef0cfcbd208/.agents/skills/skill-doctor/scripts/collect_sessions.py#L1519-L1536) looks for markers such as `skills/<name>/`, `<name>/SKILL.md`, `"skill": "<name>"` in `tool:*` entry text.

Only tool arguments are checked, not assistant text, so "mentioning the skill name" does not count. But **reading the SKILL.md file** (`Read` with `file_path` containing `skills/x/`), or even `ls .claude/skills/x/`, counts as "used"; attempt and success are not distinguished (an erroring Skill call counts too). The `"name": "<x>"` pattern is very broad: any `name` field in any tool argument that matches a skill name will hit.

### 4. Grading (the focus of this section)

#### 4.1 Session selection
[main L1598](https://github.com/warpdotdev/common-skills/blob/8792394ff1b655e0af451b8fabb68ef0cfcbd208/.agents/skills/skill-doctor/scripts/collect_sessions.py#L1598) first drops sessions with `assistant_turns < 1 or tool_calls < 1`; then matches by project (cwd inside the repo, or the last directory name of cwd equals the repo name, [L1463-L1483](https://github.com/warpdotdev/common-skills/blob/8792394ff1b655e0af451b8fabb68ef0cfcbd208/.agents/skills/skill-doctor/scripts/collect_sessions.py#L1463-L1483); a comment admits it will mismatch projects with the same name). Sampling code ([L1857-L1874](https://github.com/warpdotdev/common-skills/blob/8792394ff1b655e0af451b8fabb68ef0cfcbd208/.agents/skills/skill-doctor/scripts/collect_sessions.py#L1857-L1874)):

```python
# newest-first
for s in sessions:                       # first pass: sessions that used a skill
    if len(sampled) >= max_sessions: break
    for name in s.skills_used:
        if per_skill_count[name] < per_skill:   # default 3
            per_skill_count[name] += 1; sampled.add(s); break
for s in sessions:                       # second pass: sessions without a skill
    if len(sampled) >= max_sessions or no_skill_taken >= no_skill: break   # default 4
    if not s.skills_used: sampled.add(s); no_skill_taken += 1
```
No stratification, no randomness; by default at most 12 sessions are evaluated.

#### 4.2 Who grades and the prompt structure
There is no separate judge program and no specified model: **it is the agent running the skill (Claude Code / Codex / Warp, etc., using the user's current model)**. Verbatim from SKILL.md Step 2 ([L92-L99](https://github.com/warpdotdev/common-skills/blob/8792394ff1b655e0af451b8fabb68ef0cfcbd208/.agents/skills/skill-doctor/SKILL.md#L92-L99)):

> Process datasets of 50 transcripts or fewer in a single batch. For datasets with more than 50 transcripts, use parallel batches (20 transcripts per batch recommended). Score batches in the current local agent process, or delegate only to local child agents that keep transcript contents on the user's machine.
>
> For each transcript in `$REPORT_DIR/transcripts/`, read it and judge it against all four rubrics. For each scorer record: label, numeric score (from the rubric's label table), and a 1–3 sentence reason citing specifics from the transcript. Apply the code-quality scorer only where the transcript shows code changes; otherwise record `insufficient_evidence` and exclude that result from the code-quality average and failed-conversation filter.

Every rubric file has the same structure: YAML front matter with `labels: [{value, description, score}]`, and a body with **Rubric** (overview + Assess points + Out of scope) and **Reason** (how to write the reason).

#### 4.3 procedure-compliance in full (33 lines, [procedure-compliance.md L1-L33](https://github.com/warpdotdev/common-skills/blob/8792394ff1b655e0af451b8fabb68ef0cfcbd208/.agents/skills/skill-doctor/scorers/procedure-compliance.md#L1-L33))

Label table:

| value | description | score |
|---|---|---|
| `fully_compliant` | The agent followed every applicable rule and followed through on every triggered skill. | 1 |
| `mostly_compliant` | The agent followed all significant rules and skills, slipping only on something low-stakes. | 0.8 |
| `noncompliant` | The agent missed an applicable rule, skipped a triggered skill, breached a protective rule, or skipped required validation while reporting work complete. | 0.2 |

Rubric body:

> The agent operates under two kinds of externally-prescribed, catalogue-style guidance: standing rules delivered through system context (user rules, repository rules such as WARP.md, directory-scoped rules) and a catalogue of skills, each with stated triggers and requirements. Both are binding once they apply, unlike ad-hoc task content. Evaluate whether the agent honored every rule that applied to what it actually did, and invoked and followed through on every skill its situation clearly triggered. Judge only rules and skills the transcript shows were in scope. The categories below illustrate the range you may see, not an exhaustive list — judge every applicable rule or skill you find, even one that fits none of these categories.
>
> Assess:
> - **Applicability.** Judge only rules and skills that came into scope — a pull-request rule only if it opened one, a skill only if its trigger was clearly met. Don't credit or penalize ones that never applied. If the transcript shows no applicable rules or skills at all, grade `fully_compliant`.
> - **Mechanical rules.** Branch naming, commit attribution, required checks before pushing, pull request templates, protected branches. Unambiguous and cheap to follow, so a violation is strong signal; a multi-part rule isn't satisfied by doing only one part.
> - **Judgement rules.** Comment style, error handling, communication conventions — judge intent, not exact wording.
> - **Protective rules.** Guards against harm or irreversibility (no committing to protected branches, no force-push, no destructive commands) carry the highest weight; a single breach here is disqualifying regardless of everything else.
> - **Skill invocation.** A skill was used when its trigger was clearly met, not hand-rolled around. Missing a skill that exists to prevent a known mistake is the worse case.
> - **Skill adherence.** Once in play, a skill's required steps, constraints, designated tooling, and output format were followed to completion, not just the convenient parts. Skipping a skill's verification or cleanup step while reporting the work done is a serious failure.
> - **Conflicts and failures.** A conflict between rules, or between a rule and an instruction, should be surfaced and resolved explicitly, not silently picked. When a skill's steps failed, the agent diagnosed and resolved it rather than silently abandoning the skill.
>
> Out of scope: task-specific instructions, and whether a rule or skill is itself well-designed.
>
> **Reason** — One to three sentences naming the specific rules and/or skills evaluated, whether the gap (if any) was a rule breach, a missed invocation, or an adherence failure, and what would have prevented it.

Key points:
- **Applicability**: only rules/skills that "came into scope" are judged; **when nothing applies, it grades `fully_compliant` (score 1)** instead of excluding the session. This means "not applicable" raises the average, whereas not-applicable code-quality is excluded.
- **Three failure types** are distinguished in the Reason: rule breach / missed invocation / adherence failure. **There is no category for a skill used when it should not have been**.
- Rules are weighted in three classes: mechanical, judgement, protective (a single breach disqualifies). But there are only 3 labels, and all rules and skills are compressed into one session-level label.

#### 4.4 Labels and key points of the other three scorers
- **efficiency** ([efficiency.md](https://github.com/warpdotdev/common-skills/blob/8792394ff1b655e0af451b8fabb68ef0cfcbd208/.agents/skills/skill-doctor/scorers/efficiency.md)): `highly_efficient` 1 / `mostly_efficient` 0.8 / `mostly_inefficient` 0.4 / `highly_inefficient` 0.2. "Score against what a competent engineer with the same tools would have needed … A mistake that looks unavoidable in context still counts if better tooling, a skill, or a check would have prevented it — name that cause in the reason." Assess: Rework from mistakes, Cost to the human ("the most expensive waste"), Information gathering, Routine-step overhead, Batching, Flailing, Verification timing. The Reason must give a "rough count" and name the skill that should have prevented the waste.
- **code-quality** ([code-quality.md](https://github.com/warpdotdev/common-skills/blob/8792394ff1b655e0af451b8fabb68ef0cfcbd208/.agents/skills/skill-doctor/scorers/code-quality.md)): `approve` 1 / `block` 0.2 / `insufficient_evidence` 0.5 (the listed 0.5 is not actually used in computation). "The verdict is binary … one real defect is enough … If the condensed transcript doesn't show enough of the change to judge, the verdict is `insufficient_evidence` and the session is excluded from aggregation." 11 dimensions: Design, Correctness, Complexity, Repo conventions, Code smells, Tests, Naming, Comments, Diff hygiene, Documentation, Corrections (defects the user pointed out mid-session are penalized even if fixed). "Out of scope: … whether it followed instructions or skills."
- **verbosity** ([verbosity.md](https://github.com/warpdotdev/common-skills/blob/8792394ff1b655e0af451b8fabb68ef0cfcbd208/.agents/skills/skill-doctor/scorers/verbosity.md)): `proportionate` 1 / `verbose` 0.2 / `terse` 0.1.

#### 4.5 Output parsing and validation
**None**. Labels, scores and reasons are all recorded by the agent in its context; no JSON schema, no programmatic parsing, no check that labels are valid; at the end the agent writes `report.json` by hand. `render_report.py` only reads fields such as `scores` to render, without recomputing ([render_page L228-L246](https://github.com/warpdotdev/common-skills/blob/8792394ff1b655e0af451b8fabb68ef0cfcbd208/.agents/skills/skill-doctor/scripts/render_report.py#L228-L246)). Per-session labels are not persisted; the report only has aggregate scores.

#### 4.6 insufficient-evidence
Only code-quality has this label; the trigger condition is hard-coded in Step 2: "only where the transcript shows code changes" (the `code edits: True/False` stat in the transcript header helps decide). Exclusion rules: not in the code-quality mean, does not make a session failed; if all are insufficient_evidence, `raw_code_quality = 0.5` and this is noted in the findings. procedure-compliance has no "insufficient evidence" level.

#### 4.7 Aggregation formula ([SKILL.md L103-L113](https://github.com/warpdotdev/common-skills/blob/8792394ff1b655e0af451b8fabb68ef0cfcbd208/.agents/skills/skill-doctor/SKILL.md#L103-L113))
```
raw_X            = mean(score_X over scored sessions)        # code_quality excludes insufficient_evidence; = 0.5 if all excluded
curve(s)         = 0.5 + 0.5 * s                              # squashes [0,1] into [0.5,1]
X                = curve(raw_X)    for X in {efficiency, code_quality, procedure_compliance, verbosity}
skill_coverage   = |sampled sessions with ≥1 installed skill detected| / |sampled|   (skills_found==0 → 0)
overall          = 0.25*eff + 0.25*cq + 0.2*pc + 0.15*verb + 0.15*skill_coverage
grade            = A+≥0.97, A≥0.93, A-≥0.90, B+≥0.87, B≥0.83, B-≥0.80, C+≥0.77, C≥0.73, C-≥0.70, D≥0.60, else F
```
The grade table is in [render_report.py L23-L28](https://github.com/warpdotdev/common-skills/blob/8792394ff1b655e0af451b8fabb68ef0cfcbd208/.agents/skills/skill-doctor/scripts/render_report.py#L23-L28). Because of the curve, the four rubric scores are at least 0.5 (pc = 0.6 when everything is noncompliant).

#### 4.8 Failed sessions and evidence selection ([SKILL.md L115-L120](https://github.com/warpdotdev/common-skills/blob/8792394ff1b655e0af451b8fabb68ef0cfcbd208/.agents/skills/skill-doctor/SKILL.md#L115-L120))
> A conversation fails when at least one applicable efficiency, code-quality, procedure-compliance, or verbosity score is below `0.5`. An `insufficient_evidence` result does not make a conversation fail. Use only `failed_conversations` as evidence for skill-improvement suggestions and draft skill edits.

That is, any raw score ∈ {0.4, 0.2, 0.1} counts as failed. Suggestions must "cite the failed session, scorer, and moment that motivated each one"; "An installed skill that never triggered in a failed conversation is usually a description problem". [skill-improvements.md L11-L29](https://github.com/warpdotdev/common-skills/blob/8792394ff1b655e0af451b8fabb68ef0cfcbd208/.agents/skills/skill-doctor/references/skill-improvements.md#L11-L29) sets the bar for proposing an edit: a missing/wrong instruction caused the failure, a specific surface can be pointed to, adding it would have prevented the failure, and **the same gap appears in more than one run, or once is severe enough**; no edit is proposed when "The existing instruction already required the correct behavior and the model ignored it". "When nothing clears this bar, open no change … that is a success."

#### 4.9 Evaluation loop pseudocode
```
collect: sessions = parse(all sources, mtime ≥ now-45d) | in_repo | tool_calls≥1
         detect skills ∩ installed; sample ≤12 (skill-first)
         write condensed transcripts (head100+tail40, msg≤1500, tool≤500 chars)
judge (agent, in-context):
  for t in transcripts:              # ≤50 in one batch, otherwise 20/batch in parallel child agents
    for rubric in [eff, cq, pc, verb]:
      if rubric==cq and not code_changes: label=insufficient_evidence
      else: label = pick(rubric.labels); score = table[label]; reason = 1-3 sentences
aggregate: means → curve → overall → grade
failed = {t | any applicable raw score < 0.5}
suggestions/proposed diffs ← only failed
render report.html
```

### 5. Baselines and version comparison
Not applicable. Skill versions are not recorded (`inventory.json` only records SKILL.md's `modified_at` and bytes, [L171-L181](https://github.com/warpdotdev/common-skills/blob/8792394ff1b655e0af451b8fabb68ef0cfcbd208/.agents/skills/skill-doctor/scripts/collect_sessions.py#L171-L181)); no before/after comparison, and no check that proposed edits work.

### 6. Repeated runs and statistics
Not applicable. Each session is judged once per rubric; no repeats, no confidence intervals.

### 7. Cost / token accounting
Token/usage fields are not read. Only turns, tool calls, repeated calls (sha1(name+args) count >1) and "error-ish" outputs are counted, shown to the judge as hints in the transcript header.

### 8. Rule files
procedure-compliance judges rules as a whole, not one by one. **The collector does not give rule files to the judge**: Claude Code's CLAUDE.md is not in the JSONL body, and injected text starting with `<system-reminder>` or `<user_instructions>` is actively dropped by `looks_injected`; the SKILL.md body (the Skill tool result) is also truncated to 500 characters. Step 2 does not ask the agent to read the original CLAUDE.md/AGENTS.md or SKILL.md. [Inferred] So the judge can only decide "were applicable rules followed" from behavior visible in the transcript and from whatever rules happen to be loaded in its own current context (i.e. the rules of the repo where skill-doctor is run, not the rules in effect for the evaluated session at the time). Newer Codex injects AGENTS.md as a user message starting with `# AGENTS.md instructions`, which does not match the filter tags, so it may enter the transcript in truncated form (1500 characters).

### 9. Privacy and data flow
SKILL.md L11: "Everything runs locally. Never upload transcripts, session files, or any excerpt of them anywhere." But "locally" only means no separate upload; the judge is the user's agent, so transcript content is sent as prompt to that agent's model provider. The report HTML is generated locally and contains a promotional link to Warp Factories.

## Limitations (observed in source)
- Three-level session labels; all rules and skills are mixed into one procedure-compliance score; no category for a skill used when it should not have been.
- "Nothing applicable → fully_compliant = 1" lets sessions that involve no rules raise the average.
- The judge cannot see the rule text or the full SKILL.md (see §8); "did it follow every step of the skill" can only be guessed from truncated traces.
- Sampling favors sessions that used a skill, and `skill_coverage` is computed on that sample → coverage is systematically inflated.
- No output schema, no persisted per-session results, no validation of judge accuracy; aggregation is computed by hand by the LLM and may be wrong.
- The curve squashes scores into 0.5–1; letter grades look good but discriminate poorly.
- Project matching by directory name can mix up projects; time window uses mtime.
- Only 12 sessions evaluated by default; conclusions have very weak statistical meaning.
