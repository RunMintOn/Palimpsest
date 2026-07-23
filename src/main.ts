import { Editor, MarkdownView, Plugin, TAbstractFile, TFile, WorkspaceLeaf, requestUrl } from "obsidian";
import { chunkMarkdown, embeddingText } from "./chunker";
import { BuildCancellationController, BuildCancellationToken, IndexBuildCancelled } from "./build-cancellation";
import { EmbeddingError, OllamaEmbeddingProvider } from "./embedding-provider";
import { PersistentIndex } from "./persistent-index";
import { buildQueryContext } from "./query-context";
import { QueryGate } from "./query-gate";
import { QueryLifecycleCoordinator, QuerySchedule } from "./query-lifecycle";
import { rankChunks } from "./retrieval";
import { DEFAULT_SETTINGS, excludedDirectoryList, SideGrepSettings, SideGrepSettingTab } from "./settings";
import { SidebarActions, SIDE_GREP_VIEW_TYPE, SideGrepView } from "./sidebar-view";
import { CHUNKER_VERSION, Chunk, IndexIdentity, IndexedChunk, IndexProgress, PersistentIndexData, SearchResult, SidebarState } from "./types";

interface PluginData {
  settings?: Partial<SideGrepSettings>;
  index?: PersistentIndexData;
}

export default class SideGrepPlugin extends Plugin implements SidebarActions {
  settings: SideGrepSettings = { ...DEFAULT_SETTINGS };
  private index!: PersistentIndex;
  private queryTimer: number | undefined;
  private modelTimer: number | undefined;
  private updateTimer: number | undefined;
  private readonly pendingChangedPaths = new Set<string>();
  private readonly queryGate = new QueryGate();
  private lifecycle = new QueryLifecycleCoordinator("uninitialized");
  private latestMarkdownView: MarkdownView | undefined;
  private lastActivatedMarkdownPath: string | undefined;
  private state: SidebarState = { kind: "waiting-input", message: "等待输入" };
  private results: SearchResult[] = [];
  private indexing = false;
  private readonly buildCancellation = new BuildCancellationController();

  async onload(): Promise<void> {
    const saved = (await this.loadData() ?? {}) as PluginData;
    this.settings = { ...DEFAULT_SETTINGS, ...saved.settings };
    this.index = new PersistentIndex(this.indexIdentity(), saved.index);
    this.syncQueryAvailability();
    this.registerView(SIDE_GREP_VIEW_TYPE, (leaf) => new SideGrepView(leaf, this));
    this.addSettingTab(new SideGrepSettingTab(this.app, this));
    this.addCommand({ id: "open-sidebar", name: "打开 Side Grep 侧边栏", callback: () => void this.activateView() });
    this.addCommand({ id: "rebuild-index", name: "建立/重建知识片段索引", callback: () => void this.rebuildIndex() });
    this.registerEvent(this.app.workspace.on("editor-change", (editor, view) => this.onEditorChange(editor, view)));
    this.registerEvent(this.app.workspace.on("file-open", (file) => this.onFileOpen(file)));
    this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf) => this.onActiveLeafChange(leaf)));
    this.registerEvent(this.app.vault.on("create", (file) => this.scheduleFileUpdate(file)));
    this.registerEvent(this.app.vault.on("modify", (file) => this.scheduleFileUpdate(file)));
    this.registerEvent(this.app.vault.on("delete", (file) => this.scheduleFileUpdate(file)));
    this.showIndexRequirement();
    this.app.workspace.onLayoutReady(() => {
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (view) {
        this.latestMarkdownView = view;
        this.lifecycle.rememberMarkdownContext();
      }
      const schedule = this.lifecycle.layoutReady();
      if (schedule) this.scheduleQueryFromCurrentEditor(schedule);
    });
  }

  onunload(): void {
    this.buildCancellation.unload();
    this.clearQueryTimers();
    this.queryGate.invalidate();
  }

  async saveSettings(): Promise<void> {
    await this.saveData({ settings: this.settings, index: this.index.serialize() });
  }

  onSettingsChanged(): void {
    this.queryGate.invalidate();
    this.syncQueryAvailability();
    if (!this.indexing) this.showIndexRequirement("影响 embedding 的配置已改变，请重建索引");
    this.present(this.state, this.results);
  }

  private indexIdentity(): IndexIdentity {
    return {
      model: this.settings.model,
      dimensions: this.settings.dimensions,
      chunkerVersion: CHUNKER_VERSION,
      chunkTargetLength: this.settings.chunkTargetLength,
      chunkMaxLength: this.settings.chunkMaxLength,
      chunkMinLength: this.settings.chunkMinLength
    };
  }

  private syncQueryAvailability(): void {
    const lifecycle = this.index.lifecycle(this.indexIdentity());
    this.lifecycle.setIndexAvailability(lifecycle === "ready" ? "ready" : lifecycle === "incompatible" ? "incompatible" : "uninitialized");
  }

  private provider(): OllamaEmbeddingProvider {
    return new OllamaEmbeddingProvider({
      endpoint: this.settings.endpoint,
      model: this.settings.model,
      dimensions: this.settings.dimensions,
      keepAlive: this.settings.keepAlive,
      queryInstruction: this.settings.queryInstruction
    }, async (url, body) => {
      const response = await requestUrl({ url, method: "POST", contentType: "application/json", body, throw: false });
      return { status: response.status, text: response.text };
    });
  }

  private onEditorChange(editor: Editor, view: MarkdownView | import("obsidian").MarkdownFileInfo): void {
    if (!(view instanceof MarkdownView)) return;
    this.latestMarkdownView = view;
    this.lifecycle.rememberMarkdownContext();
    const schedule = this.lifecycle.editorChanged();
    if (schedule) this.scheduleQueryFromCurrentEditor(schedule, editor, view);
  }

  private onFileOpen(file: TFile | null): void {
    if (!(file instanceof TFile) || file.extension !== "md") return;
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (view?.file?.path === file.path) this.noteMarkdownActivated(view);
  }

  private onActiveLeafChange(leaf: WorkspaceLeaf | null): void {
    if (leaf?.view instanceof MarkdownView) this.noteMarkdownActivated(leaf.view);
    else this.lifecycle.nonMarkdownLeafActivated();
  }

  private noteMarkdownActivated(view: MarkdownView): void {
    const path = view.file?.path;
    this.latestMarkdownView = view;
    if (path && path === this.lastActivatedMarkdownPath) return;
    this.lastActivatedMarkdownPath = path;
    const schedule = this.lifecycle.noteMarkdownActivated();
    if (schedule) this.scheduleQueryFromCurrentEditor(schedule, view.editor, view);
  }

  /** The one production entry point for typing, file, sidebar, and index-ready queries. */
  private scheduleQueryFromCurrentEditor(schedule: QuerySchedule, suppliedEditor?: Editor, suppliedView?: MarkdownView): void {
    this.clearQueryTimers();
    const generation = this.queryGate.begin();
    const view = suppliedView ?? this.latestMarkdownView;
    const editor = suppliedEditor ?? view?.editor;
    if (!view || !editor) return;
    const buffer = editor.getValue();

    // Build progress is authoritative: input only invalidates stale work and is
    // queried from the latest buffer once a successful build calls indexReady.
    if (this.indexing) return;
    if (!this.index.isReady(this.indexIdentity())) {
      this.showIndexRequirement();
      return;
    }
    if (!buffer.trim()) {
      this.present({ kind: "waiting-input", message: "等待输入" }, []);
      return;
    }
    if (!schedule.immediate) {
      this.present({ kind: "waiting-debounce", message: "等待停笔…" }, this.results);
      this.queryTimer = window.setTimeout(() => void this.runQuery(generation, editor, view, view.file?.path, buffer), this.settings.queryDebounceMs);
      return;
    }
    void this.runQuery(generation, editor, view, view.file?.path, buffer);
  }

  private async runQuery(generation: number, editor: Editor, view: MarkdownView, filePath: string | undefined, scheduledBuffer: string): Promise<void> {
    if (!this.queryGate.isCurrent(generation) || editor.getValue() !== scheduledBuffer || this.latestMarkdownView !== view) return;
    if (this.indexing) return;
    if (!this.index.isReady(this.indexIdentity())) {
      this.showIndexRequirement();
      return;
    }
    const context = buildQueryContext(scheduledBuffer, editor.getCursor().line, this.settings.queryMaxLength);
    if (context.query.replace(/\s/g, "").length < 8) {
      this.present({ kind: "waiting-input", message: "至少输入 8 个非空白字符后查询" }, []);
      return;
    }
    this.present({ kind: "querying", message: "查询中…" }, this.results);
    const started = performance.now();
    this.modelTimer = window.setTimeout(() => {
      if (this.queryGate.isCurrent(generation)) this.present({ kind: "loading-model", message: "模型加载中/查询中…" }, this.results);
    }, 600);
    try {
      const response = await this.provider().embedQuery(context.query);
      if (this.modelTimer) window.clearTimeout(this.modelTimer);
      if (!this.queryGate.isCurrent(generation) || editor.getValue() !== scheduledBuffer || this.latestMarkdownView !== view || view.file?.path !== filePath) return;
      const results = rankChunks(response.vectors[0], this.index.chunks, {
        topK: this.settings.topK,
        maxPerFile: this.settings.maxPerFile,
        excludePath: filePath
      });
      const latencyMs = performance.now() - started;
      const message = this.index.size
        ? `完成（索引 ${this.index.size} 个片段${response.coldLoad ? "，模型本次冷加载" : ""}）`
        : "索引已建立，但没有可召回片段";
      this.present({ kind: "complete", message, latencyMs }, results);
    } catch (error) {
      if (this.modelTimer) window.clearTimeout(this.modelTimer);
      if (!this.queryGate.isCurrent(generation)) return;
      const message = error instanceof EmbeddingError && error.kind === "connection" ? "Ollama 不可用" : `查询失败：${error instanceof Error ? error.message : String(error)}`;
      this.present({ kind: error instanceof EmbeddingError && error.kind === "connection" ? "ollama-unavailable" : "query-failed", message }, this.results);
    }
  }

  private clearQueryTimers(): void {
    if (this.queryTimer) window.clearTimeout(this.queryTimer);
    if (this.modelTimer) window.clearTimeout(this.modelTimer);
    this.queryTimer = undefined;
    this.modelTimer = undefined;
  }

  private scheduleFileUpdate(file: TAbstractFile): void {
    if (this.indexing) {
      this.pendingChangedPaths.add(file.path);
      return;
    }
    if (!this.index.isReady(this.indexIdentity())) return;
    this.pendingChangedPaths.add(file.path);
    if (this.updateTimer) window.clearTimeout(this.updateTimer);
    this.updateTimer = window.setTimeout(() => void this.flushFileUpdates(), 500);
  }

  private async flushFileUpdates(): Promise<void> {
    if (this.indexing || !this.index.isReady(this.indexIdentity())) return;
    const paths = [...this.pendingChangedPaths];
    this.pendingChangedPaths.clear();
    for (const path of paths) await this.updateChangedFile(path);
    // The active note is excluded from its own results. Re-indexing it must not
    // trigger a second query after the typing query already scheduled above.
    // Other changed notes can affect the visible candidate set, so coalesce
    // those into one refresh after this update batch.
    const activePath = this.latestMarkdownView?.file?.path;
    if (paths.some((path) => path !== activePath)) this.refreshCurrentQuery();
  }

  private async updateChangedFile(filePath: string): Promise<void> {
    if (this.indexing || !this.index.isReady(this.indexIdentity())) return;
    const file = this.app.vault.getAbstractFileByPath(filePath);
    const retained = this.index.chunks.filter((chunk) => chunk.filePath !== filePath);
    try {
      if (!(file instanceof TFile) || file.extension !== "md" || this.isExcluded(file.path)) {
        await this.commitIndex(this.indexIdentity(), [...retained]);
        return;
      }
      const indexed = await this.indexFiles([file], this.index.reusableById(this.indexIdentity()), () => false, false);
      await this.commitIndex(this.indexIdentity(), [...retained, ...indexed]);
    } catch (error) {
      this.present({ kind: "query-failed", message: `增量索引失败：${error instanceof Error ? error.message : String(error)}` }, this.results);
    }
  }

  async rebuildIndex(): Promise<void> {
    if (this.indexing) return;
    const identity = this.indexIdentity();
    const hadUsableIndex = this.index.isReady(identity);
    this.indexing = true;
    const buildToken = this.buildCancellation.startBuild();
    this.queryGate.invalidate();
    const files = this.app.vault.getMarkdownFiles().filter((file) => !this.isExcluded(file.path));
    this.presentIndexProgress({ phase: "scanning", current: 0, total: files.length, label: "正在扫描笔记" });
    try {
      // The old PersistentIndex is deliberately untouched until this complete
      // candidate has been embedded, checked for cancellation, and saved.
      const chunks = await this.indexFiles(files, this.index.reusableById(identity), () => this.buildCancellation.isBuildCancelled(buildToken), true);
      this.buildCancellation.assertBuildCanContinue(buildToken);
      this.presentIndexProgress({ phase: "saving", current: chunks.length, total: chunks.length, label: "正在保存索引" });
      await this.commitIndex(identity, chunks, buildToken);
      this.syncQueryAvailability();
      const schedule = this.lifecycle.indexReady();
      this.present({ kind: "complete", message: `索引完成：${chunks.length} 个片段` }, this.results);
      // The index has committed; allow the required index-ready query to run
      // now rather than making it wait for finally or another keystroke.
      this.indexing = false;
      if (schedule) this.scheduleQueryFromCurrentEditor(schedule);
    } catch (error) {
      if (error instanceof IndexBuildCancelled) {
        this.present({
          kind: "index-cancelled",
          message: hadUsableIndex ? "已取消重建，正在继续使用原有索引" : "已取消。尚未建立知识库索引",
          indexAction: hadUsableIndex ? "rebuild" : "build"
        }, hadUsableIndex ? this.results : []);
      } else {
        const unavailable = error instanceof EmbeddingError && error.kind === "connection";
        this.present({
          kind: "index-failed",
          message: unavailable ? "建库失败：Ollama 不可用" : `建库失败：${error instanceof Error ? error.message : String(error)}`,
          indexAction: "retry"
        }, hadUsableIndex ? this.results : []);
      }
    } finally {
      this.buildCancellation.finishBuild(buildToken);
      this.indexing = false;
      if (this.index.isReady(this.indexIdentity()) && this.pendingChangedPaths.size) void this.flushFileUpdates();
      if (!this.index.isReady(this.indexIdentity())) this.pendingChangedPaths.clear();
    }
  }

  cancelIndex(): void {
    if (!this.indexing) return;
    this.buildCancellation.cancelCurrentBuild();
  }

  private async indexFiles(files: TFile[], reusable: Map<string, IndexedChunk>, cancelled: () => boolean, reportProgress: boolean): Promise<IndexedChunk[]> {
    const pending: Chunk[] = [];
    const output: IndexedChunk[] = [];
    for (let i = 0; i < files.length; i++) {
      if (cancelled()) throw new IndexBuildCancelled();
      const file = files[i];
      const markdown = await this.app.vault.cachedRead(file);
      if (cancelled()) throw new IndexBuildCancelled();
      const chunks = chunkMarkdown(file.path, markdown, {
        targetLength: this.settings.chunkTargetLength,
        maxLength: this.settings.chunkMaxLength,
        minLength: this.settings.chunkMinLength
      });
      for (const chunk of chunks) {
        const cached = reusable.get(chunk.id);
        if (cached && cached.contentHash === chunk.contentHash) output.push({ ...chunk, vector: cached.vector });
        else pending.push(chunk);
      }
      if (reportProgress) this.presentIndexProgress({ phase: "scanning", current: i + 1, total: files.length, label: "正在扫描笔记" });
      if (i % 8 === 7) await this.yieldToUi();
    }
    for (let start = 0; start < pending.length; start += this.settings.embeddingBatchSize) {
      if (cancelled()) throw new IndexBuildCancelled();
      const batch = pending.slice(start, start + this.settings.embeddingBatchSize);
      const response = await this.provider().embedDocuments(batch.map(embeddingText));
      if (cancelled()) throw new IndexBuildCancelled();
      output.push(...batch.map((chunk, index) => ({ ...chunk, vector: response.vectors[index] })));
      if (reportProgress) this.presentIndexProgress({ phase: "embedding", current: Math.min(start + batch.length, pending.length), total: pending.length, label: "正在生成向量" });
      await this.yieldToUi();
    }
    if (cancelled()) throw new IndexBuildCancelled();
    return output;
  }

  private presentIndexProgress(progress: IndexProgress): void {
    this.present({ kind: "indexing", message: progress.label, progress }, this.results);
  }

  private async commitIndex(identity: IndexIdentity, chunks: IndexedChunk[], buildToken?: BuildCancellationToken): Promise<void> {
    this.buildCancellation.assertCommitCanProceed(buildToken);
    const candidate = this.index.replacement(identity, chunks);
    await this.saveData({ settings: this.settings, index: candidate });
    // saveData can yield to Obsidian lifecycle callbacks; never update the
    // in-memory index after plugin unload, even for an incremental operation.
    this.buildCancellation.assertPluginActive();
    this.index.commit(candidate);
  }

  private async yieldToUi(): Promise<void> {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  }

  private isExcluded(path: string): boolean {
    return excludedDirectoryList(this.settings.excludedDirectories).some((directory) => path === directory || path.startsWith(`${directory}/`));
  }

  private showIndexRequirement(message?: string): void {
    if (this.indexing || this.state.kind === "index-cancelled" || this.state.kind === "index-failed") return;
    const lifecycle = this.index.lifecycle(this.indexIdentity());
    if (lifecycle === "ready") return;
    if (lifecycle === "incompatible") {
      this.present({ kind: "index-needed", message: message ?? "索引配置已变化，请重建索引", indexAction: "rebuild" }, []);
      return;
    }
    this.present({
      kind: "index-needed",
      message: "尚未建立知识库索引",
      detail: "建立索引后，Side Grep 才能从已有笔记中召回相关片段。",
      indexAction: "build"
    }, []);
  }

  private present(state: SidebarState, results: SearchResult[] = this.results): void {
    this.state = state;
    this.results = results;
    this.app.workspace.getLeavesOfType(SIDE_GREP_VIEW_TYPE).forEach((leaf) => (leaf.view as unknown as SideGrepView).showResults(state, results));
  }

  async activateView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(SIDE_GREP_VIEW_TYPE)[0];
    const leaf: WorkspaceLeaf = existing ?? this.app.workspace.getRightLeaf(false)!;
    await leaf.setViewState({ type: SIDE_GREP_VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
    (leaf.view as unknown as SideGrepView).showResults(this.state, this.results);
    if (existing) this.sidebarOpened();
  }

  sidebarOpened(): void {
    const schedule = this.lifecycle.sidebarOpened();
    if (schedule) this.scheduleQueryFromCurrentEditor(schedule);
  }

  refreshCurrentQuery(): void {
    if (!this.index.isReady(this.indexIdentity()) || this.indexing) return;
    const schedule = this.lifecycle.sidebarOpened();
    if (schedule) this.scheduleQueryFromCurrentEditor(schedule);
  }

  async openResult(result: SearchResult): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(result.filePath);
    if (!(file instanceof TFile)) return;
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file, { active: true });
    if (leaf.view instanceof MarkdownView) leaf.view.editor.setCursor({ line: result.startLine - 1, ch: 0 });
  }

  insertLink(result: SearchResult): void {
    const editor = this.latestMarkdownView?.editor ?? this.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
    if (editor) editor.replaceSelection(this.linkMarkup(result));
  }

  insertQuote(result: SearchResult, selectedText?: string): void {
    const editor = this.latestMarkdownView?.editor ?? this.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
    if (!editor) return;
    editor.replaceSelection(this.quoteMarkup(result, selectedText));
  }

  linkMarkup(result: SearchResult): string {
    return `[[${this.linkTarget(result)}]]`;
  }

  quoteMarkup(result: SearchResult, selectedText?: string): string {
    const text = selectedText?.trim() || result.text;
    const quoted = text.split("\n").map((line) => `> ${line}`).join("\n");
    return `${quoted}\n>\n> —— ${this.linkMarkup(result)}`;
  }

  expansionPolicy(): { count: number; thresholdEnabled: boolean; threshold: number } {
    return {
      count: this.settings.autoExpandCount,
      thresholdEnabled: this.settings.autoExpandThresholdEnabled,
      threshold: this.settings.autoExpandThreshold
    };
  }

  private linkTarget(result: SearchResult): string {
    const path = result.filePath.replace(/\.md$/i, "");
    const heading = result.breadcrumb.at(-1);
    return heading ? `${path}#${heading}` : path;
  }
}
