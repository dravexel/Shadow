// ============================================================
// ShadowForge — VS Code Extension Entry Point
//
// Activates the extension, starts the MCP server, initializes
// TrueForge clients, and registers all commands and panels.
// ============================================================

import * as vscode from 'vscode';
import * as path from 'path';
import { TrueForgeClient } from '../trueforge/client';
import { FailoverManager } from '../trueforge/failover';
import { SessionManager } from '../trueforge/session-manager';
import { ShadowWorkspace } from '../shadow-workspace/change-set';
import { MCPServer } from '../mcp/server';
import { ContextEngine } from '../context-engine/indexer';
import { ChatPanelProvider } from './providers/chat-panel';
import { ContextLedgerProvider } from './providers/context-ledger';
import { DiffReviewManager } from './services/diff-review';
import { ModelHealthProvider } from './providers/model-health';
import { TRUEFORGE_DEFAULT_URL, MCP_DEFAULT_PORT, DEFAULT_CONTEXT_BUDGET_TOKENS } from '../shared/constants';
import { ChangeSet, FailoverState } from '../shared/types';

let mcpServer: MCPServer | null = null;
let sessionManager: SessionManager | null = null;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  console.log('[ShadowForge] Activating extension...');

  // ── Configuration ──────────────────────────────────────
  const config = vscode.workspace.getConfiguration('shadowforge');
  const trueforgeUrl = config.get<string>('trueforgeUrl', TRUEFORGE_DEFAULT_URL);
  const apiKey = config.get<string>('trueforgeApiKey', '');
  const primaryAgentId = config.get<string>('primaryAgentId', 'shadowforge-coder');
  const fallbackAgentId = config.get<string>('fallbackAgentId', 'shadowforge-fallback');
  const mcpPort = config.get<number>('mcpPort', MCP_DEFAULT_PORT);
  const contextBudget = config.get<number>('contextBudgetTokens', DEFAULT_CONTEXT_BUDGET_TOKENS);

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();

  // ── Core Services ──────────────────────────────────────
  const shadow = new ShadowWorkspace();
  const contextEngine = new ContextEngine(workspaceRoot);
  const diffReview = new DiffReviewManager(shadow, context);

  // Start indexing in background (non-blocking)
  contextEngine.buildIndex().catch(err =>
    console.warn('[ShadowForge] Background indexing failed:', err)
  );

  // ── MCP Server ─────────────────────────────────────────
  mcpServer = new MCPServer({
    port: mcpPort,
    workspaceRoot,
    shadow,
    contextEngine,
    onReviewRequested: (changeSetId) => {
      diffReview.openReview(changeSetId);
    },
    onCommandApprovalNeeded: async (cmd, args) => {
      const answer = await vscode.window.showWarningMessage(
        `ShadowForge agent wants to run: ${cmd} ${args.join(' ')}`,
        { modal: true },
        'Allow',
        'Deny'
      );
      return answer === 'Allow';
    },
  });

  try {
    await mcpServer.start();
    vscode.window.setStatusBarMessage(`$(check) ShadowForge MCP server running on port ${mcpPort}`, 5000);
  } catch (err) {
    vscode.window.showErrorMessage(`ShadowForge: Failed to start MCP server: ${err}`);
  }

  // ── TrueForge Failover Manager ─────────────────────────
  const failover = new FailoverManager({
    primary: { baseUrl: trueforgeUrl, apiKey: apiKey || undefined, agentId: primaryAgentId },
    fallback: { baseUrl: trueforgeUrl, apiKey: apiKey || undefined, agentId: fallbackAgentId },
  });

  try {
    await failover.init();
  } catch (err) {
    vscode.window.showWarningMessage(
      `ShadowForge: TrueForge SDK not ready. Run: cd shadowforge && npm install. Error: ${err}`
    );
  }

  // ── Session Manager ────────────────────────────────────
  sessionManager = new SessionManager(failover, context.workspaceState);

  // ── UI Providers ───────────────────────────────────────
  const modelHealthProvider = new ModelHealthProvider();
  const chatProvider = new ChatPanelProvider(context, sessionManager, shadow, contextEngine, diffReview, contextBudget);
  const ledgerProvider = new ContextLedgerProvider(context, contextEngine);

  // Update model health in UI
  failover.onHealthUpdate((state: FailoverState) => {
    modelHealthProvider.updateHealth(state);
    chatProvider.sendHealthUpdate(state);
  });

  // Update ledger when agent runs
  sessionManager.onStateChange((state) => {
    chatProvider.sendStateUpdate(state);
  });

  // ── Register VS Code Providers ─────────────────────────
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('shadowforge.chatPanel', chatProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.window.registerWebviewViewProvider('shadowforge.contextLedger', ledgerProvider),
    vscode.window.registerTreeDataProvider('shadowforge.modelHealth', modelHealthProvider),
  );

  // ── Register Commands ──────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('shadowforge.openChat', () => {
      vscode.commands.executeCommand('workbench.view.extension.shadowforge');
    }),

    vscode.commands.registerCommand('shadowforge.inlineEdit', async () => {
      await handleInlineEdit(sessionManager!, shadow, diffReview, contextEngine, workspaceRoot, contextBudget);
    }),

    vscode.commands.registerCommand('shadowforge.cancelTask', () => {
      sessionManager?.requestCancel();
      shadow.discardPending();
      vscode.window.showInformationMessage('ShadowForge: Task cancelled. No pending changes remain.');
    }),

    vscode.commands.registerCommand('shadowforge.openContextLedger', () => {
      vscode.commands.executeCommand('shadowforge.contextLedger.focus');
    }),

    vscode.commands.registerCommand('shadowforge.acceptAllHunks', async (changeSetId?: string) => {
      await diffReview.acceptAll(changeSetId);
    }),

    vscode.commands.registerCommand('shadowforge.rejectAllHunks', (changeSetId?: string) => {
      diffReview.rejectAll(changeSetId);
    }),

    vscode.commands.registerCommand('shadowforge.undoLastAccepted', async () => {
      const restored = shadow.undoLast();
      if (restored.length > 0) {
        vscode.window.showInformationMessage(`ShadowForge: Restored ${restored.length} file(s).`);
      } else {
        vscode.window.showInformationMessage('ShadowForge: Nothing to undo.');
      }
    }),

    vscode.commands.registerCommand('shadowforge.configureModels', () => {
      vscode.commands.executeCommand('workbench.action.openSettings', 'shadowforge');
    }),

    vscode.commands.registerCommand('shadowforge.startTrueForge', async () => {
      const terminal = vscode.window.createTerminal('TrueForge Server');
      terminal.sendText('npx @truefoundry/trueforge@latest');
      terminal.show();
      vscode.window.showInformationMessage('TrueForge server starting on http://localhost:8790...');
    }),
  );

  // ── Status Bar ─────────────────────────────────────────
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.text = '$(sparkle) ShadowForge';
  statusBar.tooltip = 'ShadowForge AI Coding Agent — Click to open chat';
  statusBar.command = 'shadowforge.openChat';
  statusBar.show();
  context.subscriptions.push(statusBar);

  // Update status bar based on agent state
  sessionManager.onStateChange((state) => {
    if (state.isAgentRunning !== undefined) {
      statusBar.text = state.isAgentRunning
        ? '$(loading~spin) ShadowForge (running...)'
        : '$(sparkle) ShadowForge';
    }
  });

  console.log('[ShadowForge] Extension activated successfully');
}

// ─── Inline Edit Handler ─────────────────────────────────

async function handleInlineEdit(
  sm: SessionManager,
  shadow: ShadowWorkspace,
  diffReview: DiffReviewManager,
  ctx: ContextEngine,
  workspaceRoot: string,
  contextBudget: number
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('ShadowForge: No active editor for inline edit.');
    return;
  }

  const selection = editor.selection;
  const selectedText = editor.document.getText(selection.isEmpty ? undefined : selection);
  const filePath = path.relative(workspaceRoot, editor.document.uri.fsPath);
  const startLine = selection.isEmpty ? 1 : selection.start.line + 1;
  const endLine = selection.isEmpty ? editor.document.lineCount : selection.end.line + 1;

  const instruction = await vscode.window.showInputBox({
    prompt: 'ShadowForge Inline Edit — Describe the change:',
    placeHolder: 'e.g. "Treat "off" and "n" as false, update docstring"',
    ignoreFocusOut: true,
  });

  if (!instruction) return;

  // Build context-aware prompt for inline edit
  const prompt = [
    `You are editing a specific code selection in ${filePath}.`,
    `Lines ${startLine}-${endLine}:`,
    '```',
    selectedText || '(entire file)',
    '```',
    '',
    `Instruction: ${instruction}`,
    '',
    `Use propose_edit to stage the change, then request_review.`,
    `Only modify lines ${startLine}-${endLine} unless the instruction explicitly requires other files.`,
  ].join('\n');

  await sm.runTurn(prompt);
}

export function deactivate(): void {
  mcpServer?.stop();
  console.log('[ShadowForge] Extension deactivated');
}
