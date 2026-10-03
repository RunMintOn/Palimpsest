import assert from "node:assert/strict";
import test from "node:test";
import { EmbeddingError } from "../src/embedding-provider";
import { createRetrievalApi, queryFailure } from "../src/text-query-api";
import { HybridRetrieval } from "../src/hybrid-retrieval";
import type { IndexedChunk } from "../src/types";

const chunk = (id: string, filePath: string, text: string, vector = [1, 0]): IndexedChunk =>
  ({ id, filePath, fileName: filePath, text, vector, breadcrumb: [], contentHash: id, startLine: 3, endLine: 5 });

test("text query restricts recall before ranking and returns one excerpt per file without a source index", async () => {
  const retrieval = new HybridRetrieval("api-restricted");
  const chunks = [
    ...Array.from({ length: 230 }, (_, i) => chunk(`outside-${i}`, "outside.md", "检索记忆", [1, 0])),
    chunk("a1", "a.md", "检索记忆的旧记录", [0, 1]),
    chunk("a2", "a.md", "另一段记忆", [0, 1]),
    chunk("b", "b.md", "不同内容", [-1, 0])
  ];
  const snapshot = { chunks, retrieval, embedQuery: async () => [1, 0], isCurrent: () => true };
  const api = createRetrievalApi({ snapshot: () => snapshot, knownPendingUpdates: () => true });
  try {
    const response = await api.query({ text: "检索记忆", sourcePath: "new.md", candidatePaths: ["a.md", "b.md"], limit: 5 });
    assert.equal(response.ok, true);
    if (!response.ok) return;
    assert.deepEqual(response.results.map(r => r.filePath), ["a.md", "b.md"]);
    assert.deepEqual(response.results[0], { filePath: "a.md", excerpt: { text: "检索记忆的旧记录", startLine: 3, endLine: 5 } });
    assert.equal(response.knownPendingUpdates, true);
  } finally { retrieval.close(); }
});

test("invalid requests fail explicitly and an empty candidate set never embeds", async () => {
  const retrieval = new HybridRetrieval("api-input");
  const chunks = [chunk("a", "a.md", "一段正文")];
  const api = createRetrievalApi({ snapshot: () => ({ chunks, retrieval, isCurrent: () => true, embedQuery: async () => { throw Error("Must not embed"); } }), knownPendingUpdates: () => false });
  const valid = { text: "a", sourcePath: "source.md", candidatePaths: [] };
  try {
    for (const patch of [{ text: " " }, { text: "x".repeat(16001) }, { limit: 0 }, { limit: 21 }, { limit: 1.5 }, { sourcePath: "/tmp/a.md" }, { sourcePath: "C:\\a.md" }, { candidatePaths: ["../a.md"] }, { candidatePaths: ["*.md"] }]) {
      const response = await api.query({ ...valid, ...patch });
      assert.equal(response.ok, false, JSON.stringify(patch));
      if (!response.ok) assert.equal(response.code, "invalid-input");
    }
    assert.deepEqual(await api.query(valid), { ok: true, results: [], knownPendingUpdates: false });
    assert.deepEqual(await api.query({ ...valid, candidatePaths: ["source.md", "not-indexed.md"] }), { ok: true, results: [], knownPendingUpdates: false });
  } finally { retrieval.close(); }
});

test("index and unsafe lifecycle failures are not empty successes", async () => {
  for (const code of ["index-needed", "index-incompatible", "temporarily-unavailable", "backend-unavailable"] as const) {
    const api = createRetrievalApi({ snapshot: () => queryFailure(code, "操作提示"), knownPendingUpdates: () => false });
    assert.deepEqual(await api.query({ text: "test", sourcePath: "a.md", candidatePaths: [] }), { ok: false, code, message: "操作提示" });
  }
});

test("a changed generation or unloaded instance cannot publish an in-flight success", async () => {
  const retrieval = new HybridRetrieval("api-lifetime");
  let current = true;
  let resolve!: (vector: number[]) => void;
  const api = createRetrievalApi({ snapshot: () => ({ chunks: [chunk("a", "a.md", "正文")], retrieval, isCurrent: () => current, embedQuery: () => new Promise(r => { resolve = r; }) }), knownPendingUpdates: () => false });
  try {
    const pending = api.query({ text: "正文", sourcePath: "source.md", candidatePaths: ["a.md"] });
    current = false;
    resolve([1, 0]);
    const response = await pending;
    assert.equal(response.ok, false);
    if (!response.ok) assert.equal(response.code, "temporarily-unavailable");
    assert.equal((await api.query({ text: "正文", sourcePath: "source.md", candidatePaths: [] })).ok, false);
  } finally { retrieval.close(); }
});

test("external requests and an obsolete sidebar query share cache without cancelling each other", async () => {
  const retrieval = new HybridRetrieval("api-concurrent");
  const chunks = Array.from({ length: 260 }, (_, i) => chunk(`c-${i}`, `file-${i}.md`, `记忆 ${i}`));
  let sidebarCurrent = true;
  const api = createRetrievalApi({ snapshot: () => ({ chunks, retrieval, isCurrent: () => true, embedQuery: async () => [1, 0] }), knownPendingUpdates: () => false });
  try {
    const sidebar = retrieval.search("记忆", [1, 0], chunks, { topK: 5, maxPerFile: 2 }, () => sidebarCurrent, () => true);
    const obsolete = assert.rejects(sidebar, /失效/);
    const a = api.query({ text: "记忆", sourcePath: "source.md", candidatePaths: ["file-259.md"] });
    const b = api.query({ text: "记忆", sourcePath: "file-259.md", candidatePaths: ["file-258.md", "file-259.md"] });
    sidebarCurrent = false;
    const responses = await Promise.all([a, b]);
    await obsolete;
    assert.deepEqual(responses.map(r => r.ok ? r.results.map(x => x.filePath) : r.code), [["file-259.md"], ["file-258.md"]]);
  } finally { retrieval.close(); }
});

test("normalized candidate paths and the maximum text budget remain usable", async () => {
  const retrieval = new HybridRetrieval("api-normalized");
  const chunks = [chunk("a", "space/a.md", "检索记录"), chunk("source", "space/source.md", "来源正文")];
  const api = createRetrievalApi({ snapshot: () => ({ chunks, retrieval, isCurrent: () => true, embedQuery: async () => [1, 0] }), knownPendingUpdates: () => false });
  try {
    const response = await api.query({ text: "x".repeat(16000), sourcePath: "space/./source.md", candidatePaths: ["space//a.md", "space/a.md", "space/source.md"], limit: 20 });
    assert.equal(response.ok, true);
    if (response.ok) assert.deepEqual(response.results.map(r => r.filePath), ["space/a.md"]);
  } finally { retrieval.close(); }
});

test("bounded recall expands past a file occupying the initial candidate pool", async () => {
  const retrieval = new HybridRetrieval("api-expansion");
  const chunks = [...Array.from({ length: 205 }, (_, i) => chunk(`a-${i}`, "a.md", `片段 ${i}`)), chunk("b", "b.md", "最后一篇不同内容", [0, 1])];
  const api = createRetrievalApi({ snapshot: () => ({ chunks, retrieval, isCurrent: () => true, embedQuery: async () => [1, 0] }), knownPendingUpdates: () => false });
  try {
    const response = await api.query({ text: "NOMATCH", sourcePath: "source.md", candidatePaths: ["a.md", "b.md"], limit: 2 });
    assert.equal(response.ok, true);
    if (response.ok) assert.deepEqual(response.results.map(r => r.filePath), ["a.md", "b.md"]);
  } finally { retrieval.close(); }
});

test("model and native failures return stable failure codes", async () => {
  for (const error of [new EmbeddingError("Ollama offline", "connection"), new Error("model rejected")]) {
    const retrieval = new HybridRetrieval("api-model-error");
    const api = createRetrievalApi({ snapshot: () => ({ chunks: [chunk("a", "a.md", "正文")], retrieval, isCurrent: () => true, embedQuery: async () => { throw error; } }), knownPendingUpdates: () => false });
    try {
      const response = await api.query({ text: "正文", sourcePath: "new.md", candidatePaths: ["a.md"] });
      assert.equal(response.ok, false);
      if (!response.ok) assert.equal(response.code, error instanceof EmbeddingError ? "backend-unavailable" : "query-failed");
    } finally { retrieval.close(); }
  }
  const retrieval = new HybridRetrieval("api-native-error", () => { throw Error("native missing"); });
  const api = createRetrievalApi({ snapshot: () => ({ chunks: [chunk("a", "a.md", "正文")], retrieval, isCurrent: () => true, embedQuery: async () => [1, 0] }), knownPendingUpdates: () => false });
  try {
    const response = await api.query({ text: "正文", sourcePath: "new.md", candidatePaths: ["a.md"] });
    assert.equal(response.ok, false);
    if (!response.ok) assert.equal(response.code, "backend-unavailable");
  } finally { retrieval.close(); }
});
