# skill-retro (formerly skill-doctor, alirezarezvani/claude-skills)

- Repo: <https://github.com/alirezarezvani/claude-skills>, path `engineering/skill-retro`
- Commit: `f8593c4941210a621a6629ce1da9e07897976d5f` (repo HEAD, 2026-11-17); first commit `40f7025` (2026-08-24, named skill-doctor); renamed `a43dc35` (2026-10-31)
- Stars: 30083 (whole repo, 2026-11-19) / Language: Python (stdlib only) + Markdown / License: MIT
- Upstream: **`f3b58c81` (2026-08-24)** of warpdotdev/common-skills skill-doctor. That version predates warp's curve (`0254cbe`, 08-28) and procedure-compliance (`69b4753`, 09-16), so **skill-retro has only two rubrics, efficiency and code-quality; no procedure-compliance, and no grading of "were rules followed" at all**.
- One-liner: a Claude Code plugin rebuild of warp skill-doctor; grading is still done by the agent running the plugin, but the agent **can only fill in labels and reasons**; all numbers, validation, and the "suggestions must cite sessions" bar are moved into `score_aggregator.py` and enforced by code.

All links below are permalinks to the HEAD above; the `engineering/skill-retro/` prefix is omitted in the text.

## Features

| Feature | What it does | Location |
|---|---|---|
| `/cs-skill-retro` command | Wraps the 5-step flow (`disable-model-invocation: true`, user-triggered only) | [commands/cs-skill-retro.md](https://github.com/alirezarezvani/claude-skills/blob/f8593c4941210a621a6629ce1da9e07897976d5f/engineering/skill-retro/commands/cs-skill-retro.md) |
| `cs-skill-retro` agent | Persona + hard rules + routing to skillopt-sleep etc. | [agents/cs-skill-retro.md](https://github.com/alirezarezvani/claude-skills/blob/f8593c4941210a621a6629ce1da9e07897976d5f/engineering/skill-retro/agents/cs-skill-retro.md) |
| `collect_sessions.py` | Reads only Claude Code + Codex; redacts; samples; writes transcripts and inventory (0700/0600 permissions) | [scripts/collect_sessions.py](https://github.com/alirezarezvani/claude-skills/blob/f8593c4941210a621a6629ce1da9e07897976d5f/engineering/skill-retro/skills/skill-retro/scripts/collect_sessions.py) |
| `score_aggregator.py --emit-template` | Generates a `session_scores.json` skeleton to fill for the sampled sessions | [L96-L111](https://github.com/alirezarezvani/claude-skills/blob/f8593c4941210a621a6629ce1da9e07897976d5f/engineering/skill-retro/skills/skill-retro/scripts/score_aggregator.py#L96-L111) |
| `score_aggregator.py` (gate) | Validates labels/reasons/suggestions, computes scores, writes `report.json`; exit 4 = rejected | [L114-L241](https://github.com/alirezarezvani/claude-skills/blob/f8593c4941210a621a6629ce1da9e07897976d5f/engineering/skill-retro/skills/skill-retro/scripts/score_aggregator.py#L114-L241) |
| `render_report.py` | Single-page HTML with no JS | [scripts/render_report.py](https://github.com/alirezarezvani/claude-skills/blob/f8593c4941210a621a6629ce1da9e07897976d5f/engineering/skill-retro/skills/skill-retro/scripts/render_report.py) |
| `--sample` | All three scripts can run end to end on built-in fake data (including a planted fake secret) | Each script |
| `--sessions-dir` | Additionally reads `claude -p --output-format stream-json` output (e.g. eval runs), skipping repo matching | [L112-L114](https://github.com/alirezarezvani/claude-skills/blob/f8593c4941210a621a6629ce1da9e07897976d5f/engineering/skill-retro/skills/skill-retro/scripts/collect_sessions.py#L112-L114) |

## Architecture and data flow

```
collect_sessions.py ──► inventory.json + transcripts/*.md (redacted)
        │
score_aggregator.py --emit-template ──► session_scores.json skeleton
        │
agent reads transcript × 2 rubrics, fills only {label, reason} + top_findings
agent drafts proposed/<skill>/SKILL.md + suggestions.json per governance
        │
score_aggregator.py (gate) ── validation fails → exit 4, writes nothing, agent must fix and rerun
        │ passes
report.json (with session_scores detail) ──► render_report.py ──► report.html
```

## Core mechanisms

### 1. Input
Real local sessions; `--sessions-dir` can also feed stream-json from headless runs (so the same flow can score eval runs).

### 2. Session / log parsing
Mostly the same as the warp version (fields in warp-skill-doctor.md §2). Differences:
- Supports only Claude Code and Codex (the Warp decoder was removed, README deviation 3).
- Each file is **read only up to the first 8 MB** (`MAX_FILE_BYTES`, [L42](https://github.com/alirezarezvani/claude-skills/blob/f8593c4941210a621a6629ce1da9e07897976d5f/engineering/skill-retro/skills/skill-retro/scripts/collect_sessions.py#L42), [L259-L260](https://github.com/alirezarezvani/claude-skills/blob/f8593c4941210a621a6629ce1da9e07897976d5f/engineering/skill-retro/skills/skill-retro/scripts/collect_sessions.py#L259-L260)); anything beyond is silently dropped.
- Claude session id accepts both `sessionId` (project history) and `session_id` (stream-json) ([L291-L302](https://github.com/alirezarezvani/claude-skills/blob/f8593c4941210a621a6629ce1da9e07897976d5f/engineering/skill-retro/skills/skill-retro/scripts/collect_sessions.py#L291-L302)).
- On render, each line goes through `redact_secrets()`: 12 ordered regexes (private key blocks, AWS/GitHub/Anthropic/OpenAI/Slack/Stripe tokens, JWT, bearer, connection strings, URL credentials, `*_API_KEY=...` forms), with counts per label written to `inventory.json.redactions` ([L56-L89](https://github.com/alirezarezvani/claude-skills/blob/f8593c4941210a621a6629ce1da9e07897976d5f/engineering/skill-retro/skills/skill-retro/scripts/collect_sessions.py#L56-L89), [L496-L518](https://github.com/alirezarezvani/claude-skills/blob/f8593c4941210a621a6629ce1da9e07897976d5f/engineering/skill-retro/skills/skill-retro/scripts/collect_sessions.py#L496-L518)).
- Repo matching records the method `path | name | chosen`; `--strict-repo` turns off matching by directory name ([L521-L540](https://github.com/alirezarezvani/claude-skills/blob/f8593c4941210a621a6629ce1da9e07897976d5f/engineering/skill-retro/skills/skill-retro/scripts/collect_sessions.py#L521-L540)).
- Same compression: messages 1500 characters, tools 500 characters, first 100 + last 40 above 160 entries.

### 3. Skill trigger detection
**Stricter** than the warp version: only three signals, all requiring the name to belong to an installed skill:
1. **Claude `Skill` tool**: `input.skill`; for namespaced forms `plugin:foo`, the last segment is matched ([L357-L363](https://github.com/alirezarezvani/claude-skills/blob/f8593c4941210a621a6629ce1da9e07897976d5f/engineering/skill-retro/skills/skill-retro/scripts/collect_sessions.py#L357-L363)).
2. **Slash commands**: `<command-name>/foo</command-name>` in user text, extracted before injection filtering ([L248](https://github.com/alirezarezvani/claude-skills/blob/f8593c4941210a621a6629ce1da9e07897976d5f/engineering/skill-retro/skills/skill-retro/scripts/collect_sessions.py#L248), [L331-L338](https://github.com/alirezarezvani/claude-skills/blob/f8593c4941210a621a6629ce1da9e07897976d5f/engineering/skill-retro/skills/skill-retro/scripts/collect_sessions.py#L331-L338)).
3. **Path markers**: the concatenation of all tool arguments contains `skills/<name>/` or `<name>/SKILL.md` ([L382-L386](https://github.com/alirezarezvani/claude-skills/blob/f8593c4941210a621a6629ce1da9e07897976d5f/engineering/skill-retro/skills/skill-retro/scripts/collect_sessions.py#L382-L386)).

The broad `"name": "<x>"` pattern from the warp version is removed. Codex has only signal 3; a comment explains why: "the raw session text is unusable because Codex injects the installed-skill list into every session preamble" ([L482-L489](https://github.com/alirezarezvani/claude-skills/blob/f8593c4941210a621a6629ce1da9e07897976d5f/engineering/skill-retro/skills/skill-retro/scripts/collect_sessions.py#L482-L489)). Attempt and success are still not distinguished.

### 4. Grading (the focus of this section)

#### 4.1 Session selection
The same "skill-first" sampling as warp: newest first, ≤3 per skill, then ≤4 no-skill sessions, total ≤12; it adds tie-breaking by `(modified_at, id)` for reproducibility ([sample_and_write L594-L629](https://github.com/alirezarezvani/claude-skills/blob/f8593c4941210a621a6629ce1da9e07897976d5f/engineering/skill-retro/skills/skill-retro/scripts/collect_sessions.py#L594-L629)). Before that, sessions with 0 assistant turns or 0 tool calls are dropped ([L700](https://github.com/alirezarezvani/claude-skills/blob/f8593c4941210a621a6629ce1da9e07897976d5f/engineering/skill-retro/skills/skill-retro/scripts/collect_sessions.py#L700)).

#### 4.2 Judge instructions ([SKILL.md L35-L42](https://github.com/alirezarezvani/claude-skills/blob/f8593c4941210a621a6629ce1da9e07897976d5f/engineering/skill-retro/skills/skill-retro/SKILL.md#L35-L42))
> Read each transcript in `$RUN/transcripts/` and judge it against **both** rubrics — `scorers/efficiency.md` and `scorers/code-quality.md`. Fill the template with a **label from the rubric's table** and a 1–3 sentence reason citing transcript specifics. Never invent numeric scores — the aggregator derives them from labels. Use `insufficient_evidence` when a transcript shows no judgeable diff. Also write 1–5 `top_findings`: the most impactful cross-session patterns, concrete and specific.

The judge model is the user's current Claude Code model (agent definition `model: inherit`). Both rubrics are **kept verbatim from upstream** (README deviation 2); full text in warp-skill-doctor.md §4.4. Label tables:

| scorer | label → score |
|---|---|
| efficiency | `highly_efficient` 1.0 / `mostly_efficient` 0.8 / `mostly_inefficient` 0.4 / `highly_inefficient` 0.2 |
| code_quality | `approve` 1.0 / `block` 0.2 / `insufficient_evidence` 0.5 (not included in the mean) |

Both tables are hard-coded ([L42-L53](https://github.com/alirezarezvani/claude-skills/blob/f8593c4941210a621a6629ce1da9e07897976d5f/engineering/skill-retro/skills/skill-retro/scripts/score_aggregator.py#L42-L53)), with a comment saying "if a rubric changes, change both together".

#### 4.3 Output schema
Generated by `--emit-template` ([L96-L111](https://github.com/alirezarezvani/claude-skills/blob/f8593c4941210a621a6629ce1da9e07897976d5f/engineering/skill-retro/skills/skill-retro/scripts/score_aggregator.py#L96-L111)):
```json
{ "top_findings": ["", "", ""],
  "sessions": [ { "session_id": "...", "harness": "claude",
                  "efficiency":   {"label": "<one of: highly_efficient | ...>", "reason": ""},
                  "code_quality": {"label": "<one of: approve | block | insufficient_evidence>", "reason": ""} } ] }
```
suggestions.json: `{suggestions: [{skill, change, evidence, sessions: [id...], proposed_path, diff}]}` ([assets/suggestions.example.json](https://github.com/alirezarezvani/claude-skills/blob/f8593c4941210a621a6629ce1da9e07897976d5f/engineering/skill-retro/skills/skill-retro/assets/suggestions.example.json)).

#### 4.4 Parsing and validation ([validate L114-L186](https://github.com/alirezarezvani/claude-skills/blob/f8593c4941210a621a6629ce1da9e07897976d5f/engineering/skill-retro/skills/skill-retro/scripts/score_aggregator.py#L114-L186))
Errors (any one → exit 4, no files written):
- `sessions` is not a list; an entry lacks `session_id`;
- `session_id` is not in the sampled set ("fabricated or stale id"); duplicate entries;
- missing `efficiency`/`code_quality` block; `label` not in the table;
- `reason` < 20 characters after trimming whitespace (`MIN_REASON_CHARS`);
- a sampled session was not scored;
- `top_findings` has no non-empty item;
- a suggestion lacks `skill`/`change`/`evidence`, has empty `sessions`, cites an unsampled session, or has an empty `diff`.

Warnings (exit 2, report still written): `code_quality == insufficient_evidence` but the collector detected `has_code_edits` ("confirm the transcript truly hid the diff"); all sessions are insufficient_evidence; no suggestions.

This is the only implementation that makes "LLM labels → programmatic validation" a hard gate, but validation covers only form (valid label, long enough reason, citations exist), not whether the reason actually cites transcript content.

#### 4.5 insufficient-evidence
Only in code-quality. The LLM decides ("no judgeable diff"); code cross-checks consistency with `has_code_edits` (warns only, does not block). Excluded from the code_quality mean; if all are excluded, code_quality = 0.5.

#### 4.6 Aggregation formula ([aggregate L189-L241](https://github.com/alirezarezvani/claude-skills/blob/f8593c4941210a621a6629ce1da9e07897976d5f/engineering/skill-retro/skills/skill-retro/scripts/score_aggregator.py#L189-L241))
```
efficiency     = mean(eff_score over sampled)                     # no curve
code_quality   = mean(cq_score over sampled where label != insufficient_evidence)  or 0.5
skill_coverage = |{sampled s : s.skills_used non-empty}| / n      if n and skills_found else 0
overall        = 0.5*efficiency + 0.35*code_quality + 0.15*skill_coverage
grade          = same A+…F threshold table as warp (L55-L60)
```
Differences from the current warp version: **no `curve(s)=0.5+0.5s`**, no procedure-compliance or verbosity, and the weights are upstream's early 0.5/0.35/0.15. `report.json` additionally stores per-session `session_scores` (label + reason, no numbers), which makes it auditable.

#### 4.7 Evidence selection
Upstream's rule "use only `failed_conversations` (any raw score <0.5) as evidence" **was not carried over** (upstream did not have it yet). skill-retro's constraint is: each suggestion must cite at least one sampled session in its `sessions` field and must have a diff; whether it is worth proposing is decided by the filing bar in the governance doc ("would a competent agent with the current instructions still be expected to fail this way?", [skill_edit_governance.md L19-L40](https://github.com/alirezarezvani/claude-skills/blob/f8593c4941210a621a6629ce1da9e07897976d5f/engineering/skill-retro/skills/skill-retro/references/skill_edit_governance.md#L19-L40)). Agent hard rule: "A never-firing installed skill is a description problem first. Suggest the trigger fix before any body edit."

#### 4.8 Evaluation loop pseudocode
```
inv = collect(claude+codex, 45d, repo) ; sample ≤12 ; write redacted transcripts
tmpl = emit_template(inv.sampled)
agent: for s in sampled: tmpl[s].efficiency = {label, reason}; tmpl[s].code_quality = {label, reason}
       top_findings = 1..5 ; suggestions = [{skill, change, evidence, sessions[], diff}]
loop:
  errs, warns, per = validate(inv, tmpl, sugg)
  if errs: exit 4 → agent fixes → rerun
  else: report = aggregate(per) ; write report.json (0600) ; break
render(report)
```

### 5. Baselines and version comparison
Not applicable. Records SKILL.md's `modified_at`/bytes but does no version comparison.

### 6. Repeated runs and statistics
Not applicable. Sampling is deterministic (reproducible), but each session is judged only once.

### 7. Cost / token accounting
Usage is not read; only counts of turns, tool calls, repeated calls and error outputs.

### 8. Rule files
**None at all**. There is no procedure-compliance-style scorer; code-quality explicitly says "Out of scope: … whether it followed instructions or skills". Injected `<system-reminder>` and `<user_instructions>` are likewise filtered. Whether a skill "was used correctly" shows up only in the efficiency reason's "name the skill" and in coverage.

### 9. Privacy and data flow
No upload; transcripts are redacted and written to a temp directory with 0600; there is no `--no-redact`. The judge is the user's own agent, so transcripts enter that model provider's requests. [session_mining_privacy.md](https://github.com/alirezarezvani/claude-skills/blob/f8593c4941210a621a6629ce1da9e07897976d5f/engineering/skill-retro/skills/skill-retro/references/session_mining_privacy.md) records where the redaction patterns came from.

## Limitations (observed in source)
- No grading of rule compliance or of whether a skill was followed; "was the skill used correctly" cannot actually be answered.
- Validation checks only form; the 20-character threshold is easy to meet.
- Like warp: session-level scoring, 12 samples by default, and sampling biased toward skill-using sessions inflates `skill_coverage`.
- The 8 MB truncation happens silently and the tail of long sessions is lost (and compression keeps the last 40 entries, so the truncation point may be mistaken for the end).
- Codex identifies skills only by path; `$skill`-style invocations that do not read a file are missed.
- The label→score table is stored both in the rubric and in code, and must be synced by hand.
