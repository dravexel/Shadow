// ============================================================
// MCP Tool: propose_edit
// Stages proposed changes in shadow workspace (never writes to disk).
// ============================================================

import * as path from 'path';
import * as fs from 'fs';
import { ShadowWorkspace } from '../../shadow-workspace/change-set';
import { ProposeEditHunk } from '../server';

interface ProposeEditArgs {
  workspaceRoot: string;
  filePath: string;
  hunks: ProposeEditHunk[];
  reason?: string;
  shadow: ShadowWorkspace;
  sessionId: string;
  turnId: string;
}

export async function handleProposeEdit(args: ProposeEditArgs): Promise<{
  status: 'staged';
  editId: string;
  filePath: string;
  hunkCount: number;
  message: string;
}> {
  const { workspaceRoot, filePath, hunks, reason, shadow, sessionId, turnId } = args;

  const absPath = path.isAbsolute(filePath)
    ? filePath
    : path.join(workspaceRoot, filePath);

  // Validate: file must exist OR it's a new file
  const fileExists = fs.existsSync(absPath);
  if (!fileExists) {
    // For new files, the originalLines should all be empty
    const allNew = hunks.every(h => h.originalLines.length === 0);
    if (!allNew) {
      throw new Error(
        `File '${filePath}' does not exist. For new files, set originalLines to [] and provide all content in newLines.`
      );
    }
  }

  // Validate hunks
  if (!hunks || hunks.length === 0) {
    throw new Error('hunks must be a non-empty array');
  }

  for (const hunk of hunks) {
    if (typeof hunk.originalStart !== 'number' || hunk.originalStart < 1) {
      throw new Error(`Invalid hunk: originalStart must be >= 1, got ${hunk.originalStart}`);
    }
    if (!Array.isArray(hunk.originalLines) || !Array.isArray(hunk.newLines)) {
      throw new Error('Invalid hunk: originalLines and newLines must be arrays');
    }
  }

  // Stage in shadow workspace
  const edit = shadow.proposeEdit(turnId, sessionId, absPath, hunks, reason);

  return {
    status: 'staged',
    editId: edit.id,
    filePath,
    hunkCount: edit.hunks.length,
    message: `${edit.hunks.length} hunk(s) staged for review in '${filePath}'. Call request_review to show the diff to the user.`,
  };
}
