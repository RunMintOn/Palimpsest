export interface IndexScope {
  excludedDirectories: string[];
}

export type IndexScopeStatus = "uninitialized" | "current" | "pending";

/** Normalizes a vault-relative directory path. The vault root becomes empty. */
export function normalizeDirectoryPath(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

/**
 * Converts both the legacy comma-separated setting and the structured setting
 * into one canonical representation suitable for persistence and comparison.
 */
export function indexScope(value: string | readonly string[] | undefined): IndexScope {
  const values = typeof value === "string" ? [value] : value ?? [];
  const excludedDirectories = values
    .flatMap((entry) => entry.split(/[\n,]/))
    .map(normalizeDirectoryPath)
    .filter(Boolean)
    .sort();
  return { excludedDirectories: [...new Set(excludedDirectories)] };
}

export function sameIndexScope(left: IndexScope, right: IndexScope): boolean {
  const leftDirectories = indexScope(left.excludedDirectories).excludedDirectories;
  const rightDirectories = indexScope(right.excludedDirectories).excludedDirectories;
  return leftDirectories.length === rightDirectories.length && leftDirectories.every((directory, index) => directory === rightDirectories[index]);
}

/** True when the path is the excluded directory itself or is beneath it. */
export function isPathExcluded(path: string, scope: IndexScope): boolean {
  const normalizedPath = normalizeDirectoryPath(path);
  return indexScope(scope.excludedDirectories).excludedDirectories
    .some((directory) => normalizedPath === directory || normalizedPath.startsWith(`${directory}/`));
}

/** True only when `ancestor` is a strict directory parent of `path`. */
export function isDirectoryAncestor(ancestor: string, path: string): boolean {
  const normalizedAncestor = normalizeDirectoryPath(ancestor);
  const normalizedPath = normalizeDirectoryPath(path);
  return Boolean(normalizedAncestor) && normalizedPath.startsWith(`${normalizedAncestor}/`);
}

/**
 * Adds a selected directory to a scope without retaining redundant children.
 * The vault root is intentionally not a valid excluded directory.
 */
export function addExcludedDirectory(existing: readonly string[], directory: string): string[] {
  const current = indexScope(existing).excludedDirectories;
  const selected = normalizeDirectoryPath(directory);
  if (!selected || current.some((excluded) => excluded === selected || isDirectoryAncestor(excluded, selected))) {
    return current;
  }
  return indexScope([...current.filter((excluded) => !isDirectoryAncestor(selected, excluded)), selected]).excludedDirectories;
}

/**
 * Keeps only real-folder candidate paths that are not already covered by the
 * requested exclusion scope. The caller supplies vault folders, not free text.
 */
export function filterExcludedDirectoryCandidates(candidates: readonly string[], existing: readonly string[]): string[] {
  const excluded = indexScope(existing);
  return indexScope(candidates).excludedDirectories
    .filter((candidate) => !isPathExcluded(candidate, excluded));
}

export function indexScopeStatus(desired: IndexScope, effective: IndexScope | undefined): IndexScopeStatus {
  if (!effective) return "uninitialized";
  return sameIndexScope(desired, effective) ? "current" : "pending";
}
