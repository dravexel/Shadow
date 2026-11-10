// ============================================================
// ShadowForge — Session Manager
//
// Keeps track of the active TrueForge session and current turn.
// Coordinates with the FailoverManager.
// ============================================================

import * as vscode from 'vscode';
import { FailoverManager } from './failover';
import { TFEvent, TFTurn, ExtensionState } from '../shared/types';

export type TurnEventCallback = (event: TFEvent) => void;
export type StateChangeCallback = (state: Partial<ExtensionState>) => void;

export class SessionManager {
  private sessionId: string | null = null;
  private currentTurnId: string | null = null;
  private isRunning = false;
  private cancelRequested = false;
  private turnCallbacks: TurnEventCallback[] = [];
  private stateCallbacks: StateChangeCallback[] = [];
  private currentAbortController: AbortController | null = null;

  constructor(
    private failover: FailoverManager,
    private storage: vscode.Memento
  ) {
    // Restore session from storage
    this.sessionId = this.storage.get<string>('shadowforge.sessionId', '');
    if (!this.sessionId) this.sessionId = null;
  }

  // ─── Session Lifecycle ─────────────────────────────────

  async ensureSession(): Promise<string> {
    if (this.sessionId) {
      // Verify session is still valid
      try {
        await this.failover.activeClient.getSession(this.sessionId);
        return this.sessionId;
      } catch {
        // Session expired or invalid, create new one
        this.sessionId = null;
      }
    }
    const session = await this.failover.createSession({
      source: 'shadowforge-extension',
      workspaceRoot: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
    });
    this.sessionId = session.id;
    await this.storage.update('shadowforge.sessionId', this.sessionId);
    this.emit({ sessionId: this.sessionId });
    return this.sessionId;
  }

  async clearSession(): Promise<void> {
    this.sessionId = null;
    await this.storage.update('shadowforge.sessionId', undefined);
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  // ─── Turn Execution ────────────────────────────────────

  async runTurn(input: string): Promise<void> {
    if (this.isRunning) {
      // Cancel the existing turn first (TrueForge auto-cancels via CancelledForNextTurn)
      this.requestCancel();
    }

    this.isRunning = true;
    this.cancelRequested = false;
    this.currentAbortController = new AbortController();
    this.emit({ isAgentRunning: true });

    try {
      const sessionId = await this.ensureSession();
      const eventStream = this.failover.runTurn(sessionId, input);

      for await (const event of eventStream) {
        if (this.cancelRequested) {
          // Discard remaining stream events
          break;
        }
        // Capture turn ID from first tool call or complete event
        if (event.type === 'tool-call' && !this.currentTurnId) {
          // TrueForge doesn't expose turn ID in event directly;
          // we generate a local tracking ID
          this.currentTurnId = `turn-${Date.now()}`;
          this.emit({ currentTurnId: this.currentTurnId });
        }
        // Notify all listeners
        this.turnCallbacks.forEach(cb => cb(event));
        if (event.type === 'turn-complete' || event.type === 'turn-cancelled') {
          break;
        }
      }
    } catch (err) {
      const event: TFEvent = {
        type: 'error',
        message: String(err),
        retryable: false,
      };
      this.turnCallbacks.forEach(cb => cb(event));
    } finally {
      this.isRunning = false;
      this.currentTurnId = null;
      this.currentAbortController = null;
      this.emit({ isAgentRunning: false, currentTurnId: null });
    }
  }

  // ─── Cancellation ──────────────────────────────────────

  requestCancel(): void {
    if (!this.isRunning) return;
    this.cancelRequested = true;
    this.currentAbortController?.abort();
    if (this.sessionId && this.currentTurnId) {
      // Best-effort server-side cancellation
      this.failover.activeClient
        .cancelTurn(this.sessionId, this.currentTurnId)
        .catch(err => console.warn('[SessionManager] Cancel turn failed:', err));
    }
    this.emit({ isAgentRunning: false });
  }

  isAgentRunning(): boolean {
    return this.isRunning;
  }

  // ─── Event Registration ────────────────────────────────

  onTurnEvent(cb: TurnEventCallback): void {
    this.turnCallbacks.push(cb);
  }

  onStateChange(cb: StateChangeCallback): void {
    this.stateCallbacks.push(cb);
  }

  private emit(state: Partial<ExtensionState>): void {
    this.stateCallbacks.forEach(cb => cb(state));
  }
}
