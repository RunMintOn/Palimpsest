/**
 * The shared post-update decision. Call it only after the operation's running
 * flags have been cleared, so a requested query refresh is not self-blocked.
 */
export interface IndexUpdateCompletionInput {
  pluginActive: boolean;
  indexReady: boolean;
  buildActive: boolean;
  pendingChanges: number;
  fallbackGenerationInUse: boolean;
  deferredLargeIndexUpdate: boolean;
  patchSucceeded: boolean;
  refreshRequested: boolean;
  /** Ordinary failed batches stay deferred; manual retries must resume new events. */
  schedulePendingAfterFailure: boolean;
}

export interface IndexUpdateCompletionActions {
  refreshQuery: boolean;
  schedulePending: boolean;
}

export function completionActions(input: IndexUpdateCompletionInput): IndexUpdateCompletionActions {
  const canResumePatches = input.pluginActive && input.indexReady && !input.buildActive &&
    !input.fallbackGenerationInUse && !input.deferredLargeIndexUpdate;
  return {
    refreshQuery: input.pluginActive && input.patchSucceeded && input.refreshRequested,
    schedulePending: canResumePatches && input.pendingChanges > 0 &&
      (input.patchSucceeded || input.schedulePendingAfterFailure)
  };
}
