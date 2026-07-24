import { App, PluginSettingTab, Setting } from "obsidian";
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
  excludedDirectories: string;
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
  excludedDirectories: ".obsidian",
  queryInstruction: "Given a Chinese note search query, retrieve relevant passages from a local Markdown knowledge base.",
  embeddingBatchSize: 16,
  autoExpandCount: 3,
  autoExpandThresholdEnabled: false,
  autoExpandThreshold: 0.3
};

export function excludedDirectoryList(value: string): string[] {
  return value.split(",").map((part) => part.trim().replace(/^\/+|\/+$/g, "")).filter(Boolean);
}

export class SideGrepSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: SideGrepPlugin) { super(app, plugin); }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Palimpsest 设置" });
    containerEl.createEl("p", { text: "修改模型、维度或切分长度后，现有索引会标记为需重建，避免混用向量。" });
    this.text("Ollama endpoint", "本地 /api/embed URL", "endpoint");
    this.text("模型名称", "qwen3-embedding:0.6b", "model");
    this.number("Embedding dimensions", "默认 1024；改变后必须重建", "dimensions", 32);
    this.text("keep_alive", "5m", "keepAlive");
    this.number("查询 debounce (ms)", "停止输入多久后查询", "queryDebounceMs", 100);
    this.number("查询最大长度", "局部上下文最大字符数", "queryMaxLength", 64);
    this.number("片段目标长度", "推荐 500–700 字符", "chunkTargetLength", 1);
    this.number("片段最大长度", "推荐 1000–1200 字符", "chunkMaxLength", 1);
    this.number("片段最小有效长度", "短而有意义的笔记仍可索引", "chunkMinLength", 1);
    this.number("Top K", "返回结果数", "topK", 1);
    this.number("每文件最大结果数", "默认最多两个片段", "maxPerFile", 1);
    this.expansionSettings();
    this.number("建库批量大小", "每次 Ollama 文档 embedding 数", "embeddingBatchSize", 1);
    this.text("排除目录", "逗号分隔，例如 .obsidian, templates", "excludedDirectories");
    this.text("Query instruction", "会添加在 Query: 前", "queryInstruction");
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
    new Setting(this.containerEl).setName(label).setDesc(description).addText((text) => text
      .setValue(String(this.plugin.settings[key]))
      .onChange(async (value) => this.persistSetting(key, value)));
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

  private async persistSetting(key: keyof SideGrepSettings, value: string | number | boolean): Promise<void> {
    (this.plugin.settings as unknown as Record<string, string | number | boolean>)[key] = value;
    await this.plugin.saveSettings();
    this.plugin.onSettingsChanged();
  }
}
