// ============================================================
// ShadowForge — Context Engine / Indexer
//
// Builds an index of files, symbols, and imports.
// Used by search tools and the retrieval system.
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { IndexedFile, Symbol as CodeSymbol, RetrievalResult, RetrievalSignal, LedgerEntry, ContextLedger } from '../shared/types';
import { IGNORE_PATTERNS, LANGUAGE_MAP, MAX_INDEX_FILE_SIZE, DEFAULT_CONTEXT_BUDGET_TOKENS, TOKENS_PER_LINE_ESTIMATE } from '../shared/constants';
import micromatch from 'micromatch';

// ─── Index Entry ─────────────────────────────────────────

export class ContextEngine {
  private index = new Map<string, IndexedFile>();
  private workspaceRoot: string;
  private indexReady = false;
  private indexPromise: Promise<void> | null = null;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  // ─── Indexing ─────────────────────────────────────────

  async buildIndex(): Promise<void> {
    if (this.indexPromise) return this.indexPromise;

    this.indexPromise = this._buildIndex();
    await this.indexPromise;
  }

  private async _buildIndex(): Promise<void> {
    const files = this.collectIndexableFiles();
    for (const relPath of files) {
      await this.indexFile(relPath);
    }
    this.indexReady = true;
    console.log(`[ContextEngine] Indexed ${this.index.size} files`);
  }

  async indexFile(relPath: string): Promise<void> {
    const absPath = path.join(this.workspaceRoot, relPath);
    try {
      const stat = fs.statSync(absPath);
      if (stat.size > MAX_INDEX_FILE_SIZE) return;

      const content = fs.readFileSync(absPath, 'utf-8');
      const hash = crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);

      // Check if already indexed and unchanged
      const existing = this.index.get(relPath);
      if (existing && existing.hash === hash) return;

      const ext = path.extname(absPath);
      const language = LANGUAGE_MAP[ext] || '';
      const lines = content.split('\n');
      const tokens = Math.ceil(lines.length * TOKENS_PER_LINE_ESTIMATE);

      const symbols = this.extractSymbols(lines, language, relPath);
      const imports = this.extractImports(lines, language);

      this.index.set(relPath, {
        path: relPath,
        content,
        language,
        symbols,
        imports,
        tokens,
        hash,
      });
    } catch {
      // Skip unreadable files
    }
  }

  private collectIndexableFiles(): string[] {
    const results: string[] = [];

    function walk(dir: string, root: string): void {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relPath = path.relative(root, fullPath);

        if (micromatch.isMatch(relPath, IGNORE_PATTERNS, { dot: true })) continue;

        if (entry.isDirectory()) {
          walk(fullPath, root);
        } else {
          const ext = path.extname(entry.name);
          if (LANGUAGE_MAP[ext]) {
            results.push(relPath);
          }
        }
      }
    }

    walk(this.workspaceRoot, this.workspaceRoot);
    return results;
  }

  // ─── Symbol Extraction ────────────────────────────────

  private extractSymbols(lines: string[], language: string, filePath: string): CodeSymbol[] {
    const symbols: CodeSymbol[] = [];

    if (language === 'python') {
      symbols.push(...this.extractPythonSymbols(lines, filePath));
    } else if (['typescript', 'typescriptreact', 'javascript', 'javascriptreact'].includes(language)) {
      symbols.push(...this.extractTSSymbols(lines, filePath));
    }

    return symbols;
  }

  private extractPythonSymbols(lines: string[], filePath: string): CodeSymbol[] {
    const symbols: CodeSymbol[] = [];
    const funcPattern = /^(\s*)(async\s+)?def\s+(\w+)\s*\(/;
    const classPattern = /^(\s*)class\s+(\w+)\s*[:(]/;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let match = line.match(funcPattern);
      if (match) {
        const docstring = this.extractDocstring(lines, i + 1);
        symbols.push({
          name: match[3],
          kind: 'function',
          filePath,
          startLine: i + 1,
          endLine: this.findPythonBlockEnd(lines, i),
          docstring,
        });
        continue;
      }
      match = line.match(classPattern);
      if (match) {
        symbols.push({
          name: match[2],
          kind: 'class',
          filePath,
          startLine: i + 1,
          endLine: this.findPythonBlockEnd(lines, i),
        });
      }
    }
    return symbols;
  }

  private extractTSSymbols(lines: string[], filePath: string): CodeSymbol[] {
    const symbols: CodeSymbol[] = [];
    const patterns: Array<{ pattern: RegExp; kind: CodeSymbol['kind'] }> = [
      { pattern: /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*[(<]/, kind: 'function' },
      { pattern: /(?:export\s+)?(?:abstract\s+)?class\s+(\w+)\s*[{<(]/, kind: 'class' },
      { pattern: /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(/, kind: 'function' },
      { pattern: /(?:export\s+)?interface\s+(\w+)\s*[{<]/, kind: 'class' },
    ];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const { pattern, kind } of patterns) {
        const match = line.match(pattern);
        if (match) {
          symbols.push({
            name: match[1],
            kind,
            filePath,
            startLine: i + 1,
            endLine: i + 1, // We'll leave end line approximate
          });
          break;
        }
      }
    }
    return symbols;
  }

  private extractDocstring(lines: string[], startIdx: number): string | undefined {
    // Look for Python triple-quoted docstring
    if (startIdx >= lines.length) return undefined;
    const firstLine = lines[startIdx].trim();
    if (!firstLine.startsWith('"""') && !firstLine.startsWith("'''")) return undefined;
    const quote = firstLine.startsWith('"""') ? '"""' : "'''";
    const result: string[] = [firstLine];
    if (firstLine.slice(3).includes(quote)) {
      return firstLine.slice(3, firstLine.lastIndexOf(quote));
    }
    for (let i = startIdx + 1; i < Math.min(startIdx + 20, lines.length); i++) {
      result.push(lines[i]);
      if (lines[i].includes(quote)) break;
    }
    return result.join('\n');
  }

  private findPythonBlockEnd(lines: string[], startIdx: number): number {
    const baseIndent = (lines[startIdx].match(/^(\s*)/) || ['', ''])[1].length;
    for (let i = startIdx + 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim() === '') continue;
      const indent = (line.match(/^(\s*)/) || ['', ''])[1].length;
      if (indent <= baseIndent) return i;
    }
    return lines.length;
  }

  // ─── Import Extraction ────────────────────────────────

  private extractImports(lines: string[], language: string): string[] {
    const imports: string[] = [];

    if (language === 'python') {
      for (const line of lines) {
        const m1 = line.match(/^import\s+(\S+)/);
        const m2 = line.match(/^from\s+(\S+)\s+import/);
        if (m1) imports.push(m1[1]);
        if (m2) imports.push(m2[1]);
      }
    } else if (['typescript', 'javascript', 'typescriptreact', 'javascriptreact'].includes(language)) {
      for (const line of lines) {
        const m = line.match(/^import\s+.*\s+from\s+['"]([^'"]+)['"]/);
        const m2 = line.match(/^(?:const|let|var)\s+.*\s*=\s*require\(['"]([^'"]+)['"]\)/);
        if (m) imports.push(m[1]);
        if (m2) imports.push(m2[1]);
      }
    }

    return imports;
  }

  // ─── Symbol Lookup ───────────────────────────────────

  findSymbol(name: string, kind?: CodeSymbol['kind']): CodeSymbol[] {
    const results: CodeSymbol[] = [];
    for (const [, indexed] of this.index) {
      for (const sym of indexed.symbols) {
        if (sym.name === name && (!kind || sym.kind === kind)) {
          results.push(sym);
        }
      }
    }
    return results;
  }

  getIndexedFile(relPath: string): IndexedFile | undefined {
    return this.index.get(relPath);
  }

  getAllFiles(): string[] {
    return Array.from(this.index.keys());
  }

  // ─── Retrieval ────────────────────────────────────────

  /**
   * Retrieves the most relevant files for a query.
   * Uses BM25-inspired scoring + import graph + symbol matching.
   */
  async retrieve(query: string, budget: number = DEFAULT_CONTEXT_BUDGET_TOKENS): Promise<RetrievalResult[]> {
    if (!this.indexReady) {
      await this.buildIndex();
    }

    const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
    const atMentions = this.parseAtMentions(query);
    const results: RetrievalResult[] = [];

    for (const [relPath, indexed] of this.index) {
      const signals: RetrievalSignal[] = [];
      let score = 0;

      // 1. BM25-style score
      const bm25 = this.scoreBM25(indexed.content, queryTerms);
      if (bm25 > 0) {
        score += bm25;
        signals.push('bm25-match');
      }

      // 2. Symbol name match
      const symMatch = indexed.symbols.some(s =>
        queryTerms.some(t => s.name.toLowerCase().includes(t))
      );
      if (symMatch) {
        score += 10;
        signals.push('symbol-match');
      }

      // 3. @mention bonus
      if (atMentions.some(m => relPath.includes(m) || relPath.endsWith(m))) {
        score += 50;
        signals.push('at-mention');
      }

      // 4. Test file bonus
      if (relPath.includes('test') && queryTerms.some(t => relPath.toLowerCase().includes(t))) {
        score += 5;
        signals.push('test-related');
      }

      // 5. Doc file bonus
      if ((relPath.endsWith('.rst') || relPath.endsWith('.md')) &&
        queryTerms.some(t => indexed.content.toLowerCase().includes(t))) {
        score += 3;
        signals.push('doc-related');
      }

      if (score > 0) {
        results.push({
          filePath: relPath,
          score,
          signals,
          snippets: this.extractSnippets(indexed.content, queryTerms),
          tokenCost: indexed.tokens,
        });
      }
    }

    // Sort by score
    results.sort((a, b) => b.score - a.score);

    // Budget packing: include results until budget is reached
    let usedTokens = 0;
    const packed: RetrievalResult[] = [];
    for (const r of results) {
      if (usedTokens + r.tokenCost > budget) break;
      packed.push(r);
      usedTokens += r.tokenCost;
    }

    return packed;
  }

  private parseAtMentions(query: string): string[] {
    const matches = query.match(/@(\S+)/g) || [];
    return matches.map(m => m.slice(1));
  }

  private scoreBM25(content: string, terms: string[]): number {
    const contentLower = content.toLowerCase();
    const words = contentLower.split(/\s+/);
    const wordCount = words.length;
    const avgLen = 500; // average document length
    const k1 = 1.5, b = 0.75;
    let score = 0;

    for (const term of terms) {
      let tf = 0;
      let idx = 0;
      while ((idx = contentLower.indexOf(term, idx)) !== -1) { tf++; idx++; }
      if (tf === 0) continue;

      const idf = Math.log(1 + (this.index.size + 1) / (1 + 1)); // simplified IDF
      const termScore = idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * wordCount / avgLen));
      score += termScore;
    }

    return score;
  }

  private extractSnippets(content: string, terms: string[]): Array<{ startLine: number; endLine: number; content: string }> {
    const lines = content.split('\n');
    const snippets: Array<{ startLine: number; endLine: number; content: string }> = [];
    const seen = new Set<number>();

    for (let i = 0; i < lines.length && snippets.length < 3; i++) {
      const lineLower = lines[i].toLowerCase();
      if (terms.some(t => lineLower.includes(t)) && !seen.has(i)) {
        const start = Math.max(0, i - 2);
        const end = Math.min(lines.length - 1, i + 5);
        for (let j = start; j <= end; j++) seen.add(j);
        snippets.push({
          startLine: start + 1,
          endLine: end + 1,
          content: lines.slice(start, end + 1).join('\n'),
        });
      }
    }

    return snippets;
  }

  // ─── Context Ledger ───────────────────────────────────

  buildLedger(query: string, results: RetrievalResult[], budget: number): ContextLedger {
    const usedTokens = results.reduce((sum, r) => sum + r.tokenCost, 0);
    const allPaths = this.getAllFiles();
    const usedPaths = new Set(results.map(r => r.filePath));
    const excluded = allPaths.filter(p => !usedPaths.has(p)).slice(0, 10);

    const entries: LedgerEntry[] = results.map((r, idx) => {
      const indexed = this.index.get(r.filePath);
      const symbols = indexed?.symbols.map(s => s.name).slice(0, 5) || [];
      const reasonParts: string[] = [];

      if (r.signals.includes('at-mention')) reasonParts.push('Explicitly @-mentioned');
      if (r.signals.includes('symbol-match')) reasonParts.push('Symbol name matches query');
      if (r.signals.includes('bm25-match')) reasonParts.push('Content lexically matches query');
      if (r.signals.includes('test-related')) reasonParts.push('Test file related to query');
      if (r.signals.includes('doc-related')) reasonParts.push('Documentation file related to query');

      return {
        filePath: r.filePath,
        symbols,
        reason: reasonParts.join('; ') || 'Relevant content match',
        signals: r.signals,
        tokenCost: r.tokenCost,
        rank: idx + 1,
      };
    });

    return {
      taskDescription: query,
      entries,
      totalTokens: usedTokens,
      budget,
      excluded,
      timestamp: Date.now(),
    };
  }
}

