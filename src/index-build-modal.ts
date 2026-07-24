import { App, ButtonComponent, Modal, Setting } from "obsidian";
import type { IndexBuildSummary } from "./index-build-plan";
import type { IncrementalIndexSummary } from "./incremental-index-plan";
import { incrementalIndexConfirmationModel, IndexBuildConfirmationModel, indexBuildConfirmationModel } from "./index-build-confirmation";

class IndexBuildModal extends Modal {
  private confirmed = false;
  private settled = false;

  constructor(
    app: App,
    private readonly model: IndexBuildConfirmationModel,
    private readonly resolveConfirmation: (confirmed: boolean) => void
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
    if (model.noEmbeddingMessage) this.contentEl.createEl("p", { text: model.noEmbeddingMessage });

    const actions = new Setting(this.contentEl);
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
export function confirmLargeIncrementalIndexUpdate(app: App, summary: IncrementalIndexSummary): Promise<boolean> {
  return new Promise((resolve) => {
    new IndexBuildModal(app, incrementalIndexConfirmationModel(summary), resolve).open();
  });
}
