import { IndexScope, isPathExcluded, sameIndexScope } from "./index-scope";

export interface IndexScopeTransitionInput {
  effectiveScope: IndexScope;
  desiredScope: IndexScope;
  /** Every current Markdown path in the vault, whether currently indexed or not. */
  markdownPaths: readonly string[];
  /** Includes both indexed and skipped document paths in the effective index. */
  indexedDocumentPaths: readonly string[];
}

export interface IndexScopeTransition {
  hasScopeChange: boolean;
  upsertPaths: string[];
  deletePaths: string[];
}

/**
 * Plans the document delta for changing an already-ready index's scope.
 * Scope membership is intentionally delegated to isPathExcluded so directory
 * boundaries and nested exclusions behave identically everywhere.
 */
export function planIndexScopeTransition(input: IndexScopeTransitionInput): IndexScopeTransition {
  const hasScopeChange = !sameIndexScope(input.effectiveScope, input.desiredScope);
  if (!hasScopeChange) return { hasScopeChange, upsertPaths: [], deletePaths: [] };

  const upsertPaths = [...new Set(input.markdownPaths)]
    .filter((path) => isPathExcluded(path, input.effectiveScope) && !isPathExcluded(path, input.desiredScope))
    .sort();
  const deletePaths = [...new Set(input.indexedDocumentPaths)]
    .filter((path) => !isPathExcluded(path, input.effectiveScope) && isPathExcluded(path, input.desiredScope))
    .sort();

  return { hasScopeChange, upsertPaths, deletePaths };
}
