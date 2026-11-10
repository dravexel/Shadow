// ============================================================
// ShadowForge — Chat Panel Webview Provider
//
// The main chat interface. Streams TrueForge events in real time.
// ============================================================

import * as vscode from 'vscode';
import * as path from 'path';
import { SessionManager } from '../../trueforge/session-manager';
import { ShadowWorkspace } from '../../shadow-workspace/change-set';
import { ContextEngine } from '../../context-engine/indexer';
import { DiffReviewManager } from '../services/diff-review';
import { FailoverState, TFEvent, ExtensionState } from '../../shared/types';

export class ChatPanelProvider implements vscode.WebviewViewProvider {
  private webviewView: vscode.WebviewView | undefined;

  constructor(
    private context: vscode.ExtensionContext,
    private sessionManager: SessionManager,
    private shadow: ShadowWorkspace,
    private contextEngine: ContextEngine,
    private diffReview: DiffReviewManager,
    private contextBudget: number
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.webviewView = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'media'),
      ],
    };

    webviewView.webview.html = this.getHtml(webviewView.webview);

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(async (msg) => {
      await this.handleWebviewMessage(msg);
    });

    // Forward TrueForge events to the webview
    this.sessionManager.onTurnEvent((event: TFEvent) => {
      this.postEvent(event);
    });
  }

  private async handleWebviewMessage(msg: { type: string; payload: unknown }): Promise<void> {
    switch (msg.type) {
      case 'chat:send': {
        const payload = msg.payload as { text: string };
        if (!payload.text.trim()) return;

        // Build contextual prompt with auto-retrieved files
        const enrichedPrompt = await this.buildContextualPrompt(payload.text);

        this.postMessage({ type: 'chat:status', payload: { status: 'running' } });
        await this.sessionManager.runTurn(enrichedPrompt);
        this.postMessage({ type: 'chat:status', payload: { status: 'idle' } });
        break;
      }

      case 'chat:cancel': {
        this.sessionManager.requestCancel();
        this.shadow.discardPending();
        this.postMessage({ type: 'chat:status', payload: { status: 'cancelled' } });
        break;
      }

      case 'diff:acceptAll': {
        const { changeSetId } = msg.payload as { changeSetId?: string };
        await this.diffReview.acceptAll(changeSetId);
        break;
      }

      case 'diff:rejectAll': {
        const { changeSetId } = msg.payload as { changeSetId?: string };
        this.diffReview.rejectAll(changeSetId);
        break;
      }

      case 'diff:undo': {
        const restored = this.shadow.undoLast();
        this.postMessage({ type: 'chat:status', payload: { status: 'idle', message: `Restored ${restored.length} file(s)` } });
        break;
      }

      case 'shadowforge:openContextLedger': {
        vscode.commands.executeCommand('shadowforge.openContextLedger');
        break;
      }
    }
  }

  private async buildContextualPrompt(userMessage: string): Promise<string> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) return userMessage;

    // Auto-retrieve relevant context
    const results = await this.contextEngine.retrieve(userMessage, this.contextBudget);
    const ledger = this.contextEngine.buildLedger(userMessage, results, this.contextBudget);

    // Build context header
    const contextParts: string[] = [
      `You are ShadowForge, an autonomous AI coding agent.`,
      `Workspace: ${workspaceRoot}`,
      ``,
      `IMPORTANT RULES:`,
      `1. Use repo_map first to understand the codebase.`,
      `2. Use search_workspace and find_symbol to discover relevant files.`,
      `3. Use read_range to read file content.`,
      `4. Use propose_edit to stage changes (NEVER write directly to files).`,
      `5. Use request_review to show proposed changes to the user.`,
      `6. The user must approve all changes before they are applied.`,
      ``,
    ];

    if (results.length > 0) {
      contextParts.push(`PRE-RETRIEVED CONTEXT (${results.length} files, ${ledger.totalTokens} tokens):`);
      for (const r of results.slice(0, 5)) {
        contextParts.push(`- ${r.filePath} [${r.signals.join(', ')}]`);
      }
      contextParts.push('');
    }

    contextParts.push(`USER REQUEST: ${userMessage}`);

    return contextParts.join('\n');
  }

  // ─── Outbound Messages ────────────────────────────────

  private postEvent(event: TFEvent): void {
    this.postMessage({ type: `chat:${event.type}`, payload: event });
  }

  postMessage(msg: { type: string; payload: unknown }): void {
    this.webviewView?.webview.postMessage(msg);
  }

  sendHealthUpdate(state: FailoverState): void {
    this.postMessage({ type: 'health:update', payload: state });
  }

  sendStateUpdate(state: Partial<ExtensionState>): void {
    this.postMessage({ type: 'state:update', payload: state });
  }

  // ─── HTML ─────────────────────────────────────────────

  private getHtml(webview: vscode.Webview): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<title>ShadowForge Chat</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-sideBar-background); height: 100vh; display: flex; flex-direction: column; }

  #header { padding: 8px 12px; border-bottom: 1px solid var(--vscode-panel-border); display: flex; align-items: center; gap: 8px; }
  #header h1 { font-size: 13px; font-weight: 600; flex: 1; }
  #health-badge { font-size: 11px; padding: 2px 8px; border-radius: 10px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }

  #messages { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px; }

  .message { padding: 8px 12px; border-radius: 6px; max-width: 95%; }
  .message.user { background: var(--vscode-input-background); align-self: flex-end; }
  .message.agent { background: var(--vscode-editor-inactiveSelectionBackground); align-self: flex-start; }
  .message.tool { background: var(--vscode-textCodeBlock-background); font-family: monospace; font-size: 11px; color: var(--vscode-textPreformat-foreground); }
  .message.error { background: var(--vscode-inputValidation-errorBackground); color: var(--vscode-inputValidation-errorForeground); }
  .message.system { font-style: italic; font-size: 11px; color: var(--vscode-descriptionForeground); align-self: center; }

  .tool-call { margin-top: 4px; }
  .tool-name { font-weight: bold; color: var(--vscode-symbolIcon-functionForeground); }

  .diff-actions { display: flex; gap: 6px; margin-top: 8px; }
  .btn { padding: 4px 12px; border: 1px solid var(--vscode-button-border); border-radius: 3px; cursor: pointer; font-size: 12px; }
  .btn-primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  .btn-primary:hover { background: var(--vscode-button-hoverBackground); }
  .btn-secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  .btn-danger { background: var(--vscode-errorForeground); color: white; }

  #input-area { padding: 8px 12px; border-top: 1px solid var(--vscode-panel-border); display: flex; gap: 6px; align-items: flex-end; }
  #message-input { flex: 1; resize: none; min-height: 36px; max-height: 120px; padding: 6px 10px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 4px; font-family: inherit; font-size: inherit; }
  #message-input:focus { outline: 1px solid var(--vscode-focusBorder); }
  #send-btn { padding: 6px 14px; }
  #cancel-btn { padding: 6px 10px; display: none; }
  #cancel-btn.visible { display: block; }

  .thinking { display: flex; gap: 4px; padding: 8px; align-self: flex-start; }
  .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--vscode-progressBar-background); animation: bounce 1.2s infinite; }
  .dot:nth-child(2) { animation-delay: 0.2s; }
  .dot:nth-child(3) { animation-delay: 0.4s; }
  @keyframes bounce { 0%,80%,100%{transform:scale(0.6)} 40%{transform:scale(1.0)} }

  #status-bar { padding: 4px 12px; font-size: 10px; color: var(--vscode-descriptionForeground); border-top: 1px solid var(--vscode-panel-border); }
</style>
</head>
<body>
<div id="header">
  <span>⬛ ShadowForge</span>
  <h1>AI Coding Agent</h1>
  <span id="health-badge">● Ready</span>
</div>

<div id="messages">
  <div class="message system">
    ShadowForge is ready. Type a task below or use <strong>Ctrl+K</strong> for inline edit.
  </div>
</div>

<div id="input-area">
  <textarea id="message-input" placeholder="Describe a coding task... (use @file or @symbol to reference code)" rows="1"></textarea>
  <button class="btn btn-primary" id="send-btn" onclick="sendMessage()">Send</button>
  <button class="btn btn-danger" id="cancel-btn" onclick="cancelTask()">✕ Cancel</button>
</div>

<div id="status-bar" id="status-bar">Ready</div>

<script>
const vscode = acquireVsCodeApi();
const messagesEl = document.getElementById('messages');
const inputEl = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const cancelBtn = document.getElementById('cancel-btn');
const statusBar = document.getElementById('status-bar');
const healthBadge = document.getElementById('health-badge');

let currentAgentText = '';
let agentMessageEl = null;
let thinkingEl = null;
let currentChangeSetId = null;

// Auto-resize textarea
inputEl.addEventListener('input', () => {
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
});

// Send on Enter (Shift+Enter = newline)
inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

function sendMessage() {
  const text = inputEl.value.trim();
  if (!text) return;
  addMessage('user', text);
  vscode.postMessage({ type: 'chat:send', payload: { text } });
  inputEl.value = '';
  inputEl.style.height = 'auto';
}

function cancelTask() {
  vscode.postMessage({ type: 'chat:cancel', payload: {} });
}

function addMessage(role, content) {
  const el = document.createElement('div');
  el.className = 'message ' + role;
  el.textContent = content;
  messagesEl.appendChild(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return el;
}

function showThinking() {
  if (thinkingEl) return;
  thinkingEl = document.createElement('div');
  thinkingEl.className = 'thinking';
  thinkingEl.innerHTML = '<div class="dot"></div><div class="dot"></div><div class="dot"></div>';
  messagesEl.appendChild(thinkingEl);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function hideThinking() {
  if (thinkingEl) { thinkingEl.remove(); thinkingEl = null; }
}

function appendAgentText(delta) {
  hideThinking();
  if (!agentMessageEl) {
    agentMessageEl = document.createElement('div');
    agentMessageEl.className = 'message agent';
    messagesEl.appendChild(agentMessageEl);
  }
  currentAgentText += delta;
  agentMessageEl.textContent = currentAgentText;
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function resetAgentMessage() {
  currentAgentText = '';
  agentMessageEl = null;
}

function showDiffActions(changeSetId) {
  currentChangeSetId = changeSetId;
  const el = document.createElement('div');
  el.className = 'message system';
  el.innerHTML = \`
    <strong>Changes ready for review</strong>
    <div class="diff-actions">
      <button class="btn btn-primary" onclick="acceptAll()">✓ Accept All</button>
      <button class="btn btn-secondary" onclick="rejectAll()">✗ Reject All</button>
      <button class="btn btn-secondary" onclick="undoLast()">↩ Undo</button>
    </div>
  \`;
  messagesEl.appendChild(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function acceptAll() {
  vscode.postMessage({ type: 'diff:acceptAll', payload: { changeSetId: currentChangeSetId } });
}
function rejectAll() {
  vscode.postMessage({ type: 'diff:rejectAll', payload: { changeSetId: currentChangeSetId } });
}
function undoLast() {
  vscode.postMessage({ type: 'diff:undo', payload: {} });
}

// Handle messages from extension
window.addEventListener('message', (e) => {
  const msg = e.data;
  switch (msg.type) {
    case 'chat:text-delta':
      appendAgentText(msg.payload.delta);
      break;
    case 'chat:tool-call':
      hideThinking();
      const toolEl = document.createElement('div');
      toolEl.className = 'message tool';
      toolEl.innerHTML = \`<span class="tool-name">🔧 \${msg.payload.toolName}</span>\\n\${JSON.stringify(msg.payload.arguments, null, 2).slice(0, 500)}\`;
      messagesEl.appendChild(toolEl);
      messagesEl.scrollTop = messagesEl.scrollHeight;
      break;
    case 'chat:tool-result':
      if (msg.payload.toolName === 'request_review') {
        const result = msg.payload.result;
        if (result && result.changeSetId) showDiffActions(result.changeSetId);
      }
      break;
    case 'chat:turn-complete':
      hideThinking();
      resetAgentMessage();
      setStatus('idle', 'Ready');
      break;
    case 'chat:error':
      hideThinking();
      addMessage('error', '⚠ ' + msg.payload.message);
      setStatus('idle', 'Error');
      break;
    case 'chat:status':
      if (msg.payload.status === 'running') {
        setStatus('running', 'Agent running...');
        showThinking();
      } else {
        setStatus('idle', msg.payload.message || 'Ready');
        hideThinking();
      }
      break;
    case 'health:update':
      updateHealthBadge(msg.payload);
      break;
    case 'state:update':
      if (msg.payload.isAgentRunning !== undefined) {
        setStatus(msg.payload.isAgentRunning ? 'running' : 'idle');
      }
      break;
  }
});

function setStatus(status, text) {
  statusBar.textContent = text || (status === 'running' ? 'Agent running...' : 'Ready');
  if (status === 'running') {
    sendBtn.disabled = true;
    cancelBtn.classList.add('visible');
  } else {
    sendBtn.disabled = false;
    cancelBtn.classList.remove('visible');
  }
}

function updateHealthBadge(state) {
  const isHealthy = !state.usingFallback && state.primaryHealth.status === 'healthy';
  const isFallback = state.usingFallback;
  if (isHealthy) {
    healthBadge.textContent = '● Ready';
    healthBadge.style.background = 'var(--vscode-testing-iconPassed)';
  } else if (isFallback) {
    healthBadge.textContent = '⚠ Fallback';
    healthBadge.style.background = 'var(--vscode-testing-iconSkipped)';
  } else {
    healthBadge.textContent = '✕ Error';
    healthBadge.style.background = 'var(--vscode-testing-iconFailed)';
  }
}
</script>
</body>
</html>`;
  }
}
