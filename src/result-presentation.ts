import { SearchResult } from "./types";

/** Score-only changes can update in place. A soft refresh is reserved for a
 * visible change in membership, order, source, or excerpt content. */
export function hasMaterialResultChange(
  previous: readonly SearchResult[],
  next: readonly SearchResult[]
): boolean {
  if (previous.length !== next.length) return true;
  return previous.some((result, index) => {
    const candidate = next[index];
    return !candidate ||
      result.id !== candidate.id ||
      result.contentHash !== candidate.contentHash ||
      result.fileName !== candidate.fileName ||
      result.text !== candidate.text ||
      result.breadcrumb.join("\u0000") !== candidate.breadcrumb.join("\u0000");
  });
}
