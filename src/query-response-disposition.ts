export interface QueryRequestState {
  automaticWorkAllowed: boolean;
  generationCurrent: boolean;
  bufferCurrent: boolean;
  markdownViewCurrent: boolean;
  pathCurrent: boolean;
  selectionCurrent: boolean;
}

export type QueryResponseDisposition = "apply" | "retry-current-buffer" | "discard";

export function queryRequestIsCurrent(state: QueryRequestState): boolean {
  return state.automaticWorkAllowed &&
    state.generationCurrent &&
    state.bufferCurrent &&
    state.markdownViewCurrent &&
    state.pathCurrent &&
    state.selectionCurrent;
}

/** Decides whether a completed embedding response may still update the sidebar. */
export function queryResponseDisposition(state: QueryRequestState): QueryResponseDisposition {
  if (queryRequestIsCurrent(state)) return "apply";
  // Obsidian can expose a newly opened Markdown view before its editor buffer
  // has finished loading. The request still owns the current view and query
  // generation, so retry from the settled buffer rather than leaving its
  // loading presentation indefinitely.
  if (state.automaticWorkAllowed &&
    state.generationCurrent &&
    !state.bufferCurrent &&
    state.markdownViewCurrent &&
    state.pathCurrent &&
    state.selectionCurrent) return "retry-current-buffer";
  return "discard";
}
