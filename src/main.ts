import { Editor, MarkdownView, Plugin, TAbstractFile, TFile, WorkspaceLeaf, requestUrl } from "obsidian";
import { chunkMarkdown, embeddingText } from "./chunker";
import { BuildCancellationController, BuildCancellationToken, IndexBuildCancelled } from "./build-cancellation";
import { EmbeddingError, OllamaEmbeddingProvider } from "./embedding-provider";
import { FullIndexBuildRequestGate, runConfirmedIndexBuild } from "./index-build-flow";
import { confirmIndexBuild } from "./index-build-modal";
import { IndexBuildPlanStale, PreparedIndexBuild, VaultRevision, assertIndexBuildPlanCurrent, executePreparedIndexBuild as executePlan, prepareIndexBuild as preparePlan } from "./index-build-plan";
import { PersistentIndex } from "./persistent-index";
import { IndexScope, IndexScopeStatus, indexScope, indexScopeStatus, isPathExcluded } from "./index-scope";
import { buildQueryContext } from "./query-context";
import { QueryGate } from "./query-gate";
import { QueryLifecycleCoordinator, QuerySchedule } from "./query-lifecycle";
import { rankChunks } from "./retrieval";
import type { ResultExcerptPresentation } from "./result-presentation";
import { migrateSettings, SideGrepSettings, SideGrepSettingTab, StoredSideGrepSettings } from "./settings";
import { SidebarActions, PALIMPSEST_VIEW_TYPE, SideGrepView } from "./sidebar-view";
import { CHUNKER_VERSION, Chunk, IndexIdentity, IndexedChunk, IndexProgress, PersistentIndexData, SearchResult, SidebarState } from "./types";

interface PluginData {
  settings?: StoredSideGrepSettings;
  index?: PersistentIndexData;
}

/** Read-only index-scope state intended for settings and other UI consumers. */
export interface IndexScopeView {
  status: IndexScopeStatus;
  desired: IndexScope;
  effective?: IndexScope;
}

export default class SideGrepPlugin extends Plugin implements SidebarActions {
  settings: SideGrepSettings = migrateSettings();
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
  private preparingIndex = false;
  private indexing = false;
  private readonly fullIndexBuildRequests = new FullIndexBuildRequestGate();
  private readonly vaultRevision = new VaultRevision();
  private readonly buildCancellation = new BuildCancellationController();

  async onload(): Promise<void> {
    const saved = (await this.loadData() ?? {}) as PluginData;
    this.settings = migrateSettings(saved.settings);
    this.index = new PersistentIndex(this.indexIdentity(), saved.index, this.desiredIndexScope());
    const legacyIndexWasCompleted = saved.index && (saved.index.initialized ?? saved.index.updatedAt > 0);
    const savedExcludedDirectories = saved.settings?.excludedDirectories;
    const settingsScopeWasMigrated = savedExcludedDirectories !== undefined &&
      JSON.stringify(savedExcludedDirectories) !== JSON.stringify(this.settings.excludedDirectories);
    if (settingsScopeWasMigrated || (legacyIndexWasCompleted && !saved.index?.scope) || saved.index?.schemaVersion === 1 || saved.index?.schemaVersion === 2) {
      await this.saveData({ settings: this.settings, index: this.index.serialize() });
    }
    this.syncQueryAvailability();
    this.registerView(PALIMPSEST_VIEW_TYPE, (leaf) => new SideGrepView(leaf, this));
    this.addSettingTab(new SideGrepSettingTab(this.app, this));
    this.addCommand({ id: "open-sidebar", name: "打开 Palimpsest 侧边栏", callback: () => void this.activateView() });
    this.addCommand({ id: "rebuild-index", name: "准备建立/全量重建知识片段索引", callback: () => void this.requestFullIndexBuild() });
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
    this.settings = migrateSettings(this.settings);
    await this.saveData({ settings: this.settings, index: this.index.serialize() });
  }

  onSettingsChanged(): void {
    this.queryGate.invalidate();
    this.syncQueryAvailability();
    if (!this.isBuildActive()) this.showIndexRequirement("影响 embedding 的配置已改变，请重建索引");
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

  private desiredIndexScope(): IndexScope {
    return indexScope(this.settings.excludedDirectories);
  }

  /** Returns copied scope state; UI consumers cannot mutate the formal index. */
  getIndexScopeView(): IndexScopeView {
    const desired = this.desiredIndexScope();
    const effective = this.index.scope;
    return {
      status: indexScopeStatus(desired, effective),
      desired: { excludedDirectories: [...desired.excludedDirectories] },
      effective: effective && { excludedDirectories: [...effective.excludedDirectories] }
    };
  }

  /** Copy for the settings UI; all full builds still go through confirmation. */
  getFullIndexBuildUi(): { description: string; buttonLabel: string } {
    const lifecycle = this.index.lifecycle(this.indexIdentity());
    if (lifecycle === "uninitialized") {
      return { description: "尚无索引：扫描当前范围并建立索引。", buttonLabel: "准备建立索引" };
    }
    if (lifecycle === "incompatible") {
      return { description: "配置已变化，需要重新建立索引。", buttonLabel: "准备全量重建" };
    }
    if (this.getIndexScopeView().status === "pending") {
      return { description: "通过全量重建应用新的索引范围。", buttonLabel: "准备全量重建" };
    }
    return { description: "重新扫描全部范围，现有向量会尽量复用。", buttonLabel: "准备全量重建" };
  }

  private syncQueryAvailability(): void {
    const lifecycle = this.index.lifecycle(this.indexIdentity());
    this.lifecycle.setIndexAvailability(lifecycle === "ready" ? "ready" : lifecycle === "incompatible" ? "incompatible" : "uninitialized");
  }

  private isBuildActive(): boolean {
    return this.preparingIndex || this.indexing;
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
    if (this.isBuildActive()) return;
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
    if (this.isBuildActive()) return;
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
    this.vaultRevision.noteChange();
    if (this.isBuildActive()) {
      this.pendingChangedPaths.add(file.path);
      return;
    }
    if (!this.index.isReady(this.indexIdentity())) return;
    this.pendingChangedPaths.add(file.path);
    if (this.updateTimer) window.clearTimeout(this.updateTimer);
    this.updateTimer = window.setTimeout(() => void this.flushFileUpdates(), 500);
  }

  private async flushFileUpdates(): Promise<void> {
    if (this.isBuildActive() || !this.index.isReady(this.indexIdentity())) return;
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
    if (this.isBuildActive() || !this.index.isReady(this.indexIdentity())) return;
    const effectiveScope = this.index.scope;
    if (!effectiveScope) return;
    const file = this.app.vault.getAbstractFileByPath(filePath);
    const retained = this.index.chunks.filter((chunk) => chunk.filePath !== filePath);
    try {
      if (!(file instanceof TFile) || file.extension !== "md" || this.isExcluded(file.path, effectiveScope)) {
        await this.commitIncrementalIndex(this.indexIdentity(), [...retained]);
        return;
      }
      const indexed = await this.indexChangedFiles([file], this.index.reusableById(this.indexIdentity()));
      await this.commitIncrementalIndex(this.indexIdentity(), [...retained, ...indexed]);
    } catch (error) {
      this.present({ kind: "query-failed", message: `增量索引失败：${error instanceof Error ? error.message : String(error)}` }, this.results);
    }
  }

  /** The only production full-build request path: scan, confirm, then execute. */
  async requestFullIndexBuild(): Promise<void> {
    return this.fullIndexBuildRequests.request(() => this.runFullIndexBuildRequest());
  }

  /** Compatibility name used by the sidebar CTA; it remains confirmation-safe. */
  async rebuildIndex(): Promise<void> {
    return this.requestFullIndexBuild();
  }

  private async runFullIndexBuildRequest(): Promise<void> {
    const hadUsableIndex = this.index.isReady(this.indexIdentity());
    try {
      const outcome = await runConfirmedIndexBuild({
        prepare: async () => {
          const plan = await this.prepareIndexBuild();
          // Scanning has ended before the Modal opens: restore normal query or
          // index-needed state instead of leaving a spinning scan indicator.
          this.restoreAfterFullBuildPause();
          return plan;
        },
        confirm: (plan) => confirmIndexBuild(this.app, plan.summary, hadUsableIndex),
        execute: (plan) => this.executePreparedIndexBuild(plan)
      });
      if (outcome === "cancelled") this.restoreAfterFullBuildPause();
    } catch (error) {
      this.presentBuildFailure(error, hadUsableIndex);
    }
  }

  /** Leaves a prepared-but-unconfirmed build non-blocking and non-indexing. */
  private restoreAfterFullBuildPause(): void {
    this.syncQueryAvailability();
    if (!this.index.isReady(this.indexIdentity())) {
      this.showIndexRequirement();
      return;
    }
    // Do not launch or clear a query merely because the confirmation closed:
    // the existing result set remains usable until a normal query event occurs.
    this.present({ kind: "waiting-input", message: "等待输入" }, this.results);
  }

  /** Scans a full build into an opaque plan without embedding or committing. */
  async prepareIndexBuild(): Promise<PreparedIndexBuild> {
    if (this.isBuildActive()) throw new Error("An index build is already active");
    const identity = this.indexIdentity();
    const scope = this.desiredIndexScope();
    const vaultRevision = this.vaultRevision.value;
    const allFiles = this.app.vault.getMarkdownFiles();
    const files = allFiles.filter((file) => !this.isExcluded(file.path, scope));
    const chunks: Chunk[] = [];
    this.preparingIndex = true;
    const buildToken = this.buildCancellation.startBuild();
    this.queryGate.invalidate();
    this.presentIndexProgress({ phase: "scanning", current: 0, total: files.length, label: "正在扫描笔记" });
    try {
      for (let index = 0; index < files.length; index++) {
        this.buildCancellation.assertBuildCanContinue(buildToken);
        const file = files[index];
        const markdown = await this.app.vault.cachedRead(file);
        this.buildCancellation.assertBuildCanContinue(buildToken);
        chunks.push(...chunkMarkdown(file.path, markdown, {
          targetLength: identity.chunkTargetLength,
          maxLength: identity.chunkMaxLength,
          minLength: identity.chunkMinLength
        }));
        this.buildCancellation.assertBuildCanContinue(buildToken);
        this.presentIndexProgress({ phase: "scanning", current: index + 1, total: files.length, label: "正在扫描笔记" });
        if (index % 8 === 7) {
          await this.yieldToUi();
          this.buildCancellation.assertBuildCanContinue(buildToken);
        }
      }
      this.buildCancellation.assertBuildCanContinue(buildToken);
      // preparePlan performs the global duplicate-ID preflight before any
      // execution code is allowed to call document embedding.
      return preparePlan({
        totalMarkdownFiles: allFiles.length,
        includedFiles: files.length,
        chunks,
        reusableById: this.index.reusableById(identity),
        vaultRevision,
        scope,
        identity,
        currentState: () => ({
          vaultRevision: this.vaultRevision.value,
          identity: this.indexIdentity(),
          scope: this.desiredIndexScope()
        })
      });
    } finally {
      this.buildCancellation.finishBuild(buildToken);
      this.preparingIndex = false;
      if (this.index.isReady(this.indexIdentity()) && this.pendingChangedPaths.size) void this.flushFileUpdates();
    }
  }

  /** Executes a previously prepared plan; the plan module rejects stale input before embedding. */
  async executePreparedIndexBuild(plan: PreparedIndexBuild): Promise<void> {
    if (this.isBuildActive()) throw new Error("An index build is already active");
    const current = { vaultRevision: this.vaultRevision.value, identity: this.indexIdentity(), scope: this.desiredIndexScope() };
    // Validate before changing build state or constructing an embedding request.
    assertIndexBuildPlanCurrent(plan, current);
    const provider = this.provider();
    const batchSize = this.settings.embeddingBatchSize;
    let buildToken: BuildCancellationToken | undefined;
    try {
      this.indexing = true;
      buildToken = this.buildCancellation.startBuild();
      this.queryGate.invalidate();
      const executed = await executePlan(plan, {
        current,
        batchSize,
        embedDocuments: async (chunks) => (await provider.embedDocuments(chunks.map(embeddingText))).vectors,
        assertCanContinue: () => this.buildCancellation.assertBuildCanContinue(buildToken!),
        yieldToUi: () => this.yieldToUi(),
        onEmbeddingProgress: (current, total) => this.presentIndexProgress({ phase: "embedding", current, total, label: "正在生成向量" })
      });
      this.buildCancellation.assertBuildCanContinue(buildToken);
      this.presentIndexProgress({ phase: "saving", current: executed.chunks.length, total: executed.chunks.length, label: "正在保存索引" });
      await this.commitFullIndex(executed.identity, executed.chunks, executed.scope, buildToken);
      this.syncQueryAvailability();
      this.present({ kind: "complete", message: `索引完成：${executed.chunks.length} 个片段` }, this.results);
      // Settings may have changed after execution began. In that case the
      // committed plan remains valid but query readiness follows new settings.
      this.indexing = false;
      if (this.index.isReady(this.indexIdentity())) {
        const schedule = this.lifecycle.indexReady();
        if (schedule) this.scheduleQueryFromCurrentEditor(schedule);
      }
    } finally {
      if (buildToken) this.buildCancellation.finishBuild(buildToken);
      this.indexing = false;
      if (this.index.isReady(this.indexIdentity()) && this.pendingChangedPaths.size) void this.flushFileUpdates();
      if (!this.index.isReady(this.indexIdentity())) this.pendingChangedPaths.clear();
    }
  }

  private presentBuildFailure(error: unknown, hadUsableIndex: boolean): void {
    if (error instanceof IndexBuildCancelled) {
      this.present({
        kind: "index-cancelled",
        message: hadUsableIndex ? "已取消重建，正在继续使用原有索引" : "已取消。尚未建立知识库索引",
        indexAction: hadUsableIndex ? "rebuild" : "build"
      }, hadUsableIndex ? this.results : []);
      return;
    }
    const unavailable = error instanceof EmbeddingError && error.kind === "connection";
    const stale = error instanceof IndexBuildPlanStale;
    this.present({
      kind: "index-failed",
      message: stale ? "索引计划已经过期，请重新扫描后再试。" : unavailable ? "建库失败：Ollama 不可用" : `建库失败：${error instanceof Error ? error.message : String(error)}`,
      indexAction: "retry"
    }, hadUsableIndex ? this.results : []);
  }

  cancelIndex(): void {
    if (!this.isBuildActive()) return;
    this.buildCancellation.cancelCurrentBuild();
  }

  /** Incremental updates retain their existing immediate scan/embed behavior. */
  private async indexChangedFiles(files: TFile[], reusable: Map<string, IndexedChunk>): Promise<IndexedChunk[]> {
    const pending: Chunk[] = [];
    const output: IndexedChunk[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const markdown = await this.app.vault.cachedRead(file);
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
      if (i % 8 === 7) await this.yieldToUi();
    }
    for (let start = 0; start < pending.length; start += this.settings.embeddingBatchSize) {
      const batch = pending.slice(start, start + this.settings.embeddingBatchSize);
      const response = await this.provider().embedDocuments(batch.map(embeddingText));
      output.push(...batch.map((chunk, index) => ({ ...chunk, vector: response.vectors[index] })));
      await this.yieldToUi();
    }
    return output;
  }

  private presentIndexProgress(progress: IndexProgress): void {
    this.present({ kind: "indexing", message: progress.label, progress }, this.results);
  }

  private async commitFullIndex(identity: IndexIdentity, chunks: IndexedChunk[], scope: IndexScope, buildToken: BuildCancellationToken): Promise<void> {
    await this.persistIndexCandidate(this.index.fullReplacement(identity, chunks, scope), buildToken);
  }

  private async commitIncrementalIndex(identity: IndexIdentity, chunks: IndexedChunk[]): Promise<void> {
    await this.persistIndexCandidate(this.index.incrementalReplacement(identity, chunks));
  }

  private async persistIndexCandidate(candidate: PersistentIndexData, buildToken?: BuildCancellationToken): Promise<void> {
    this.buildCancellation.assertCommitCanProceed(buildToken);
    await this.saveData({ settings: this.settings, index: candidate });
    // saveData can yield to Obsidian lifecycle callbacks; never update the
    // in-memory index after plugin unload, even for an incremental operation.
    this.buildCancellation.assertPluginActive();
    this.index.commit(candidate);
  }

  private async yieldToUi(): Promise<void> {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  }

  private isExcluded(path: string, scope: IndexScope): boolean {
    return isPathExcluded(path, scope);
  }

  private showIndexRequirement(message?: string): void {
    if (this.isBuildActive() || this.state.kind === "index-cancelled" || this.state.kind === "index-failed") return;
    const lifecycle = this.index.lifecycle(this.indexIdentity());
    if (lifecycle === "ready") return;
    if (lifecycle === "incompatible") {
      this.present({ kind: "index-needed", message: message ?? "索引格式或配置已变化，请重建索引", indexAction: "rebuild" }, []);
      return;
    }
    this.present({
      kind: "index-needed",
      message: "尚未建立知识库索引",
      detail: "建立前会先扫描并显示文件、片段和排除范围。如需排除目录，请先在“设置 → Palimpsest → 索引范围”中配置。",
      indexAction: "build"
    }, []);
  }

  private present(state: SidebarState, results: SearchResult[] = this.results): void {
    this.state = state;
    this.results = results;
    this.app.workspace.getLeavesOfType(PALIMPSEST_VIEW_TYPE).forEach((leaf) => (leaf.view as unknown as SideGrepView).showResults(state, results));
  }

  async activateView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(PALIMPSEST_VIEW_TYPE)[0];
    const leaf: WorkspaceLeaf = existing ?? this.app.workspace.getRightLeaf(false)!;
    await leaf.setViewState({ type: PALIMPSEST_VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
    (leaf.view as unknown as SideGrepView).showResults(this.state, this.results);
    if (existing) this.sidebarOpened();
  }

  sidebarOpened(): void {
    const schedule = this.lifecycle.sidebarOpened();
    if (schedule) this.scheduleQueryFromCurrentEditor(schedule);
  }

  refreshCurrentQuery(): void {
    if (!this.index.isReady(this.indexIdentity()) || this.isBuildActive()) return;
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

  resultExcerptPresentation(): ResultExcerptPresentation {
    return {
      fontScale: this.settings.resultExcerptFontScale,
      lineHeight: this.settings.resultExcerptLineHeight,
      maxLines: this.settings.resultExcerptMaxLines
    };
  }

  private linkTarget(result: SearchResult): string {
    const path = result.filePath.replace(/\.md$/i, "");
    const heading = result.breadcrumb.at(-1);
    return heading ? `${path}#${heading}` : path;
  }
}
