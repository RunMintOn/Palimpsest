import { App, FuzzySuggestModal, Notice, PluginSettingTab, Setting, TFolder } from "obsidian";
import { addExcludedDirectory, filterExcludedDirectoryCandidates, indexScope } from "./index-scope";
import SideGrepPlugin from "./main";

export interface SideGrepSettings {
  endpoint: string;
  model: string;
  dimensions: number;
  keepAlive: string;
  queryDebounceMs: number;
  queryMaxLength: number;
  chunkTargetLength: number;
  chunkMaxLength: number;
  chunkMinLength: number;
  topK: number;
  maxPerFile: number;
  excludedDirectories: string[];
  queryInstruction: string;
  embeddingBatchSize: number;
  autoExpandCount: number;
  autoExpandThresholdEnabled: boolean;
  autoExpandThreshold: number;
}

export const DEFAULT_SETTINGS: SideGrepSettings = {
  endpoint: "http://127.0.0.1:11434/api/embed",
  model: "qwen3-embedding:0.6b",
  dimensions: 1024,
  keepAlive: "5m",
  queryDebounceMs: 800,
  queryMaxLength: 1400,
  chunkTargetLength: 650,
  chunkMaxLength: 1100,
  chunkMinLength: 80,
  topK: 5,
  maxPerFile: 2,
  excludedDirectories: [".obsidian"],
  queryInstruction: "Given a Chinese note search query, retrieve relevant passages from a local Markdown knowledge base.",
  embeddingBatchSize: 16,
  autoExpandCount: 3,
  autoExpandThresholdEnabled: false,
  autoExpandThreshold: 0.3
};

/** Stored settings may still contain the pre-schema string form. */
export interface StoredSideGrepSettings extends Omit<Partial<SideGrepSettings>, "excludedDirectories"> {
  excludedDirectories?: string | string[];
}

export function migrateSettings(settings: StoredSideGrepSettings = {}): SideGrepSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    excludedDirectories: indexScope(settings.excludedDirectories ?? DEFAULT_SETTINGS.excludedDirectories).excludedDirectories
  };
}

class ExcludedDirectorySuggestModal extends FuzzySuggestModal<TFolder> {
  constructor(
    app: App,
    private readonly folders: TFolder[],
    private readonly onChooseDirectory: (directory: string) => void
  ) {
    super(app);
    this.setPlaceholder("搜索目录名称或路径");
  }

  getItems(): TFolder[] {
    return this.folders;
  }

  getItemText(folder: TFolder): string {
    return folder.path;
  }

  onChooseItem(folder: TFolder): void {
    this.onChooseDirectory(folder.path);
  }
}

export class SideGrepSettingTab extends PluginSettingTab {
  private scopeSaving = false;

  constructor(app: App, private readonly plugin: SideGrepPlugin) { super(app, plugin); }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Palimpsest 设置" });
    containerEl.createEl("p", { text: "修改模型、维度或切分长度后，现有索引会标记为需重建，避免混用向量。" });
    this.indexScopeSettings();
    this.heading("Embedding 服务");
    this.text("Ollama endpoint", "本地 /api/embed URL", "endpoint");
    this.text("模型名称", "qwen3-embedding:0.6b", "model");
    this.number("Embedding dimensions", "默认 1024；改变后必须重建", "dimensions", 32);
    this.text("keep_alive", "5m", "keepAlive");
    this.heading("查询与召回");
    this.number("查询 debounce (ms)", "停止输入多久后查询", "queryDebounceMs", 100);
    this.number("查询最大长度", "局部上下文最大字符数", "queryMaxLength", 64);
    this.heading("片段切分");
    this.number("片段目标长度", "推荐 500–700 字符", "chunkTargetLength", 1);
    this.number("片段最大长度", "推荐 1000–1200 字符", "chunkMaxLength", 1);
    this.number("片段最小有效长度", "短而有意义的笔记仍可索引", "chunkMinLength", 1);
    this.heading("检索结果");
    this.number("Top K", "返回结果数", "topK", 1);
    this.number("每文件最大结果数", "默认最多两个片段", "maxPerFile", 1);
    this.heading("自动展开");
    this.expansionSettings();
    this.heading("索引构建");
    this.number("建库批量大小", "每次 Ollama 文档 embedding 数", "embeddingBatchSize", 1);
    this.heading("查询指令");
    this.queryInstruction();
  }

  private heading(name: string): void {
    new Setting(this.containerEl).setName(name).setHeading();
  }

  private indexScopeSettings(): void {
    this.containerEl.createEl("h3", { text: "索引范围" });
    this.containerEl.createEl("p", { text: "以下目录不会参与全文索引。修改会立即保存，但需要完成一次全量重建后才会应用到当前索引。" });
    this.indexScopeStatus();

    const excludedDirectories = this.plugin.settings.excludedDirectories;
    if (excludedDirectories.length === 0) {
      new Setting(this.containerEl).setName("尚未排除任何目录");
    } else {
      for (const directory of excludedDirectories) this.excludedDirectorySetting(directory);
    }

    new Setting(this.containerEl)
      .setName("添加排除目录")
      .addButton((button) => button
        .setButtonText("选择目录")
        .setDisabled(this.scopeSaving)
        .onClick(() => this.openDirectoryPicker()));
  }

  private indexScopeStatus(): void {
    const scope = this.plugin.getIndexScopeView();
    if (scope.status === "uninitialized") {
      this.containerEl.createEl("p", { text: "尚未建立索引。以上范围将在首次建立索引时使用。" });
      return;
    }
    if (scope.status === "current") {
      this.containerEl.createEl("p", { text: "当前索引已经应用以上范围。" });
      return;
    }
    this.containerEl.createEl("p", { text: "索引范围设置已保存，但尚未应用。" });
    this.containerEl.createEl("p", { text: "当前搜索仍继续使用上次构建时的范围；完成全量重建后，新范围才会生效。" });
    this.containerEl.createEl("p", { text: `当前生效：${this.scopeLabel(scope.effective?.excludedDirectories ?? [])}` });
    this.containerEl.createEl("p", { text: `准备应用：${this.scopeLabel(scope.desired.excludedDirectories)}` });
  }

  private excludedDirectorySetting(directory: string): void {
    const exists = this.app.vault.getAbstractFileByPath(directory) instanceof TFolder;
    const setting = new Setting(this.containerEl).setName(directory);
    if (!exists) setting.setDesc("目录当前不存在");
    setting.addExtraButton((button) => button
      .setIcon("trash")
      .setTooltip("删除排除目录")
      .setDisabled(this.scopeSaving)
      .onClick(() => void this.saveExcludedDirectories(
        this.plugin.settings.excludedDirectories.filter((excluded) => excluded !== directory)
      )));
  }

  private openDirectoryPicker(): void {
    if (this.scopeSaving) return;
    const folders = this.app.vault.getAllFolders(false);
    const eligiblePaths = new Set(filterExcludedDirectoryCandidates(
      folders.filter((folder) => !folder.isRoot()).map((folder) => folder.path),
      this.plugin.settings.excludedDirectories
    ));
    const eligibleFolders = folders.filter((folder) => eligiblePaths.has(folder.path));
    new ExcludedDirectorySuggestModal(this.app, eligibleFolders, (directory) => void this.saveExcludedDirectories(
      addExcludedDirectory(this.plugin.settings.excludedDirectories, directory)
    )).open();
  }

  private async saveExcludedDirectories(excludedDirectories: string[]): Promise<void> {
    if (this.scopeSaving) return;
    const previous = this.plugin.settings.excludedDirectories;
    this.scopeSaving = true;
    this.plugin.settings.excludedDirectories = excludedDirectories;
    this.display();
    try {
      await this.plugin.saveSettings();
      this.plugin.onSettingsChanged();
    } catch (error) {
      this.plugin.settings.excludedDirectories = previous;
      new Notice(`保存索引范围失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.scopeSaving = false;
      this.display();
    }
  }

  private scopeLabel(directories: readonly string[]): string {
    return directories.length ? directories.join("、") : "未排除目录";
  }

  private expansionSettings(): void {
    new Setting(this.containerEl)
      .setName("默认展开结果")
      .setDesc("用户手动展开或折叠后，将优先保留用户选择")
      .addDropdown((dropdown) => dropdown
        .addOption("0", "全部折叠")
        .addOption("1", "前 1 个")
        .addOption("3", "前 3 个")
        .addOption("5", "前 5 个")
        .addOption("-1", "全部展开")
        .setValue(String(this.plugin.settings.autoExpandCount))
        .onChange(async (value) => this.persistSetting("autoExpandCount", Number(value))));

    new Setting(this.containerEl)
      .setName("使用自动展开相似度阈值")
      .setDesc("开启后，低于阈值的结果不会自动展开")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.autoExpandThresholdEnabled)
        .onChange(async (value) => this.persistSetting("autoExpandThresholdEnabled", value)));

    new Setting(this.containerEl)
      .setName("自动展开最低相似度")
      .setDesc("范围 0–1；仅在启用阈值时生效")
      .addText((text) => text
        .setValue(String(this.plugin.settings.autoExpandThreshold))
        .onChange(async (value) => {
          const number = Number(value);
          if (Number.isFinite(number) && number >= 0 && number <= 1) await this.persistSetting("autoExpandThreshold", number);
        }));
  }

  private text(label: string, description: string, key: keyof SideGrepSettings): void {
    const value = String(this.plugin.settings[key]);
    new Setting(this.containerEl).setName(label).setDesc(description).addText((text) => text
      .setValue(value)
      .onChange(async (newValue) => this.persistSetting(key, newValue)));
  }

  private queryInstruction(): void {
    new Setting(this.containerEl)
      .setName("Query instruction")
      .setDesc("会添加在 Query: 前")
      .addTextArea((text) => {
        text.inputEl.rows = 4;
        text
          .setValue(this.plugin.settings.queryInstruction)
          .onChange(async (value) => this.persistSetting("queryInstruction", value));
      });
  }

  private number(label: string, description: string, key: keyof SideGrepSettings, min: number): void {
    new Setting(this.containerEl).setName(label).setDesc(description).addText((text) => text
      .setValue(String(this.plugin.settings[key]))
      .setPlaceholder(String(min))
      .onChange(async (value) => {
        const number = Number(value);
        if (Number.isFinite(number) && number >= min) await this.persistSetting(key, number);
      }));
  }

  private async persistSetting(key: keyof SideGrepSettings, value: SideGrepSettings[keyof SideGrepSettings]): Promise<void> {
    (this.plugin.settings as unknown as Record<string, unknown>)[key] = value;
    await this.plugin.saveSettings();
    this.plugin.onSettingsChanged();
  }
}
