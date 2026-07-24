import { Editor, MarkdownView, Notice, Plugin, TAbstractFile, TFile, TFolder, WorkspaceLeaf, requestUrl } from "obsidian";
import { embeddingText } from "./chunker";
import { embeddingInputHash } from "./embedding-reuse";
import { BuildCancellationController, BuildCancellationToken, IndexBuildCancelled } from "./build-cancellation";
import { BulkIndexUpdateDeferral } from "./bulk-index-update-deferral";
import { EmbeddingError, OllamaEmbeddingProvider } from "./embedding-provider";
import { FullIndexBuildRequestGate, runConfirmedIndexBuild } from "./index-build-flow";
import { confirmIndexBuild, confirmLargeIncrementalIndexUpdate } from "./index-build-modal";
import { IndexBuildPlanStale, PreparedIndexBuild, VaultRevision, assertIndexBuildPlanCurrent, executePreparedIndexBuild as executePlan, prepareIndexBuild as preparePlan } from "./index-build-plan";
import { IndexDocumentScanStale, IndexDocumentStructureError, ScannedIndexDocument, scanIndexDocument } from "./index-document-scan";
import { PersistentIndex } from "./persistent-index";
import { createIndexStore, IndexDocument, IndexStore } from "./index-store";
import { indexLoadRecoveryMessage } from "./index-load-feedback";
import { runPreparedIncrementalIndexUpdate } from "./incremental-index-flow";
import { executeIncrementalIndexPlan, IncrementalChangeSummary, isLargeIncrementalIndexPlan, prepareIncrementalIndexPlan } from "./incremental-index-plan";
import { runIndexReconciliation } from "./index-reconciliation";
import { pluginSettingsData, settingsFromPluginData } from "./plugin-settings-data";
import { IndexScope, IndexScopeStatus, indexScope, indexScopeStatus, isPathExcluded } from "./index-scope";
import { buildQueryContext } from "./query-context";
import { QueryGate } from "./query-gate";
import { QueryLifecycleCoordinator, QuerySchedule } from "./query-lifecycle";
import { rankChunks } from "./retrieval";
import type { ResultExcerptPresentation } from "./result-presentation";
import { migrateSettings, SideGrepSettings, SideGrepSettingTab, StoredSideGrepSettings } from "./settings";
import { SidebarActions, PALIMPSEST_VIEW_TYPE, SideGrepView } from "./sidebar-view";
import { CHUNKER_VERSION, IndexIdentity, IndexedChunk, IndexProgress, PersistentIndexData, SearchResult, SidebarState, SkippedIndexedDocument } from "./types";
import { ensureVaultIdentity } from "./vault-identity";
import { planVaultChanges, VaultChange, VaultChangeQueue } from "./vault-change-plan";

/** Read-only index-scope state intended for settings and other UI consumers. */
export interface IndexScopeView {
  status: IndexScopeStatus;
  desired: IndexScope;
  effective?: IndexScope;
}

export default class SideGrepPlugin extends Plugin implements SidebarActions {
  settings: SideGrepSettings = migrateSettings();
  private index!: PersistentIndex;
  private indexStore: IndexStore | undefined;
  private queryTimer: number | undefined;
  private modelTimer: number | undefined;
  private updateTimer: number | undefined;
  private readonly pendingVaultChanges = new VaultChangeQueue();
  private flushingFileUpdates = false;
  private readonly queryGate = new QueryGate();
  private lifecycle = new QueryLifecycleCoordinator("uninitialized");
  private latestMarkdownView: MarkdownView | undefined;
  private lastActivatedMarkdownPath: string | undefined;
  private state: SidebarState = { kind: "waiting-input", message: "等待输入" };
  private results: SearchResult[] = [];
  private preparingIndex = false;
  private indexing = false;
  /** Once durable publication starts, ordinary cancellation cannot change its result. */
  private committingIndex = false;
  private readonly fullIndexBuildRequests = new FullIndexBuildRequestGate();
  private readonly vaultRevision = new VaultRevision();
  private readonly buildCancellation = new BuildCancellationController();
  /** A cancelled bulk patch remains intentionally deferred until a full rebuild. */
  private readonly deferredLargeIndexUpdate = new BulkIndexUpdateDeferral();
  /** A fallback generation is queryable but deliberately not patchable in place. */
  private fallbackGenerationInUse = false;
  private retryingSkippedDocuments = false;

  async onload(): Promise<void> {
    let saved: unknown;
    try {
      saved = await this.loadData() ?? {};
    } catch (error) {
      console.error("[Palimpsest] Could not read plugin settings; using defaults without touching the existing data file", error);
    }
    this.settings = migrateSettings(settingsFromPluginData<StoredSideGrepSettings>(saved));
    let persistedIndex: PersistentIndexData | undefined;
    try {
      const identity = await ensureVaultIdentity({ configDir: this.app.vault.configDir, adapter: this.app.vault.adapter });
      this.indexStore = createIndexStore(identity.vaultId);
      const loaded = await this.indexStore.load();
      if (loaded.status === "ready") {
        persistedIndex = loaded.data;
        if (loaded.recovery) {
          this.fallbackGenerationInUse = true;
          console.warn("[Palimpsest] IndexedDB loaded the previous valid index generation after recovery");
        }
        const recoveryMessage = indexLoadRecoveryMessage(loaded);
        if (recoveryMessage) new Notice(recoveryMessage);
      }
    } catch (error) {
      console.error("[Palimpsest] Could not initialize the local IndexedDB index; the index remains uninitialized", error);
      this.indexStore?.close();
      this.indexStore = undefined;
    }
    // Intentionally ignore legacy saved.index even when an old data.json happens to parse.
    this.index = new PersistentIndex(this.indexIdentity(), persistedIndex, this.desiredIndexScope());
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
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => this.scheduleRename(file, oldPath)));
    this.showIndexRequirement();
    this.app.workspace.onLayoutReady(() => {
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (view) {
        this.latestMarkdownView = view;
        this.lifecycle.rememberMarkdownContext();
      }
      const schedule = this.lifecycle.layoutReady();
      if (schedule) this.scheduleQueryFromCurrentEditor(schedule);
      void this.reconcileIndexAfterLayout();
    });
  }

  onunload(): void {
    this.buildCancellation.unload();
    this.indexStore?.close();
    this.clearQueryTimers();
    if (this.updateTimer !== undefined) window.clearTimeout(this.updateTimer);
    this.updateTimer = undefined;
    this.queryGate.invalidate();
  }

  async saveSettings(): Promise<void> {
    this.settings = migrateSettings(this.settings);
    await this.saveData(pluginSettingsData(this.settings));
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

  /** Small, user-facing status only; IndexedDB cannot reliably report this vault's disk bytes. */
  getLocalIndexStatus(): { status: "uninitialized" | "ready" | "incompatible"; documents?: number; chunks?: number; skipped?: number } {
    const lifecycle = this.index.lifecycle(this.indexIdentity());
    if (lifecycle === "uninitialized") return { status: "uninitialized" };
    return { status: lifecycle === "ready" ? "ready" : "incompatible", documents: this.index.documents.length, chunks: this.index.size, skipped: this.index.skippedDocuments.length };
  }

  /** Settings-only view of safe skip metadata; source text and errors never leave IndexStore. */
  getSkippedDocumentReport(): { documents: readonly SkippedIndexedDocument[]; retrying: boolean } {
    return { documents: this.index.skippedDocuments, retrying: this.retryingSkippedDocuments };
  }

  /** Retries only persisted skipped paths through the normal incremental pipeline. */
  async retrySkippedDocuments(): Promise<void> {
    if (this.retryingSkippedDocuments || !this.index.skippedDocuments.length) return;
    if (this.isBuildActive()) throw new Error("索引正在更新，完成后再重试未索引文档");
    const scope = this.index.scope;
    if (!scope) throw new Error("当前索引不可用于增量重试，请先全量重建");
    this.retryingSkippedDocuments = true;
    this.flushingFileUpdates = true;
    try {
      const changes = this.index.skippedDocuments.map((document) => ({ kind: "path", path: document.filePath } as const));
      const refreshQuery = await this.commitChangedDocuments(changes, scope, true);
      if (refreshQuery) this.refreshCurrentQuery();
    } catch (error) {
      console.error("[Palimpsest] Could not retry skipped documents", error);
      if (this.buildCancellation.isPluginActive) new Notice("重试未索引文档失败；原有报告已保留。");
    } finally {
      this.flushingFileUpdates = false;
      this.retryingSkippedDocuments = false;
    }
  }

  /** Removes only the durable data for this vault, then makes queries visibly uninitialized. */
  async clearLocalIndex(): Promise<void> {
    if (this.isBuildActive()) throw new Error("索引正在更新，完成或取消后再清除本地索引");
    await this.requireIndexStore().clear();
    this.buildCancellation.assertPluginActive();
    this.index = new PersistentIndex(this.indexIdentity(), undefined, this.desiredIndexScope());
    this.pendingVaultChanges.clear();
    this.deferredLargeIndexUpdate.clear();
    this.fallbackGenerationInUse = false;
    this.queryGate.invalidate();
    this.results = [];
    this.syncQueryAvailability();
    this.present({
      kind: "index-needed",
      message: "本地索引已清除",
      detail: "重新建立索引后即可继续检索。",
      indexAction: "build"
    }, []);
  }

  private syncQueryAvailability(): void {
    const lifecycle = this.index.lifecycle(this.indexIdentity());
    this.lifecycle.setIndexAvailability(lifecycle === "ready" ? "ready" : lifecycle === "incompatible" ? "incompatible" : "uninitialized");
  }

  private isBuildActive(): boolean {
    return this.preparingIndex || this.indexing || this.committingIndex || this.flushingFileUpdates;
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
    this.queueVaultChange(file instanceof TFolder ? { kind: "folder-delete", path: file.path } : { kind: "path", path: file.path });
  }

  private scheduleRename(file: TAbstractFile, oldPath: string): void {
    this.queueVaultChange({ kind: "rename", oldPath, newPath: file.path, isFolder: file instanceof TFolder });
  }

  private queueVaultChange(change: VaultChange): void {
    this.vaultRevision.noteChange();
    this.pendingVaultChanges.enqueue(change, this.vaultRevision.value);
    // Recovery/defer state only suppresses immediate work or a repeat modal;
    // it must never make a vault event disappear.
    if (this.fallbackGenerationInUse || this.deferredLargeIndexUpdate.isDeferred) return;
    if (this.isBuildActive()) {
      return;
    }
    if (!this.index.isReady(this.indexIdentity())) return;
    this.schedulePendingFileUpdates();
  }

  private schedulePendingFileUpdates(): void {
    if (!this.buildCancellation.isPluginActive) return;
    if (this.updateTimer) window.clearTimeout(this.updateTimer);
    this.updateTimer = window.setTimeout(() => void this.flushFileUpdates(), 500);
  }

  /** Layout-ready startup check compares path/stat metadata only, never every note body. */
  private async reconcileIndexAfterLayout(): Promise<void> {
    if (!this.buildCancellation.isPluginActive || !this.index.isReady(this.indexIdentity()) || this.fallbackGenerationInUse || this.deferredLargeIndexUpdate.isDeferred || this.isBuildActive()) return;
    const scope = this.index.scope;
    if (!scope) return;
    try {
      await runIndexReconciliation(
        [...this.index.documents, ...this.index.skippedDocuments],
        () => this.app.vault.getMarkdownFiles()
          .filter((file) => !this.isExcluded(file.path, scope))
          .map((file) => ({ path: file.path, mtime: file.stat.mtime, size: file.stat.size })),
        (changes) => {
          if (!changes.length || this.deferredLargeIndexUpdate.isDeferred) return;
          this.vaultRevision.noteChange();
          for (const change of changes) this.pendingVaultChanges.enqueue(change, this.vaultRevision.value);
          this.schedulePendingFileUpdates();
        }
      );
    } catch (error) {
      console.error("[Palimpsest] Could not reconcile the local index with the vault", error);
      new Notice("无法核对本地索引与 vault 文件；当前索引仍可用，可稍后全量重建。");
    }
  }

  private async flushFileUpdates(): Promise<void> {
    this.updateTimer = undefined;
    if (!this.buildCancellation.isPluginActive || this.deferredLargeIndexUpdate.isDeferred || this.fallbackGenerationInUse || this.flushingFileUpdates || this.isBuildActive() || !this.index.isReady(this.indexIdentity())) return;
    const changes = this.pendingVaultChanges.take();
    if (!changes.length) return;
    const effectiveScope = this.index.scope;
    if (!effectiveScope) return;
    this.flushingFileUpdates = true;
    let failed = false;
    let refreshQuery = false;
    try {
      refreshQuery = await this.commitChangedDocuments(changes, effectiveScope);
    } catch (error) {
      // Restore this snapshot ahead of events received while it was processed.
      this.pendingVaultChanges.restore(changes);
      if (error instanceof IndexBuildCancelled && !this.buildCancellation.isPluginActive) return;
      failed = true;
      this.present({
        kind: "index-failed",
        message: `增量索引失败：${error instanceof Error ? error.message : String(error)}`,
        detail: "现有索引仍可用。请全量重建以恢复待处理的文件变化。",
        indexAction: "rebuild"
      }, this.results);
    } finally {
      this.flushingFileUpdates = false;
      if (!this.buildCancellation.isPluginActive) return;
      if (refreshQuery) this.refreshCurrentQuery();
      if (!failed && this.pendingVaultChanges.size && !this.isBuildActive() && this.index.isReady(this.indexIdentity())) {
        this.schedulePendingFileUpdates();
      }
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
    } finally {
      // A failed/cancelled full build must leave captured vault events
      // recoverable; a successful build has already discarded only events its
      // scan covered. Never revive work after unload or while fallback/defer
      // deliberately blocks patching.
      if (this.buildCancellation.isPluginActive && this.pendingVaultChanges.size && this.index.isReady(this.indexIdentity()) &&
        !this.fallbackGenerationInUse && !this.deferredLargeIndexUpdate.isDeferred) {
        this.schedulePendingFileUpdates();
      }
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
    const documents: ScannedIndexDocument[] = [];
    const skippedDocuments: SkippedIndexedDocument[] = [];
    this.preparingIndex = true;
    const buildToken = this.buildCancellation.startBuild();
    this.queryGate.invalidate();
    this.presentIndexProgress({ phase: "scanning", current: 0, total: files.length, label: "正在扫描笔记" });
    try {
      for (let index = 0; index < files.length; index++) {
        this.buildCancellation.assertBuildCanContinue(buildToken);
        const file = files[index];
        try {
          documents.push(await scanIndexDocument(file, identity, (source) => this.app.vault.cachedRead(source as TFile), () => this.buildCancellation.assertBuildCanContinue(buildToken)));
        } catch (error) {
          if (error instanceof IndexDocumentScanStale) throw new IndexBuildPlanStale("vault");
          if (error instanceof IndexDocumentStructureError) {
            skippedDocuments.push({ ...error.document, reasonCode: error.reasonCode });
          } else {
            throw error;
          }
        }
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
        documents,
        skippedDocuments,
        reusableById: this.index.reusableById(identity),
        reusableChunks: this.index.chunks,
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
      // This is the last ordinary-cancel barrier. Once durable publication
      // begins, only plugin unload can prevent memory/UI follow-up.
      this.buildCancellation.beginDurableCommit(buildToken);
      const chunkCount = executed.documents.reduce((total, document) => total + document.chunks.length, 0);
      this.presentIndexProgress({ phase: "saving", current: chunkCount, total: chunkCount, label: "正在保存索引" });
      this.committingIndex = true;
      try {
        await this.commitFullIndex(executed.identity, [...executed.documents, ...executed.skippedDocuments], executed.scope);
      } finally {
        this.committingIndex = false;
        this.buildCancellation.finishDurableCommit(buildToken);
      }
      this.buildCancellation.assertPluginActive();
      this.pendingVaultChanges.discardThrough(executed.vaultRevision);
      this.deferredLargeIndexUpdate.clear();
      this.fallbackGenerationInUse = false;
      this.syncQueryAvailability();
      this.present({ kind: "complete", message: `索引完成：${chunkCount} 个片段；${executed.skippedDocuments.length} 篇笔记未索引` }, this.results);
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
    }
  }

  private presentBuildFailure(error: unknown, hadUsableIndex: boolean): void {
    if (!this.buildCancellation.isPluginActive) return;
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
    if (!this.isBuildActive() || this.committingIndex) return;
    this.buildCancellation.cancelCurrentBuild();
  }

  /** Prepares all vault reads and embeddings before one durable patch transaction. */
  private async commitChangedDocuments(changes: readonly VaultChange[], scope: IndexScope, skipLargeConfirmation = false): Promise<boolean> {
    this.buildCancellation.assertPluginActive();
    const markdownFiles = this.app.vault.getMarkdownFiles();
    const byPath = new Map(markdownFiles.map((file) => [file.path, file]));
    const plan = planVaultChanges({
      changes,
      indexedDocumentPaths: this.index.documentPaths,
      currentMarkdownPaths: markdownFiles.map((file) => file.path),
      isIncluded: (path) => !this.isExcluded(path, scope)
    });
    const files = plan.upsertPaths.map((path) => byPath.get(path)).filter((file): file is TFile => file !== undefined);
    const scanned = await this.scanIncrementalDocuments(files);
    const current = { vaultRevision: this.vaultRevision.value, identity: this.indexIdentity(), scope };
    const prepared = prepareIncrementalIndexPlan({
      documents: scanned.documents,
      skippedDocuments: scanned.skippedDocuments,
      deletes: plan.deletes,
      reusableChunks: this.index.chunks,
      current,
      changes: this.incrementalChangeSummary(changes, plan.upsertPaths, plan.deletes)
    });
    if (!prepared.summary.documents && !plan.deletes.length) return false;
    const outcome = await runPreparedIncrementalIndexUpdate({
      needsConfirmation: !skipLargeConfirmation && isLargeIncrementalIndexPlan(prepared.summary),
      confirm: () => confirmLargeIncrementalIndexUpdate(this.app, prepared.summary),
      execute: () => executeIncrementalIndexPlan(prepared, {
        current: { vaultRevision: this.vaultRevision.value, identity: this.indexIdentity(), scope: this.index.scope ?? scope },
        batchSize: this.settings.embeddingBatchSize,
        embedDocuments: async (chunks) => (await this.provider().embedDocuments(chunks.map(embeddingText))).vectors,
        assertCanContinue: () => this.buildCancellation.assertPluginActive(),
        yieldToUi: () => this.yieldToUi()
      }),
      commit: async (executed) => {
        this.buildCancellation.assertPluginActive();
        const durable = await this.requireIndexStore().commit({
          kind: "patch-documents",
          identity: this.indexIdentity(),
          upserts: executed.upserts,
          deletes: executed.deletes
        });
        // A successful durable write survives unload, but an unloading plugin
        // must not mutate memory or the UI after it completes.
        this.buildCancellation.assertPluginActive();
        this.index.commit(durable);
        this.buildCancellation.assertPluginActive();
      }
    });
    if (outcome === "cancelled") {
      // Do not restore this batch: repeatedly showing the same confirmation is
      // worse than explicitly leaving the known-good generation in service.
      this.deferredLargeIndexUpdate.defer();
      this.present({
        kind: "index-cancelled",
        message: "已取消大规模索引更新，正在继续使用原有索引",
        detail: "请通过“重建索引”稍后处理这些变化。",
        indexAction: "rebuild"
      }, this.results);
      return false;
    }
    const activePath = this.latestMarkdownView?.file?.path;
    return [...plan.upsertPaths, ...plan.deletes].some((path) => path !== activePath);
  }

  private incrementalChangeSummary(changes: readonly VaultChange[], upserts: readonly string[], deletes: readonly string[]): IncrementalChangeSummary {
    const indexed = new Set(this.index.documentPaths);
    const renamePaths = new Set<string>();
    for (const change of changes) {
      if (change.kind !== "rename") continue;
      if (!change.isFolder) renamePaths.add(change.newPath);
      else {
        const prefix = `${change.newPath}/`;
        for (const path of upserts) if (path === change.newPath || path.startsWith(prefix)) renamePaths.add(path);
      }
    }
    const added = upserts.filter((path) => !indexed.has(path) && !renamePaths.has(path)).length;
    const renamed = upserts.filter((path) => renamePaths.has(path)).length;
    return { added, renamed, modified: upserts.length - added - renamed, deleted: deletes.length };
  }

  private async scanIncrementalDocuments(files: readonly TFile[]): Promise<{ documents: ScannedIndexDocument[]; skippedDocuments: SkippedIndexedDocument[] }> {
    const documents: ScannedIndexDocument[] = [];
    const skippedDocuments: SkippedIndexedDocument[] = [];
    const identity = this.indexIdentity();
    for (let index = 0; index < files.length; index++) {
      try {
        documents.push(await scanIndexDocument(files[index], identity, (file) => this.app.vault.cachedRead(file as TFile), () => this.buildCancellation.assertPluginActive()));
      } catch (error) {
        if (error instanceof IndexDocumentStructureError) skippedDocuments.push({ ...error.document, reasonCode: error.reasonCode });
        else throw error;
      }
      if (index % 8 === 7) {
        await this.yieldToUi();
        this.buildCancellation.assertPluginActive();
      }
    }
    return { documents, skippedDocuments };
  }

  private presentIndexProgress(progress: IndexProgress): void {
    this.present({ kind: "indexing", message: progress.label, progress }, this.results);
  }

  private async commitFullIndex(identity: IndexIdentity, documents: readonly (Omit<ScannedIndexDocument, "chunks"> & { chunks: IndexedChunk[] } | SkippedIndexedDocument)[], scope: IndexScope): Promise<void> {
    this.buildCancellation.assertPluginActive();
    const durable = await this.requireIndexStore().commit({
      kind: "replace-all",
      identity,
      scope,
      documents: documents.map((document): IndexDocument => "reasonCode" in document
        ? { ...document }
        : {
            filePath: document.filePath,
            fileName: document.fileName,
            sourceMtime: document.sourceMtime,
            sourceSize: document.sourceSize,
            chunks: document.chunks.map((chunk) => ({ ...chunk, embeddingInputHash: embeddingInputHash(chunk) }))
          })
    });
    this.buildCancellation.assertPluginActive();
    this.index.commit(durable);
    this.buildCancellation.assertPluginActive();
  }

  private requireIndexStore(): IndexStore {
    if (!this.indexStore) throw new Error("Local IndexedDB index storage is unavailable");
    return this.indexStore;
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
