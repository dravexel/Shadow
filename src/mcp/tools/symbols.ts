// ============================================================
// MCP Tools: find_symbol & get_symbol
// Find and retrieve code symbols from the indexed repository.
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import { Symbol as CodeSymbol } from '../../shared/types';
import { ShadowWorkspace } from '../../shadow-workspace/change-set';
import { ContextEngine } from '../../context-engine/indexer';

// ─── find_symbol ─────────────────────────────────────────

interface FindSymbolArgs {
  workspaceRoot: string;
  name: string;
  kind?: string;
  ctx: ContextEngine;
}

export async function handleFindSymbol(args: FindSymbolArgs): Promise<CodeSymbol[]> {
  const { name, kind, ctx } = args;

  // Use the indexed symbol database
  const allSymbols = ctx.findSymbol(name, kind as CodeSymbol['kind'] | undefined);

  if (allSymbols.length === 0) {
    // Fallback: grep-style search for symbol name in files
    return [];
  }

  return allSymbols;
}

// ─── get_symbol ──────────────────────────────────────────

interface GetSymbolArgs {
  workspaceRoot: string;
  name: string;
  filePath: string;
  shadow: ShadowWorkspace;
}

export async function handleGetSymbol(args: GetSymbolArgs): Promise<{ filePath: string; name: string; source: string; startLine: number; endLine: number }> {
  const { workspaceRoot, name, filePath, shadow } = args;
  const absPath = path.isAbsolute(filePath)
    ? filePath
    : path.join(workspaceRoot, filePath);

  const content = shadow.getProposedOrReal(absPath);
  const lines = content.split('\n');

  // Simple heuristic symbol extraction (regex-based for common languages)
  const ext = path.extname(absPath);

  // Python patterns
  if (ext === '.py') {
    const result = extractPythonSymbol(lines, name);
    if (result) {
      return { filePath, name, ...result };
    }
  }

  // TypeScript/JavaScript patterns
  if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
    const result = extractTSSymbol(lines, name);
    if (result) {
      return { filePath, name, ...result };
    }
  }

  // Generic fallback: return lines around the name
  const idx = lines.findIndex(l => l.includes(name));
  if (idx !== -1) {
    const start = Math.max(0, idx - 2);
    const end = Math.min(lines.length - 1, idx + 20);
    return {
      filePath,
      name,
      source: lines.slice(start, end + 1).join('\n'),
      startLine: start + 1,
      endLine: end + 1,
    };
  }

  throw new Error(`Symbol '${name}' not found in ${filePath}`);
}

function extractPythonSymbol(lines: string[], name: string): { source: string; startLine: number; endLine: number } | null {
  // Find def or class
  const defPatterns = [
    new RegExp(`^(def|async def)\\s+${escapeRegex(name)}\\s*\\(`),
    new RegExp(`^class\\s+${escapeRegex(name)}\\s*[:(]`),
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (defPatterns.some(p => p.test(line.trim()))) {
      const startLine = i;
      // Find the end of the block by looking for the next def/class at same or lower indent
      const baseIndent = line.match(/^(\s*)/)?.[1].length ?? 0;
      let endLine = i;
      for (let j = i + 1; j < lines.length; j++) {
        const jLine = lines[j];
        if (jLine.trim() === '') { endLine = j; continue; }
        const jIndent = jLine.match(/^(\s*)/)?.[1].length ?? 0;
        if (jIndent <= baseIndent && jLine.trim() !== '') {
          endLine = j - 1;
          break;
        }
        endLine = j;
      }
      return {
        source: lines.slice(startLine, endLine + 1).join('\n'),
        startLine: startLine + 1,
        endLine: endLine + 1,
      };
    }
  }
  return null;
}

function extractTSSymbol(lines: string[], name: string): { source: string; startLine: number; endLine: number } | null {
  const patterns = [
    new RegExp(`(export\\s+)?(async\\s+)?function\\s+${escapeRegex(name)}\\s*[(<]`),
    new RegExp(`(export\\s+)?(abstract\\s+)?class\\s+${escapeRegex(name)}\\s*[{<(]`),
    new RegExp(`(export\\s+)?const\\s+${escapeRegex(name)}\\s*=`),
    new RegExp(`(export\\s+)?interface\\s+${escapeRegex(name)}\\s*[{<]`),
    new RegExp(`(export\\s+)?type\\s+${escapeRegex(name)}\\s*=`),
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (patterns.some(p => p.test(line))) {
      const startLine = i;
      // Track braces to find end
      let braceDepth = 0;
      let endLine = i;
      for (let j = i; j < Math.min(i + 200, lines.length); j++) {
        const jLine = lines[j];
        for (const ch of jLine) {
          if (ch === '{') braceDepth++;
          if (ch === '}') braceDepth--;
        }
        if (j > i && braceDepth === 0) {
          endLine = j;
          break;
        }
        if (j === Math.min(i + 200, lines.length) - 1) endLine = j;
      }
      return {
        source: lines.slice(startLine, endLine + 1).join('\n'),
        startLine: startLine + 1,
        endLine: endLine + 1,
      };
    }
  }
  return null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
