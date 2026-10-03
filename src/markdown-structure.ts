export interface MarkdownLine {
  text: string;
  /** Zero-based original source position. */
  index: number;
  kind: "text" | "frontmatter" | "heading" | "heading-underline" | "fence" | "code";
  heading?: { depth: number; text: string };
}

/** Shared structural facts, not a full Markdown parser or a chunking policy. */
export function markdownStructure(markdown: string): MarkdownLine[] {
  const lines: MarkdownLine[] = markdown.replace(/\r\n/g, "\n").split("\n")
    .map((text, index) => ({ text, index, kind: "text" }));
  let start = 0;
  if (lines[0].text.trim() === "---") {
    const end = lines.findIndex((line, index) => index > 0 && ["---", "..."].includes(line.text.trim()));
    if (end > 0) {
      for (let i = 0; i <= end; i++) lines[i].kind = "frontmatter";
      start = end + 1;
    }
  }
  let fence: { character: string; length: number } | undefined;
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    if (fence) {
      const closing = line.text.match(/^ {0,3}(`+|~+)[\t ]*$/);
      if (closing && closing[1][0] === fence.character && closing[1].length >= fence.length) {
        line.kind = "fence";
        fence = undefined;
      } else line.kind = "code";
      continue;
    }
    const opening = line.text.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (opening && !(opening[1][0] === "`" && opening[2].includes("`"))) {
      line.kind = "fence";
      fence = { character: opening[1][0], length: opening[1].length };
      continue;
    }
    const atx = line.text.match(/^ {0,3}(#{1,6})(?:[\t ]+(.*)|$)/);
    if (atx) {
      line.kind = "heading";
      const title = (atx[2] ?? "").replace(/(?:^|[\t ]+)#+[\t ]*$/, "").trim();
      line.heading = { depth: atx[1].length, text: title };
      continue;
    }
    const underline = line.text.match(/^ {0,3}(=+|-+)[\t ]*$/);
    const previous = lines[i - 1];
    if (underline && previous?.kind === "text" && previous.text.trim() &&
        !/^ {4}|^\t|^ {0,3}(?:=+|-+)[\t ]*$/.test(previous.text)) {
      previous.kind = "heading";
      previous.heading = { depth: underline[1][0] === "=" ? 1 : 2, text: previous.text.trim() };
      line.kind = "heading-underline";
    }
  }
  return lines;
}
