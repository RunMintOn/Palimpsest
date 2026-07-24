import { App, FuzzySuggestModal, Notice, PluginSettingTab, Setting, TFolder } from "obsidian";
import { addExcludedDirectory, filterExcludedDirectoryCandidates, indexScope } from "./index-scope";
import SideGrepPlugin from "./main";
import { resetSectionForSetting, resetSettingsSection, settingsSectionDiffersFromDefaults, SettingsResetSection } from "./settings-reset";

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
  resultExcerptFontScale: number;
  resultExcerptLineHeight: number;
  resultExcerptMaxLines: number;
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
  autoExpandThreshold: 0.3,
  resultExcerptFontScale: 0.92,
  resultExcerptLineHeight: 1.48,
  resultExcerptMaxLines: 10
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

type SettingsPage = "index" | "appearance" | "embedding" | "retrieval";

const settingsPages: readonly { id: SettingsPage; label: string }[] = [
  { id: "index", label: "索引" },
  { id: "appearance", label: "外观" },
  { id: "embedding", label: "模型" },
  { id: "retrieval", label: "检索" }
];

export class SideGrepSettingTab extends PluginSettingTab {
  private scopeSaving = false;
  private fullBuildRequesting = false;
  private readonly resettingSections = new Set<SettingsResetSection>();
  private readonly resetControlEls = new Map<SettingsResetSection, HTMLElement>();
  private activePage: SettingsPage = "index";

  constructor(app: App, private readonly plugin: SideGrepPlugin) { super(app, plugin); }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    this.resetControlEls.clear();
    this.pageNavigation();
    if (this.activePage === "index") this.indexPage();
    else if (this.activePage === "appearance") this.appearancePage();
    else if (this.activePage === "embedding") this.embeddingPage();
    else this.retrievalPage();
  }

  private pageNavigation(): void {
    const navigation = new Setting(this.containerEl).setName("设置页面");
    for (const page of settingsPages) {
      navigation.addButton((button) => {
        button
          .setButtonText(page.label)
          .onClick(() => {
            if (this.activePage === page.id) return;
            this.activePage = page.id;
            this.display();
          });
        if (page.id === this.activePage) button.setCta();
      });
    }
  }

  private indexPage(): void {
    this.indexScopeSettings();
    this.localIndexStorageSettings();
    this.skippedDocumentSettings();
    this.heading("索引构建", "indexBuild");
    this.fullIndexBuildSetting();
    this.number("建库批量大小", "每次 Ollama 文档 embedding 数", "embeddingBatchSize", 1);
    this.heading("片段切分", "chunking");
    this.number("片段目标长度", "推荐 500–700 字符", "chunkTargetLength", 1);
    this.number("片段最大长度", "推荐 1000–1200 字符", "chunkMaxLength", 1);
    this.number("片段最小有效长度", "短而有意义的笔记仍可索引", "chunkMinLength", 1);
  }

  private localIndexStorageSettings(): void {
    this.heading("本地索引");
    const status = this.plugin.getLocalIndexStatus();
    const description = status.status === "uninitialized"
      ? "尚未建立本地索引。"
      : status.status === "ready"
        ? `当前本地索引包含 ${status.documents ?? 0} 篇文档、${status.chunks ?? 0} 个片段。`
        : `本地索引包含 ${status.documents ?? 0} 篇文档、${status.chunks ?? 0} 个片段，但当前设置需要重新建立。`;
    new Setting(this.containerEl)
      .setName("清除本地索引")
      .setDesc(`${description} 这不会删除 Markdown 笔记、插件设置或 vault 身份。`)
      .addButton((button) => button
        .setButtonText("清除本地索引")
        .setWarning()
        .onClick(async () => {
          // Clicking the destructive setting is the first action; this is the
          // explicit second confirmation before the vault-scoped IDB clear.
          if (!window.confirm("确定清除本 vault 的本地索引吗？Markdown 笔记和插件设置不会删除。")) return;
          button.setDisabled(true);
          try {
            await this.plugin.clearLocalIndex();
            new Notice("本地索引已清除，请重新建立索引。");
          } catch (error) {
            new Notice(`清除本地索引失败：${error instanceof Error ? error.message : String(error)}`);
          } finally {
            this.display();
          }
        }));
  }

  /** Persistent, safe per-file report; this is not a transient completion notice. */
  private skippedDocumentSettings(): void {
    this.heading("未索引文档");
    const report = this.plugin.getSkippedDocumentReport();
    new Setting(this.containerEl)
      .setName(`未索引文档：${report.documents.length} 篇`)
      .setDesc(report.documents.length ? "这些笔记在稳定扫描时无法生成可保存的片段；修改后会自动重试。" : "当前没有未索引文档。");
    for (const document of report.documents) {
      new Setting(this.containerEl)
        .setName(document.filePath)
        .setDesc(skippedDocumentReason(document.reasonCode));
    }
    if (report.documents.length) {
      new Setting(this.containerEl)
        .setName("重试全部未索引文档")
        .setDesc("只重新扫描并索引以上文档；不会全量重建。")
        .addButton((button) => button
          .setButtonText(report.retrying ? "正在重试…" : "重试所有未索引文档")
          .setDisabled(report.retrying)
          .onClick(async () => {
            button.setDisabled(true);
            await this.plugin.retrySkippedDocuments();
            this.display();
          }));
    }
  }

  private embeddingPage(): void {
    this.heading("Embedding 服务", "embedding");
    this.text("Ollama endpoint", "本地 /api/embed URL", "endpoint");
    this.text("模型名称", "qwen3-embedding:0.6b", "model");
    this.number("Embedding dimensions", "默认 1024；改变后必须重建", "dimensions", 32);
    this.text("keep_alive", "5m", "keepAlive");
    this.heading("查询指令", "queryInstruction");
    this.queryInstruction();
  }

  private appearancePage(): void {
    this.heading("结果正文", "appearance");
    new Setting(this.containerEl)
      .setName("正文字号")
      .setDesc("只影响侧边栏结果正文，不影响标题和 Obsidian 全局字体")
      .addDropdown((dropdown) => dropdown
        .addOption("0.88", "紧凑（88%）")
        .addOption("0.92", "默认（92%）")
        .addOption("1", "标准（100%）")
        .addOption("1.08", "较大（108%）")
        .setValue(String(this.plugin.settings.resultExcerptFontScale))
        .onChange(async (value) => this.persistSetting("resultExcerptFontScale", Number(value))));
    new Setting(this.containerEl)
      .setName("正文行高")
      .setDesc("较小行高更紧凑，较大行高更便于连续阅读")
      .addDropdown((dropdown) => dropdown
        .addOption("1.4", "紧凑（1.40）")
        .addOption("1.48", "默认（1.48）")
        .addOption("1.6", "舒展（1.60）")
        .setValue(String(this.plugin.settings.resultExcerptLineHeight))
        .onChange(async (value) => this.persistSetting("resultExcerptLineHeight", Number(value))));
    new Setting(this.containerEl)
      .setName("默认显示行数")
      .setDesc("超过时可在单张卡片中选择显示全文")
      .addDropdown((dropdown) => dropdown
        .addOption("6", "6 行")
        .addOption("10", "10 行")
        .addOption("15", "15 行")
        .addOption("0", "不限制")
        .setValue(String(this.plugin.settings.resultExcerptMaxLines))
        .onChange(async (value) => this.persistSetting("resultExcerptMaxLines", Number(value))));
  }

  private retrievalPage(): void {
    this.heading("查询", "query");
    this.number("查询 debounce (ms)", "停止输入多久后查询", "queryDebounceMs", 100);
    this.number("查询最大长度", "局部上下文最大字符数", "queryMaxLength", 64);
    this.heading("检索结果", "retrieval");
    this.number("Top K", "返回结果数", "topK", 1);
    this.number("每文件最大结果数", "默认最多两个片段", "maxPerFile", 1);
    this.heading("自动展开", "expansion");
    this.expansionSettings();
  }

  private heading(name: string, resetSection?: SettingsResetSection): void {
    const setting = new Setting(this.containerEl).setName(name).setHeading();
    if (resetSection) {
      setting.addExtraButton((button) => {
        button
          .setIcon("rotate-ccw")
          .setTooltip(`恢复“${name}”默认设置`)
          .setDisabled(this.resettingSections.has(resetSection))
          .onClick(() => void this.restoreDefaultSection(resetSection));
        this.resetControlEls.set(resetSection, button.extraSettingsEl);
        this.refreshResetControl(resetSection);
      });
    }
  }

  /** Changes only the section icon, so text inputs keep focus while the user types. */
  private refreshResetControl(section: SettingsResetSection): void {
    const control = this.resetControlEls.get(section);
    if (!control) return;
    control.style.display = settingsSectionDiffersFromDefaults(this.plugin.settings, DEFAULT_SETTINGS, section) ? "" : "none";
  }

  private indexScopeSettings(): void {
    this.heading("索引范围", "scope");
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
        .setDisabled(this.scopeSaving || this.resettingSections.has("scope"))
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
      .setDisabled(this.scopeSaving || this.resettingSections.has("scope"))
      .onClick(() => void this.saveExcludedDirectories(
        this.plugin.settings.excludedDirectories.filter((excluded) => excluded !== directory)
      )));
  }

  private openDirectoryPicker(): void {
    if (this.scopeSaving || this.resettingSections.has("scope")) return;
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

  private async restoreDefaultSection(section: SettingsResetSection): Promise<void> {
    if (this.resettingSections.has(section)) return;
    const previous = this.plugin.settings;
    this.resettingSections.add(section);
    this.plugin.settings = resetSettingsSection(previous, DEFAULT_SETTINGS, section);
    this.display();
    try {
      await this.plugin.saveSettings();
      this.plugin.onSettingsChanged();
    } catch (error) {
      this.plugin.settings = previous;
      new Notice(`恢复默认设置失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.resettingSections.delete(section);
      this.display();
    }
  }

  private fullIndexBuildSetting(): void {
    const build = this.plugin.getFullIndexBuildUi();
    new Setting(this.containerEl)
      .setName("全量索引")
      .setDesc(build.description)
      .addButton((button) => button
        .setButtonText(build.buttonLabel)
        .setDisabled(this.fullBuildRequesting)
        .onClick(async () => {
          if (this.fullBuildRequesting) return;
          this.fullBuildRequesting = true;
          button.setDisabled(true);
          try {
            await this.plugin.requestFullIndexBuild();
          } finally {
            this.fullBuildRequesting = false;
            this.display();
          }
        }));
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
    this.refreshResetControl(resetSectionForSetting(key));
    await this.plugin.saveSettings();
    this.plugin.onSettingsChanged();
  }
}

function skippedDocumentReason(reasonCode: string): string {
  if (reasonCode === "invalid-chunk-structure") return "片段结构无效，未发送给 Ollama。";
  return "无法建立索引。";
}
