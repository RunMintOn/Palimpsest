import { SearchResult } from "./types";

/** User-facing density settings for rendered result excerpts. */
export interface ResultExcerptPresentation {
  fontScale: number;
  lineHeight: number;
  /** Zero leaves the excerpt unconstrained. */
  maxLines: number;
}

export interface ResultExcerptStyle {
  fontSize: string;
  lineHeight: string;
  maxHeight?: string;
}

export interface ExcerptExpansionControl {
  expandable: boolean;
  label: "展开全文" | "收起全文";
}

/** Presentation state for the overlaid Scheme-E excerpt control. */
export function excerptExpansionControl(maxLines: number, overflow: boolean, expanded: boolean): ExcerptExpansionControl {
  return {
    expandable: maxLines > 0 && overflow,
    label: expanded ? "收起全文" : "展开全文"
  };
}

/** Pure DOM-style model; keeping it here makes density behavior testable. */
export function resultExcerptStyle(
  presentation: ResultExcerptPresentation,
  showingFullExcerpt: boolean
): ResultExcerptStyle {
  const maxHeight = presentation.maxLines > 0 && !showingFullExcerpt
    ? `${presentation.maxLines * presentation.lineHeight}em`
    : undefined;
  return {
    fontSize: `${presentation.fontScale}em`,
    lineHeight: String(presentation.lineHeight),
    maxHeight
  };
}

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
