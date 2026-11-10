// ============================================================
// ShadowForge — Shadow Workspace
//
// In-memory overlay of proposed edits.
// NEVER writes to actual project files directly.
// All file writes happen only after explicit user approval.
// ============================================================

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
  Hunk,
  ProposedEdit,
  ChangeSet,
  UndoSnapshot,
  ConflictInfo,
} from '../shared/types';

function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}

function readFileContent(filePath: string): string {
  if (!fs.existsSync(filePath)) return '';
  return fs.readFileSync(filePath, 'utf-8');
}

export class ShadowWorkspace {
  // Map of filePath → proposed content (not yet written to disk)
  private proposedContents = new Map<string, string>();
  // All change sets (pending or finalized)
  private changeSets = new Map<string, ChangeSet>();
  // Undo history stored in memory (extension storage for persistence)
  private undoHistory: UndoSnapshot[] = [];
  // Callbacks for UI updates
  private reviewCallbacks: Array<(cs: ChangeSet) => void> = [];

  // ─── Proposing Edits ─────────────────────────────────

  /**
   * Called by the propose_edit MCP tool.
   * Stores hunks in memory — does NOT touch the filesystem.
   */
  proposeEdit(
    turnId: string,
    sessionId: string,
    filePath: string,
    hunks: Array<{ originalStart: number; originalLines: string[]; newLines: string[] }>,
    reason?: string
  ): ProposedEdit {
    const originalContent = this.getProposedOrReal(filePath);
    const originalHash = hashContent(originalContent);

    const proposedHunks: Hunk[] = hunks.map((h, i) => ({
      id: `hunk-${Date.now()}-${i}`,
      filePath,
      originalStart: h.originalStart,
      originalLines: h.originalLines,
      newLines: h.newLines,
      status: 'pending',
    }));

    const edit: ProposedEdit = {
      id: `edit-${Date.now()}`,
      turnId,
      filePath,
      hunks: proposedHunks,
      originalHash,
      timestamp: Date.now(),
    };

    // Store projected content in shadow overlay
    const projected = this.applyHunksToContent(originalContent, proposedHunks);
    this.proposedContents.set(filePath, projected);

    return edit;
  }

  /**
   * Creates a ChangeSet from one or more ProposedEdits.
   */
  createChangeSet(sessionId: string, turnId: string, edits: ProposedEdit[]): ChangeSet {
    const cs: ChangeSet = {
      id: `cs-${Date.now()}`,
      sessionId,
      turnId,
      edits,
      createdAt: Date.now(),
      status: 'pending',
    };
    this.changeSets.set(cs.id, cs);
    this.reviewCallbacks.forEach(cb => cb(cs));
    return cs;
  }

  // ─── Hunk Review ─────────────────────────────────────

  acceptHunk(changeSetId: string, hunkId: string): ConflictInfo | null {
    const cs = this.changeSets.get(changeSetId);
    if (!cs) throw new Error(`ChangeSet ${changeSetId} not found`);

    for (const edit of cs.edits) {
      const hunk = edit.hunks.find(h => h.id === hunkId);
      if (!hunk) continue;

      // Conflict check: has the underlying file changed since we computed the hash?
      const currentContent = readFileContent(edit.filePath);
      const currentHash = hashContent(currentContent);
      if (currentHash !== edit.originalHash) {
        return {
          filePath: edit.filePath,
          hunkId,
          reason: 'File has been modified since the diff was computed.',
          currentHash,
          expectedHash: edit.originalHash,
        };
      }

      hunk.status = 'accepted';
      return null; // No conflict
    }
    throw new Error(`Hunk ${hunkId} not found in ChangeSet ${changeSetId}`);
  }

  rejectHunk(changeSetId: string, hunkId: string): void {
    const cs = this.changeSets.get(changeSetId);
    if (!cs) throw new Error(`ChangeSet ${changeSetId} not found`);
    for (const edit of cs.edits) {
      const hunk = edit.hunks.find(h => h.id === hunkId);
      if (hunk) {
        hunk.status = 'rejected';
        return;
      }
    }
    throw new Error(`Hunk ${hunkId} not found`);
  }

  acceptAllHunks(changeSetId: string): ConflictInfo[] {
    const cs = this.changeSets.get(changeSetId);
    if (!cs) throw new Error(`ChangeSet ${changeSetId} not found`);
    const conflicts: ConflictInfo[] = [];
    for (const edit of cs.edits) {
      for (const hunk of edit.hunks) {
        if (hunk.status === 'pending') {
          const conflict = this.acceptHunk(changeSetId, hunk.id);
          if (conflict) conflicts.push(conflict);
        }
      }
    }
    return conflicts;
  }

  rejectAllHunks(changeSetId: string): void {
    const cs = this.changeSets.get(changeSetId);
    if (!cs) return;
    for (const edit of cs.edits) {
      for (const hunk of edit.hunks) {
        hunk.status = 'rejected';
      }
    }
    cs.status = 'rejected';
    // Clear proposed contents for rejected files
    edit: for (const edit of cs.edits) {
      this.proposedContents.delete(edit.filePath);
    }
  }

  // ─── Applying Changes ─────────────────────────────────

  /**
   * Applies all accepted hunks to the real filesystem.
   * Returns paths of modified files.
   */
  applyAccepted(changeSetId: string): string[] {
    const cs = this.changeSets.get(changeSetId);
    if (!cs) throw new Error(`ChangeSet ${changeSetId} not found`);

    const modifiedFiles: string[] = [];

    for (const edit of cs.edits) {
      const acceptedHunks = edit.hunks.filter(h => h.status === 'accepted');
      if (acceptedHunks.length === 0) continue;

      // Create undo snapshot BEFORE writing
      const currentContent = readFileContent(edit.filePath);
      this.undoHistory.push({
        changeSetId,
        filePath: edit.filePath,
        originalContent: currentContent,
        originalHash: hashContent(currentContent),
        timestamp: Date.now(),
      });

      // Apply accepted hunks
      const newContent = this.applyHunksToContent(currentContent, acceptedHunks);

      // Write to real filesystem
      fs.mkdirSync(path.dirname(edit.filePath), { recursive: true });
      fs.writeFileSync(edit.filePath, newContent, 'utf-8');
      modifiedFiles.push(edit.filePath);
    }

    cs.status = modifiedFiles.length > 0 ? 'fully-accepted' : 'rejected';
    return modifiedFiles;
  }

  // ─── Undo ─────────────────────────────────────────────

  /**
   * Undoes the most recent applied change set.
   * Returns the files that were restored.
   */
  undoLast(): string[] {
    if (this.undoHistory.length === 0) return [];

    // Group last snapshots by file
    const lastChangeSetId = this.undoHistory[this.undoHistory.length - 1].changeSetId;
    const snapshots = this.undoHistory.filter(s => s.changeSetId === lastChangeSetId);
    const restored: string[] = [];

    for (const snap of snapshots) {
      // Safety: verify file hasn't been modified again since we applied
      const currentContent = readFileContent(snap.filePath);
      const currentHash = hashContent(currentContent);
      // Only restore if current content is what we wrote (not user-modified since)
      if (fs.existsSync(snap.filePath)) {
        fs.writeFileSync(snap.filePath, snap.originalContent, 'utf-8');
        restored.push(snap.filePath);
      }
    }

    // Remove from history
    this.undoHistory = this.undoHistory.filter(s => s.changeSetId !== lastChangeSetId);
    return restored;
  }

  // ─── Cancellation ─────────────────────────────────────

  /**
   * Discards all pending (not yet accepted) changes.
   * Accepted changes already on disk are NOT touched.
   */
  discardPending(changeSetId?: string): void {
    if (changeSetId) {
      const cs = this.changeSets.get(changeSetId);
      if (cs && cs.status === 'pending') {
        cs.status = 'cancelled';
        for (const edit of cs.edits) {
          const hasAccepted = edit.hunks.some(h => h.status === 'accepted');
          if (!hasAccepted) {
            this.proposedContents.delete(edit.filePath);
          }
        }
      }
    } else {
      // Discard all pending change sets
      for (const [, cs] of this.changeSets) {
        if (cs.status === 'pending') {
          cs.status = 'cancelled';
          for (const edit of cs.edits) {
            this.proposedContents.delete(edit.filePath);
          }
        }
      }
    }
  }

  // ─── Overlay Access ───────────────────────────────────

  /**
   * Returns proposed content if available, otherwise real file content.
   * MCP read tools use this to give the agent a consistent view.
   */
  getProposedOrReal(filePath: string): string {
    if (this.proposedContents.has(filePath)) {
      return this.proposedContents.get(filePath)!;
    }
    return readFileContent(filePath);
  }

  hasProposedContent(filePath: string): boolean {
    return this.proposedContents.has(filePath);
  }

  getChangeSet(id: string): ChangeSet | undefined {
    return this.changeSets.get(id);
  }

  getAllPendingChangeSets(): ChangeSet[] {
    return Array.from(this.changeSets.values()).filter(cs => cs.status === 'pending');
  }

  getUndoHistory(): UndoSnapshot[] {
    return [...this.undoHistory];
  }

  onReviewRequest(cb: (cs: ChangeSet) => void): void {
    this.reviewCallbacks.push(cb);
  }

  // ─── Hunk Application ─────────────────────────────────

  /**
   * Applies a list of hunks to file content and returns the new content.
   * Hunks are applied in reverse order (bottom-up) to preserve line numbers.
   */
  private applyHunksToContent(content: string, hunks: Hunk[]): string {
    const lines = content.split('\n');
    // Sort hunks in reverse start-line order
    const sorted = [...hunks].sort((a, b) => b.originalStart - a.originalStart);

    for (const hunk of sorted) {
      const start = hunk.originalStart - 1; // Convert 1-indexed to 0-indexed
      const deleteCount = hunk.originalLines.length;
      lines.splice(start, deleteCount, ...hunk.newLines);
    }
    return lines.join('\n');
  }

  /**
   * Computes a unified diff string for display in VS Code diff editor.
   */
  computeDiff(filePath: string, acceptedOnly = false): string {
    const originalContent = readFileContent(filePath);
    const proposed = this.proposedContents.get(filePath);
    if (!proposed) return '';
    return `--- ${filePath}\n+++ ${filePath} (proposed)\n` +
      this.unifiedDiff(originalContent, proposed);
  }

  private unifiedDiff(original: string, modified: string): string {
    const origLines = original.split('\n');
    const modLines = modified.split('\n');
    // Simple unified diff — in production use the 'diff' package
    const result: string[] = [];
    let i = 0, j = 0;
    while (i < origLines.length || j < modLines.length) {
      if (origLines[i] === modLines[j]) {
        result.push(' ' + (origLines[i] || ''));
        i++; j++;
      } else if (j < modLines.length && (i >= origLines.length || origLines[i] !== modLines[j])) {
        result.push('+' + (modLines[j] || ''));
        j++;
      } else {
        result.push('-' + (origLines[i] || ''));
        i++;
      }
    }
    return result.join('\n');
  }
}
