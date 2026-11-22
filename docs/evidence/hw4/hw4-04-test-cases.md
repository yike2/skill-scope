# Test case list: Session Readers (#8)

Spec: `plan-session-reader.md`. Kinds: **happy**, **filtered-out** (input present in the log that must
not show up, or must not count), **malformed**, **edge**.

Fixture short names (from plan §5):

- `CC-main` = `fixtures/claude-code/projects/-home-user-example/11111111-...jsonl` (with its
  `subagents/` folder: `a1` linked, `a2` meta without `toolUseId`, `a3` no `meta.json`; and
  `tool-results/decoy.txt`)
- `CC-min` = `22222222-...jsonl`
- `CC-bad` = `33333333-...jsonl`
- `AG-parent` = `fixtures/antigravity/brain/aaaaaaaa-...` (incl. its `transcript.jsonl` decoy, the
  hand-made records, `subagents/bbbbbbbb-....json` and `subagents/cccccccc-....json`)
- `AG-child` = `fixtures/antigravity/brain/bbbbbbbb-...` (no `CHECKPOINT`, no Skill reads, no
  `USER_INPUT`)
- `AG-bad` = `fixtures/antigravity/brain/dddddddd-...`, a separate brain dir holding the
  Antigravity malformed records
- `inline` = a small file the test writes to a `mkdtemp` dir (jsonl.test.ts only)

Cases marked **(fixture +)** need a hand-made record beyond the excerpts listed in plan §5.

---

## jsonl.test.ts

### Line numbering and line endings

- **J-01** [happy] given two valid JSON object lines, returns two entries `{ line: 1, record }` and
  `{ line: 2, record }` with the parsed objects. Fixture: `inline`.
- **J-02** [edge] given an empty line between two object lines, skips it with no warning and gives
  the second record `line: 3` (blank lines are counted). Fixture: `inline`.
- **J-03** [edge] given CRLF line endings, parses every record with the same line numbers as the LF
  version and gives no warnings. Fixture: `inline`.
- **J-04** [edge] given a file ending with a trailing newline, returns no extra entry and no warning
  for the final empty segment. Fixture: `inline`.
- **J-05** [edge] given a file whose last line has no trailing newline, still parses the last record.
  Fixture: `inline`.
- **J-06** [edge] given an empty file, returns no entries and no warnings. Fixture: `inline`.
- **J-11** [edge] given a whitespace-only line between two object lines, skips it with no warning
  and the next record keeps its own line number. Fixture: `inline`.

### Malformed lines

- **J-07** [malformed] given an invalid JSON line between two valid lines, returns one warning with
  that line number and still returns both valid records. Fixture: `inline`.
- **J-08** [malformed] given a JSON array line, returns one warning (not an object) with its line
  number instead of a record. Fixture: `inline`.
- **J-09** [malformed] given JSON scalar lines (`42`, `"text"`, `null`), returns one "not an object"
  warning per line. Fixture: `inline`.
- **J-10** [malformed] given an invalid JSON line that contains a marker string, the warning `reason`
  does not contain the marker or any part of the line text. Fixture: `inline`.
- **J-12** [malformed] given a path that does not exist, `readJsonl` rejects with an `ENOENT`
  error. Fixture: non-existent path in a `mkdtemp` dir.

---

## claude-code.test.ts

### Required fields and metadata

- **CC-01** [happy] given `CC-main`, returns `agent: 'claude-code'` and `sessionId` equal to the file
  stem `11111111-...`. Fixture: `CC-main`.
- **CC-02** [happy] given `CC-main`, `metadata` is `{ cwd: '/home/user/example', gitBranch:
  'feat/1-example', agentVersion: <first record's version> }`. Fixture: `CC-main`.
- **CC-03** [edge] given a first record with no `cwd`/`gitBranch`/`version` (e.g. a
  `file-history-snapshot`), `metadata` comes from the first record that has each field. Fixture:
  `CC-main`.

### User events

- **CC-04** [happy] given a typed human prompt (string content), returns a `UserEvent` with that
  text, its timestamp and `meta: false`. Fixture: `CC-main`.
- **CC-05** [happy] given a user record whose `message.content` is an array of several `text`
  blocks, returns one `UserEvent` with their texts joined with `'\n'` and `meta: false`. Fixture: `CC-main`.
- **CC-06** [happy] given a `<command-name>/supermatt:grill-with-docs</command-name>` record, returns
  a `UserEvent` `meta: false` whose text is the record as typed. Fixture: `CC-main`.
- **CC-07** [happy] given an `isMeta` Skill body record ("Base directory for this skill: ..."),
  returns a `UserEvent` with `meta: true`. Fixture: `CC-main`.
- **CC-08** [happy] given an `isMeta` "Another Claude session sent a message" record, returns a
  `UserEvent` with `meta: true`. Fixture: `CC-main`.

### Assistant events and tool calls

- **CC-10** [happy] given a single-record assistant response with a `text` block, returns one
  `AssistantEvent` with `text`, `model` = `message.model` and `usage` = `{ input, output, cacheRead,
  cacheWrite }` from `input_tokens`, `output_tokens`, `cache_read_input_tokens`,
  `cache_creation_input_tokens`. Fixture: `CC-main`.
- **CC-11** [happy] given an assistant response with a non-empty `thinking` block, the
  `AssistantEvent` has that `thinking`. Fixture: `CC-main`.
- **CC-12** [filtered-out] given an assistant response whose `thinking` block is empty, the
  `AssistantEvent` has no `thinking` key. Fixture: `CC-main`.
- **CC-13** [edge] given a response that only makes tool calls, its `AssistantEvent` has
  `text: ''`. Fixture: `CC-main`.
- **CC-14** [happy] given a `tool_use` block, returns a `ToolCallEvent` right after its
  `AssistantEvent` with `id` = the tool_use id, `name`, and `input` equal to the raw input object.
  Fixture: `CC-main`.
- **CC-15** [edge] given one response split over 2–3 consecutive records sharing `message.id`,
  returns exactly one `AssistantEvent` with the text/thinking of all records and `usage` equal to one
  record's usage (not summed). Fixture: `CC-main`.
- **CC-16** [edge] given one response (parallel tool calls) whose records are separated by
  `tool_result` user records, returns one `AssistantEvent`, `usage` counted once, and the
  `ToolCallEvent`s in the order their `tool_use` records appear. Fixture: `CC-main`.
- **CC-17** [happy] given `CC-main`, `events` follow log order (user → assistant → tool calls → next
  user ...), checked against the expected sequence of `type`s; user records that carry only
  `tool_result` blocks add no `UserEvent`. Fixture: `CC-main`.
- **CC-77** [edge] given a `<synthetic>` assistant record, returns an ordinary `AssistantEvent` with
  `model: '<synthetic>'` and `usage` as recorded. Fixture: `CC-main`.

### Tool results

- **CC-18** [happy] given a `tool_result` with string content, the matching `ToolCallEvent` gets
  `result` `{ timestamp: <result record's timestamp>, output, isError: false }`. Fixture: `CC-main`.
- **CC-19** [happy] given a `tool_result` with `is_error: true`, the matching call's
  `result.isError` is `true`. Fixture: `CC-main`.
- **CC-20** [edge] given a `tool_result` with array content holding text blocks and an image block,
  `output` is the text blocks joined with `'\n'` with `'[image]'` at the image's position. Fixture:
  `CC-main`.
- **CC-21** [edge] given a `tool_use` with no `tool_result` anywhere in the log, the
  `ToolCallEvent` has no `result` key. Fixture: `CC-main`.
- **CC-22** [filtered-out] given a record whose `toolUseResult` differs from its `tool_result`
  block, `result.output` comes from the `tool_result` block only. Fixture: `CC-main`.

### Interrupts and denials

- **CC-23** [happy] given a user record with text exactly `[Request interrupted by user for tool
  use]`, `interrupts` gets `{ timestamp, eventIndex }` with `eventIndex` = number of events before it,
  and no `UserEvent` is created for it. Fixture: `CC-main`.
- **CC-24** [happy] given a user record with text exactly `[Request interrupted by user]`,
  `interrupts` gets one entry and no `UserEvent` is created. Fixture: `CC-main` (fixture +).
- **CC-25** [filtered-out] given a typed prompt that contains `[Request interrupted by user]` plus
  other text, it is a normal `UserEvent` and adds no interrupt. Fixture: `CC-main` (fixture +).
- **CC-26** [happy] given a `user-rejected` denial, `toolDenials` gets `{ toolCallId: <its
  tool_result's tool_use_id>, kind: 'user-rejected', timestamp }`. Fixture: `CC-main`.
- **CC-27** [happy] given a `toolDenialKind: "interrupted"` result, `toolDenials` gets an entry with
  `kind: 'interrupted'`. Fixture: `CC-main`.

### Compaction

- **CC-28** [happy] given `/compact` → `compact_boundary` → `isCompactSummary` record, `compactions`
  has one entry with `trigger: 'manual'`, the boundary's timestamp and `eventIndex`, and `summary` =
  the summary text; the `isCompactSummary` record adds no `UserEvent`. Fixture: `CC-main`.

### Rule Files

- **CC-30** [happy] given the start-of-Session `instructions` attachment with a `Project` and an
  `AutoMem` file, `ruleFiles` has one entry per file with `path`, `kind`, full `content`, `timestamp`
  and `eventIndex` = the number of events before the attachment in the fixture (1 in the
  real-shaped excerpt, where it follows the first typed prompt). Fixture: `CC-main`.
- **CC-31** [happy] given the `instructions` attachment reloaded after `/compact`, each reloaded file
  is a further `ruleFiles` entry with that load's timestamp and `eventIndex`. Fixture: `CC-main`.
- **CC-32** [edge] given an `instructions` record with `changed: true, reason: "session_start"` that
  holds only the `Project` file with new content, `ruleFiles` gains one new `Project` load with the
  new content; the earlier `Project` load keeps its old content and no new `AutoMem` load appears.
  Fixture: `CC-main`.

### Offered Skills and Subagents

- **CC-33** [happy] given the initial `skill_listing`, `skillsOffered` lists each name in `names[]`
  order with `description` parsed from its `- name: description` line. Fixture: `CC-main`.
- **CC-34** [edge] given a later `skill_listing` with `isInitial: false` repeating some names and
  adding new ones, the new names are appended, repeated names appear once, and nothing is removed.
  Fixture: `CC-main`.
- **CC-35** [happy] given `agent_listing_delta` with `addedTypes`/`addedLines`, `subagentsOffered`
  lists each added type with its description. Fixture: `CC-main`.
- **CC-36** [edge] given a later `agent_listing_delta` with `removedTypes`, those types are no
  longer in `subagentsOffered`. Fixture: `CC-main` (fixture +: one hand-made record).

### Skill invocations

- **CC-37** [happy] given a `Skill` tool_use with no `skill_mention` for that name since the last
  typed prompt, `skillInvocations` gets `{ name: input.skill, source: 'model', timestamp,
  eventIndex, toolCallId }`. Fixture: `CC-main`.
- **CC-38** [happy] given a typed prompt with a `skill_mention` attachment followed by a `Skill`
  call with the same `skillName`, the invocation has `source: 'user'` and `toolCallId` set. Fixture:
  `CC-main`.
- **CC-39** [happy] given `<command-name>/supermatt:grill-with-docs</command-name>` followed by an
  `isMeta` "Base directory for this skill:" record with no `sourceToolUseID`, `skillInvocations`
  gets `{ name: 'supermatt:grill-with-docs', source: 'user' }` with no `toolCallId`. Fixture:
  `CC-main`.
- **CC-40** [filtered-out] given the `isMeta` Skill body that follows a `Skill` tool call (has
  `sourceToolUseID`), no second invocation is added for it. Fixture: `CC-main`.
- **CC-41** [filtered-out] given a `skill_mention` with no later `Skill` call (the model ran Bash
  instead), no invocation is added. Fixture: `CC-main`.
- **CC-42** [edge] given a `skill_mention` in one typed prompt and the `Skill` call only after a
  later typed prompt, the invocation has `source: 'model'`. Fixture: `CC-main` (fixture +).
- **CC-43** [edge] given a `skill_mention` for Skill X followed by a `Skill` call for Skill Y, the Y
  invocation has `source: 'model'`. Fixture: `CC-main` (fixture +).
- **CC-44** [filtered-out] given the `/compact` command record, no Skill invocation is added.
  Fixture: `CC-main`.
- **CC-45** [filtered-out] given a `/clear` command record (built-in, no Skill body follow-up), no
  Skill invocation is added. Fixture: `CC-bad`.
- **CC-46** [filtered-out] given a Skill name that appears only in prompt/answer text, no invocation
  is added. Fixture: `CC-bad`.

### Subagents

- **CC-49** [happy] given `agent-a1` whose `meta.toolUseId` equals an `Agent` call's id, that
  `ToolCallEvent` has `subagent` `{ subagentType: meta.agentType, description: meta.description,
  session }` where `session` is the parsed Subagent log (`agent: 'claude-code'`,
  `sessionId: 'agent-a1'`, its own events).
  Fixture: `CC-main`.
- **CC-50** [happy] given the `Agent` call whose result is `async_launched`, the same
  `ToolCallEvent` carries both its `result` and its `subagent`. Fixture: `CC-main`.
- **CC-51** [edge] given `agent-a2` whose meta has no `toolUseId`, it is in `unlinkedSubagents` with
  `subagentType`/`description` from its meta, and one warning is added. Fixture: `CC-main`.
- **CC-52** [edge] given `agent-a3` with no `meta.json`, it is in `unlinkedSubagents` without
  `subagentType`/`description`, and one warning is added. Fixture: `CC-main`.
- **CC-53** [edge] given a Subagent whose `meta.toolUseId` matches no call in the main log, it is in
  `unlinkedSubagents` and one warning is added. Fixture: `CC-main` (fixture +: `agent-a4`).
- **CC-55** [edge] given a malformed line inside a Subagent log, the warning is in that Subagent
  Session's `warnings`, not the main Session's. Fixture: `CC-main` (fixture +).
- **CC-56** [edge] given a Session with no `<uuid>/subagents/` folder, `unlinkedSubagents` is `[]`
  and no warning is added. Fixture: `CC-min`.

### Deliberately ignored

- **CC-57** [filtered-out] given one record of each ignored top-level type (`api-request` …
  `artifact-comment-monitor`), none produces an event, field entry or warning. Fixture: `CC-main`.
- **CC-58** [filtered-out] given one record of each ignored `system` subtype (`informational`,
  `turn_duration`, `away_summary`, `local_command`), none produces an event, field entry or warning.
  Fixture: `CC-main`.
- **CC-59** [filtered-out] given one record of each ignored `attachment` type (incl.
  `command_permissions`, `session_context`), none produces an event, field entry or warning, and
  `user@example.com` appears nowhere in the output. Fixture: `CC-main`.
- **CC-47** [filtered-out] given an `invoked_skills` attachment (re-injected Skill bodies), no
  `skillInvocations` entry, no event and no warning are added. Fixture: `CC-main`.
- **CC-48** [filtered-out] given a `hook_additional_context` attachment carrying a full Skill body,
  no `skillInvocations` entry, no event and no warning are added. Fixture: `CC-main`.

### Presence rule

- **CC-60** [edge] given the minimal Session, all seven optional fields (`skillsOffered`,
  `subagentsOffered`, `ruleFiles`, `skillInvocations`, `interrupts`, `toolDenials`, `compactions`)
  are present as empty arrays, and `warnings` and `unlinkedSubagents` are `[]`. Fixture: `CC-min`.
- **CC-61** [happy] given the minimal Session, `events` are exactly one user event and one assistant
  event. Fixture: `CC-min`.

### Malformed lines

Each case: exactly one warning, with the right 1-based line number, and the rest of the file still
parses.

- **CC-63** [edge] given an empty line, no warning, and later warnings keep correct line numbers.
  Fixture: `CC-bad`.
- **CC-65** [malformed] given a record with no `type`, one warning at its line. Fixture: `CC-bad`.
- **CC-66** [malformed] given top-level type `future-record`, one `unknown record type` warning
  whose reason names `future-record`. Fixture: `CC-bad`.
- **CC-67** [malformed] given an unknown `attachment` type, one `unknown record type` warning.
  Fixture: `CC-bad`.
- **CC-68** [malformed] given an unknown `system` subtype, one `unknown record type` warning.
  Fixture: `CC-bad`.
- **CC-70** [malformed] given an `assistant` record whose `message.content` is not an array, one
  warning at its line, and the record is dropped (no `AssistantEvent`). Fixture: `CC-bad`.
- **CC-71** [malformed] given a `tool_result` whose `tool_use_id` matches no call, one warning and no
  call gets that result. Fixture: `CC-bad`.
- **CC-72** [malformed] given `CC-bad`, `warnings` has exactly 8 entries (invalid JSON line, JSON
  array line, record with no `type`, `future-record`, unknown `attachment` type, unknown `system`
  subtype, non-array assistant content, unmatched `tool_result`), each with its own line number, and
  the one valid exchange is fully present in `events`. Fixture: `CC-bad`.

### Privacy, decoys, missing log

- **CC-73** [edge] given `CC-bad` and `CC-main`, no warning `reason` contains any free-text
  placeholder or marker string from the fixture records (only fixed text plus a type/subtype name).
  Fixture: `CC-bad`, `CC-main`.
- **CC-74** [filtered-out] given `tool-results/decoy.txt` with a marker string, the marker appears
  nowhere in `JSON.stringify(session)`. Fixture: `CC-main`.
- **CC-75** [malformed] given a path to a main log that does not exist, the promise rejects with a
  message containing the path and `ENOENT`, and no Session content. Fixture: non-existent path next
  to `CC-main`.
- **CC-76** [edge] given a `meta.json` whose `agent-<id>.jsonl` is missing, the reader does not
  throw, adds one warning, and adds nothing to `unlinkedSubagents`. Fixture: `CC-main` (fixture +).

### Found in code review (temp-dir Sessions)

- **CC-78** [malformed] given a `user` record with no `message.content`, one warning at its line
  and no event; the records around it still parse. Fixture: `mkdtemp`.
- **CC-79** [edge] given an unreadable `<uuid>/subagents/` folder (mode 000), one file-level
  warning, the main log still parses, `unlinkedSubagents` is `[]`. Skipped when run as root.
  Fixture: `mkdtemp`.
- **CC-80** [edge] given an unreadable Subagent `.jsonl` (mode 000) whose `meta.json` names an
  `Agent` call, one file-level warning, the call has no `subagent`, the parent still parses.
  Skipped when run as root. Fixture: `mkdtemp`.

---

## antigravity.test.ts

### Required fields, metadata, presence

- **AG-01** [happy] given `AG-parent`, returns `agent: 'antigravity'` and `sessionId` = the brain
  dir name. Fixture: `AG-parent`.
- **AG-02** [edge] given `AG-parent`, `metadata` is `{}` (no `cwd`, `gitBranch`, `agentVersion`).
  Fixture: `AG-parent`.
- **AG-03** [edge] given `AG-parent`, `skillInvocations` and `compactions` are present, and
  `'skillsOffered' | 'subagentsOffered' | 'ruleFiles' | 'interrupts' | 'toolDenials' in session` are
  all `false`. Fixture: `AG-parent`.
- **AG-04** [edge] given the child Session, which has no Skill reads and no `CHECKPOINT`,
  `skillInvocations` and `compactions` are present as `[]` (presence does not depend on contents).
  Fixture: `AG-child`.

### Events

- **AG-05** [happy] given a `USER_INPUT` with `<USER_REQUEST>`, `<ADDITIONAL_METADATA>` and
  `<USER_SETTINGS_CHANGE>`, the `UserEvent` has `meta: false` and `text` = only the text inside
  `<USER_REQUEST>`; the metadata paths and settings text are absent. Fixture: `AG-parent`.
- **AG-06** [edge] given a `USER_INPUT` without `<USER_REQUEST>`, `text` is the whole `content`.
  Fixture: `AG-parent` (hand-made, fixture +).
- **AG-07** [happy] given a `SYSTEM_MESSAGE`, returns a `UserEvent` with `meta: true`. Fixture:
  `AG-parent`.
- **AG-08** [happy] given a `PLANNER_RESPONSE` with `content`, `thinking`, `model` and usage, the
  `AssistantEvent` has `text`, `thinking`, `model` and `usage` `{ input, output, cacheRead }` from
  `input_tokens`, `output_tokens`, `cache_read_tokens`, with no `cacheWrite` key. Fixture:
  `AG-parent`.
- **AG-09** [edge] given a `PLANNER_RESPONSE` without `model`, the `AssistantEvent` has no `model`
  key. Fixture: `AG-parent`.
- **AG-10** [edge] given a `PLANNER_RESPONSE` with tool calls and no `content`, `text` is `''`.
  Fixture: `AG-parent`.
- **AG-11** [happy] given `AG-parent`, every event's `timestamp` equals its record's `created_at`,
  and `events` follow log order with each `AssistantEvent` followed by its `ToolCallEvent`s in
  `tool_calls` order; `GENERIC` records add no event. Fixture: `AG-parent`.

### Tool calls and results

- **AG-12** [happy] given a `PLANNER_RESPONSE` with tool calls on file line L, the `ToolCallEvent`s
  have `id` `L:0`, `L:1`, …, `name`, and `input` equal to `args`. Fixture: `AG-parent`.
- **AG-13** [edge] given two `PLANNER_RESPONSE` records with tool calls sharing one `step_index`,
  all `ToolCallEvent` ids in the Session are unique. Fixture: `AG-parent`.
- **AG-14** [happy] given several parallel `read_file` calls followed by their `GENERIC` records,
  each result goes to the calls in order (first `GENERIC` → first call) with `output` = `content`,
  `isError: false`. Fixture: `AG-parent`.
- **AG-15** [happy] given a `GENERIC` with `status: "ERROR"`, the matched call's `result.isError` is
  `true` and `output` is `content` only (the `error` field is not added). Fixture: `AG-parent`.
- **AG-16** [edge] given a `GENERIC` with `status: "RUNNING"`, it is a normal result with
  `isError: false` and no warning. Fixture: `AG-parent`.
- **AG-18** [edge] given a `PLANNER_RESPONSE` tool call with no `GENERIC` before the next user
  input, that `ToolCallEvent` has no `result` key and no warning is added. Fixture: `AG-parent`.

### Compaction

- **AG-19** [happy] given a `CHECKPOINT` (`# Resuming from a compaction ...`), `compactions` has one
  entry with its timestamp, `eventIndex`, `summary` = `content`, no `trigger`, and no event is
  created. Fixture: `AG-parent` (the only fixture with a `CHECKPOINT`).

### Skill invocations

- **AG-20** [happy] given a `read_file` of `.../skills/antigravity_guide/SKILL.md`,
  `skillInvocations` gets `{ name: 'antigravity_guide', source: 'unknown', timestamp, eventIndex,
  toolCallId }`. Fixture: `AG-parent`.
- **AG-21** [filtered-out] given a `read_file` of `.../skills/antigravity_guide/references/cli.md`,
  no invocation is added. Fixture: `AG-parent`.
- **AG-22** [happy] given a `run_command` `cat .../.agents/skills/example-skill/SKILL.md`, an
  invocation `{ name: 'example-skill', source: 'unknown', toolCallId }` is added. Fixture:
  `AG-parent` (hand-made).
- **AG-38** [happy] given a `run_command` `Get-Content .../skills/example-skill/SKILL.md`, an
  invocation `{ name: 'example-skill', source: 'unknown', toolCallId }` is added. Fixture:
  `AG-parent` (hand-made, fixture +).
- **AG-23** [filtered-out] given a `run_command` `ls .../SKILL.md`, no invocation is added.
  Fixture: `AG-parent` (hand-made).
- **AG-24** [filtered-out] given a `run_command` `grep x .../SKILL.md`, no invocation is added.
  Fixture: `AG-parent` (hand-made).
- **AG-25** [happy] given a `USER_INPUT` `/example-skill ...` followed by a `read_file` of its
  `SKILL.md` before the next typed input, exactly one invocation is added for that read, with
  `source: 'user'`. Fixture: `AG-parent` (hand-made).
- **AG-26** [filtered-out] given a `USER_INPUT` `/other-skill` with no read of its `SKILL.md` before
  the next typed input, no invocation named `other-skill` is added. Fixture: `AG-parent`
  (hand-made).

### Subagents

- **AG-27** [happy] given `subagents/bbbbbbbb-....json` and an `invoke_subagent` result containing
  `"conversationId": "bbbbbbbb-..."`, that `ToolCallEvent` has `subagent` `{ subagentType: typeName,
  description: role, session }` where `session` is the parsed child (`agent: 'antigravity'`,
  `sessionId: 'bbbbbbbb-...'`, its events). Fixture: `AG-parent`, `AG-child`.
- **AG-28** [filtered-out] given a `send_message` result that names the child id, the `send_message`
  `ToolCallEvent` has no `subagent`, and the child is attached only once. Fixture: `AG-parent`.
- **AG-29** [edge] given `subagents/cccccccc-....json` whose child brain dir is missing, the reader
  does not throw, adds one warning, and `cccccccc` is not in `unlinkedSubagents`. Fixture:
  `AG-parent`.
- **AG-30** [edge] given a child json whose brain dir exists but no `invoke_subagent` result names
  it, the child is in `unlinkedSubagents` with `subagentType`/`description`, and one warning is
  added. Fixture: `AG-parent` (fixture +: `subagents/eeeeeeee-....json` plus brain dir
  `eeeeeeee-...`).

### Ignored and malformed

- **AG-31** [malformed] given an invalid JSON line, one warning at its line number and the rest of
  the file still parses. Fixture: `AG-bad`.
- **AG-32** [malformed] given a record with an unknown `type`, one warning naming that type and no
  event. Fixture: `AG-bad`.
- **AG-33** [malformed] given a `GENERIC` with no pending tool call, one warning and no call gets
  its content. Fixture: `AG-bad`.

### Privacy, decoys, missing log

- **AG-35** [edge] given `AG-parent` and `AG-bad`, no warning `reason` contains any free-text
  placeholder or marker string from the fixture records. Fixture: `AG-parent`, `AG-bad`.
- **AG-36** [filtered-out] given `logs/transcript.jsonl` with a marker string, the marker appears
  nowhere in `JSON.stringify(session)`. Fixture: `AG-parent`.
- **AG-37** [malformed] given a brain dir path with no `transcript_full.jsonl`, the promise rejects
  with a message containing the path and `ENOENT`, and no Session content. Fixture: the
  non-existent `cccccccc-...` dir.

### Found in code review (temp-dir brain folders)

- **AG-39** [edge] given `subagents/...json` (child id `..`), the file is skipped with one warning
  and a log at `<brain>/..` is never read. Fixture: `mkdtemp`.
- **AG-40** [edge] given `subagents/<A>.json` inside brain dir A (self-reference), the file is
  skipped with one warning and the reader returns (no recursion). Fixture: `mkdtemp`.
- **AG-41** [filtered-out] given a `run_command` `cat > .../skills/example-skill/SKILL.md <<'EOF'`
  (a write through a redirect), no invocation is added. Fixture: `mkdtemp`.
- **AG-42** [edge] given an unreadable `subagents/` folder (mode 000), one file-level warning and
  the log still parses. Skipped when run as root. Fixture: `mkdtemp`.
- **AG-43** [edge] given an unreadable `subagents/<id>.json` (mode 000) whose child brain dir
  exists, one file-level warning, `unlinkedSubagents` is `[]`, the log still parses. Skipped when
  run as root. Fixture: `mkdtemp`.
- **AG-44** [edge] given brain A listing B in `subagents/` and B listing A, reading A returns; A's
  `invoke_subagent` call links B as usual; inside B's Session the entry for A is skipped with
  exactly one warning (fixed reason, no id) and A is not nested again. Fixture: `mkdtemp`.

---

## Counts

| File | happy | filtered-out | malformed | edge | total |
| --- | --- | --- | --- | --- | --- |
| jsonl.test.ts | 1 | 0 | 5 | 6 | 12 |
| claude-code.test.ts | 28 | 14 | 9 | 23 | 74 |
| antigravity.test.ts | 14 | 7 | 4 | 17 | 42 |
