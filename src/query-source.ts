/** Pure query-range state. Obsidian-specific editor access stays in main.ts. */
export type QuerySource =
  | { kind: "paragraph"; text: string; startLine: number }
  | { kind: "selection-once" | "selection-follow"; text: string };

export type QuerySourceKind = QuerySource["kind"];

/** Cursor lines are zero-based; an absent cursor must never imply the whole document. */
export function paragraphQuerySource(documentText: string, cursorLine: number | undefined): Extract<QuerySource, { kind: "paragraph" }> {
  const lines = documentText.split(/\r?\n/);
  const setextUnderline = (line: number) => line > 0 && line < lines.length && Boolean(lines[line - 1].trim()) && /^ {0,3}(?:=+|-+)\s*$/.test(lines[line]);
  const boundary = (line: number) => !lines[line].trim() || /^ {0,3}#{1,6}(?:\s|$)/.test(lines[line]) || setextUnderline(line) || setextUnderline(line + 1);
  if (cursorLine === undefined || !Number.isInteger(cursorLine) || cursorLine < 0 || cursorLine >= lines.length || boundary(cursorLine)) {
    return { kind: "paragraph", text: "", startLine: cursorLine ?? -1 };
  }
  let startLine = cursorLine;
  let endLine = cursorLine;
  while (startLine > 0 && !boundary(startLine - 1)) startLine--;
  while (endLine + 1 < lines.length && !boundary(endLine + 1)) endLine++;
  return { kind: "paragraph", text: lines.slice(startLine, endLine + 1).join("\n").trim(), startLine };
}

export function sameQueryParagraph(left: QuerySource | undefined, right: QuerySource): boolean {
  return left?.kind === "paragraph" && right.kind === "paragraph" && left.startLine === right.startLine && left.text === right.text;
}

export interface QueryScopePresentation {
  kind: "paragraph" | "once" | "following" | "waiting";
  text: string;
  tooltip: string;
}

export type SelectionButtonAction =
  | { kind: "one-shot"; source: QuerySource }
  | { kind: "follow-enabled" }
  | { kind: "follow-disabled" }
  | { kind: "short-selection" };

export function isValidQueryText(text: string): boolean {
  return text.replace(/\s/g, "").length >= 8;
}

/** Chooses the selected text exposed by the currently active Markdown surface. */
export function currentQuerySelection(editorSelection: string, renderedSelection?: string, readingView = false): string {
  if (readingView) return renderedSelection ?? "";
  return renderedSelection?.length ? renderedSelection : editorSelection;
}

/**
 * Owns the difference between the current paragraph source, an explicit
 * selection snapshot, and persistent follow-selection mode.
 */
export class QuerySourceCoordinator {
  private followingSelection = false;
  private lastOneShot = false;
  private paragraphText = "";

  get isFollowingSelection(): boolean { return this.followingSelection; }

  selectionButton(selection: string): SelectionButtonAction {
    if (this.followingSelection) {
      this.followingSelection = false;
      this.lastOneShot = false;
      return { kind: "follow-disabled" };
    }
    if (selection.length > 0 && !isValidQueryText(selection)) return { kind: "short-selection" };
    if (isValidQueryText(selection)) {
      return { kind: "one-shot", source: { kind: "selection-once", text: selection } };
    }
    this.followingSelection = true;
    this.lastOneShot = false;
    return { kind: "follow-enabled" };
  }

  /**
   * Records a source only once the host has decided to schedule it. Candidate
   * calculation must remain side-effect free so an inactive editor cannot
   * accidentally change the range label.
   */
  adopt(source: QuerySource): void {
    if (source.kind === "paragraph") {
      this.lastOneShot = false;
      this.paragraphText = source.text;
    }
    else if (source.kind === "selection-once") this.lastOneShot = true;
  }

  sourceForCurrentSelection(documentText: string, selection: string, cursorLine?: number): QuerySource | undefined {
    if (!this.followingSelection) return paragraphQuerySource(documentText, cursorLine);
    return isValidQueryText(selection) ? { kind: "selection-follow", text: selection } : undefined;
  }

  presentation(selection: string): QueryScopePresentation {
    if (this.followingSelection) {
      if (isValidQueryText(selection)) return { kind: "following", text: "查询模式：跟随选区", tooltip: "关闭跟随选区查询" };
      return selection.length === 0
        ? { kind: "waiting", text: "查询模式：跟随选区 · 等待选择", tooltip: "关闭跟随选区查询" }
        : { kind: "waiting", text: "查询模式：跟随选区 · 至少选择 8 个非空白字符", tooltip: "关闭跟随选区查询" };
    }
    if (this.lastOneShot) return { kind: "once", text: "本次结果：选中内容 · 单次查询", tooltip: "查询选中内容" };
    return {
      kind: "paragraph",
      text: isValidQueryText(this.paragraphText) ? "查询范围：当前段落" : "查询范围：当前段落 · 等待至少 8 个非空白字符",
      tooltip: isValidQueryText(selection) ? "查询选中内容" : "开启跟随选区查询"
    };
  }
}
