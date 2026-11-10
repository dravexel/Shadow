// ============================================================
// ShadowForge — Context Ledger Provider
// Shows which files were retrieved and why.
// ============================================================

import * as vscode from 'vscode';
import { ContextEngine } from '../../context-engine/indexer';
import { ContextLedger } from '../../shared/types';

export class ContextLedgerProvider implements vscode.WebviewViewProvider {
  private webviewView: vscode.WebviewView | undefined;
  private currentLedger: ContextLedger | null = null;

  constructor(
    private context: vscode.ExtensionContext,
    private contextEngine: ContextEngine
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.webviewView = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.getHtml();
  }

  updateLedger(ledger: ContextLedger): void {
    this.currentLedger = ledger;
    this.webviewView?.webview.postMessage({ type: 'ledger:update', payload: ledger });
  }

  private getHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
  body { font-family: var(--vscode-font-family); font-size: 12px; color: var(--vscode-foreground); background: var(--vscode-sideBar-background); padding: 8px; }
  h2 { font-size: 12px; font-weight: 600; margin-bottom: 8px; color: var(--vscode-sideBarTitle-foreground); }
  .entry { margin-bottom: 10px; padding: 6px; border: 1px solid var(--vscode-panel-border); border-radius: 4px; }
  .entry-path { font-weight: bold; font-size: 11px; color: var(--vscode-textLink-foreground); }
  .entry-reason { color: var(--vscode-descriptionForeground); margin-top: 2px; }
  .entry-signals { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 4px; }
  .signal { font-size: 10px; padding: 1px 6px; border-radius: 8px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
  .entry-tokens { font-size: 10px; color: var(--vscode-descriptionForeground); margin-top: 2px; }
  .budget { margin-top: 8px; font-size: 11px; }
  .budget-bar { height: 4px; background: var(--vscode-progressBar-background); border-radius: 2px; margin-top: 2px; }
  .excluded { margin-top: 8px; font-size: 10px; color: var(--vscode-descriptionForeground); }
  .empty { color: var(--vscode-descriptionForeground); font-style: italic; }
</style>
</head>
<body>
<h2>📋 Context Ledger</h2>
<div id="content"><div class="empty">Run an agent task to see which files were selected and why.</div></div>
<script>
window.addEventListener('message', (e) => {
  if (e.data.type === 'ledger:update') renderLedger(e.data.payload);
});

function renderLedger(ledger) {
  const pct = Math.round((ledger.totalTokens / ledger.budget) * 100);
  let html = \`<div style="font-size:11px;margin-bottom:8px;color:var(--vscode-descriptionForeground)">
    Task: <strong>\${escHtml(ledger.taskDescription.slice(0,80))}</strong>
  </div>\`;

  for (const entry of ledger.entries) {
    html += \`<div class="entry">
      <div class="entry-path">\${entry.rank}. \${escHtml(entry.filePath)}</div>
      <div class="entry-reason">\${escHtml(entry.reason)}</div>
      <div class="entry-signals">\${entry.signals.map(s => '<span class="signal">' + escHtml(s) + '</span>').join('')}</div>
      <div class="entry-tokens">~\${entry.tokenCost} tokens</div>
    </div>\`;
  }

  html += \`<div class="budget">
    Context usage: \${ledger.totalTokens} / \${ledger.budget} tokens (\${pct}%)
    <div class="budget-bar"><div style="width:\${Math.min(pct,100)}%;height:100%;background:var(--vscode-progressBar-background)"></div></div>
  </div>\`;

  if (ledger.excluded.length > 0) {
    html += \`<div class="excluded">Excluded (\${ledger.excluded.length}): \${ledger.excluded.slice(0,5).map(escHtml).join(', ')}...</div>\`;
  }

  document.getElementById('content').innerHTML = html;
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
</script>
</body>
</html>`;
  }
}
