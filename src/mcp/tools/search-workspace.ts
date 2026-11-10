// ============================================================
// MCP Tool: search_workspace
// BM25-inspired lexical search across repository files.
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import { IGNORE_PATTERNS, LANGUAGE_MAP, MAX_INDEX_FILE_SIZE } from '../../shared/constants';
import { SearchResult } from '../../shared/types';
import { ShadowWorkspace } from '../../shadow-workspace/change-set';
import { ContextEngine } from '../../context-engine/indexer';
import micromatch from 'micromatch';

interface SearchArgs {
  workspaceRoot: string;
  shadow: ShadowWorkspace;
  ctx: ContextEngine;
  query: string;
  filePattern?: string;
  maxResults?: number;
}

export async function handleSearchWorkspace(args: SearchArgs): Promise<SearchResult[]> {
  const { workspaceRoot, shadow, query, filePattern, maxResults = 20 } = args;

  // Tokenize query
  const queryTerms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const results: SearchResult[] = [];

  // Collect all files
  const files = collectFiles(workspaceRoot, filePattern);

  for (const relPath of files) {
    const absPath = path.join(workspaceRoot, relPath);
    const content = shadow.getProposedOrReal(absPath);
    const lines = content.split('\n');

    // Score each line using TF-IDF-like scoring
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineLower = line.toLowerCase();
      let score = 0;

      for (const term of queryTerms) {
        // Count occurrences in this line
        let count = 0;
        let idx = 0;
        while ((idx = lineLower.indexOf(term, idx)) !== -1) {
          count++;
          idx += term.length;
        }
        if (count > 0) {
          // TF score (normalized)
          score += count / Math.max(lineLower.length, 1) * 100;
          // Exact word boundary bonus
          const wordBoundary = new RegExp(`\\b${escapeRegex(term)}\\b`);
          if (wordBoundary.test(lineLower)) score += 5;
        }
      }

      if (score > 0) {
        results.push({
          filePath: relPath,
          lineNumber: i + 1,
          line: line.trim(),
          score,
        });
      }
    }
  }

  // Sort by score descending, deduplicate by file (keep best line)
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, maxResults);
}

function collectFiles(workspaceRoot: string, filePattern?: string): string[] {
  const results: string[] = [];

  function walk(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = path.relative(workspaceRoot, fullPath);

      if (micromatch.isMatch(relPath, IGNORE_PATTERNS, { dot: true })) continue;

      if (entry.isDirectory()) {
        walk(fullPath);
      } else {
        const ext = path.extname(entry.name);
        const lang = LANGUAGE_MAP[ext];
        if (!lang) continue;

        try {
          const size = fs.statSync(fullPath).size;
          if (size > MAX_INDEX_FILE_SIZE) continue;
        } catch {
          continue;
        }

        if (filePattern && !micromatch.isMatch(relPath, filePattern)) continue;
        results.push(relPath);
      }
    }
  }

  walk(workspaceRoot);
  return results;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
