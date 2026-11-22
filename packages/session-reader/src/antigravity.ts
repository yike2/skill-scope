import { readdir, readFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import { readJsonl } from './jsonl.js';
import type { JsonlRecord } from './jsonl.js';
import type {
  AssistantEvent,
  Compaction,
  Session,
  SessionEvent,
  SkillInvocation,
  SubagentSession,
  ToolCallEvent,
  Warning,
} from './session.js';

type Rec = Record<string, unknown>;

// `.../skills/<name>/SKILL.md`, with / or \ separators.
const SKILL_PATH = /[\\/]skills[\\/]([^\\/\s'"]+)[\\/]SKILL\.md$/;
const SHELL_SKILL_READ =
  /^(?:cat|head|tail|less|more|bat|sed|type|Get-Content)\s[^>]*[\\/]skills[\\/]([^\\/\s'"]+)[\\/]SKILL\.md(?=$|[\s'"])/;

function isRec(value: unknown): value is Rec {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function num(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}

function errorCode(error: unknown): string {
  return isRec(error) && typeof error.code === 'string' ? error.code : 'unknown error';
}

// The reason may name the record type, but only when it looks like a type name.
function unknownType(name: string): string {
  return /^[\w.:/-]{1,80}$/.test(name) ? `unknown record type: ${name}` : 'unknown record type';
}

// The Skill a tool call reads, if it is a read of `.../skills/<name>/SKILL.md`.
function skillRead(call: ToolCallEvent): string | undefined {
  if (!isRec(call.input)) return undefined;
  if (call.name === 'read_file') return SKILL_PATH.exec(str(call.input.Path) ?? '')?.[1];
  if (call.name === 'run_command') {
    return SHELL_SKILL_READ.exec((str(call.input.CommandLine) ?? '').trim())?.[1];
  }
  return undefined;
}

function userText(content: string): string {
  const request = /<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/.exec(content)?.[1];
  return (request ?? content).trim();
}

function parse(entries: (JsonlRecord | Warning)[], sessionId: string): Session {
  const events: SessionEvent[] = [];
  const warnings: Warning[] = [];
  const invocations: SkillInvocation[] = [];
  const compactions: Compaction[] = [];
  // Calls of the latest PLANNER_RESPONSE still waiting for their GENERIC result.
  let pending: ToolCallEvent[] = [];
  // A typed /<name> waiting for a read of that Skill's SKILL.md.
  let slash: string | undefined;

  for (const entry of entries) {
    if (!('record' in entry)) {
      warnings.push(entry);
      continue;
    }
    const { line, record } = entry;
    const timestamp = str(record.created_at) ?? '';
    const content = str(record.content);
    const type = str(record.type);

    if (type === 'USER_INPUT') {
      const text = userText(content ?? '');
      pending = [];
      slash = /^\/(\S+)/.exec(text)?.[1];
      events.push({ type: 'user', timestamp, text, meta: false });
    } else if (type === 'SYSTEM_MESSAGE') {
      events.push({ type: 'user', timestamp, text: content ?? '', meta: true });
    } else if (type === 'PLANNER_RESPONSE') {
      const response: AssistantEvent = { type: 'assistant', timestamp, text: content ?? '' };
      const thinking = str(record.thinking);
      if (thinking) response.thinking = thinking;
      const model = str(record.model);
      if (model !== undefined) response.model = model;
      if (typeof record.input_tokens === 'number' || typeof record.output_tokens === 'number') {
        response.usage = { input: num(record.input_tokens), output: num(record.output_tokens) };
        if (typeof record.cache_read_tokens === 'number') {
          response.usage.cacheRead = record.cache_read_tokens;
        }
      }
      events.push(response);
      pending = [];
      const calls = Array.isArray(record.tool_calls) ? record.tool_calls : [];
      calls.forEach((raw, n) => {
        const spec = isRec(raw) ? raw : {};
        const call: ToolCallEvent = {
          type: 'tool_call',
          timestamp,
          id: `${line}:${n}`,
          name: str(spec.name) ?? '',
          input: spec.args,
        };
        events.push(call);
        pending.push(call);
        const skill = skillRead(call);
        if (skill === undefined) return;
        invocations.push({
          name: skill,
          source: skill === slash ? 'user' : 'unknown',
          timestamp,
          eventIndex: events.length - 1,
          toolCallId: call.id,
        });
        if (skill === slash) slash = undefined;
      });
    } else if (type === 'GENERIC') {
      const call = pending.shift();
      if (!call) {
        warnings.push({ line, reason: 'tool result with no pending tool call' });
        continue;
      }
      call.result = { timestamp, output: content ?? '', isError: record.status === 'ERROR' };
    } else if (type === 'CHECKPOINT') {
      compactions.push(
        content === undefined
          ? { timestamp, eventIndex: events.length }
          : { timestamp, eventIndex: events.length, summary: content },
      );
    } else {
      warnings.push({
        line,
        reason: type === undefined ? 'record has no type' : unknownType(type),
      });
    }
  }

  return {
    agent: 'antigravity',
    sessionId,
    metadata: {},
    events,
    unlinkedSubagents: [],
    warnings,
    skillInvocations: invocations,
    compactions,
  };
}

// Links each child listed in <dir>/.system_generated/subagents/ to the first invoke_subagent call
// whose result names it; the child's log sits in its own sibling brain dir.
// `reading` holds the brain dir names of this Session and its parents.
async function readSubagents(session: Session, dir: string, reading: Set<string>): Promise<void> {
  const folder = join(dir, '.system_generated', 'subagents');
  let names: string[];
  try {
    names = (await readdir(folder)).filter((n) => n.endsWith('.json')).sort();
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') {
      session.warnings.push({ reason: 'cannot read subagents folder' });
    }
    return;
  }

  for (const name of names) {
    // A plain id only, and never a Session already being read, so the reader stays inside the
    // brain folder and cannot loop.
    const childId = basename(name, '.json');
    if (!/^[\w-]+$/.test(childId) || reading.has(childId)) {
      session.warnings.push({ reason: 'Subagent file with an invalid child id' });
      continue;
    }
    let meta: unknown;
    try {
      meta = JSON.parse(await readFile(join(folder, name), 'utf8'));
    } catch {
      session.warnings.push({ reason: 'cannot read Subagent file' });
      continue;
    }
    let child: Session;
    try {
      child = await readSession(join(dirname(dir), childId), reading);
    } catch {
      session.warnings.push({ reason: 'cannot read Subagent log' });
      continue;
    }
    const subagent: SubagentSession = { session: child };
    const descriptor = isRec(meta) && isRec(meta.subagentDescriptor) ? meta.subagentDescriptor : {};
    const subagentType = str(descriptor.typeName);
    const description = str(descriptor.role);
    if (subagentType !== undefined) subagent.subagentType = subagentType;
    if (description !== undefined) subagent.description = description;

    const marker = `"conversationId": "${childId}"`;
    const call = session.events.find(
      (e): e is ToolCallEvent =>
        e.type === 'tool_call' &&
        e.name === 'invoke_subagent' &&
        (e.result?.output.includes(marker) ?? false),
    );
    if (call) {
      call.subagent = subagent;
    } else {
      session.unlinkedSubagents.push(subagent);
      session.warnings.push({ reason: 'Subagent tool call not found' });
    }
  }
}

// dir = the Session's brain dir, ~/.gemini/antigravity/brain/<uuid>. Rejects only when its
// transcript_full.jsonl cannot be read; the message names the path and the error code.
export function readAntigravitySession(dir: string): Promise<Session> {
  return readSession(dir, new Set());
}

async function readSession(dir: string, parents: Set<string>): Promise<Session> {
  const path = join(dir, '.system_generated', 'logs', 'transcript_full.jsonl');
  let entries: (JsonlRecord | Warning)[];
  try {
    entries = await readJsonl(path);
  } catch (error) {
    throw new Error(`cannot read Session log ${path}: ${errorCode(error)}`, { cause: error });
  }
  const session = parse(entries, basename(dir));
  await readSubagents(session, dir, new Set([...parents, basename(dir)]));
  return session;
}
