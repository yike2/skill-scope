# Session Reader fixtures

Trimmed, sanitised excerpts of real local logs: every value is a placeholder, record shapes follow
the real logs. The records below are hand-made (not seen in local logs, or changed from the real
shape); the Antigravity Skill-read and slash-command records follow the official docs.

## Claude Code: `11111111-1111-4111-8111-111111111111.jsonl`

- Line 4: `gitBranch` removed so it first appears at line 5 (CC-03).
- Line 64: text, image, text blocks in one `tool_result` (real image results hold the image only).
- Lines 79-80: `skill_mention` for one Skill followed by a `Skill` call for another (CC-43).
- Line 83: later `skill_listing` with `isInitial: false`.
- Line 84: later `agent_listing_delta` with `removedTypes` (CC-36).
- Lines 85 on: `version` and `gitBranch` changed (CC-03).
- Lines 92-93: exact `[Request interrupted by user]` record and a prompt containing that text.
- Line 107: `instructions` with `changed: true` holding only the `Project` file, new content.
- Marker fields: `toolUseResult.stdout` on line 61 (`TOOL_USE_RESULT_COPY_MARKER`).

## Claude Code: Subagents and decoy (`11111111-.../`)

- `subagents/agent-a1.jsonl` line 3: invalid JSON line.
- `subagents/agent-a4.jsonl`, `agent-a4.meta.json`: `toolUseId` that matches no call.
- `subagents/agent-a5.meta.json`: meta with no `agent-a5.jsonl`.
- `tool-results/decoy.txt`: marker that must never be read.

## Claude Code: `33333333-3333-4333-8333-333333333333.jsonl`

- All lines (malformed and filtered-out records).

## Antigravity: `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`

- Line 12: `step_index` repeated from line 10.
- Line 17: `CHECKPOINT` (the real one was in a child log).
- Line 22: `run_command` reads of `SKILL.md` (`cat`, `ls`, `grep`, `Get-Content`).
- Lines 28-33: `/example-skill` with a `SKILL.md` read, `/other-skill` without one, and a tool
  call with no `GENERIC` before the next user input.
- Line 34: `USER_INPUT` without `<USER_REQUEST>`.
- `.system_generated/logs/transcript.jsonl`: decoy that must never be read.
- `.system_generated/subagents/cccccccc-....json`: child with no brain dir.
- `.system_generated/subagents/eeeeeeee-....json`: child no `invoke_subagent` result names.

## Antigravity: other brain dirs

- `dddddddd-...`: all lines (malformed records).
- `eeeeeeee-...`: the unlinked child.
- `ffffffff-...`: brain dir with only a decoy `transcript.jsonl`, no `transcript_full.jsonl`.
