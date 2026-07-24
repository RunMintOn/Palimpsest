/** All conditions that permit a user-initiated effective-scope patch. */
export interface IndexScopeApplicationState {
  scopePending: boolean;
  indexReady: boolean;
  buildActive: boolean;
  fullBuildRequestActive: boolean;
  fallbackGenerationInUse: boolean;
  /** A cancelled ordinary bulk update remains intentionally rebuild-only. */
  deferredLargeIndexUpdate: boolean;
  applying: boolean;
}

/** Scope patches must not bypass any state that deliberately blocks normal patches. */
export function canApplyIndexScopeChange(state: IndexScopeApplicationState): boolean {
  return state.scopePending && state.indexReady && !state.buildActive && !state.fullBuildRequestActive &&
    !state.fallbackGenerationInUse && !state.deferredLargeIndexUpdate && !state.applying;
}

/** An explicit scope change can alter any result set, even when it touches the active note. */
export function shouldRefreshAfterIndexScopeChange(input: { upsertCount: number; deleteCount: number }): boolean {
  return input.upsertCount > 0 || input.deleteCount > 0;
}
