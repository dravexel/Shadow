// ============================================================
// ShadowForge — Diff Review Manager
//
// Opens VS Code's native diff editor to show proposed changes.
// Manages the per-hunk accept/reject workflow.
// ============================================================

import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { ShadowWorkspace } from '../../shadow-workspace/change-set';
import { ChangeSet, Hunk } from '../../shared/types';

export class DiffReviewManager {
  private activeReviews = new Map<string, ChangeSet>();
  private reviewCallbacks: Array<(changeSetId: string, hunks: Hunk[]) => void> = [];

  constructor(
    private shadow: ShadowWorkspace,
    private context: vscode.ExtensionContext
  ) {}

  // ─── Open Review ─────────────────────────────────────

  async openReview(changeSetId: string): Promise<void> {
    const cs = this.shadow.getChangeSet(changeSetId);
    if (!cs) {
      vscode.window.showErrorMessage(`ShadowForge: ChangeSet ${changeSetId} not found`);
      return;
    }

    this.activeReviews.set(changeSetId, cs);

    // Notify webview panels
    const allHunks = cs.edits.flatMap(e => e.hunks);
    this.reviewCallbacks.forEach(cb => cb(changeSetId, allHunks));

    // Open diff editors for each file
    for (const edit of cs.edits) {
      await this.openFileDiff(cs, edit.filePath, changeSetId);
    }

    // Show action buttons
    const action = await vscode.window.showInformationMessage(
      `ShadowForge: ${cs.edits.length} file(s) with ${allHunks.length} hunk(s) proposed. Review diffs above.`,
      'Accept All',
      'Reject All',
      'Review Individually'
    );

    if (action === 'Accept All') {
      await this.acceptAll(changeSetId);
    } else if (action === 'Reject All') {
      this.rejectAll(changeSetId);
    }
    // 'Review Individually' — user uses the diff editor buttons
  }

  private async openFileDiff(cs: ChangeSet, absFilePath: string, changeSetId: string): Promise<void> {
    // Create a temp file with the proposed content
    const proposed = this.shadow.getProposedOrReal(absFilePath);
    const tmpDir = os.tmpdir();
    const fileName = path.basename(absFilePath);
    const tmpFile = path.join(tmpDir, `shadowforge-proposed-${Date.now()}-${fileName}`);

    fs.writeFileSync(tmpFile, proposed, 'utf-8');

    const originalUri = vscode.Uri.file(absFilePath);
    const proposedUri = vscode.Uri.file(tmpFile);

    // Open VS Code native diff editor (read-only on the right)
    const title = `ShadowForge: ${fileName} (Proposed Changes)`;
    await vscode.commands.executeCommand(
      'vscode.diff',
      originalUri,
      proposedUri,
      title,
      { preview: true }
    );

    // Clean up temp file when the diff editor closes (best-effort)
    setTimeout(() => {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }, 60_000);
  }

  // ─── Accept / Reject ─────────────────────────────────

  async acceptHunk(changeSetId: string, hunkId: string): Promise<void> {
    const conflict = this.shadow.acceptHunk(changeSetId, hunkId);
    if (conflict) {
      const answer = await vscode.window.showWarningMessage(
        `Conflict in ${conflict.filePath}: ${conflict.reason} Overwrite anyway?`,
        'Overwrite',
        'Cancel'
      );
      if (answer !== 'Overwrite') return;
    }
    // Apply this single accepted hunk
    this.shadow.applyAccepted(changeSetId);
    vscode.window.showInformationMessage(`ShadowForge: Hunk accepted and applied.`);
  }

  async acceptAll(changeSetId?: string): Promise<void> {
    const pending = changeSetId
      ? [this.shadow.getChangeSet(changeSetId)].filter(Boolean)
      : this.shadow.getAllPendingChangeSets();

    for (const cs of pending) {
      if (!cs) continue;
      const conflicts = this.shadow.acceptAllHunks(cs.id);
      if (conflicts.length > 0) {
        for (const c of conflicts) {
          vscode.window.showWarningMessage(`Conflict in ${c.filePath}: ${c.reason}`);
        }
      }
      const modified = this.shadow.applyAccepted(cs.id);
      vscode.window.showInformationMessage(
        `ShadowForge: Applied changes to ${modified.length} file(s): ${modified.map(p => path.basename(p)).join(', ')}`
      );
    }
  }

  rejectAll(changeSetId?: string): void {
    if (changeSetId) {
      this.shadow.rejectAllHunks(changeSetId);
    } else {
      for (const cs of this.shadow.getAllPendingChangeSets()) {
        this.shadow.rejectAllHunks(cs.id);
      }
    }
    this.shadow.discardPending(changeSetId);
    vscode.window.showInformationMessage('ShadowForge: All proposed changes rejected. Workspace unchanged.');
  }

  rejectHunk(changeSetId: string, hunkId: string): void {
    this.shadow.rejectHunk(changeSetId, hunkId);
  }

  // ─── Event Registration ───────────────────────────────

  onReviewOpened(cb: (changeSetId: string, hunks: Hunk[]) => void): void {
    this.reviewCallbacks.push(cb);
  }
}
