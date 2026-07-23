export interface QueryContext {
  query: string;
  heading?: string;
  currentParagraph: string;
  previousParagraph?: string;
}

function paragraphAround(lines: string[], line: number): { text: string; start: number; end: number } {
  let start = Math.max(0, Math.min(line, lines.length - 1));
  let end = start;
  const isBoundary = (value: string | undefined) => !value?.trim() || /^#{1,6}\s/.test(value);
  while (start > 0 && !isBoundary(lines[start - 1])) start--;
  while (end < lines.length - 1 && !isBoundary(lines[end + 1])) end++;
  return { text: lines.slice(start, end + 1).join("\n").trim(), start, end };
}

function activeHeading(lines: string[], line: number): string | undefined {
  const path: string[] = [];
  for (let index = 0; index <= Math.min(line, lines.length - 1); index++) {
    const match = lines[index].match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!match) continue;
    const depth = match[1].length;
    path.length = depth - 1;
    path[depth - 1] = match[2].trim();
  }
  return path.filter(Boolean).join(" > ") || undefined;
}

/** Builds a bounded local context directly from the live editor buffer. */
export function buildQueryContext(markdown: string, cursorLine: number, maxLength: number): QueryContext {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const current = paragraphAround(lines, cursorLine);
  let previous: string | undefined;
  if (current.start > 0) {
    let candidate = current.start - 1;
    while (candidate >= 0 && (!lines[candidate].trim() || /^#{1,6}\s/.test(lines[candidate]))) candidate--;
    if (candidate >= 0) previous = paragraphAround(lines, candidate).text || undefined;
  }
  const heading = activeHeading(lines, cursorLine);
  const parts = [heading ? `标题：${heading}` : "", previous ? `前文：${previous}` : "", `当前段落：${current.text}`].filter(Boolean);
  let query = parts.join("\n");
  if (query.length > maxLength) {
    // Current paragraph is the highest-signal part, so preserve it preferentially.
    query = [heading ? `标题：${heading}` : "", `当前段落：${current.text}`].filter(Boolean).join("\n");
    if (query.length > maxLength) query = query.slice(0, maxLength);
  }
  return { query, heading, currentParagraph: current.text, previousParagraph: previous };
}
