// ============================================================
// MCP Tool: request_review
// Triggers the diff review UI and waits for user approval.
// ============================================================

import { ShadowWorkspace } from '../../shadow-workspace/change-set';

interface RequestReviewArgs {
  summary: string;
  changeSetId?: string;
  shadow: ShadowWorkspace;
  onReviewRequested: (changeSetId: string) => void;
}

export async function handleRequestReview(args: RequestReviewArgs): Promise<{
  status: 'review-requested';
  changeSetId: string;
  pendingHunks: number;
  message: string;
}> {
  const { summary, shadow, onReviewRequested } = args;

  // Get all pending change sets
  const pendingSets = shadow.getAllPendingChangeSets();

  if (pendingSets.length === 0) {
    throw new Error('No pending changes to review. Use propose_edit first.');
  }

  // If a specific changeSetId was given, verify it exists
  let targetChangeSetId: string;
  if (args.changeSetId) {
    const cs = shadow.getChangeSet(args.changeSetId);
    if (!cs) {
      throw new Error(`ChangeSet '${args.changeSetId}' not found`);
    }
    targetChangeSetId = args.changeSetId;
  } else {
    // Use the most recent pending change set
    targetChangeSetId = pendingSets[pendingSets.length - 1].id;
  }

  const cs = shadow.getChangeSet(targetChangeSetId)!;
  const totalHunks = cs.edits.reduce((sum, e) => sum + e.hunks.filter(h => h.status === 'pending').length, 0);

  // Notify the extension to open the diff review panel
  onReviewRequested(targetChangeSetId);

  return {
    status: 'review-requested',
    changeSetId: targetChangeSetId,
    pendingHunks: totalHunks,
    message: `Review requested for ${totalHunks} hunk(s). ${summary}. The user will accept or reject each hunk in the VS Code diff panel.`,
  };
}
