import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { chunkMarkdown } from "../src/chunker";
import { EmbeddingError, OllamaEmbeddingProvider } from "../src/embedding-provider";
import { shouldAutoExpand } from "../src/expansion-policy";
import { BuildCancellationController, IndexBuildCancelled } from "../src/build-cancellation";
import { indexBuildConfirmationModel, formatIndexBuildNumber } from "../src/index-build-confirmation";
import { FullIndexBuildRequestGate, runConfirmedIndexBuild } from "../src/index-build-flow";
import { DuplicateIndexChunkIdError, IndexBuildPlanStale, VaultRevision, executePreparedIndexBuild, prepareIndexBuild } from "../src/index-build-plan";
import { addExcludedDirectory, filterExcludedDirectoryCandidates, indexScope, isPathExcluded, sameIndexScope } from "../src/index-scope";
import { PersistentIndex } from "../src/persistent-index";
import { planIndexReconciliation } from "../src/index-reconciliation";
import { AutomaticWorkActions, AutomaticWorkCoordinator } from "../src/automatic-work";
import { QueryGate } from "../src/query-gate";
import { QueryLifecycleCoordinator } from "../src/query-lifecycle";
import { isValidQueryText, QuerySourceCoordinator } from "../src/query-source";
import { excerptExpansionControl, hasMaterialResultChange, resultExcerptStyle } from "../src/result-presentation";
import { cosineSimilarity, rankChunks } from "../src/retrieval";
import { resetSectionForSetting, resetSettingsSection, settingsSectionDiffersFromDefaults } from "../src/settings-reset";
import type { SideGrepSettings } from "../src/settings";
import { CHUNKER_VERSION, Chunk, IndexedChunk } from "../src/types";

const options = { targetLength: 120, maxLength: 180, minLength: 30 };
const identity = { model: "qwen3-embedding:0.6b", dimensions: 3, chunkerVersion: CHUNKER_VERSION, chunkTargetLength: 120, chunkMaxLength: 180, chunkMinLength: 30 };

function indexed(id: string, filePath: string, text: string, vector: number[]): IndexedChunk {
  return { id, contentHash: id, filePath, fileName: filePath.split("/").at(-1)!.replace(/\.md$/, ""), breadcrumb: [], text, startLine: 1, endLine: 1, vector };
}

function chunk(id: string, filePath: string, text: string, contentHash = id): Chunk {
  return { id, contentHash, filePath, fileName: filePath.split("/").at(-1)!.replace(/\.md$/, ""), breadcrumb: [], text, startLine: 1, endLine: 1 };
}

function buildPlan(chunks: Chunk[], reusable = new Map<string, IndexedChunk>(), overrides: Partial<{ totalMarkdownFiles: number; includedFiles: number; revision: number; scope: ReturnType<typeof indexScope>; identity: typeof identity }> = {}) {
  const byPath = new Map<string, Chunk[]>();
  for (const source of chunks) {
    const documentChunks = byPath.get(source.filePath);
    if (documentChunks) documentChunks.push(source);
    else byPath.set(source.filePath, [source]);
  }
  const documents = [...byPath].map(([filePath, documentChunks]) => ({
    filePath,
    fileName: documentChunks[0].fileName,
    sourceMtime: 1,
    sourceSize: 1,
    chunks: documentChunks
  }));
  const includedFiles = overrides.includedFiles ?? 2;
  while (documents.length < includedFiles) {
    const number = documents.length + 1;
    documents.push({ filePath: `empty-${number}.md`, fileName: `empty-${number}`, sourceMtime: 1, sourceSize: 0, chunks: [] });
  }
  return prepareIndexBuild({
    totalMarkdownFiles: overrides.totalMarkdownFiles ?? 3,
    documents,
    reusableById: reusable,
    vaultRevision: overrides.revision ?? 1,
    scope: overrides.scope ?? indexScope("Archive"),
    identity: overrides.identity ?? identity
  });
}

const defaultSettings: SideGrepSettings = {
  endpoint: "http://127.0.0.1:11434/api/embed",
  model: "qwen3-embedding:0.6b",
  dimensions: 1024,
  keepAlive: "5m",
  queryDebounceMs: 800,
  chunkTargetLength: 650,
  chunkMaxLength: 1100,
  chunkMinLength: 80,
  topK: 5,
  maxPerFile: 2,
  excludedDirectories: [".obsidian"],
  queryInstruction: "instruction",
  embeddingBatchSize: 16,
  autoExpandCount: 3,
  autoExpandThresholdEnabled: false,
  autoExpandThreshold: 0.3,
  resultExcerptFontScale: 0.92,
  resultExcerptLineHeight: 1.48,
  resultExcerptMaxLines: 10
};

test("Chinese fixture: frontmatter is excluded, headings form breadcrumbs, and line numbers are retained", async () => {
  const markdown = await readFile(new URL("./fixtures/chinese-notes.md", import.meta.url), "utf8");
  const chunks = chunkMarkdown("知识/测试.md", markdown, options);
  assert.equal(chunks.length, 3);
  assert.deepEqual(chunks[0].breadcrumb, ["Obsidian 与 Markdown"]);
  assert.deepEqual(chunks[1].breadcrumb, ["Obsidian 与 Markdown", "语义检索"]);
  assert.deepEqual(chunks[2].breadcrumb, ["烘焙与旅行"]);
  assert.ok(chunks.every((chunk) => !chunk.text.includes("tags:")));
  assert.equal(chunks[0].startLine, 6);
  assert.equal(chunks[1].startLine, 10);
});

test("chunker joins short adjacent paragraphs but splits long paragraphs and has stable IDs", () => {
  const short = "# 标题\n\n很短的一段。\n\n另一段也很短，但是组合起来足够作为一个有意义的知识片段。";
  const first = chunkMarkdown("a.md", short, { targetLength: 90, maxLength: 150, minLength: 50 });
  const second = chunkMarkdown("a.md", short, { targetLength: 90, maxLength: 150, minLength: 50 });
  assert.equal(first.length, 1);
  assert.equal(first[0].id, second[0].id);
  assert.equal(first[0].contentHash, second[0].contentHash);
  const long = chunkMarkdown("long.md", "# 长文\n\n" + "语义检索可以帮助写作者找回相关知识。".repeat(30), options);
  assert.ok(long.length > 1);
  assert.ok(long.every((chunk) => chunk.text.length <= options.maxLength));
});

test("chunk IDs distinguish repeated occurrences without making unrelated edits invalidate unique chunks", () => {
  const repeatedBody = "重复正文足够长，以便每个重复标题形成独立片段。";
  const repeatedHeadings = `# 重复标题\n\n${repeatedBody}\n\n# 重复标题\n\n${repeatedBody}`;
  const repeated = chunkMarkdown("repeated.md", repeatedHeadings, { targetLength: 20, maxLength: 100, minLength: 1 });
  assert.equal(repeated.length, 2);
  assert.deepEqual(repeated.map((chunk) => chunk.breadcrumb), [["重复标题"], ["重复标题"]]);
  assert.deepEqual(repeated.map((chunk) => chunk.text), [repeatedBody, repeatedBody]);
  assert.notEqual(repeated[0].id, repeated[1].id, "duplicate headings and body need distinct IDs");

  const sameLineSplit = chunkMarkdown("split.md", "# A\n\naaaaaaaa", { targetLength: 4, maxLength: 4, minLength: 1 });
  assert.deepEqual(sameLineSplit.map((chunk) => chunk.text), ["aaaa", "aaaa"]);
  assert.equal(sameLineSplit[0].startLine, sameLineSplit[1].startLine, "both chunks originate on one line");
  assert.notEqual(sameLineSplit[0].id, sameLineSplit[1].id, "same-line duplicate fragments need distinct IDs");

  const stableAgain = chunkMarkdown("repeated.md", repeatedHeadings, { targetLength: 20, maxLength: 100, minLength: 1 });
  assert.deepEqual(repeated.map((chunk) => chunk.id), stableAgain.map((chunk) => chunk.id), "same input has stable IDs");

  const literalSeparator = chunkMarkdown("breadcrumb.md", "# A > B\n\n正文", { targetLength: 20, maxLength: 100, minLength: 1 });
  const nestedHeadings = chunkMarkdown("breadcrumb.md", "# A\n\n## B\n\n正文", { targetLength: 20, maxLength: 100, minLength: 1 });
  assert.notEqual(literalSeparator[0].id, nestedHeadings[0].id, "breadcrumb structure is part of identity");

  const unique = "唯一且足够长的后续正文，应该保留其缓存身份。";
  const original = chunkMarkdown("stable.md", `# 标题\n\n${unique}`, { targetLength: 20, maxLength: 100, minLength: 1 });
  const inserted = chunkMarkdown("stable.md", `\n\n无关但足够长的前置正文。\n\n# 标题\n\n${unique}`, { targetLength: 20, maxLength: 100, minLength: 1 });
  assert.equal(original[0].id, inserted.find((chunk) => chunk.text === unique)?.id, "unrelated leading content must not change a unique chunk ID");

  const index = new PersistentIndex(identity);
  assert.doesNotThrow(() => index.fullReplacement(identity, repeated.map((chunk) => ({ ...chunk, vector: [1, 0, 0] })), indexScope([])), "fixed duplicate-content chunks are accepted by PersistentIndex");
});

test("query source uses one complete buffer or one complete selection with no local truncation", () => {
  const source = new QuerySourceCoordinator();
  const fullBuffer = "# 标题\n\n" + "完整笔记内容。".repeat(500);
  assert.deepEqual(source.sourceForCurrentSelection(fullBuffer, ""), { kind: "document", text: fullBuffer });
  assert.ok(fullBuffer.length > 1400);
  const selection = "完整选区内容。".repeat(200);
  const action = source.selectionButton(selection);
  assert.deepEqual(action, { kind: "one-shot", source: { kind: "selection-once", text: selection } });
  assert.equal(isValidQueryText("  一二三四五六七  "), false);
  assert.equal(isValidQueryText("一二三四五六七八"), true);
});

test("selection button distinguishes one-shot, short selection, and follow mode", () => {
  const source = new QuerySourceCoordinator();
  assert.deepEqual(source.selectionButton(""), { kind: "follow-enabled" });
  assert.equal(source.isFollowingSelection, true);
  assert.deepEqual(source.selectionButton("任意文本"), { kind: "follow-disabled" });
  assert.equal(source.isFollowingSelection, false);
  assert.deepEqual(source.selectionButton("短选区"), { kind: "short-selection" });
  assert.equal(source.isFollowingSelection, false);
  assert.deepEqual(source.selectionButton("足够长的选区文本用于即时查询"), {
    kind: "one-shot", source: { kind: "selection-once", text: "足够长的选区文本用于即时查询" }
  });
  assert.equal(source.isFollowingSelection, false);
});

test("follow selection waits for valid text and stays active until explicitly disabled", () => {
  const source = new QuerySourceCoordinator();
  source.selectionButton("");
  assert.equal(source.sourceForCurrentSelection("全文内容足够长", ""), undefined);
  assert.equal(source.presentation("").kind, "waiting");
  assert.deepEqual(source.sourceForCurrentSelection("全文内容足够长", "新的有效选区内容"), {
    kind: "selection-follow", text: "新的有效选区内容"
  });
  assert.equal(source.isFollowingSelection, true);
  assert.equal(source.presentation("新的有效选区内容").kind, "following");
});

test("adopting a document source clears a completed one-shot scope without changing follow mode", () => {
  const source = new QuerySourceCoordinator();
  const oneShot = source.selectionButton("足够长的选区文本用于单次查询");
  assert.equal(oneShot.kind, "one-shot");
  if (oneShot.kind === "one-shot") source.adopt(oneShot.source);
  assert.equal(source.presentation("").kind, "once");
  assert.deepEqual(source.sourceForCurrentSelection("仅计算的全文候选", ""), { kind: "document", text: "仅计算的全文候选" });
  assert.equal(source.presentation("").kind, "once", "candidate lookup has no range-label side effect");
  source.adopt({ kind: "document", text: "切换笔记后的完整正文" });
  assert.deepEqual(source.presentation(""), {
    kind: "document", text: "查询范围：当前笔记", tooltip: "开启跟随选区查询"
  });

  source.selectionButton("");
  source.adopt({ kind: "document", text: "跟随模式中的候选全文不应关闭模式" });
  assert.equal(source.isFollowingSelection, true);
  assert.equal(source.presentation("").kind, "waiting");
});

test("one-shot document adoption covers file-switch and refresh semantics", () => {
  const source = new QuerySourceCoordinator();
  const beginOneShot = () => {
    const action = source.selectionButton("足够长的选区文本用于单次查询");
    assert.equal(action.kind, "one-shot");
    if (action.kind === "one-shot") source.adopt(action.source);
  };
  beginOneShot();
  source.adopt({ kind: "document", text: "另一篇笔记的完整 buffer" });
  assert.equal(source.presentation("").kind, "document", "file switch schedules document source");
  beginOneShot();
  source.adopt({ kind: "document", text: "刷新当前笔记的完整 buffer" });
  assert.equal(source.presentation("").kind, "document", "refresh schedules document source");
});

test("follow selection presentation distinguishes no, whitespace, short, and valid selections", () => {
  const source = new QuerySourceCoordinator();
  source.selectionButton("");
  assert.equal(source.presentation("").text, "查询模式：跟随选区 · 等待选择");
  assert.equal(source.presentation("   \n").text, "查询模式：跟随选区 · 至少选择 8 个非空白字符");
  assert.equal(source.presentation("短选区").text, "查询模式：跟随选区 · 至少选择 8 个非空白字符");
  assert.equal(source.presentation("足够长的有效选区文本").text, "查询模式：跟随选区");
  assert.equal(source.presentation("短选区").tooltip, "关闭跟随选区查询");
});

function automaticActions(overrides: Partial<AutomaticWorkActions> = {}): { actions: AutomaticWorkActions; log: string[] } {
  const log: string[] = [];
  return {
    log,
    actions: {
      suspend: () => { log.push("suspend"); },
      needsReconciliation: () => false,
      reconcile: async () => { log.push("reconcile"); },
      hasPendingChanges: () => false,
      isIndexUpdateActive: () => false,
      flush: async () => { log.push("flush"); },
      query: () => { log.push("query"); },
      ...overrides
    }
  };
}

test("automatic work visibility suspends once at the final hidden view and keeps one visible view allowed", async () => {
  const automatic = new AutomaticWorkCoordinator<object>();
  const first = {};
  const second = {};
  const { actions, log } = automaticActions();
  assert.equal(automatic.allowed, false);
  await automatic.resume(actions);
  assert.deepEqual(log, [], "no visible view cannot start automatic work");
  assert.equal(automatic.visibilityChanged(first, false, actions), "none");
  assert.equal(automatic.visibilityChanged(first, true, actions), "resume");
  await automatic.resume(actions);
  assert.equal(automatic.visibilityChanged(first, true, actions), "none");
  assert.equal(automatic.visibilityChanged(second, true, actions), "none");
  assert.equal(automatic.visibilityChanged(first, false, actions), "none");
  assert.equal(automatic.allowed, true);
  assert.equal(automatic.visibilityChanged(second, false, actions), "suspend");
  assert.equal(automatic.visibilityChanged(second, false, actions), "none");
  assert.equal(automatic.allowed, false);
  assert.deepEqual(log, ["query", "suspend"]);
});

test("automatic work runs reconciliation then queued flush then one query", async () => {
  const automatic = new AutomaticWorkCoordinator<object>();
  let reconciliation = true;
  let pending = false;
  const { actions, log } = automaticActions({
    needsReconciliation: () => reconciliation,
    reconcile: async () => { log.push("reconcile"); reconciliation = false; pending = true; },
    hasPendingChanges: () => pending,
    flush: async () => { log.push("flush"); pending = false; }
  });
  automatic.visibilityChanged({}, true, actions);
  await automatic.resume(actions);
  assert.deepEqual(log, ["reconcile", "flush", "query"]);
});

test("automatic work skips flush/query after hiding during reconciliation and invalidates old query work", async () => {
  const automatic = new AutomaticWorkCoordinator<object>();
  const view = {};
  const gate = new QueryGate();
  const old = gate.begin();
  let release: () => void = () => undefined;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  const { actions, log } = automaticActions({
    suspend: () => { log.push("suspend"); gate.invalidate(); },
    needsReconciliation: () => true,
    reconcile: async () => { log.push("reconcile"); await wait; },
    hasPendingChanges: () => true
  });
  automatic.visibilityChanged(view, true, actions);
  await Promise.resolve();
  automatic.visibilityChanged(view, false, actions);
  release();
  await automatic.resume(actions);
  assert.equal(gate.isCurrent(old), false);
  assert.deepEqual(log, ["reconcile", "suspend"]);
});

test("automatic work deduplicates simultaneous resumes and retries after an active index update", async () => {
  const automatic = new AutomaticWorkCoordinator<object>();
  let active = true;
  const { actions, log } = automaticActions({ isIndexUpdateActive: () => active });
  const view = {};
  automatic.visibilityChanged(view, true, actions);
  await Promise.all([automatic.resume(actions), automatic.resume(actions)]);
  assert.deepEqual(log, []);
  active = false;
  automatic.indexUpdateCompleted(actions);
  await automatic.resume(actions);
  assert.deepEqual(log, ["query"]);
});

test("cosine, ordering, per-file cap, exclusion, and duplicate removal", () => {
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.equal(cosineSimilarity(new Float32Array([1, 0]), new Float32Array([1, 0])), 1);
  const ranked = rankChunks([1, 0, 0], [
    indexed("self", "current.md", "self", [1, 0, 0]),
    indexed("a1", "a.md", "语义检索", [0.99, 0.01, 0]),
    indexed("a2", "a.md", "另一个相近段落", [0.8, 0.6, 0]),
    indexed("a3", "a.md", "第三段", [0.7, 0.7, 0]),
    indexed("dup", "b.md", "语义检索", [0.96, 0.04, 0]),
    indexed("c", "c.md", "烘焙", [0, 1, 0])
  ], { topK: 5, maxPerFile: 2, excludePath: "current.md" });
  assert.deepEqual(ranked.map((result) => result.id), ["a1", "a2", "c"]);
  assert.ok(ranked[0].similarity >= ranked[1].similarity);
});

test("query gate prevents stale asynchronous completions from winning", async () => {
  const gate = new QueryGate();
  const old = gate.begin();
  const newer = gate.begin();
  const completed: string[] = [];
  await Promise.all([
    Promise.resolve().then(() => { if (gate.isCurrent(old)) completed.push("old"); }),
    Promise.resolve().then(() => { if (gate.isCurrent(newer)) completed.push("new"); })
  ]);
  assert.deepEqual(completed, ["new"]);
});

test("model or dimensions changes make a persisted index incompatible", () => {
  const saved = { identity, chunks: [indexed("x", "a.md", "text", [1, 0, 0])], updatedAt: 1 };
  const index = new PersistentIndex(identity, saved);
  assert.equal(index.isCompatible(identity), true);
  assert.equal(index.isCompatible({ ...identity, dimensions: 4 }), false);
  assert.equal(index.isCompatible({ ...identity, model: "other" }), false);
});

test("legacy excluded-directory strings migrate to a normalized structured scope", () => {
  assert.deepEqual(indexScope(".obsidian, templates"), { excludedDirectories: [".obsidian", "templates"] });
});

test("settings-section reset restores only its defaults and reports non-default sections", () => {
  const changed: SideGrepSettings = {
    ...defaultSettings,
    endpoint: "http://other/api/embed",
    model: "other-model",
    topK: 9,
    excludedDirectories: ["Archive"]
  };
  assert.equal(settingsSectionDiffersFromDefaults(changed, defaultSettings, "embedding"), true);
  assert.equal(settingsSectionDiffersFromDefaults(changed, defaultSettings, "retrieval"), true);
  assert.equal(settingsSectionDiffersFromDefaults(changed, defaultSettings, "scope"), true);
  assert.equal(settingsSectionDiffersFromDefaults(changed, defaultSettings, "chunking"), false);

  const embeddingRestored = resetSettingsSection(changed, defaultSettings, "embedding");
  assert.equal(embeddingRestored.endpoint, defaultSettings.endpoint);
  assert.equal(embeddingRestored.model, defaultSettings.model);
  assert.equal(embeddingRestored.topK, 9, "other sections remain untouched");
  assert.deepEqual(embeddingRestored.excludedDirectories, ["Archive"]);
});

test("scope reset copies default directories instead of sharing mutable settings arrays", () => {
  const restored = resetSettingsSection(
    { ...defaultSettings, excludedDirectories: ["Archive"] },
    defaultSettings,
    "scope"
  );
  assert.deepEqual(restored.excludedDirectories, [".obsidian"]);
  assert.notStrictEqual(restored.excludedDirectories, defaultSettings.excludedDirectories);
  restored.excludedDirectories.push("Templates");
  assert.deepEqual(defaultSettings.excludedDirectories, [".obsidian"]);
});

test("every editable setting maps to the reset control for its own section", () => {
  assert.equal(resetSectionForSetting("model"), "embedding");
  assert.equal(resetSectionForSetting("queryDebounceMs"), "query");
  assert.equal(resetSectionForSetting("chunkMaxLength"), "chunking");
  assert.equal(resetSectionForSetting("topK"), "retrieval");
  assert.equal(resetSectionForSetting("autoExpandThreshold"), "expansion");
  assert.equal(resetSectionForSetting("embeddingBatchSize"), "indexBuild");
  assert.equal(resetSectionForSetting("queryInstruction"), "queryInstruction");
  assert.equal(resetSectionForSetting("excludedDirectories"), "scope");
  assert.equal(resetSectionForSetting("resultExcerptFontScale"), "appearance");
});

test("result excerpt density uses relative typography and removes the clamp for full text", () => {
  const presentation = { fontScale: 0.92, lineHeight: 1.48, maxLines: 10 };
  assert.deepEqual(resultExcerptStyle(presentation, false), {
    fontSize: "0.92em", lineHeight: "1.48", maxHeight: "14.8em"
  });
  assert.deepEqual(resultExcerptStyle(presentation, true), {
    fontSize: "0.92em", lineHeight: "1.48", maxHeight: undefined
  });
  assert.equal(resultExcerptStyle({ ...presentation, maxLines: 0 }, false).maxHeight, undefined);
  assert.deepEqual(excerptExpansionControl(10, false, false), { expandable: false, expanded: false, label: "展开全文" });
  assert.deepEqual(excerptExpansionControl(10, true, false), { expandable: true, expanded: false, label: "展开全文" });
  assert.deepEqual(excerptExpansionControl(10, true, true), { expandable: true, expanded: true, label: "收起全文" });
  assert.deepEqual(excerptExpansionControl(0, true, true), { expandable: false, expanded: false, label: "展开全文" });
});

test("index scope normalizes multiline paths, separators, empty entries, duplicates, and order", () => {
  assert.deepEqual(
    indexScope(" /Archive/ \nTemplates\\drafts, Archive, , /Templates/drafts/ "),
    { excludedDirectories: ["Archive", "Templates/drafts"] }
  );
  assert.deepEqual(indexScope(["z", "a", "m"]), { excludedDirectories: ["a", "m", "z"] });
});

test("excluded-directory matching respects path boundaries", () => {
  const scope = indexScope(["Archive"]);
  assert.equal(isPathExcluded("Archive", scope), true);
  assert.equal(isPathExcluded("Archive/a.md", scope), true);
  assert.equal(isPathExcluded("Archive2/a.md", scope), false);
});

test("scope equality is independent of input ordering", () => {
  assert.equal(sameIndexScope(indexScope(["Templates", "Archive"]), indexScope(["Archive", "Templates"])), true);
});

test("directory selection adds a normal directory in stable normalized order", () => {
  assert.deepEqual(addExcludedDirectory(["Templates"], "Archive"), ["Archive", "Templates"]);
});

test("directory selection does not add duplicate directories or children of excluded parents", () => {
  assert.deepEqual(addExcludedDirectory(["Archive"], "Archive"), ["Archive"]);
  assert.deepEqual(addExcludedDirectory(["Archive"], "Archive/2024"), ["Archive"]);
});

test("selecting a parent directory removes already excluded child directories", () => {
  assert.deepEqual(addExcludedDirectory(["Archive/2024", "Templates", "Archive/2023"], "Archive"), ["Archive", "Templates"]);
});

test("directory selection respects path boundaries and rejects the vault root", () => {
  assert.deepEqual(addExcludedDirectory(["Archive2"], "Archive"), ["Archive", "Archive2"]);
  assert.deepEqual(addExcludedDirectory(["Archive"], "Archive2"), ["Archive", "Archive2"]);
  assert.deepEqual(addExcludedDirectory(["Archive"], "/"), ["Archive"]);
});

test("directory picker candidates exclude the root and directories already covered by an exclusion", () => {
  assert.deepEqual(
    filterExcludedDirectoryCandidates(["", "Archive", "Archive/2023", "Archive2", "Templates"], ["Archive"]),
    ["Archive2", "Templates"]
  );
  assert.deepEqual(
    filterExcludedDirectoryCandidates(["Archive", "Archive/2023", "Archive/2024"], ["Archive/2023", "Archive/2024"]),
    ["Archive"]
  );
});

test("prepared build summarizes file counts and classifies only exact cached chunks as reusable", () => {
  const first = chunk("first", "a.md", "first", "hash-a");
  const changed = chunk("changed", "b.md", "changed", "hash-new");
  const plan = buildPlan([first, changed], new Map([
    ["first", { ...indexed("first", "old-folder/a.md", "first", [1, 0, 0]), contentHash: "hash-a", fileName: "a" }],
    ["changed", indexed("changed", "b.md", "old changed", [0, 1, 0])]
  ]));
  assert.deepEqual(plan.summary, {
    totalMarkdownFiles: 3,
    excludedFiles: 1,
    includedFiles: 2,
    totalChunks: 2,
    reusableChunks: 1,
    pendingChunks: 1,
    skippedDocuments: 0,
    scope: indexScope("Archive"),
    model: identity.model,
    dimensions: identity.dimensions
  });
  assert.equal(plan.summary.totalChunks, plan.summary.reusableChunks + plan.summary.pendingChunks);
});

test("full-build plans derive included files from document snapshots and reject impossible totals", () => {
  const documents = [
    { filePath: "a.md", fileName: "a", sourceMtime: 1, sourceSize: 1, chunks: [chunk("a", "a.md", "a")] },
    { filePath: "empty.md", fileName: "empty", sourceMtime: 1, sourceSize: 0, chunks: [] }
  ];
  const input = { totalMarkdownFiles: 2, documents, reusableById: new Map<string, IndexedChunk>(), vaultRevision: 1, scope: indexScope([]), identity };
  assert.equal(prepareIndexBuild(input).summary.includedFiles, 2);
  assert.throws(() => prepareIndexBuild({ ...input, totalMarkdownFiles: 1 }), /must include every scanned document/);
});

test("index-build confirmation uses distinct initial/rebuild copy and shows every prepared summary field", () => {
  const plan = buildPlan([chunk("a", "a.md", "a")], new Map(), {
    totalMarkdownFiles: 1038,
    includedFiles: 712,
    scope: indexScope(["Archive", "Templates"])
  });
  const initial = indexBuildConfirmationModel(plan.summary, false);
  const rebuild = indexBuildConfirmationModel(plan.summary, true);
  assert.equal(initial.title, "准备建立索引");
  assert.equal(initial.confirmLabel, "开始建立");
  assert.equal(rebuild.title, "准备全量重建");
  assert.equal(rebuild.confirmLabel, "开始重建");
  assert.deepEqual(initial.lines.map((line) => line.label), [
    "Markdown 文件", "排除文件", "参与索引", "预计片段", "可复用向量",
    "需要生成向量", "模型", "向量维度", "排除目录"
  ]);
  assert.equal(initial.lines.find((line) => line.label === "Markdown 文件")?.value, "1,038");
  assert.equal(initial.lines.find((line) => line.label === "排除目录")?.value, "Archive、Templates");
  assert.equal(formatIndexBuildNumber(5846), "5,846");
});

test("index-build confirmation names an empty exclusion scope and fully reusable vectors", () => {
  const reusable = indexed("a", "a.md", "fresh", [1, 0, 0]);
  const plan = buildPlan([chunk("a", "a.md", "fresh")], new Map([["a", reusable]]), {
    totalMarkdownFiles: 1,
    includedFiles: 1,
    scope: indexScope([])
  });
  const model = indexBuildConfirmationModel(plan.summary, false);
  assert.equal(model.lines.find((line) => line.label === "排除目录")?.value, "未排除目录");
  assert.equal(model.noEmbeddingMessage, "所有向量均可复用，本次无需重新生成向量。");
});

test("confirmed full-build flow does not execute on cancellation and executes once after confirmation", async () => {
  const plan = buildPlan([chunk("a", "a.md", "a")]);
  let executeCalls = 0;
  const cancelled = await runConfirmedIndexBuild({
    prepare: async () => plan,
    confirm: async () => false,
    execute: async () => { executeCalls++; }
  });
  assert.equal(cancelled, "cancelled");
  assert.equal(executeCalls, 0);

  const executed = await runConfirmedIndexBuild({
    prepare: async () => plan,
    confirm: async () => true,
    execute: async () => { executeCalls++; }
  });
  assert.equal(executed, "executed");
  assert.equal(executeCalls, 1);
});

test("confirmed full-build flow preserves stale-plan validation before any embedding", async () => {
  const plan = buildPlan([chunk("a", "a.md", "a")]);
  let embeddingCalls = 0;
  await assert.rejects(() => runConfirmedIndexBuild({
    prepare: async () => plan,
    confirm: async () => true,
    execute: async (prepared) => {
      await executePreparedIndexBuild(prepared, {
        current: { vaultRevision: 2, identity, scope: indexScope("Archive") },
        batchSize: 1,
        embedDocuments: async () => { embeddingCalls++; return [[1, 0, 0]]; },
        assertCanContinue: () => undefined,
        yieldToUi: async () => undefined
      });
    }
  }), IndexBuildPlanStale);
  assert.equal(embeddingCalls, 0);
});

test("full-build request gate merges overlapping requests, including confirmation time", async () => {
  const gate = new FullIndexBuildRequestGate();
  let starts = 0;
  let release: () => void = () => undefined;
  const blocker = new Promise<void>((resolve) => { release = resolve; });
  const first = gate.request(async () => { starts++; await blocker; });
  const second = gate.request(async () => { starts++; });
  assert.strictEqual(first, second);
  await Promise.resolve();
  assert.equal(starts, 1);
  assert.equal(gate.isActive, true);
  release();
  await first;
  assert.equal(gate.isActive, false);
});

test("prepared build executes pending chunks only, keeps scan order, and retains fresh chunk metadata", async () => {
  const first = chunk("first", "new-folder/a.md", "fresh text", "hash-a");
  const pending = chunk("pending", "b.md", "embed me", "hash-b");
  const cached = { ...indexed("first", "old-folder/a.md", "fresh text", [1, 0, 0]), contentHash: "hash-a", fileName: "a" };
  const plan = buildPlan([first, pending], new Map([["first", cached]]));
  const requested: string[][] = [];
  const pendingVector = [0, 1, 0];
  const executed = await executePreparedIndexBuild(plan, {
    current: { vaultRevision: 1, identity, scope: indexScope("Archive") },
    batchSize: 10,
    embedDocuments: async (chunks) => {
      requested.push(chunks.map((item) => item.id));
      return [pendingVector];
    },
    assertCanContinue: () => undefined,
    yieldToUi: async () => undefined
  });
  assert.deepEqual(requested, [["pending"]]);
  const executedChunks = executed.documents.flatMap((document) => document.chunks);
  assert.deepEqual(executedChunks.map((item) => item.id), ["first", "pending"]);
  assert.equal(executedChunks[0].filePath, "new-folder/a.md");
  assert.equal(executedChunks[0].text, "fresh text");
  assert.deepEqual(executedChunks.map((item) => item.vector), [[1, 0, 0], [0, 1, 0]]);
  assert.strictEqual(executedChunks[0].vector, cached.vector, "reusable vectors share the formal-index reference");
  assert.equal(Object.isFrozen(cached.vector), false, "planning does not freeze or otherwise mutate the formal-index vector");
  assert.notStrictEqual(executedChunks[0], cached, "new scan metadata never reuses the old IndexedChunk object");
  assert.strictEqual(executedChunks[1].vector, pendingVector, "new embedding vectors are not copied again before the candidate");
  assert.deepEqual(executed.scope, indexScope("Archive"));
});

test("full-build execution returns only its document scan snapshot, including empty documents", async () => {
  const scanned = [
    { filePath: "scanned.md", fileName: "scanned", sourceMtime: 10, sourceSize: 20, chunks: [chunk("scanned", "scanned.md", "body")] },
    { filePath: "empty.md", fileName: "empty", sourceMtime: 11, sourceSize: 0, chunks: [] }
  ];
  const plan = prepareIndexBuild({
    totalMarkdownFiles: 2,
    documents: scanned,
    reusableById: new Map(),
    vaultRevision: 7,
    scope: indexScope([]),
    identity
  });
  const executed = await executePreparedIndexBuild(plan, {
    current: { vaultRevision: 7, identity, scope: indexScope([]) },
    batchSize: 1,
    embedDocuments: async () => [[1, 0, 0]],
    assertCanContinue: () => undefined,
    yieldToUi: async () => undefined
  });
  assert.deepEqual(executed.documents.map(({ filePath, sourceMtime, sourceSize, chunks }) => ({ filePath, sourceMtime, sourceSize, chunks: chunks.length })), [
    { filePath: "scanned.md", sourceMtime: 10, sourceSize: 20, chunks: 1 },
    { filePath: "empty.md", sourceMtime: 11, sourceSize: 0, chunks: 0 }
  ]);
  const reconciliation = planIndexReconciliation(
    executed.documents.map(({ filePath, fileName, sourceMtime, sourceSize }) => ({ filePath, fileName, sourceMtime, sourceSize })),
    [
      { path: "scanned.md", mtime: 12, size: 20 },
      { path: "empty.md", mtime: 11, size: 0 },
      { path: "added-after-scan.md", mtime: 13, size: 1 }
    ]
  );
  assert.deepEqual(reconciliation.added, ["added-after-scan.md"]);
  assert.deepEqual(reconciliation.statChanged, ["scanned.md"]);
  assert.equal(executed.documents.some((document) => document.filePath === "added-after-scan.md"), false);
});

test("a skipped document remains in the full-build result without requesting an embedding", async () => {
  const scanned = { filePath: "good.md", fileName: "good", sourceMtime: 1, sourceSize: 4, chunks: [chunk("good", "good.md", "good")] };
  const skipped = { filePath: "bad.md", fileName: "bad", sourceMtime: 2, sourceSize: 8, reasonCode: "invalid-chunk-structure" as const };
  const plan = prepareIndexBuild({
    totalMarkdownFiles: 2,
    documents: [scanned],
    skippedDocuments: [skipped],
    reusableById: new Map(),
    vaultRevision: 1,
    scope: indexScope([]),
    identity
  });
  let embedded: string[] = [];
  const executed = await executePreparedIndexBuild(plan, {
    current: { vaultRevision: 1, identity, scope: indexScope([]) },
    batchSize: 1,
    embedDocuments: async (chunks) => { embedded = chunks.map((item) => item.filePath); return [[1, 0, 0]]; },
    assertCanContinue: () => undefined,
    yieldToUi: async () => undefined
  });
  assert.deepEqual(embedded, ["good.md"]);
  assert.deepEqual(executed.skippedDocuments, [skipped]);
  assert.equal(plan.summary.skippedDocuments, 1);
  assert.equal(plan.summary.excludedFiles, 0);
});

test("empty vault and fully reusable plans do not request document embeddings", async () => {
  const empty = buildPlan([], new Map(), { totalMarkdownFiles: 0, includedFiles: 0 });
  assert.deepEqual(empty.summary, {
    totalMarkdownFiles: 0, excludedFiles: 0, includedFiles: 0,
    totalChunks: 0, reusableChunks: 0, pendingChunks: 0,
    skippedDocuments: 0,
    scope: indexScope("Archive"), model: identity.model, dimensions: identity.dimensions
  });
  let calls = 0;
  const reusable = buildPlan([chunk("a", "a.md", "a")], new Map([["a", indexed("a", "a.md", "a", [1, 0, 0])]]));
  const executed = await executePreparedIndexBuild(reusable, {
    current: { vaultRevision: 1, identity, scope: indexScope("Archive") }, batchSize: 2,
    embedDocuments: async () => { calls++; return []; }, assertCanContinue: () => undefined, yieldToUi: async () => undefined
  });
  assert.equal(calls, 0);
  assert.equal(executed.documents.flatMap((document) => document.chunks).length, 1);
});

test("duplicate chunk IDs fail during prepare with both contexts before embedding", () => {
  const first = { ...chunk("duplicate", "first.md", "first text"), breadcrumb: ["First"], startLine: 4 };
  const second = { ...chunk("duplicate", "second.md", "second text"), breadcrumb: ["Second"], startLine: 8 };
  let embeddingCalls = 0;
  assert.throws(() => {
    void embeddingCalls;
    buildPlan([first, second]);
  }, (error: unknown) => error instanceof DuplicateIndexChunkIdError &&
    error.message.includes("first.md") && error.message.includes("second.md") &&
    error.message.includes("First") && error.message.includes("Second") &&
    error.message.includes("first text") && error.message.includes("second text"));
  assert.equal(embeddingCalls, 0);
});

test("vault revision, identity, and desired scope changes stale a plan before embedding", async () => {
  const revision = new VaultRevision();
  const plan = buildPlan([chunk("a", "a.md", "a")], new Map(), { revision: revision.value });
  revision.noteChange(); // create, modify, or delete all use this production revision seam.
  const staleStates = [
    { vaultRevision: revision.value, identity, scope: indexScope("Archive") },
    { vaultRevision: 0, identity: { ...identity, model: "other" }, scope: indexScope("Archive") },
    { vaultRevision: 0, identity, scope: indexScope("Templates") }
  ];
  for (const current of staleStates) {
    let embeddingCalls = 0;
    await assert.rejects(() => executePreparedIndexBuild(plan, {
      current, batchSize: 1,
      embedDocuments: async () => { embeddingCalls++; return [[1, 0, 0]]; },
      assertCanContinue: () => undefined, yieldToUi: async () => undefined
    }), IndexBuildPlanStale);
    assert.equal(embeddingCalls, 0);
  }
});

test("prepare rejects changes discovered at scan completion instead of returning a stale plan", () => {
  const base = {
    totalMarkdownFiles: 1,
    documents: [{ filePath: "a.md", fileName: "a", sourceMtime: 1, sourceSize: 1, chunks: [chunk("a", "a.md", "a")] }],
    reusableById: new Map<string, IndexedChunk>(),
    vaultRevision: 4,
    scope: indexScope("Archive"),
    identity
  };
  assert.throws(() => prepareIndexBuild({ ...base, currentState: () => ({ vaultRevision: 5, identity, scope: indexScope("Archive") }) }), (error: unknown) => error instanceof IndexBuildPlanStale && error.reason === "vault");
  assert.throws(() => prepareIndexBuild({ ...base, currentState: () => ({ vaultRevision: 4, identity: { ...identity, dimensions: 4 }, scope: indexScope("Archive") }) }), (error: unknown) => error instanceof IndexBuildPlanStale && error.reason === "identity");
  assert.throws(() => prepareIndexBuild({ ...base, currentState: () => ({ vaultRevision: 4, identity, scope: indexScope("Templates") }) }), (error: unknown) => error instanceof IndexBuildPlanStale && error.reason === "scope");
});

test("a cancelled preparation token is finished before the next independent execution token starts", () => {
  const cancellation = new BuildCancellationController();
  const preparation = cancellation.startBuild();
  cancellation.cancelCurrentBuild();
  assert.throws(() => cancellation.assertBuildCanContinue(preparation), IndexBuildCancelled);
  cancellation.finishBuild(preparation);

  const execution = cancellation.startBuild();
  assert.doesNotThrow(() => cancellation.assertBuildCanContinue(execution));
  cancellation.finishBuild(execution);
});

test("ordinary cancellation stops at the durable full-commit boundary while unload remains active", () => {
  const cancellation = new BuildCancellationController();
  const build = cancellation.startBuild();
  cancellation.beginDurableCommit(build);
  cancellation.cancelCurrentBuild();
  assert.doesNotThrow(() => cancellation.assertBuildCanContinue(build));
  cancellation.unload();
  assert.throws(() => cancellation.assertPluginActive(), IndexBuildCancelled);
  assert.throws(() => cancellation.assertBuildCanContinue(build), IndexBuildCancelled);
});

test("cancelled or failed plan execution produces no candidate to replace the existing index", async () => {
  const existing = new PersistentIndex(identity);
  existing.commit(existing.fullReplacement(identity, [indexed("old", "old.md", "old", [1, 0, 0])], indexScope("Archive")));
  const plan = buildPlan([chunk("new", "new.md", "new")]);
  await assert.rejects(() => executePreparedIndexBuild(plan, {
    current: { vaultRevision: 1, identity, scope: indexScope("Archive") }, batchSize: 1,
    embedDocuments: async () => { throw new Error("embedding failed"); },
    assertCanContinue: () => undefined, yieldToUi: async () => undefined
  }), /embedding failed/);
  assert.deepEqual(existing.chunks.map((item) => item.id), ["old"]);
  assert.deepEqual(existing.scope, indexScope("Archive"));

  let embeddingCalls = 0;
  await assert.rejects(() => executePreparedIndexBuild(plan, {
    current: { vaultRevision: 1, identity, scope: indexScope("Archive") }, batchSize: 1,
    embedDocuments: async () => { embeddingCalls++; return [[1, 0, 0]]; },
    assertCanContinue: () => { throw new IndexBuildCancelled(); }, yieldToUi: async () => undefined
  }), IndexBuildCancelled);
  assert.equal(embeddingCalls, 0);
  assert.deepEqual(existing.scope, indexScope("Archive"));
});

test("legacy completed indexes gain the settings scope without becoming incompatible", () => {
  const legacy = new PersistentIndex(identity, {
    identity,
    chunks: [indexed("x", "a.md", "text", [1, 0, 0])],
    updatedAt: 1
  }, indexScope(".obsidian, Archive"));
  assert.equal(legacy.lifecycle(identity), "ready");
  assert.deepEqual(legacy.scope, indexScope(["Archive", ".obsidian"]));
  assert.equal(legacy.serialize().schemaVersion, 3);
  assert.deepEqual(legacy.serialize().scope, indexScope(["Archive", ".obsidian"]));
  assert.equal(legacy.scopeStatus(indexScope(["Archive", "Templates"])), "pending");
});

test("changing desired scope leaves the hard-compatibility lifecycle ready", () => {
  const index = new PersistentIndex(identity);
  index.commit(index.fullReplacement(identity, [indexed("old", "a.md", "text", [1, 0, 0])], indexScope("Archive")));
  assert.equal(index.lifecycle(identity), "ready");
  assert.equal(index.scopeStatus(indexScope("Templates")), "pending");
});

test("only a successful full replacement commits its scope; cancellation, failure, and incremental replacements preserve the prior scope", () => {
  const index = new PersistentIndex(identity);
  const oldScope = indexScope("Archive");
  index.commit(index.fullReplacement(identity, [indexed("old", "a.md", "text", [1, 0, 0])], oldScope));

  const cancelledCandidate = index.fullReplacement(identity, [indexed("cancelled", "b.md", "text", [1, 0, 0])], indexScope("Templates"));
  // A cancelled full build deliberately never commits its candidate.
  void cancelledCandidate;
  assert.deepEqual(index.scope, oldScope);

  const failedCandidate = index.fullReplacement(identity, [indexed("failed", "b.md", "text", [1, 0, 0])], indexScope("Failed"));
  // A failed full build also deliberately never commits its candidate.
  void failedCandidate;
  assert.deepEqual(index.scope, oldScope);

  index.commit(index.incrementalReplacement(identity, [...index.chunks, indexed("incremental", "b.md", "text", [1, 0, 0])]));
  assert.deepEqual(index.scope, oldScope);

  const newScope = indexScope("Templates");
  index.commit(index.fullReplacement(identity, [indexed("new", "c.md", "text", [1, 0, 0])], newScope));
  assert.deepEqual(index.scope, newScope);
  assert.equal(index.scopeStatus(newScope), "current");
});

test("model, dimensions, chunker version, and all chunk lengths remain hard incompatible", () => {
  const index = new PersistentIndex(identity, {
    identity,
    chunks: [indexed("x", "a.md", "text", [1, 0, 0])],
    updatedAt: 1
  }, indexScope([]));
  assert.equal(index.isCompatible({ ...identity, model: "other" }), false);
  assert.equal(index.isCompatible({ ...identity, dimensions: 4 }), false);
  assert.equal(index.isCompatible({ ...identity, chunkerVersion: "other" }), false);
  assert.equal(index.isCompatible({ ...identity, chunkTargetLength: 121 }), false);
  assert.equal(index.isCompatible({ ...identity, chunkMaxLength: 181 }), false);
  assert.equal(index.isCompatible({ ...identity, chunkMinLength: 31 }), false);
});

test("an index made with an older chunker version is incompatible", () => {
  const oldIdentity = { ...identity, chunkerVersion: "1" };
  const oldIndex = new PersistentIndex(identity, { identity: oldIdentity, chunks: [], updatedAt: 1 });
  assert.equal(oldIndex.isCompatible(identity), false);
  assert.equal(oldIndex.lifecycle(identity), "incompatible");
});

test("legacy completed indexes migrate to ready, while an empty completed vault is also ready", () => {
  const legacy = new PersistentIndex(identity, { identity, chunks: [indexed("x", "a.md", "text", [1, 0, 0])], updatedAt: 1 });
  assert.equal(legacy.lifecycle(identity), "ready");
  const emptyCompleted = new PersistentIndex(identity, { identity, chunks: [], updatedAt: 1 });
  assert.equal(emptyCompleted.lifecycle(identity), "ready");
  assert.equal(emptyCompleted.size, 0);
});

test("an index is uninitialized until a full build is committed, and cancellation leaves the old index intact", () => {
  const index = new PersistentIndex(identity);
  assert.equal(index.lifecycle(identity), "uninitialized");
  assert.equal(index.scopeStatus(indexScope("Archive")), "uninitialized");
  const old = index.fullReplacement(identity, [indexed("old", "a.md", "text", [1, 0, 0])], indexScope([]));
  index.commit(old);
  const cancelledReplacement = index.fullReplacement(identity, [indexed("new", "b.md", "text", [1, 0, 0])], indexScope([]));
  // A cancelled rebuild intentionally does not commit or save its candidate.
  void cancelledReplacement;
  assert.equal(index.lifecycle(identity), "ready");
  assert.deepEqual(index.chunks.map((chunk) => chunk.id), ["old"]);
});

test("cancelling one rebuild does not leak into a later independent incremental commit", () => {
  const cancellation = new BuildCancellationController();
  const index = new PersistentIndex(identity, { identity, chunks: [indexed("old", "a.md", "text", [1, 0, 0])], updatedAt: 1 });
  const cancelledBuild = cancellation.startBuild();
  cancellation.cancelCurrentBuild();
  assert.throws(() => cancellation.assertBuildCanContinue(cancelledBuild), IndexBuildCancelled);
  cancellation.finishBuild(cancelledBuild);

  // This is the same token-free commit permission used by a Vault incremental
  // update after the cancelled build has ended.
  assert.doesNotThrow(() => cancellation.assertCommitCanProceed());
  index.commit(index.incrementalReplacement(identity, [...index.chunks, indexed("incremental", "b.md", "text", [1, 0, 0])]));
  assert.deepEqual(index.chunks.map((chunk) => chunk.id), ["old", "incremental"]);

  const nextBuild = cancellation.startBuild();
  assert.doesNotThrow(() => cancellation.assertBuildCanContinue(nextBuild), "a new rebuild gets a fresh token");
});

test("plugin unload blocks both build and incremental commits", () => {
  const cancellation = new BuildCancellationController();
  const build = cancellation.startBuild();
  cancellation.unload();
  assert.throws(() => cancellation.assertBuildCanContinue(build), IndexBuildCancelled);
  assert.throws(() => cancellation.assertCommitCanProceed(), IndexBuildCancelled);
});

test("lifecycle coordinator only schedules queries when the index is ready", () => {
  const lifecycle = new QueryLifecycleCoordinator("uninitialized");
  lifecycle.noteMarkdownActivated();
  assert.equal(lifecycle.editorChanged(), undefined, "typing must not launch an incremental/index query before first build");
  assert.equal(lifecycle.sidebarOpened(), undefined);
  lifecycle.indexReady();
  assert.deepEqual(lifecycle.sidebarOpened(), { immediate: true, reason: "sidebar-open" });
});

test("lifecycle coordinator schedules markdown activation, layout restore, and index completion without typing", () => {
  const lifecycle = new QueryLifecycleCoordinator("ready");
  assert.deepEqual(lifecycle.layoutReady(), undefined, "there is no remembered Markdown editor yet");
  assert.deepEqual(lifecycle.noteMarkdownActivated(), { immediate: true, reason: "file-open" });
  assert.deepEqual(lifecycle.layoutReady(), { immediate: true, reason: "layout-ready" });
  assert.deepEqual(lifecycle.indexReady(), { immediate: true, reason: "index-ready" });
});

test("non-Markdown leaf activation preserves the most recent Markdown query context", () => {
  const lifecycle = new QueryLifecycleCoordinator("ready");
  lifecycle.noteMarkdownActivated();
  assert.equal(lifecycle.nonMarkdownLeafActivated(), undefined);
  assert.deepEqual(lifecycle.sidebarOpened(), { immediate: true, reason: "sidebar-open" });
});

test("normal typing remains debounced, while file/sidebar/index lifecycle events are immediate", () => {
  const lifecycle = new QueryLifecycleCoordinator("ready");
  lifecycle.noteMarkdownActivated();
  assert.deepEqual(lifecycle.editorChanged(), { immediate: false, reason: "typing" });
  assert.deepEqual(lifecycle.noteMarkdownActivated(), { immediate: true, reason: "file-open" });
  assert.deepEqual(lifecycle.sidebarOpened(), { immediate: true, reason: "sidebar-open" });
  assert.deepEqual(lifecycle.indexReady(), { immediate: true, reason: "index-ready" });
});

test("result presentation refreshes for rank/content changes but not score-only updates", () => {
  const previous = [
    { ...indexed("a", "a.md", "A", [1, 0, 0]), similarity: 0.61 },
    { ...indexed("b", "b.md", "B", [1, 0, 0]), similarity: 0.60 }
  ];
  assert.equal(hasMaterialResultChange(previous, previous.map((result) => ({ ...result, similarity: result.similarity + 0.01 }))), false);
  assert.equal(hasMaterialResultChange(previous, [previous[1], previous[0]]), true);
  assert.equal(hasMaterialResultChange(previous, [{ ...previous[0], text: "changed" }, previous[1]]), true);
});

test("auto expansion combines rank count, all mode, and an optional similarity threshold", () => {
  assert.equal(shouldAutoExpand(0, 0.2, { count: 3, thresholdEnabled: false, threshold: 0.5 }), true);
  assert.equal(shouldAutoExpand(3, 0.9, { count: 3, thresholdEnabled: false, threshold: 0.5 }), false);
  assert.equal(shouldAutoExpand(8, 0.8, { count: -1, thresholdEnabled: true, threshold: 0.5 }), true);
  assert.equal(shouldAutoExpand(1, 0.4, { count: 3, thresholdEnabled: true, threshold: 0.5 }), false);
  assert.equal(shouldAutoExpand(0, 0.9, { count: 0, thresholdEnabled: false, threshold: 0 }), false);
});

test("Ollama HTTP 200 with empty embeddings is rejected", async () => {
  const provider = new OllamaEmbeddingProvider({ endpoint: "http://test/api/embed", model: "model", dimensions: 3, keepAlive: "5m", queryInstruction: "instruction" }, async () => ({ status: 200, text: '{"embeddings":[]}' }));
  await assert.rejects(provider.embedDocuments(["文档"]), (error: unknown) => error instanceof EmbeddingError && error.kind === "validation");
});

test("Ollama embedding vectors are normalized to Float32Array at the provider edge", async () => {
  const provider = new OllamaEmbeddingProvider({ endpoint: "http://test/api/embed", model: "model", dimensions: 3, keepAlive: "5m", queryInstruction: "instruction" }, async () => ({ status: 200, text: '{"embeddings":[[0.25,0.5,0.75]]}' }));
  const response = await provider.embedDocuments(["文档"]);
  assert.ok(response.vectors[0] instanceof Float32Array);
  assert.deepEqual([...response.vectors[0]], [0.25, 0.5, 0.75]);
});
