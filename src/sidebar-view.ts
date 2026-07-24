import { ItemView, MarkdownRenderer, setIcon, WorkspaceLeaf } from "obsidian";
import { ExpansionPolicy, shouldAutoExpand } from "./expansion-policy";
import { hasMaterialResultChange } from "./result-presentation";
import { SearchResult, SidebarState } from "./types";

export const PALIMPSEST_VIEW_TYPE = "palimpsest-sidebar";

export interface SidebarActions {
  openResult(result: SearchResult): Promise<void>;
  insertLink(result: SearchResult): void;
  insertQuote(result: SearchResult, selectedText?: string): void;
  linkMarkup(result: SearchResult): string;
  quoteMarkup(result: SearchResult, selectedText?: string): string;
  expansionPolicy(): ExpansionPolicy;
  rebuildIndex(): Promise<void>;
  cancelIndex(): void;
  refreshCurrentQuery(): void;
  sidebarOpened(): void;
}

interface ResultCard {
  root: HTMLDetailsElement;
  file: HTMLElement;
  score: HTMLElement;
  breadcrumb: HTMLElement;
  quote: HTMLElement;
  result: SearchResult;
  renderedHash?: string;
  manualExpansion?: boolean;
  ignoreNextToggle: boolean;
}

export class SideGrepView extends ItemView {
  private state: SidebarState = { kind: "waiting-input", message: "等待输入" };
  private results: SearchResult[] = [];
  private shellReady = false;
  private statusIcon!: HTMLElement;
  private refreshButton!: HTMLButtonElement;
  private indexButton!: HTMLButtonElement;
  private indexPanel!: HTMLElement;
  private emptyState!: HTMLElement;
  private resultsEl!: HTMLElement;
  private readonly cards = new Map<string, ResultCard>();
  private resultAnimation: Animation | undefined;
  private expansionPolicyKey = "";

  constructor(leaf: WorkspaceLeaf, private readonly actions: SidebarActions) { super(leaf); }
  getViewType(): string { return PALIMPSEST_VIEW_TYPE; }
  getDisplayText(): string { return "Palimpsest"; }
  getIcon(): string { return "search"; }

  showResults(state: SidebarState, results: SearchResult[] = this.results): void {
    this.state = state;
    this.ensureShell();
    this.updateToolbar();
    this.updateIndexPanel();
    const policyKey = JSON.stringify(this.actions.expansionPolicy());
    if (policyKey !== this.expansionPolicyKey) {
      this.expansionPolicyKey = policyKey;
      for (const card of this.cards.values()) card.manualExpansion = undefined;
    }
    const shouldSoften = hasMaterialResultChange(this.results, results);
    this.reconcileResults([...results]);
    if (shouldSoften) this.animateResultRefresh();
    this.updateEmptyState();
  }

  async onOpen(): Promise<void> {
    this.ensureShell();
    this.updateToolbar();
    this.updateIndexPanel();
    this.reconcileResults(this.results);
    this.updateEmptyState();
    this.actions.sidebarOpened();
  }

  async onClose(): Promise<void> {
    this.resultAnimation?.cancel();
    this.shellReady = false;
    this.cards.clear();
  }

  private ensureShell(): void {
    if (this.shellReady && this.resultsEl?.isConnected) return;
    const root = this.contentEl;
    root.empty();
    root.addClass("obsdn-side-grep");

    const toolbar = root.createDiv({ cls: "obsdn-side-grep-toolbar" });
    toolbar.createEl("h4", { text: "Palimpsest", cls: "obsdn-side-grep-title" });
    toolbar.createDiv({ cls: "obsdn-side-grep-toolbar-spacer" });
    this.statusIcon = toolbar.createDiv({ cls: "obsdn-side-grep-status-icon" });

    this.refreshButton = toolbar.createEl("button", {
      cls: "clickable-icon obsdn-side-grep-toolbar-button",
      attr: { "aria-label": "刷新相关片段", title: "刷新相关片段" }
    });
    setIcon(this.refreshButton, "refresh-cw");
    this.refreshButton.addEventListener("click", () => this.actions.refreshCurrentQuery());

    this.indexButton = toolbar.createEl("button", {
      cls: "clickable-icon obsdn-side-grep-toolbar-button",
      attr: { "aria-label": "重建索引", title: "重建索引" }
    });
    setIcon(this.indexButton, "database");
    this.indexButton.addEventListener("click", () => void this.actions.rebuildIndex());

    this.indexPanel = root.createDiv({ cls: "obsdn-side-grep-index-panel" });
    this.emptyState = root.createDiv({ cls: "obsdn-side-grep-empty-state" });
    this.resultsEl = root.createDiv({ cls: "obsdn-side-grep-results" });
    this.shellReady = true;
  }

  private updateToolbar(): void {
    this.statusIcon.removeClass("is-visible", "is-spinning", "is-error");
    this.statusIcon.empty();

    const tooltip = this.state.latencyMs === undefined
      ? this.state.message
      : `${this.state.message} · 最近一次查询 ${this.state.latencyMs.toFixed(0)} ms`;
    this.statusIcon.setAttribute("title", tooltip);
    this.statusIcon.setAttribute("aria-label", tooltip);

    if (this.state.kind === "querying" || this.state.kind === "loading-model" || this.state.kind === "indexing") {
      setIcon(this.statusIcon, "loader-circle");
      this.statusIcon.addClass("is-visible", "is-spinning");
    } else if (this.state.kind === "ollama-unavailable" || this.state.kind === "query-failed" || this.state.kind === "index-failed") {
      setIcon(this.statusIcon, "triangle-alert");
      this.statusIcon.addClass("is-visible", "is-error");
    }

    const indexActionVisible = Boolean(this.state.indexAction) || this.state.kind === "indexing";
    this.refreshButton.style.display = indexActionVisible ? "none" : "";
    this.indexButton.style.display = indexActionVisible ? "none" : "";
    this.refreshButton.disabled = this.state.kind === "indexing";
    this.indexButton.disabled = this.state.kind === "indexing";
  }

  private updateIndexPanel(): void {
    this.indexPanel.empty();
    const shouldShow = this.state.kind === "indexing" || Boolean(this.state.indexAction);
    this.indexPanel.style.display = shouldShow ? "" : "none";
    if (!shouldShow) return;

    this.indexPanel.createDiv({ cls: "obsdn-side-grep-index-message", text: this.state.message });
    if (this.state.detail) this.indexPanel.createDiv({ cls: "obsdn-side-grep-status-detail", text: this.state.detail });

    if (this.state.kind === "indexing") {
      const progress = this.state.progress;
      if (progress) {
        const progressEl = this.indexPanel.createEl("progress", { cls: "obsdn-side-grep-progress" }) as HTMLProgressElement;
        if (progress.phase !== "saving" && progress.total > 0) {
          progressEl.max = progress.total;
          progressEl.value = Math.min(progress.current, progress.total);
        } else {
          progressEl.removeAttribute("value");
        }
        const detail = progress.phase === "saving"
          ? "正在保存索引……"
          : `${progress.current} / ${progress.total} 个${progress.phase === "scanning" ? "文件" : "片段"}`;
        this.indexPanel.createDiv({ cls: "obsdn-side-grep-progress-detail", text: detail });
      }
      const cancel = this.indexPanel.createEl("button", { text: "取消", cls: "obsdn-side-grep-index-action" });
      cancel.addEventListener("click", () => this.actions.cancelIndex());
      return;
    }

    const label = this.state.indexAction === "build" ? "建立索引" : this.state.indexAction === "retry" ? "重试" : "重建索引";
    const action = this.indexPanel.createEl("button", { text: label, cls: "obsdn-side-grep-index-action" });
    action.addEventListener("click", () => void this.actions.rebuildIndex());
  }

  private updateEmptyState(): void {
    const indexPanelVisible = this.indexPanel.style.display !== "none";
    if (this.results.length || indexPanelVisible) {
      this.emptyState.style.display = "none";
      return;
    }
    this.emptyState.style.display = "";
    this.emptyState.setText(this.state.kind === "complete" ? "没有找到相关片段" : this.state.message);
  }

  private reconcileResults(nextResults: SearchResult[]): void {
    const scrollTop = this.contentEl.scrollTop;
    const nextIds = new Set(nextResults.map((result) => result.id));
    for (const [id, card] of this.cards) {
      if (nextIds.has(id)) continue;
      card.root.remove();
      this.cards.delete(id);
    }

    nextResults.forEach((result, index) => {
      let card = this.cards.get(result.id);
      if (!card) {
        card = this.createResultCard(result, index);
        this.cards.set(result.id, card);
      }
      this.updateResultCard(card, result, index);
      const currentAtIndex = this.resultsEl.children.item(index);
      if (currentAtIndex !== card.root) this.resultsEl.insertBefore(card.root, currentAtIndex);
    });

    this.results = nextResults;
    this.contentEl.scrollTop = scrollTop;
  }

  private createResultCard(result: SearchResult, index: number): ResultCard {
    const root = document.createElement("details");
    root.className = "obsdn-side-grep-result";
    const summary = root.createEl("summary");
    const score = summary.createSpan({ cls: "obsdn-side-grep-score", attr: { title: "余弦相似度，不是准确率" } });
    const file = summary.createEl("a", {
      cls: "obsdn-side-grep-file",
      attr: { href: "#", "aria-label": "打开来源；拖动可插入链接", title: "打开来源；拖动可插入链接", draggable: "true" }
    });
    const breadcrumb = root.createDiv({ cls: "obsdn-side-grep-breadcrumb" });
    const excerpt = root.createDiv({ cls: "obsdn-side-grep-excerpt-wrap" });
    const quote = excerpt.createDiv({ cls: "obsdn-side-grep-excerpt markdown-rendered" });
    const quoteAction = excerpt.createEl("button", {
      cls: "clickable-icon obsdn-side-grep-card-action obsdn-side-grep-quote-action",
      attr: { "aria-label": "引用片段；拖动可插入引用", title: "引用片段；拖动可插入引用", draggable: "true" }
    });
    setIcon(quoteAction, "quote");
    const card: ResultCard = { root, file, score, breadcrumb, quote, result, ignoreNextToggle: false };

    file.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void this.actions.openResult(card.result);
    });
    file.addEventListener("dragstart", (event) => this.setDragPayload(event, this.actions.linkMarkup(card.result)));
    quoteAction.addEventListener("click", () => this.actions.insertQuote(card.result, this.selectedExcerpt(card.quote)));
    quoteAction.addEventListener("dragstart", (event) => this.setDragPayload(event, this.actions.quoteMarkup(card.result, this.selectedExcerpt(card.quote))));
    root.addEventListener("toggle", () => {
      if (card.ignoreNextToggle) {
        card.ignoreNextToggle = false;
        return;
      }
      card.manualExpansion = root.open;
    });
    return card;
  }

  private updateResultCard(card: ResultCard, result: SearchResult, index: number): void {
    card.result = result;
    if (card.file.textContent !== result.fileName) card.file.setText(result.fileName);
    const score = result.similarity.toFixed(2);
    if (card.score.textContent !== score) card.score.setText(score);
    const breadcrumb = result.breadcrumb.join(" › ");
    if (card.breadcrumb.textContent !== breadcrumb) card.breadcrumb.setText(breadcrumb);
    card.breadcrumb.setAttribute("title", breadcrumb);
    card.breadcrumb.style.display = breadcrumb ? "" : "none";
    if (card.renderedHash !== result.contentHash) {
      card.renderedHash = result.contentHash;
      card.quote.empty();
      void MarkdownRenderer.render(this.app, result.text, card.quote, result.filePath, this)
        .catch(() => card.quote.setText(result.text));
    }

    const autoOpen = shouldAutoExpand(index, result.similarity, this.actions.expansionPolicy());
    const desiredOpen = card.manualExpansion ?? autoOpen;
    if (card.root.open !== desiredOpen) {
      card.ignoreNextToggle = true;
      card.root.open = desiredOpen;
    }
  }

  private animateResultRefresh(): void {
    this.resultAnimation?.cancel();
    this.resultAnimation = this.resultsEl.animate(
      [{ opacity: 0.72 }, { opacity: 1 }],
      { duration: 140, easing: "ease-out" }
    );
  }

  private selectedExcerpt(quote: HTMLElement): string | undefined {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return undefined;
    const range = selection.getRangeAt(0);
    const container = range.commonAncestorContainer.nodeType === Node.TEXT_NODE
      ? range.commonAncestorContainer.parentElement
      : range.commonAncestorContainer as Element;
    return container && quote.contains(container) ? selection.toString().trim() || undefined : undefined;
  }

  private setDragPayload(event: DragEvent, markdown: string): void {
    if (!event.dataTransfer) return;
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("text/plain", markdown);
    event.dataTransfer.setData("text/markdown", markdown);
  }
}
