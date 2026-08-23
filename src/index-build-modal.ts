import { App, ButtonComponent, Modal, Setting } from "obsidian";
import { formatIncrementalIndexDiagnostic, type IncrementalIndexDiagnostic } from "./incremental-index-diagnostics";
import type { IndexBuildSummary } from "./index-build-plan";
import type { IncrementalIndexSummary } from "./incremental-index-plan";
import { incrementalIndexConfirmationModel, type IncrementalIndexPreviewModel, IndexBuildConfirmationModel, indexBuildConfirmationModel } from "./index-build-confirmation";

class IndexBuildModal extends Modal {
  private confirmed = false;
  private settled = false;

  constructor(
    app: App,
    private readonly model: IndexBuildConfirmationModel,
    private readonly resolveConfirmation: (confirmed: boolean) => void,
    private readonly diagnosticText?: string
  ) {
    super(app);
  }

  onOpen(): void {
    const model = this.model;
    this.setTitle(model.title);
    this.contentEl.createEl("p", { text: model.prompt });

    for (const line of model.lines) {
      new Setting(this.contentEl)
        .setName(line.label)
        .setDesc(line.value);
    }
    if (model.incrementalPreview) this.renderIncrementalPreview(model.incrementalPreview);
    if (model.noEmbeddingMessage) this.contentEl.createEl("p", { text: model.noEmbeddingMessage });

    const actions = new Setting(this.contentEl);
    if (this.diagnosticText) {
      actions.addButton((button) => button
        .setButtonText("复制诊断")
        .onClick(() => void this.copyDiagnostic(button)));
    }
    actions.addButton((button) => button
      .setButtonText("取消")
      .onClick(() => this.close()));
    actions.addButton((button) => this.configureConfirmButton(button, model.confirmLabel));
  }

  onClose(): void {
    this.contentEl.empty();
    if (this.settled) return;
    this.settled = true;
    this.resolveConfirmation(this.confirmed);
  }

  private renderIncrementalPreview(preview: IncrementalIndexPreviewModel): void {
    const container = this.contentEl.createDiv({ cls: "palimpsest-index-update-preview" });
    container.createEl("h3", { text: "待生成向量预览" });

    if (preview.directoryRows.length) {
      container.createEl("h4", { text: "按目录待生成向量" });
      const directories = container.createDiv({ cls: "palimpsest-index-update-preview-directories" });
      for (const row of preview.directoryRows) this.renderPreviewRow(directories, row);
    }

    const documentHeader = container.createDiv({ cls: "palimpsest-index-update-preview-document-header" });
    documentHeader.createEl("h4", { text: "待生成最多的文档" });
    const documents = container.createDiv({ cls: "palimpsest-index-update-preview-documents" });
    let showAll = false;
    const renderDocuments = () => {
      documents.empty();
      const rows = showAll ? preview.documentRows : preview.documentRows.slice(0, 10);
      for (const row of rows) this.renderPreviewRow(documents, row);
    };
    renderDocuments();

    if (preview.documentRows.length > 10) {
      const toggle = documentHeader.createEl("button", { cls: "palimpsest-index-update-preview-toggle" });
      toggle.type = "button";
      const renderToggle = () => {
        toggle.textContent = showAll ? "仅显示前 10 篇" : `查看全部 ${preview.documentRows.length} 篇`;
      };
      renderToggle();
      toggle.addEventListener("click", () => {
        showAll = !showAll;
        renderDocuments();
        renderToggle();
      });
    }
  }

  private renderPreviewRow(container: HTMLElement, row: { path: string; detail: string }): void {
    const element = container.createDiv({ cls: "palimpsest-index-update-preview-row" });
    element.createDiv({ cls: "palimpsest-index-update-preview-path", text: row.path });
    element.createDiv({ cls: "palimpsest-index-update-preview-detail", text: row.detail });
  }

  private async copyDiagnostic(button: ButtonComponent): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.diagnosticText!);
      button.setButtonText("已复制诊断");
    } catch (error) {
      console.error("[Palimpsest] Could not copy incremental-index diagnostics", error);
      button.setButtonText("复制诊断失败");
    }
  }

  private configureConfirmButton(button: ButtonComponent, label: string): void {
    button
      .setButtonText(label)
      .setCta()
      .onClick(() => {
        if (this.confirmed) return;
        this.confirmed = true;
        button.setDisabled(true);
        // Resolve from onClose so execution begins only after the Modal closes.
        this.close();
      });
  }
}

/** Obsidian adapter for a prepared-plan confirmation; it never scans or embeds. */
export function confirmIndexBuild(
  app: App,
  summary: IndexBuildSummary,
  hasUsableIndex: boolean
): Promise<boolean> {
  return new Promise((resolve) => {
    new IndexBuildModal(app, indexBuildConfirmationModel(summary, hasUsableIndex), resolve).open();
  });
}

/** Uses the full-build Modal state machine rather than a second confirmation implementation. */
export function confirmLargeIncrementalIndexUpdate(app: App, summary: IncrementalIndexSummary, diagnostic?: IncrementalIndexDiagnostic): Promise<boolean> {
  return new Promise((resolve) => {
    new IndexBuildModal(
      app,
      incrementalIndexConfirmationModel(summary, diagnostic),
      resolve,
      diagnostic ? formatIncrementalIndexDiagnostic(diagnostic) : undefined
    ).open();
  });
}

/** Opens a user-requested read-only plan preview; embedding begins only after confirmation. */
export function confirmIncrementalIndexPreview(app: App, summary: IncrementalIndexSummary, diagnostic: IncrementalIndexDiagnostic): Promise<boolean> {
  return new Promise((resolve) => {
    new IndexBuildModal(
      app,
      incrementalIndexConfirmationModel(summary, diagnostic, true),
      resolve,
      formatIncrementalIndexDiagnostic(diagnostic)
    ).open();
  });
}
