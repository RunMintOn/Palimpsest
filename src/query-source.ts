/** Pure query-range state. Obsidian-specific editor access stays in main.ts. */
export type QuerySourceKind = "document" | "selection-once" | "selection-follow";

export interface QuerySource {
  kind: QuerySourceKind;
  text: string;
}

export interface QueryScopePresentation {
  kind: "document" | "once" | "following" | "waiting";
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
export function currentQuerySelection(editorSelection: string, renderedSelection?: string): string {
  return renderedSelection?.length ? renderedSelection : editorSelection;
}

/**
 * Owns the difference between the normal document source, an explicit
 * selection snapshot, and persistent follow-selection mode.
 */
export class QuerySourceCoordinator {
  private followingSelection = false;
  private lastOneShot = false;

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
    if (source.kind === "document") this.lastOneShot = false;
    else if (source.kind === "selection-once") this.lastOneShot = true;
  }

  sourceForCurrentSelection(documentText: string, selection: string): QuerySource | undefined {
    if (!this.followingSelection) return { kind: "document", text: documentText };
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
      kind: "document",
      text: "查询范围：当前笔记",
      tooltip: isValidQueryText(selection) ? "查询选中内容" : "开启跟随选区查询"
    };
  }
}
