import { readdir, readFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import { readJsonl } from './jsonl.js';
import type { JsonlRecord } from './jsonl.js';
import type {
  AssistantEvent,
  Compaction,
  Interrupt,
  OfferedItem,
  RuleFileLoad,
  Session,
  SessionEvent,
  SessionMetadata,
  SkillInvocation,
  SubagentSession,
  TokenUsage,
  ToolCallEvent,
  ToolDenial,
  Warning,
} from './session.js';

type Rec = Record<string, unknown>;

const IGNORED_TYPES = new Set([
  'api-request',
  'api-request-blob',
  'api-request-shape',
  'queue-operation',
  'last-prompt',
  'session-owner',
  'atis-latch',
  'ai-title',
  'mode',
  'permission-mode',
  'file-history-snapshot',
  'file-history-delta',
  'cost-state',
  'tools-used',
  'pr-link',
  'frame-link',
  'artifact-autoreact-ledger',
  'artifact-comment-monitor',
]);

const IGNORED_SYSTEM_SUBTYPES = new Set([
  'informational',
  'turn_duration',
  'away_summary',
  'local_command',
]);

const IGNORED_ATTACHMENTS = new Set([
  'deferred_tools_record',
  'deferred_tools_delta',
  'environment',
  'queued_command',
  'prompt_snapshot',
  'edited_text_file',
  'date',
  'model',
  'credential_org',
  'session_context',
  'remote_session_change',
  'auto_mode',
  'silent_turn_reminder',
  'file',
  'command_permissions',
  'mcp_instructions_delta',
  'total_tokens_reminder',
  'compact_file_reference',
  'thinking_drop',
  'invoked_skills',
  'hook_additional_context',
  'hook_success',
  'task_status',
  'directory',
  'plan_mode_exit',
  'at_mention_reference',
]);

const INTERRUPTS = new Set([
  '[Request interrupted by user]',
  '[Request interrupted by user for tool use]',
]);

const SKILL_BODY_PREFIX = 'Base directory for this skill:';

function isRec(value: unknown): value is Rec {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function num(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function errorCode(error: unknown): string {
  return isRec(error) && typeof error.code === 'string' ? error.code : 'unknown error';
}

// The reason may name the record type, but only when it looks like a type name.
function unknownType(name: string): string {
  return /^[\w.:/-]{1,80}$/.test(name) ? `unknown record type: ${name}` : 'unknown record type';
}

function append(current: string | undefined, text: string): string {
  return current ? `${current}\n${text}` : text;
}

function usageOf(value: unknown): TokenUsage | undefined {
  if (!isRec(value)) return undefined;
  const usage: TokenUsage = { input: num(value.input_tokens), output: num(value.output_tokens) };
  if (typeof value.cache_read_input_tokens === 'number') {
    usage.cacheRead = value.cache_read_input_tokens;
  }
  if (typeof value.cache_creation_input_tokens === 'number') {
    usage.cacheWrite = value.cache_creation_input_tokens;
  }
  return usage;
}

function resultOutput(content: unknown): string {
  if (typeof content === 'string') return content;
  return list(content)
    .map((block) => (isRec(block) && block.type === 'text' ? (str(block.text) ?? '') : '[image]'))
    .join('\n');
}

// Adds each named item once; `lines` holds "- name: description".
function offer(items: OfferedItem[], names: unknown[], lines: string[]): void {
  for (const name of names) {
    if (typeof name !== 'string' || items.some((i) => i.name === name)) continue;
    const prefix = `- ${name}: `;
    const line = lines.find((l) => l.startsWith(prefix));
    items.push(line === undefined ? { name } : { name, description: line.slice(prefix.length) });
  }
}

function parse(entries: (JsonlRecord | Warning)[], sessionId: string): Session {
  const metadata: SessionMetadata = {};
  const events: SessionEvent[] = [];
  const warnings: Warning[] = [];
  const skillsOffered: OfferedItem[] = [];
  let subagentsOffered: OfferedItem[] = [];
  const ruleFiles: RuleFileLoad[] = [];
  const invocations: SkillInvocation[] = [];
  const interrupts: Interrupt[] = [];
  const denials: ToolDenial[] = [];
  const compactions: Compaction[] = [];

  const responses = new Map<string, AssistantEvent>();
  const calls = new Map<string, ToolCallEvent>();
  // Skills named in the prompt (skill_mention) since the last typed user event.
  const mentions = new Set<string>();
  // A typed /<name> command waiting for its Skill body.
  let command: { name: string; timestamp: string; eventIndex: number } | undefined;

  for (const entry of entries) {
    if (!('record' in entry)) {
      warnings.push(entry);
      continue;
    }
    const { line, record } = entry;
    metadata.cwd ??= str(record.cwd);
    metadata.gitBranch ??= str(record.gitBranch);
    metadata.agentVersion ??= str(record.version);
    const timestamp = str(record.timestamp) ?? '';
    const type = str(record.type);

    if (type === undefined) {
      warnings.push({ line, reason: 'record has no type' });
    } else if (type === 'user') {
      const message = isRec(record.message) ? record.message : {};
      const content = message.content;
      const texts: string[] = [];
      if (typeof content === 'string') {
        texts.push(content);
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (!isRec(block)) continue;
          if (block.type === 'text' && typeof block.text === 'string') texts.push(block.text);
          if (block.type !== 'tool_result') continue;
          const id = str(block.tool_use_id);
          const call = id === undefined ? undefined : calls.get(id);
          if (id === undefined || !call) {
            warnings.push({ line, reason: 'tool result matches no tool call' });
            continue;
          }
          call.result = {
            timestamp,
            output: resultOutput(block.content),
            isError: block.is_error === true,
          };
          const kind = str(record.toolDenialKind);
          if (kind !== undefined) denials.push({ toolCallId: id, kind, timestamp });
        }
      } else {
        warnings.push({ line, reason: 'user record has no content' });
      }
      if (texts.length === 0) continue;
      const text = texts.join('\n');

      if (record.isCompactSummary === true) {
        const last = compactions.at(-1);
        if (last) last.summary = text;
        continue;
      }
      if (INTERRUPTS.has(text)) {
        interrupts.push({ timestamp, eventIndex: events.length });
        continue;
      }
      const meta = record.isMeta === true;
      if (meta) {
        if (command && text.startsWith(SKILL_BODY_PREFIX) && record.sourceToolUseID === undefined) {
          invocations.push({ ...command, source: 'user' });
          command = undefined;
        }
      } else {
        mentions.clear();
        const name = /<command-name>\/([^<]+)<\/command-name>/.exec(text)?.[1];
        command = name === undefined ? undefined : { name, timestamp, eventIndex: events.length };
      }
      events.push({ type: 'user', timestamp, text, meta });
    } else if (type === 'assistant') {
      const message = isRec(record.message) ? record.message : {};
      if (!Array.isArray(message.content)) {
        warnings.push({ line, reason: 'assistant content is not a list' });
        continue;
      }
      const id = str(message.id);
      let response = id === undefined ? undefined : responses.get(id);
      if (!response) {
        response = { type: 'assistant', timestamp, text: '' };
        const model = str(message.model);
        if (model !== undefined) response.model = model;
        const usage = usageOf(message.usage);
        if (usage) response.usage = usage;
        events.push(response);
        if (id !== undefined) responses.set(id, response);
      }
      for (const block of message.content) {
        if (!isRec(block)) continue;
        if (block.type === 'text' && typeof block.text === 'string') {
          response.text = append(response.text, block.text);
        } else if (block.type === 'thinking' && typeof block.thinking === 'string') {
          if (block.thinking !== '') response.thinking = append(response.thinking, block.thinking);
        } else if (block.type === 'tool_use') {
          const id = str(block.id);
          const call: ToolCallEvent = {
            type: 'tool_call',
            timestamp,
            id: id ?? '',
            name: str(block.name) ?? '',
            input: block.input,
          };
          events.push(call);
          if (id !== undefined) calls.set(id, call);
          const skill = isRec(block.input) ? str(block.input.skill) : undefined;
          if (call.name === 'Skill' && skill !== undefined) {
            invocations.push({
              name: skill,
              source: mentions.has(skill) ? 'user' : 'model',
              timestamp,
              eventIndex: events.length - 1,
              toolCallId: call.id,
            });
          }
        }
      }
    } else if (type === 'system') {
      const subtype = str(record.subtype) ?? '';
      if (subtype === 'compact_boundary') {
        const trigger = isRec(record.compactMetadata)
          ? str(record.compactMetadata.trigger)
          : undefined;
        compactions.push(
          trigger === undefined
            ? { timestamp, eventIndex: events.length }
            : { timestamp, eventIndex: events.length, trigger },
        );
      } else if (!IGNORED_SYSTEM_SUBTYPES.has(subtype)) {
        warnings.push({ line, reason: unknownType(`system/${subtype}`) });
      }
    } else if (type === 'attachment') {
      const attachment = isRec(record.attachment) ? record.attachment : {};
      const kind = str(attachment.type) ?? '';
      if (kind === 'skill_listing') {
        offer(skillsOffered, list(attachment.names), (str(attachment.content) ?? '').split('\n'));
      } else if (kind === 'agent_listing_delta') {
        const lines = list(attachment.addedLines).filter((l) => typeof l === 'string');
        offer(subagentsOffered, list(attachment.addedTypes), lines);
        const removed = list(attachment.removedTypes);
        subagentsOffered = subagentsOffered.filter((i) => !removed.includes(i.name));
      } else if (kind === 'instructions') {
        for (const file of list(attachment.files)) {
          if (!isRec(file)) continue;
          const fileKind = str(file.type);
          ruleFiles.push({
            path: str(file.path) ?? '',
            ...(fileKind === undefined ? {} : { kind: fileKind }),
            content: str(file.content) ?? '',
            timestamp,
            eventIndex: events.length,
          });
        }
      } else if (kind === 'skill_mention') {
        const name = str(attachment.skillName);
        if (name !== undefined) mentions.add(name);
      } else if (!IGNORED_ATTACHMENTS.has(kind)) {
        warnings.push({ line, reason: unknownType(`attachment/${kind}`) });
      }
    } else if (!IGNORED_TYPES.has(type)) {
      warnings.push({ line, reason: unknownType(type) });
    }
  }

  return {
    agent: 'claude-code',
    sessionId,
    metadata,
    events,
    unlinkedSubagents: [],
    warnings,
    skillsOffered,
    subagentsOffered,
    ruleFiles,
    skillInvocations: invocations,
    interrupts,
    toolDenials: denials,
    compactions,
  };
}

async function readMeta(path: string): Promise<Rec | undefined> {
  try {
    const value: unknown = JSON.parse(await readFile(path, 'utf8'));
    return isRec(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

// Links each <uuid>/subagents/agent-<id>.jsonl to the tool call named by its meta.toolUseId.
async function readSubagents(session: Session, dir: string): Promise<void> {
  let names: string[];
  try {
    names = (await readdir(dir)).sort();
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') {
      session.warnings.push({ reason: 'cannot read subagents folder' });
    }
    return;
  }
  const calls = new Map<string, ToolCallEvent>();
  for (const e of session.events) if (e.type === 'tool_call') calls.set(e.id, e);

  for (const name of names) {
    if (name.endsWith('.meta.json') && !names.includes(name.replace(/\.meta\.json$/, '.jsonl'))) {
      session.warnings.push({ reason: 'Subagent meta file has no log' });
    }
    if (!name.endsWith('.jsonl')) continue;
    let sub: Session;
    try {
      sub = await readClaudeCodeSession(join(dir, name));
    } catch {
      session.warnings.push({ reason: 'cannot read Subagent log' });
      continue;
    }
    const meta = await readMeta(join(dir, name.replace(/\.jsonl$/, '.meta.json')));
    const subagent: SubagentSession = { session: sub };
    const subagentType = str(meta?.agentType);
    const description = str(meta?.description);
    if (subagentType !== undefined) subagent.subagentType = subagentType;
    if (description !== undefined) subagent.description = description;

    const toolUseId = str(meta?.toolUseId);
    const call = toolUseId === undefined ? undefined : calls.get(toolUseId);
    if (call) {
      call.subagent = subagent;
      continue;
    }
    session.unlinkedSubagents.push(subagent);
    session.warnings.push({
      reason: !meta
        ? 'Subagent has no readable meta file'
        : toolUseId === undefined
          ? 'Subagent meta has no toolUseId'
          : 'Subagent tool call not found',
    });
  }
}

// path = the main log, ~/.claude/projects/<slug>/<uuid>.jsonl. Rejects only when that log cannot
// be read; the message names the path and the error code.
export async function readClaudeCodeSession(path: string): Promise<Session> {
  let entries: (JsonlRecord | Warning)[];
  try {
    entries = await readJsonl(path);
  } catch (error) {
    throw new Error(`cannot read Session log ${path}: ${errorCode(error)}`, { cause: error });
  }
  const sessionId = basename(path, '.jsonl');
  const session = parse(entries, sessionId);
  await readSubagents(session, join(dirname(path), sessionId, 'subagents'));
  return session;
}
