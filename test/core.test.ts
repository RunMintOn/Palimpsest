import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { chunkMarkdown } from "../src/chunker";
import { EmbeddingError, OllamaEmbeddingProvider } from "../src/embedding-provider";
import { shouldAutoExpand } from "../src/expansion-policy";
import { BuildCancellationController, IndexBuildCancelled } from "../src/build-cancellation";
import { PersistentIndex } from "../src/persistent-index";
import { buildQueryContext } from "../src/query-context";
import { QueryGate } from "../src/query-gate";
import { QueryLifecycleCoordinator } from "../src/query-lifecycle";
import { hasMaterialResultChange } from "../src/result-presentation";
import { cosineSimilarity, rankChunks } from "../src/retrieval";
import { CHUNKER_VERSION, IndexedChunk } from "../src/types";

const options = { targetLength: 120, maxLength: 180, minLength: 30 };
const identity = { model: "qwen3-embedding:0.6b", dimensions: 3, chunkerVersion: CHUNKER_VERSION, chunkTargetLength: 120, chunkMaxLength: 180, chunkMinLength: 30 };

function indexed(id: string, filePath: string, text: string, vector: number[]): IndexedChunk {
  return { id, contentHash: id, filePath, fileName: filePath.replace(/\.md$/, ""), breadcrumb: [], text, startLine: 1, endLine: 1, vector };
}

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

test("query context uses current paragraph, heading, and prior paragraph with a length bound", () => {
  const markdown = "# 语义检索\n\n前一个段落讨论 embedding 如何编码中文知识。\n\n当前段落讨论在 Obsidian 编辑时实时召回相关片段。\n\n下一段";
  const context = buildQueryContext(markdown, 4, 300);
  assert.equal(context.heading, "语义检索");
  assert.match(context.query, /前一个段落/);
  assert.match(context.query, /当前段落/);
  assert.ok(context.query.length <= 300);
  assert.ok(buildQueryContext(markdown, 4, 20).query.length <= 20);
});

test("cosine, ordering, per-file cap, exclusion, and duplicate removal", () => {
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
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
  const old = index.replacement(identity, [indexed("old", "a.md", "text", [1, 0, 0])]);
  index.commit(old);
  const cancelledReplacement = index.replacement(identity, [indexed("new", "b.md", "text", [1, 0, 0])]);
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
  index.commit(index.replacement(identity, [...index.chunks, indexed("incremental", "b.md", "text", [1, 0, 0])]));
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
