import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { readAntigravitySession } from './antigravity.js';
import type { AssistantEvent, Session, SessionEvent, ToolCallEvent, UserEvent } from './session.js';

// Temp dirs the tests create; removed after each test.
const roots: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

afterEach(() => Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true }))));

// Fixtures: fixtures/antigravity/brain/. Every record's created_at is 2026-11-15T06:00:00Z plus
// its 1-based line number in seconds, so ts(line) below names the record a value must come from.
const brainDir = fileURLToPath(new URL('../fixtures/antigravity/brain/', import.meta.url));
const PARENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CHILD = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MISSING = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const BAD = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const UNLINKED = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const NO_LOG = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

function ts(line: number): string {
  return new Date(Date.UTC(2026, 10, 15, 6, 0, 0) + line * 1000).toISOString().replace('.000', '');
}

// The "Created At / Completed At" header every GENERIC content in the fixtures starts with.
function stamp(line: number): string {
  const s = String(line).padStart(2, '0');
  return `Created At: 2026-11-15T07:00:${s}+01:00\nCompleted At: 2026-11-15T07:00:${s}+01:00\n`;
}

function once(dir: string): () => Promise<Session> {
  let cached: Promise<Session> | undefined;
  return () => (cached ??= readAntigravitySession(dir));
}

const parent = once(join(brainDir, PARENT));
const child = once(join(brainDir, CHILD));
const bad = once(join(brainDir, BAD));

// Expected events of the parent Session: [kind, line of the record that creates it].
// u = typed user event, m = meta user event, a = assistant event, t = tool call event.
const PARENT_EVENTS: [string, number][] = [
  ['u', 1],
  ['a', 2],
  ['t', 2],
  ['t', 2],
  ['t', 2],
  ['a', 6],
  ['t', 6],
  ['t', 6],
  ['m', 9],
  ['a', 10],
  ['t', 10],
  ['a', 12],
  ['t', 12],
  ['a', 14],
  ['t', 14],
  ['a', 16],
  ['u', 18],
  ['a', 19],
  ['t', 19],
  ['t', 19],
  ['a', 22],
  ['t', 22],
  ['t', 22],
  ['t', 22],
  ['t', 22],
  ['a', 27],
  ['u', 28],
  ['a', 29],
  ['t', 29],
  ['a', 31],
  ['u', 32],
  ['a', 33],
  ['t', 33],
  ['u', 34],
  ['a', 35],
];

// The parent's only warnings are the two file-level Subagent ones: cccccccc (child brain dir
// missing) and eeeeeeee (no invoke_subagent result names it).
const PARENT_WARNING_COUNT = 2;

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

function toolCalls(s: Session): ToolCallEvent[] {
  return s.events.filter((e): e is ToolCallEvent => e.type === 'tool_call');
}

function toolCall(s: Session, id: string): ToolCallEvent {
  const e = toolCalls(s).find((x) => x.id === id);
  if (!e) throw new Error(`no tool call ${id}`);
  return e;
}

function invocations(s: Session) {
  return s.skillInvocations ?? [];
}

function warningsAt(s: Session, line: number) {
  return s.warnings.filter((w) => w.line === line);
}

describe('readAntigravitySession', () => {
  describe('required fields, metadata, presence', () => {
    it('AG-01 sets agent and the brain dir name as sessionId', async () => {
      const s = await parent();

      expect(s.agent).toBe('antigravity');
      expect(s.sessionId).toBe(PARENT);
    });

    it('AG-02 leaves metadata empty', async () => {
      const s = await parent();

      expect(s.metadata).toEqual({});
      expect(Object.keys(s.metadata)).toEqual([]);
    });

    it('AG-03 sets skillInvocations and compactions and leaves the other optional fields absent', async () => {
      const s = await parent();

      expect('skillInvocations' in s).toBe(true);
      expect('compactions' in s).toBe(true);
      expect('skillsOffered' in s).toBe(false);
      expect('subagentsOffered' in s).toBe(false);
      expect('ruleFiles' in s).toBe(false);
      expect('interrupts' in s).toBe(false);
      expect('toolDenials' in s).toBe(false);
    });

    it('AG-04 sets skillInvocations and compactions to [] when the log has none', async () => {
      const s = await child();

      expect(s.skillInvocations).toEqual([]);
      expect(s.compactions).toEqual([]);
    });
  });

  describe('events', () => {
    it('AG-05 keeps only the <USER_REQUEST> text of a USER_INPUT', async () => {
      const s = await parent();

      const e = userAt(s, 0);
      expect(e.meta).toBe(false);
      expect(e.timestamp).toBe(ts(1));
      expect(e.text).toBe('Placeholder request one.');
      expect(e.text).not.toContain('METADATA_PATH_MARKER');
      expect(e.text).not.toContain('SETTINGS_CHANGE_MARKER');
      expect(e.text).not.toContain('USER_REQUEST');
    });

    it('AG-06 keeps the whole content of a USER_INPUT without <USER_REQUEST>', async () => {
      const s = await parent();

      expect(eventAt(s, 33)).toEqual({
        type: 'user',
        timestamp: ts(34),
        text: 'Placeholder plain input.',
        meta: false,
      });
    });

    it('AG-07 maps a SYSTEM_MESSAGE to a meta UserEvent', async () => {
      const s = await parent();

      const e = userAt(s, 8);
      expect(e.meta).toBe(true);
      expect(e.timestamp).toBe(ts(9));
      expect(e.text).toContain('Placeholder status update.');
    });

    it('AG-08 maps a PLANNER_RESPONSE with content, thinking, model and usage', async () => {
      const s = await parent();

      const e = assistantAt(s, 15);
      expect(e).toEqual({
        type: 'assistant',
        timestamp: ts(16),
        text: 'Placeholder answer one.',
        thinking: 'Placeholder thinking one.',
        model: 'gemini-4-argon-medium',
        usage: { input: 2495, output: 298, cacheRead: 28043 },
      });
      expect(e.usage && 'cacheWrite' in e.usage).toBe(false);
    });

    it('AG-09 leaves model absent when the PLANNER_RESPONSE has none', async () => {
      const s = await parent();

      const e = assistantAt(s, 11);
      expect(e.timestamp).toBe(ts(12));
      expect('model' in e).toBe(false);
    });

    it("AG-10 gives a PLANNER_RESPONSE with tool calls and no content text ''", async () => {
      const s = await parent();

      expect(assistantAt(s, 1).text).toBe('');
    });

    it('AG-11 keeps log order, created_at timestamps, and adds no event for GENERIC', async () => {
      const s = await parent();

      expect(s.events.map((e) => [kind(e), e.timestamp])).toEqual(
        PARENT_EVENTS.map(([k, line]) => [k, ts(line)]),
      );
    });
  });

  describe('tool calls and results', () => {
    it('AG-12 gives tool calls the id <line>:<n>, their name, and args as input', async () => {
      const s = await parent();

      expect(s.events.slice(2, 5).map((e) => e.type === 'tool_call' && e.input)).toEqual([
        { Path: '/home/user/example/a.md' },
        { Path: '/home/user/example/b.md' },
        { Path: '/home/user/example/c.md' },
      ]);
      expect(s.events.slice(2, 5)).toMatchObject([
        {
          type: 'tool_call',
          id: '2:0',
          name: 'read_file',
        },
        {
          type: 'tool_call',
          id: '2:1',
          name: 'read_file',
        },
        {
          type: 'tool_call',
          id: '2:2',
          name: 'read_file',
        },
      ]);
    });

    it('AG-13 keeps tool call ids unique when two responses share a step_index', async () => {
      // Lines 10 and 12 both have step_index 9.
      const s = await parent();

      const ids = toolCalls(s).map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(toolCall(s, '10:0').name).toBe('send_message');
      expect(toolCall(s, '12:0').name).toBe('run_command');
    });

    it('AG-14 matches GENERIC results to parallel calls in order', async () => {
      const s = await parent();

      for (const [n, file] of ['a', 'b', 'c'].entries()) {
        const line = 3 + n;
        expect(toolCall(s, `2:${n}`).result).toEqual({
          timestamp: ts(line),
          output: `${stamp(line)}Placeholder content of ${file}.md.`,
          isError: false,
        });
      }
    });

    it('AG-15 maps status ERROR to isError and takes output from content only', async () => {
      const s = await parent();

      expect(toolCall(s, '12:0').result).toEqual({
        timestamp: ts(13),
        output: `${stamp(13)}Encountered error in step execution: placeholder error.`,
        isError: true,
      });
      expect(JSON.stringify(s)).not.toContain('ERROR_FIELD_MARKER');
    });

    it('AG-16 treats status RUNNING as a normal result without a warning', async () => {
      const s = await parent();

      expect(toolCall(s, '14:0').result).toEqual({
        timestamp: ts(15),
        output: `${stamp(15)}Tool is running as a background task with task id: placeholder-task.`,
        isError: false,
      });
      expect(s.warnings).toHaveLength(PARENT_WARNING_COUNT);
    });

    it('AG-18 leaves result absent for a call with no GENERIC before the next user input', async () => {
      const s = await parent();

      expect('result' in toolCall(s, '33:0')).toBe(false);
      expect(s.warnings).toHaveLength(PARENT_WARNING_COUNT);
    });
  });

  describe('compaction', () => {
    it('AG-19 records a CHECKPOINT as a compaction with its content, no trigger, no event', async () => {
      const s = await parent();

      expect(s.compactions).toEqual([
        {
          timestamp: ts(17),
          eventIndex: 16,
          summary: '# Resuming from a compaction\n\nPlaceholder compaction summary.',
        },
      ]);
      expect(s.compactions?.[0] && 'trigger' in s.compactions[0]).toBe(false);
      expect(s.events.map((e) => e.timestamp)).not.toContain(ts(17));
    });
  });

  describe('Skill invocations', () => {
    it('AG-20 records a read_file of .../skills/<name>/SKILL.md as unknown', async () => {
      const s = await parent();

      expect(invocations(s).filter((i) => i.toolCallId === '19:0')).toEqual([
        {
          name: 'antigravity_guide',
          source: 'unknown',
          timestamp: ts(19),
          eventIndex: 18,
          toolCallId: '19:0',
        },
      ]);
    });

    it('AG-21 does not count a read of another file inside a Skill folder', async () => {
      const s = await parent();

      expect(invocations(s).filter((i) => i.toolCallId === '19:1')).toEqual([]);
    });

    it('AG-22 records a run_command cat of SKILL.md as unknown', async () => {
      const s = await parent();

      expect(invocations(s).filter((i) => i.toolCallId === '22:0')).toEqual([
        {
          name: 'example-skill',
          source: 'unknown',
          timestamp: ts(22),
          eventIndex: 21,
          toolCallId: '22:0',
        },
      ]);
    });

    it('AG-38 records a run_command Get-Content of SKILL.md as unknown', async () => {
      const s = await parent();

      expect(invocations(s).filter((i) => i.toolCallId === '22:3')).toEqual([
        {
          name: 'example-skill',
          source: 'unknown',
          timestamp: ts(22),
          eventIndex: 24,
          toolCallId: '22:3',
        },
      ]);
    });

    it('AG-23 does not count ls of SKILL.md', async () => {
      const s = await parent();

      expect(invocations(s).filter((i) => i.toolCallId === '22:1')).toEqual([]);
    });

    it('AG-24 does not count grep over SKILL.md', async () => {
      const s = await parent();

      expect(invocations(s).filter((i) => i.toolCallId === '22:2')).toEqual([]);
    });

    it('AG-25 records /<name> followed by a read of its SKILL.md once, as user', async () => {
      const s = await parent();

      expect(invocations(s).filter((i) => i.toolCallId === '29:0')).toEqual([
        {
          name: 'example-skill',
          source: 'user',
          timestamp: ts(29),
          eventIndex: 28,
          toolCallId: '29:0',
        },
      ]);
      expect(invocations(s).map((i) => i.toolCallId)).toEqual(['19:0', '22:0', '22:3', '29:0']);
    });

    it('AG-26 adds no invocation for /<name> with no read before the next user input', async () => {
      const s = await parent();

      expect(invocations(s).filter((i) => i.name === 'other-skill')).toEqual([]);
    });
  });

  describe('Subagents', () => {
    it('AG-27 attaches the child to the invoke_subagent call whose result names it', async () => {
      const s = await parent();

      const sub = toolCall(s, '6:0').subagent;
      expect(sub?.subagentType).toBe('self');
      expect(sub?.description).toBe('Placeholder role B');
      expect(sub?.session.agent).toBe('antigravity');
      expect(sub?.session.sessionId).toBe(CHILD);
      expect(sub?.session.events.map((e) => [kind(e), e.timestamp])).toEqual([
        ['m', ts(1)],
        ['a', ts(2)],
        ['t', ts(2)],
        ['a', ts(4)],
      ]);
    });

    it('AG-28 does not link a child through a send_message result', async () => {
      const s = await parent();

      expect('subagent' in toolCall(s, '10:0')).toBe(false);
      expect(toolCalls(s).filter((c) => c.subagent)).toHaveLength(1);
    });

    it('AG-29 warns for a child whose brain dir is missing and does not list it', async () => {
      const s = await parent();

      expect('subagent' in toolCall(s, '6:1')).toBe(false);
      expect(s.unlinkedSubagents.map((u) => u.session.sessionId)).not.toContain(MISSING);
      expect(s.warnings).toHaveLength(PARENT_WARNING_COUNT);
    });

    it('AG-30 lists a child that no invoke_subagent result names as unlinked, with a warning', async () => {
      const s = await parent();

      expect(s.unlinkedSubagents).toHaveLength(1);
      const found = s.unlinkedSubagents[0];
      expect(found?.subagentType).toBe('self');
      expect(found?.description).toBe('Placeholder role E');
      expect(found?.session.sessionId).toBe(UNLINKED);
      expect(found?.session.events.map((e) => e.type)).toEqual(['user', 'assistant']);
      expect(s.warnings).toHaveLength(PARENT_WARNING_COUNT);
    });
  });

  describe('ignored and malformed', () => {
    // AG-bad: 1 USER_INPUT, 2 invalid JSON, 3 unknown type FUTURE_STEP, 4 GENERIC with no pending
    // call, 5 PLANNER_RESPONSE.
    it('AG-31 warns once for an invalid JSON line and parses the rest', async () => {
      const s = await bad();

      expect(warningsAt(s, 2)).toHaveLength(1);
      expect(s.events.map((e) => [kind(e), e.timestamp])).toEqual([
        ['u', ts(1)],
        ['a', ts(5)],
      ]);
    });

    it('AG-32 warns once for an unknown type, names it, and adds no event', async () => {
      const s = await bad();

      const found = warningsAt(s, 3);
      expect(found).toHaveLength(1);
      expect(found[0]?.reason).toContain('FUTURE_STEP');
      expect(s.events.map((e) => e.timestamp)).not.toContain(ts(3));
    });

    it('AG-33 warns once for a GENERIC with no pending call and drops its content', async () => {
      const s = await bad();

      expect(warningsAt(s, 4)).toHaveLength(1);
      expect(s.warnings.map((w) => w.line)).toEqual([2, 3, 4]);
      expect(JSON.stringify(s)).not.toContain('ORPHAN_GENERIC_MARKER');
    });
  });

  describe('privacy, decoys, missing log', () => {
    const MARKERS = [
      'Placeholder',
      'INVALID_JSON_MARKER',
      'UNKNOWN_TYPE_MARKER',
      'ORPHAN_GENERIC_MARKER',
      'METADATA_PATH_MARKER',
      'SETTINGS_CHANGE_MARKER',
      'ERROR_FIELD_MARKER',
      '/home/user',
      CHILD,
      MISSING,
      UNLINKED,
    ];

    it('AG-35 keeps Session text out of every warning reason', async () => {
      const reasons = [await parent(), await bad()].flatMap((s) => s.warnings.map((w) => w.reason));

      expect(reasons.length).toBeGreaterThan(0);
      for (const reason of reasons) {
        for (const marker of MARKERS) {
          expect(reason).not.toContain(marker);
        }
      }
    });

    it('AG-36 never reads logs/transcript.jsonl', async () => {
      const s = await parent();

      expect(JSON.stringify(s)).not.toContain('DECOY_TRUNCATED_TRANSCRIPT_MARKER');
    });

    it('AG-37 rejects for a brain dir without transcript_full.jsonl with the path and ENOENT only', async () => {
      // The brain dir exists and holds only a decoy transcript.jsonl.
      const dir = join(brainDir, NO_LOG);

      const error: unknown = await readAntigravitySession(dir).then(
        () => undefined,
        (e: unknown) => e,
      );

      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;
      expect(message).toContain(dir);
      expect(message).toContain('ENOENT');
      expect(message).not.toContain('Placeholder');
      expect(message).not.toContain('DECOY_NO_FULL_TRANSCRIPT_MARKER');
    });
  });

  describe('paths, shell writes and files found in review', () => {
    // These cases build their own brain folder in a temp dir: <root>/brain/<id>/.
    const asRoot = process.getuid?.() === 0;
    const A = '11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const B = '22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

    function record(line: number, type: string, extra: Record<string, unknown>): string {
      return JSON.stringify({
        step_index: line - 1,
        source: type === 'USER_INPUT' ? 'USER_EXPLICIT' : 'MODEL',
        type,
        status: 'DONE',
        created_at: ts(line),
        ...extra,
      });
    }

    const exchange = [
      record(1, 'USER_INPUT', {
        content: '<USER_REQUEST>\nPlaceholder temp request.\n</USER_REQUEST>',
      }),
      record(2, 'PLANNER_RESPONSE', {
        content: 'Placeholder temp answer.',
        input_tokens: 1,
        output_tokens: 2,
      }),
    ];

    async function writeLog(dir: string, lines: string[]): Promise<void> {
      const logs = join(dir, '.system_generated', 'logs');
      await mkdir(logs, { recursive: true });
      await writeFile(join(logs, 'transcript_full.jsonl'), lines.join('\n') + '\n');
    }

    async function tempBrain(
      lines: string[],
    ): Promise<{ root: string; dir: string; subagents: string }> {
      const root = await tempDir('session-reader-ag-');
      const dir = join(root, 'brain', A);
      await writeLog(dir, lines);
      const subagents = join(dir, '.system_generated', 'subagents');
      return { root, dir, subagents };
    }

    function childJson(id: string): string {
      return JSON.stringify({
        conversationId: id,
        subagentDescriptor: { typeName: 'self', role: 'Placeholder role' },
      });
    }

    it('AG-39 skips a subagents file whose child id is ".." with one warning', async () => {
      const { root, dir, subagents } = await tempBrain(exchange);
      await mkdir(subagents, { recursive: true });
      await writeFile(join(subagents, '...json'), childJson('..'));
      // What "<brain>/.." would resolve to: a log outside the brain folder.
      await writeLog(root, [
        record(1, 'USER_INPUT', {
          content: '<USER_REQUEST>\nOUTSIDE_BRAIN_MARKER\n</USER_REQUEST>',
        }),
      ]);

      const s = await readAntigravitySession(dir);

      expect(s.warnings).toEqual([{ reason: expect.any(String) }]);
      expect(s.unlinkedSubagents).toEqual([]);
      expect(JSON.stringify(s)).not.toContain('OUTSIDE_BRAIN_MARKER');
    });

    it('AG-40 skips a subagents file that names the Session itself with one warning', async () => {
      const { dir, subagents } = await tempBrain(exchange);
      await mkdir(subagents, { recursive: true });
      await writeFile(join(subagents, `${A}.json`), childJson(A));

      const s = await readAntigravitySession(dir);

      expect(s.warnings).toEqual([{ reason: expect.any(String) }]);
      expect(s.unlinkedSubagents).toEqual([]);
      expect(s.events.map((e) => e.type)).toEqual(['user', 'assistant']);
    }, 1000);

    it('AG-41 does not count a run_command that writes SKILL.md through a redirect', async () => {
      const { dir } = await tempBrain([
        exchange[0] as string,
        record(2, 'PLANNER_RESPONSE', {
          input_tokens: 1,
          output_tokens: 2,
          tool_calls: [
            {
              name: 'run_command',
              args: {
                CommandLine:
                  "cat > /home/user/.agents/skills/example-skill/SKILL.md <<'EOF'\nPlaceholder\nEOF",
                WaitMsBeforeAsync: 5000,
                toolSummary: 'Placeholder summary',
              },
            },
          ],
        }),
        record(3, 'GENERIC', { content: 'Placeholder command output.' }),
      ]);

      const s = await readAntigravitySession(dir);

      expect(toolCall(s, '2:0').name).toBe('run_command');
      expect(s.skillInvocations).toEqual([]);
    });

    it.skipIf(asRoot)('AG-42 warns once for an unreadable subagents folder', async () => {
      const { dir, subagents } = await tempBrain(exchange);
      await mkdir(subagents, { recursive: true });
      await writeFile(join(subagents, `${B}.json`), childJson(B));
      await chmod(subagents, 0o000);

      try {
        const s = await readAntigravitySession(dir);

        expect(s.warnings).toEqual([{ reason: expect.any(String) }]);
        expect(s.events.map((e) => e.type)).toEqual(['user', 'assistant']);
      } finally {
        await chmod(subagents, 0o755);
      }
    });

    it.skipIf(asRoot)('AG-43 warns once for an unreadable subagents/<id>.json', async () => {
      const { root, dir, subagents } = await tempBrain(exchange);
      await writeLog(join(root, 'brain', B), exchange);
      await mkdir(subagents, { recursive: true });
      const file = join(subagents, `${B}.json`);
      await writeFile(file, childJson(B));
      await chmod(file, 0o000);

      try {
        const s = await readAntigravitySession(dir);

        expect(s.warnings).toEqual([{ reason: expect.any(String) }]);
        expect(s.unlinkedSubagents).toEqual([]);
        expect(s.events.map((e) => e.type)).toEqual(['user', 'assistant']);
      } finally {
        await chmod(file, 0o644);
      }
    });

    it('AG-44 skips a child that names a Session already being read (A -> B -> A)', async () => {
      const created = [
        'Created the following subagent:',
        JSON.stringify({ conversationId: B }, null, 2),
      ].join('\n');
      const { root, dir, subagents } = await tempBrain([
        exchange[0] as string,
        record(2, 'PLANNER_RESPONSE', {
          input_tokens: 1,
          output_tokens: 2,
          tool_calls: [
            {
              name: 'invoke_subagent',
              args: { Prompt: 'Placeholder', Role: 'Placeholder role', TypeName: 'self' },
            },
          ],
        }),
        record(3, 'GENERIC', { content: created }),
      ]);
      await mkdir(subagents, { recursive: true });
      await writeFile(join(subagents, `${B}.json`), childJson(B));
      const childDir = join(root, 'brain', B);
      await writeLog(childDir, exchange);
      const childSubagents = join(childDir, '.system_generated', 'subagents');
      await mkdir(childSubagents, { recursive: true });
      await writeFile(join(childSubagents, `${A}.json`), childJson(A));

      const s = await readAntigravitySession(dir);

      expect(s.warnings).toEqual([]);
      expect(s.unlinkedSubagents).toEqual([]);
      const child = toolCall(s, '2:0').subagent?.session;
      expect(child?.sessionId).toBe(B);
      expect(child?.warnings).toHaveLength(1);
      expect(child?.warnings[0]).toEqual({ reason: expect.any(String) });
      expect(child?.warnings[0]?.reason).not.toContain(A);
      expect(child?.unlinkedSubagents).toEqual([]);
      expect(child?.events.filter((e) => e.type === 'tool_call' && e.subagent)).toEqual([]);
    }, 1000);
  });
});
