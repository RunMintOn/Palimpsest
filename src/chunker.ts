import { CHUNKER_VERSION, Chunk } from "./types";

export interface ChunkerOptions {
  targetLength: number;
  maxLength: number;
  minLength: number;
}

interface Paragraph {
  text: string;
  startLine: number;
  endLine: number;
  breadcrumb: string[];
}

/** A deterministic non-cryptographic fingerprint, adequate for cache identity. */
export function stableHash(value: string): string {
  let a = 0x811c9dc5;
  let b = 0x9e3779b9;
  for (let i = 0; i < value.length; i++) {
    a = Math.imul(a ^ value.charCodeAt(i), 0x01000193);
    b = Math.imul(b ^ value.charCodeAt(i), 0x85ebca6b);
  }
  return `${(a >>> 0).toString(16).padStart(8, "0")}${(b >>> 0).toString(16).padStart(8, "0")}`;
}

export function embeddingText(chunk: Chunk): string {
  const heading = chunk.breadcrumb.length ? chunk.breadcrumb.join(" > ") : "（无标题）";
  return `文件名：${chunk.fileName}\n标题：${heading}\n原文：\n${chunk.text}`;
}

function withoutFrontmatter(lines: string[]): Array<{ line: string; number: number }> {
  if (lines[0]?.trim() !== "---") return lines.map((line, i) => ({ line, number: i + 1 }));
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---" || lines[i].trim() === "...") {
      return lines.slice(i + 1).map((line, index) => ({ line, number: i + index + 2 }));
    }
  }
  return lines.map((line, i) => ({ line, number: i + 1 }));
}

function splitLongParagraph(paragraph: Paragraph, maxLength: number): Paragraph[] {
  if (paragraph.text.length <= maxLength) return [paragraph];
  const pieces = paragraph.text.match(/[^。！？!?\n]+[。！？!?]?|\S+/g) ?? [paragraph.text];
  const result: Paragraph[] = [];
  let text = "";
  for (const rawPiece of pieces) {
    let piece = rawPiece;
    if (text && text.length + piece.length > maxLength) {
      result.push({ ...paragraph, text });
      text = "";
    }
    // A single unbroken token is still split to honour the maximum.
    while (piece.length > maxLength && !text) {
      result.push({ ...paragraph, text: piece.slice(0, maxLength) });
      piece = piece.slice(maxLength);
    }
    text += piece;
  }
  if (text) result.push({ ...paragraph, text });
  return result;
}

/**
 * Splits Markdown into display-clean passage chunks. Heading and file metadata is
 * held separately, so it can enrich embeddings without polluting the excerpt UI.
 */
export function chunkMarkdown(filePath: string, markdown: string, options: ChunkerOptions): Chunk[] {
  if (options.minLength < 1 || options.targetLength < options.minLength || options.maxLength < options.targetLength) {
    throw new Error("Invalid chunk length settings");
  }
  const filename = filePath.split("/").pop()?.replace(/\.md$/i, "") ?? filePath;
  const source = withoutFrontmatter(markdown.replace(/\r\n/g, "\n").split("\n"));
  const headings: string[] = [];
  const paragraphs: Paragraph[] = [];
  let buffer: Array<{ line: string; number: number }> = [];
  const flush = () => {
    const text = buffer.map((item) => item.line).join("\n").trim();
    if (text) paragraphs.push({ text, startLine: buffer[0].number, endLine: buffer.at(-1)!.number, breadcrumb: [...headings] });
    buffer = [];
  };

  for (const item of source) {
    const match = item.line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (match) {
      flush();
      const depth = match[1].length;
      headings.length = depth - 1;
      headings[depth - 1] = match[2].trim();
      continue;
    }
    if (!item.line.trim()) flush();
    else buffer.push(item);
  }
  flush();

  const expanded = paragraphs.flatMap((paragraph) => splitLongParagraph(paragraph, options.maxLength));
  const groups: Paragraph[][] = [];
  let current: Paragraph[] = [];
  let currentLength = 0;
  const sameHeading = (a: Paragraph, b: Paragraph) => a.breadcrumb.join("\u0000") === b.breadcrumb.join("\u0000");
  for (const paragraph of expanded) {
    const separator = current.length ? 2 : 0;
    if (current.length && (!sameHeading(current[0], paragraph) || currentLength + separator + paragraph.text.length > options.maxLength || currentLength >= options.targetLength)) {
      groups.push(current);
      current = [];
      currentLength = 0;
    }
    current.push(paragraph);
    currentLength += separator + paragraph.text.length;
  }
  if (current.length) groups.push(current);

  // A short trailing group is more useful merged with its compatible predecessor.
  for (let i = groups.length - 1; i > 0; i--) {
    const group = groups[i];
    const previous = groups[i - 1];
    const length = group.map((p) => p.text).join("\n\n").length;
    const combined = previous.concat(group).map((p) => p.text).join("\n\n").length;
    if (length < options.minLength && sameHeading(previous[0], group[0]) && combined <= options.maxLength) {
      previous.push(...group);
      groups.splice(i, 1);
    }
  }

  return groups.map((group) => {
    const text = group.map((paragraph) => paragraph.text).join("\n\n");
    const first = group[0];
    const last = group.at(-1)!;
    const contentHash = stableHash(text);
    return {
      id: stableHash(`${CHUNKER_VERSION}\n${filePath}\n${first.breadcrumb.join(" > ")}\n${contentHash}`),
      contentHash,
      filePath,
      fileName: filename,
      breadcrumb: first.breadcrumb,
      text,
      startLine: first.startLine,
      endLine: last.endLine
    };
  });
}
