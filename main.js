"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => SideGrepPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian3 = require("obsidian");

// src/types.ts
var CHUNKER_VERSION = "1";

// src/chunker.ts
function stableHash(value) {
  let a = 2166136261;
  let b = 2654435769;
  for (let i = 0; i < value.length; i++) {
    a = Math.imul(a ^ value.charCodeAt(i), 16777619);
    b = Math.imul(b ^ value.charCodeAt(i), 2246822507);
  }
  return `${(a >>> 0).toString(16).padStart(8, "0")}${(b >>> 0).toString(16).padStart(8, "0")}`;
}
function embeddingText(chunk) {
  const heading = chunk.breadcrumb.length ? chunk.breadcrumb.join(" > ") : "\uFF08\u65E0\u6807\u9898\uFF09";
  return `\u6587\u4EF6\u540D\uFF1A${chunk.fileName}
\u6807\u9898\uFF1A${heading}
\u539F\u6587\uFF1A
${chunk.text}`;
}
function withoutFrontmatter(lines) {
  if (lines[0]?.trim() !== "---") return lines.map((line, i) => ({ line, number: i + 1 }));
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---" || lines[i].trim() === "...") {
      return lines.slice(i + 1).map((line, index) => ({ line, number: i + index + 2 }));
    }
  }
  return lines.map((line, i) => ({ line, number: i + 1 }));
}
function splitLongParagraph(paragraph, maxLength) {
  if (paragraph.text.length <= maxLength) return [paragraph];
  const pieces = paragraph.text.match(/[^。！？!?\n]+[。！？!?]?|\S+/g) ?? [paragraph.text];
  const result = [];
  let text = "";
  for (const rawPiece of pieces) {
    let piece = rawPiece;
    if (text && text.length + piece.length > maxLength) {
      result.push({ ...paragraph, text });
      text = "";
    }
    while (piece.length > maxLength && !text) {
      result.push({ ...paragraph, text: piece.slice(0, maxLength) });
      piece = piece.slice(maxLength);
    }
    text += piece;
  }
  if (text) result.push({ ...paragraph, text });
  return result;
}
function chunkMarkdown(filePath, markdown, options) {
  if (options.minLength < 1 || options.targetLength < options.minLength || options.maxLength < options.targetLength) {
    throw new Error("Invalid chunk length settings");
  }
  const filename = filePath.split("/").pop()?.replace(/\.md$/i, "") ?? filePath;
  const source = withoutFrontmatter(markdown.replace(/\r\n/g, "\n").split("\n"));
  const headings = [];
  const paragraphs = [];
  let buffer = [];
  const flush = () => {
    const text = buffer.map((item) => item.line).join("\n").trim();
    if (text) paragraphs.push({ text, startLine: buffer[0].number, endLine: buffer.at(-1).number, breadcrumb: [...headings] });
    buffer = [];
  };
  for (const item of source) {
    const match = item.line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (match) {
      flush();
      const depth = match[1].length;
      headings.length = depth - 1;
      headings[depth - 1] = match[2].trim();
      continue;
    }
    if (!item.line.trim()) flush();
    else buffer.push(item);
  }
  flush();
  const expanded = paragraphs.flatMap((paragraph) => splitLongParagraph(paragraph, options.maxLength));
  const groups = [];
  let current = [];
  let currentLength = 0;
  const sameHeading = (a, b) => a.breadcrumb.join("\0") === b.breadcrumb.join("\0");
  for (const paragraph of expanded) {
    const separator = current.length ? 2 : 0;
    if (current.length && (!sameHeading(current[0], paragraph) || currentLength + separator + paragraph.text.length > options.maxLength || currentLength >= options.targetLength)) {
      groups.push(current);
      current = [];
      currentLength = 0;
    }
    current.push(paragraph);
    currentLength += separator + paragraph.text.length;
  }
  if (current.length) groups.push(current);
  for (let i = groups.length - 1; i > 0; i--) {
    const group = groups[i];
    const previous = groups[i - 1];
    const length = group.map((p) => p.text).join("\n\n").length;
    const combined = previous.concat(group).map((p) => p.text).join("\n\n").length;
    if (length < options.minLength && sameHeading(previous[0], group[0]) && combined <= options.maxLength) {
      previous.push(...group);
      groups.splice(i, 1);
    }
  }
  return groups.map((group) => {
    const text = group.map((paragraph) => paragraph.text).join("\n\n");
    const first = group[0];
    const last = group.at(-1);
    const contentHash = stableHash(text);
    return {
      id: stableHash(`${CHUNKER_VERSION}
${filePath}
${first.breadcrumb.join(" > ")}
${contentHash}`),
      contentHash,
      filePath,
      fileName: filename,
      breadcrumb: first.breadcrumb,
      text,
      startLine: first.startLine,
      endLine: last.endLine
    };
  });
}

// src/build-cancellation.ts
var IndexBuildCancelled = class extends Error {
  constructor() {
    super("\u7D22\u5F15\u4EFB\u52A1\u5DF2\u53D6\u6D88");
  }
};
var BuildCancellationToken = class {
  cancelled = false;
  cancel() {
    this.cancelled = true;
  }
  get isCancelled() {
    return this.cancelled;
  }
};
var BuildCancellationController = class {
  currentBuild;
  unloaded = false;
  startBuild() {
    const token = new BuildCancellationToken();
    this.currentBuild = token;
    return token;
  }
  cancelCurrentBuild() {
    this.currentBuild?.cancel();
  }
  finishBuild(token) {
    if (this.currentBuild === token) this.currentBuild = void 0;
  }
  unload() {
    this.unloaded = true;
    this.cancelCurrentBuild();
  }
  isBuildCancelled(token) {
    return this.unloaded || token.isCancelled;
  }
  assertPluginActive() {
    if (this.unloaded) throw new IndexBuildCancelled();
  }
  assertBuildCanContinue(token) {
    if (this.isBuildCancelled(token)) throw new IndexBuildCancelled();
  }
  /** Pass a build token only for the full-build atomic commit. */
  assertCommitCanProceed(buildToken) {
    if (buildToken?.isCancelled) throw new IndexBuildCancelled();
    this.assertPluginActive();
  }
};

// src/embedding-provider.ts
var EmbeddingError = class extends Error {
  constructor(message, kind = "response") {
    super(message);
    this.kind = kind;
    this.name = "EmbeddingError";
  }
};
var OllamaEmbeddingProvider = class {
  constructor(options, post) {
    this.options = options;
    this.post = post;
    this.model = options.model;
    this.dimensions = options.dimensions;
  }
  model;
  dimensions;
  embedDocuments(inputs) {
    return this.embed(inputs, inputs);
  }
  embedQuery(query) {
    const input = `Instruct: ${this.options.queryInstruction}
Query:${query}`;
    return this.embed([input], [query]);
  }
  async embed(inputs, expectedInputs) {
    if (!inputs.length || inputs.some((input) => !input.trim())) {
      throw new EmbeddingError("Embedding input must contain at least one non-empty string", "validation");
    }
    let response;
    try {
      response = await this.post(this.options.endpoint, JSON.stringify({
        model: this.model,
        input: inputs,
        dimensions: this.dimensions,
        keep_alive: this.options.keepAlive
      }));
    } catch (error) {
      throw new EmbeddingError(`Cannot reach Ollama: ${error instanceof Error ? error.message : String(error)}`, "connection");
    }
    if (response.status < 200 || response.status >= 300) {
      throw new EmbeddingError(`Ollama returned HTTP ${response.status}: ${response.text.slice(0, 300)}`, "response");
    }
    let payload;
    try {
      payload = JSON.parse(response.text);
    } catch {
      throw new EmbeddingError("Ollama returned invalid JSON", "response");
    }
    if (!Array.isArray(payload.embeddings) || payload.embeddings.length !== expectedInputs.length) {
      throw new EmbeddingError(`Ollama returned ${Array.isArray(payload.embeddings) ? payload.embeddings.length : "no"} embeddings for ${expectedInputs.length} inputs`, "validation");
    }
    const vectors = payload.embeddings.map((vector, index) => {
      if (!Array.isArray(vector) || vector.length !== this.dimensions || vector.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
        throw new EmbeddingError(`Embedding ${index + 1} is not a finite ${this.dimensions}-dimensional vector`, "validation");
      }
      return vector;
    });
    return { vectors, coldLoad: typeof payload.load_duration === "number" && payload.load_duration >= 5e8 };
  }
};

// src/persistent-index.ts
function sameIdentity(left, right) {
  return left.model === right.model && left.dimensions === right.dimensions && left.chunkerVersion === right.chunkerVersion && left.chunkTargetLength === right.chunkTargetLength && left.chunkMaxLength === right.chunkMaxLength && left.chunkMinLength === right.chunkMinLength;
}
var PersistentIndex = class {
  data;
  constructor(identity, saved) {
    this.data = saved && Array.isArray(saved.chunks) ? { ...saved, schemaVersion: 2, initialized: saved.initialized ?? saved.updatedAt > 0 } : { schemaVersion: 2, identity, chunks: [], updatedAt: 0, initialized: false };
  }
  isCompatible(identity) {
    return sameIdentity(this.data.identity, identity);
  }
  get identity() {
    return this.data.identity;
  }
  get chunks() {
    return this.data.chunks;
  }
  get size() {
    return this.data.chunks.length;
  }
  lifecycle(identity) {
    if (!this.isCompatible(identity)) return "incompatible";
    return this.data.initialized ? "ready" : "uninitialized";
  }
  isReady(identity) {
    return this.lifecycle(identity) === "ready";
  }
  reusableById(identity) {
    if (!this.isCompatible(identity)) return /* @__PURE__ */ new Map();
    return new Map(this.data.chunks.map((chunk) => [chunk.id, chunk]));
  }
  replacement(identity, chunks) {
    const ids = /* @__PURE__ */ new Set();
    for (const chunk of chunks) {
      if (ids.has(chunk.id)) throw new Error(`Duplicate chunk ID: ${chunk.id}`);
      if (chunk.vector.length !== identity.dimensions) throw new Error(`Chunk ${chunk.id} vector does not match index dimensions`);
      ids.add(chunk.id);
    }
    return { schemaVersion: 2, identity, chunks, updatedAt: Date.now(), initialized: true };
  }
  commit(data) {
    this.data = { ...data, schemaVersion: 2, initialized: data.initialized ?? data.updatedAt > 0 };
  }
  replace(identity, chunks) {
    this.commit(this.replacement(identity, chunks));
  }
  serialize() {
    return this.data;
  }
};

// src/query-context.ts
function paragraphAround(lines, line) {
  let start = Math.max(0, Math.min(line, lines.length - 1));
  let end = start;
  const isBoundary = (value) => !value?.trim() || /^#{1,6}\s/.test(value);
  while (start > 0 && !isBoundary(lines[start - 1])) start--;
  while (end < lines.length - 1 && !isBoundary(lines[end + 1])) end++;
  return { text: lines.slice(start, end + 1).join("\n").trim(), start, end };
}
function activeHeading(lines, line) {
  const path = [];
  for (let index = 0; index <= Math.min(line, lines.length - 1); index++) {
    const match = lines[index].match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!match) continue;
    const depth = match[1].length;
    path.length = depth - 1;
    path[depth - 1] = match[2].trim();
  }
  return path.filter(Boolean).join(" > ") || void 0;
}
function buildQueryContext(markdown, cursorLine, maxLength) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const current = paragraphAround(lines, cursorLine);
  let previous;
  if (current.start > 0) {
    let candidate = current.start - 1;
    while (candidate >= 0 && (!lines[candidate].trim() || /^#{1,6}\s/.test(lines[candidate]))) candidate--;
    if (candidate >= 0) previous = paragraphAround(lines, candidate).text || void 0;
  }
  const heading = activeHeading(lines, cursorLine);
  const parts = [heading ? `\u6807\u9898\uFF1A${heading}` : "", previous ? `\u524D\u6587\uFF1A${previous}` : "", `\u5F53\u524D\u6BB5\u843D\uFF1A${current.text}`].filter(Boolean);
  let query = parts.join("\n");
  if (query.length > maxLength) {
    query = [heading ? `\u6807\u9898\uFF1A${heading}` : "", `\u5F53\u524D\u6BB5\u843D\uFF1A${current.text}`].filter(Boolean).join("\n");
    if (query.length > maxLength) query = query.slice(0, maxLength);
  }
  return { query, heading, currentParagraph: current.text, previousParagraph: previous };
}

// src/query-gate.ts
var QueryGate = class {
  generation = 0;
  begin() {
    return ++this.generation;
  }
  isCurrent(generation) {
    return generation === this.generation;
  }
  invalidate() {
    this.generation++;
  }
};

// src/query-lifecycle.ts
var QueryLifecycleCoordinator = class {
  constructor(indexAvailability) {
    this.indexAvailability = indexAvailability;
  }
  hasMarkdownContext = false;
  setIndexAvailability(availability) {
    this.indexAvailability = availability;
  }
  rememberMarkdownContext() {
    this.hasMarkdownContext = true;
  }
  noteMarkdownActivated() {
    this.rememberMarkdownContext();
    return this.schedule("file-open", true);
  }
  nonMarkdownLeafActivated() {
    return void 0;
  }
  editorChanged() {
    return this.schedule("typing", false);
  }
  sidebarOpened() {
    return this.schedule("sidebar-open", true);
  }
  indexReady() {
    this.indexAvailability = "ready";
    return this.schedule("index-ready", true);
  }
  layoutReady() {
    return this.schedule("layout-ready", true);
  }
  schedule(reason, immediate) {
    if (this.indexAvailability !== "ready" || !this.hasMarkdownContext) return void 0;
    return { immediate, reason };
  }
};

// src/retrieval.ts
function cosineSimilarity(left, right) {
  if (!left.length || left.length !== right.length) throw new Error("Cosine vectors must be non-empty and have equal dimensions");
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let i = 0; i < left.length; i++) {
    const a = left[i];
    const b = right[i];
    if (!Number.isFinite(a) || !Number.isFinite(b)) throw new Error("Cosine vectors must be finite");
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (!leftNorm || !rightNorm) return 0;
  return dot / Math.sqrt(leftNorm * rightNorm);
}
function rankChunks(query, candidates, options) {
  const scored = candidates.filter((chunk) => chunk.filePath !== options.excludePath).map((chunk) => ({ ...chunk, similarity: cosineSimilarity(query, chunk.vector) })).sort((a, b) => b.similarity - a.similarity);
  const results = [];
  const perFile = /* @__PURE__ */ new Map();
  const duplicateAt = options.duplicateSimilarity ?? 0.995;
  for (const candidate of scored) {
    if ((perFile.get(candidate.filePath) ?? 0) >= options.maxPerFile) continue;
    const normalized = candidate.text.replace(/\s+/g, " ").trim();
    const duplicate = results.some((result) => result.text.replace(/\s+/g, " ").trim() === normalized || result.filePath === candidate.filePath && cosineSimilarity(result.vector, candidate.vector) >= duplicateAt);
    if (duplicate) continue;
    results.push(candidate);
    perFile.set(candidate.filePath, (perFile.get(candidate.filePath) ?? 0) + 1);
    if (results.length >= options.topK) break;
  }
  return results;
}

// src/settings.ts
var import_obsidian = require("obsidian");
var DEFAULT_SETTINGS = {
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
function excludedDirectoryList(value) {
  return value.split(",").map((part) => part.trim().replace(/^\/+|\/+$/g, "")).filter(Boolean);
}
var SideGrepSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Side Grep \u8BBE\u7F6E" });
    containerEl.createEl("p", { text: "\u4FEE\u6539\u6A21\u578B\u3001\u7EF4\u5EA6\u6216\u5207\u5206\u957F\u5EA6\u540E\uFF0C\u73B0\u6709\u7D22\u5F15\u4F1A\u6807\u8BB0\u4E3A\u9700\u91CD\u5EFA\uFF0C\u907F\u514D\u6DF7\u7528\u5411\u91CF\u3002" });
    this.text("Ollama endpoint", "\u672C\u5730 /api/embed URL", "endpoint");
    this.text("\u6A21\u578B\u540D\u79F0", "qwen3-embedding:0.6b", "model");
    this.number("Embedding dimensions", "\u9ED8\u8BA4 1024\uFF1B\u6539\u53D8\u540E\u5FC5\u987B\u91CD\u5EFA", "dimensions", 32);
    this.text("keep_alive", "5m", "keepAlive");
    this.number("\u67E5\u8BE2 debounce (ms)", "\u505C\u6B62\u8F93\u5165\u591A\u4E45\u540E\u67E5\u8BE2", "queryDebounceMs", 100);
    this.number("\u67E5\u8BE2\u6700\u5927\u957F\u5EA6", "\u5C40\u90E8\u4E0A\u4E0B\u6587\u6700\u5927\u5B57\u7B26\u6570", "queryMaxLength", 64);
    this.number("\u7247\u6BB5\u76EE\u6807\u957F\u5EA6", "\u63A8\u8350 500\u2013700 \u5B57\u7B26", "chunkTargetLength", 1);
    this.number("\u7247\u6BB5\u6700\u5927\u957F\u5EA6", "\u63A8\u8350 1000\u20131200 \u5B57\u7B26", "chunkMaxLength", 1);
    this.number("\u7247\u6BB5\u6700\u5C0F\u6709\u6548\u957F\u5EA6", "\u77ED\u800C\u6709\u610F\u4E49\u7684\u7B14\u8BB0\u4ECD\u53EF\u7D22\u5F15", "chunkMinLength", 1);
    this.number("Top K", "\u8FD4\u56DE\u7ED3\u679C\u6570", "topK", 1);
    this.number("\u6BCF\u6587\u4EF6\u6700\u5927\u7ED3\u679C\u6570", "\u9ED8\u8BA4\u6700\u591A\u4E24\u4E2A\u7247\u6BB5", "maxPerFile", 1);
    this.expansionSettings();
    this.number("\u5EFA\u5E93\u6279\u91CF\u5927\u5C0F", "\u6BCF\u6B21 Ollama \u6587\u6863 embedding \u6570", "embeddingBatchSize", 1);
    this.text("\u6392\u9664\u76EE\u5F55", "\u9017\u53F7\u5206\u9694\uFF0C\u4F8B\u5982 .obsidian, templates", "excludedDirectories");
    this.text("Query instruction", "\u4F1A\u6DFB\u52A0\u5728 Query: \u524D", "queryInstruction");
  }
  expansionSettings() {
    new import_obsidian.Setting(this.containerEl).setName("\u9ED8\u8BA4\u5C55\u5F00\u7ED3\u679C").setDesc("\u7528\u6237\u624B\u52A8\u5C55\u5F00\u6216\u6298\u53E0\u540E\uFF0C\u5C06\u4F18\u5148\u4FDD\u7559\u7528\u6237\u9009\u62E9").addDropdown((dropdown) => dropdown.addOption("0", "\u5168\u90E8\u6298\u53E0").addOption("1", "\u524D 1 \u4E2A").addOption("3", "\u524D 3 \u4E2A").addOption("5", "\u524D 5 \u4E2A").addOption("-1", "\u5168\u90E8\u5C55\u5F00").setValue(String(this.plugin.settings.autoExpandCount)).onChange(async (value) => this.persistSetting("autoExpandCount", Number(value))));
    new import_obsidian.Setting(this.containerEl).setName("\u4F7F\u7528\u81EA\u52A8\u5C55\u5F00\u76F8\u4F3C\u5EA6\u9608\u503C").setDesc("\u5F00\u542F\u540E\uFF0C\u4F4E\u4E8E\u9608\u503C\u7684\u7ED3\u679C\u4E0D\u4F1A\u81EA\u52A8\u5C55\u5F00").addToggle((toggle) => toggle.setValue(this.plugin.settings.autoExpandThresholdEnabled).onChange(async (value) => this.persistSetting("autoExpandThresholdEnabled", value)));
    new import_obsidian.Setting(this.containerEl).setName("\u81EA\u52A8\u5C55\u5F00\u6700\u4F4E\u76F8\u4F3C\u5EA6").setDesc("\u8303\u56F4 0\u20131\uFF1B\u4EC5\u5728\u542F\u7528\u9608\u503C\u65F6\u751F\u6548").addText((text) => text.setValue(String(this.plugin.settings.autoExpandThreshold)).onChange(async (value) => {
      const number = Number(value);
      if (Number.isFinite(number) && number >= 0 && number <= 1) await this.persistSetting("autoExpandThreshold", number);
    }));
  }
  text(label, description, key) {
    new import_obsidian.Setting(this.containerEl).setName(label).setDesc(description).addText((text) => text.setValue(String(this.plugin.settings[key])).onChange(async (value) => this.persistSetting(key, value)));
  }
  number(label, description, key, min) {
    new import_obsidian.Setting(this.containerEl).setName(label).setDesc(description).addText((text) => text.setValue(String(this.plugin.settings[key])).setPlaceholder(String(min)).onChange(async (value) => {
      const number = Number(value);
      if (Number.isFinite(number) && number >= min) await this.persistSetting(key, number);
    }));
  }
  async persistSetting(key, value) {
    this.plugin.settings[key] = value;
    await this.plugin.saveSettings();
    this.plugin.onSettingsChanged();
  }
};

// src/sidebar-view.ts
var import_obsidian2 = require("obsidian");

// src/expansion-policy.ts
function shouldAutoExpand(index, similarity, policy) {
  const withinCount = policy.count < 0 || index < policy.count;
  const aboveThreshold = !policy.thresholdEnabled || similarity >= policy.threshold;
  return withinCount && aboveThreshold;
}

// src/result-presentation.ts
function hasMaterialResultChange(previous, next) {
  if (previous.length !== next.length) return true;
  return previous.some((result, index) => {
    const candidate = next[index];
    return !candidate || result.id !== candidate.id || result.contentHash !== candidate.contentHash || result.fileName !== candidate.fileName || result.text !== candidate.text || result.breadcrumb.join("\0") !== candidate.breadcrumb.join("\0");
  });
}

// src/sidebar-view.ts
var SIDE_GREP_VIEW_TYPE = "obsdn-side-grep-sidebar";
var SideGrepView = class extends import_obsidian2.ItemView {
  constructor(leaf, actions) {
    super(leaf);
    this.actions = actions;
  }
  state = { kind: "waiting-input", message: "\u7B49\u5F85\u8F93\u5165" };
  results = [];
  shellReady = false;
  statusIcon;
  refreshButton;
  indexButton;
  indexPanel;
  emptyState;
  resultsEl;
  cards = /* @__PURE__ */ new Map();
  resultAnimation;
  expansionPolicyKey = "";
  getViewType() {
    return SIDE_GREP_VIEW_TYPE;
  }
  getDisplayText() {
    return "Side Grep";
  }
  getIcon() {
    return "search";
  }
  showResults(state, results = this.results) {
    this.state = state;
    this.ensureShell();
    this.updateToolbar();
    this.updateIndexPanel();
    const policyKey = JSON.stringify(this.actions.expansionPolicy());
    if (policyKey !== this.expansionPolicyKey) {
      this.expansionPolicyKey = policyKey;
      for (const card of this.cards.values()) card.manualExpansion = void 0;
    }
    const shouldSoften = hasMaterialResultChange(this.results, results);
    this.reconcileResults([...results]);
    if (shouldSoften) this.animateResultRefresh();
    this.updateEmptyState();
  }
  async onOpen() {
    this.ensureShell();
    this.updateToolbar();
    this.updateIndexPanel();
    this.reconcileResults(this.results);
    this.updateEmptyState();
    this.actions.sidebarOpened();
  }
  async onClose() {
    this.resultAnimation?.cancel();
    this.shellReady = false;
    this.cards.clear();
  }
  ensureShell() {
    if (this.shellReady && this.resultsEl?.isConnected) return;
    const root = this.contentEl;
    root.empty();
    root.addClass("obsdn-side-grep");
    const toolbar = root.createDiv({ cls: "obsdn-side-grep-toolbar" });
    toolbar.createEl("h4", { text: "Side Grep", cls: "obsdn-side-grep-title" });
    toolbar.createDiv({ cls: "obsdn-side-grep-toolbar-spacer" });
    this.statusIcon = toolbar.createDiv({ cls: "obsdn-side-grep-status-icon" });
    this.refreshButton = toolbar.createEl("button", {
      cls: "clickable-icon obsdn-side-grep-toolbar-button",
      attr: { "aria-label": "\u5237\u65B0\u76F8\u5173\u7247\u6BB5", title: "\u5237\u65B0\u76F8\u5173\u7247\u6BB5" }
    });
    (0, import_obsidian2.setIcon)(this.refreshButton, "refresh-cw");
    this.refreshButton.addEventListener("click", () => this.actions.refreshCurrentQuery());
    this.indexButton = toolbar.createEl("button", {
      cls: "clickable-icon obsdn-side-grep-toolbar-button",
      attr: { "aria-label": "\u91CD\u5EFA\u7D22\u5F15", title: "\u91CD\u5EFA\u7D22\u5F15" }
    });
    (0, import_obsidian2.setIcon)(this.indexButton, "database");
    this.indexButton.addEventListener("click", () => void this.actions.rebuildIndex());
    this.indexPanel = root.createDiv({ cls: "obsdn-side-grep-index-panel" });
    this.emptyState = root.createDiv({ cls: "obsdn-side-grep-empty-state" });
    this.resultsEl = root.createDiv({ cls: "obsdn-side-grep-results" });
    this.shellReady = true;
  }
  updateToolbar() {
    this.statusIcon.removeClass("is-visible", "is-spinning", "is-error");
    this.statusIcon.empty();
    const tooltip = this.state.latencyMs === void 0 ? this.state.message : `${this.state.message} \xB7 \u6700\u8FD1\u4E00\u6B21\u67E5\u8BE2 ${this.state.latencyMs.toFixed(0)} ms`;
    this.statusIcon.setAttribute("title", tooltip);
    this.statusIcon.setAttribute("aria-label", tooltip);
    if (this.state.kind === "querying" || this.state.kind === "loading-model" || this.state.kind === "indexing") {
      (0, import_obsidian2.setIcon)(this.statusIcon, "loader-circle");
      this.statusIcon.addClass("is-visible", "is-spinning");
    } else if (this.state.kind === "ollama-unavailable" || this.state.kind === "query-failed" || this.state.kind === "index-failed") {
      (0, import_obsidian2.setIcon)(this.statusIcon, "triangle-alert");
      this.statusIcon.addClass("is-visible", "is-error");
    }
    const indexActionVisible = Boolean(this.state.indexAction) || this.state.kind === "indexing";
    this.refreshButton.style.display = indexActionVisible ? "none" : "";
    this.indexButton.style.display = indexActionVisible ? "none" : "";
    this.refreshButton.disabled = this.state.kind === "indexing";
    this.indexButton.disabled = this.state.kind === "indexing";
  }
  updateIndexPanel() {
    this.indexPanel.empty();
    const shouldShow = this.state.kind === "indexing" || Boolean(this.state.indexAction);
    this.indexPanel.style.display = shouldShow ? "" : "none";
    if (!shouldShow) return;
    this.indexPanel.createDiv({ cls: "obsdn-side-grep-index-message", text: this.state.message });
    if (this.state.detail) this.indexPanel.createDiv({ cls: "obsdn-side-grep-status-detail", text: this.state.detail });
    if (this.state.kind === "indexing") {
      const progress = this.state.progress;
      if (progress) {
        const progressEl = this.indexPanel.createEl("progress", { cls: "obsdn-side-grep-progress" });
        if (progress.phase !== "saving" && progress.total > 0) {
          progressEl.max = progress.total;
          progressEl.value = Math.min(progress.current, progress.total);
        } else {
          progressEl.removeAttribute("value");
        }
        const detail = progress.phase === "saving" ? "\u6B63\u5728\u4FDD\u5B58\u7D22\u5F15\u2026\u2026" : `${progress.current} / ${progress.total} \u4E2A${progress.phase === "scanning" ? "\u6587\u4EF6" : "\u7247\u6BB5"}`;
        this.indexPanel.createDiv({ cls: "obsdn-side-grep-progress-detail", text: detail });
      }
      const cancel = this.indexPanel.createEl("button", { text: "\u53D6\u6D88", cls: "obsdn-side-grep-index-action" });
      cancel.addEventListener("click", () => this.actions.cancelIndex());
      return;
    }
    const label = this.state.indexAction === "build" ? "\u5EFA\u7ACB\u7D22\u5F15" : this.state.indexAction === "retry" ? "\u91CD\u8BD5" : "\u91CD\u5EFA\u7D22\u5F15";
    const action = this.indexPanel.createEl("button", { text: label, cls: "obsdn-side-grep-index-action" });
    action.addEventListener("click", () => void this.actions.rebuildIndex());
  }
  updateEmptyState() {
    const indexPanelVisible = this.indexPanel.style.display !== "none";
    if (this.results.length || indexPanelVisible) {
      this.emptyState.style.display = "none";
      return;
    }
    this.emptyState.style.display = "";
    this.emptyState.setText(this.state.kind === "complete" ? "\u6CA1\u6709\u627E\u5230\u76F8\u5173\u7247\u6BB5" : this.state.message);
  }
  reconcileResults(nextResults) {
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
  createResultCard(result, index) {
    const root = document.createElement("details");
    root.className = "obsdn-side-grep-result";
    const summary = root.createEl("summary");
    const score = summary.createSpan({ cls: "obsdn-side-grep-score", attr: { title: "\u4F59\u5F26\u76F8\u4F3C\u5EA6\uFF0C\u4E0D\u662F\u51C6\u786E\u7387" } });
    const file = summary.createEl("a", {
      cls: "obsdn-side-grep-file",
      attr: { href: "#", "aria-label": "\u6253\u5F00\u6765\u6E90\uFF1B\u62D6\u52A8\u53EF\u63D2\u5165\u94FE\u63A5", title: "\u6253\u5F00\u6765\u6E90\uFF1B\u62D6\u52A8\u53EF\u63D2\u5165\u94FE\u63A5", draggable: "true" }
    });
    const breadcrumb = root.createDiv({ cls: "obsdn-side-grep-breadcrumb" });
    const excerpt = root.createDiv({ cls: "obsdn-side-grep-excerpt-wrap" });
    const quote = excerpt.createDiv({ cls: "obsdn-side-grep-excerpt markdown-rendered" });
    const quoteAction = excerpt.createEl("button", {
      cls: "clickable-icon obsdn-side-grep-card-action obsdn-side-grep-quote-action",
      attr: { "aria-label": "\u5F15\u7528\u7247\u6BB5\uFF1B\u62D6\u52A8\u53EF\u63D2\u5165\u5F15\u7528", title: "\u5F15\u7528\u7247\u6BB5\uFF1B\u62D6\u52A8\u53EF\u63D2\u5165\u5F15\u7528", draggable: "true" }
    });
    (0, import_obsidian2.setIcon)(quoteAction, "quote");
    const card = { root, file, score, breadcrumb, quote, result, ignoreNextToggle: false };
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
  updateResultCard(card, result, index) {
    card.result = result;
    if (card.file.textContent !== result.fileName) card.file.setText(result.fileName);
    const score = result.similarity.toFixed(2);
    if (card.score.textContent !== score) card.score.setText(score);
    const breadcrumb = result.breadcrumb.join(" \u203A ");
    if (card.breadcrumb.textContent !== breadcrumb) card.breadcrumb.setText(breadcrumb);
    card.breadcrumb.setAttribute("title", breadcrumb);
    card.breadcrumb.style.display = breadcrumb ? "" : "none";
    if (card.renderedHash !== result.contentHash) {
      card.renderedHash = result.contentHash;
      card.quote.empty();
      void import_obsidian2.MarkdownRenderer.render(this.app, result.text, card.quote, result.filePath, this).catch(() => card.quote.setText(result.text));
    }
    const autoOpen = shouldAutoExpand(index, result.similarity, this.actions.expansionPolicy());
    const desiredOpen = card.manualExpansion ?? autoOpen;
    if (card.root.open !== desiredOpen) {
      card.ignoreNextToggle = true;
      card.root.open = desiredOpen;
    }
  }
  animateResultRefresh() {
    this.resultAnimation?.cancel();
    this.resultAnimation = this.resultsEl.animate(
      [{ opacity: 0.72 }, { opacity: 1 }],
      { duration: 140, easing: "ease-out" }
    );
  }
  selectedExcerpt(quote) {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return void 0;
    const range = selection.getRangeAt(0);
    const container = range.commonAncestorContainer.nodeType === Node.TEXT_NODE ? range.commonAncestorContainer.parentElement : range.commonAncestorContainer;
    return container && quote.contains(container) ? selection.toString().trim() || void 0 : void 0;
  }
  setDragPayload(event, markdown) {
    if (!event.dataTransfer) return;
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("text/plain", markdown);
    event.dataTransfer.setData("text/markdown", markdown);
  }
};

// src/main.ts
var SideGrepPlugin = class extends import_obsidian3.Plugin {
  settings = { ...DEFAULT_SETTINGS };
  index;
  queryTimer;
  modelTimer;
  updateTimer;
  pendingChangedPaths = /* @__PURE__ */ new Set();
  queryGate = new QueryGate();
  lifecycle = new QueryLifecycleCoordinator("uninitialized");
  latestMarkdownView;
  lastActivatedMarkdownPath;
  state = { kind: "waiting-input", message: "\u7B49\u5F85\u8F93\u5165" };
  results = [];
  indexing = false;
  buildCancellation = new BuildCancellationController();
  async onload() {
    const saved = await this.loadData() ?? {};
    this.settings = { ...DEFAULT_SETTINGS, ...saved.settings };
    this.index = new PersistentIndex(this.indexIdentity(), saved.index);
    this.syncQueryAvailability();
    this.registerView(SIDE_GREP_VIEW_TYPE, (leaf) => new SideGrepView(leaf, this));
    this.addSettingTab(new SideGrepSettingTab(this.app, this));
    this.addCommand({ id: "open-sidebar", name: "\u6253\u5F00 Side Grep \u4FA7\u8FB9\u680F", callback: () => void this.activateView() });
    this.addCommand({ id: "rebuild-index", name: "\u5EFA\u7ACB/\u91CD\u5EFA\u77E5\u8BC6\u7247\u6BB5\u7D22\u5F15", callback: () => void this.rebuildIndex() });
    this.registerEvent(this.app.workspace.on("editor-change", (editor, view) => this.onEditorChange(editor, view)));
    this.registerEvent(this.app.workspace.on("file-open", (file) => this.onFileOpen(file)));
    this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf) => this.onActiveLeafChange(leaf)));
    this.registerEvent(this.app.vault.on("create", (file) => this.scheduleFileUpdate(file)));
    this.registerEvent(this.app.vault.on("modify", (file) => this.scheduleFileUpdate(file)));
    this.registerEvent(this.app.vault.on("delete", (file) => this.scheduleFileUpdate(file)));
    this.showIndexRequirement();
    this.app.workspace.onLayoutReady(() => {
      const view = this.app.workspace.getActiveViewOfType(import_obsidian3.MarkdownView);
      if (view) {
        this.latestMarkdownView = view;
        this.lifecycle.rememberMarkdownContext();
      }
      const schedule = this.lifecycle.layoutReady();
      if (schedule) this.scheduleQueryFromCurrentEditor(schedule);
    });
  }
  onunload() {
    this.buildCancellation.unload();
    this.clearQueryTimers();
    this.queryGate.invalidate();
  }
  async saveSettings() {
    await this.saveData({ settings: this.settings, index: this.index.serialize() });
  }
  onSettingsChanged() {
    this.queryGate.invalidate();
    this.syncQueryAvailability();
    if (!this.indexing) this.showIndexRequirement("\u5F71\u54CD embedding \u7684\u914D\u7F6E\u5DF2\u6539\u53D8\uFF0C\u8BF7\u91CD\u5EFA\u7D22\u5F15");
    this.present(this.state, this.results);
  }
  indexIdentity() {
    return {
      model: this.settings.model,
      dimensions: this.settings.dimensions,
      chunkerVersion: CHUNKER_VERSION,
      chunkTargetLength: this.settings.chunkTargetLength,
      chunkMaxLength: this.settings.chunkMaxLength,
      chunkMinLength: this.settings.chunkMinLength
    };
  }
  syncQueryAvailability() {
    const lifecycle = this.index.lifecycle(this.indexIdentity());
    this.lifecycle.setIndexAvailability(lifecycle === "ready" ? "ready" : lifecycle === "incompatible" ? "incompatible" : "uninitialized");
  }
  provider() {
    return new OllamaEmbeddingProvider({
      endpoint: this.settings.endpoint,
      model: this.settings.model,
      dimensions: this.settings.dimensions,
      keepAlive: this.settings.keepAlive,
      queryInstruction: this.settings.queryInstruction
    }, async (url, body) => {
      const response = await (0, import_obsidian3.requestUrl)({ url, method: "POST", contentType: "application/json", body, throw: false });
      return { status: response.status, text: response.text };
    });
  }
  onEditorChange(editor, view) {
    if (!(view instanceof import_obsidian3.MarkdownView)) return;
    this.latestMarkdownView = view;
    this.lifecycle.rememberMarkdownContext();
    const schedule = this.lifecycle.editorChanged();
    if (schedule) this.scheduleQueryFromCurrentEditor(schedule, editor, view);
  }
  onFileOpen(file) {
    if (!(file instanceof import_obsidian3.TFile) || file.extension !== "md") return;
    const view = this.app.workspace.getActiveViewOfType(import_obsidian3.MarkdownView);
    if (view?.file?.path === file.path) this.noteMarkdownActivated(view);
  }
  onActiveLeafChange(leaf) {
    if (leaf?.view instanceof import_obsidian3.MarkdownView) this.noteMarkdownActivated(leaf.view);
    else this.lifecycle.nonMarkdownLeafActivated();
  }
  noteMarkdownActivated(view) {
    const path = view.file?.path;
    this.latestMarkdownView = view;
    if (path && path === this.lastActivatedMarkdownPath) return;
    this.lastActivatedMarkdownPath = path;
    const schedule = this.lifecycle.noteMarkdownActivated();
    if (schedule) this.scheduleQueryFromCurrentEditor(schedule, view.editor, view);
  }
  /** The one production entry point for typing, file, sidebar, and index-ready queries. */
  scheduleQueryFromCurrentEditor(schedule, suppliedEditor, suppliedView) {
    this.clearQueryTimers();
    const generation = this.queryGate.begin();
    const view = suppliedView ?? this.latestMarkdownView;
    const editor = suppliedEditor ?? view?.editor;
    if (!view || !editor) return;
    const buffer = editor.getValue();
    if (this.indexing) return;
    if (!this.index.isReady(this.indexIdentity())) {
      this.showIndexRequirement();
      return;
    }
    if (!buffer.trim()) {
      this.present({ kind: "waiting-input", message: "\u7B49\u5F85\u8F93\u5165" }, []);
      return;
    }
    if (!schedule.immediate) {
      this.present({ kind: "waiting-debounce", message: "\u7B49\u5F85\u505C\u7B14\u2026" }, this.results);
      this.queryTimer = window.setTimeout(() => void this.runQuery(generation, editor, view, view.file?.path, buffer), this.settings.queryDebounceMs);
      return;
    }
    void this.runQuery(generation, editor, view, view.file?.path, buffer);
  }
  async runQuery(generation, editor, view, filePath, scheduledBuffer) {
    if (!this.queryGate.isCurrent(generation) || editor.getValue() !== scheduledBuffer || this.latestMarkdownView !== view) return;
    if (this.indexing) return;
    if (!this.index.isReady(this.indexIdentity())) {
      this.showIndexRequirement();
      return;
    }
    const context = buildQueryContext(scheduledBuffer, editor.getCursor().line, this.settings.queryMaxLength);
    if (context.query.replace(/\s/g, "").length < 8) {
      this.present({ kind: "waiting-input", message: "\u81F3\u5C11\u8F93\u5165 8 \u4E2A\u975E\u7A7A\u767D\u5B57\u7B26\u540E\u67E5\u8BE2" }, []);
      return;
    }
    this.present({ kind: "querying", message: "\u67E5\u8BE2\u4E2D\u2026" }, this.results);
    const started = performance.now();
    this.modelTimer = window.setTimeout(() => {
      if (this.queryGate.isCurrent(generation)) this.present({ kind: "loading-model", message: "\u6A21\u578B\u52A0\u8F7D\u4E2D/\u67E5\u8BE2\u4E2D\u2026" }, this.results);
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
      const message = this.index.size ? `\u5B8C\u6210\uFF08\u7D22\u5F15 ${this.index.size} \u4E2A\u7247\u6BB5${response.coldLoad ? "\uFF0C\u6A21\u578B\u672C\u6B21\u51B7\u52A0\u8F7D" : ""}\uFF09` : "\u7D22\u5F15\u5DF2\u5EFA\u7ACB\uFF0C\u4F46\u6CA1\u6709\u53EF\u53EC\u56DE\u7247\u6BB5";
      this.present({ kind: "complete", message, latencyMs }, results);
    } catch (error) {
      if (this.modelTimer) window.clearTimeout(this.modelTimer);
      if (!this.queryGate.isCurrent(generation)) return;
      const message = error instanceof EmbeddingError && error.kind === "connection" ? "Ollama \u4E0D\u53EF\u7528" : `\u67E5\u8BE2\u5931\u8D25\uFF1A${error instanceof Error ? error.message : String(error)}`;
      this.present({ kind: error instanceof EmbeddingError && error.kind === "connection" ? "ollama-unavailable" : "query-failed", message }, this.results);
    }
  }
  clearQueryTimers() {
    if (this.queryTimer) window.clearTimeout(this.queryTimer);
    if (this.modelTimer) window.clearTimeout(this.modelTimer);
    this.queryTimer = void 0;
    this.modelTimer = void 0;
  }
  scheduleFileUpdate(file) {
    if (this.indexing) {
      this.pendingChangedPaths.add(file.path);
      return;
    }
    if (!this.index.isReady(this.indexIdentity())) return;
    this.pendingChangedPaths.add(file.path);
    if (this.updateTimer) window.clearTimeout(this.updateTimer);
    this.updateTimer = window.setTimeout(() => void this.flushFileUpdates(), 500);
  }
  async flushFileUpdates() {
    if (this.indexing || !this.index.isReady(this.indexIdentity())) return;
    const paths = [...this.pendingChangedPaths];
    this.pendingChangedPaths.clear();
    for (const path of paths) await this.updateChangedFile(path);
    const activePath = this.latestMarkdownView?.file?.path;
    if (paths.some((path) => path !== activePath)) this.refreshCurrentQuery();
  }
  async updateChangedFile(filePath) {
    if (this.indexing || !this.index.isReady(this.indexIdentity())) return;
    const file = this.app.vault.getAbstractFileByPath(filePath);
    const retained = this.index.chunks.filter((chunk) => chunk.filePath !== filePath);
    try {
      if (!(file instanceof import_obsidian3.TFile) || file.extension !== "md" || this.isExcluded(file.path)) {
        await this.commitIndex(this.indexIdentity(), [...retained]);
        return;
      }
      const indexed = await this.indexFiles([file], this.index.reusableById(this.indexIdentity()), () => false, false);
      await this.commitIndex(this.indexIdentity(), [...retained, ...indexed]);
    } catch (error) {
      this.present({ kind: "query-failed", message: `\u589E\u91CF\u7D22\u5F15\u5931\u8D25\uFF1A${error instanceof Error ? error.message : String(error)}` }, this.results);
    }
  }
  async rebuildIndex() {
    if (this.indexing) return;
    const identity = this.indexIdentity();
    const hadUsableIndex = this.index.isReady(identity);
    this.indexing = true;
    const buildToken = this.buildCancellation.startBuild();
    this.queryGate.invalidate();
    const files = this.app.vault.getMarkdownFiles().filter((file) => !this.isExcluded(file.path));
    this.presentIndexProgress({ phase: "scanning", current: 0, total: files.length, label: "\u6B63\u5728\u626B\u63CF\u7B14\u8BB0" });
    try {
      const chunks = await this.indexFiles(files, this.index.reusableById(identity), () => this.buildCancellation.isBuildCancelled(buildToken), true);
      this.buildCancellation.assertBuildCanContinue(buildToken);
      this.presentIndexProgress({ phase: "saving", current: chunks.length, total: chunks.length, label: "\u6B63\u5728\u4FDD\u5B58\u7D22\u5F15" });
      await this.commitIndex(identity, chunks, buildToken);
      this.syncQueryAvailability();
      const schedule = this.lifecycle.indexReady();
      this.present({ kind: "complete", message: `\u7D22\u5F15\u5B8C\u6210\uFF1A${chunks.length} \u4E2A\u7247\u6BB5` }, this.results);
      this.indexing = false;
      if (schedule) this.scheduleQueryFromCurrentEditor(schedule);
    } catch (error) {
      if (error instanceof IndexBuildCancelled) {
        this.present({
          kind: "index-cancelled",
          message: hadUsableIndex ? "\u5DF2\u53D6\u6D88\u91CD\u5EFA\uFF0C\u6B63\u5728\u7EE7\u7EED\u4F7F\u7528\u539F\u6709\u7D22\u5F15" : "\u5DF2\u53D6\u6D88\u3002\u5C1A\u672A\u5EFA\u7ACB\u77E5\u8BC6\u5E93\u7D22\u5F15",
          indexAction: hadUsableIndex ? "rebuild" : "build"
        }, hadUsableIndex ? this.results : []);
      } else {
        const unavailable = error instanceof EmbeddingError && error.kind === "connection";
        this.present({
          kind: "index-failed",
          message: unavailable ? "\u5EFA\u5E93\u5931\u8D25\uFF1AOllama \u4E0D\u53EF\u7528" : `\u5EFA\u5E93\u5931\u8D25\uFF1A${error instanceof Error ? error.message : String(error)}`,
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
  cancelIndex() {
    if (!this.indexing) return;
    this.buildCancellation.cancelCurrentBuild();
  }
  async indexFiles(files, reusable, cancelled, reportProgress) {
    const pending = [];
    const output = [];
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
      if (reportProgress) this.presentIndexProgress({ phase: "scanning", current: i + 1, total: files.length, label: "\u6B63\u5728\u626B\u63CF\u7B14\u8BB0" });
      if (i % 8 === 7) await this.yieldToUi();
    }
    for (let start = 0; start < pending.length; start += this.settings.embeddingBatchSize) {
      if (cancelled()) throw new IndexBuildCancelled();
      const batch = pending.slice(start, start + this.settings.embeddingBatchSize);
      const response = await this.provider().embedDocuments(batch.map(embeddingText));
      if (cancelled()) throw new IndexBuildCancelled();
      output.push(...batch.map((chunk, index) => ({ ...chunk, vector: response.vectors[index] })));
      if (reportProgress) this.presentIndexProgress({ phase: "embedding", current: Math.min(start + batch.length, pending.length), total: pending.length, label: "\u6B63\u5728\u751F\u6210\u5411\u91CF" });
      await this.yieldToUi();
    }
    if (cancelled()) throw new IndexBuildCancelled();
    return output;
  }
  presentIndexProgress(progress) {
    this.present({ kind: "indexing", message: progress.label, progress }, this.results);
  }
  async commitIndex(identity, chunks, buildToken) {
    this.buildCancellation.assertCommitCanProceed(buildToken);
    const candidate = this.index.replacement(identity, chunks);
    await this.saveData({ settings: this.settings, index: candidate });
    this.buildCancellation.assertPluginActive();
    this.index.commit(candidate);
  }
  async yieldToUi() {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  }
  isExcluded(path) {
    return excludedDirectoryList(this.settings.excludedDirectories).some((directory) => path === directory || path.startsWith(`${directory}/`));
  }
  showIndexRequirement(message) {
    if (this.indexing || this.state.kind === "index-cancelled" || this.state.kind === "index-failed") return;
    const lifecycle = this.index.lifecycle(this.indexIdentity());
    if (lifecycle === "ready") return;
    if (lifecycle === "incompatible") {
      this.present({ kind: "index-needed", message: message ?? "\u7D22\u5F15\u914D\u7F6E\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u5EFA\u7D22\u5F15", indexAction: "rebuild" }, []);
      return;
    }
    this.present({
      kind: "index-needed",
      message: "\u5C1A\u672A\u5EFA\u7ACB\u77E5\u8BC6\u5E93\u7D22\u5F15",
      detail: "\u5EFA\u7ACB\u7D22\u5F15\u540E\uFF0CSide Grep \u624D\u80FD\u4ECE\u5DF2\u6709\u7B14\u8BB0\u4E2D\u53EC\u56DE\u76F8\u5173\u7247\u6BB5\u3002",
      indexAction: "build"
    }, []);
  }
  present(state, results = this.results) {
    this.state = state;
    this.results = results;
    this.app.workspace.getLeavesOfType(SIDE_GREP_VIEW_TYPE).forEach((leaf) => leaf.view.showResults(state, results));
  }
  async activateView() {
    const existing = this.app.workspace.getLeavesOfType(SIDE_GREP_VIEW_TYPE)[0];
    const leaf = existing ?? this.app.workspace.getRightLeaf(false);
    await leaf.setViewState({ type: SIDE_GREP_VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
    leaf.view.showResults(this.state, this.results);
    if (existing) this.sidebarOpened();
  }
  sidebarOpened() {
    const schedule = this.lifecycle.sidebarOpened();
    if (schedule) this.scheduleQueryFromCurrentEditor(schedule);
  }
  refreshCurrentQuery() {
    if (!this.index.isReady(this.indexIdentity()) || this.indexing) return;
    const schedule = this.lifecycle.sidebarOpened();
    if (schedule) this.scheduleQueryFromCurrentEditor(schedule);
  }
  async openResult(result) {
    const file = this.app.vault.getAbstractFileByPath(result.filePath);
    if (!(file instanceof import_obsidian3.TFile)) return;
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file, { active: true });
    if (leaf.view instanceof import_obsidian3.MarkdownView) leaf.view.editor.setCursor({ line: result.startLine - 1, ch: 0 });
  }
  insertLink(result) {
    const editor = this.latestMarkdownView?.editor ?? this.app.workspace.getActiveViewOfType(import_obsidian3.MarkdownView)?.editor;
    if (editor) editor.replaceSelection(this.linkMarkup(result));
  }
  insertQuote(result, selectedText) {
    const editor = this.latestMarkdownView?.editor ?? this.app.workspace.getActiveViewOfType(import_obsidian3.MarkdownView)?.editor;
    if (!editor) return;
    editor.replaceSelection(this.quoteMarkup(result, selectedText));
  }
  linkMarkup(result) {
    return `[[${this.linkTarget(result)}]]`;
  }
  quoteMarkup(result, selectedText) {
    const text = selectedText?.trim() || result.text;
    const quoted = text.split("\n").map((line) => `> ${line}`).join("\n");
    return `${quoted}
>
> \u2014\u2014 ${this.linkMarkup(result)}`;
  }
  expansionPolicy() {
    return {
      count: this.settings.autoExpandCount,
      thresholdEnabled: this.settings.autoExpandThresholdEnabled,
      threshold: this.settings.autoExpandThreshold
    };
  }
  linkTarget(result) {
    const path = result.filePath.replace(/\.md$/i, "");
    const heading = result.breadcrumb.at(-1);
    return heading ? `${path}#${heading}` : path;
  }
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsic3JjL21haW4udHMiLCAic3JjL3R5cGVzLnRzIiwgInNyYy9jaHVua2VyLnRzIiwgInNyYy9idWlsZC1jYW5jZWxsYXRpb24udHMiLCAic3JjL2VtYmVkZGluZy1wcm92aWRlci50cyIsICJzcmMvcGVyc2lzdGVudC1pbmRleC50cyIsICJzcmMvcXVlcnktY29udGV4dC50cyIsICJzcmMvcXVlcnktZ2F0ZS50cyIsICJzcmMvcXVlcnktbGlmZWN5Y2xlLnRzIiwgInNyYy9yZXRyaWV2YWwudHMiLCAic3JjL3NldHRpbmdzLnRzIiwgInNyYy9zaWRlYmFyLXZpZXcudHMiLCAic3JjL2V4cGFuc2lvbi1wb2xpY3kudHMiLCAic3JjL3Jlc3VsdC1wcmVzZW50YXRpb24udHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImltcG9ydCB7IEVkaXRvciwgTWFya2Rvd25WaWV3LCBQbHVnaW4sIFRBYnN0cmFjdEZpbGUsIFRGaWxlLCBXb3Jrc3BhY2VMZWFmLCByZXF1ZXN0VXJsIH0gZnJvbSBcIm9ic2lkaWFuXCI7XG5pbXBvcnQgeyBjaHVua01hcmtkb3duLCBlbWJlZGRpbmdUZXh0IH0gZnJvbSBcIi4vY2h1bmtlclwiO1xuaW1wb3J0IHsgQnVpbGRDYW5jZWxsYXRpb25Db250cm9sbGVyLCBCdWlsZENhbmNlbGxhdGlvblRva2VuLCBJbmRleEJ1aWxkQ2FuY2VsbGVkIH0gZnJvbSBcIi4vYnVpbGQtY2FuY2VsbGF0aW9uXCI7XG5pbXBvcnQgeyBFbWJlZGRpbmdFcnJvciwgT2xsYW1hRW1iZWRkaW5nUHJvdmlkZXIgfSBmcm9tIFwiLi9lbWJlZGRpbmctcHJvdmlkZXJcIjtcbmltcG9ydCB7IFBlcnNpc3RlbnRJbmRleCB9IGZyb20gXCIuL3BlcnNpc3RlbnQtaW5kZXhcIjtcbmltcG9ydCB7IGJ1aWxkUXVlcnlDb250ZXh0IH0gZnJvbSBcIi4vcXVlcnktY29udGV4dFwiO1xuaW1wb3J0IHsgUXVlcnlHYXRlIH0gZnJvbSBcIi4vcXVlcnktZ2F0ZVwiO1xuaW1wb3J0IHsgUXVlcnlMaWZlY3ljbGVDb29yZGluYXRvciwgUXVlcnlTY2hlZHVsZSB9IGZyb20gXCIuL3F1ZXJ5LWxpZmVjeWNsZVwiO1xuaW1wb3J0IHsgcmFua0NodW5rcyB9IGZyb20gXCIuL3JldHJpZXZhbFwiO1xuaW1wb3J0IHsgREVGQVVMVF9TRVRUSU5HUywgZXhjbHVkZWREaXJlY3RvcnlMaXN0LCBTaWRlR3JlcFNldHRpbmdzLCBTaWRlR3JlcFNldHRpbmdUYWIgfSBmcm9tIFwiLi9zZXR0aW5nc1wiO1xuaW1wb3J0IHsgU2lkZWJhckFjdGlvbnMsIFNJREVfR1JFUF9WSUVXX1RZUEUsIFNpZGVHcmVwVmlldyB9IGZyb20gXCIuL3NpZGViYXItdmlld1wiO1xuaW1wb3J0IHsgQ0hVTktFUl9WRVJTSU9OLCBDaHVuaywgSW5kZXhJZGVudGl0eSwgSW5kZXhlZENodW5rLCBJbmRleFByb2dyZXNzLCBQZXJzaXN0ZW50SW5kZXhEYXRhLCBTZWFyY2hSZXN1bHQsIFNpZGViYXJTdGF0ZSB9IGZyb20gXCIuL3R5cGVzXCI7XG5cbmludGVyZmFjZSBQbHVnaW5EYXRhIHtcbiAgc2V0dGluZ3M/OiBQYXJ0aWFsPFNpZGVHcmVwU2V0dGluZ3M+O1xuICBpbmRleD86IFBlcnNpc3RlbnRJbmRleERhdGE7XG59XG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFNpZGVHcmVwUGx1Z2luIGV4dGVuZHMgUGx1Z2luIGltcGxlbWVudHMgU2lkZWJhckFjdGlvbnMge1xuICBzZXR0aW5nczogU2lkZUdyZXBTZXR0aW5ncyA9IHsgLi4uREVGQVVMVF9TRVRUSU5HUyB9O1xuICBwcml2YXRlIGluZGV4ITogUGVyc2lzdGVudEluZGV4O1xuICBwcml2YXRlIHF1ZXJ5VGltZXI6IG51bWJlciB8IHVuZGVmaW5lZDtcbiAgcHJpdmF0ZSBtb2RlbFRpbWVyOiBudW1iZXIgfCB1bmRlZmluZWQ7XG4gIHByaXZhdGUgdXBkYXRlVGltZXI6IG51bWJlciB8IHVuZGVmaW5lZDtcbiAgcHJpdmF0ZSByZWFkb25seSBwZW5kaW5nQ2hhbmdlZFBhdGhzID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gIHByaXZhdGUgcmVhZG9ubHkgcXVlcnlHYXRlID0gbmV3IFF1ZXJ5R2F0ZSgpO1xuICBwcml2YXRlIGxpZmVjeWNsZSA9IG5ldyBRdWVyeUxpZmVjeWNsZUNvb3JkaW5hdG9yKFwidW5pbml0aWFsaXplZFwiKTtcbiAgcHJpdmF0ZSBsYXRlc3RNYXJrZG93blZpZXc6IE1hcmtkb3duVmlldyB8IHVuZGVmaW5lZDtcbiAgcHJpdmF0ZSBsYXN0QWN0aXZhdGVkTWFya2Rvd25QYXRoOiBzdHJpbmcgfCB1bmRlZmluZWQ7XG4gIHByaXZhdGUgc3RhdGU6IFNpZGViYXJTdGF0ZSA9IHsga2luZDogXCJ3YWl0aW5nLWlucHV0XCIsIG1lc3NhZ2U6IFwiXHU3QjQ5XHU1Rjg1XHU4RjkzXHU1MTY1XCIgfTtcbiAgcHJpdmF0ZSByZXN1bHRzOiBTZWFyY2hSZXN1bHRbXSA9IFtdO1xuICBwcml2YXRlIGluZGV4aW5nID0gZmFsc2U7XG4gIHByaXZhdGUgcmVhZG9ubHkgYnVpbGRDYW5jZWxsYXRpb24gPSBuZXcgQnVpbGRDYW5jZWxsYXRpb25Db250cm9sbGVyKCk7XG5cbiAgYXN5bmMgb25sb2FkKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHNhdmVkID0gKGF3YWl0IHRoaXMubG9hZERhdGEoKSA/PyB7fSkgYXMgUGx1Z2luRGF0YTtcbiAgICB0aGlzLnNldHRpbmdzID0geyAuLi5ERUZBVUxUX1NFVFRJTkdTLCAuLi5zYXZlZC5zZXR0aW5ncyB9O1xuICAgIHRoaXMuaW5kZXggPSBuZXcgUGVyc2lzdGVudEluZGV4KHRoaXMuaW5kZXhJZGVudGl0eSgpLCBzYXZlZC5pbmRleCk7XG4gICAgdGhpcy5zeW5jUXVlcnlBdmFpbGFiaWxpdHkoKTtcbiAgICB0aGlzLnJlZ2lzdGVyVmlldyhTSURFX0dSRVBfVklFV19UWVBFLCAobGVhZikgPT4gbmV3IFNpZGVHcmVwVmlldyhsZWFmLCB0aGlzKSk7XG4gICAgdGhpcy5hZGRTZXR0aW5nVGFiKG5ldyBTaWRlR3JlcFNldHRpbmdUYWIodGhpcy5hcHAsIHRoaXMpKTtcbiAgICB0aGlzLmFkZENvbW1hbmQoeyBpZDogXCJvcGVuLXNpZGViYXJcIiwgbmFtZTogXCJcdTYyNTNcdTVGMDAgU2lkZSBHcmVwIFx1NEZBN1x1OEZCOVx1NjgwRlwiLCBjYWxsYmFjazogKCkgPT4gdm9pZCB0aGlzLmFjdGl2YXRlVmlldygpIH0pO1xuICAgIHRoaXMuYWRkQ29tbWFuZCh7IGlkOiBcInJlYnVpbGQtaW5kZXhcIiwgbmFtZTogXCJcdTVFRkFcdTdBQ0IvXHU5MUNEXHU1RUZBXHU3N0U1XHU4QkM2XHU3MjQ3XHU2QkI1XHU3RDIyXHU1RjE1XCIsIGNhbGxiYWNrOiAoKSA9PiB2b2lkIHRoaXMucmVidWlsZEluZGV4KCkgfSk7XG4gICAgdGhpcy5yZWdpc3RlckV2ZW50KHRoaXMuYXBwLndvcmtzcGFjZS5vbihcImVkaXRvci1jaGFuZ2VcIiwgKGVkaXRvciwgdmlldykgPT4gdGhpcy5vbkVkaXRvckNoYW5nZShlZGl0b3IsIHZpZXcpKSk7XG4gICAgdGhpcy5yZWdpc3RlckV2ZW50KHRoaXMuYXBwLndvcmtzcGFjZS5vbihcImZpbGUtb3BlblwiLCAoZmlsZSkgPT4gdGhpcy5vbkZpbGVPcGVuKGZpbGUpKSk7XG4gICAgdGhpcy5yZWdpc3RlckV2ZW50KHRoaXMuYXBwLndvcmtzcGFjZS5vbihcImFjdGl2ZS1sZWFmLWNoYW5nZVwiLCAobGVhZikgPT4gdGhpcy5vbkFjdGl2ZUxlYWZDaGFuZ2UobGVhZikpKTtcbiAgICB0aGlzLnJlZ2lzdGVyRXZlbnQodGhpcy5hcHAudmF1bHQub24oXCJjcmVhdGVcIiwgKGZpbGUpID0+IHRoaXMuc2NoZWR1bGVGaWxlVXBkYXRlKGZpbGUpKSk7XG4gICAgdGhpcy5yZWdpc3RlckV2ZW50KHRoaXMuYXBwLnZhdWx0Lm9uKFwibW9kaWZ5XCIsIChmaWxlKSA9PiB0aGlzLnNjaGVkdWxlRmlsZVVwZGF0ZShmaWxlKSkpO1xuICAgIHRoaXMucmVnaXN0ZXJFdmVudCh0aGlzLmFwcC52YXVsdC5vbihcImRlbGV0ZVwiLCAoZmlsZSkgPT4gdGhpcy5zY2hlZHVsZUZpbGVVcGRhdGUoZmlsZSkpKTtcbiAgICB0aGlzLnNob3dJbmRleFJlcXVpcmVtZW50KCk7XG4gICAgdGhpcy5hcHAud29ya3NwYWNlLm9uTGF5b3V0UmVhZHkoKCkgPT4ge1xuICAgICAgY29uc3QgdmlldyA9IHRoaXMuYXBwLndvcmtzcGFjZS5nZXRBY3RpdmVWaWV3T2ZUeXBlKE1hcmtkb3duVmlldyk7XG4gICAgICBpZiAodmlldykge1xuICAgICAgICB0aGlzLmxhdGVzdE1hcmtkb3duVmlldyA9IHZpZXc7XG4gICAgICAgIHRoaXMubGlmZWN5Y2xlLnJlbWVtYmVyTWFya2Rvd25Db250ZXh0KCk7XG4gICAgICB9XG4gICAgICBjb25zdCBzY2hlZHVsZSA9IHRoaXMubGlmZWN5Y2xlLmxheW91dFJlYWR5KCk7XG4gICAgICBpZiAoc2NoZWR1bGUpIHRoaXMuc2NoZWR1bGVRdWVyeUZyb21DdXJyZW50RWRpdG9yKHNjaGVkdWxlKTtcbiAgICB9KTtcbiAgfVxuXG4gIG9udW5sb2FkKCk6IHZvaWQge1xuICAgIHRoaXMuYnVpbGRDYW5jZWxsYXRpb24udW5sb2FkKCk7XG4gICAgdGhpcy5jbGVhclF1ZXJ5VGltZXJzKCk7XG4gICAgdGhpcy5xdWVyeUdhdGUuaW52YWxpZGF0ZSgpO1xuICB9XG5cbiAgYXN5bmMgc2F2ZVNldHRpbmdzKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGF3YWl0IHRoaXMuc2F2ZURhdGEoeyBzZXR0aW5nczogdGhpcy5zZXR0aW5ncywgaW5kZXg6IHRoaXMuaW5kZXguc2VyaWFsaXplKCkgfSk7XG4gIH1cblxuICBvblNldHRpbmdzQ2hhbmdlZCgpOiB2b2lkIHtcbiAgICB0aGlzLnF1ZXJ5R2F0ZS5pbnZhbGlkYXRlKCk7XG4gICAgdGhpcy5zeW5jUXVlcnlBdmFpbGFiaWxpdHkoKTtcbiAgICBpZiAoIXRoaXMuaW5kZXhpbmcpIHRoaXMuc2hvd0luZGV4UmVxdWlyZW1lbnQoXCJcdTVGNzFcdTU0Q0QgZW1iZWRkaW5nIFx1NzY4NFx1OTE0RFx1N0Y2RVx1NURGMlx1NjUzOVx1NTNEOFx1RkYwQ1x1OEJGN1x1OTFDRFx1NUVGQVx1N0QyMlx1NUYxNVwiKTtcbiAgICB0aGlzLnByZXNlbnQodGhpcy5zdGF0ZSwgdGhpcy5yZXN1bHRzKTtcbiAgfVxuXG4gIHByaXZhdGUgaW5kZXhJZGVudGl0eSgpOiBJbmRleElkZW50aXR5IHtcbiAgICByZXR1cm4ge1xuICAgICAgbW9kZWw6IHRoaXMuc2V0dGluZ3MubW9kZWwsXG4gICAgICBkaW1lbnNpb25zOiB0aGlzLnNldHRpbmdzLmRpbWVuc2lvbnMsXG4gICAgICBjaHVua2VyVmVyc2lvbjogQ0hVTktFUl9WRVJTSU9OLFxuICAgICAgY2h1bmtUYXJnZXRMZW5ndGg6IHRoaXMuc2V0dGluZ3MuY2h1bmtUYXJnZXRMZW5ndGgsXG4gICAgICBjaHVua01heExlbmd0aDogdGhpcy5zZXR0aW5ncy5jaHVua01heExlbmd0aCxcbiAgICAgIGNodW5rTWluTGVuZ3RoOiB0aGlzLnNldHRpbmdzLmNodW5rTWluTGVuZ3RoXG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgc3luY1F1ZXJ5QXZhaWxhYmlsaXR5KCk6IHZvaWQge1xuICAgIGNvbnN0IGxpZmVjeWNsZSA9IHRoaXMuaW5kZXgubGlmZWN5Y2xlKHRoaXMuaW5kZXhJZGVudGl0eSgpKTtcbiAgICB0aGlzLmxpZmVjeWNsZS5zZXRJbmRleEF2YWlsYWJpbGl0eShsaWZlY3ljbGUgPT09IFwicmVhZHlcIiA/IFwicmVhZHlcIiA6IGxpZmVjeWNsZSA9PT0gXCJpbmNvbXBhdGlibGVcIiA/IFwiaW5jb21wYXRpYmxlXCIgOiBcInVuaW5pdGlhbGl6ZWRcIik7XG4gIH1cblxuICBwcml2YXRlIHByb3ZpZGVyKCk6IE9sbGFtYUVtYmVkZGluZ1Byb3ZpZGVyIHtcbiAgICByZXR1cm4gbmV3IE9sbGFtYUVtYmVkZGluZ1Byb3ZpZGVyKHtcbiAgICAgIGVuZHBvaW50OiB0aGlzLnNldHRpbmdzLmVuZHBvaW50LFxuICAgICAgbW9kZWw6IHRoaXMuc2V0dGluZ3MubW9kZWwsXG4gICAgICBkaW1lbnNpb25zOiB0aGlzLnNldHRpbmdzLmRpbWVuc2lvbnMsXG4gICAgICBrZWVwQWxpdmU6IHRoaXMuc2V0dGluZ3Mua2VlcEFsaXZlLFxuICAgICAgcXVlcnlJbnN0cnVjdGlvbjogdGhpcy5zZXR0aW5ncy5xdWVyeUluc3RydWN0aW9uXG4gICAgfSwgYXN5bmMgKHVybCwgYm9keSkgPT4ge1xuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCByZXF1ZXN0VXJsKHsgdXJsLCBtZXRob2Q6IFwiUE9TVFwiLCBjb250ZW50VHlwZTogXCJhcHBsaWNhdGlvbi9qc29uXCIsIGJvZHksIHRocm93OiBmYWxzZSB9KTtcbiAgICAgIHJldHVybiB7IHN0YXR1czogcmVzcG9uc2Uuc3RhdHVzLCB0ZXh0OiByZXNwb25zZS50ZXh0IH07XG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIG9uRWRpdG9yQ2hhbmdlKGVkaXRvcjogRWRpdG9yLCB2aWV3OiBNYXJrZG93blZpZXcgfCBpbXBvcnQoXCJvYnNpZGlhblwiKS5NYXJrZG93bkZpbGVJbmZvKTogdm9pZCB7XG4gICAgaWYgKCEodmlldyBpbnN0YW5jZW9mIE1hcmtkb3duVmlldykpIHJldHVybjtcbiAgICB0aGlzLmxhdGVzdE1hcmtkb3duVmlldyA9IHZpZXc7XG4gICAgdGhpcy5saWZlY3ljbGUucmVtZW1iZXJNYXJrZG93bkNvbnRleHQoKTtcbiAgICBjb25zdCBzY2hlZHVsZSA9IHRoaXMubGlmZWN5Y2xlLmVkaXRvckNoYW5nZWQoKTtcbiAgICBpZiAoc2NoZWR1bGUpIHRoaXMuc2NoZWR1bGVRdWVyeUZyb21DdXJyZW50RWRpdG9yKHNjaGVkdWxlLCBlZGl0b3IsIHZpZXcpO1xuICB9XG5cbiAgcHJpdmF0ZSBvbkZpbGVPcGVuKGZpbGU6IFRGaWxlIHwgbnVsbCk6IHZvaWQge1xuICAgIGlmICghKGZpbGUgaW5zdGFuY2VvZiBURmlsZSkgfHwgZmlsZS5leHRlbnNpb24gIT09IFwibWRcIikgcmV0dXJuO1xuICAgIGNvbnN0IHZpZXcgPSB0aGlzLmFwcC53b3Jrc3BhY2UuZ2V0QWN0aXZlVmlld09mVHlwZShNYXJrZG93blZpZXcpO1xuICAgIGlmICh2aWV3Py5maWxlPy5wYXRoID09PSBmaWxlLnBhdGgpIHRoaXMubm90ZU1hcmtkb3duQWN0aXZhdGVkKHZpZXcpO1xuICB9XG5cbiAgcHJpdmF0ZSBvbkFjdGl2ZUxlYWZDaGFuZ2UobGVhZjogV29ya3NwYWNlTGVhZiB8IG51bGwpOiB2b2lkIHtcbiAgICBpZiAobGVhZj8udmlldyBpbnN0YW5jZW9mIE1hcmtkb3duVmlldykgdGhpcy5ub3RlTWFya2Rvd25BY3RpdmF0ZWQobGVhZi52aWV3KTtcbiAgICBlbHNlIHRoaXMubGlmZWN5Y2xlLm5vbk1hcmtkb3duTGVhZkFjdGl2YXRlZCgpO1xuICB9XG5cbiAgcHJpdmF0ZSBub3RlTWFya2Rvd25BY3RpdmF0ZWQodmlldzogTWFya2Rvd25WaWV3KTogdm9pZCB7XG4gICAgY29uc3QgcGF0aCA9IHZpZXcuZmlsZT8ucGF0aDtcbiAgICB0aGlzLmxhdGVzdE1hcmtkb3duVmlldyA9IHZpZXc7XG4gICAgaWYgKHBhdGggJiYgcGF0aCA9PT0gdGhpcy5sYXN0QWN0aXZhdGVkTWFya2Rvd25QYXRoKSByZXR1cm47XG4gICAgdGhpcy5sYXN0QWN0aXZhdGVkTWFya2Rvd25QYXRoID0gcGF0aDtcbiAgICBjb25zdCBzY2hlZHVsZSA9IHRoaXMubGlmZWN5Y2xlLm5vdGVNYXJrZG93bkFjdGl2YXRlZCgpO1xuICAgIGlmIChzY2hlZHVsZSkgdGhpcy5zY2hlZHVsZVF1ZXJ5RnJvbUN1cnJlbnRFZGl0b3Ioc2NoZWR1bGUsIHZpZXcuZWRpdG9yLCB2aWV3KTtcbiAgfVxuXG4gIC8qKiBUaGUgb25lIHByb2R1Y3Rpb24gZW50cnkgcG9pbnQgZm9yIHR5cGluZywgZmlsZSwgc2lkZWJhciwgYW5kIGluZGV4LXJlYWR5IHF1ZXJpZXMuICovXG4gIHByaXZhdGUgc2NoZWR1bGVRdWVyeUZyb21DdXJyZW50RWRpdG9yKHNjaGVkdWxlOiBRdWVyeVNjaGVkdWxlLCBzdXBwbGllZEVkaXRvcj86IEVkaXRvciwgc3VwcGxpZWRWaWV3PzogTWFya2Rvd25WaWV3KTogdm9pZCB7XG4gICAgdGhpcy5jbGVhclF1ZXJ5VGltZXJzKCk7XG4gICAgY29uc3QgZ2VuZXJhdGlvbiA9IHRoaXMucXVlcnlHYXRlLmJlZ2luKCk7XG4gICAgY29uc3QgdmlldyA9IHN1cHBsaWVkVmlldyA/PyB0aGlzLmxhdGVzdE1hcmtkb3duVmlldztcbiAgICBjb25zdCBlZGl0b3IgPSBzdXBwbGllZEVkaXRvciA/PyB2aWV3Py5lZGl0b3I7XG4gICAgaWYgKCF2aWV3IHx8ICFlZGl0b3IpIHJldHVybjtcbiAgICBjb25zdCBidWZmZXIgPSBlZGl0b3IuZ2V0VmFsdWUoKTtcblxuICAgIC8vIEJ1aWxkIHByb2dyZXNzIGlzIGF1dGhvcml0YXRpdmU6IGlucHV0IG9ubHkgaW52YWxpZGF0ZXMgc3RhbGUgd29yayBhbmQgaXNcbiAgICAvLyBxdWVyaWVkIGZyb20gdGhlIGxhdGVzdCBidWZmZXIgb25jZSBhIHN1Y2Nlc3NmdWwgYnVpbGQgY2FsbHMgaW5kZXhSZWFkeS5cbiAgICBpZiAodGhpcy5pbmRleGluZykgcmV0dXJuO1xuICAgIGlmICghdGhpcy5pbmRleC5pc1JlYWR5KHRoaXMuaW5kZXhJZGVudGl0eSgpKSkge1xuICAgICAgdGhpcy5zaG93SW5kZXhSZXF1aXJlbWVudCgpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAoIWJ1ZmZlci50cmltKCkpIHtcbiAgICAgIHRoaXMucHJlc2VudCh7IGtpbmQ6IFwid2FpdGluZy1pbnB1dFwiLCBtZXNzYWdlOiBcIlx1N0I0OVx1NUY4NVx1OEY5M1x1NTE2NVwiIH0sIFtdKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKCFzY2hlZHVsZS5pbW1lZGlhdGUpIHtcbiAgICAgIHRoaXMucHJlc2VudCh7IGtpbmQ6IFwid2FpdGluZy1kZWJvdW5jZVwiLCBtZXNzYWdlOiBcIlx1N0I0OVx1NUY4NVx1NTA1Q1x1N0IxNFx1MjAyNlwiIH0sIHRoaXMucmVzdWx0cyk7XG4gICAgICB0aGlzLnF1ZXJ5VGltZXIgPSB3aW5kb3cuc2V0VGltZW91dCgoKSA9PiB2b2lkIHRoaXMucnVuUXVlcnkoZ2VuZXJhdGlvbiwgZWRpdG9yLCB2aWV3LCB2aWV3LmZpbGU/LnBhdGgsIGJ1ZmZlciksIHRoaXMuc2V0dGluZ3MucXVlcnlEZWJvdW5jZU1zKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdm9pZCB0aGlzLnJ1blF1ZXJ5KGdlbmVyYXRpb24sIGVkaXRvciwgdmlldywgdmlldy5maWxlPy5wYXRoLCBidWZmZXIpO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBydW5RdWVyeShnZW5lcmF0aW9uOiBudW1iZXIsIGVkaXRvcjogRWRpdG9yLCB2aWV3OiBNYXJrZG93blZpZXcsIGZpbGVQYXRoOiBzdHJpbmcgfCB1bmRlZmluZWQsIHNjaGVkdWxlZEJ1ZmZlcjogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCF0aGlzLnF1ZXJ5R2F0ZS5pc0N1cnJlbnQoZ2VuZXJhdGlvbikgfHwgZWRpdG9yLmdldFZhbHVlKCkgIT09IHNjaGVkdWxlZEJ1ZmZlciB8fCB0aGlzLmxhdGVzdE1hcmtkb3duVmlldyAhPT0gdmlldykgcmV0dXJuO1xuICAgIGlmICh0aGlzLmluZGV4aW5nKSByZXR1cm47XG4gICAgaWYgKCF0aGlzLmluZGV4LmlzUmVhZHkodGhpcy5pbmRleElkZW50aXR5KCkpKSB7XG4gICAgICB0aGlzLnNob3dJbmRleFJlcXVpcmVtZW50KCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IGNvbnRleHQgPSBidWlsZFF1ZXJ5Q29udGV4dChzY2hlZHVsZWRCdWZmZXIsIGVkaXRvci5nZXRDdXJzb3IoKS5saW5lLCB0aGlzLnNldHRpbmdzLnF1ZXJ5TWF4TGVuZ3RoKTtcbiAgICBpZiAoY29udGV4dC5xdWVyeS5yZXBsYWNlKC9cXHMvZywgXCJcIikubGVuZ3RoIDwgOCkge1xuICAgICAgdGhpcy5wcmVzZW50KHsga2luZDogXCJ3YWl0aW5nLWlucHV0XCIsIG1lc3NhZ2U6IFwiXHU4MUYzXHU1QzExXHU4RjkzXHU1MTY1IDggXHU0RTJBXHU5NzVFXHU3QTdBXHU3NjdEXHU1QjU3XHU3QjI2XHU1NDBFXHU2N0U1XHU4QkUyXCIgfSwgW10pO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB0aGlzLnByZXNlbnQoeyBraW5kOiBcInF1ZXJ5aW5nXCIsIG1lc3NhZ2U6IFwiXHU2N0U1XHU4QkUyXHU0RTJEXHUyMDI2XCIgfSwgdGhpcy5yZXN1bHRzKTtcbiAgICBjb25zdCBzdGFydGVkID0gcGVyZm9ybWFuY2Uubm93KCk7XG4gICAgdGhpcy5tb2RlbFRpbWVyID0gd2luZG93LnNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgaWYgKHRoaXMucXVlcnlHYXRlLmlzQ3VycmVudChnZW5lcmF0aW9uKSkgdGhpcy5wcmVzZW50KHsga2luZDogXCJsb2FkaW5nLW1vZGVsXCIsIG1lc3NhZ2U6IFwiXHU2QTIxXHU1NzhCXHU1MkEwXHU4RjdEXHU0RTJEL1x1NjdFNVx1OEJFMlx1NEUyRFx1MjAyNlwiIH0sIHRoaXMucmVzdWx0cyk7XG4gICAgfSwgNjAwKTtcbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLnByb3ZpZGVyKCkuZW1iZWRRdWVyeShjb250ZXh0LnF1ZXJ5KTtcbiAgICAgIGlmICh0aGlzLm1vZGVsVGltZXIpIHdpbmRvdy5jbGVhclRpbWVvdXQodGhpcy5tb2RlbFRpbWVyKTtcbiAgICAgIGlmICghdGhpcy5xdWVyeUdhdGUuaXNDdXJyZW50KGdlbmVyYXRpb24pIHx8IGVkaXRvci5nZXRWYWx1ZSgpICE9PSBzY2hlZHVsZWRCdWZmZXIgfHwgdGhpcy5sYXRlc3RNYXJrZG93blZpZXcgIT09IHZpZXcgfHwgdmlldy5maWxlPy5wYXRoICE9PSBmaWxlUGF0aCkgcmV0dXJuO1xuICAgICAgY29uc3QgcmVzdWx0cyA9IHJhbmtDaHVua3MocmVzcG9uc2UudmVjdG9yc1swXSwgdGhpcy5pbmRleC5jaHVua3MsIHtcbiAgICAgICAgdG9wSzogdGhpcy5zZXR0aW5ncy50b3BLLFxuICAgICAgICBtYXhQZXJGaWxlOiB0aGlzLnNldHRpbmdzLm1heFBlckZpbGUsXG4gICAgICAgIGV4Y2x1ZGVQYXRoOiBmaWxlUGF0aFxuICAgICAgfSk7XG4gICAgICBjb25zdCBsYXRlbmN5TXMgPSBwZXJmb3JtYW5jZS5ub3coKSAtIHN0YXJ0ZWQ7XG4gICAgICBjb25zdCBtZXNzYWdlID0gdGhpcy5pbmRleC5zaXplXG4gICAgICAgID8gYFx1NUI4Q1x1NjIxMFx1RkYwOFx1N0QyMlx1NUYxNSAke3RoaXMuaW5kZXguc2l6ZX0gXHU0RTJBXHU3MjQ3XHU2QkI1JHtyZXNwb25zZS5jb2xkTG9hZCA/IFwiXHVGRjBDXHU2QTIxXHU1NzhCXHU2NzJDXHU2QjIxXHU1MUI3XHU1MkEwXHU4RjdEXCIgOiBcIlwifVx1RkYwOWBcbiAgICAgICAgOiBcIlx1N0QyMlx1NUYxNVx1NURGMlx1NUVGQVx1N0FDQlx1RkYwQ1x1NEY0Nlx1NkNBMVx1NjcwOVx1NTNFRlx1NTNFQ1x1NTZERVx1NzI0N1x1NkJCNVwiO1xuICAgICAgdGhpcy5wcmVzZW50KHsga2luZDogXCJjb21wbGV0ZVwiLCBtZXNzYWdlLCBsYXRlbmN5TXMgfSwgcmVzdWx0cyk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGlmICh0aGlzLm1vZGVsVGltZXIpIHdpbmRvdy5jbGVhclRpbWVvdXQodGhpcy5tb2RlbFRpbWVyKTtcbiAgICAgIGlmICghdGhpcy5xdWVyeUdhdGUuaXNDdXJyZW50KGdlbmVyYXRpb24pKSByZXR1cm47XG4gICAgICBjb25zdCBtZXNzYWdlID0gZXJyb3IgaW5zdGFuY2VvZiBFbWJlZGRpbmdFcnJvciAmJiBlcnJvci5raW5kID09PSBcImNvbm5lY3Rpb25cIiA/IFwiT2xsYW1hIFx1NEUwRFx1NTNFRlx1NzUyOFwiIDogYFx1NjdFNVx1OEJFMlx1NTkzMVx1OEQyNVx1RkYxQSR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpfWA7XG4gICAgICB0aGlzLnByZXNlbnQoeyBraW5kOiBlcnJvciBpbnN0YW5jZW9mIEVtYmVkZGluZ0Vycm9yICYmIGVycm9yLmtpbmQgPT09IFwiY29ubmVjdGlvblwiID8gXCJvbGxhbWEtdW5hdmFpbGFibGVcIiA6IFwicXVlcnktZmFpbGVkXCIsIG1lc3NhZ2UgfSwgdGhpcy5yZXN1bHRzKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGNsZWFyUXVlcnlUaW1lcnMoKTogdm9pZCB7XG4gICAgaWYgKHRoaXMucXVlcnlUaW1lcikgd2luZG93LmNsZWFyVGltZW91dCh0aGlzLnF1ZXJ5VGltZXIpO1xuICAgIGlmICh0aGlzLm1vZGVsVGltZXIpIHdpbmRvdy5jbGVhclRpbWVvdXQodGhpcy5tb2RlbFRpbWVyKTtcbiAgICB0aGlzLnF1ZXJ5VGltZXIgPSB1bmRlZmluZWQ7XG4gICAgdGhpcy5tb2RlbFRpbWVyID0gdW5kZWZpbmVkO1xuICB9XG5cbiAgcHJpdmF0ZSBzY2hlZHVsZUZpbGVVcGRhdGUoZmlsZTogVEFic3RyYWN0RmlsZSk6IHZvaWQge1xuICAgIGlmICh0aGlzLmluZGV4aW5nKSB7XG4gICAgICB0aGlzLnBlbmRpbmdDaGFuZ2VkUGF0aHMuYWRkKGZpbGUucGF0aCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGlmICghdGhpcy5pbmRleC5pc1JlYWR5KHRoaXMuaW5kZXhJZGVudGl0eSgpKSkgcmV0dXJuO1xuICAgIHRoaXMucGVuZGluZ0NoYW5nZWRQYXRocy5hZGQoZmlsZS5wYXRoKTtcbiAgICBpZiAodGhpcy51cGRhdGVUaW1lcikgd2luZG93LmNsZWFyVGltZW91dCh0aGlzLnVwZGF0ZVRpbWVyKTtcbiAgICB0aGlzLnVwZGF0ZVRpbWVyID0gd2luZG93LnNldFRpbWVvdXQoKCkgPT4gdm9pZCB0aGlzLmZsdXNoRmlsZVVwZGF0ZXMoKSwgNTAwKTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgZmx1c2hGaWxlVXBkYXRlcygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAodGhpcy5pbmRleGluZyB8fCAhdGhpcy5pbmRleC5pc1JlYWR5KHRoaXMuaW5kZXhJZGVudGl0eSgpKSkgcmV0dXJuO1xuICAgIGNvbnN0IHBhdGhzID0gWy4uLnRoaXMucGVuZGluZ0NoYW5nZWRQYXRoc107XG4gICAgdGhpcy5wZW5kaW5nQ2hhbmdlZFBhdGhzLmNsZWFyKCk7XG4gICAgZm9yIChjb25zdCBwYXRoIG9mIHBhdGhzKSBhd2FpdCB0aGlzLnVwZGF0ZUNoYW5nZWRGaWxlKHBhdGgpO1xuICAgIC8vIFRoZSBhY3RpdmUgbm90ZSBpcyBleGNsdWRlZCBmcm9tIGl0cyBvd24gcmVzdWx0cy4gUmUtaW5kZXhpbmcgaXQgbXVzdCBub3RcbiAgICAvLyB0cmlnZ2VyIGEgc2Vjb25kIHF1ZXJ5IGFmdGVyIHRoZSB0eXBpbmcgcXVlcnkgYWxyZWFkeSBzY2hlZHVsZWQgYWJvdmUuXG4gICAgLy8gT3RoZXIgY2hhbmdlZCBub3RlcyBjYW4gYWZmZWN0IHRoZSB2aXNpYmxlIGNhbmRpZGF0ZSBzZXQsIHNvIGNvYWxlc2NlXG4gICAgLy8gdGhvc2UgaW50byBvbmUgcmVmcmVzaCBhZnRlciB0aGlzIHVwZGF0ZSBiYXRjaC5cbiAgICBjb25zdCBhY3RpdmVQYXRoID0gdGhpcy5sYXRlc3RNYXJrZG93blZpZXc/LmZpbGU/LnBhdGg7XG4gICAgaWYgKHBhdGhzLnNvbWUoKHBhdGgpID0+IHBhdGggIT09IGFjdGl2ZVBhdGgpKSB0aGlzLnJlZnJlc2hDdXJyZW50UXVlcnkoKTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgdXBkYXRlQ2hhbmdlZEZpbGUoZmlsZVBhdGg6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICh0aGlzLmluZGV4aW5nIHx8ICF0aGlzLmluZGV4LmlzUmVhZHkodGhpcy5pbmRleElkZW50aXR5KCkpKSByZXR1cm47XG4gICAgY29uc3QgZmlsZSA9IHRoaXMuYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aChmaWxlUGF0aCk7XG4gICAgY29uc3QgcmV0YWluZWQgPSB0aGlzLmluZGV4LmNodW5rcy5maWx0ZXIoKGNodW5rKSA9PiBjaHVuay5maWxlUGF0aCAhPT0gZmlsZVBhdGgpO1xuICAgIHRyeSB7XG4gICAgICBpZiAoIShmaWxlIGluc3RhbmNlb2YgVEZpbGUpIHx8IGZpbGUuZXh0ZW5zaW9uICE9PSBcIm1kXCIgfHwgdGhpcy5pc0V4Y2x1ZGVkKGZpbGUucGF0aCkpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5jb21taXRJbmRleCh0aGlzLmluZGV4SWRlbnRpdHkoKSwgWy4uLnJldGFpbmVkXSk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIGNvbnN0IGluZGV4ZWQgPSBhd2FpdCB0aGlzLmluZGV4RmlsZXMoW2ZpbGVdLCB0aGlzLmluZGV4LnJldXNhYmxlQnlJZCh0aGlzLmluZGV4SWRlbnRpdHkoKSksICgpID0+IGZhbHNlLCBmYWxzZSk7XG4gICAgICBhd2FpdCB0aGlzLmNvbW1pdEluZGV4KHRoaXMuaW5kZXhJZGVudGl0eSgpLCBbLi4ucmV0YWluZWQsIC4uLmluZGV4ZWRdKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5wcmVzZW50KHsga2luZDogXCJxdWVyeS1mYWlsZWRcIiwgbWVzc2FnZTogYFx1NTg5RVx1OTFDRlx1N0QyMlx1NUYxNVx1NTkzMVx1OEQyNVx1RkYxQSR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpfWAgfSwgdGhpcy5yZXN1bHRzKTtcbiAgICB9XG4gIH1cblxuICBhc3luYyByZWJ1aWxkSW5kZXgoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKHRoaXMuaW5kZXhpbmcpIHJldHVybjtcbiAgICBjb25zdCBpZGVudGl0eSA9IHRoaXMuaW5kZXhJZGVudGl0eSgpO1xuICAgIGNvbnN0IGhhZFVzYWJsZUluZGV4ID0gdGhpcy5pbmRleC5pc1JlYWR5KGlkZW50aXR5KTtcbiAgICB0aGlzLmluZGV4aW5nID0gdHJ1ZTtcbiAgICBjb25zdCBidWlsZFRva2VuID0gdGhpcy5idWlsZENhbmNlbGxhdGlvbi5zdGFydEJ1aWxkKCk7XG4gICAgdGhpcy5xdWVyeUdhdGUuaW52YWxpZGF0ZSgpO1xuICAgIGNvbnN0IGZpbGVzID0gdGhpcy5hcHAudmF1bHQuZ2V0TWFya2Rvd25GaWxlcygpLmZpbHRlcigoZmlsZSkgPT4gIXRoaXMuaXNFeGNsdWRlZChmaWxlLnBhdGgpKTtcbiAgICB0aGlzLnByZXNlbnRJbmRleFByb2dyZXNzKHsgcGhhc2U6IFwic2Nhbm5pbmdcIiwgY3VycmVudDogMCwgdG90YWw6IGZpbGVzLmxlbmd0aCwgbGFiZWw6IFwiXHU2QjYzXHU1NzI4XHU2MjZCXHU2M0NGXHU3QjE0XHU4QkIwXCIgfSk7XG4gICAgdHJ5IHtcbiAgICAgIC8vIFRoZSBvbGQgUGVyc2lzdGVudEluZGV4IGlzIGRlbGliZXJhdGVseSB1bnRvdWNoZWQgdW50aWwgdGhpcyBjb21wbGV0ZVxuICAgICAgLy8gY2FuZGlkYXRlIGhhcyBiZWVuIGVtYmVkZGVkLCBjaGVja2VkIGZvciBjYW5jZWxsYXRpb24sIGFuZCBzYXZlZC5cbiAgICAgIGNvbnN0IGNodW5rcyA9IGF3YWl0IHRoaXMuaW5kZXhGaWxlcyhmaWxlcywgdGhpcy5pbmRleC5yZXVzYWJsZUJ5SWQoaWRlbnRpdHkpLCAoKSA9PiB0aGlzLmJ1aWxkQ2FuY2VsbGF0aW9uLmlzQnVpbGRDYW5jZWxsZWQoYnVpbGRUb2tlbiksIHRydWUpO1xuICAgICAgdGhpcy5idWlsZENhbmNlbGxhdGlvbi5hc3NlcnRCdWlsZENhbkNvbnRpbnVlKGJ1aWxkVG9rZW4pO1xuICAgICAgdGhpcy5wcmVzZW50SW5kZXhQcm9ncmVzcyh7IHBoYXNlOiBcInNhdmluZ1wiLCBjdXJyZW50OiBjaHVua3MubGVuZ3RoLCB0b3RhbDogY2h1bmtzLmxlbmd0aCwgbGFiZWw6IFwiXHU2QjYzXHU1NzI4XHU0RkREXHU1QjU4XHU3RDIyXHU1RjE1XCIgfSk7XG4gICAgICBhd2FpdCB0aGlzLmNvbW1pdEluZGV4KGlkZW50aXR5LCBjaHVua3MsIGJ1aWxkVG9rZW4pO1xuICAgICAgdGhpcy5zeW5jUXVlcnlBdmFpbGFiaWxpdHkoKTtcbiAgICAgIGNvbnN0IHNjaGVkdWxlID0gdGhpcy5saWZlY3ljbGUuaW5kZXhSZWFkeSgpO1xuICAgICAgdGhpcy5wcmVzZW50KHsga2luZDogXCJjb21wbGV0ZVwiLCBtZXNzYWdlOiBgXHU3RDIyXHU1RjE1XHU1QjhDXHU2MjEwXHVGRjFBJHtjaHVua3MubGVuZ3RofSBcdTRFMkFcdTcyNDdcdTZCQjVgIH0sIHRoaXMucmVzdWx0cyk7XG4gICAgICAvLyBUaGUgaW5kZXggaGFzIGNvbW1pdHRlZDsgYWxsb3cgdGhlIHJlcXVpcmVkIGluZGV4LXJlYWR5IHF1ZXJ5IHRvIHJ1blxuICAgICAgLy8gbm93IHJhdGhlciB0aGFuIG1ha2luZyBpdCB3YWl0IGZvciBmaW5hbGx5IG9yIGFub3RoZXIga2V5c3Ryb2tlLlxuICAgICAgdGhpcy5pbmRleGluZyA9IGZhbHNlO1xuICAgICAgaWYgKHNjaGVkdWxlKSB0aGlzLnNjaGVkdWxlUXVlcnlGcm9tQ3VycmVudEVkaXRvcihzY2hlZHVsZSk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIEluZGV4QnVpbGRDYW5jZWxsZWQpIHtcbiAgICAgICAgdGhpcy5wcmVzZW50KHtcbiAgICAgICAgICBraW5kOiBcImluZGV4LWNhbmNlbGxlZFwiLFxuICAgICAgICAgIG1lc3NhZ2U6IGhhZFVzYWJsZUluZGV4ID8gXCJcdTVERjJcdTUzRDZcdTZEODhcdTkxQ0RcdTVFRkFcdUZGMENcdTZCNjNcdTU3MjhcdTdFRTdcdTdFRURcdTRGN0ZcdTc1MjhcdTUzOUZcdTY3MDlcdTdEMjJcdTVGMTVcIiA6IFwiXHU1REYyXHU1M0Q2XHU2RDg4XHUzMDAyXHU1QzFBXHU2NzJBXHU1RUZBXHU3QUNCXHU3N0U1XHU4QkM2XHU1RTkzXHU3RDIyXHU1RjE1XCIsXG4gICAgICAgICAgaW5kZXhBY3Rpb246IGhhZFVzYWJsZUluZGV4ID8gXCJyZWJ1aWxkXCIgOiBcImJ1aWxkXCJcbiAgICAgICAgfSwgaGFkVXNhYmxlSW5kZXggPyB0aGlzLnJlc3VsdHMgOiBbXSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjb25zdCB1bmF2YWlsYWJsZSA9IGVycm9yIGluc3RhbmNlb2YgRW1iZWRkaW5nRXJyb3IgJiYgZXJyb3Iua2luZCA9PT0gXCJjb25uZWN0aW9uXCI7XG4gICAgICAgIHRoaXMucHJlc2VudCh7XG4gICAgICAgICAga2luZDogXCJpbmRleC1mYWlsZWRcIixcbiAgICAgICAgICBtZXNzYWdlOiB1bmF2YWlsYWJsZSA/IFwiXHU1RUZBXHU1RTkzXHU1OTMxXHU4RDI1XHVGRjFBT2xsYW1hIFx1NEUwRFx1NTNFRlx1NzUyOFwiIDogYFx1NUVGQVx1NUU5M1x1NTkzMVx1OEQyNVx1RkYxQSR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpfWAsXG4gICAgICAgICAgaW5kZXhBY3Rpb246IFwicmV0cnlcIlxuICAgICAgICB9LCBoYWRVc2FibGVJbmRleCA/IHRoaXMucmVzdWx0cyA6IFtdKTtcbiAgICAgIH1cbiAgICB9IGZpbmFsbHkge1xuICAgICAgdGhpcy5idWlsZENhbmNlbGxhdGlvbi5maW5pc2hCdWlsZChidWlsZFRva2VuKTtcbiAgICAgIHRoaXMuaW5kZXhpbmcgPSBmYWxzZTtcbiAgICAgIGlmICh0aGlzLmluZGV4LmlzUmVhZHkodGhpcy5pbmRleElkZW50aXR5KCkpICYmIHRoaXMucGVuZGluZ0NoYW5nZWRQYXRocy5zaXplKSB2b2lkIHRoaXMuZmx1c2hGaWxlVXBkYXRlcygpO1xuICAgICAgaWYgKCF0aGlzLmluZGV4LmlzUmVhZHkodGhpcy5pbmRleElkZW50aXR5KCkpKSB0aGlzLnBlbmRpbmdDaGFuZ2VkUGF0aHMuY2xlYXIoKTtcbiAgICB9XG4gIH1cblxuICBjYW5jZWxJbmRleCgpOiB2b2lkIHtcbiAgICBpZiAoIXRoaXMuaW5kZXhpbmcpIHJldHVybjtcbiAgICB0aGlzLmJ1aWxkQ2FuY2VsbGF0aW9uLmNhbmNlbEN1cnJlbnRCdWlsZCgpO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBpbmRleEZpbGVzKGZpbGVzOiBURmlsZVtdLCByZXVzYWJsZTogTWFwPHN0cmluZywgSW5kZXhlZENodW5rPiwgY2FuY2VsbGVkOiAoKSA9PiBib29sZWFuLCByZXBvcnRQcm9ncmVzczogYm9vbGVhbik6IFByb21pc2U8SW5kZXhlZENodW5rW10+IHtcbiAgICBjb25zdCBwZW5kaW5nOiBDaHVua1tdID0gW107XG4gICAgY29uc3Qgb3V0cHV0OiBJbmRleGVkQ2h1bmtbXSA9IFtdO1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgZmlsZXMubGVuZ3RoOyBpKyspIHtcbiAgICAgIGlmIChjYW5jZWxsZWQoKSkgdGhyb3cgbmV3IEluZGV4QnVpbGRDYW5jZWxsZWQoKTtcbiAgICAgIGNvbnN0IGZpbGUgPSBmaWxlc1tpXTtcbiAgICAgIGNvbnN0IG1hcmtkb3duID0gYXdhaXQgdGhpcy5hcHAudmF1bHQuY2FjaGVkUmVhZChmaWxlKTtcbiAgICAgIGlmIChjYW5jZWxsZWQoKSkgdGhyb3cgbmV3IEluZGV4QnVpbGRDYW5jZWxsZWQoKTtcbiAgICAgIGNvbnN0IGNodW5rcyA9IGNodW5rTWFya2Rvd24oZmlsZS5wYXRoLCBtYXJrZG93biwge1xuICAgICAgICB0YXJnZXRMZW5ndGg6IHRoaXMuc2V0dGluZ3MuY2h1bmtUYXJnZXRMZW5ndGgsXG4gICAgICAgIG1heExlbmd0aDogdGhpcy5zZXR0aW5ncy5jaHVua01heExlbmd0aCxcbiAgICAgICAgbWluTGVuZ3RoOiB0aGlzLnNldHRpbmdzLmNodW5rTWluTGVuZ3RoXG4gICAgICB9KTtcbiAgICAgIGZvciAoY29uc3QgY2h1bmsgb2YgY2h1bmtzKSB7XG4gICAgICAgIGNvbnN0IGNhY2hlZCA9IHJldXNhYmxlLmdldChjaHVuay5pZCk7XG4gICAgICAgIGlmIChjYWNoZWQgJiYgY2FjaGVkLmNvbnRlbnRIYXNoID09PSBjaHVuay5jb250ZW50SGFzaCkgb3V0cHV0LnB1c2goeyAuLi5jaHVuaywgdmVjdG9yOiBjYWNoZWQudmVjdG9yIH0pO1xuICAgICAgICBlbHNlIHBlbmRpbmcucHVzaChjaHVuayk7XG4gICAgICB9XG4gICAgICBpZiAocmVwb3J0UHJvZ3Jlc3MpIHRoaXMucHJlc2VudEluZGV4UHJvZ3Jlc3MoeyBwaGFzZTogXCJzY2FubmluZ1wiLCBjdXJyZW50OiBpICsgMSwgdG90YWw6IGZpbGVzLmxlbmd0aCwgbGFiZWw6IFwiXHU2QjYzXHU1NzI4XHU2MjZCXHU2M0NGXHU3QjE0XHU4QkIwXCIgfSk7XG4gICAgICBpZiAoaSAlIDggPT09IDcpIGF3YWl0IHRoaXMueWllbGRUb1VpKCk7XG4gICAgfVxuICAgIGZvciAobGV0IHN0YXJ0ID0gMDsgc3RhcnQgPCBwZW5kaW5nLmxlbmd0aDsgc3RhcnQgKz0gdGhpcy5zZXR0aW5ncy5lbWJlZGRpbmdCYXRjaFNpemUpIHtcbiAgICAgIGlmIChjYW5jZWxsZWQoKSkgdGhyb3cgbmV3IEluZGV4QnVpbGRDYW5jZWxsZWQoKTtcbiAgICAgIGNvbnN0IGJhdGNoID0gcGVuZGluZy5zbGljZShzdGFydCwgc3RhcnQgKyB0aGlzLnNldHRpbmdzLmVtYmVkZGluZ0JhdGNoU2l6ZSk7XG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMucHJvdmlkZXIoKS5lbWJlZERvY3VtZW50cyhiYXRjaC5tYXAoZW1iZWRkaW5nVGV4dCkpO1xuICAgICAgaWYgKGNhbmNlbGxlZCgpKSB0aHJvdyBuZXcgSW5kZXhCdWlsZENhbmNlbGxlZCgpO1xuICAgICAgb3V0cHV0LnB1c2goLi4uYmF0Y2gubWFwKChjaHVuaywgaW5kZXgpID0+ICh7IC4uLmNodW5rLCB2ZWN0b3I6IHJlc3BvbnNlLnZlY3RvcnNbaW5kZXhdIH0pKSk7XG4gICAgICBpZiAocmVwb3J0UHJvZ3Jlc3MpIHRoaXMucHJlc2VudEluZGV4UHJvZ3Jlc3MoeyBwaGFzZTogXCJlbWJlZGRpbmdcIiwgY3VycmVudDogTWF0aC5taW4oc3RhcnQgKyBiYXRjaC5sZW5ndGgsIHBlbmRpbmcubGVuZ3RoKSwgdG90YWw6IHBlbmRpbmcubGVuZ3RoLCBsYWJlbDogXCJcdTZCNjNcdTU3MjhcdTc1MUZcdTYyMTBcdTU0MTFcdTkxQ0ZcIiB9KTtcbiAgICAgIGF3YWl0IHRoaXMueWllbGRUb1VpKCk7XG4gICAgfVxuICAgIGlmIChjYW5jZWxsZWQoKSkgdGhyb3cgbmV3IEluZGV4QnVpbGRDYW5jZWxsZWQoKTtcbiAgICByZXR1cm4gb3V0cHV0O1xuICB9XG5cbiAgcHJpdmF0ZSBwcmVzZW50SW5kZXhQcm9ncmVzcyhwcm9ncmVzczogSW5kZXhQcm9ncmVzcyk6IHZvaWQge1xuICAgIHRoaXMucHJlc2VudCh7IGtpbmQ6IFwiaW5kZXhpbmdcIiwgbWVzc2FnZTogcHJvZ3Jlc3MubGFiZWwsIHByb2dyZXNzIH0sIHRoaXMucmVzdWx0cyk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGNvbW1pdEluZGV4KGlkZW50aXR5OiBJbmRleElkZW50aXR5LCBjaHVua3M6IEluZGV4ZWRDaHVua1tdLCBidWlsZFRva2VuPzogQnVpbGRDYW5jZWxsYXRpb25Ub2tlbik6IFByb21pc2U8dm9pZD4ge1xuICAgIHRoaXMuYnVpbGRDYW5jZWxsYXRpb24uYXNzZXJ0Q29tbWl0Q2FuUHJvY2VlZChidWlsZFRva2VuKTtcbiAgICBjb25zdCBjYW5kaWRhdGUgPSB0aGlzLmluZGV4LnJlcGxhY2VtZW50KGlkZW50aXR5LCBjaHVua3MpO1xuICAgIGF3YWl0IHRoaXMuc2F2ZURhdGEoeyBzZXR0aW5nczogdGhpcy5zZXR0aW5ncywgaW5kZXg6IGNhbmRpZGF0ZSB9KTtcbiAgICAvLyBzYXZlRGF0YSBjYW4geWllbGQgdG8gT2JzaWRpYW4gbGlmZWN5Y2xlIGNhbGxiYWNrczsgbmV2ZXIgdXBkYXRlIHRoZVxuICAgIC8vIGluLW1lbW9yeSBpbmRleCBhZnRlciBwbHVnaW4gdW5sb2FkLCBldmVuIGZvciBhbiBpbmNyZW1lbnRhbCBvcGVyYXRpb24uXG4gICAgdGhpcy5idWlsZENhbmNlbGxhdGlvbi5hc3NlcnRQbHVnaW5BY3RpdmUoKTtcbiAgICB0aGlzLmluZGV4LmNvbW1pdChjYW5kaWRhdGUpO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyB5aWVsZFRvVWkoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgbmV3IFByb21pc2U8dm9pZD4oKHJlc29sdmUpID0+IHdpbmRvdy5zZXRUaW1lb3V0KHJlc29sdmUsIDApKTtcbiAgfVxuXG4gIHByaXZhdGUgaXNFeGNsdWRlZChwYXRoOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgICByZXR1cm4gZXhjbHVkZWREaXJlY3RvcnlMaXN0KHRoaXMuc2V0dGluZ3MuZXhjbHVkZWREaXJlY3Rvcmllcykuc29tZSgoZGlyZWN0b3J5KSA9PiBwYXRoID09PSBkaXJlY3RvcnkgfHwgcGF0aC5zdGFydHNXaXRoKGAke2RpcmVjdG9yeX0vYCkpO1xuICB9XG5cbiAgcHJpdmF0ZSBzaG93SW5kZXhSZXF1aXJlbWVudChtZXNzYWdlPzogc3RyaW5nKTogdm9pZCB7XG4gICAgaWYgKHRoaXMuaW5kZXhpbmcgfHwgdGhpcy5zdGF0ZS5raW5kID09PSBcImluZGV4LWNhbmNlbGxlZFwiIHx8IHRoaXMuc3RhdGUua2luZCA9PT0gXCJpbmRleC1mYWlsZWRcIikgcmV0dXJuO1xuICAgIGNvbnN0IGxpZmVjeWNsZSA9IHRoaXMuaW5kZXgubGlmZWN5Y2xlKHRoaXMuaW5kZXhJZGVudGl0eSgpKTtcbiAgICBpZiAobGlmZWN5Y2xlID09PSBcInJlYWR5XCIpIHJldHVybjtcbiAgICBpZiAobGlmZWN5Y2xlID09PSBcImluY29tcGF0aWJsZVwiKSB7XG4gICAgICB0aGlzLnByZXNlbnQoeyBraW5kOiBcImluZGV4LW5lZWRlZFwiLCBtZXNzYWdlOiBtZXNzYWdlID8/IFwiXHU3RDIyXHU1RjE1XHU5MTREXHU3RjZFXHU1REYyXHU1M0Q4XHU1MzE2XHVGRjBDXHU4QkY3XHU5MUNEXHU1RUZBXHU3RDIyXHU1RjE1XCIsIGluZGV4QWN0aW9uOiBcInJlYnVpbGRcIiB9LCBbXSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHRoaXMucHJlc2VudCh7XG4gICAgICBraW5kOiBcImluZGV4LW5lZWRlZFwiLFxuICAgICAgbWVzc2FnZTogXCJcdTVDMUFcdTY3MkFcdTVFRkFcdTdBQ0JcdTc3RTVcdThCQzZcdTVFOTNcdTdEMjJcdTVGMTVcIixcbiAgICAgIGRldGFpbDogXCJcdTVFRkFcdTdBQ0JcdTdEMjJcdTVGMTVcdTU0MEVcdUZGMENTaWRlIEdyZXAgXHU2MjREXHU4MEZEXHU0RUNFXHU1REYyXHU2NzA5XHU3QjE0XHU4QkIwXHU0RTJEXHU1M0VDXHU1NkRFXHU3NkY4XHU1MTczXHU3MjQ3XHU2QkI1XHUzMDAyXCIsXG4gICAgICBpbmRleEFjdGlvbjogXCJidWlsZFwiXG4gICAgfSwgW10pO1xuICB9XG5cbiAgcHJpdmF0ZSBwcmVzZW50KHN0YXRlOiBTaWRlYmFyU3RhdGUsIHJlc3VsdHM6IFNlYXJjaFJlc3VsdFtdID0gdGhpcy5yZXN1bHRzKTogdm9pZCB7XG4gICAgdGhpcy5zdGF0ZSA9IHN0YXRlO1xuICAgIHRoaXMucmVzdWx0cyA9IHJlc3VsdHM7XG4gICAgdGhpcy5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShTSURFX0dSRVBfVklFV19UWVBFKS5mb3JFYWNoKChsZWFmKSA9PiAobGVhZi52aWV3IGFzIHVua25vd24gYXMgU2lkZUdyZXBWaWV3KS5zaG93UmVzdWx0cyhzdGF0ZSwgcmVzdWx0cykpO1xuICB9XG5cbiAgYXN5bmMgYWN0aXZhdGVWaWV3KCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IGV4aXN0aW5nID0gdGhpcy5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShTSURFX0dSRVBfVklFV19UWVBFKVswXTtcbiAgICBjb25zdCBsZWFmOiBXb3Jrc3BhY2VMZWFmID0gZXhpc3RpbmcgPz8gdGhpcy5hcHAud29ya3NwYWNlLmdldFJpZ2h0TGVhZihmYWxzZSkhO1xuICAgIGF3YWl0IGxlYWYuc2V0Vmlld1N0YXRlKHsgdHlwZTogU0lERV9HUkVQX1ZJRVdfVFlQRSwgYWN0aXZlOiB0cnVlIH0pO1xuICAgIHRoaXMuYXBwLndvcmtzcGFjZS5yZXZlYWxMZWFmKGxlYWYpO1xuICAgIChsZWFmLnZpZXcgYXMgdW5rbm93biBhcyBTaWRlR3JlcFZpZXcpLnNob3dSZXN1bHRzKHRoaXMuc3RhdGUsIHRoaXMucmVzdWx0cyk7XG4gICAgaWYgKGV4aXN0aW5nKSB0aGlzLnNpZGViYXJPcGVuZWQoKTtcbiAgfVxuXG4gIHNpZGViYXJPcGVuZWQoKTogdm9pZCB7XG4gICAgY29uc3Qgc2NoZWR1bGUgPSB0aGlzLmxpZmVjeWNsZS5zaWRlYmFyT3BlbmVkKCk7XG4gICAgaWYgKHNjaGVkdWxlKSB0aGlzLnNjaGVkdWxlUXVlcnlGcm9tQ3VycmVudEVkaXRvcihzY2hlZHVsZSk7XG4gIH1cblxuICByZWZyZXNoQ3VycmVudFF1ZXJ5KCk6IHZvaWQge1xuICAgIGlmICghdGhpcy5pbmRleC5pc1JlYWR5KHRoaXMuaW5kZXhJZGVudGl0eSgpKSB8fCB0aGlzLmluZGV4aW5nKSByZXR1cm47XG4gICAgY29uc3Qgc2NoZWR1bGUgPSB0aGlzLmxpZmVjeWNsZS5zaWRlYmFyT3BlbmVkKCk7XG4gICAgaWYgKHNjaGVkdWxlKSB0aGlzLnNjaGVkdWxlUXVlcnlGcm9tQ3VycmVudEVkaXRvcihzY2hlZHVsZSk7XG4gIH1cblxuICBhc3luYyBvcGVuUmVzdWx0KHJlc3VsdDogU2VhcmNoUmVzdWx0KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgZmlsZSA9IHRoaXMuYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aChyZXN1bHQuZmlsZVBhdGgpO1xuICAgIGlmICghKGZpbGUgaW5zdGFuY2VvZiBURmlsZSkpIHJldHVybjtcbiAgICBjb25zdCBsZWFmID0gdGhpcy5hcHAud29ya3NwYWNlLmdldExlYWYoZmFsc2UpO1xuICAgIGF3YWl0IGxlYWYub3BlbkZpbGUoZmlsZSwgeyBhY3RpdmU6IHRydWUgfSk7XG4gICAgaWYgKGxlYWYudmlldyBpbnN0YW5jZW9mIE1hcmtkb3duVmlldykgbGVhZi52aWV3LmVkaXRvci5zZXRDdXJzb3IoeyBsaW5lOiByZXN1bHQuc3RhcnRMaW5lIC0gMSwgY2g6IDAgfSk7XG4gIH1cblxuICBpbnNlcnRMaW5rKHJlc3VsdDogU2VhcmNoUmVzdWx0KTogdm9pZCB7XG4gICAgY29uc3QgZWRpdG9yID0gdGhpcy5sYXRlc3RNYXJrZG93blZpZXc/LmVkaXRvciA/PyB0aGlzLmFwcC53b3Jrc3BhY2UuZ2V0QWN0aXZlVmlld09mVHlwZShNYXJrZG93blZpZXcpPy5lZGl0b3I7XG4gICAgaWYgKGVkaXRvcikgZWRpdG9yLnJlcGxhY2VTZWxlY3Rpb24odGhpcy5saW5rTWFya3VwKHJlc3VsdCkpO1xuICB9XG5cbiAgaW5zZXJ0UXVvdGUocmVzdWx0OiBTZWFyY2hSZXN1bHQsIHNlbGVjdGVkVGV4dD86IHN0cmluZyk6IHZvaWQge1xuICAgIGNvbnN0IGVkaXRvciA9IHRoaXMubGF0ZXN0TWFya2Rvd25WaWV3Py5lZGl0b3IgPz8gdGhpcy5hcHAud29ya3NwYWNlLmdldEFjdGl2ZVZpZXdPZlR5cGUoTWFya2Rvd25WaWV3KT8uZWRpdG9yO1xuICAgIGlmICghZWRpdG9yKSByZXR1cm47XG4gICAgZWRpdG9yLnJlcGxhY2VTZWxlY3Rpb24odGhpcy5xdW90ZU1hcmt1cChyZXN1bHQsIHNlbGVjdGVkVGV4dCkpO1xuICB9XG5cbiAgbGlua01hcmt1cChyZXN1bHQ6IFNlYXJjaFJlc3VsdCk6IHN0cmluZyB7XG4gICAgcmV0dXJuIGBbWyR7dGhpcy5saW5rVGFyZ2V0KHJlc3VsdCl9XV1gO1xuICB9XG5cbiAgcXVvdGVNYXJrdXAocmVzdWx0OiBTZWFyY2hSZXN1bHQsIHNlbGVjdGVkVGV4dD86IHN0cmluZyk6IHN0cmluZyB7XG4gICAgY29uc3QgdGV4dCA9IHNlbGVjdGVkVGV4dD8udHJpbSgpIHx8IHJlc3VsdC50ZXh0O1xuICAgIGNvbnN0IHF1b3RlZCA9IHRleHQuc3BsaXQoXCJcXG5cIikubWFwKChsaW5lKSA9PiBgPiAke2xpbmV9YCkuam9pbihcIlxcblwiKTtcbiAgICByZXR1cm4gYCR7cXVvdGVkfVxcbj5cXG4+IFx1MjAxNFx1MjAxNCAke3RoaXMubGlua01hcmt1cChyZXN1bHQpfWA7XG4gIH1cblxuICBleHBhbnNpb25Qb2xpY3koKTogeyBjb3VudDogbnVtYmVyOyB0aHJlc2hvbGRFbmFibGVkOiBib29sZWFuOyB0aHJlc2hvbGQ6IG51bWJlciB9IHtcbiAgICByZXR1cm4ge1xuICAgICAgY291bnQ6IHRoaXMuc2V0dGluZ3MuYXV0b0V4cGFuZENvdW50LFxuICAgICAgdGhyZXNob2xkRW5hYmxlZDogdGhpcy5zZXR0aW5ncy5hdXRvRXhwYW5kVGhyZXNob2xkRW5hYmxlZCxcbiAgICAgIHRocmVzaG9sZDogdGhpcy5zZXR0aW5ncy5hdXRvRXhwYW5kVGhyZXNob2xkXG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgbGlua1RhcmdldChyZXN1bHQ6IFNlYXJjaFJlc3VsdCk6IHN0cmluZyB7XG4gICAgY29uc3QgcGF0aCA9IHJlc3VsdC5maWxlUGF0aC5yZXBsYWNlKC9cXC5tZCQvaSwgXCJcIik7XG4gICAgY29uc3QgaGVhZGluZyA9IHJlc3VsdC5icmVhZGNydW1iLmF0KC0xKTtcbiAgICByZXR1cm4gaGVhZGluZyA/IGAke3BhdGh9IyR7aGVhZGluZ31gIDogcGF0aDtcbiAgfVxufVxuIiwgImV4cG9ydCBjb25zdCBDSFVOS0VSX1ZFUlNJT04gPSBcIjFcIjtcblxuZXhwb3J0IGludGVyZmFjZSBDaHVuayB7XG4gIGlkOiBzdHJpbmc7XG4gIGNvbnRlbnRIYXNoOiBzdHJpbmc7XG4gIGZpbGVQYXRoOiBzdHJpbmc7XG4gIGZpbGVOYW1lOiBzdHJpbmc7XG4gIGJyZWFkY3J1bWI6IHN0cmluZ1tdO1xuICB0ZXh0OiBzdHJpbmc7XG4gIHN0YXJ0TGluZTogbnVtYmVyO1xuICBlbmRMaW5lOiBudW1iZXI7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgSW5kZXhlZENodW5rIGV4dGVuZHMgQ2h1bmsge1xuICB2ZWN0b3I6IG51bWJlcltdO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIEluZGV4SWRlbnRpdHkge1xuICBtb2RlbDogc3RyaW5nO1xuICBkaW1lbnNpb25zOiBudW1iZXI7XG4gIGNodW5rZXJWZXJzaW9uOiBzdHJpbmc7XG4gIGNodW5rVGFyZ2V0TGVuZ3RoOiBudW1iZXI7XG4gIGNodW5rTWF4TGVuZ3RoOiBudW1iZXI7XG4gIGNodW5rTWluTGVuZ3RoOiBudW1iZXI7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgUGVyc2lzdGVudEluZGV4RGF0YSB7XG4gIC8qKiBTY2hlbWEgMiByZWNvcmRzIGEgc3VjY2Vzc2Z1bCBmdWxsIGJ1aWxkIGluZGVwZW5kZW50bHkgZnJvbSBjaHVuayBjb3VudC4gKi9cbiAgc2NoZW1hVmVyc2lvbj86IG51bWJlcjtcbiAgaWRlbnRpdHk6IEluZGV4SWRlbnRpdHk7XG4gIGNodW5rczogSW5kZXhlZENodW5rW107XG4gIHVwZGF0ZWRBdDogbnVtYmVyO1xuICBpbml0aWFsaXplZD86IGJvb2xlYW47XG59XG5cbmV4cG9ydCB0eXBlIEluZGV4TGlmZWN5Y2xlID0gXCJ1bmluaXRpYWxpemVkXCIgfCBcInJlYWR5XCIgfCBcImluY29tcGF0aWJsZVwiIHwgXCJidWlsZGluZ1wiIHwgXCJjYW5jZWxsZWRcIiB8IFwiZmFpbGVkXCI7XG5cbmV4cG9ydCBpbnRlcmZhY2UgSW5kZXhQcm9ncmVzcyB7XG4gIHBoYXNlOiBcInNjYW5uaW5nXCIgfCBcImVtYmVkZGluZ1wiIHwgXCJzYXZpbmdcIjtcbiAgY3VycmVudDogbnVtYmVyO1xuICB0b3RhbDogbnVtYmVyO1xuICBsYWJlbDogc3RyaW5nO1xufVxuXG5leHBvcnQgdHlwZSBTaWRlYmFyU3RhdHVzS2luZCA9XG4gIHwgXCJ3YWl0aW5nLWlucHV0XCJcbiAgfCBcIndhaXRpbmctZGVib3VuY2VcIlxuICB8IFwibG9hZGluZy1tb2RlbFwiXG4gIHwgXCJxdWVyeWluZ1wiXG4gIHwgXCJpbmRleGluZ1wiXG4gIHwgXCJpbmRleC1uZWVkZWRcIlxuICB8IFwiaW5kZXgtZmFpbGVkXCJcbiAgfCBcImluZGV4LWNhbmNlbGxlZFwiXG4gIHwgXCJjb21wbGV0ZVwiXG4gIHwgXCJvbGxhbWEtdW5hdmFpbGFibGVcIlxuICB8IFwiaW5kZXgtZW1wdHlcIlxuICB8IFwicXVlcnktZmFpbGVkXCI7XG5cbmV4cG9ydCBpbnRlcmZhY2UgU2lkZWJhclN0YXRlIHtcbiAga2luZDogU2lkZWJhclN0YXR1c0tpbmQ7XG4gIG1lc3NhZ2U6IHN0cmluZztcbiAgZGV0YWlsPzogc3RyaW5nO1xuICBsYXRlbmN5TXM/OiBudW1iZXI7XG4gIHByb2dyZXNzPzogSW5kZXhQcm9ncmVzcztcbiAgLyoqIFRoZSB2aWV3IGRlcml2ZXMgaXRzIENUQSBzb2xlbHkgZnJvbSB0aGlzIHN0cnVjdHVyZWQgc3RhdGUuICovXG4gIGluZGV4QWN0aW9uPzogXCJidWlsZFwiIHwgXCJyZWJ1aWxkXCIgfCBcInJldHJ5XCI7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgU2VhcmNoUmVzdWx0IGV4dGVuZHMgSW5kZXhlZENodW5rIHtcbiAgc2ltaWxhcml0eTogbnVtYmVyO1xufVxuIiwgImltcG9ydCB7IENIVU5LRVJfVkVSU0lPTiwgQ2h1bmsgfSBmcm9tIFwiLi90eXBlc1wiO1xuXG5leHBvcnQgaW50ZXJmYWNlIENodW5rZXJPcHRpb25zIHtcbiAgdGFyZ2V0TGVuZ3RoOiBudW1iZXI7XG4gIG1heExlbmd0aDogbnVtYmVyO1xuICBtaW5MZW5ndGg6IG51bWJlcjtcbn1cblxuaW50ZXJmYWNlIFBhcmFncmFwaCB7XG4gIHRleHQ6IHN0cmluZztcbiAgc3RhcnRMaW5lOiBudW1iZXI7XG4gIGVuZExpbmU6IG51bWJlcjtcbiAgYnJlYWRjcnVtYjogc3RyaW5nW107XG59XG5cbi8qKiBBIGRldGVybWluaXN0aWMgbm9uLWNyeXB0b2dyYXBoaWMgZmluZ2VycHJpbnQsIGFkZXF1YXRlIGZvciBjYWNoZSBpZGVudGl0eS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzdGFibGVIYXNoKHZhbHVlOiBzdHJpbmcpOiBzdHJpbmcge1xuICBsZXQgYSA9IDB4ODExYzlkYzU7XG4gIGxldCBiID0gMHg5ZTM3NzliOTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCB2YWx1ZS5sZW5ndGg7IGkrKykge1xuICAgIGEgPSBNYXRoLmltdWwoYSBeIHZhbHVlLmNoYXJDb2RlQXQoaSksIDB4MDEwMDAxOTMpO1xuICAgIGIgPSBNYXRoLmltdWwoYiBeIHZhbHVlLmNoYXJDb2RlQXQoaSksIDB4ODVlYmNhNmIpO1xuICB9XG4gIHJldHVybiBgJHsoYSA+Pj4gMCkudG9TdHJpbmcoMTYpLnBhZFN0YXJ0KDgsIFwiMFwiKX0keyhiID4+PiAwKS50b1N0cmluZygxNikucGFkU3RhcnQoOCwgXCIwXCIpfWA7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBlbWJlZGRpbmdUZXh0KGNodW5rOiBDaHVuayk6IHN0cmluZyB7XG4gIGNvbnN0IGhlYWRpbmcgPSBjaHVuay5icmVhZGNydW1iLmxlbmd0aCA/IGNodW5rLmJyZWFkY3J1bWIuam9pbihcIiA+IFwiKSA6IFwiXHVGRjA4XHU2NUUwXHU2ODA3XHU5ODk4XHVGRjA5XCI7XG4gIHJldHVybiBgXHU2NTg3XHU0RUY2XHU1NDBEXHVGRjFBJHtjaHVuay5maWxlTmFtZX1cXG5cdTY4MDdcdTk4OThcdUZGMUEke2hlYWRpbmd9XFxuXHU1MzlGXHU2NTg3XHVGRjFBXFxuJHtjaHVuay50ZXh0fWA7XG59XG5cbmZ1bmN0aW9uIHdpdGhvdXRGcm9udG1hdHRlcihsaW5lczogc3RyaW5nW10pOiBBcnJheTx7IGxpbmU6IHN0cmluZzsgbnVtYmVyOiBudW1iZXIgfT4ge1xuICBpZiAobGluZXNbMF0/LnRyaW0oKSAhPT0gXCItLS1cIikgcmV0dXJuIGxpbmVzLm1hcCgobGluZSwgaSkgPT4gKHsgbGluZSwgbnVtYmVyOiBpICsgMSB9KSk7XG4gIGZvciAobGV0IGkgPSAxOyBpIDwgbGluZXMubGVuZ3RoOyBpKyspIHtcbiAgICBpZiAobGluZXNbaV0udHJpbSgpID09PSBcIi0tLVwiIHx8IGxpbmVzW2ldLnRyaW0oKSA9PT0gXCIuLi5cIikge1xuICAgICAgcmV0dXJuIGxpbmVzLnNsaWNlKGkgKyAxKS5tYXAoKGxpbmUsIGluZGV4KSA9PiAoeyBsaW5lLCBudW1iZXI6IGkgKyBpbmRleCArIDIgfSkpO1xuICAgIH1cbiAgfVxuICByZXR1cm4gbGluZXMubWFwKChsaW5lLCBpKSA9PiAoeyBsaW5lLCBudW1iZXI6IGkgKyAxIH0pKTtcbn1cblxuZnVuY3Rpb24gc3BsaXRMb25nUGFyYWdyYXBoKHBhcmFncmFwaDogUGFyYWdyYXBoLCBtYXhMZW5ndGg6IG51bWJlcik6IFBhcmFncmFwaFtdIHtcbiAgaWYgKHBhcmFncmFwaC50ZXh0Lmxlbmd0aCA8PSBtYXhMZW5ndGgpIHJldHVybiBbcGFyYWdyYXBoXTtcbiAgY29uc3QgcGllY2VzID0gcGFyYWdyYXBoLnRleHQubWF0Y2goL1teXHUzMDAyXHVGRjAxXHVGRjFGIT9cXG5dK1tcdTMwMDJcdUZGMDFcdUZGMUYhP10/fFxcUysvZykgPz8gW3BhcmFncmFwaC50ZXh0XTtcbiAgY29uc3QgcmVzdWx0OiBQYXJhZ3JhcGhbXSA9IFtdO1xuICBsZXQgdGV4dCA9IFwiXCI7XG4gIGZvciAoY29uc3QgcmF3UGllY2Ugb2YgcGllY2VzKSB7XG4gICAgbGV0IHBpZWNlID0gcmF3UGllY2U7XG4gICAgaWYgKHRleHQgJiYgdGV4dC5sZW5ndGggKyBwaWVjZS5sZW5ndGggPiBtYXhMZW5ndGgpIHtcbiAgICAgIHJlc3VsdC5wdXNoKHsgLi4ucGFyYWdyYXBoLCB0ZXh0IH0pO1xuICAgICAgdGV4dCA9IFwiXCI7XG4gICAgfVxuICAgIC8vIEEgc2luZ2xlIHVuYnJva2VuIHRva2VuIGlzIHN0aWxsIHNwbGl0IHRvIGhvbm91ciB0aGUgbWF4aW11bS5cbiAgICB3aGlsZSAocGllY2UubGVuZ3RoID4gbWF4TGVuZ3RoICYmICF0ZXh0KSB7XG4gICAgICByZXN1bHQucHVzaCh7IC4uLnBhcmFncmFwaCwgdGV4dDogcGllY2Uuc2xpY2UoMCwgbWF4TGVuZ3RoKSB9KTtcbiAgICAgIHBpZWNlID0gcGllY2Uuc2xpY2UobWF4TGVuZ3RoKTtcbiAgICB9XG4gICAgdGV4dCArPSBwaWVjZTtcbiAgfVxuICBpZiAodGV4dCkgcmVzdWx0LnB1c2goeyAuLi5wYXJhZ3JhcGgsIHRleHQgfSk7XG4gIHJldHVybiByZXN1bHQ7XG59XG5cbi8qKlxuICogU3BsaXRzIE1hcmtkb3duIGludG8gZGlzcGxheS1jbGVhbiBwYXNzYWdlIGNodW5rcy4gSGVhZGluZyBhbmQgZmlsZSBtZXRhZGF0YSBpc1xuICogaGVsZCBzZXBhcmF0ZWx5LCBzbyBpdCBjYW4gZW5yaWNoIGVtYmVkZGluZ3Mgd2l0aG91dCBwb2xsdXRpbmcgdGhlIGV4Y2VycHQgVUkuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjaHVua01hcmtkb3duKGZpbGVQYXRoOiBzdHJpbmcsIG1hcmtkb3duOiBzdHJpbmcsIG9wdGlvbnM6IENodW5rZXJPcHRpb25zKTogQ2h1bmtbXSB7XG4gIGlmIChvcHRpb25zLm1pbkxlbmd0aCA8IDEgfHwgb3B0aW9ucy50YXJnZXRMZW5ndGggPCBvcHRpb25zLm1pbkxlbmd0aCB8fCBvcHRpb25zLm1heExlbmd0aCA8IG9wdGlvbnMudGFyZ2V0TGVuZ3RoKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiSW52YWxpZCBjaHVuayBsZW5ndGggc2V0dGluZ3NcIik7XG4gIH1cbiAgY29uc3QgZmlsZW5hbWUgPSBmaWxlUGF0aC5zcGxpdChcIi9cIikucG9wKCk/LnJlcGxhY2UoL1xcLm1kJC9pLCBcIlwiKSA/PyBmaWxlUGF0aDtcbiAgY29uc3Qgc291cmNlID0gd2l0aG91dEZyb250bWF0dGVyKG1hcmtkb3duLnJlcGxhY2UoL1xcclxcbi9nLCBcIlxcblwiKS5zcGxpdChcIlxcblwiKSk7XG4gIGNvbnN0IGhlYWRpbmdzOiBzdHJpbmdbXSA9IFtdO1xuICBjb25zdCBwYXJhZ3JhcGhzOiBQYXJhZ3JhcGhbXSA9IFtdO1xuICBsZXQgYnVmZmVyOiBBcnJheTx7IGxpbmU6IHN0cmluZzsgbnVtYmVyOiBudW1iZXIgfT4gPSBbXTtcbiAgY29uc3QgZmx1c2ggPSAoKSA9PiB7XG4gICAgY29uc3QgdGV4dCA9IGJ1ZmZlci5tYXAoKGl0ZW0pID0+IGl0ZW0ubGluZSkuam9pbihcIlxcblwiKS50cmltKCk7XG4gICAgaWYgKHRleHQpIHBhcmFncmFwaHMucHVzaCh7IHRleHQsIHN0YXJ0TGluZTogYnVmZmVyWzBdLm51bWJlciwgZW5kTGluZTogYnVmZmVyLmF0KC0xKSEubnVtYmVyLCBicmVhZGNydW1iOiBbLi4uaGVhZGluZ3NdIH0pO1xuICAgIGJ1ZmZlciA9IFtdO1xuICB9O1xuXG4gIGZvciAoY29uc3QgaXRlbSBvZiBzb3VyY2UpIHtcbiAgICBjb25zdCBtYXRjaCA9IGl0ZW0ubGluZS5tYXRjaCgvXigjezEsNn0pXFxzKyguKz8pXFxzKiMqXFxzKiQvKTtcbiAgICBpZiAobWF0Y2gpIHtcbiAgICAgIGZsdXNoKCk7XG4gICAgICBjb25zdCBkZXB0aCA9IG1hdGNoWzFdLmxlbmd0aDtcbiAgICAgIGhlYWRpbmdzLmxlbmd0aCA9IGRlcHRoIC0gMTtcbiAgICAgIGhlYWRpbmdzW2RlcHRoIC0gMV0gPSBtYXRjaFsyXS50cmltKCk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKCFpdGVtLmxpbmUudHJpbSgpKSBmbHVzaCgpO1xuICAgIGVsc2UgYnVmZmVyLnB1c2goaXRlbSk7XG4gIH1cbiAgZmx1c2goKTtcblxuICBjb25zdCBleHBhbmRlZCA9IHBhcmFncmFwaHMuZmxhdE1hcCgocGFyYWdyYXBoKSA9PiBzcGxpdExvbmdQYXJhZ3JhcGgocGFyYWdyYXBoLCBvcHRpb25zLm1heExlbmd0aCkpO1xuICBjb25zdCBncm91cHM6IFBhcmFncmFwaFtdW10gPSBbXTtcbiAgbGV0IGN1cnJlbnQ6IFBhcmFncmFwaFtdID0gW107XG4gIGxldCBjdXJyZW50TGVuZ3RoID0gMDtcbiAgY29uc3Qgc2FtZUhlYWRpbmcgPSAoYTogUGFyYWdyYXBoLCBiOiBQYXJhZ3JhcGgpID0+IGEuYnJlYWRjcnVtYi5qb2luKFwiXFx1MDAwMFwiKSA9PT0gYi5icmVhZGNydW1iLmpvaW4oXCJcXHUwMDAwXCIpO1xuICBmb3IgKGNvbnN0IHBhcmFncmFwaCBvZiBleHBhbmRlZCkge1xuICAgIGNvbnN0IHNlcGFyYXRvciA9IGN1cnJlbnQubGVuZ3RoID8gMiA6IDA7XG4gICAgaWYgKGN1cnJlbnQubGVuZ3RoICYmICghc2FtZUhlYWRpbmcoY3VycmVudFswXSwgcGFyYWdyYXBoKSB8fCBjdXJyZW50TGVuZ3RoICsgc2VwYXJhdG9yICsgcGFyYWdyYXBoLnRleHQubGVuZ3RoID4gb3B0aW9ucy5tYXhMZW5ndGggfHwgY3VycmVudExlbmd0aCA+PSBvcHRpb25zLnRhcmdldExlbmd0aCkpIHtcbiAgICAgIGdyb3Vwcy5wdXNoKGN1cnJlbnQpO1xuICAgICAgY3VycmVudCA9IFtdO1xuICAgICAgY3VycmVudExlbmd0aCA9IDA7XG4gICAgfVxuICAgIGN1cnJlbnQucHVzaChwYXJhZ3JhcGgpO1xuICAgIGN1cnJlbnRMZW5ndGggKz0gc2VwYXJhdG9yICsgcGFyYWdyYXBoLnRleHQubGVuZ3RoO1xuICB9XG4gIGlmIChjdXJyZW50Lmxlbmd0aCkgZ3JvdXBzLnB1c2goY3VycmVudCk7XG5cbiAgLy8gQSBzaG9ydCB0cmFpbGluZyBncm91cCBpcyBtb3JlIHVzZWZ1bCBtZXJnZWQgd2l0aCBpdHMgY29tcGF0aWJsZSBwcmVkZWNlc3Nvci5cbiAgZm9yIChsZXQgaSA9IGdyb3Vwcy5sZW5ndGggLSAxOyBpID4gMDsgaS0tKSB7XG4gICAgY29uc3QgZ3JvdXAgPSBncm91cHNbaV07XG4gICAgY29uc3QgcHJldmlvdXMgPSBncm91cHNbaSAtIDFdO1xuICAgIGNvbnN0IGxlbmd0aCA9IGdyb3VwLm1hcCgocCkgPT4gcC50ZXh0KS5qb2luKFwiXFxuXFxuXCIpLmxlbmd0aDtcbiAgICBjb25zdCBjb21iaW5lZCA9IHByZXZpb3VzLmNvbmNhdChncm91cCkubWFwKChwKSA9PiBwLnRleHQpLmpvaW4oXCJcXG5cXG5cIikubGVuZ3RoO1xuICAgIGlmIChsZW5ndGggPCBvcHRpb25zLm1pbkxlbmd0aCAmJiBzYW1lSGVhZGluZyhwcmV2aW91c1swXSwgZ3JvdXBbMF0pICYmIGNvbWJpbmVkIDw9IG9wdGlvbnMubWF4TGVuZ3RoKSB7XG4gICAgICBwcmV2aW91cy5wdXNoKC4uLmdyb3VwKTtcbiAgICAgIGdyb3Vwcy5zcGxpY2UoaSwgMSk7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGdyb3Vwcy5tYXAoKGdyb3VwKSA9PiB7XG4gICAgY29uc3QgdGV4dCA9IGdyb3VwLm1hcCgocGFyYWdyYXBoKSA9PiBwYXJhZ3JhcGgudGV4dCkuam9pbihcIlxcblxcblwiKTtcbiAgICBjb25zdCBmaXJzdCA9IGdyb3VwWzBdO1xuICAgIGNvbnN0IGxhc3QgPSBncm91cC5hdCgtMSkhO1xuICAgIGNvbnN0IGNvbnRlbnRIYXNoID0gc3RhYmxlSGFzaCh0ZXh0KTtcbiAgICByZXR1cm4ge1xuICAgICAgaWQ6IHN0YWJsZUhhc2goYCR7Q0hVTktFUl9WRVJTSU9OfVxcbiR7ZmlsZVBhdGh9XFxuJHtmaXJzdC5icmVhZGNydW1iLmpvaW4oXCIgPiBcIil9XFxuJHtjb250ZW50SGFzaH1gKSxcbiAgICAgIGNvbnRlbnRIYXNoLFxuICAgICAgZmlsZVBhdGgsXG4gICAgICBmaWxlTmFtZTogZmlsZW5hbWUsXG4gICAgICBicmVhZGNydW1iOiBmaXJzdC5icmVhZGNydW1iLFxuICAgICAgdGV4dCxcbiAgICAgIHN0YXJ0TGluZTogZmlyc3Quc3RhcnRMaW5lLFxuICAgICAgZW5kTGluZTogbGFzdC5lbmRMaW5lXG4gICAgfTtcbiAgfSk7XG59XG4iLCAiZXhwb3J0IGNsYXNzIEluZGV4QnVpbGRDYW5jZWxsZWQgZXh0ZW5kcyBFcnJvciB7XG4gIGNvbnN0cnVjdG9yKCkgeyBzdXBlcihcIlx1N0QyMlx1NUYxNVx1NEVGQlx1NTJBMVx1NURGMlx1NTNENlx1NkQ4OFwiKTsgfVxufVxuXG4vKiogQSB0b2tlbiBiZWxvbmdzIHRvIGV4YWN0bHkgb25lIGZ1bGwtaW5kZXggYnVpbGQgYW5kIGlzIG5ldmVyIHJldXNlZC4gKi9cbmV4cG9ydCBjbGFzcyBCdWlsZENhbmNlbGxhdGlvblRva2VuIHtcbiAgcHJpdmF0ZSBjYW5jZWxsZWQgPSBmYWxzZTtcblxuICBjYW5jZWwoKTogdm9pZCB7IHRoaXMuY2FuY2VsbGVkID0gdHJ1ZTsgfVxuICBnZXQgaXNDYW5jZWxsZWQoKTogYm9vbGVhbiB7IHJldHVybiB0aGlzLmNhbmNlbGxlZDsgfVxufVxuXG4vKipcbiAqIFNlcGFyYXRlcyBzaG9ydC1saXZlZCBmdWxsLWJ1aWxkIGNhbmNlbGxhdGlvbiBmcm9tIHBsdWdpbiBsaWZldGltZS4gSW5jcmVtZW50YWxcbiAqIHdyaXRlcyBoYXZlIG5vIGJ1aWxkIHRva2VuLCBzbyBhIGNvbXBsZXRlZC9jYW5jZWxsZWQgcmVidWlsZCBjYW5ub3QgcmVqZWN0XG4gKiB0aGVtOyBldmVyeSB3cml0ZSBzdGlsbCBjaGVja3MgdGhlIHBlcm1hbmVudCB1bmxvYWQgYmFycmllci5cbiAqL1xuZXhwb3J0IGNsYXNzIEJ1aWxkQ2FuY2VsbGF0aW9uQ29udHJvbGxlciB7XG4gIHByaXZhdGUgY3VycmVudEJ1aWxkOiBCdWlsZENhbmNlbGxhdGlvblRva2VuIHwgdW5kZWZpbmVkO1xuICBwcml2YXRlIHVubG9hZGVkID0gZmFsc2U7XG5cbiAgc3RhcnRCdWlsZCgpOiBCdWlsZENhbmNlbGxhdGlvblRva2VuIHtcbiAgICBjb25zdCB0b2tlbiA9IG5ldyBCdWlsZENhbmNlbGxhdGlvblRva2VuKCk7XG4gICAgdGhpcy5jdXJyZW50QnVpbGQgPSB0b2tlbjtcbiAgICByZXR1cm4gdG9rZW47XG4gIH1cblxuICBjYW5jZWxDdXJyZW50QnVpbGQoKTogdm9pZCB7XG4gICAgdGhpcy5jdXJyZW50QnVpbGQ/LmNhbmNlbCgpO1xuICB9XG5cbiAgZmluaXNoQnVpbGQodG9rZW46IEJ1aWxkQ2FuY2VsbGF0aW9uVG9rZW4pOiB2b2lkIHtcbiAgICBpZiAodGhpcy5jdXJyZW50QnVpbGQgPT09IHRva2VuKSB0aGlzLmN1cnJlbnRCdWlsZCA9IHVuZGVmaW5lZDtcbiAgfVxuXG4gIHVubG9hZCgpOiB2b2lkIHtcbiAgICB0aGlzLnVubG9hZGVkID0gdHJ1ZTtcbiAgICB0aGlzLmNhbmNlbEN1cnJlbnRCdWlsZCgpO1xuICB9XG5cbiAgaXNCdWlsZENhbmNlbGxlZCh0b2tlbjogQnVpbGRDYW5jZWxsYXRpb25Ub2tlbik6IGJvb2xlYW4ge1xuICAgIHJldHVybiB0aGlzLnVubG9hZGVkIHx8IHRva2VuLmlzQ2FuY2VsbGVkO1xuICB9XG5cbiAgYXNzZXJ0UGx1Z2luQWN0aXZlKCk6IHZvaWQge1xuICAgIGlmICh0aGlzLnVubG9hZGVkKSB0aHJvdyBuZXcgSW5kZXhCdWlsZENhbmNlbGxlZCgpO1xuICB9XG5cbiAgYXNzZXJ0QnVpbGRDYW5Db250aW51ZSh0b2tlbjogQnVpbGRDYW5jZWxsYXRpb25Ub2tlbik6IHZvaWQge1xuICAgIGlmICh0aGlzLmlzQnVpbGRDYW5jZWxsZWQodG9rZW4pKSB0aHJvdyBuZXcgSW5kZXhCdWlsZENhbmNlbGxlZCgpO1xuICB9XG5cbiAgLyoqIFBhc3MgYSBidWlsZCB0b2tlbiBvbmx5IGZvciB0aGUgZnVsbC1idWlsZCBhdG9taWMgY29tbWl0LiAqL1xuICBhc3NlcnRDb21taXRDYW5Qcm9jZWVkKGJ1aWxkVG9rZW4/OiBCdWlsZENhbmNlbGxhdGlvblRva2VuKTogdm9pZCB7XG4gICAgaWYgKGJ1aWxkVG9rZW4/LmlzQ2FuY2VsbGVkKSB0aHJvdyBuZXcgSW5kZXhCdWlsZENhbmNlbGxlZCgpO1xuICAgIHRoaXMuYXNzZXJ0UGx1Z2luQWN0aXZlKCk7XG4gIH1cbn1cbiIsICJleHBvcnQgaW50ZXJmYWNlIEVtYmVkZGluZ1Byb3ZpZGVyIHtcbiAgcmVhZG9ubHkgbW9kZWw6IHN0cmluZztcbiAgcmVhZG9ubHkgZGltZW5zaW9uczogbnVtYmVyO1xuICBlbWJlZERvY3VtZW50cyhpbnB1dHM6IHN0cmluZ1tdKTogUHJvbWlzZTxFbWJlZGRpbmdDYWxsUmVzdWx0PjtcbiAgZW1iZWRRdWVyeShxdWVyeTogc3RyaW5nKTogUHJvbWlzZTxFbWJlZGRpbmdDYWxsUmVzdWx0Pjtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBFbWJlZGRpbmdDYWxsUmVzdWx0IHtcbiAgdmVjdG9yczogbnVtYmVyW11bXTtcbiAgY29sZExvYWQ6IGJvb2xlYW47XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgSHR0cFJlc3BvbnNlIHtcbiAgc3RhdHVzOiBudW1iZXI7XG4gIHRleHQ6IHN0cmluZztcbn1cblxuZXhwb3J0IHR5cGUgSHR0cFBvc3QgPSAodXJsOiBzdHJpbmcsIGJvZHk6IHN0cmluZykgPT4gUHJvbWlzZTxIdHRwUmVzcG9uc2U+O1xuXG5leHBvcnQgY2xhc3MgRW1iZWRkaW5nRXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gIGNvbnN0cnVjdG9yKG1lc3NhZ2U6IHN0cmluZywgcHVibGljIHJlYWRvbmx5IGtpbmQ6IFwiY29ubmVjdGlvblwiIHwgXCJyZXNwb25zZVwiIHwgXCJ2YWxpZGF0aW9uXCIgPSBcInJlc3BvbnNlXCIpIHtcbiAgICBzdXBlcihtZXNzYWdlKTtcbiAgICB0aGlzLm5hbWUgPSBcIkVtYmVkZGluZ0Vycm9yXCI7XG4gIH1cbn1cblxuZXhwb3J0IGludGVyZmFjZSBPbGxhbWFPcHRpb25zIHtcbiAgZW5kcG9pbnQ6IHN0cmluZztcbiAgbW9kZWw6IHN0cmluZztcbiAgZGltZW5zaW9uczogbnVtYmVyO1xuICBrZWVwQWxpdmU6IHN0cmluZztcbiAgcXVlcnlJbnN0cnVjdGlvbjogc3RyaW5nO1xufVxuXG5leHBvcnQgY2xhc3MgT2xsYW1hRW1iZWRkaW5nUHJvdmlkZXIgaW1wbGVtZW50cyBFbWJlZGRpbmdQcm92aWRlciB7XG4gIHJlYWRvbmx5IG1vZGVsOiBzdHJpbmc7XG4gIHJlYWRvbmx5IGRpbWVuc2lvbnM6IG51bWJlcjtcblxuICBjb25zdHJ1Y3Rvcihwcml2YXRlIHJlYWRvbmx5IG9wdGlvbnM6IE9sbGFtYU9wdGlvbnMsIHByaXZhdGUgcmVhZG9ubHkgcG9zdDogSHR0cFBvc3QpIHtcbiAgICB0aGlzLm1vZGVsID0gb3B0aW9ucy5tb2RlbDtcbiAgICB0aGlzLmRpbWVuc2lvbnMgPSBvcHRpb25zLmRpbWVuc2lvbnM7XG4gIH1cblxuICBlbWJlZERvY3VtZW50cyhpbnB1dHM6IHN0cmluZ1tdKTogUHJvbWlzZTxFbWJlZGRpbmdDYWxsUmVzdWx0PiB7XG4gICAgcmV0dXJuIHRoaXMuZW1iZWQoaW5wdXRzLCBpbnB1dHMpO1xuICB9XG5cbiAgZW1iZWRRdWVyeShxdWVyeTogc3RyaW5nKTogUHJvbWlzZTxFbWJlZGRpbmdDYWxsUmVzdWx0PiB7XG4gICAgY29uc3QgaW5wdXQgPSBgSW5zdHJ1Y3Q6ICR7dGhpcy5vcHRpb25zLnF1ZXJ5SW5zdHJ1Y3Rpb259XFxuUXVlcnk6JHtxdWVyeX1gO1xuICAgIHJldHVybiB0aGlzLmVtYmVkKFtpbnB1dF0sIFtxdWVyeV0pO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBlbWJlZChpbnB1dHM6IHN0cmluZ1tdLCBleHBlY3RlZElucHV0czogc3RyaW5nW10pOiBQcm9taXNlPEVtYmVkZGluZ0NhbGxSZXN1bHQ+IHtcbiAgICBpZiAoIWlucHV0cy5sZW5ndGggfHwgaW5wdXRzLnNvbWUoKGlucHV0KSA9PiAhaW5wdXQudHJpbSgpKSkge1xuICAgICAgdGhyb3cgbmV3IEVtYmVkZGluZ0Vycm9yKFwiRW1iZWRkaW5nIGlucHV0IG11c3QgY29udGFpbiBhdCBsZWFzdCBvbmUgbm9uLWVtcHR5IHN0cmluZ1wiLCBcInZhbGlkYXRpb25cIik7XG4gICAgfVxuICAgIGxldCByZXNwb25zZTogSHR0cFJlc3BvbnNlO1xuICAgIHRyeSB7XG4gICAgICByZXNwb25zZSA9IGF3YWl0IHRoaXMucG9zdCh0aGlzLm9wdGlvbnMuZW5kcG9pbnQsIEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgbW9kZWw6IHRoaXMubW9kZWwsXG4gICAgICAgIGlucHV0OiBpbnB1dHMsXG4gICAgICAgIGRpbWVuc2lvbnM6IHRoaXMuZGltZW5zaW9ucyxcbiAgICAgICAga2VlcF9hbGl2ZTogdGhpcy5vcHRpb25zLmtlZXBBbGl2ZVxuICAgICAgfSkpO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aHJvdyBuZXcgRW1iZWRkaW5nRXJyb3IoYENhbm5vdCByZWFjaCBPbGxhbWE6ICR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpfWAsIFwiY29ubmVjdGlvblwiKTtcbiAgICB9XG4gICAgaWYgKHJlc3BvbnNlLnN0YXR1cyA8IDIwMCB8fCByZXNwb25zZS5zdGF0dXMgPj0gMzAwKSB7XG4gICAgICB0aHJvdyBuZXcgRW1iZWRkaW5nRXJyb3IoYE9sbGFtYSByZXR1cm5lZCBIVFRQICR7cmVzcG9uc2Uuc3RhdHVzfTogJHtyZXNwb25zZS50ZXh0LnNsaWNlKDAsIDMwMCl9YCwgXCJyZXNwb25zZVwiKTtcbiAgICB9XG4gICAgbGV0IHBheWxvYWQ6IHsgZW1iZWRkaW5ncz86IHVua25vd247IGxvYWRfZHVyYXRpb24/OiB1bmtub3duIH07XG4gICAgdHJ5IHtcbiAgICAgIHBheWxvYWQgPSBKU09OLnBhcnNlKHJlc3BvbnNlLnRleHQpIGFzIHsgZW1iZWRkaW5ncz86IHVua25vd247IGxvYWRfZHVyYXRpb24/OiB1bmtub3duIH07XG4gICAgfSBjYXRjaCB7XG4gICAgICB0aHJvdyBuZXcgRW1iZWRkaW5nRXJyb3IoXCJPbGxhbWEgcmV0dXJuZWQgaW52YWxpZCBKU09OXCIsIFwicmVzcG9uc2VcIik7XG4gICAgfVxuICAgIGlmICghQXJyYXkuaXNBcnJheShwYXlsb2FkLmVtYmVkZGluZ3MpIHx8IHBheWxvYWQuZW1iZWRkaW5ncy5sZW5ndGggIT09IGV4cGVjdGVkSW5wdXRzLmxlbmd0aCkge1xuICAgICAgdGhyb3cgbmV3IEVtYmVkZGluZ0Vycm9yKGBPbGxhbWEgcmV0dXJuZWQgJHtBcnJheS5pc0FycmF5KHBheWxvYWQuZW1iZWRkaW5ncykgPyBwYXlsb2FkLmVtYmVkZGluZ3MubGVuZ3RoIDogXCJub1wifSBlbWJlZGRpbmdzIGZvciAke2V4cGVjdGVkSW5wdXRzLmxlbmd0aH0gaW5wdXRzYCwgXCJ2YWxpZGF0aW9uXCIpO1xuICAgIH1cbiAgICBjb25zdCB2ZWN0b3JzID0gcGF5bG9hZC5lbWJlZGRpbmdzLm1hcCgodmVjdG9yLCBpbmRleCkgPT4ge1xuICAgICAgaWYgKCFBcnJheS5pc0FycmF5KHZlY3RvcikgfHwgdmVjdG9yLmxlbmd0aCAhPT0gdGhpcy5kaW1lbnNpb25zIHx8IHZlY3Rvci5zb21lKCh2YWx1ZSkgPT4gdHlwZW9mIHZhbHVlICE9PSBcIm51bWJlclwiIHx8ICFOdW1iZXIuaXNGaW5pdGUodmFsdWUpKSkge1xuICAgICAgICB0aHJvdyBuZXcgRW1iZWRkaW5nRXJyb3IoYEVtYmVkZGluZyAke2luZGV4ICsgMX0gaXMgbm90IGEgZmluaXRlICR7dGhpcy5kaW1lbnNpb25zfS1kaW1lbnNpb25hbCB2ZWN0b3JgLCBcInZhbGlkYXRpb25cIik7XG4gICAgICB9XG4gICAgICByZXR1cm4gdmVjdG9yIGFzIG51bWJlcltdO1xuICAgIH0pO1xuICAgIC8vIE9sbGFtYSBtYXkgcmVwb3J0IGEgdGlueSBub24temVybyBwcmVwYXJhdGlvbi9sb2FkIGR1cmF0aW9uIGV2ZW4gd2hpbGUgdGhlXG4gICAgLy8gcmVzaWRlbnQgbW9kZWwgaXMgd2FybS4gVGhlIHZlcmlmaWVkIHJlYWwgY29sZCBsb2FkIGlzIHNlY29uZHMsIHNvIGF2b2lkXG4gICAgLy8gbWlzbGVhZGluZyB0aGUgc2lkZWJhciBieSB0cmVhdGluZyBvbmx5IGEgbWF0ZXJpYWwgKD49IDUwMCBtcykgbG9hZCBhcyBjb2xkLlxuICAgIHJldHVybiB7IHZlY3RvcnMsIGNvbGRMb2FkOiB0eXBlb2YgcGF5bG9hZC5sb2FkX2R1cmF0aW9uID09PSBcIm51bWJlclwiICYmIHBheWxvYWQubG9hZF9kdXJhdGlvbiA+PSA1MDBfMDAwXzAwMCB9O1xuICB9XG59XG4iLCAiaW1wb3J0IHsgSW5kZXhJZGVudGl0eSwgSW5kZXhlZENodW5rLCBJbmRleExpZmVjeWNsZSwgUGVyc2lzdGVudEluZGV4RGF0YSB9IGZyb20gXCIuL3R5cGVzXCI7XG5cbmV4cG9ydCBmdW5jdGlvbiBzYW1lSWRlbnRpdHkobGVmdDogSW5kZXhJZGVudGl0eSwgcmlnaHQ6IEluZGV4SWRlbnRpdHkpOiBib29sZWFuIHtcbiAgcmV0dXJuIGxlZnQubW9kZWwgPT09IHJpZ2h0Lm1vZGVsICYmXG4gICAgbGVmdC5kaW1lbnNpb25zID09PSByaWdodC5kaW1lbnNpb25zICYmXG4gICAgbGVmdC5jaHVua2VyVmVyc2lvbiA9PT0gcmlnaHQuY2h1bmtlclZlcnNpb24gJiZcbiAgICBsZWZ0LmNodW5rVGFyZ2V0TGVuZ3RoID09PSByaWdodC5jaHVua1RhcmdldExlbmd0aCAmJlxuICAgIGxlZnQuY2h1bmtNYXhMZW5ndGggPT09IHJpZ2h0LmNodW5rTWF4TGVuZ3RoICYmXG4gICAgbGVmdC5jaHVua01pbkxlbmd0aCA9PT0gcmlnaHQuY2h1bmtNaW5MZW5ndGg7XG59XG5cbmV4cG9ydCBjbGFzcyBQZXJzaXN0ZW50SW5kZXgge1xuICBwcml2YXRlIGRhdGE6IFBlcnNpc3RlbnRJbmRleERhdGE7XG5cbiAgY29uc3RydWN0b3IoaWRlbnRpdHk6IEluZGV4SWRlbnRpdHksIHNhdmVkPzogUGVyc2lzdGVudEluZGV4RGF0YSkge1xuICAgIC8vIHYxIGRpZCBub3QgaGF2ZSBpbml0aWFsaXplZC4gQSBub24temVybyB1cGRhdGVkQXQgb25seSBjYW1lIGZyb20gdGhlIG9sZFxuICAgIC8vIGZ1bGwtYnVpbGQgY29tbWl0IHBhdGgsIHNvIGl0IGlzIGEgc2FmZSBtaWdyYXRpb24gc2lnbmFsIGFuZCBwcmVzZXJ2ZXNcbiAgICAvLyBleGlzdGluZyB2ZWN0b3JzIHJhdGhlciB0aGFuIGZvcmNpbmcgYSBkZXN0cnVjdGl2ZSByZXNldC5cbiAgICB0aGlzLmRhdGEgPSBzYXZlZCAmJiBBcnJheS5pc0FycmF5KHNhdmVkLmNodW5rcylcbiAgICAgID8geyAuLi5zYXZlZCwgc2NoZW1hVmVyc2lvbjogMiwgaW5pdGlhbGl6ZWQ6IHNhdmVkLmluaXRpYWxpemVkID8/IHNhdmVkLnVwZGF0ZWRBdCA+IDAgfVxuICAgICAgOiB7IHNjaGVtYVZlcnNpb246IDIsIGlkZW50aXR5LCBjaHVua3M6IFtdLCB1cGRhdGVkQXQ6IDAsIGluaXRpYWxpemVkOiBmYWxzZSB9O1xuICB9XG5cbiAgaXNDb21wYXRpYmxlKGlkZW50aXR5OiBJbmRleElkZW50aXR5KTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIHNhbWVJZGVudGl0eSh0aGlzLmRhdGEuaWRlbnRpdHksIGlkZW50aXR5KTtcbiAgfVxuXG4gIGdldCBpZGVudGl0eSgpOiBJbmRleElkZW50aXR5IHsgcmV0dXJuIHRoaXMuZGF0YS5pZGVudGl0eTsgfVxuICBnZXQgY2h1bmtzKCk6IHJlYWRvbmx5IEluZGV4ZWRDaHVua1tdIHsgcmV0dXJuIHRoaXMuZGF0YS5jaHVua3M7IH1cbiAgZ2V0IHNpemUoKTogbnVtYmVyIHsgcmV0dXJuIHRoaXMuZGF0YS5jaHVua3MubGVuZ3RoOyB9XG5cbiAgbGlmZWN5Y2xlKGlkZW50aXR5OiBJbmRleElkZW50aXR5KTogSW5kZXhMaWZlY3ljbGUge1xuICAgIGlmICghdGhpcy5pc0NvbXBhdGlibGUoaWRlbnRpdHkpKSByZXR1cm4gXCJpbmNvbXBhdGlibGVcIjtcbiAgICByZXR1cm4gdGhpcy5kYXRhLmluaXRpYWxpemVkID8gXCJyZWFkeVwiIDogXCJ1bmluaXRpYWxpemVkXCI7XG4gIH1cblxuICBpc1JlYWR5KGlkZW50aXR5OiBJbmRleElkZW50aXR5KTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIHRoaXMubGlmZWN5Y2xlKGlkZW50aXR5KSA9PT0gXCJyZWFkeVwiO1xuICB9XG5cbiAgcmV1c2FibGVCeUlkKGlkZW50aXR5OiBJbmRleElkZW50aXR5KTogTWFwPHN0cmluZywgSW5kZXhlZENodW5rPiB7XG4gICAgaWYgKCF0aGlzLmlzQ29tcGF0aWJsZShpZGVudGl0eSkpIHJldHVybiBuZXcgTWFwKCk7XG4gICAgcmV0dXJuIG5ldyBNYXAodGhpcy5kYXRhLmNodW5rcy5tYXAoKGNodW5rKSA9PiBbY2h1bmsuaWQsIGNodW5rXSkpO1xuICB9XG5cbiAgcmVwbGFjZW1lbnQoaWRlbnRpdHk6IEluZGV4SWRlbnRpdHksIGNodW5rczogSW5kZXhlZENodW5rW10pOiBQZXJzaXN0ZW50SW5kZXhEYXRhIHtcbiAgICBjb25zdCBpZHMgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgICBmb3IgKGNvbnN0IGNodW5rIG9mIGNodW5rcykge1xuICAgICAgaWYgKGlkcy5oYXMoY2h1bmsuaWQpKSB0aHJvdyBuZXcgRXJyb3IoYER1cGxpY2F0ZSBjaHVuayBJRDogJHtjaHVuay5pZH1gKTtcbiAgICAgIGlmIChjaHVuay52ZWN0b3IubGVuZ3RoICE9PSBpZGVudGl0eS5kaW1lbnNpb25zKSB0aHJvdyBuZXcgRXJyb3IoYENodW5rICR7Y2h1bmsuaWR9IHZlY3RvciBkb2VzIG5vdCBtYXRjaCBpbmRleCBkaW1lbnNpb25zYCk7XG4gICAgICBpZHMuYWRkKGNodW5rLmlkKTtcbiAgICB9XG4gICAgcmV0dXJuIHsgc2NoZW1hVmVyc2lvbjogMiwgaWRlbnRpdHksIGNodW5rcywgdXBkYXRlZEF0OiBEYXRlLm5vdygpLCBpbml0aWFsaXplZDogdHJ1ZSB9O1xuICB9XG5cbiAgY29tbWl0KGRhdGE6IFBlcnNpc3RlbnRJbmRleERhdGEpOiB2b2lkIHtcbiAgICB0aGlzLmRhdGEgPSB7IC4uLmRhdGEsIHNjaGVtYVZlcnNpb246IDIsIGluaXRpYWxpemVkOiBkYXRhLmluaXRpYWxpemVkID8/IGRhdGEudXBkYXRlZEF0ID4gMCB9O1xuICB9XG5cbiAgcmVwbGFjZShpZGVudGl0eTogSW5kZXhJZGVudGl0eSwgY2h1bmtzOiBJbmRleGVkQ2h1bmtbXSk6IHZvaWQge1xuICAgIHRoaXMuY29tbWl0KHRoaXMucmVwbGFjZW1lbnQoaWRlbnRpdHksIGNodW5rcykpO1xuICB9XG5cbiAgc2VyaWFsaXplKCk6IFBlcnNpc3RlbnRJbmRleERhdGEge1xuICAgIHJldHVybiB0aGlzLmRhdGE7XG4gIH1cbn1cbiIsICJleHBvcnQgaW50ZXJmYWNlIFF1ZXJ5Q29udGV4dCB7XG4gIHF1ZXJ5OiBzdHJpbmc7XG4gIGhlYWRpbmc/OiBzdHJpbmc7XG4gIGN1cnJlbnRQYXJhZ3JhcGg6IHN0cmluZztcbiAgcHJldmlvdXNQYXJhZ3JhcGg/OiBzdHJpbmc7XG59XG5cbmZ1bmN0aW9uIHBhcmFncmFwaEFyb3VuZChsaW5lczogc3RyaW5nW10sIGxpbmU6IG51bWJlcik6IHsgdGV4dDogc3RyaW5nOyBzdGFydDogbnVtYmVyOyBlbmQ6IG51bWJlciB9IHtcbiAgbGV0IHN0YXJ0ID0gTWF0aC5tYXgoMCwgTWF0aC5taW4obGluZSwgbGluZXMubGVuZ3RoIC0gMSkpO1xuICBsZXQgZW5kID0gc3RhcnQ7XG4gIGNvbnN0IGlzQm91bmRhcnkgPSAodmFsdWU6IHN0cmluZyB8IHVuZGVmaW5lZCkgPT4gIXZhbHVlPy50cmltKCkgfHwgL14jezEsNn1cXHMvLnRlc3QodmFsdWUpO1xuICB3aGlsZSAoc3RhcnQgPiAwICYmICFpc0JvdW5kYXJ5KGxpbmVzW3N0YXJ0IC0gMV0pKSBzdGFydC0tO1xuICB3aGlsZSAoZW5kIDwgbGluZXMubGVuZ3RoIC0gMSAmJiAhaXNCb3VuZGFyeShsaW5lc1tlbmQgKyAxXSkpIGVuZCsrO1xuICByZXR1cm4geyB0ZXh0OiBsaW5lcy5zbGljZShzdGFydCwgZW5kICsgMSkuam9pbihcIlxcblwiKS50cmltKCksIHN0YXJ0LCBlbmQgfTtcbn1cblxuZnVuY3Rpb24gYWN0aXZlSGVhZGluZyhsaW5lczogc3RyaW5nW10sIGxpbmU6IG51bWJlcik6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gIGNvbnN0IHBhdGg6IHN0cmluZ1tdID0gW107XG4gIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPD0gTWF0aC5taW4obGluZSwgbGluZXMubGVuZ3RoIC0gMSk7IGluZGV4KyspIHtcbiAgICBjb25zdCBtYXRjaCA9IGxpbmVzW2luZGV4XS5tYXRjaCgvXigjezEsNn0pXFxzKyguKz8pXFxzKiMqXFxzKiQvKTtcbiAgICBpZiAoIW1hdGNoKSBjb250aW51ZTtcbiAgICBjb25zdCBkZXB0aCA9IG1hdGNoWzFdLmxlbmd0aDtcbiAgICBwYXRoLmxlbmd0aCA9IGRlcHRoIC0gMTtcbiAgICBwYXRoW2RlcHRoIC0gMV0gPSBtYXRjaFsyXS50cmltKCk7XG4gIH1cbiAgcmV0dXJuIHBhdGguZmlsdGVyKEJvb2xlYW4pLmpvaW4oXCIgPiBcIikgfHwgdW5kZWZpbmVkO1xufVxuXG4vKiogQnVpbGRzIGEgYm91bmRlZCBsb2NhbCBjb250ZXh0IGRpcmVjdGx5IGZyb20gdGhlIGxpdmUgZWRpdG9yIGJ1ZmZlci4gKi9cbmV4cG9ydCBmdW5jdGlvbiBidWlsZFF1ZXJ5Q29udGV4dChtYXJrZG93bjogc3RyaW5nLCBjdXJzb3JMaW5lOiBudW1iZXIsIG1heExlbmd0aDogbnVtYmVyKTogUXVlcnlDb250ZXh0IHtcbiAgY29uc3QgbGluZXMgPSBtYXJrZG93bi5yZXBsYWNlKC9cXHJcXG4vZywgXCJcXG5cIikuc3BsaXQoXCJcXG5cIik7XG4gIGNvbnN0IGN1cnJlbnQgPSBwYXJhZ3JhcGhBcm91bmQobGluZXMsIGN1cnNvckxpbmUpO1xuICBsZXQgcHJldmlvdXM6IHN0cmluZyB8IHVuZGVmaW5lZDtcbiAgaWYgKGN1cnJlbnQuc3RhcnQgPiAwKSB7XG4gICAgbGV0IGNhbmRpZGF0ZSA9IGN1cnJlbnQuc3RhcnQgLSAxO1xuICAgIHdoaWxlIChjYW5kaWRhdGUgPj0gMCAmJiAoIWxpbmVzW2NhbmRpZGF0ZV0udHJpbSgpIHx8IC9eI3sxLDZ9XFxzLy50ZXN0KGxpbmVzW2NhbmRpZGF0ZV0pKSkgY2FuZGlkYXRlLS07XG4gICAgaWYgKGNhbmRpZGF0ZSA+PSAwKSBwcmV2aW91cyA9IHBhcmFncmFwaEFyb3VuZChsaW5lcywgY2FuZGlkYXRlKS50ZXh0IHx8IHVuZGVmaW5lZDtcbiAgfVxuICBjb25zdCBoZWFkaW5nID0gYWN0aXZlSGVhZGluZyhsaW5lcywgY3Vyc29yTGluZSk7XG4gIGNvbnN0IHBhcnRzID0gW2hlYWRpbmcgPyBgXHU2ODA3XHU5ODk4XHVGRjFBJHtoZWFkaW5nfWAgOiBcIlwiLCBwcmV2aW91cyA/IGBcdTUyNERcdTY1ODdcdUZGMUEke3ByZXZpb3VzfWAgOiBcIlwiLCBgXHU1RjUzXHU1MjREXHU2QkI1XHU4NDNEXHVGRjFBJHtjdXJyZW50LnRleHR9YF0uZmlsdGVyKEJvb2xlYW4pO1xuICBsZXQgcXVlcnkgPSBwYXJ0cy5qb2luKFwiXFxuXCIpO1xuICBpZiAocXVlcnkubGVuZ3RoID4gbWF4TGVuZ3RoKSB7XG4gICAgLy8gQ3VycmVudCBwYXJhZ3JhcGggaXMgdGhlIGhpZ2hlc3Qtc2lnbmFsIHBhcnQsIHNvIHByZXNlcnZlIGl0IHByZWZlcmVudGlhbGx5LlxuICAgIHF1ZXJ5ID0gW2hlYWRpbmcgPyBgXHU2ODA3XHU5ODk4XHVGRjFBJHtoZWFkaW5nfWAgOiBcIlwiLCBgXHU1RjUzXHU1MjREXHU2QkI1XHU4NDNEXHVGRjFBJHtjdXJyZW50LnRleHR9YF0uZmlsdGVyKEJvb2xlYW4pLmpvaW4oXCJcXG5cIik7XG4gICAgaWYgKHF1ZXJ5Lmxlbmd0aCA+IG1heExlbmd0aCkgcXVlcnkgPSBxdWVyeS5zbGljZSgwLCBtYXhMZW5ndGgpO1xuICB9XG4gIHJldHVybiB7IHF1ZXJ5LCBoZWFkaW5nLCBjdXJyZW50UGFyYWdyYXBoOiBjdXJyZW50LnRleHQsIHByZXZpb3VzUGFyYWdyYXBoOiBwcmV2aW91cyB9O1xufVxuIiwgIi8qKiBNb25vdG9uaWMgZ2F0ZSB0aGF0IHByZXZlbnRzIGEgY29tcGxldGVkIG9sZCBhc3luYyBxdWVyeSBjaGFuZ2luZyBuZXdlciBVSS4gKi9cbmV4cG9ydCBjbGFzcyBRdWVyeUdhdGUge1xuICBwcml2YXRlIGdlbmVyYXRpb24gPSAwO1xuXG4gIGJlZ2luKCk6IG51bWJlciB7XG4gICAgcmV0dXJuICsrdGhpcy5nZW5lcmF0aW9uO1xuICB9XG5cbiAgaXNDdXJyZW50KGdlbmVyYXRpb246IG51bWJlcik6IGJvb2xlYW4ge1xuICAgIHJldHVybiBnZW5lcmF0aW9uID09PSB0aGlzLmdlbmVyYXRpb247XG4gIH1cblxuICBpbnZhbGlkYXRlKCk6IHZvaWQge1xuICAgIHRoaXMuZ2VuZXJhdGlvbisrO1xuICB9XG59XG4iLCAiZXhwb3J0IHR5cGUgUXVlcnlSZWFzb24gPSBcInR5cGluZ1wiIHwgXCJmaWxlLW9wZW5cIiB8IFwic2lkZWJhci1vcGVuXCIgfCBcImluZGV4LXJlYWR5XCIgfCBcImxheW91dC1yZWFkeVwiO1xuZXhwb3J0IGludGVyZmFjZSBRdWVyeVNjaGVkdWxlIHtcbiAgaW1tZWRpYXRlOiBib29sZWFuO1xuICByZWFzb246IFF1ZXJ5UmVhc29uO1xufVxuXG5leHBvcnQgdHlwZSBRdWVyeUluZGV4QXZhaWxhYmlsaXR5ID0gXCJ1bmluaXRpYWxpemVkXCIgfCBcInJlYWR5XCIgfCBcImluY29tcGF0aWJsZVwiO1xuXG4vKipcbiAqIFB1cmUgcG9saWN5IGZvciBldmVudHMgdGhhdCBtYXkgc3RhcnQgYSBxdWVyeS4gVGhlIHBsdWdpbiBvd25zIEVkaXRvciBhbmRcbiAqIHdvcmtzcGFjZSBvYmplY3RzOyB0aGlzIG1vZHVsZSBvbmx5IGRlY2lkZXMgd2hldGhlciB0aGF0IHJlYWwgZXZlbnQgaGFzIGFcbiAqIHF1ZXJ5LXdvcnRoeSBNYXJrZG93biBjb250ZXh0IGFuZCB3aGV0aGVyIGl0IGlzIGRlYm91bmNlZC5cbiAqL1xuZXhwb3J0IGNsYXNzIFF1ZXJ5TGlmZWN5Y2xlQ29vcmRpbmF0b3Ige1xuICBwcml2YXRlIGhhc01hcmtkb3duQ29udGV4dCA9IGZhbHNlO1xuXG4gIGNvbnN0cnVjdG9yKHByaXZhdGUgaW5kZXhBdmFpbGFiaWxpdHk6IFF1ZXJ5SW5kZXhBdmFpbGFiaWxpdHkpIHt9XG5cbiAgc2V0SW5kZXhBdmFpbGFiaWxpdHkoYXZhaWxhYmlsaXR5OiBRdWVyeUluZGV4QXZhaWxhYmlsaXR5KTogdm9pZCB7XG4gICAgdGhpcy5pbmRleEF2YWlsYWJpbGl0eSA9IGF2YWlsYWJpbGl0eTtcbiAgfVxuXG4gIHJlbWVtYmVyTWFya2Rvd25Db250ZXh0KCk6IHZvaWQge1xuICAgIHRoaXMuaGFzTWFya2Rvd25Db250ZXh0ID0gdHJ1ZTtcbiAgfVxuXG4gIG5vdGVNYXJrZG93bkFjdGl2YXRlZCgpOiBRdWVyeVNjaGVkdWxlIHwgdW5kZWZpbmVkIHtcbiAgICB0aGlzLnJlbWVtYmVyTWFya2Rvd25Db250ZXh0KCk7XG4gICAgcmV0dXJuIHRoaXMuc2NoZWR1bGUoXCJmaWxlLW9wZW5cIiwgdHJ1ZSk7XG4gIH1cblxuICBub25NYXJrZG93bkxlYWZBY3RpdmF0ZWQoKTogdW5kZWZpbmVkIHtcbiAgICAvLyBEbyBub3QgZm9yZ2V0IHRoZSBsYXN0IE1hcmtkb3duIGVkaXRvciB3aGVuIGFuIEl0ZW1WaWV3IGdldHMgZm9jdXMuXG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuXG4gIGVkaXRvckNoYW5nZWQoKTogUXVlcnlTY2hlZHVsZSB8IHVuZGVmaW5lZCB7XG4gICAgcmV0dXJuIHRoaXMuc2NoZWR1bGUoXCJ0eXBpbmdcIiwgZmFsc2UpO1xuICB9XG5cbiAgc2lkZWJhck9wZW5lZCgpOiBRdWVyeVNjaGVkdWxlIHwgdW5kZWZpbmVkIHtcbiAgICByZXR1cm4gdGhpcy5zY2hlZHVsZShcInNpZGViYXItb3BlblwiLCB0cnVlKTtcbiAgfVxuXG4gIGluZGV4UmVhZHkoKTogUXVlcnlTY2hlZHVsZSB8IHVuZGVmaW5lZCB7XG4gICAgdGhpcy5pbmRleEF2YWlsYWJpbGl0eSA9IFwicmVhZHlcIjtcbiAgICByZXR1cm4gdGhpcy5zY2hlZHVsZShcImluZGV4LXJlYWR5XCIsIHRydWUpO1xuICB9XG5cbiAgbGF5b3V0UmVhZHkoKTogUXVlcnlTY2hlZHVsZSB8IHVuZGVmaW5lZCB7XG4gICAgcmV0dXJuIHRoaXMuc2NoZWR1bGUoXCJsYXlvdXQtcmVhZHlcIiwgdHJ1ZSk7XG4gIH1cblxuICBwcml2YXRlIHNjaGVkdWxlKHJlYXNvbjogUXVlcnlSZWFzb24sIGltbWVkaWF0ZTogYm9vbGVhbik6IFF1ZXJ5U2NoZWR1bGUgfCB1bmRlZmluZWQge1xuICAgIGlmICh0aGlzLmluZGV4QXZhaWxhYmlsaXR5ICE9PSBcInJlYWR5XCIgfHwgIXRoaXMuaGFzTWFya2Rvd25Db250ZXh0KSByZXR1cm4gdW5kZWZpbmVkO1xuICAgIHJldHVybiB7IGltbWVkaWF0ZSwgcmVhc29uIH07XG4gIH1cbn1cbiIsICJpbXBvcnQgeyBJbmRleGVkQ2h1bmssIFNlYXJjaFJlc3VsdCB9IGZyb20gXCIuL3R5cGVzXCI7XG5cbmV4cG9ydCBmdW5jdGlvbiBjb3NpbmVTaW1pbGFyaXR5KGxlZnQ6IG51bWJlcltdLCByaWdodDogbnVtYmVyW10pOiBudW1iZXIge1xuICBpZiAoIWxlZnQubGVuZ3RoIHx8IGxlZnQubGVuZ3RoICE9PSByaWdodC5sZW5ndGgpIHRocm93IG5ldyBFcnJvcihcIkNvc2luZSB2ZWN0b3JzIG11c3QgYmUgbm9uLWVtcHR5IGFuZCBoYXZlIGVxdWFsIGRpbWVuc2lvbnNcIik7XG4gIGxldCBkb3QgPSAwO1xuICBsZXQgbGVmdE5vcm0gPSAwO1xuICBsZXQgcmlnaHROb3JtID0gMDtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBsZWZ0Lmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgYSA9IGxlZnRbaV07XG4gICAgY29uc3QgYiA9IHJpZ2h0W2ldO1xuICAgIGlmICghTnVtYmVyLmlzRmluaXRlKGEpIHx8ICFOdW1iZXIuaXNGaW5pdGUoYikpIHRocm93IG5ldyBFcnJvcihcIkNvc2luZSB2ZWN0b3JzIG11c3QgYmUgZmluaXRlXCIpO1xuICAgIGRvdCArPSBhICogYjtcbiAgICBsZWZ0Tm9ybSArPSBhICogYTtcbiAgICByaWdodE5vcm0gKz0gYiAqIGI7XG4gIH1cbiAgaWYgKCFsZWZ0Tm9ybSB8fCAhcmlnaHROb3JtKSByZXR1cm4gMDtcbiAgcmV0dXJuIGRvdCAvIE1hdGguc3FydChsZWZ0Tm9ybSAqIHJpZ2h0Tm9ybSk7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgUmFua09wdGlvbnMge1xuICB0b3BLOiBudW1iZXI7XG4gIG1heFBlckZpbGU6IG51bWJlcjtcbiAgZXhjbHVkZVBhdGg/OiBzdHJpbmc7XG4gIGR1cGxpY2F0ZVNpbWlsYXJpdHk/OiBudW1iZXI7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByYW5rQ2h1bmtzKHF1ZXJ5OiBudW1iZXJbXSwgY2FuZGlkYXRlczogcmVhZG9ubHkgSW5kZXhlZENodW5rW10sIG9wdGlvbnM6IFJhbmtPcHRpb25zKTogU2VhcmNoUmVzdWx0W10ge1xuICBjb25zdCBzY29yZWQgPSBjYW5kaWRhdGVzXG4gICAgLmZpbHRlcigoY2h1bmspID0+IGNodW5rLmZpbGVQYXRoICE9PSBvcHRpb25zLmV4Y2x1ZGVQYXRoKVxuICAgIC5tYXAoKGNodW5rKSA9PiAoeyAuLi5jaHVuaywgc2ltaWxhcml0eTogY29zaW5lU2ltaWxhcml0eShxdWVyeSwgY2h1bmsudmVjdG9yKSB9KSlcbiAgICAuc29ydCgoYSwgYikgPT4gYi5zaW1pbGFyaXR5IC0gYS5zaW1pbGFyaXR5KTtcbiAgY29uc3QgcmVzdWx0czogU2VhcmNoUmVzdWx0W10gPSBbXTtcbiAgY29uc3QgcGVyRmlsZSA9IG5ldyBNYXA8c3RyaW5nLCBudW1iZXI+KCk7XG4gIGNvbnN0IGR1cGxpY2F0ZUF0ID0gb3B0aW9ucy5kdXBsaWNhdGVTaW1pbGFyaXR5ID8/IDAuOTk1O1xuICBmb3IgKGNvbnN0IGNhbmRpZGF0ZSBvZiBzY29yZWQpIHtcbiAgICBpZiAoKHBlckZpbGUuZ2V0KGNhbmRpZGF0ZS5maWxlUGF0aCkgPz8gMCkgPj0gb3B0aW9ucy5tYXhQZXJGaWxlKSBjb250aW51ZTtcbiAgICBjb25zdCBub3JtYWxpemVkID0gY2FuZGlkYXRlLnRleHQucmVwbGFjZSgvXFxzKy9nLCBcIiBcIikudHJpbSgpO1xuICAgIGNvbnN0IGR1cGxpY2F0ZSA9IHJlc3VsdHMuc29tZSgocmVzdWx0KSA9PlxuICAgICAgcmVzdWx0LnRleHQucmVwbGFjZSgvXFxzKy9nLCBcIiBcIikudHJpbSgpID09PSBub3JtYWxpemVkIHx8XG4gICAgICAocmVzdWx0LmZpbGVQYXRoID09PSBjYW5kaWRhdGUuZmlsZVBhdGggJiYgY29zaW5lU2ltaWxhcml0eShyZXN1bHQudmVjdG9yLCBjYW5kaWRhdGUudmVjdG9yKSA+PSBkdXBsaWNhdGVBdCkpO1xuICAgIGlmIChkdXBsaWNhdGUpIGNvbnRpbnVlO1xuICAgIHJlc3VsdHMucHVzaChjYW5kaWRhdGUpO1xuICAgIHBlckZpbGUuc2V0KGNhbmRpZGF0ZS5maWxlUGF0aCwgKHBlckZpbGUuZ2V0KGNhbmRpZGF0ZS5maWxlUGF0aCkgPz8gMCkgKyAxKTtcbiAgICBpZiAocmVzdWx0cy5sZW5ndGggPj0gb3B0aW9ucy50b3BLKSBicmVhaztcbiAgfVxuICByZXR1cm4gcmVzdWx0cztcbn1cbiIsICJpbXBvcnQgeyBBcHAsIFBsdWdpblNldHRpbmdUYWIsIFNldHRpbmcgfSBmcm9tIFwib2JzaWRpYW5cIjtcbmltcG9ydCBTaWRlR3JlcFBsdWdpbiBmcm9tIFwiLi9tYWluXCI7XG5cbmV4cG9ydCBpbnRlcmZhY2UgU2lkZUdyZXBTZXR0aW5ncyB7XG4gIGVuZHBvaW50OiBzdHJpbmc7XG4gIG1vZGVsOiBzdHJpbmc7XG4gIGRpbWVuc2lvbnM6IG51bWJlcjtcbiAga2VlcEFsaXZlOiBzdHJpbmc7XG4gIHF1ZXJ5RGVib3VuY2VNczogbnVtYmVyO1xuICBxdWVyeU1heExlbmd0aDogbnVtYmVyO1xuICBjaHVua1RhcmdldExlbmd0aDogbnVtYmVyO1xuICBjaHVua01heExlbmd0aDogbnVtYmVyO1xuICBjaHVua01pbkxlbmd0aDogbnVtYmVyO1xuICB0b3BLOiBudW1iZXI7XG4gIG1heFBlckZpbGU6IG51bWJlcjtcbiAgZXhjbHVkZWREaXJlY3Rvcmllczogc3RyaW5nO1xuICBxdWVyeUluc3RydWN0aW9uOiBzdHJpbmc7XG4gIGVtYmVkZGluZ0JhdGNoU2l6ZTogbnVtYmVyO1xuICBhdXRvRXhwYW5kQ291bnQ6IG51bWJlcjtcbiAgYXV0b0V4cGFuZFRocmVzaG9sZEVuYWJsZWQ6IGJvb2xlYW47XG4gIGF1dG9FeHBhbmRUaHJlc2hvbGQ6IG51bWJlcjtcbn1cblxuZXhwb3J0IGNvbnN0IERFRkFVTFRfU0VUVElOR1M6IFNpZGVHcmVwU2V0dGluZ3MgPSB7XG4gIGVuZHBvaW50OiBcImh0dHA6Ly8xMjcuMC4wLjE6MTE0MzQvYXBpL2VtYmVkXCIsXG4gIG1vZGVsOiBcInF3ZW4zLWVtYmVkZGluZzowLjZiXCIsXG4gIGRpbWVuc2lvbnM6IDEwMjQsXG4gIGtlZXBBbGl2ZTogXCI1bVwiLFxuICBxdWVyeURlYm91bmNlTXM6IDgwMCxcbiAgcXVlcnlNYXhMZW5ndGg6IDE0MDAsXG4gIGNodW5rVGFyZ2V0TGVuZ3RoOiA2NTAsXG4gIGNodW5rTWF4TGVuZ3RoOiAxMTAwLFxuICBjaHVua01pbkxlbmd0aDogODAsXG4gIHRvcEs6IDUsXG4gIG1heFBlckZpbGU6IDIsXG4gIGV4Y2x1ZGVkRGlyZWN0b3JpZXM6IFwiLm9ic2lkaWFuXCIsXG4gIHF1ZXJ5SW5zdHJ1Y3Rpb246IFwiR2l2ZW4gYSBDaGluZXNlIG5vdGUgc2VhcmNoIHF1ZXJ5LCByZXRyaWV2ZSByZWxldmFudCBwYXNzYWdlcyBmcm9tIGEgbG9jYWwgTWFya2Rvd24ga25vd2xlZGdlIGJhc2UuXCIsXG4gIGVtYmVkZGluZ0JhdGNoU2l6ZTogMTYsXG4gIGF1dG9FeHBhbmRDb3VudDogMyxcbiAgYXV0b0V4cGFuZFRocmVzaG9sZEVuYWJsZWQ6IGZhbHNlLFxuICBhdXRvRXhwYW5kVGhyZXNob2xkOiAwLjNcbn07XG5cbmV4cG9ydCBmdW5jdGlvbiBleGNsdWRlZERpcmVjdG9yeUxpc3QodmFsdWU6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgcmV0dXJuIHZhbHVlLnNwbGl0KFwiLFwiKS5tYXAoKHBhcnQpID0+IHBhcnQudHJpbSgpLnJlcGxhY2UoL15cXC8rfFxcLyskL2csIFwiXCIpKS5maWx0ZXIoQm9vbGVhbik7XG59XG5cbmV4cG9ydCBjbGFzcyBTaWRlR3JlcFNldHRpbmdUYWIgZXh0ZW5kcyBQbHVnaW5TZXR0aW5nVGFiIHtcbiAgY29uc3RydWN0b3IoYXBwOiBBcHAsIHByaXZhdGUgcmVhZG9ubHkgcGx1Z2luOiBTaWRlR3JlcFBsdWdpbikgeyBzdXBlcihhcHAsIHBsdWdpbik7IH1cblxuICBkaXNwbGF5KCk6IHZvaWQge1xuICAgIGNvbnN0IHsgY29udGFpbmVyRWwgfSA9IHRoaXM7XG4gICAgY29udGFpbmVyRWwuZW1wdHkoKTtcbiAgICBjb250YWluZXJFbC5jcmVhdGVFbChcImgyXCIsIHsgdGV4dDogXCJTaWRlIEdyZXAgXHU4QkJFXHU3RjZFXCIgfSk7XG4gICAgY29udGFpbmVyRWwuY3JlYXRlRWwoXCJwXCIsIHsgdGV4dDogXCJcdTRGRUVcdTY1MzlcdTZBMjFcdTU3OEJcdTMwMDFcdTdFRjRcdTVFQTZcdTYyMTZcdTUyMDdcdTUyMDZcdTk1N0ZcdTVFQTZcdTU0MEVcdUZGMENcdTczQjBcdTY3MDlcdTdEMjJcdTVGMTVcdTRGMUFcdTY4MDdcdThCQjBcdTRFM0FcdTk3MDBcdTkxQ0RcdTVFRkFcdUZGMENcdTkwN0ZcdTUxNERcdTZERjdcdTc1MjhcdTU0MTFcdTkxQ0ZcdTMwMDJcIiB9KTtcbiAgICB0aGlzLnRleHQoXCJPbGxhbWEgZW5kcG9pbnRcIiwgXCJcdTY3MkNcdTU3MzAgL2FwaS9lbWJlZCBVUkxcIiwgXCJlbmRwb2ludFwiKTtcbiAgICB0aGlzLnRleHQoXCJcdTZBMjFcdTU3OEJcdTU0MERcdTc5RjBcIiwgXCJxd2VuMy1lbWJlZGRpbmc6MC42YlwiLCBcIm1vZGVsXCIpO1xuICAgIHRoaXMubnVtYmVyKFwiRW1iZWRkaW5nIGRpbWVuc2lvbnNcIiwgXCJcdTlFRDhcdThCQTQgMTAyNFx1RkYxQlx1NjUzOVx1NTNEOFx1NTQwRVx1NUZDNVx1OTg3Qlx1OTFDRFx1NUVGQVwiLCBcImRpbWVuc2lvbnNcIiwgMzIpO1xuICAgIHRoaXMudGV4dChcImtlZXBfYWxpdmVcIiwgXCI1bVwiLCBcImtlZXBBbGl2ZVwiKTtcbiAgICB0aGlzLm51bWJlcihcIlx1NjdFNVx1OEJFMiBkZWJvdW5jZSAobXMpXCIsIFwiXHU1MDVDXHU2QjYyXHU4RjkzXHU1MTY1XHU1OTFBXHU0RTQ1XHU1NDBFXHU2N0U1XHU4QkUyXCIsIFwicXVlcnlEZWJvdW5jZU1zXCIsIDEwMCk7XG4gICAgdGhpcy5udW1iZXIoXCJcdTY3RTVcdThCRTJcdTY3MDBcdTU5MjdcdTk1N0ZcdTVFQTZcIiwgXCJcdTVDNDBcdTkwRThcdTRFMEFcdTRFMEJcdTY1ODdcdTY3MDBcdTU5MjdcdTVCNTdcdTdCMjZcdTY1NzBcIiwgXCJxdWVyeU1heExlbmd0aFwiLCA2NCk7XG4gICAgdGhpcy5udW1iZXIoXCJcdTcyNDdcdTZCQjVcdTc2RUVcdTY4MDdcdTk1N0ZcdTVFQTZcIiwgXCJcdTYzQThcdTgzNTAgNTAwXHUyMDEzNzAwIFx1NUI1N1x1N0IyNlwiLCBcImNodW5rVGFyZ2V0TGVuZ3RoXCIsIDEpO1xuICAgIHRoaXMubnVtYmVyKFwiXHU3MjQ3XHU2QkI1XHU2NzAwXHU1OTI3XHU5NTdGXHU1RUE2XCIsIFwiXHU2M0E4XHU4MzUwIDEwMDBcdTIwMTMxMjAwIFx1NUI1N1x1N0IyNlwiLCBcImNodW5rTWF4TGVuZ3RoXCIsIDEpO1xuICAgIHRoaXMubnVtYmVyKFwiXHU3MjQ3XHU2QkI1XHU2NzAwXHU1QzBGXHU2NzA5XHU2NTQ4XHU5NTdGXHU1RUE2XCIsIFwiXHU3N0VEXHU4MDBDXHU2NzA5XHU2MTBGXHU0RTQ5XHU3Njg0XHU3QjE0XHU4QkIwXHU0RUNEXHU1M0VGXHU3RDIyXHU1RjE1XCIsIFwiY2h1bmtNaW5MZW5ndGhcIiwgMSk7XG4gICAgdGhpcy5udW1iZXIoXCJUb3AgS1wiLCBcIlx1OEZENFx1NTZERVx1N0VEM1x1Njc5Q1x1NjU3MFwiLCBcInRvcEtcIiwgMSk7XG4gICAgdGhpcy5udW1iZXIoXCJcdTZCQ0ZcdTY1ODdcdTRFRjZcdTY3MDBcdTU5MjdcdTdFRDNcdTY3OUNcdTY1NzBcIiwgXCJcdTlFRDhcdThCQTRcdTY3MDBcdTU5MUFcdTRFMjRcdTRFMkFcdTcyNDdcdTZCQjVcIiwgXCJtYXhQZXJGaWxlXCIsIDEpO1xuICAgIHRoaXMuZXhwYW5zaW9uU2V0dGluZ3MoKTtcbiAgICB0aGlzLm51bWJlcihcIlx1NUVGQVx1NUU5M1x1NjI3OVx1OTFDRlx1NTkyN1x1NUMwRlwiLCBcIlx1NkJDRlx1NkIyMSBPbGxhbWEgXHU2NTg3XHU2ODYzIGVtYmVkZGluZyBcdTY1NzBcIiwgXCJlbWJlZGRpbmdCYXRjaFNpemVcIiwgMSk7XG4gICAgdGhpcy50ZXh0KFwiXHU2MzkyXHU5NjY0XHU3NkVFXHU1RjU1XCIsIFwiXHU5MDE3XHU1M0Y3XHU1MjA2XHU5Njk0XHVGRjBDXHU0RjhCXHU1OTgyIC5vYnNpZGlhbiwgdGVtcGxhdGVzXCIsIFwiZXhjbHVkZWREaXJlY3Rvcmllc1wiKTtcbiAgICB0aGlzLnRleHQoXCJRdWVyeSBpbnN0cnVjdGlvblwiLCBcIlx1NEYxQVx1NkRGQlx1NTJBMFx1NTcyOCBRdWVyeTogXHU1MjREXCIsIFwicXVlcnlJbnN0cnVjdGlvblwiKTtcbiAgfVxuXG4gIHByaXZhdGUgZXhwYW5zaW9uU2V0dGluZ3MoKTogdm9pZCB7XG4gICAgbmV3IFNldHRpbmcodGhpcy5jb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiXHU5RUQ4XHU4QkE0XHU1QzU1XHU1RjAwXHU3RUQzXHU2NzlDXCIpXG4gICAgICAuc2V0RGVzYyhcIlx1NzUyOFx1NjIzN1x1NjI0Qlx1NTJBOFx1NUM1NVx1NUYwMFx1NjIxNlx1NjI5OFx1NTNFMFx1NTQwRVx1RkYwQ1x1NUMwNlx1NEYxOFx1NTE0OFx1NEZERFx1NzU1OVx1NzUyOFx1NjIzN1x1OTAwOVx1NjJFOVwiKVxuICAgICAgLmFkZERyb3Bkb3duKChkcm9wZG93bikgPT4gZHJvcGRvd25cbiAgICAgICAgLmFkZE9wdGlvbihcIjBcIiwgXCJcdTUxNjhcdTkwRThcdTYyOThcdTUzRTBcIilcbiAgICAgICAgLmFkZE9wdGlvbihcIjFcIiwgXCJcdTUyNEQgMSBcdTRFMkFcIilcbiAgICAgICAgLmFkZE9wdGlvbihcIjNcIiwgXCJcdTUyNEQgMyBcdTRFMkFcIilcbiAgICAgICAgLmFkZE9wdGlvbihcIjVcIiwgXCJcdTUyNEQgNSBcdTRFMkFcIilcbiAgICAgICAgLmFkZE9wdGlvbihcIi0xXCIsIFwiXHU1MTY4XHU5MEU4XHU1QzU1XHU1RjAwXCIpXG4gICAgICAgIC5zZXRWYWx1ZShTdHJpbmcodGhpcy5wbHVnaW4uc2V0dGluZ3MuYXV0b0V4cGFuZENvdW50KSlcbiAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4gdGhpcy5wZXJzaXN0U2V0dGluZyhcImF1dG9FeHBhbmRDb3VudFwiLCBOdW1iZXIodmFsdWUpKSkpO1xuXG4gICAgbmV3IFNldHRpbmcodGhpcy5jb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiXHU0RjdGXHU3NTI4XHU4MUVBXHU1MkE4XHU1QzU1XHU1RjAwXHU3NkY4XHU0RjNDXHU1RUE2XHU5NjA4XHU1MDNDXCIpXG4gICAgICAuc2V0RGVzYyhcIlx1NUYwMFx1NTQyRlx1NTQwRVx1RkYwQ1x1NEY0RVx1NEU4RVx1OTYwOFx1NTAzQ1x1NzY4NFx1N0VEM1x1Njc5Q1x1NEUwRFx1NEYxQVx1ODFFQVx1NTJBOFx1NUM1NVx1NUYwMFwiKVxuICAgICAgLmFkZFRvZ2dsZSgodG9nZ2xlKSA9PiB0b2dnbGVcbiAgICAgICAgLnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzLmF1dG9FeHBhbmRUaHJlc2hvbGRFbmFibGVkKVxuICAgICAgICAub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB0aGlzLnBlcnNpc3RTZXR0aW5nKFwiYXV0b0V4cGFuZFRocmVzaG9sZEVuYWJsZWRcIiwgdmFsdWUpKSk7XG5cbiAgICBuZXcgU2V0dGluZyh0aGlzLmNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJcdTgxRUFcdTUyQThcdTVDNTVcdTVGMDBcdTY3MDBcdTRGNEVcdTc2RjhcdTRGM0NcdTVFQTZcIilcbiAgICAgIC5zZXREZXNjKFwiXHU4MzAzXHU1NkY0IDBcdTIwMTMxXHVGRjFCXHU0RUM1XHU1NzI4XHU1NDJGXHU3NTI4XHU5NjA4XHU1MDNDXHU2NUY2XHU3NTFGXHU2NTQ4XCIpXG4gICAgICAuYWRkVGV4dCgodGV4dCkgPT4gdGV4dFxuICAgICAgICAuc2V0VmFsdWUoU3RyaW5nKHRoaXMucGx1Z2luLnNldHRpbmdzLmF1dG9FeHBhbmRUaHJlc2hvbGQpKVxuICAgICAgICAub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgY29uc3QgbnVtYmVyID0gTnVtYmVyKHZhbHVlKTtcbiAgICAgICAgICBpZiAoTnVtYmVyLmlzRmluaXRlKG51bWJlcikgJiYgbnVtYmVyID49IDAgJiYgbnVtYmVyIDw9IDEpIGF3YWl0IHRoaXMucGVyc2lzdFNldHRpbmcoXCJhdXRvRXhwYW5kVGhyZXNob2xkXCIsIG51bWJlcik7XG4gICAgICAgIH0pKTtcbiAgfVxuXG4gIHByaXZhdGUgdGV4dChsYWJlbDogc3RyaW5nLCBkZXNjcmlwdGlvbjogc3RyaW5nLCBrZXk6IGtleW9mIFNpZGVHcmVwU2V0dGluZ3MpOiB2b2lkIHtcbiAgICBuZXcgU2V0dGluZyh0aGlzLmNvbnRhaW5lckVsKS5zZXROYW1lKGxhYmVsKS5zZXREZXNjKGRlc2NyaXB0aW9uKS5hZGRUZXh0KCh0ZXh0KSA9PiB0ZXh0XG4gICAgICAuc2V0VmFsdWUoU3RyaW5nKHRoaXMucGx1Z2luLnNldHRpbmdzW2tleV0pKVxuICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4gdGhpcy5wZXJzaXN0U2V0dGluZyhrZXksIHZhbHVlKSkpO1xuICB9XG5cbiAgcHJpdmF0ZSBudW1iZXIobGFiZWw6IHN0cmluZywgZGVzY3JpcHRpb246IHN0cmluZywga2V5OiBrZXlvZiBTaWRlR3JlcFNldHRpbmdzLCBtaW46IG51bWJlcik6IHZvaWQge1xuICAgIG5ldyBTZXR0aW5nKHRoaXMuY29udGFpbmVyRWwpLnNldE5hbWUobGFiZWwpLnNldERlc2MoZGVzY3JpcHRpb24pLmFkZFRleHQoKHRleHQpID0+IHRleHRcbiAgICAgIC5zZXRWYWx1ZShTdHJpbmcodGhpcy5wbHVnaW4uc2V0dGluZ3Nba2V5XSkpXG4gICAgICAuc2V0UGxhY2Vob2xkZXIoU3RyaW5nKG1pbikpXG4gICAgICAub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgIGNvbnN0IG51bWJlciA9IE51bWJlcih2YWx1ZSk7XG4gICAgICAgIGlmIChOdW1iZXIuaXNGaW5pdGUobnVtYmVyKSAmJiBudW1iZXIgPj0gbWluKSBhd2FpdCB0aGlzLnBlcnNpc3RTZXR0aW5nKGtleSwgbnVtYmVyKTtcbiAgICAgIH0pKTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcGVyc2lzdFNldHRpbmcoa2V5OiBrZXlvZiBTaWRlR3JlcFNldHRpbmdzLCB2YWx1ZTogc3RyaW5nIHwgbnVtYmVyIHwgYm9vbGVhbik6IFByb21pc2U8dm9pZD4ge1xuICAgICh0aGlzLnBsdWdpbi5zZXR0aW5ncyBhcyB1bmtub3duIGFzIFJlY29yZDxzdHJpbmcsIHN0cmluZyB8IG51bWJlciB8IGJvb2xlYW4+KVtrZXldID0gdmFsdWU7XG4gICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgdGhpcy5wbHVnaW4ub25TZXR0aW5nc0NoYW5nZWQoKTtcbiAgfVxufVxuIiwgImltcG9ydCB7IEl0ZW1WaWV3LCBNYXJrZG93blJlbmRlcmVyLCBzZXRJY29uLCBXb3Jrc3BhY2VMZWFmIH0gZnJvbSBcIm9ic2lkaWFuXCI7XG5pbXBvcnQgeyBFeHBhbnNpb25Qb2xpY3ksIHNob3VsZEF1dG9FeHBhbmQgfSBmcm9tIFwiLi9leHBhbnNpb24tcG9saWN5XCI7XG5pbXBvcnQgeyBoYXNNYXRlcmlhbFJlc3VsdENoYW5nZSB9IGZyb20gXCIuL3Jlc3VsdC1wcmVzZW50YXRpb25cIjtcbmltcG9ydCB7IFNlYXJjaFJlc3VsdCwgU2lkZWJhclN0YXRlIH0gZnJvbSBcIi4vdHlwZXNcIjtcblxuZXhwb3J0IGNvbnN0IFNJREVfR1JFUF9WSUVXX1RZUEUgPSBcIm9ic2RuLXNpZGUtZ3JlcC1zaWRlYmFyXCI7XG5cbmV4cG9ydCBpbnRlcmZhY2UgU2lkZWJhckFjdGlvbnMge1xuICBvcGVuUmVzdWx0KHJlc3VsdDogU2VhcmNoUmVzdWx0KTogUHJvbWlzZTx2b2lkPjtcbiAgaW5zZXJ0TGluayhyZXN1bHQ6IFNlYXJjaFJlc3VsdCk6IHZvaWQ7XG4gIGluc2VydFF1b3RlKHJlc3VsdDogU2VhcmNoUmVzdWx0LCBzZWxlY3RlZFRleHQ/OiBzdHJpbmcpOiB2b2lkO1xuICBsaW5rTWFya3VwKHJlc3VsdDogU2VhcmNoUmVzdWx0KTogc3RyaW5nO1xuICBxdW90ZU1hcmt1cChyZXN1bHQ6IFNlYXJjaFJlc3VsdCwgc2VsZWN0ZWRUZXh0Pzogc3RyaW5nKTogc3RyaW5nO1xuICBleHBhbnNpb25Qb2xpY3koKTogRXhwYW5zaW9uUG9saWN5O1xuICByZWJ1aWxkSW5kZXgoKTogUHJvbWlzZTx2b2lkPjtcbiAgY2FuY2VsSW5kZXgoKTogdm9pZDtcbiAgcmVmcmVzaEN1cnJlbnRRdWVyeSgpOiB2b2lkO1xuICBzaWRlYmFyT3BlbmVkKCk6IHZvaWQ7XG59XG5cbmludGVyZmFjZSBSZXN1bHRDYXJkIHtcbiAgcm9vdDogSFRNTERldGFpbHNFbGVtZW50O1xuICBmaWxlOiBIVE1MRWxlbWVudDtcbiAgc2NvcmU6IEhUTUxFbGVtZW50O1xuICBicmVhZGNydW1iOiBIVE1MRWxlbWVudDtcbiAgcXVvdGU6IEhUTUxFbGVtZW50O1xuICByZXN1bHQ6IFNlYXJjaFJlc3VsdDtcbiAgcmVuZGVyZWRIYXNoPzogc3RyaW5nO1xuICBtYW51YWxFeHBhbnNpb24/OiBib29sZWFuO1xuICBpZ25vcmVOZXh0VG9nZ2xlOiBib29sZWFuO1xufVxuXG5leHBvcnQgY2xhc3MgU2lkZUdyZXBWaWV3IGV4dGVuZHMgSXRlbVZpZXcge1xuICBwcml2YXRlIHN0YXRlOiBTaWRlYmFyU3RhdGUgPSB7IGtpbmQ6IFwid2FpdGluZy1pbnB1dFwiLCBtZXNzYWdlOiBcIlx1N0I0OVx1NUY4NVx1OEY5M1x1NTE2NVwiIH07XG4gIHByaXZhdGUgcmVzdWx0czogU2VhcmNoUmVzdWx0W10gPSBbXTtcbiAgcHJpdmF0ZSBzaGVsbFJlYWR5ID0gZmFsc2U7XG4gIHByaXZhdGUgc3RhdHVzSWNvbiE6IEhUTUxFbGVtZW50O1xuICBwcml2YXRlIHJlZnJlc2hCdXR0b24hOiBIVE1MQnV0dG9uRWxlbWVudDtcbiAgcHJpdmF0ZSBpbmRleEJ1dHRvbiE6IEhUTUxCdXR0b25FbGVtZW50O1xuICBwcml2YXRlIGluZGV4UGFuZWwhOiBIVE1MRWxlbWVudDtcbiAgcHJpdmF0ZSBlbXB0eVN0YXRlITogSFRNTEVsZW1lbnQ7XG4gIHByaXZhdGUgcmVzdWx0c0VsITogSFRNTEVsZW1lbnQ7XG4gIHByaXZhdGUgcmVhZG9ubHkgY2FyZHMgPSBuZXcgTWFwPHN0cmluZywgUmVzdWx0Q2FyZD4oKTtcbiAgcHJpdmF0ZSByZXN1bHRBbmltYXRpb246IEFuaW1hdGlvbiB8IHVuZGVmaW5lZDtcbiAgcHJpdmF0ZSBleHBhbnNpb25Qb2xpY3lLZXkgPSBcIlwiO1xuXG4gIGNvbnN0cnVjdG9yKGxlYWY6IFdvcmtzcGFjZUxlYWYsIHByaXZhdGUgcmVhZG9ubHkgYWN0aW9uczogU2lkZWJhckFjdGlvbnMpIHsgc3VwZXIobGVhZik7IH1cbiAgZ2V0Vmlld1R5cGUoKTogc3RyaW5nIHsgcmV0dXJuIFNJREVfR1JFUF9WSUVXX1RZUEU7IH1cbiAgZ2V0RGlzcGxheVRleHQoKTogc3RyaW5nIHsgcmV0dXJuIFwiU2lkZSBHcmVwXCI7IH1cbiAgZ2V0SWNvbigpOiBzdHJpbmcgeyByZXR1cm4gXCJzZWFyY2hcIjsgfVxuXG4gIHNob3dSZXN1bHRzKHN0YXRlOiBTaWRlYmFyU3RhdGUsIHJlc3VsdHM6IFNlYXJjaFJlc3VsdFtdID0gdGhpcy5yZXN1bHRzKTogdm9pZCB7XG4gICAgdGhpcy5zdGF0ZSA9IHN0YXRlO1xuICAgIHRoaXMuZW5zdXJlU2hlbGwoKTtcbiAgICB0aGlzLnVwZGF0ZVRvb2xiYXIoKTtcbiAgICB0aGlzLnVwZGF0ZUluZGV4UGFuZWwoKTtcbiAgICBjb25zdCBwb2xpY3lLZXkgPSBKU09OLnN0cmluZ2lmeSh0aGlzLmFjdGlvbnMuZXhwYW5zaW9uUG9saWN5KCkpO1xuICAgIGlmIChwb2xpY3lLZXkgIT09IHRoaXMuZXhwYW5zaW9uUG9saWN5S2V5KSB7XG4gICAgICB0aGlzLmV4cGFuc2lvblBvbGljeUtleSA9IHBvbGljeUtleTtcbiAgICAgIGZvciAoY29uc3QgY2FyZCBvZiB0aGlzLmNhcmRzLnZhbHVlcygpKSBjYXJkLm1hbnVhbEV4cGFuc2lvbiA9IHVuZGVmaW5lZDtcbiAgICB9XG4gICAgY29uc3Qgc2hvdWxkU29mdGVuID0gaGFzTWF0ZXJpYWxSZXN1bHRDaGFuZ2UodGhpcy5yZXN1bHRzLCByZXN1bHRzKTtcbiAgICB0aGlzLnJlY29uY2lsZVJlc3VsdHMoWy4uLnJlc3VsdHNdKTtcbiAgICBpZiAoc2hvdWxkU29mdGVuKSB0aGlzLmFuaW1hdGVSZXN1bHRSZWZyZXNoKCk7XG4gICAgdGhpcy51cGRhdGVFbXB0eVN0YXRlKCk7XG4gIH1cblxuICBhc3luYyBvbk9wZW4oKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhpcy5lbnN1cmVTaGVsbCgpO1xuICAgIHRoaXMudXBkYXRlVG9vbGJhcigpO1xuICAgIHRoaXMudXBkYXRlSW5kZXhQYW5lbCgpO1xuICAgIHRoaXMucmVjb25jaWxlUmVzdWx0cyh0aGlzLnJlc3VsdHMpO1xuICAgIHRoaXMudXBkYXRlRW1wdHlTdGF0ZSgpO1xuICAgIHRoaXMuYWN0aW9ucy5zaWRlYmFyT3BlbmVkKCk7XG4gIH1cblxuICBhc3luYyBvbkNsb3NlKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRoaXMucmVzdWx0QW5pbWF0aW9uPy5jYW5jZWwoKTtcbiAgICB0aGlzLnNoZWxsUmVhZHkgPSBmYWxzZTtcbiAgICB0aGlzLmNhcmRzLmNsZWFyKCk7XG4gIH1cblxuICBwcml2YXRlIGVuc3VyZVNoZWxsKCk6IHZvaWQge1xuICAgIGlmICh0aGlzLnNoZWxsUmVhZHkgJiYgdGhpcy5yZXN1bHRzRWw/LmlzQ29ubmVjdGVkKSByZXR1cm47XG4gICAgY29uc3Qgcm9vdCA9IHRoaXMuY29udGVudEVsO1xuICAgIHJvb3QuZW1wdHkoKTtcbiAgICByb290LmFkZENsYXNzKFwib2JzZG4tc2lkZS1ncmVwXCIpO1xuXG4gICAgY29uc3QgdG9vbGJhciA9IHJvb3QuY3JlYXRlRGl2KHsgY2xzOiBcIm9ic2RuLXNpZGUtZ3JlcC10b29sYmFyXCIgfSk7XG4gICAgdG9vbGJhci5jcmVhdGVFbChcImg0XCIsIHsgdGV4dDogXCJTaWRlIEdyZXBcIiwgY2xzOiBcIm9ic2RuLXNpZGUtZ3JlcC10aXRsZVwiIH0pO1xuICAgIHRvb2xiYXIuY3JlYXRlRGl2KHsgY2xzOiBcIm9ic2RuLXNpZGUtZ3JlcC10b29sYmFyLXNwYWNlclwiIH0pO1xuICAgIHRoaXMuc3RhdHVzSWNvbiA9IHRvb2xiYXIuY3JlYXRlRGl2KHsgY2xzOiBcIm9ic2RuLXNpZGUtZ3JlcC1zdGF0dXMtaWNvblwiIH0pO1xuXG4gICAgdGhpcy5yZWZyZXNoQnV0dG9uID0gdG9vbGJhci5jcmVhdGVFbChcImJ1dHRvblwiLCB7XG4gICAgICBjbHM6IFwiY2xpY2thYmxlLWljb24gb2JzZG4tc2lkZS1ncmVwLXRvb2xiYXItYnV0dG9uXCIsXG4gICAgICBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBcIlx1NTIzN1x1NjVCMFx1NzZGOFx1NTE3M1x1NzI0N1x1NkJCNVwiLCB0aXRsZTogXCJcdTUyMzdcdTY1QjBcdTc2RjhcdTUxNzNcdTcyNDdcdTZCQjVcIiB9XG4gICAgfSk7XG4gICAgc2V0SWNvbih0aGlzLnJlZnJlc2hCdXR0b24sIFwicmVmcmVzaC1jd1wiKTtcbiAgICB0aGlzLnJlZnJlc2hCdXR0b24uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHRoaXMuYWN0aW9ucy5yZWZyZXNoQ3VycmVudFF1ZXJ5KCkpO1xuXG4gICAgdGhpcy5pbmRleEJ1dHRvbiA9IHRvb2xiYXIuY3JlYXRlRWwoXCJidXR0b25cIiwge1xuICAgICAgY2xzOiBcImNsaWNrYWJsZS1pY29uIG9ic2RuLXNpZGUtZ3JlcC10b29sYmFyLWJ1dHRvblwiLFxuICAgICAgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogXCJcdTkxQ0RcdTVFRkFcdTdEMjJcdTVGMTVcIiwgdGl0bGU6IFwiXHU5MUNEXHU1RUZBXHU3RDIyXHU1RjE1XCIgfVxuICAgIH0pO1xuICAgIHNldEljb24odGhpcy5pbmRleEJ1dHRvbiwgXCJkYXRhYmFzZVwiKTtcbiAgICB0aGlzLmluZGV4QnV0dG9uLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB2b2lkIHRoaXMuYWN0aW9ucy5yZWJ1aWxkSW5kZXgoKSk7XG5cbiAgICB0aGlzLmluZGV4UGFuZWwgPSByb290LmNyZWF0ZURpdih7IGNsczogXCJvYnNkbi1zaWRlLWdyZXAtaW5kZXgtcGFuZWxcIiB9KTtcbiAgICB0aGlzLmVtcHR5U3RhdGUgPSByb290LmNyZWF0ZURpdih7IGNsczogXCJvYnNkbi1zaWRlLWdyZXAtZW1wdHktc3RhdGVcIiB9KTtcbiAgICB0aGlzLnJlc3VsdHNFbCA9IHJvb3QuY3JlYXRlRGl2KHsgY2xzOiBcIm9ic2RuLXNpZGUtZ3JlcC1yZXN1bHRzXCIgfSk7XG4gICAgdGhpcy5zaGVsbFJlYWR5ID0gdHJ1ZTtcbiAgfVxuXG4gIHByaXZhdGUgdXBkYXRlVG9vbGJhcigpOiB2b2lkIHtcbiAgICB0aGlzLnN0YXR1c0ljb24ucmVtb3ZlQ2xhc3MoXCJpcy12aXNpYmxlXCIsIFwiaXMtc3Bpbm5pbmdcIiwgXCJpcy1lcnJvclwiKTtcbiAgICB0aGlzLnN0YXR1c0ljb24uZW1wdHkoKTtcblxuICAgIGNvbnN0IHRvb2x0aXAgPSB0aGlzLnN0YXRlLmxhdGVuY3lNcyA9PT0gdW5kZWZpbmVkXG4gICAgICA/IHRoaXMuc3RhdGUubWVzc2FnZVxuICAgICAgOiBgJHt0aGlzLnN0YXRlLm1lc3NhZ2V9IFx1MDBCNyBcdTY3MDBcdThGRDFcdTRFMDBcdTZCMjFcdTY3RTVcdThCRTIgJHt0aGlzLnN0YXRlLmxhdGVuY3lNcy50b0ZpeGVkKDApfSBtc2A7XG4gICAgdGhpcy5zdGF0dXNJY29uLnNldEF0dHJpYnV0ZShcInRpdGxlXCIsIHRvb2x0aXApO1xuICAgIHRoaXMuc3RhdHVzSWNvbi5zZXRBdHRyaWJ1dGUoXCJhcmlhLWxhYmVsXCIsIHRvb2x0aXApO1xuXG4gICAgaWYgKHRoaXMuc3RhdGUua2luZCA9PT0gXCJxdWVyeWluZ1wiIHx8IHRoaXMuc3RhdGUua2luZCA9PT0gXCJsb2FkaW5nLW1vZGVsXCIgfHwgdGhpcy5zdGF0ZS5raW5kID09PSBcImluZGV4aW5nXCIpIHtcbiAgICAgIHNldEljb24odGhpcy5zdGF0dXNJY29uLCBcImxvYWRlci1jaXJjbGVcIik7XG4gICAgICB0aGlzLnN0YXR1c0ljb24uYWRkQ2xhc3MoXCJpcy12aXNpYmxlXCIsIFwiaXMtc3Bpbm5pbmdcIik7XG4gICAgfSBlbHNlIGlmICh0aGlzLnN0YXRlLmtpbmQgPT09IFwib2xsYW1hLXVuYXZhaWxhYmxlXCIgfHwgdGhpcy5zdGF0ZS5raW5kID09PSBcInF1ZXJ5LWZhaWxlZFwiIHx8IHRoaXMuc3RhdGUua2luZCA9PT0gXCJpbmRleC1mYWlsZWRcIikge1xuICAgICAgc2V0SWNvbih0aGlzLnN0YXR1c0ljb24sIFwidHJpYW5nbGUtYWxlcnRcIik7XG4gICAgICB0aGlzLnN0YXR1c0ljb24uYWRkQ2xhc3MoXCJpcy12aXNpYmxlXCIsIFwiaXMtZXJyb3JcIik7XG4gICAgfVxuXG4gICAgY29uc3QgaW5kZXhBY3Rpb25WaXNpYmxlID0gQm9vbGVhbih0aGlzLnN0YXRlLmluZGV4QWN0aW9uKSB8fCB0aGlzLnN0YXRlLmtpbmQgPT09IFwiaW5kZXhpbmdcIjtcbiAgICB0aGlzLnJlZnJlc2hCdXR0b24uc3R5bGUuZGlzcGxheSA9IGluZGV4QWN0aW9uVmlzaWJsZSA/IFwibm9uZVwiIDogXCJcIjtcbiAgICB0aGlzLmluZGV4QnV0dG9uLnN0eWxlLmRpc3BsYXkgPSBpbmRleEFjdGlvblZpc2libGUgPyBcIm5vbmVcIiA6IFwiXCI7XG4gICAgdGhpcy5yZWZyZXNoQnV0dG9uLmRpc2FibGVkID0gdGhpcy5zdGF0ZS5raW5kID09PSBcImluZGV4aW5nXCI7XG4gICAgdGhpcy5pbmRleEJ1dHRvbi5kaXNhYmxlZCA9IHRoaXMuc3RhdGUua2luZCA9PT0gXCJpbmRleGluZ1wiO1xuICB9XG5cbiAgcHJpdmF0ZSB1cGRhdGVJbmRleFBhbmVsKCk6IHZvaWQge1xuICAgIHRoaXMuaW5kZXhQYW5lbC5lbXB0eSgpO1xuICAgIGNvbnN0IHNob3VsZFNob3cgPSB0aGlzLnN0YXRlLmtpbmQgPT09IFwiaW5kZXhpbmdcIiB8fCBCb29sZWFuKHRoaXMuc3RhdGUuaW5kZXhBY3Rpb24pO1xuICAgIHRoaXMuaW5kZXhQYW5lbC5zdHlsZS5kaXNwbGF5ID0gc2hvdWxkU2hvdyA/IFwiXCIgOiBcIm5vbmVcIjtcbiAgICBpZiAoIXNob3VsZFNob3cpIHJldHVybjtcblxuICAgIHRoaXMuaW5kZXhQYW5lbC5jcmVhdGVEaXYoeyBjbHM6IFwib2JzZG4tc2lkZS1ncmVwLWluZGV4LW1lc3NhZ2VcIiwgdGV4dDogdGhpcy5zdGF0ZS5tZXNzYWdlIH0pO1xuICAgIGlmICh0aGlzLnN0YXRlLmRldGFpbCkgdGhpcy5pbmRleFBhbmVsLmNyZWF0ZURpdih7IGNsczogXCJvYnNkbi1zaWRlLWdyZXAtc3RhdHVzLWRldGFpbFwiLCB0ZXh0OiB0aGlzLnN0YXRlLmRldGFpbCB9KTtcblxuICAgIGlmICh0aGlzLnN0YXRlLmtpbmQgPT09IFwiaW5kZXhpbmdcIikge1xuICAgICAgY29uc3QgcHJvZ3Jlc3MgPSB0aGlzLnN0YXRlLnByb2dyZXNzO1xuICAgICAgaWYgKHByb2dyZXNzKSB7XG4gICAgICAgIGNvbnN0IHByb2dyZXNzRWwgPSB0aGlzLmluZGV4UGFuZWwuY3JlYXRlRWwoXCJwcm9ncmVzc1wiLCB7IGNsczogXCJvYnNkbi1zaWRlLWdyZXAtcHJvZ3Jlc3NcIiB9KSBhcyBIVE1MUHJvZ3Jlc3NFbGVtZW50O1xuICAgICAgICBpZiAocHJvZ3Jlc3MucGhhc2UgIT09IFwic2F2aW5nXCIgJiYgcHJvZ3Jlc3MudG90YWwgPiAwKSB7XG4gICAgICAgICAgcHJvZ3Jlc3NFbC5tYXggPSBwcm9ncmVzcy50b3RhbDtcbiAgICAgICAgICBwcm9ncmVzc0VsLnZhbHVlID0gTWF0aC5taW4ocHJvZ3Jlc3MuY3VycmVudCwgcHJvZ3Jlc3MudG90YWwpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHByb2dyZXNzRWwucmVtb3ZlQXR0cmlidXRlKFwidmFsdWVcIik7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgZGV0YWlsID0gcHJvZ3Jlc3MucGhhc2UgPT09IFwic2F2aW5nXCJcbiAgICAgICAgICA/IFwiXHU2QjYzXHU1NzI4XHU0RkREXHU1QjU4XHU3RDIyXHU1RjE1XHUyMDI2XHUyMDI2XCJcbiAgICAgICAgICA6IGAke3Byb2dyZXNzLmN1cnJlbnR9IC8gJHtwcm9ncmVzcy50b3RhbH0gXHU0RTJBJHtwcm9ncmVzcy5waGFzZSA9PT0gXCJzY2FubmluZ1wiID8gXCJcdTY1ODdcdTRFRjZcIiA6IFwiXHU3MjQ3XHU2QkI1XCJ9YDtcbiAgICAgICAgdGhpcy5pbmRleFBhbmVsLmNyZWF0ZURpdih7IGNsczogXCJvYnNkbi1zaWRlLWdyZXAtcHJvZ3Jlc3MtZGV0YWlsXCIsIHRleHQ6IGRldGFpbCB9KTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IGNhbmNlbCA9IHRoaXMuaW5kZXhQYW5lbC5jcmVhdGVFbChcImJ1dHRvblwiLCB7IHRleHQ6IFwiXHU1M0Q2XHU2RDg4XCIsIGNsczogXCJvYnNkbi1zaWRlLWdyZXAtaW5kZXgtYWN0aW9uXCIgfSk7XG4gICAgICBjYW5jZWwuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHRoaXMuYWN0aW9ucy5jYW5jZWxJbmRleCgpKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBsYWJlbCA9IHRoaXMuc3RhdGUuaW5kZXhBY3Rpb24gPT09IFwiYnVpbGRcIiA/IFwiXHU1RUZBXHU3QUNCXHU3RDIyXHU1RjE1XCIgOiB0aGlzLnN0YXRlLmluZGV4QWN0aW9uID09PSBcInJldHJ5XCIgPyBcIlx1OTFDRFx1OEJENVwiIDogXCJcdTkxQ0RcdTVFRkFcdTdEMjJcdTVGMTVcIjtcbiAgICBjb25zdCBhY3Rpb24gPSB0aGlzLmluZGV4UGFuZWwuY3JlYXRlRWwoXCJidXR0b25cIiwgeyB0ZXh0OiBsYWJlbCwgY2xzOiBcIm9ic2RuLXNpZGUtZ3JlcC1pbmRleC1hY3Rpb25cIiB9KTtcbiAgICBhY3Rpb24uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHZvaWQgdGhpcy5hY3Rpb25zLnJlYnVpbGRJbmRleCgpKTtcbiAgfVxuXG4gIHByaXZhdGUgdXBkYXRlRW1wdHlTdGF0ZSgpOiB2b2lkIHtcbiAgICBjb25zdCBpbmRleFBhbmVsVmlzaWJsZSA9IHRoaXMuaW5kZXhQYW5lbC5zdHlsZS5kaXNwbGF5ICE9PSBcIm5vbmVcIjtcbiAgICBpZiAodGhpcy5yZXN1bHRzLmxlbmd0aCB8fCBpbmRleFBhbmVsVmlzaWJsZSkge1xuICAgICAgdGhpcy5lbXB0eVN0YXRlLnN0eWxlLmRpc3BsYXkgPSBcIm5vbmVcIjtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdGhpcy5lbXB0eVN0YXRlLnN0eWxlLmRpc3BsYXkgPSBcIlwiO1xuICAgIHRoaXMuZW1wdHlTdGF0ZS5zZXRUZXh0KHRoaXMuc3RhdGUua2luZCA9PT0gXCJjb21wbGV0ZVwiID8gXCJcdTZDQTFcdTY3MDlcdTYyN0VcdTUyMzBcdTc2RjhcdTUxNzNcdTcyNDdcdTZCQjVcIiA6IHRoaXMuc3RhdGUubWVzc2FnZSk7XG4gIH1cblxuICBwcml2YXRlIHJlY29uY2lsZVJlc3VsdHMobmV4dFJlc3VsdHM6IFNlYXJjaFJlc3VsdFtdKTogdm9pZCB7XG4gICAgY29uc3Qgc2Nyb2xsVG9wID0gdGhpcy5jb250ZW50RWwuc2Nyb2xsVG9wO1xuICAgIGNvbnN0IG5leHRJZHMgPSBuZXcgU2V0KG5leHRSZXN1bHRzLm1hcCgocmVzdWx0KSA9PiByZXN1bHQuaWQpKTtcbiAgICBmb3IgKGNvbnN0IFtpZCwgY2FyZF0gb2YgdGhpcy5jYXJkcykge1xuICAgICAgaWYgKG5leHRJZHMuaGFzKGlkKSkgY29udGludWU7XG4gICAgICBjYXJkLnJvb3QucmVtb3ZlKCk7XG4gICAgICB0aGlzLmNhcmRzLmRlbGV0ZShpZCk7XG4gICAgfVxuXG4gICAgbmV4dFJlc3VsdHMuZm9yRWFjaCgocmVzdWx0LCBpbmRleCkgPT4ge1xuICAgICAgbGV0IGNhcmQgPSB0aGlzLmNhcmRzLmdldChyZXN1bHQuaWQpO1xuICAgICAgaWYgKCFjYXJkKSB7XG4gICAgICAgIGNhcmQgPSB0aGlzLmNyZWF0ZVJlc3VsdENhcmQocmVzdWx0LCBpbmRleCk7XG4gICAgICAgIHRoaXMuY2FyZHMuc2V0KHJlc3VsdC5pZCwgY2FyZCk7XG4gICAgICB9XG4gICAgICB0aGlzLnVwZGF0ZVJlc3VsdENhcmQoY2FyZCwgcmVzdWx0LCBpbmRleCk7XG4gICAgICBjb25zdCBjdXJyZW50QXRJbmRleCA9IHRoaXMucmVzdWx0c0VsLmNoaWxkcmVuLml0ZW0oaW5kZXgpO1xuICAgICAgaWYgKGN1cnJlbnRBdEluZGV4ICE9PSBjYXJkLnJvb3QpIHRoaXMucmVzdWx0c0VsLmluc2VydEJlZm9yZShjYXJkLnJvb3QsIGN1cnJlbnRBdEluZGV4KTtcbiAgICB9KTtcblxuICAgIHRoaXMucmVzdWx0cyA9IG5leHRSZXN1bHRzO1xuICAgIHRoaXMuY29udGVudEVsLnNjcm9sbFRvcCA9IHNjcm9sbFRvcDtcbiAgfVxuXG4gIHByaXZhdGUgY3JlYXRlUmVzdWx0Q2FyZChyZXN1bHQ6IFNlYXJjaFJlc3VsdCwgaW5kZXg6IG51bWJlcik6IFJlc3VsdENhcmQge1xuICAgIGNvbnN0IHJvb3QgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGV0YWlsc1wiKTtcbiAgICByb290LmNsYXNzTmFtZSA9IFwib2JzZG4tc2lkZS1ncmVwLXJlc3VsdFwiO1xuICAgIGNvbnN0IHN1bW1hcnkgPSByb290LmNyZWF0ZUVsKFwic3VtbWFyeVwiKTtcbiAgICBjb25zdCBzY29yZSA9IHN1bW1hcnkuY3JlYXRlU3Bhbih7IGNsczogXCJvYnNkbi1zaWRlLWdyZXAtc2NvcmVcIiwgYXR0cjogeyB0aXRsZTogXCJcdTRGNTlcdTVGMjZcdTc2RjhcdTRGM0NcdTVFQTZcdUZGMENcdTRFMERcdTY2MkZcdTUxQzZcdTc4NkVcdTczODdcIiB9IH0pO1xuICAgIGNvbnN0IGZpbGUgPSBzdW1tYXJ5LmNyZWF0ZUVsKFwiYVwiLCB7XG4gICAgICBjbHM6IFwib2JzZG4tc2lkZS1ncmVwLWZpbGVcIixcbiAgICAgIGF0dHI6IHsgaHJlZjogXCIjXCIsIFwiYXJpYS1sYWJlbFwiOiBcIlx1NjI1M1x1NUYwMFx1Njc2NVx1NkU5MFx1RkYxQlx1NjJENlx1NTJBOFx1NTNFRlx1NjNEMlx1NTE2NVx1OTRGRVx1NjNBNVwiLCB0aXRsZTogXCJcdTYyNTNcdTVGMDBcdTY3NjVcdTZFOTBcdUZGMUJcdTYyRDZcdTUyQThcdTUzRUZcdTYzRDJcdTUxNjVcdTk0RkVcdTYzQTVcIiwgZHJhZ2dhYmxlOiBcInRydWVcIiB9XG4gICAgfSk7XG4gICAgY29uc3QgYnJlYWRjcnVtYiA9IHJvb3QuY3JlYXRlRGl2KHsgY2xzOiBcIm9ic2RuLXNpZGUtZ3JlcC1icmVhZGNydW1iXCIgfSk7XG4gICAgY29uc3QgZXhjZXJwdCA9IHJvb3QuY3JlYXRlRGl2KHsgY2xzOiBcIm9ic2RuLXNpZGUtZ3JlcC1leGNlcnB0LXdyYXBcIiB9KTtcbiAgICBjb25zdCBxdW90ZSA9IGV4Y2VycHQuY3JlYXRlRGl2KHsgY2xzOiBcIm9ic2RuLXNpZGUtZ3JlcC1leGNlcnB0IG1hcmtkb3duLXJlbmRlcmVkXCIgfSk7XG4gICAgY29uc3QgcXVvdGVBY3Rpb24gPSBleGNlcnB0LmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHtcbiAgICAgIGNsczogXCJjbGlja2FibGUtaWNvbiBvYnNkbi1zaWRlLWdyZXAtY2FyZC1hY3Rpb24gb2JzZG4tc2lkZS1ncmVwLXF1b3RlLWFjdGlvblwiLFxuICAgICAgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogXCJcdTVGMTVcdTc1MjhcdTcyNDdcdTZCQjVcdUZGMUJcdTYyRDZcdTUyQThcdTUzRUZcdTYzRDJcdTUxNjVcdTVGMTVcdTc1MjhcIiwgdGl0bGU6IFwiXHU1RjE1XHU3NTI4XHU3MjQ3XHU2QkI1XHVGRjFCXHU2MkQ2XHU1MkE4XHU1M0VGXHU2M0QyXHU1MTY1XHU1RjE1XHU3NTI4XCIsIGRyYWdnYWJsZTogXCJ0cnVlXCIgfVxuICAgIH0pO1xuICAgIHNldEljb24ocXVvdGVBY3Rpb24sIFwicXVvdGVcIik7XG4gICAgY29uc3QgY2FyZDogUmVzdWx0Q2FyZCA9IHsgcm9vdCwgZmlsZSwgc2NvcmUsIGJyZWFkY3J1bWIsIHF1b3RlLCByZXN1bHQsIGlnbm9yZU5leHRUb2dnbGU6IGZhbHNlIH07XG5cbiAgICBmaWxlLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoZXZlbnQpID0+IHtcbiAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICBldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgIHZvaWQgdGhpcy5hY3Rpb25zLm9wZW5SZXN1bHQoY2FyZC5yZXN1bHQpO1xuICAgIH0pO1xuICAgIGZpbGUuYWRkRXZlbnRMaXN0ZW5lcihcImRyYWdzdGFydFwiLCAoZXZlbnQpID0+IHRoaXMuc2V0RHJhZ1BheWxvYWQoZXZlbnQsIHRoaXMuYWN0aW9ucy5saW5rTWFya3VwKGNhcmQucmVzdWx0KSkpO1xuICAgIHF1b3RlQWN0aW9uLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLmFjdGlvbnMuaW5zZXJ0UXVvdGUoY2FyZC5yZXN1bHQsIHRoaXMuc2VsZWN0ZWRFeGNlcnB0KGNhcmQucXVvdGUpKSk7XG4gICAgcXVvdGVBY3Rpb24uYWRkRXZlbnRMaXN0ZW5lcihcImRyYWdzdGFydFwiLCAoZXZlbnQpID0+IHRoaXMuc2V0RHJhZ1BheWxvYWQoZXZlbnQsIHRoaXMuYWN0aW9ucy5xdW90ZU1hcmt1cChjYXJkLnJlc3VsdCwgdGhpcy5zZWxlY3RlZEV4Y2VycHQoY2FyZC5xdW90ZSkpKSk7XG4gICAgcm9vdC5hZGRFdmVudExpc3RlbmVyKFwidG9nZ2xlXCIsICgpID0+IHtcbiAgICAgIGlmIChjYXJkLmlnbm9yZU5leHRUb2dnbGUpIHtcbiAgICAgICAgY2FyZC5pZ25vcmVOZXh0VG9nZ2xlID0gZmFsc2U7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIGNhcmQubWFudWFsRXhwYW5zaW9uID0gcm9vdC5vcGVuO1xuICAgIH0pO1xuICAgIHJldHVybiBjYXJkO1xuICB9XG5cbiAgcHJpdmF0ZSB1cGRhdGVSZXN1bHRDYXJkKGNhcmQ6IFJlc3VsdENhcmQsIHJlc3VsdDogU2VhcmNoUmVzdWx0LCBpbmRleDogbnVtYmVyKTogdm9pZCB7XG4gICAgY2FyZC5yZXN1bHQgPSByZXN1bHQ7XG4gICAgaWYgKGNhcmQuZmlsZS50ZXh0Q29udGVudCAhPT0gcmVzdWx0LmZpbGVOYW1lKSBjYXJkLmZpbGUuc2V0VGV4dChyZXN1bHQuZmlsZU5hbWUpO1xuICAgIGNvbnN0IHNjb3JlID0gcmVzdWx0LnNpbWlsYXJpdHkudG9GaXhlZCgyKTtcbiAgICBpZiAoY2FyZC5zY29yZS50ZXh0Q29udGVudCAhPT0gc2NvcmUpIGNhcmQuc2NvcmUuc2V0VGV4dChzY29yZSk7XG4gICAgY29uc3QgYnJlYWRjcnVtYiA9IHJlc3VsdC5icmVhZGNydW1iLmpvaW4oXCIgXHUyMDNBIFwiKTtcbiAgICBpZiAoY2FyZC5icmVhZGNydW1iLnRleHRDb250ZW50ICE9PSBicmVhZGNydW1iKSBjYXJkLmJyZWFkY3J1bWIuc2V0VGV4dChicmVhZGNydW1iKTtcbiAgICBjYXJkLmJyZWFkY3J1bWIuc2V0QXR0cmlidXRlKFwidGl0bGVcIiwgYnJlYWRjcnVtYik7XG4gICAgY2FyZC5icmVhZGNydW1iLnN0eWxlLmRpc3BsYXkgPSBicmVhZGNydW1iID8gXCJcIiA6IFwibm9uZVwiO1xuICAgIGlmIChjYXJkLnJlbmRlcmVkSGFzaCAhPT0gcmVzdWx0LmNvbnRlbnRIYXNoKSB7XG4gICAgICBjYXJkLnJlbmRlcmVkSGFzaCA9IHJlc3VsdC5jb250ZW50SGFzaDtcbiAgICAgIGNhcmQucXVvdGUuZW1wdHkoKTtcbiAgICAgIHZvaWQgTWFya2Rvd25SZW5kZXJlci5yZW5kZXIodGhpcy5hcHAsIHJlc3VsdC50ZXh0LCBjYXJkLnF1b3RlLCByZXN1bHQuZmlsZVBhdGgsIHRoaXMpXG4gICAgICAgIC5jYXRjaCgoKSA9PiBjYXJkLnF1b3RlLnNldFRleHQocmVzdWx0LnRleHQpKTtcbiAgICB9XG5cbiAgICBjb25zdCBhdXRvT3BlbiA9IHNob3VsZEF1dG9FeHBhbmQoaW5kZXgsIHJlc3VsdC5zaW1pbGFyaXR5LCB0aGlzLmFjdGlvbnMuZXhwYW5zaW9uUG9saWN5KCkpO1xuICAgIGNvbnN0IGRlc2lyZWRPcGVuID0gY2FyZC5tYW51YWxFeHBhbnNpb24gPz8gYXV0b09wZW47XG4gICAgaWYgKGNhcmQucm9vdC5vcGVuICE9PSBkZXNpcmVkT3Blbikge1xuICAgICAgY2FyZC5pZ25vcmVOZXh0VG9nZ2xlID0gdHJ1ZTtcbiAgICAgIGNhcmQucm9vdC5vcGVuID0gZGVzaXJlZE9wZW47XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhbmltYXRlUmVzdWx0UmVmcmVzaCgpOiB2b2lkIHtcbiAgICB0aGlzLnJlc3VsdEFuaW1hdGlvbj8uY2FuY2VsKCk7XG4gICAgdGhpcy5yZXN1bHRBbmltYXRpb24gPSB0aGlzLnJlc3VsdHNFbC5hbmltYXRlKFxuICAgICAgW3sgb3BhY2l0eTogMC43MiB9LCB7IG9wYWNpdHk6IDEgfV0sXG4gICAgICB7IGR1cmF0aW9uOiAxNDAsIGVhc2luZzogXCJlYXNlLW91dFwiIH1cbiAgICApO1xuICB9XG5cbiAgcHJpdmF0ZSBzZWxlY3RlZEV4Y2VycHQocXVvdGU6IEhUTUxFbGVtZW50KTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgICBjb25zdCBzZWxlY3Rpb24gPSB3aW5kb3cuZ2V0U2VsZWN0aW9uKCk7XG4gICAgaWYgKCFzZWxlY3Rpb24gfHwgc2VsZWN0aW9uLmlzQ29sbGFwc2VkIHx8ICFzZWxlY3Rpb24ucmFuZ2VDb3VudCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICBjb25zdCByYW5nZSA9IHNlbGVjdGlvbi5nZXRSYW5nZUF0KDApO1xuICAgIGNvbnN0IGNvbnRhaW5lciA9IHJhbmdlLmNvbW1vbkFuY2VzdG9yQ29udGFpbmVyLm5vZGVUeXBlID09PSBOb2RlLlRFWFRfTk9ERVxuICAgICAgPyByYW5nZS5jb21tb25BbmNlc3RvckNvbnRhaW5lci5wYXJlbnRFbGVtZW50XG4gICAgICA6IHJhbmdlLmNvbW1vbkFuY2VzdG9yQ29udGFpbmVyIGFzIEVsZW1lbnQ7XG4gICAgcmV0dXJuIGNvbnRhaW5lciAmJiBxdW90ZS5jb250YWlucyhjb250YWluZXIpID8gc2VsZWN0aW9uLnRvU3RyaW5nKCkudHJpbSgpIHx8IHVuZGVmaW5lZCA6IHVuZGVmaW5lZDtcbiAgfVxuXG4gIHByaXZhdGUgc2V0RHJhZ1BheWxvYWQoZXZlbnQ6IERyYWdFdmVudCwgbWFya2Rvd246IHN0cmluZyk6IHZvaWQge1xuICAgIGlmICghZXZlbnQuZGF0YVRyYW5zZmVyKSByZXR1cm47XG4gICAgZXZlbnQuZGF0YVRyYW5zZmVyLmVmZmVjdEFsbG93ZWQgPSBcImNvcHlcIjtcbiAgICBldmVudC5kYXRhVHJhbnNmZXIuc2V0RGF0YShcInRleHQvcGxhaW5cIiwgbWFya2Rvd24pO1xuICAgIGV2ZW50LmRhdGFUcmFuc2Zlci5zZXREYXRhKFwidGV4dC9tYXJrZG93blwiLCBtYXJrZG93bik7XG4gIH1cbn1cbiIsICJleHBvcnQgaW50ZXJmYWNlIEV4cGFuc2lvblBvbGljeSB7XG4gIC8qKiAtMSBtZWFucyBhbGwgcmVzdWx0czsgMCBtZWFucyBhbGwgY29sbGFwc2VkLiAqL1xuICBjb3VudDogbnVtYmVyO1xuICB0aHJlc2hvbGRFbmFibGVkOiBib29sZWFuO1xuICB0aHJlc2hvbGQ6IG51bWJlcjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHNob3VsZEF1dG9FeHBhbmQoaW5kZXg6IG51bWJlciwgc2ltaWxhcml0eTogbnVtYmVyLCBwb2xpY3k6IEV4cGFuc2lvblBvbGljeSk6IGJvb2xlYW4ge1xuICBjb25zdCB3aXRoaW5Db3VudCA9IHBvbGljeS5jb3VudCA8IDAgfHwgaW5kZXggPCBwb2xpY3kuY291bnQ7XG4gIGNvbnN0IGFib3ZlVGhyZXNob2xkID0gIXBvbGljeS50aHJlc2hvbGRFbmFibGVkIHx8IHNpbWlsYXJpdHkgPj0gcG9saWN5LnRocmVzaG9sZDtcbiAgcmV0dXJuIHdpdGhpbkNvdW50ICYmIGFib3ZlVGhyZXNob2xkO1xufVxuIiwgImltcG9ydCB7IFNlYXJjaFJlc3VsdCB9IGZyb20gXCIuL3R5cGVzXCI7XG5cbi8qKiBTY29yZS1vbmx5IGNoYW5nZXMgY2FuIHVwZGF0ZSBpbiBwbGFjZS4gQSBzb2Z0IHJlZnJlc2ggaXMgcmVzZXJ2ZWQgZm9yIGFcbiAqIHZpc2libGUgY2hhbmdlIGluIG1lbWJlcnNoaXAsIG9yZGVyLCBzb3VyY2UsIG9yIGV4Y2VycHQgY29udGVudC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBoYXNNYXRlcmlhbFJlc3VsdENoYW5nZShcbiAgcHJldmlvdXM6IHJlYWRvbmx5IFNlYXJjaFJlc3VsdFtdLFxuICBuZXh0OiByZWFkb25seSBTZWFyY2hSZXN1bHRbXVxuKTogYm9vbGVhbiB7XG4gIGlmIChwcmV2aW91cy5sZW5ndGggIT09IG5leHQubGVuZ3RoKSByZXR1cm4gdHJ1ZTtcbiAgcmV0dXJuIHByZXZpb3VzLnNvbWUoKHJlc3VsdCwgaW5kZXgpID0+IHtcbiAgICBjb25zdCBjYW5kaWRhdGUgPSBuZXh0W2luZGV4XTtcbiAgICByZXR1cm4gIWNhbmRpZGF0ZSB8fFxuICAgICAgcmVzdWx0LmlkICE9PSBjYW5kaWRhdGUuaWQgfHxcbiAgICAgIHJlc3VsdC5jb250ZW50SGFzaCAhPT0gY2FuZGlkYXRlLmNvbnRlbnRIYXNoIHx8XG4gICAgICByZXN1bHQuZmlsZU5hbWUgIT09IGNhbmRpZGF0ZS5maWxlTmFtZSB8fFxuICAgICAgcmVzdWx0LnRleHQgIT09IGNhbmRpZGF0ZS50ZXh0IHx8XG4gICAgICByZXN1bHQuYnJlYWRjcnVtYi5qb2luKFwiXFx1MDAwMFwiKSAhPT0gY2FuZGlkYXRlLmJyZWFkY3J1bWIuam9pbihcIlxcdTAwMDBcIik7XG4gIH0pO1xufVxuIl0sCiAgIm1hcHBpbmdzIjogIjs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsSUFBQUEsbUJBQThGOzs7QUNBdkYsSUFBTSxrQkFBa0I7OztBQ2dCeEIsU0FBUyxXQUFXLE9BQXVCO0FBQ2hELE1BQUksSUFBSTtBQUNSLE1BQUksSUFBSTtBQUNSLFdBQVMsSUFBSSxHQUFHLElBQUksTUFBTSxRQUFRLEtBQUs7QUFDckMsUUFBSSxLQUFLLEtBQUssSUFBSSxNQUFNLFdBQVcsQ0FBQyxHQUFHLFFBQVU7QUFDakQsUUFBSSxLQUFLLEtBQUssSUFBSSxNQUFNLFdBQVcsQ0FBQyxHQUFHLFVBQVU7QUFBQSxFQUNuRDtBQUNBLFNBQU8sSUFBSSxNQUFNLEdBQUcsU0FBUyxFQUFFLEVBQUUsU0FBUyxHQUFHLEdBQUcsQ0FBQyxJQUFJLE1BQU0sR0FBRyxTQUFTLEVBQUUsRUFBRSxTQUFTLEdBQUcsR0FBRyxDQUFDO0FBQzdGO0FBRU8sU0FBUyxjQUFjLE9BQXNCO0FBQ2xELFFBQU0sVUFBVSxNQUFNLFdBQVcsU0FBUyxNQUFNLFdBQVcsS0FBSyxLQUFLLElBQUk7QUFDekUsU0FBTywyQkFBTyxNQUFNLFFBQVE7QUFBQSxvQkFBUSxPQUFPO0FBQUE7QUFBQSxFQUFVLE1BQU0sSUFBSTtBQUNqRTtBQUVBLFNBQVMsbUJBQW1CLE9BQTBEO0FBQ3BGLE1B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
