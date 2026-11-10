// ============================================================
// MCP Tool: read_range
// Reads a line range from a file, respecting shadow overlay.
// ============================================================

import * as path from 'path';
import { ShadowWorkspace } from '../../shadow-workspace/change-set';

interface ReadRangeArgs {
  workspaceRoot: string;
  filePath: string;
  startLine?: number;
  endLine?: number;
  shadow: ShadowWorkspace;
}

export async function handleReadRange(args: ReadRangeArgs): Promise<{ filePath: string; lines: string[]; startLine: number; endLine: number; isFromShadow: boolean }> {
  const { workspaceRoot, filePath, shadow } = args;

  const absPath = path.isAbsolute(filePath)
    ? filePath
    : path.join(workspaceRoot, filePath);

  const content = shadow.getProposedOrReal(absPath);
  const isFromShadow = shadow.hasProposedContent(absPath);
  const allLines = content.split('\n');

  const startLine = Math.max(1, args.startLine ?? 1);
  const endLine = Math.min(allLines.length, args.endLine ?? allLines.length);

  const lines = allLines.slice(startLine - 1, endLine);

  return {
    filePath,
    lines,
    startLine,
    endLine,
    isFromShadow,
  };
}

