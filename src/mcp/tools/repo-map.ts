// ============================================================
// MCP Tool: repo_map
// Returns a compact tree of the repository.
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import { IGNORE_PATTERNS, LANGUAGE_MAP, MAX_INDEX_FILE_SIZE } from '../../shared/constants';
import { RepoMapResult } from '../../shared/types';
import micromatch from 'micromatch';

interface RepoMapArgs {
  workspaceRoot: string;
  maxDepth?: number;
  focusPath?: string;
}

export async function handleRepoMap(args: RepoMapArgs): Promise<RepoMapResult> {
  const root = args.focusPath
    ? path.join(args.workspaceRoot, args.focusPath)
    : args.workspaceRoot;
  const maxDepth = args.maxDepth ?? 4;

  const lines: string[] = [];
  const topFiles: { path: string; symbolCount: number }[] = [];
  let totalFiles = 0;

  function walk(dir: string, prefix: string, depth: number): void {
    if (depth > maxDepth) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    // Sort: directories first, then files
    entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = path.relative(args.workspaceRoot, fullPath);

      // Check ignore patterns
      if (micromatch.isMatch(relPath, IGNORE_PATTERNS, { dot: true })) continue;
      if (entry.name.startsWith('.') && depth === 0) continue;

      if (entry.isDirectory()) {
        lines.push(`${prefix}${entry.name}/`);
        walk(fullPath, prefix + '  ', depth + 1);
      } else {
        const ext = path.extname(entry.name);
        const lang = LANGUAGE_MAP[ext] || '';
        const size = fs.statSync(fullPath).size;
        const sizeStr = size > 1024 ? `${Math.round(size / 1024)}KB` : `${size}B`;
        lines.push(`${prefix}${entry.name}  [${lang || ext || '?'}, ${sizeStr}]`);
        totalFiles++;

        if (size < MAX_INDEX_FILE_SIZE && lang) {
          topFiles.push({ path: relPath, symbolCount: 0 });
        }
      }
    }
  }

  walk(root, '', 0);

  return {
    tree: lines.join('\n'),
    topFiles: topFiles.slice(0, 20),
    totalFiles,
  };
}

