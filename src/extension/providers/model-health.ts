// ============================================================
// ShadowForge — Model Health Tree View Provider
// ============================================================

import * as vscode from 'vscode';
import { FailoverState, ModelHealth } from '../../shared/types';

export class ModelHealthProvider implements vscode.TreeDataProvider<HealthItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<HealthItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private state: FailoverState | null = null;

  updateHealth(state: FailoverState): void {
    this.state = state;
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: HealthItem): vscode.TreeItem {
    return element;
  }

  getChildren(): HealthItem[] {
    if (!this.state) {
      return [new HealthItem('No TrueForge connection', 'Connect TrueForge to see model health', 'unknown')];
    }

    const items: HealthItem[] = [
      new HealthItem(
        `Primary: ${this.state.primaryAgent}`,
        this.state.primaryHealth.lastError || 'No errors',
        this.state.primaryHealth.status,
        this.state.usingFallback ? '' : '(active)'
      ),
      new HealthItem(
        `Fallback: ${this.state.fallbackAgent}`,
        this.state.fallbackHealth.lastError || 'Standby',
        this.state.fallbackHealth.status,
        this.state.usingFallback ? '(active)' : ''
      ),
    ];

    if (this.state.usingFallback) {
      items.unshift(new HealthItem('⚠ Using fallback model', 'Primary agent unavailable', 'degraded'));
    }

    return items;
  }
}

class HealthItem extends vscode.TreeItem {
  constructor(
    label: string,
    tooltip: string,
    status: string,
    description?: string
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.tooltip = tooltip;
    this.description = description;

    const icons: Record<string, string> = {
      healthy: 'testing-passed-icon',
      degraded: 'testing-skipped-icon',
      down: 'testing-failed-icon',
      unknown: 'question',
    };
    this.iconPath = new vscode.ThemeIcon(icons[status] || 'question');
  }
}
