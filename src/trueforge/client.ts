// ============================================================
// ShadowForge — TrueForge Client Wrapper
//
// Wraps @truefoundry/trueforge-sdk with error handling,
// retry logic, and event normalization.
// ============================================================

import {
  TFEvent,
  TFSession,
  TFTurn,
  FailureClass,
  ModelHealth,
} from '../shared/types';
import {
  RETRY_MAX_ATTEMPTS,
  RETRY_BASE_DELAY_MS,
  RETRY_MAX_DELAY_MS,
  STALL_TIMEOUT_MS,
} from '../shared/constants';

// ─── SDK shim ─────────────────────────────────────────────
// We import the SDK dynamically so the extension can load even
// if the package hasn't been installed yet (shows an error message).

type TrueForgeSDK = {
  TrueForgeClient: new (opts: { baseUrl: string; apiKey?: string }) => ITrueForgeClient;
};

interface ITrueForgeClient {
  sessions: {
    create(opts: { agentId: string; metadata?: Record<string, unknown> }): Promise<{ id: string; agentId: string; createdAt: string }>;
    get(sessionId: string): Promise<{ id: string; agentId: string; createdAt: string; status: string }>;
    turns: {
      create(sessionId: string, opts: { input: string; metadata?: Record<string, unknown> }): Promise<AsyncIterable<TFEvent>>;
      cancel(sessionId: string, turnId: string): Promise<void>;
    };
  };
}

// ─── Failure Classification ───────────────────────────────

function classifyError(err: unknown): FailureClass {
  if (!(err instanceof Error)) return 'unknown';
  const msg = err.message.toLowerCase();
  if (msg.includes('econnrefused') || msg.includes('enotfound') || msg.includes('network')) {
    return 'network-unreachable';
  }
  if (msg.includes('401') || msg.includes('403') || msg.includes('unauthorized') || msg.includes('forbidden')) {
    return 'auth-error';
  }
  if (msg.includes('429') || msg.includes('rate limit') || msg.includes('too many')) {
    return 'rate-limit';
  }
  if (msg.includes('500') || msg.includes('502') || msg.includes('503') || msg.includes('server error')) {
    return 'server-error';
  }
  if (msg.includes('timeout') || msg.includes('timed out')) {
    return 'timeout';
  }
  return 'unknown';
}

function isRetryable(cls: FailureClass): boolean {
  return cls === 'network-unreachable' || cls === 'rate-limit' || cls === 'server-error' || cls === 'timeout';
}

function retryDelay(attempt: number): number {
  // Exponential backoff with jitter
  const base = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
  const jitter = Math.random() * 1000;
  return Math.min(base + jitter, RETRY_MAX_DELAY_MS);
}

// ─── TrueForge Client ────────────────────────────────────

export interface TrueForgeClientOptions {
  baseUrl: string;
  apiKey?: string;
  agentId: string;
}

export class TrueForgeClient {
  private sdk: ITrueForgeClient | null = null;
  private baseUrl: string;
  private apiKey: string | undefined;
  public agentId: string;
  public health: ModelHealth;

  constructor(opts: TrueForgeClientOptions) {
    this.baseUrl = opts.baseUrl;
    this.apiKey = opts.apiKey;
    this.agentId = opts.agentId;
    this.health = {
      agentId: opts.agentId,
      status: 'healthy',
      consecutiveFailures: 0,
    };
  }

  async init(): Promise<void> {
    try {
      // Dynamic import — will throw if SDK not installed
      const sdkModule = await import('@truefoundry/trueforge-sdk') as unknown as TrueForgeSDK;
      this.sdk = new sdkModule.TrueForgeClient({
        baseUrl: this.baseUrl,
        apiKey: this.apiKey,
      });
    } catch (e) {
      throw new Error(
        `Failed to load @truefoundry/trueforge-sdk. Run: npm install inside the shadowforge folder.\nOriginal error: ${String(e)}`
      );
    }
  }

  private ensureSDK(): ITrueForgeClient {
    if (!this.sdk) throw new Error('TrueForgeClient not initialized. Call init() first.');
    return this.sdk;
  }

  // ─── Sessions ──────────────────────────────────────────

  async createSession(metadata?: Record<string, unknown>): Promise<TFSession> {
    return this.withRetry(async () => {
      const sdk = this.ensureSDK();
      const raw = await sdk.sessions.create({ agentId: this.agentId, metadata });
      return { id: raw.id, agentId: raw.agentId, createdAt: raw.createdAt };
    }, 'createSession');
  }

  async getSession(sessionId: string): Promise<TFSession> {
    return this.withRetry(async () => {
      const sdk = this.ensureSDK();
      const raw = await sdk.sessions.get(sessionId);
      return { id: raw.id, agentId: raw.agentId, createdAt: raw.createdAt };
    }, 'getSession');
  }

  // ─── Turns ─────────────────────────────────────────────

  async createTurn(
    sessionId: string,
    input: string,
    metadata?: Record<string, unknown>
  ): Promise<AsyncIterable<TFEvent>> {
    // Note: turns are NOT retried with backoff because they stream.
    // The failover manager handles turn-level retry by switching agents.
    const sdk = this.ensureSDK();
    const stream = await sdk.sessions.turns.create(sessionId, { input, metadata });
    return this.wrapStreamWithStalledDetection(stream);
  }

  async cancelTurn(sessionId: string, turnId: string): Promise<void> {
    try {
      const sdk = this.ensureSDK();
      await sdk.sessions.turns.cancel(sessionId, turnId);
    } catch {
      // Best-effort cancellation — ignore errors
    }
  }

  // ─── Stream Utilities ──────────────────────────────────

  /**
   * Wraps a TrueForge event stream and injects a synthetic error event
   * if no events arrive within STALL_TIMEOUT_MS.
   */
  private async *wrapStreamWithStalledDetection(
    stream: AsyncIterable<TFEvent>
  ): AsyncGenerator<TFEvent> {
    const iterator = stream[Symbol.asyncIterator]();
    while (true) {
      const timeoutPromise = new Promise<{ done: true; value: undefined }>((_, reject) =>
        setTimeout(() => reject(new Error('stalled-generation')), STALL_TIMEOUT_MS)
      );
      let result: IteratorResult<TFEvent>;
      try {
        result = await Promise.race([
          iterator.next(),
          timeoutPromise as never,
        ]);
      } catch (e) {
        // Stall detected — emit synthetic error event
        yield { type: 'error', message: 'Generation stalled (no events for 30s)', code: 'stalled-generation', retryable: true };
        return;
      }
      if (result.done) return;
      yield result.value;
    }
  }

  // ─── Retry Logic ───────────────────────────────────────

  private async withRetry<T>(
    fn: () => Promise<T>,
    opName: string
  ): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < RETRY_MAX_ATTEMPTS; attempt++) {
      try {
        const result = await fn();
        // On success, reset health
        this.health.status = 'healthy';
        this.health.consecutiveFailures = 0;
        this.health.lastSuccess = Date.now();
        return result;
      } catch (err) {
        lastError = err;
        const cls = classifyError(err);
        this.health.consecutiveFailures++;
        this.health.lastError = `[${opName}] ${cls}: ${String(err)}`;
        this.health.status = this.health.consecutiveFailures >= 3 ? 'down' : 'degraded';

        if (!isRetryable(cls) || attempt === RETRY_MAX_ATTEMPTS - 1) {
          break;
        }
        const delay = retryDelay(attempt);
        console.log(`[TrueForgeClient] Retry ${attempt + 1}/${RETRY_MAX_ATTEMPTS} for ${opName} in ${delay}ms (${cls})`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
    throw lastError;
  }

  // ─── Health ────────────────────────────────────────────

  isHealthy(): boolean {
    return this.health.status !== 'down';
  }

  getHealth(): ModelHealth {
    return { ...this.health };
  }
}

