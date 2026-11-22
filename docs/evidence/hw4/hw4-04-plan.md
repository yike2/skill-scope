# Plan: Claude Code and Antigravity Session Readers (#8)

Branch `feat/8-claude-code-session-reader`. Scope as settled with the user: a Session Reader turns
**one** Session (path given by the caller) into one agent-independent `Session` object. No relevance
judgement, no slicing per Skill, no Rule Item splitting, no version ids, no Session discovery or
filtering, no reads outside the agent's own log files (no `SKILL.md`, no Claude Code
`<uuid>/tool-results/`). Two readers only: Claude Code and Antigravity.

Evidence: all record shapes below were checked on this machine on 2026-11-22 against 6 Claude Code
Sessions in `~/.claude/projects/-home-dev-workspace-6983-skill-scope/` (plus a type census over all
local projects, 57 Subagent `.meta.json` files) and all 9 Antigravity brain dirs.

---

## 1. Package and files

New package `packages/session-reader`, name `@skill-scope/session-reader`, following
`packages/core`: `"type": "module"`, `"private": true`, `"exports": { ".": "./src/index.ts" }`,
`"scripts": { "typecheck": "tsc --noEmit" }`, `tsconfig.json` extending `../../tsconfig.base.json`
(`rootDir: src`, `include: ["src"]`). No runtime dependencies (only `node:fs/promises` and
`node:path`). `pnpm install` adds the workspace importer to `pnpm-lock.yaml`; nothing else changes
there.

```
packages/session-reader/
  package.json
  tsconfig.json
  src/
    index.ts              re-exports the two functions and the types
    session.ts            the Session types (types only)
    jsonl.ts              readJsonl(path): lines → { line, record } | Warning   (used by both readers)
    jsonl.test.ts
    claude-code.ts        readClaudeCodeSession
    claude-code.test.ts
    antigravity.ts        readAntigravitySession
    antigravity.test.ts
  fixtures/               outside src/, so tsc and coverage ignore it
    claude-code/...
    antigravity/...
```

`jsonl.ts` is the only shared code, because both readers need the same "split lines, `JSON.parse`,
warn on failure, warn when not an object" step. Nothing else is shared: no base class, no registry,
no reader interface type.

### Public functions

```ts
// path = the main log: ~/.claude/projects/<slug>/<uuid>.jsonl
export function readClaudeCodeSession(path: string): Promise<Session>;

// dir = the Session's brain dir: ~/.gemini/antigravity/brain/<uuid>
export function readAntigravitySession(dir: string): Promise<Session>;
```

- Both throw only when the main log itself cannot be read (missing file, permission). The thrown
  message names the path and the error code, never Session content. The caller (later CLI/daemon)
  skips the Session, which matches `docs/dev/security.md` A10.
- Every other problem (bad line, unknown record, missing Subagent file, unlinked Subagent) becomes a
  `warnings` entry; the reader never throws for it.
- Antigravity takes the brain dir rather than the log path because the Session's identity is the
  dir and the reader needs `<dir>/.system_generated/subagents/` and sibling brain dirs. It reads
  `<dir>/.system_generated/logs/transcript_full.jsonl` only, never `transcript.jsonl` (that file
  truncates fields at about 4 KB).

---

## 2. The common Session type (`src/session.ts`)

Rule for optional fields: **absent** = this agent does not record it; **empty array** = the agent
records it and none happened. Presence depends on the agent, never on the file's contents: the
Claude Code reader always sets all seven optional fields (empty arrays when nothing was found); the
Antigravity reader sets only `skillInvocations` and `compactions`.

```ts
export interface Session {
  agent: 'claude-code' | 'antigravity';           // required
  sessionId: string;                              // required; file stem / brain dir name
  metadata: SessionMetadata;                      // required object, fields optional
  events: SessionEvent[];                         // required, in log order
  unlinkedSubagents: SubagentSession[];           // required; Subagent logs with no spawning call found
  warnings: Warning[];                            // required; this Session's own log only

  // Optional part (see presence rule above)
  skillsOffered?: OfferedItem[];
  subagentsOffered?: OfferedItem[];
  ruleFiles?: RuleFileLoad[];
  skillInvocations?: SkillInvocation[];
  interrupts?: Interrupt[];
  toolDenials?: ToolDenial[];
  compactions?: Compaction[];
}

export interface SessionMetadata {
  cwd?: string;          // CC: first record's cwd. AG: absent (not in the log)
  gitBranch?: string;    // CC: first record's gitBranch. AG: absent
  agentVersion?: string; // CC: first record's `version`. AG: absent
}

export type SessionEvent = UserEvent | AssistantEvent | ToolCallEvent;

export interface UserEvent {
  type: 'user';
  timestamp: string;
  text: string;
  meta: boolean;         // true = injected by the agent (Skill body, system reminder,
                         // Subagent message), false = typed by the person
}

export interface AssistantEvent {
  type: 'assistant';     // one per model response
  timestamp: string;
  text: string;          // '' when the response only made tool calls
  thinking?: string;     // only when the log holds non-empty thinking text
  model?: string;        // CC: always. AG: only when the record has `model`
  usage?: TokenUsage;    // CC: always. AG: on PLANNER_RESPONSE records
}

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;   // CC only
}

export interface ToolCallEvent {
  type: 'tool_call';
  timestamp: string;
  id: string;            // CC: tool_use id. AG: synthesised `<line>:<n>` (step_index is not unique)
  name: string;
  input: unknown;        // raw tool input / args
  result?: ToolResult;   // absent = no result in the log
  subagent?: SubagentSession;  // set on the call that spawned it
}

export interface ToolResult {
  timestamp: string;
  output: string;        // text blocks joined with '\n'; non-text blocks become '[image]'
  isError: boolean;
}

export interface SubagentSession {
  subagentType?: string; // CC: meta.agentType. AG: subagentDescriptor.typeName
  description?: string;  // CC: meta.description. AG: subagentDescriptor.role
  session: Session;      // parsed with the same reader
}

export interface OfferedItem { name: string; description?: string }

export interface RuleFileLoad {
  path: string;
  kind?: string;         // agent's own label, e.g. CC 'Project', 'AutoMem' (AutoMem = MEMORY.md,
                         // kept here; excluded from reports downstream)
  content: string;       // full content as recorded in the log
  timestamp: string;
  eventIndex: number;    // number of events before it (where it sits in `events`)
}

export interface SkillInvocation {
  name: string;
  source: 'user' | 'model' | 'unknown';
  timestamp: string;
  eventIndex: number;
  toolCallId?: string;   // when a tool call carried it
}

export interface Interrupt { timestamp: string; eventIndex: number }

export interface ToolDenial {
  toolCallId: string;
  kind: string;          // CC toolDenialKind as recorded. Known values: 'user-rejected',
                         // 'interrupted' (Session ended before the result), 'automode-blocked',
                         // 'automode-unavailable', 'permission-rule'
  timestamp: string;
}

export interface Compaction {
  timestamp: string;
  eventIndex: number;
  trigger?: string;      // CC compactMetadata.trigger ('manual' | 'auto')
  summary?: string;      // CC isCompactSummary text; AG CHECKPOINT content
}

export interface Warning { line?: number; reason: string }  // line omitted for file-level warnings
```

`reason` is a fixed short description plus, at most, the record `type`/subtype name. It never
contains Session content.

---

## 3. Claude Code reader

### Files read

- `<dir>/<uuid>.jsonl` (main log; `sessionId` = `<uuid>`).
- `<dir>/<uuid>/subagents/agent-<id>.jsonl` and `agent-<id>.meta.json`, if the folder exists.
- Nothing else. `<uuid>/tool-results/` is never opened.

### Mapping

| Source record | Session field |
| --- | --- |
| first record with `cwd` / `gitBranch` / `version` | `metadata.cwd` / `gitBranch` / `agentVersion` |
| `user`, `message.content` string or `text` blocks, not `isMeta` | `UserEvent` `meta: false` (includes `<command-name>` records as typed) |
| `user` with `isMeta: true` (Skill body "Base directory for this skill: ...", Subagent messages, reminders) | `UserEvent` `meta: true` |
| `user` text exactly `[Request interrupted by user]` or `[Request interrupted by user for tool use]` | `interrupts[]` (not an event) |
| `user` with `isCompactSummary: true` | `summary` of the latest `compactions[]` entry (not an event) |
| `user` `tool_result` block | `result` of the `ToolCallEvent` with that `tool_use_id`; `is_error` → `isError` |
| `user` with `toolDenialKind` | `toolDenials[]` (`toolCallId` from its tool_result, `kind` as recorded) |
| `assistant` records | one `AssistantEvent` per `message.id`. Claude Code writes one record per content block, each repeating `usage`, and the records of one response are not always consecutive (parallel tool calls put `tool_result` user records, and once a text record plus a `command_permissions` attachment, between them; 13 cases in 5 of 6 local Sessions). So records are grouped by `message.id` across intervening records: the first record creates the `AssistantEvent`, later records append their text/thinking to it and their `tool_use` blocks as new `ToolCallEvent`s at their own position; `usage` is taken once |
| `assistant` `text` / `thinking` blocks | `text` / `thinking` (thinking kept only if non-empty) |
| `assistant` `message.model`, `message.usage` | `model`; `usage` = `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens` |
| `assistant` `tool_use` block | `ToolCallEvent` after its `AssistantEvent` |
| `tool_use` `name: "Skill"`, `input.skill` | `skillInvocations[]` `source: 'model'`, `toolCallId` set; `source: 'user'` instead when a `skill_mention` attachment with the same `skillName` appeared since the last `meta: false` user event (the user named the Skill in the prompt). A `skill_mention` with no later `Skill` call is not an invocation |
| `user` `<command-name>/X</command-name>` followed by an `isMeta` user record starting `Base directory for this skill:` with no `sourceToolUseID` | `skillInvocations[]` `name: X`, `source: 'user'`, placed at the `<command-name>` record (its timestamp and eventIndex) (built-in commands such as `/compact`, `/clear` have no such follow-up and are not Skill invocations) |
| `system` subtype `compact_boundary` | `compactions[]` with `trigger` from `compactMetadata.trigger` |
| `attachment` `skill_listing` (`names[]`, `content` lines `- name: description`) | `skillsOffered[]`, union by name in first-seen order; `isInitial: false` only adds |
| `attachment` `agent_listing_delta` (`addedTypes`, `addedLines`, `removedTypes`) | `subagentsOffered[]`; removals applied |
| `attachment` `instructions` (`files[{path, type, content}]`) | one `ruleFiles[]` entry per file per load. A record with `changed: true, reason: "session_start"` holds only the Rule Files whose content changed (after a mid-Session edit, `/clear` or compaction; e.g. `bb1de575` reloads only the `Project` file); each is kept as a further load with its new content |
| Subagent `agent-<id>.jsonl` | parsed with the same function → `SubagentSession`, attached to the main-log `ToolCallEvent` whose `id` equals `meta.toolUseId` |
| Subagent with no `meta.json`, no `toolUseId` (seen: 7 of 57 local files, spawned by slash commands), or an id not found | `unlinkedSubagents[]` + warning |

### Deliberately ignored (no warning)

- Top-level types: `api-request`, `api-request-blob`, `api-request-shape`, `queue-operation`,
  `last-prompt`, `session-owner`, `atis-latch`, `ai-title`, `mode`, `permission-mode`,
  `file-history-snapshot`, `file-history-delta`, `cost-state`, `tools-used`, `pr-link`,
  `frame-link`, `artifact-autoreact-ledger`, `artifact-comment-monitor`.
- `system` subtypes: `informational`, `turn_duration`, `away_summary`, `local_command`.
- `attachment` types: `deferred_tools_record`, `deferred_tools_delta`, `environment`,
  `queued_command`, `prompt_snapshot`, `edited_text_file`, `date`, `model`, `credential_org`,
  `session_context` (holds the user's email), `remote_session_change`, `auto_mode`,
  `silent_turn_reminder`, `file`, `command_permissions`, `mcp_instructions_delta`,
  `total_tokens_reminder`, `compact_file_reference`, `thinking_drop`, `invoked_skills` (re-injected
  Skill bodies after compaction, would double-count), `hook_additional_context`, `hook_success`,
  `task_status`, `directory`, `plan_mode_exit`, `at_mention_reference`, `skill_mention` (used only
  as the signal above). `hook_additional_context` can inject a full Skill body (a SessionStart
  hook loads `superpowers:using-superpowers`); that is not a Skill invocation.
- Record fields: `toolUseResult` (structured copy; the `tool_result` block is what the model saw),
  `interruptedByShutdown`, `isSidechain`, `digests`, `requestId`, `parentUuid` except for the
  slash-command link.

Any other top-level type, `system` subtype or `attachment` type → warning `unknown record type`.
`nested_memory` (Rule Files loaded mid-Session from subdirectories) was not observed on this
machine, so it is not handled and gives that warning until a real sample exists.

Subagent logs are linked to `Agent` calls in the main log only (only `spawnDepth: 1` was seen); a
deeper one lands in `unlinkedSubagents` with a warning.

---

## 4. Antigravity reader

### Files read

- `<dir>/.system_generated/logs/transcript_full.jsonl` (`sessionId` = dir name).
- `<dir>/.system_generated/subagents/<childId>.json`, if the folder exists.
- For each child: `<dir>/../<childId>/.system_generated/logs/transcript_full.jsonl`, parsed with the
  same function.
- Not read: `transcript.jsonl`, `logs/chunks/`, `messages/`, `steps/`, `tasks/`.

### Mapping

| Source record | Session field |
| --- | --- |
| `USER_INPUT` | `UserEvent` `meta: false`; `text` = inside `<USER_REQUEST>...</USER_REQUEST>` when present, else whole `content`, trimmed (`<ADDITIONAL_METADATA>` and `<USER_SETTINGS_CHANGE>` dropped) |
| `SYSTEM_MESSAGE` | `UserEvent` `meta: true` (Subagent messages, the Subagent's task prompt) |
| `PLANNER_RESPONSE` | `AssistantEvent`: `content` → `text` (default ''), `thinking`, `model` if present, `usage` copied as recorded from `input_tokens`, `output_tokens`, `cache_read_tokens` (whether `input_tokens` excludes cached tokens is not documented; the numbers suggest it does) |
| `PLANNER_RESPONSE.tool_calls[n]` `{name, args}` | `ToolCallEvent`, `id` = `<line>:<n>` (line number in the file; `step_index` repeats, e.g. 209, 221, 223 each appear twice with tool calls in `0d43d5d0`), `input` = `args` |
| `GENERIC` | `result` of the oldest pending tool call of the preceding `PLANNER_RESPONSE` (positional; verified 0 mismatches over all 9 local logs); `output` = `content`, `isError` = `status === "ERROR"`; `status: "RUNNING"` (background task launched) is a normal result |
| `CHECKPOINT` (source `SYSTEM`, content `# Resuming from a compaction ...`) | `compactions[]` with `summary` = `content` |
| `read_file` call whose `args.Path` ends in `/skills/<name>/SKILL.md` | `skillInvocations[]` `name`, `source: 'unknown'`, `toolCallId` |
| `run_command` call whose `args.CommandLine` starts with a read command (`cat`, `head`, `tail`, `less`, `more`, `bat`, `sed`, `type`, `Get-Content`) and has an argument matching `/skills/<name>/SKILL.md` | `skillInvocations[]` `name`, `source: 'unknown'`, `toolCallId`. One plain regex on the first word and the path; no further shell parsing. `ls`, `grep`, `find`, `rg` and other commands with that path do not count |
| `USER_INPUT` whose `<USER_REQUEST>` text starts with `/<name>`, followed by a read (`read_file` or shell, as above) of `/skills/<name>/SKILL.md` before the next `meta: false` user event | that invocation gets `source: 'user'` instead of `'unknown'`. A `/<name>` with no such read is not an invocation |
| `subagents/<childId>.json` `{conversationId, subagentDescriptor{typeName, role}}` | `SubagentSession`, attached to the first `invoke_subagent` call whose result `output` contains `"conversationId": "<childId>"`. Only `invoke_subagent` results are searched: `manage_subagents` and `send_message` results also contain child ids. `spawnStepIndex` is not used: in the local sample both children of one parent carry the same value |
| child brain dir missing or call not found | `unlinkedSubagents[]` (if the log exists) + warning |
| `created_at` | `timestamp` |

The path rule `/skills/<name>/SKILL.md` covers every Skill location in the official docs
(antigravity.google/docs/skills): `<workspace>/.agents/skills/` (and each parent up to the repo
root), legacy `.agent/skills/`, `~/.gemini/config/skills/`, `~/.gemini/config/plugins/<p>/skills/`,
`~/.gemini/antigravity-cli/skills/`, `~/.gemini/skills/`, `~/.gemini/antigravity/skills/` and the
builtin `~/.gemini/antigravity/builtin/skills/`. Shell reads and `/<name>` slash commands are not
in the 9 local logs; their mapping follows the docs and the `run_command` args shape
(`{CommandLine, WaitMsBeforeAsync, toolSummary}`).

Absent for Antigravity (not recorded): `skillsOffered`, `subagentsOffered`, `ruleFiles`,
`interrupts`, `toolDenials`, all of `metadata`. No interrupt or denial record exists in the 9 local
logs (words like "cancel" appear only inside tool output).

Ignored fields: `status` (except `ERROR`), `error` (its text is already in `content`), `media`,
`source`. Unknown `type` → warning. `GENERIC` with no pending tool call → warning.

---

## 5. Fixtures

Location: `packages/session-reader/fixtures/`, mirroring the real layouts:

```
fixtures/claude-code/projects/-home-user-example/
  11111111-...jsonl                         main Session
  11111111-.../subagents/agent-a1.jsonl     linked (meta.toolUseId matches an Agent call)
  11111111-.../subagents/agent-a1.meta.json
  11111111-.../subagents/agent-a2.jsonl     meta without toolUseId (slash-command spawn) → unlinked
  11111111-.../subagents/agent-a2.meta.json
  11111111-.../subagents/agent-a3.jsonl     no meta.json → unlinked + warning
  11111111-.../tool-results/decoy.txt       marker string that must never appear in output
  22222222-...jsonl                         minimal Session: one prompt, one answer, no listings
                                            → optional fields are empty arrays, not absent
  33333333-...jsonl                         malformed lines only around one valid exchange
fixtures/antigravity/brain/
  aaaaaaaa-.../.system_generated/logs/transcript_full.jsonl
  aaaaaaaa-.../.system_generated/logs/transcript.jsonl      decoy with a marker, must not be read
  aaaaaaaa-.../.system_generated/subagents/bbbbbbbb-....json linked child
  aaaaaaaa-.../.system_generated/subagents/cccccccc-....json child dir missing → warning
  bbbbbbbb-.../.system_generated/logs/transcript_full.jsonl
```

### What to excerpt

Claude Code, from `59d215f4`, `43aaaea5`, `9e0330ca`, `5818de65` (all this repo's own Sessions):
start-of-Session attachments (`skill_listing`, `agent_listing_delta`, `instructions` with a
`Project` and an `AutoMem` file, one `session_context`), a human prompt with `skill_mention` →
`Skill` tool_use → "Launching skill" result → `isMeta` Skill body with `sourceToolUseID`; a
`<command-name>/supermatt:grill-with-docs</command-name>` record → `isMeta` Skill body without
`sourceToolUseID`; a `/compact` command → `compact_boundary` → `isCompactSummary` → reloaded
`instructions`; an assistant response split over 2–3 records sharing `message.id`; a `tool_result`
with array content incl. an image block; a `user-rejected` denial followed by `[Request interrupted
by user for tool use]`; a `toolDenialKind: "interrupted"` result; an `Agent` tool_use with
`async_launched` result and the matching Subagent log; one of each ignored type; an `isMeta`
"Another Claude session sent a message" record; one `<synthetic>` assistant record.

Antigravity, from `9b255714` (parent with two Subagents) and `bacdc140` (child): `USER_INPUT` with
`<ADDITIONAL_METADATA>` and `<USER_SETTINGS_CHANGE>`, a `PLANNER_RESPONSE` with several parallel
`read_file` calls and their `GENERIC` results, `invoke_subagent` + "Created the following subagent"
result, a `SYSTEM_MESSAGE`, a `GENERIC` with `status: "ERROR"` and one with `"RUNNING"`, a
`PLANNER_RESPONSE` without `model`, a `CHECKPOINT`, and a `read_file` of
`.../skills/antigravity_guide/SKILL.md` plus one of `.../skills/antigravity_guide/references/cli.md`
(must not count), a `send_message` result naming a child id (must not be used for linking), and two
`PLANNER_RESPONSE` records with tool calls sharing one `step_index` (ids must stay unique).

Antigravity hand-made records (not seen in local logs; the fixture folder gets a one-line
`README` saying these records are hand-made from the official docs): a `run_command`
`cat .../.agents/skills/example-skill/SKILL.md` (counts, `unknown`); `ls .../SKILL.md` and
`grep x .../SKILL.md` (do not count); a `USER_INPUT` `/example-skill ...` followed by a `read_file`
of its `SKILL.md` (counts, `user`); a `USER_INPUT` `/other-skill` with no read before the next user
input (not an invocation).

Claude Code also needs: one response whose records are split by a `tool_result` user record (from
parallel tool calls), checking one `AssistantEvent`, usage counted once and correct tool-call
order; an `instructions` record with `changed: true, reason: "session_start"` that reloads only the
`Project` file with new content (a new load, the `AutoMem` load untouched); a `skill_mention` with
no later `Skill` call (as in `b5f763cf`, where the model ran Bash instead), which must not count.

### Sanitising (done by hand, reviewed in the test review step)

- Replace `/home/dev` with `/home/user`, project names and repo names (`skill-scope`, `Jevwright`,
  `6983`) with `example`; slug dirs accordingly.
- Replace all free text (prompts, answers, thinking, tool output, Rule File content, Skill bodies,
  listing descriptions) with short neutral English placeholders that keep the structure the reader
  depends on (`<command-name>`, `Base directory for this skill:`, `<USER_REQUEST>`, `Created the
  following subagent:` JSON, `# Resuming from a compaction`).
- Drop `prompt_snapshot`, `api-request-blob` bodies, `hook_additional_context` bodies; keep one
  record of each ignored type with placeholder fields only.
- `session_context` email → `user@example.com`; `credential_org` / organisation UUIDs and plugin
  cache paths → fixed fake UUIDs. Session, tool, `requestId` and `promptId` values replaced with
  fake ids of the same shape.
- `cwd` → `/home/user/example`, `gitBranch` → `feat/1-example`; `workspaceUris` in
  `subagents/*.json` and paths inside `<ADDITIONAL_METADATA>` → `file:///home/user/example...`.
- No model keys, tokens, or proprietary code anywhere; before the test commit grep the fixtures
  for `/home/dev`, emails with `@[a-z0-9.-]+\.[a-z]{2,}` (a plain `@` matches `@skill-scope/`),
  the user's email domain, `sk-`, `ghp_`.
- `.json` fixture files must pass `prettier --check` (they are not ignored); `.jsonl` files are not
  touched by Prettier.

### Filtered-out and malformed cases (hand-added)

Claude Code `33333333`: invalid JSON line, empty line (skipped silently), a JSON array line, a
record with no `type`, unknown type `future-record`, unknown `attachment` type, unknown `system`
subtype, `assistant` whose `message.content` is not an array, a `tool_result` whose `tool_use_id`
matches no call, a `/clear` command (built-in, not a Skill invocation), a Skill name that only
appears in text (not an invocation), an `invoked_skills` attachment (not counted again).
Antigravity: invalid JSON line, unknown `type`, a `GENERIC` with no pending call, a
`PLANNER_RESPONSE` whose tool call gets no result before the next user input, the `references/`
read above, a missing child dir.

---

## 6. Test areas (detail comes from the test-case-list step)

Per reader: required fields and event order; one `AssistantEvent` and usage taken once per Claude
Code `message.id`, also when other records sit between its records; Antigravity tool-call ids
unique with a repeated `step_index`; Antigravity shell reads of `SKILL.md` count only for read commands; `/<name>` gives `source: 'user'` only when a read follows; tool results matched (by id / by position); a changed Rule
File appears as a new load with its new content; each optional field's presence rule (Claude Code empty
arrays on the minimal file; Antigravity absent keys via `'ruleFiles' in session === false`); Skill
invocation sources (`model`, `user` via slash command, `user` via `skill_mention`, `unknown`); the
non-invocations listed above; Subagent linking and the three unlinked cases; compaction with
summary; interrupts and denials; every malformed case gives exactly one warning with the right line
number and the rest of the file still parses; warnings contain no Session text; decoy markers never
appear in the output; missing main log rejects with a message that contains no content.
`jsonl.test.ts`: line numbering (1-based, blank lines counted), CRLF, trailing newline.

---

## 7. TDD commit sequence

Following the Feature workflow in `CLAUDE.md` (test list → review → test files → review → commit,
then implement → review → commit):

1. `test(session-reader): failing tests for CC and Antigravity readers (#8)`
   Package skeleton (`package.json`, `tsconfig.json`, `src/session.ts` types, `src/index.ts`, and
   `readJsonl`, `readClaudeCodeSession`, `readAntigravitySession`, each
   `throw new Error('not implemented')`), all fixtures, all `*.test.ts`, `pnpm-lock.yaml` importer
   entry. `pnpm typecheck` passes; tests fail on assertions, not on imports.
2. `feat(session-reader): Claude Code Session Reader (#8)` (`jsonl.ts`, `claude-code.ts`).
3. `feat(session-reader): Antigravity Session Reader (#8)` (`antigravity.ts`).
4. `refactor(session-reader): ...` only if the code review leads to one.
5. `docs(repo): Session Reader parse failures and log paths (#8)`:
   - `docs/dev/security.md` A10: malformed lines are skipped with warnings; the whole Session is
     skipped only when its main log cannot be read; partial raw data is never uploaded.
   - `docs/explore/agent-logs.md` Antigravity row → `transcript_full.jsonl`.
   - `CLAUDE.md` repo-state line and planned-packages list (session-reader now exists).
   - `docs/tech/session-reader.md`, only if the implementation ended up differing from it.

Fixing a wrong test after commit 1 is its own `test(...)` commit with the reason.

## 8. Definition of Done

- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test:unit` pass; coverage ≥ 70% (aim
  higher: both readers are pure parsing).
- `pnpm audit --audit-level high` clean; no new dependencies.
- CI green.
- Security checklist items that apply:
  - No code path uploads anything: the package imports only `node:fs/promises` and `node:path`.
  - No secrets or Session content in logs, errors, tests or fixtures: warnings and thrown errors
    carry line numbers, record type names and paths only; fixtures sanitised as in §5 (the
    `session_context` attachment holding the user's email is ignored by the reader and faked in
    fixtures).
  - No shell interpolation of external input: paths go only to `fs` calls; no `child_process`.
  - Session content is untrusted input: the reader only copies strings, never evaluates them.
  - Dependencies: none added.
  - A10 in `docs/dev/security.md` matches the reader's behaviour (commit 5).
- Docs updated per commit 5.

Not in this task: secret masking of Session content (YAGNI until the Grader sends content to a
model).

---

## Notes for later tasks

- Session discovery (CLI/daemon) must skip Antigravity child brain dirs, which are listed in a
  parent's `.system_generated/subagents/`. Reports downstream exclude `kind: 'AutoMem'` Rule Files.
