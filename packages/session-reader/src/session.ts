// The agent-independent Session a Session Reader returns.
//
// Optional fields: absent = this agent does not record it; empty array = the agent records it and
// none happened. Presence depends on the agent, never on the file's contents.

export interface Session {
  agent: 'claude-code' | 'antigravity';
  /** File stem (Claude Code) or brain dir name (Antigravity). */
  sessionId: string;
  metadata: SessionMetadata;
  /** In log order. */
  events: SessionEvent[];
  /** Subagent logs with no spawning call found. */
  unlinkedSubagents: SubagentSession[];
  /** This Session's own log only. */
  warnings: Warning[];

  skillsOffered?: OfferedItem[];
  subagentsOffered?: OfferedItem[];
  ruleFiles?: RuleFileLoad[];
  skillInvocations?: SkillInvocation[];
  interrupts?: Interrupt[];
  toolDenials?: ToolDenial[];
  compactions?: Compaction[];
}

export interface SessionMetadata {
  cwd?: string;
  gitBranch?: string;
  agentVersion?: string;
}

export type SessionEvent = UserEvent | AssistantEvent | ToolCallEvent;

export interface UserEvent {
  type: 'user';
  timestamp: string;
  text: string;
  /** true = injected by the agent (Skill body, system reminder, Subagent message), false = typed. */
  meta: boolean;
}

/** One per model response. */
export interface AssistantEvent {
  type: 'assistant';
  timestamp: string;
  /** '' when the response only made tool calls. */
  text: string;
  /** Only when the log holds non-empty thinking text. */
  thinking?: string;
  model?: string;
  usage?: TokenUsage;
}

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export interface ToolCallEvent {
  type: 'tool_call';
  timestamp: string;
  id: string;
  name: string;
  input: unknown;
  /** Absent = no result in the log. */
  result?: ToolResult;
  /** Set on the call that spawned it. */
  subagent?: SubagentSession;
}

export interface ToolResult {
  timestamp: string;
  /** Text blocks joined with '\n'; non-text blocks become '[image]'. */
  output: string;
  isError: boolean;
}

export interface SubagentSession {
  subagentType?: string;
  description?: string;
  session: Session;
}

export interface OfferedItem {
  name: string;
  description?: string;
}

export interface RuleFileLoad {
  path: string;
  /** The agent's own label, e.g. Claude Code 'Project', 'AutoMem'. */
  kind?: string;
  content: string;
  timestamp: string;
  /** Number of events before it. */
  eventIndex: number;
}

export interface SkillInvocation {
  name: string;
  source: 'user' | 'model' | 'unknown';
  timestamp: string;
  eventIndex: number;
  toolCallId?: string;
}

export interface Interrupt {
  timestamp: string;
  eventIndex: number;
}

export interface ToolDenial {
  toolCallId: string;
  /** As recorded, e.g. 'user-rejected', 'interrupted'. */
  kind: string;
  timestamp: string;
}

export interface Compaction {
  timestamp: string;
  eventIndex: number;
  trigger?: string;
  summary?: string;
}

/** `line` is omitted for file-level warnings. `reason` never contains Session content. */
export interface Warning {
  line?: number;
  reason: string;
}
