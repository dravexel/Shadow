// ============================================================
// ShadowForge — Failover Manager
//
// Manages primary → fallback agent switching.
// The user never has to intervene; failover is automatic.
// ============================================================

import { TrueForgeClient, TrueForgeClientOptions } from './client';
import { FailoverState, TFSession, TFEvent } from '../shared/types';

export interface FailoverManagerOptions {
  primary: TrueForgeClientOptions;
  fallback: TrueForgeClientOptions;
}

export type HealthUpdateCallback = (state: FailoverState) => void;

export class FailoverManager {
  private primaryClient: TrueForgeClient;
  private fallbackClient: TrueForgeClient;
  private usingFallback = false;
  private healthCallbacks: HealthUpdateCallback[] = [];

  constructor(opts: FailoverManagerOptions) {
    this.primaryClient = new TrueForgeClient(opts.primary);
    this.fallbackClient = new TrueForgeClient(opts.fallback);
  }

  async init(): Promise<void> {
    // Initialize both clients (but don't fail if fallback can't load)
    await this.primaryClient.init();
    try {
      await this.fallbackClient.init();
    } catch {
      console.warn('[FailoverManager] Fallback agent unavailable — will only use primary');
    }
  }

  get activeClient(): TrueForgeClient {
    return this.usingFallback ? this.fallbackClient : this.primaryClient;
  }

  onHealthUpdate(cb: HealthUpdateCallback): void {
    this.healthCallbacks.push(cb);
  }

  private emitHealth(): void {
    const state = this.getState();
    this.healthCallbacks.forEach(cb => cb(state));
  }

  getState(): FailoverState {
    return {
      currentAgent: this.activeClient.agentId,
      primaryAgent: this.primaryClient.agentId,
      fallbackAgent: this.fallbackClient.agentId,
      usingFallback: this.usingFallback,
      primaryHealth: this.primaryClient.getHealth(),
      fallbackHealth: this.fallbackClient.getHealth(),
    };
  }

  // ─── Session ───────────────────────────────────────────

  async createSession(metadata?: Record<string, unknown>): Promise<TFSession> {
    return this.withFailover(() => this.activeClient.createSession(metadata));
  }

  // ─── Turn Execution with Failover ─────────────────────

  async *runTurn(
    sessionId: string,
    input: string,
    metadata?: Record<string, unknown>
  ): AsyncGenerator<TFEvent> {
    // Try current active agent first
    try {
      const stream = await this.activeClient.createTurn(sessionId, input, metadata);
      let hadError = false;
      let errorEvent: TFEvent | undefined;

      for await (const event of stream) {
        if (event.type === 'error' && event.retryable) {
          hadError = true;
          errorEvent = event;
          break; // Stop streaming, attempt failover
        }
        yield event;
      }

      if (hadError && errorEvent) {
        // Attempt failover to other agent
        const switched = await this.attemptFailover();
        if (switched) {
          console.log('[FailoverManager] Switched to fallback agent, retrying turn');
          yield { type: 'error', message: `Primary agent failed, switching to fallback: ${this.activeClient.agentId}`, retryable: false };
          // Retry with fallback — create new session for fallback agent
          const fallbackSession = await this.activeClient.createSession(metadata);
          const fallbackStream = await this.activeClient.createTurn(fallbackSession.id, input, metadata);
          for await (const event of fallbackStream) {
            yield event;
          }
        } else {
          // No fallback available, yield the original error
          yield errorEvent;
        }
      }
    } catch (err) {
      const switched = await this.attemptFailover();
      if (switched) {
        console.log('[FailoverManager] Exception during turn, switched to fallback');
        yield { type: 'error', message: `Primary agent failed (${String(err)}). Switched to ${this.activeClient.agentId}.`, retryable: false };
        try {
          const fallbackSession = await this.activeClient.createSession(metadata);
          const fallbackStream = await this.activeClient.createTurn(fallbackSession.id, input, metadata);
          for await (const event of fallbackStream) {
            yield event;
          }
        } catch (fallbackErr) {
          yield { type: 'error', message: `Fallback also failed: ${String(fallbackErr)}`, retryable: false };
        }
      } else {
        yield { type: 'error', message: String(err), retryable: false };
      }
    }
  }

  // ─── Failover Logic ────────────────────────────────────

  private async attemptFailover(): Promise<boolean> {
    if (this.usingFallback) {
      // Already on fallback, can't switch further
      this.fallbackClient.getHealth().status = 'down';
      this.emitHealth();
      return false;
    }
    // Switch to fallback
    this.usingFallback = true;
    this.emitHealth();
    return true;
  }

  async resetToPrimary(): Promise<void> {
    this.usingFallback = false;
    this.primaryClient.health.consecutiveFailures = 0;
    this.primaryClient.health.status = 'healthy';
    this.emitHealth();
  }

  // ─── Generic Retry Wrapper ─────────────────────────────

  private async withFailover<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      const switched = await this.attemptFailover();
      if (switched) {
        return await fn();
      }
      throw err;
    }
  }
}
