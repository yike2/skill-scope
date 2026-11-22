import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { readClaudeCodeSession } from './claude-code.js';
import type { AssistantEvent, Session, SessionEvent, ToolCallEvent, UserEvent } from './session.js';

// Fixtures: fixtures/claude-code/projects/-home-user-example/. Every enveloped record's
// timestamp is 2026-11-22T01:00:00Z plus its 1-based line number in seconds, so ts(line) below
// names the record a value must come from.
const projectDir = fileURLToPath(
  new URL('../fixtures/claude-code/projects/-home-user-example/', import.meta.url),
);
const MAIN_ID = '11111111-1111-4111-8111-111111111111';
const MIN_ID = '22222222-2222-4222-8222-222222222222';
const BAD_ID = '33333333-3333-4333-8333-333333333333';

function ts(line: number): string {
  return new Date(Date.UTC(2026, 10, 22, 1, 0, 0) + line * 1000).toISOString();
}

function tid(tag: string): string {
  return 'toolu_01' + tag.padEnd(22, 'X');
}

function once(path: string): () => Promise<Session> {
  let cached: Promise<Session> | undefined;
  return () => (cached ??= readClaudeCodeSession(path));
}

const main = once(join(projectDir, `${MAIN_ID}.jsonl`));
const minimal = once(join(projectDir, `${MIN_ID}.jsonl`));
const bad = once(join(projectDir, `${BAD_ID}.jsonl`));

// Expected events of the main Session: [kind, line of the record that creates it].
// u = typed user event, m = meta user event, a = assistant event, t = tool call event.
const MAIN_EVENTS: [string, number][] = [
  ['u', 6],
  ['a', 28],
  ['t', 30],
  ['m', 32],
  ['a', 34],
  ['u', 57],
  ['m', 58],
  ['a', 59],
  ['t', 60],
  ['a', 62],
  ['t', 63],
  ['t', 65],
  ['a', 67],
  ['t', 67],
  ['u', 70],
  ['a', 72],
  ['t', 72],
  ['u', 74],
  ['a', 75],
  ['t', 75],
  ['m', 77],
  ['u', 78],
  ['a', 80],
  ['t', 80],
  ['m', 82],
  ['u', 85],
  ['a', 86],
  ['t', 87],
  ['m', 90],
  ['a', 91],
  ['u', 93],
  ['a', 94],
  ['t', 94],
  ['m', 98],
  ['u', 99],
  ['u', 103],
  ['a', 104],
  ['t', 104],
  ['m', 106],
  ['u', 108],
  ['a', 109],
  ['t', 109],
];

// The main log's only warnings are the four file-level Subagent ones: agent-a2 (meta without
// toolUseId), agent-a3 (no meta.json), agent-a4 (toolUseId matches no call) and agent-a5
// (meta.json without a log).
const MAIN_WARNING_COUNT = 4;

function kind(e: SessionEvent): string {
  if (e.type === 'user') return e.meta ? 'm' : 'u';
  return e.type === 'assistant' ? 'a' : 't';
}

function eventAt(s: Session, index: number): SessionEvent {
  const e = s.events[index];
  if (!e) throw new Error(`no event at index ${index}`);
  return e;
}

function userAt(s: Session, index: number): UserEvent {
  const e = eventAt(s, index);
  if (e.type !== 'user') throw new Error(`event ${index} is ${e.type}, not user`);
  return e;
}

function assistantAt(s: Session, index: number): AssistantEvent {
  const e = eventAt(s, index);
  if (e.type !== 'assistant') throw new Error(`event ${index} is ${e.type}, not assistant`);
  return e;
}

function toolCall(s: Session, id: string): ToolCallEvent {
  const e = s.events.find((x): x is ToolCallEvent => x.type === 'tool_call' && x.id === id);
  if (!e) throw new Error(`no tool call ${id}`);
  return e;
}

function userTexts(s: Session): string[] {
  return s.events.filter((e): e is UserEvent => e.type === 'user').map((e) => e.text);
}

function invocations(s: Session) {
  return s.skillInvocations ?? [];
}

function subagentIds(s: Session): string[] {
  return s.unlinkedSubagents.map((u) => u.session.sessionId).sort();
}

function warningLines(s: Session): (number | undefined)[] {
  return s.warnings.map((w) => w.line);
}

// Nothing beyond the expected events, field entries and file-level Subagent warnings.
function expectOnlyExpectedOutput(s: Session): void {
  expect(s.events.map((e) => [kind(e), e.timestamp])).toEqual(
    MAIN_EVENTS.map(([k, line]) => [k, ts(line)]),
  );
  expect(s.warnings).toHaveLength(MAIN_WARNING_COUNT);
  expect(s.warnings.every((w) => w.line === undefined)).toBe(true);
  expect(s.skillsOffered).toHaveLength(4);
  expect(s.subagentsOffered).toHaveLength(3);
  expect(s.ruleFiles).toHaveLength(5);
  expect(s.skillInvocations).toHaveLength(5);
  expect(s.interrupts).toHaveLength(2);
  expect(s.toolDenials).toHaveLength(2);
  expect(s.compactions).toHaveLength(1);
}

describe('readClaudeCodeSession', () => {
  describe('required fields and metadata', () => {
    it('CC-01 sets agent and the file stem as sessionId', async () => {
      const s = await main();

      expect(s.agent).toBe('claude-code');
      expect(s.sessionId).toBe(MAIN_ID);
    });

    it("CC-02 takes metadata from the first record's cwd, gitBranch and version", async () => {
      const s = await main();

      expect(s.metadata).toEqual({
        cwd: '/home/user/example',
        gitBranch: 'feat/1-example',
        agentVersion: '2.1.330',
      });
    });

    it('CC-03 skips leading records without metadata fields and ignores later values', async () => {
      // Lines 1-3 (session-owner, queue-operation, file-history-snapshot) carry no cwd, gitBranch
      // or version; line 4 carries cwd and version but no gitBranch, which first appears at line 5;
      // records from line 85 on carry feat/2-example and 2.1.331.
      const s = await main();

      expect(s.metadata.cwd).toBe('/home/user/example');
      expect(s.metadata.gitBranch).toBe('feat/1-example');
      expect(s.metadata.agentVersion).toBe('2.1.330');
    });
  });

  describe('user events', () => {
    it('CC-04 maps a typed string prompt to a non-meta UserEvent', async () => {
      const s = await main();

      expect(eventAt(s, 0)).toEqual({
        type: 'user',
        timestamp: ts(6),
        text: 'Placeholder prompt one.',
        meta: false,
      });
    });

    it('CC-05 joins several text blocks of one prompt with newlines', async () => {
      const s = await main();

      expect(eventAt(s, 14)).toEqual({
        type: 'user',
        timestamp: ts(70),
        text: 'Placeholder prompt two, part one.\nPlaceholder prompt two, part two.',
        meta: false,
      });
    });

    it('CC-06 keeps a slash-command record as typed, not meta', async () => {
      const s = await main();

      expect(eventAt(s, 5)).toEqual({
        type: 'user',
        timestamp: ts(57),
        text:
          '<command-message>supermatt:grill-with-docs</command-message>\n' +
          '<command-name>/supermatt:grill-with-docs</command-name>\n' +
          '<command-args>Placeholder args</command-args>',
        meta: false,
      });
    });

    it('CC-07 marks an isMeta Skill body as meta', async () => {
      const s = await main();

      for (const index of [3, 6]) {
        const e = userAt(s, index);
        expect(e.meta).toBe(true);
        expect(e.text.startsWith('Base directory for this skill:')).toBe(true);
      }
    });

    it('CC-08 marks an isMeta message from another Claude session as meta', async () => {
      const s = await main();

      const e = userAt(s, 28);
      expect(e.meta).toBe(true);
      expect(e.timestamp).toBe(ts(90));
      expect(e.text.startsWith('Another Claude session sent a message:')).toBe(true);
    });
  });

  describe('assistant events and tool calls', () => {
    it('CC-10 maps a single-record text response with model and usage', async () => {
      const s = await main();

      expect(eventAt(s, 4)).toEqual({
        type: 'assistant',
        timestamp: ts(34),
        text: 'Placeholder answer B.',
        model: 'claude-opus-5-5',
        usage: { input: 3, output: 5, cacheRead: 100, cacheWrite: 20 },
      });
    });

    it('CC-11 keeps non-empty thinking', async () => {
      const s = await main();

      expect(assistantAt(s, 1).thinking).toBe('Placeholder thinking A.');
    });

    it('CC-12 drops an empty thinking block', async () => {
      const s = await main();

      expect('thinking' in assistantAt(s, 7)).toBe(false);
    });

    it("CC-13 gives a tool-call-only response text ''", async () => {
      const s = await main();

      expect(assistantAt(s, 7).text).toBe('');
    });

    it('CC-14 adds a ToolCallEvent right after its AssistantEvent with id, name and raw input', async () => {
      const s = await main();

      expect(eventAt(s, 7).type).toBe('assistant');
      expect(eventAt(s, 8)).toMatchObject({
        type: 'tool_call',
        timestamp: ts(60),
        id: tid('BashOne'),
        name: 'Bash',
      });
      const call = eventAt(s, 8);
      expect(call.type === 'tool_call' && call.input).toEqual({
        command: 'echo placeholder',
        description: 'Placeholder description',
      });
    });

    it('CC-15 merges consecutive records sharing message.id into one AssistantEvent', async () => {
      // Lines 28-30: thinking, text, tool_use of one response, each repeating the same usage.
      const s = await main();

      expect(s.events.slice(0, 4).map((e) => e.type)).toEqual([
        'user',
        'assistant',
        'tool_call',
        'user',
      ]);
      expect(eventAt(s, 1)).toEqual({
        type: 'assistant',
        timestamp: ts(28),
        text: 'Placeholder answer A.',
        thinking: 'Placeholder thinking A.',
        model: 'claude-opus-5-5',
        usage: { input: 2, output: 343, cacheRead: 27018, cacheWrite: 18931 },
      });
    });

    it('CC-16 keeps one AssistantEvent when tool_result records sit between its records', async () => {
      // Lines 62-66: text, tool_use, tool_result, tool_use, tool_result of one response.
      const s = await main();

      expect(s.events.slice(9, 13).map((e) => [e.type, e.timestamp])).toEqual([
        ['assistant', ts(62)],
        ['tool_call', ts(63)],
        ['tool_call', ts(65)],
        ['assistant', ts(67)],
      ]);
      expect(toolCall(s, tid('ReadOne'))).toBe(eventAt(s, 10));
      expect(toolCall(s, tid('ReadTwo'))).toBe(eventAt(s, 11));
      expect(assistantAt(s, 9)).toMatchObject({
        text: 'Placeholder answer D.',
        usage: { input: 7, output: 11, cacheRead: 200, cacheWrite: 30 },
      });
    });

    it('CC-17 keeps log order and adds no UserEvent for tool_result-only records', async () => {
      const s = await main();

      expect(s.events.map((e) => [kind(e), e.timestamp])).toEqual(
        MAIN_EVENTS.map(([k, line]) => [k, ts(line)]),
      );
    });

    it('CC-77 maps a <synthetic> assistant record to an ordinary AssistantEvent', async () => {
      const s = await main();

      expect(eventAt(s, 29)).toEqual({
        type: 'assistant',
        timestamp: ts(91),
        text: 'No response requested.',
        model: '<synthetic>',
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      });
    });
  });

  describe('tool results', () => {
    it('CC-18 attaches a string tool_result to its call', async () => {
      const s = await main();

      expect(toolCall(s, tid('SkillOne')).result).toEqual({
        timestamp: ts(31),
        output: 'Launching skill: supermatt:grilling',
        isError: false,
      });
    });

    it('CC-19 maps is_error: true to isError', async () => {
      const s = await main();

      expect(toolCall(s, tid('ReadTwo')).result).toEqual({
        timestamp: ts(66),
        output: 'Placeholder error: file does not exist.',
        isError: true,
      });
    });

    it('CC-20 joins text blocks and puts [image] where an image block was', async () => {
      const s = await main();

      expect(toolCall(s, tid('ReadOne')).result).toEqual({
        timestamp: ts(64),
        output: 'Placeholder before image.\n[image]\nPlaceholder after image.',
        isError: false,
      });
    });

    it('CC-21 leaves result absent for a call with no tool_result', async () => {
      const s = await main();

      expect('result' in toolCall(s, tid('NoResult'))).toBe(false);
    });

    it('CC-22 takes output from the tool_result block, not toolUseResult', async () => {
      const s = await main();

      expect(toolCall(s, tid('BashOne')).result?.output).toBe('Placeholder command output.');
      expect(JSON.stringify(s)).not.toContain('TOOL_USE_RESULT_COPY_MARKER');
    });
  });

  describe('interrupts and denials', () => {
    it('CC-23 records "[Request interrupted by user for tool use]" as an interrupt, not an event', async () => {
      const s = await main();

      expect(s.interrupts?.[0]).toEqual({ timestamp: ts(69), eventIndex: 14 });
      expect(userTexts(s)).not.toContain('[Request interrupted by user for tool use]');
    });

    it('CC-24 records "[Request interrupted by user]" as an interrupt, not an event', async () => {
      const s = await main();

      expect(s.interrupts).toEqual([
        { timestamp: ts(69), eventIndex: 14 },
        { timestamp: ts(92), eventIndex: 30 },
      ]);
      expect(userTexts(s)).not.toContain('[Request interrupted by user]');
    });

    it('CC-25 keeps a prompt that only contains the interrupt text as a UserEvent', async () => {
      const s = await main();

      expect(eventAt(s, 30)).toEqual({
        type: 'user',
        timestamp: ts(93),
        text: 'Placeholder prompt six. [Request interrupted by user] appeared earlier.',
        meta: false,
      });
      expect(s.interrupts?.map((i) => i.timestamp)).not.toContain(ts(93));
    });

    it('CC-26 records a user-rejected denial with its tool_use_id', async () => {
      const s = await main();

      expect(s.toolDenials?.[0]).toEqual({
        toolCallId: tid('BashTwo'),
        kind: 'user-rejected',
        timestamp: ts(68),
      });
    });

    it('CC-27 records an interrupted denial', async () => {
      const s = await main();

      expect(s.toolDenials).toEqual([
        { toolCallId: tid('BashTwo'), kind: 'user-rejected', timestamp: ts(68) },
        { toolCallId: tid('BashFour'), kind: 'interrupted', timestamp: ts(95) },
      ]);
    });
  });

  describe('compaction', () => {
    it('CC-28 records compact_boundary with trigger and the isCompactSummary text, no event', async () => {
      const s = await main();

      expect(s.compactions).toEqual([
        {
          timestamp: ts(96),
          eventIndex: 33,
          trigger: 'manual',
          summary:
            'This session is being continued from a previous conversation. Placeholder compaction summary.',
        },
      ]);
      expect(s.events.map((e) => e.timestamp)).not.toContain(ts(97));
    });
  });

  describe('Rule Files', () => {
    const project = {
      path: '/home/user/example/CLAUDE.md',
      kind: 'Project',
      content: '# Placeholder project rules v1\n\n- Placeholder Rule Item one.',
    };
    const autoMem = {
      path: '/home/user/.claude/projects/-home-user-example/memory/MEMORY.md',
      kind: 'AutoMem',
      content: '- Placeholder memory entry.',
    };

    it('CC-30 records each file of the start-of-Session instructions attachment', async () => {
      const s = await main();

      expect(s.ruleFiles?.slice(0, 2)).toEqual([
        { ...project, timestamp: ts(16), eventIndex: 1 },
        { ...autoMem, timestamp: ts(16), eventIndex: 1 },
      ]);
    });

    it('CC-31 records the instructions reloaded after /compact as further loads', async () => {
      const s = await main();

      expect(s.ruleFiles?.slice(2, 4)).toEqual([
        { ...project, timestamp: ts(102), eventIndex: 35 },
        { ...autoMem, timestamp: ts(102), eventIndex: 35 },
      ]);
    });

    it('CC-32 adds a changed Project file as a new load and leaves earlier loads alone', async () => {
      const s = await main();

      expect(s.ruleFiles).toHaveLength(5);
      expect(s.ruleFiles?.[4]).toEqual({
        path: '/home/user/example/CLAUDE.md',
        kind: 'Project',
        content: '# Placeholder project rules v2\n\n- Placeholder Rule Item one, edited.',
        timestamp: ts(107),
        eventIndex: 39,
      });
      expect(s.ruleFiles?.[0]?.content).toBe(project.content);
      expect(s.ruleFiles?.filter((r) => r.kind === 'AutoMem')).toHaveLength(2);
    });
  });

  describe('offered Skills and Subagents', () => {
    it('CC-33 lists the initial skill_listing names with their descriptions', async () => {
      const s = await main();

      expect(s.skillsOffered?.slice(0, 3)).toEqual([
        { name: 'supermatt:grilling', description: 'Placeholder grilling description.' },
        { name: 'supermatt:tdd', description: 'Placeholder tdd description.' },
        { name: 'example-skill', description: 'Placeholder example-skill description.' },
      ]);
    });

    it('CC-34 appends new names from a later listing once and removes nothing', async () => {
      const s = await main();

      expect(s.skillsOffered).toEqual([
        { name: 'supermatt:grilling', description: 'Placeholder grilling description.' },
        { name: 'supermatt:tdd', description: 'Placeholder tdd description.' },
        { name: 'example-skill', description: 'Placeholder example-skill description.' },
        { name: 'supermatt:new-skill', description: 'Placeholder new-skill description.' },
      ]);
    });

    it('CC-35 lists the Subagent types added by agent_listing_delta with descriptions', async () => {
      const s = await main();

      expect(s.subagentsOffered?.slice(0, 2)).toEqual([
        { name: 'general-purpose', description: 'Placeholder general-purpose description.' },
        { name: 'Explore', description: 'Placeholder Explore description.' },
      ]);
    });

    it('CC-36 drops Subagent types listed in a later removedTypes', async () => {
      const s = await main();

      expect(s.subagentsOffered).toEqual([
        { name: 'general-purpose', description: 'Placeholder general-purpose description.' },
        { name: 'Explore', description: 'Placeholder Explore description.' },
        { name: 'example-agent', description: 'Placeholder example-agent description.' },
      ]);
    });
  });

  describe('Skill invocations', () => {
    it('CC-37 records a Skill call with no skill_mention since the last prompt as model', async () => {
      const s = await main();

      expect(invocations(s).filter((i) => i.toolCallId === tid('SkillFour'))).toEqual([
        {
          name: 'example-skill',
          source: 'model',
          timestamp: ts(104),
          eventIndex: 37,
          toolCallId: tid('SkillFour'),
        },
      ]);
    });

    it('CC-38 records a Skill call after a skill_mention for the same name as user', async () => {
      const s = await main();

      expect(invocations(s).filter((i) => i.toolCallId === tid('SkillOne'))).toEqual([
        {
          name: 'supermatt:grilling',
          source: 'user',
          timestamp: ts(30),
          eventIndex: 2,
          toolCallId: tid('SkillOne'),
        },
      ]);
    });

    it('CC-39 records a slash command followed by its Skill body as user, without toolCallId', async () => {
      const s = await main();

      // The invocation sits at the <command-name> record (line 57, event 5).
      const found = invocations(s).filter((i) => i.name === 'supermatt:grill-with-docs');
      expect(found).toEqual([
        { name: 'supermatt:grill-with-docs', source: 'user', timestamp: ts(57), eventIndex: 5 },
      ]);
      expect(found[0] && 'toolCallId' in found[0]).toBe(false);
    });

    it('CC-40 adds no second invocation for the Skill body that follows a Skill call', async () => {
      const s = await main();

      expect(invocations(s).filter((i) => i.name === 'supermatt:grilling')).toHaveLength(1);
    });

    it('CC-41 adds no invocation for a skill_mention with no later Skill call', async () => {
      // Line 71 mentions supermatt:tdd, then the model runs Bash; the later supermatt:tdd call
      // (line 75) follows another prompt. Line 79 mentions supermatt:diagnose, never called.
      const s = await main();

      expect(invocations(s).filter((i) => i.name === 'supermatt:tdd')).toHaveLength(1);
      expect(invocations(s).filter((i) => i.name === 'supermatt:diagnose')).toEqual([]);
    });

    it('CC-42 records a Skill call as model when its skill_mention was in an earlier prompt', async () => {
      const s = await main();

      expect(invocations(s).filter((i) => i.name === 'supermatt:tdd')).toEqual([
        {
          name: 'supermatt:tdd',
          source: 'model',
          timestamp: ts(75),
          eventIndex: 19,
          toolCallId: tid('SkillTwo'),
        },
      ]);
    });

    it('CC-43 records a Skill call as model when the skill_mention named another Skill', async () => {
      const s = await main();

      expect(invocations(s).filter((i) => i.name === 'supermatt:prototype')).toEqual([
        {
          name: 'supermatt:prototype',
          source: 'model',
          timestamp: ts(80),
          eventIndex: 23,
          toolCallId: tid('SkillThree'),
        },
      ]);
    });

    it('CC-44 adds no invocation for the /compact command', async () => {
      const s = await main();

      expect(invocations(s).map((i) => i.name)).toEqual([
        'supermatt:grilling',
        'supermatt:grill-with-docs',
        'supermatt:tdd',
        'supermatt:prototype',
        'example-skill',
      ]);
    });

    it('CC-45 adds no invocation for the built-in /clear command', async () => {
      const s = await bad();

      expect(userAt(s, 2).text.startsWith('<command-name>/clear</command-name>')).toBe(true);
      expect(s.skillInvocations).toEqual([]);
    });

    it('CC-46 adds no invocation for a Skill name that only appears in text', async () => {
      const s = await bad();

      expect(userAt(s, 0).text).toContain('supermatt:tdd');
      expect(assistantAt(s, 1).text).toContain('supermatt:tdd');
      expect(invocations(s).filter((i) => i.name === 'supermatt:tdd')).toEqual([]);
    });
  });

  describe('Subagents', () => {
    it('CC-49 attaches a Subagent log to the Agent call named by meta.toolUseId', async () => {
      const s = await main();

      const sub = toolCall(s, tid('AgentOne')).subagent;
      expect(sub?.subagentType).toBe('general-purpose');
      expect(sub?.description).toBe('Placeholder Subagent task');
      expect(sub?.session.agent).toBe('claude-code');
      expect(sub?.session.sessionId).toBe('agent-a1');
      expect(sub?.session.events).toEqual([
        {
          type: 'user',
          timestamp: ts(1),
          text: 'Placeholder Subagent task prompt a1.',
          meta: false,
        },
        {
          type: 'assistant',
          timestamp: ts(2),
          text: 'Placeholder Subagent answer a1.',
          model: 'claude-opus-5-5',
          usage: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 },
        },
      ]);
    });

    it('CC-50 keeps both result and subagent on an async_launched Agent call', async () => {
      const s = await main();

      const call = toolCall(s, tid('AgentOne'));
      expect(call.result).toEqual({
        timestamp: ts(88),
        output: 'Async agent launched successfully. Placeholder.',
        isError: false,
      });
      expect(call.subagent?.session.sessionId).toBe('agent-a1');
    });

    it('CC-51 lists a Subagent whose meta has no toolUseId as unlinked, with a warning', async () => {
      const s = await main();

      const found = s.unlinkedSubagents.find((u) => u.session.sessionId === 'agent-a2');
      expect(found?.subagentType).toBe('Explore');
      expect(found?.description).toBe('Placeholder slash-command task');
      expect(found?.session.events.map((e) => e.type)).toEqual(['user', 'assistant']);
      expect(s.warnings).toHaveLength(MAIN_WARNING_COUNT);
    });

    it('CC-52 lists a Subagent with no meta.json as unlinked without type or description', async () => {
      const s = await main();

      const found = s.unlinkedSubagents.find((u) => u.session.sessionId === 'agent-a3');
      expect(found).toBeDefined();
      expect(found && 'subagentType' in found).toBe(false);
      expect(found && 'description' in found).toBe(false);
      expect(s.warnings).toHaveLength(MAIN_WARNING_COUNT);
    });

    it('CC-53 lists a Subagent whose toolUseId matches no call as unlinked, with a warning', async () => {
      const s = await main();

      const found = s.unlinkedSubagents.find((u) => u.session.sessionId === 'agent-a4');
      expect(found?.subagentType).toBe('general-purpose');
      expect(found?.description).toBe('Placeholder unmatched task');
      expect(subagentIds(s)).toEqual(['agent-a2', 'agent-a3', 'agent-a4']);
      expect(s.warnings).toHaveLength(MAIN_WARNING_COUNT);
    });

    it("CC-55 puts a malformed Subagent line in the Subagent Session's warnings", async () => {
      const s = await main();

      const sub = toolCall(s, tid('AgentOne')).subagent;
      expect(sub?.session.warnings).toEqual([{ line: 3, reason: expect.any(String) }]);
      expect(warningLines(s)).not.toContain(3);
      expect(s.warnings).toHaveLength(MAIN_WARNING_COUNT);
    });

    it('CC-56 gives an empty unlinkedSubagents and no warning without a subagents folder', async () => {
      const s = await minimal();

      expect(s.unlinkedSubagents).toEqual([]);
      expect(s.warnings).toEqual([]);
    });
  });

  describe('deliberately ignored records', () => {
    it('CC-57 ignores every listed top-level type without output or warning', async () => {
      const s = await main();

      expectOnlyExpectedOutput(s);
    });

    it('CC-58 ignores every listed system subtype without output or warning', async () => {
      const s = await main();

      expectOnlyExpectedOutput(s);
    });

    it('CC-59 ignores every listed attachment type and never outputs the user email', async () => {
      const s = await main();

      expectOnlyExpectedOutput(s);
      expect(JSON.stringify(s)).not.toContain('user@example.com');
    });

    it('CC-47 adds nothing for an invoked_skills attachment', async () => {
      // Line 101 re-injects the supermatt:grilling body after compaction.
      const s = await main();

      expect(invocations(s).filter((i) => i.name === 'supermatt:grilling')).toHaveLength(1);
      expect(s.events.map((e) => e.timestamp)).not.toContain(ts(101));
      expect(s.warnings).toHaveLength(MAIN_WARNING_COUNT);
    });

    it('CC-48 adds nothing for a hook_additional_context attachment holding a Skill body', async () => {
      // Line 5 injects a "Base directory for this skill:" body for using-skills.
      const s = await main();

      expect(invocations(s).filter((i) => i.name.includes('using-skills'))).toEqual([]);
      expect(s.events.map((e) => e.timestamp)).not.toContain(ts(5));
      expect(s.warnings).toHaveLength(MAIN_WARNING_COUNT);
    });
  });

  describe('presence rule', () => {
    it('CC-60 sets every optional field to an empty array on the minimal Session', async () => {
      const s = await minimal();

      expect(s.skillsOffered).toEqual([]);
      expect(s.subagentsOffered).toEqual([]);
      expect(s.ruleFiles).toEqual([]);
      expect(s.skillInvocations).toEqual([]);
      expect(s.interrupts).toEqual([]);
      expect(s.toolDenials).toEqual([]);
      expect(s.compactions).toEqual([]);
      expect(s.warnings).toEqual([]);
      expect(s.unlinkedSubagents).toEqual([]);
    });

    it('CC-61 gives the minimal Session exactly one user and one assistant event', async () => {
      const s = await minimal();

      expect(s.sessionId).toBe(MIN_ID);
      expect(s.events).toEqual([
        { type: 'user', timestamp: ts(1), text: 'Placeholder minimal prompt.', meta: false },
        {
          type: 'assistant',
          timestamp: ts(2),
          text: 'Placeholder minimal answer.',
          model: 'claude-opus-5-5',
          usage: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 },
        },
      ]);
    });
  });

  describe('malformed lines', () => {
    // CC-bad: 1 prompt, 2 invalid JSON, 3 empty, 4 JSON array, 5 no type, 6 future-record,
    // 7 unknown attachment type, 8 unknown system subtype, 9 assistant with string content,
    // 10 answer, 11 tool_result with no matching call, 12 /clear.
    function warningsAt(s: Session, line: number) {
      return s.warnings.filter((w) => w.line === line);
    }

    it('CC-63 skips an empty line silently and keeps later line numbers', async () => {
      const s = await bad();

      expect(warningsAt(s, 3)).toEqual([]);
      expect(warningsAt(s, 4)).toHaveLength(1);
    });

    it('CC-65 warns once for a record with no type', async () => {
      const s = await bad();

      expect(warningsAt(s, 5)).toHaveLength(1);
    });

    it('CC-66 warns once for an unknown top-level type and names it', async () => {
      const s = await bad();

      const found = warningsAt(s, 6);
      expect(found).toHaveLength(1);
      expect(found[0]?.reason).toContain('unknown record type');
      expect(found[0]?.reason).toContain('future-record');
    });

    it('CC-67 warns once for an unknown attachment type', async () => {
      const s = await bad();

      expect(warningsAt(s, 7)).toHaveLength(1);
      expect(warningsAt(s, 7)[0]?.reason).toContain('unknown record type');
    });

    it('CC-68 warns once for an unknown system subtype', async () => {
      const s = await bad();

      expect(warningsAt(s, 8)).toHaveLength(1);
      expect(warningsAt(s, 8)[0]?.reason).toContain('unknown record type');
    });

    it('CC-70 warns once for assistant content that is not an array and drops the record', async () => {
      const s = await bad();

      expect(warningsAt(s, 9)).toHaveLength(1);
      expect(s.events.map((e) => e.timestamp)).not.toContain(ts(9));
      expect(JSON.stringify(s)).not.toContain('NON_ARRAY_CONTENT_MARKER');
    });

    it('CC-71 warns once for a tool_result that matches no call', async () => {
      const s = await bad();

      expect(warningsAt(s, 11)).toHaveLength(1);
      expect(JSON.stringify(s)).not.toContain('UNMATCHED_RESULT_MARKER');
    });

    it('CC-72 gives exactly one warning per malformed line and keeps the valid exchange', async () => {
      const s = await bad();

      expect(warningLines(s)).toEqual([2, 4, 5, 6, 7, 8, 9, 11]);
      expect(s.events).toEqual([
        {
          type: 'user',
          timestamp: ts(1),
          text: 'Placeholder prompt that names supermatt:tdd only in text.',
          meta: false,
        },
        {
          type: 'assistant',
          timestamp: ts(10),
          text: 'Placeholder answer that names supermatt:tdd only in text.',
          model: 'claude-opus-5-5',
          usage: { input: 5, output: 6, cacheRead: 7, cacheWrite: 8 },
        },
        {
          type: 'user',
          timestamp: ts(12),
          text:
            '<command-name>/clear</command-name>\n' +
            '            <command-message>clear</command-message>\n' +
            '            <command-args></command-args>',
          meta: false,
        },
      ]);
    });
  });

  describe('privacy, decoys, missing log', () => {
    const MARKERS = [
      'Placeholder',
      'INVALID_JSON_MARKER',
      'JSON_ARRAY_MARKER',
      'NO_TYPE_MARKER',
      'FUTURE_RECORD_MARKER',
      'UNKNOWN_ATTACHMENT_MARKER',
      'UNKNOWN_SUBTYPE_MARKER',
      'NON_ARRAY_CONTENT_MARKER',
      'UNMATCHED_RESULT_MARKER',
      'SUBAGENT_BROKEN_MARKER',
      'supermatt',
      'toolu_',
      '/home/user',
    ];

    it('CC-73 keeps Session text out of every warning reason', async () => {
      const sessions = [await bad(), await main()];
      const sub = toolCall(sessions[1] as Session, tid('AgentOne')).subagent?.session;
      const reasons = [...sessions, ...(sub ? [sub] : [])].flatMap((s) =>
        s.warnings.map((w) => w.reason),
      );

      expect(reasons.length).toBeGreaterThan(0);
      for (const reason of reasons) {
        for (const marker of MARKERS) {
          expect(reason).not.toContain(marker);
        }
      }
    });

    it('CC-74 never reads <uuid>/tool-results/', async () => {
      const s = await main();

      expect(JSON.stringify(s)).not.toContain('DECOY_TOOL_RESULTS_MARKER');
    });

    it('CC-75 rejects for a missing main log with the path and ENOENT only', async () => {
      const path = join(projectDir, '99999999-9999-4999-8999-999999999999.jsonl');

      const error: unknown = await readClaudeCodeSession(path).then(
        () => undefined,
        (e: unknown) => e,
      );

      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;
      expect(message).toContain(path);
      expect(message).toContain('ENOENT');
      expect(message).not.toContain('Placeholder');
    });

    it('CC-76 warns for a meta.json whose log is missing and does not list it', async () => {
      const s = await main();

      expect(subagentIds(s)).not.toContain('agent-a5');
      expect(toolCall(s, tid('AgentOne')).subagent?.session.sessionId).toBe('agent-a1');
      expect(s.warnings).toHaveLength(MAIN_WARNING_COUNT);
    });
  });
});
