// ============================================================
// ShadowForge — Shared Types & Interfaces
// All modules import from here to maintain consistency.
// ============================================================

// ─── TrueForge Event Types ──────────────────────────────────

export type TFEventType =
  | 'text-delta'
  | 'tool-call'
  | 'tool-result'
  | 'approval-required'
  | 'turn-complete'
  | 'turn-cancelled'
  | 'error'
  | 'compaction'
  | 'subagent-start'
  | 'subagent-complete';

export interface TFTextDeltaEvent {
  type: 'text-delta';
  delta: string;
}

export interface TFToolCallEvent {
  type: 'tool-call';
  toolCallId: string;
  toolName: string;
  arguments: Record<string, unknown>;
}

export interface TFToolResultEvent {
  type: 'tool-result';
  toolCallId: string;
  toolName: string;
  result: unknown;
  isError?: boolean;
}

export interface TFApprovalRequiredEvent {
  type: 'approval-required';
  actionId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  message: string;
}

export interface TFTurnCompleteEvent {
  type: 'turn-complete';
  turnId: string;
}

export interface TFTurnCancelledEvent {
  type: 'turn-cancelled';
  turnId: string;
}

export interface TFErrorEvent {
  type: 'error';
  message: string;
  code?: string;
  retryable?: boolean;
}

export type TFEvent =
  | TFTextDeltaEvent
  | TFToolCallEvent
  | TFToolResultEvent
  | TFApprovalRequiredEvent
  | TFTurnCompleteEvent
  | TFTurnCancelledEvent
  | TFErrorEvent;

// ─── Session & Turn ─────────────────────────────────────────

export interface TFSession {
  id: string;
  agentId: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface TFTurn {
  id: string;
  sessionId: string;
  status: 'running' | 'done' | 'error' | 'cancelled';
  createdAt: string;
}

// ─── Shadow Workspace ───────────────────────────────────────

export interface Hunk {
  id: string;
  filePath: string;
  originalStart: number;
  originalLines: string[];
  newLines: string[];
  status: 'pending' | 'accepted' | 'rejected';
}

export interface ProposedEdit {
  id: string;
  turnId: string;
  filePath: string;
  hunks: Hunk[];
  originalHash: string;
  timestamp: number;
}

export interface ChangeSet {
  id: string;
  sessionId: string;
  turnId: string;
  edits: ProposedEdit[];
  createdAt: number;
  status: 'pending' | 'partially-accepted' | 'fully-accepted' | 'rejected' | 'cancelled';
}

export interface UndoSnapshot {
  changeSetId: string;
  filePath: string;
  originalContent: string;
  originalHash: string;
  timestamp: number;
}

export interface ConflictInfo {
  filePath: string;
  hunkId: string;
  reason: string;
  currentHash: string;
  expectedHash: string;
}

// ─── Context Engine ─────────────────────────────────────────

export interface RepoFile {
  path: string;
  size: number;
  language: string;
  lastModified: number;
}

export interface Symbol {
  name: string;
  kind: 'function' | 'class' | 'method' | 'variable' | 'import' | 'constant';
  filePath: string;
  startLine: number;
  endLine: number;
  docstring?: string;
}

export interface IndexedFile {
  path: string;
  content: string;
  language: string;
  symbols: Symbol[];
  imports: string[];
  tokens: number;
  hash: string;
}

export interface RetrievalResult {
  filePath: string;
  score: number;
  signals: RetrievalSignal[];
  snippets: CodeSnippet[];
  tokenCost: number;
}

export type RetrievalSignal =
  | 'bm25-match'
  | 'symbol-match'
  | 'import-graph'
  | 'at-mention'
  | 'test-related'
  | 'doc-related'
  | 'recency';

export interface CodeSnippet {
  startLine: number;
  endLine: number;
  content: string;
}

export interface LedgerEntry {
  filePath: string;
  symbols: string[];
  reason: string;
  signals: RetrievalSignal[];
  tokenCost: number;
  rank: number;
}

export interface ContextLedger {
  taskDescription: string;
  entries: LedgerEntry[];
  totalTokens: number;
  budget: number;
  excluded: string[];
  timestamp: number;
}

// ─── MCP Tools ──────────────────────────────────────────────

export interface RepoMapResult {
  tree: string;
  topFiles: { path: string; symbolCount: number }[];
  totalFiles: number;
}

export interface SearchResult {
  filePath: string;
  lineNumber: number;
  line: string;
  score: number;
}

export interface ProposeEditArgs {
  filePath: string;
  hunks: Array<{
    originalStart: number;
    originalLines: string[];
    newLines: string[];
  }>;
  reason?: string;
}

export interface RunCommandArgs {
  command: string;
  args: string[];
  cwd?: string;
  timeoutMs?: number;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

// ─── Failover & Resilience ──────────────────────────────────

export type FailureClass =
  | 'network-unreachable'
  | 'auth-error'
  | 'rate-limit'
  | 'server-error'
  | 'timeout'
  | 'stalled-generation'
  | 'unknown';

export interface ModelHealth {
  agentId: string;
  status: 'healthy' | 'degraded' | 'down';
  lastError?: string;
  lastSuccess?: number;
  consecutiveFailures: number;
}

export interface FailoverState {
  currentAgent: string;
  primaryAgent: string;
  fallbackAgent: string;
  usingFallback: boolean;
  primaryHealth: ModelHealth;
  fallbackHealth: ModelHealth;
}

// ─── Webview Messages ────────────────────────────────────────

export type WebviewMessageType =
  | 'chat:send'
  | 'chat:cancel'
  | 'chat:textDelta'
  | 'chat:toolCall'
  | 'chat:toolResult'
  | 'chat:complete'
  | 'chat:error'
  | 'chat:status'
  | 'diff:show'
  | 'diff:acceptHunk'
  | 'diff:rejectHunk'
  | 'diff:acceptAll'
  | 'diff:rejectAll'
  | 'diff:undo'
  | 'ledger:update'
  | 'health:update'
  | 'approval:respond';

export interface WebviewMessage {
  type: WebviewMessageType;
  payload: unknown;
}

export interface ChatSendPayload {
  text: string;
  atMentions?: string[];
  sessionId?: string;
}

export interface DiffShowPayload {
  changeSetId: string;
  hunks: Hunk[];
}

export interface ApprovalRespondPayload {
  actionId: string;
  approved: boolean;
  note?: string;
}

// ─── Extension State ─────────────────────────────────────────

export interface ExtensionState {
  sessionId: string | null;
  currentTurnId: string | null;
  isAgentRunning: boolean;
  failoverState: FailoverState | null;
  pendingChangeSets: ChangeSet[];
  undoHistory: UndoSnapshot[];
}
