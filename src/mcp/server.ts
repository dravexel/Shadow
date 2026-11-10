// ============================================================
// ShadowForge — MCP Server
//
// A local HTTP server exposing repository tools as MCP endpoints.
// Runs on 127.0.0.1 only (never externally accessible).
// TrueForge connects to this via its MCP integration.
// ============================================================

import * as http from 'http';
import * as crypto from 'crypto';
import { ShadowWorkspace } from '../shadow-workspace/change-set';
import { ContextEngine } from '../context-engine/indexer';
import { handleRepoMap } from './tools/repo-map';
import { handleSearchWorkspace } from './tools/search-workspace';
import { handleFindSymbol, handleGetSymbol } from './tools/symbols';
import { handleReadRange } from './tools/read-range';
import { handleProposeEdit } from './tools/propose-edit';
import { handleRequestReview } from './tools/request-review';
import { handleRunCommand } from './tools/run-command';
import { MCP_HOST, MCP_DEFAULT_PORT } from '../shared/constants';

export interface MCPServerOptions {
  port?: number;
  workspaceRoot: string;
  shadow: ShadowWorkspace;
  contextEngine: ContextEngine;
  onReviewRequested: (changeSetId: string) => void;
  onCommandApprovalNeeded: (cmd: string, args: string[]) => Promise<boolean>;
}

// MCP Tool definition (sent to TrueForge on registration)
export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const TOOLS: MCPTool[] = [
  {
    name: 'repo_map',
    description: 'Return a compact tree of the repository structure and top symbols. Use this first to understand the codebase layout.',
    inputSchema: {
      type: 'object',
      properties: {
        maxDepth: { type: 'number', description: 'Max directory depth (default: 4)' },
        focusPath: { type: 'string', description: 'Optional sub-path to focus on' },
      },
    },
  },
  {
    name: 'search_workspace',
    description: 'Lexical search across repository files. Returns ranked snippets. Use to find where a function, class, or term is defined or used.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        filePattern: { type: 'string', description: 'Optional glob pattern to restrict search (e.g. "*.py")' },
        maxResults: { type: 'number', description: 'Max results to return (default: 20)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'find_symbol',
    description: 'Find where a function, class, or variable is defined in the repository.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Symbol name to find' },
        kind: { type: 'string', enum: ['function', 'class', 'method', 'variable', 'any'], description: 'Symbol kind' },
      },
      required: ['name'],
    },
  },
  {
    name: 'get_symbol',
    description: 'Read the full source code of a symbol (function, class, method) by name and file.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Symbol name' },
        filePath: { type: 'string', description: 'File path where the symbol is defined' },
      },
      required: ['name', 'filePath'],
    },
  },
  {
    name: 'read_range',
    description: 'Read a range of lines from a file. Respects the shadow workspace overlay.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'File path (relative to workspace root)' },
        startLine: { type: 'number', description: 'Start line (1-indexed)' },
        endLine: { type: 'number', description: 'End line (1-indexed, inclusive)' },
      },
      required: ['filePath'],
    },
  },
  {
    name: 'propose_edit',
    description: 'Stage proposed code changes in the shadow workspace for user review. NEVER writes directly to files. The user must approve before changes are applied.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'File to edit (relative to workspace root)' },
        hunks: {
          type: 'array',
          description: 'List of edit hunks',
          items: {
            type: 'object',
            properties: {
              originalStart: { type: 'number', description: 'Start line in original file (1-indexed)' },
              originalLines: { type: 'array', items: { type: 'string' }, description: 'Original lines to replace' },
              newLines: { type: 'array', items: { type: 'string' }, description: 'New lines to insert' },
            },
            required: ['originalStart', 'originalLines', 'newLines'],
          },
        },
        reason: { type: 'string', description: 'Brief explanation of why this change is needed' },
      },
      required: ['filePath', 'hunks'],
    },
  },
  {
    name: 'request_review',
    description: 'Request the user to review and approve all staged changes. Must be called after propose_edit.',
    inputSchema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'Summary of all proposed changes' },
        changeSetId: { type: 'string', description: 'The change set ID to review' },
      },
      required: ['summary'],
    },
  },
  {
    name: 'run_command',
    description: 'Run an allowlisted terminal command (e.g. pytest, git). Requires user approval.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Command to run (must be in allowlist)' },
        args: { type: 'array', items: { type: 'string' }, description: 'Command arguments' },
        cwd: { type: 'string', description: 'Working directory (defaults to workspace root)' },
      },
      required: ['command'],
    },
  },
];

export class MCPServer {
  private server: http.Server | null = null;
  private bearerToken: string;
  private opts: MCPServerOptions;
  private currentTurnId = '';
  private currentSessionId = '';

  constructor(opts: MCPServerOptions) {
    this.opts = opts;
    // Generate a random bearer token for local auth
    this.bearerToken = crypto.randomBytes(32).toString('hex');
  }

  getBearerToken(): string {
    return this.bearerToken;
  }

  getPort(): number {
    return this.opts.port ?? MCP_DEFAULT_PORT;
  }

  setTurnContext(sessionId: string, turnId: string): void {
    this.currentSessionId = sessionId;
    this.currentTurnId = turnId;
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res).catch(err => {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: String(err) }));
        });
      });

      this.server.listen(this.getPort(), MCP_HOST, () => {
        console.log(`[MCPServer] Listening on http://${MCP_HOST}:${this.getPort()}`);
        resolve();
      });

      this.server.on('error', reject);
    });
  }

  stop(): Promise<void> {
    return new Promise(resolve => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  // ─── MCP Protocol Handler ───────────────────────────────

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // Auth check
    const auth = req.headers['authorization'];
    if (auth !== `Bearer ${this.bearerToken}`) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    const url = new URL(req.url || '/', `http://${MCP_HOST}:${this.getPort()}`);

    // GET /tools — list all tools (MCP tool discovery)
    if (req.method === 'GET' && url.pathname === '/tools') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ tools: TOOLS }));
      return;
    }

    // POST /tools/:toolName — execute a tool
    const match = url.pathname.match(/^\/tools\/([a-z_]+)$/);
    if (req.method === 'POST' && match) {
      const toolName = match[1];
      const body = await this.readBody(req);
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(body);
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON body' }));
        return;
      }

      try {
        const result = await this.dispatchTool(toolName, args);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ result }));
      } catch (err) {
        res.writeHead(422, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err) }));
      }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }

  private async dispatchTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const workspaceRoot = this.opts.workspaceRoot;
    const shadow = this.opts.shadow;
    const ctx = this.opts.contextEngine;

    switch (name) {
      case 'repo_map':
        return handleRepoMap({ workspaceRoot, maxDepth: args.maxDepth as number, focusPath: args.focusPath as string });
      case 'search_workspace':
        return handleSearchWorkspace({ workspaceRoot, shadow, query: args.query as string, filePattern: args.filePattern as string, maxResults: args.maxResults as number, ctx });
      case 'find_symbol':
        return handleFindSymbol({ workspaceRoot, name: args.name as string, kind: args.kind as string, ctx });
      case 'get_symbol':
        return handleGetSymbol({ workspaceRoot, name: args.name as string, filePath: args.filePath as string, shadow });
      case 'read_range':
        return handleReadRange({ workspaceRoot, filePath: args.filePath as string, startLine: args.startLine as number, endLine: args.endLine as number, shadow });
      case 'propose_edit':
        return handleProposeEdit({ workspaceRoot, filePath: args.filePath as string, hunks: args.hunks as ProposeEditHunk[], reason: args.reason as string, shadow, sessionId: this.currentSessionId, turnId: this.currentTurnId });
      case 'request_review':
        return handleRequestReview({ summary: args.summary as string, changeSetId: args.changeSetId as string, shadow, onReviewRequested: this.opts.onReviewRequested });
      case 'run_command':
        return handleRunCommand({ workspaceRoot, command: args.command as string, args: args.args as string[], cwd: args.cwd as string, onApprovalNeeded: this.opts.onCommandApprovalNeeded });
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  private readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => resolve(body));
      req.on('error', reject);
    });
  }
}

// Re-export hunk type for tools
export interface ProposeEditHunk {
  originalStart: number;
  originalLines: string[];
  newLines: string[];
}
