import assert from "node:assert/strict";
import test from "node:test";
import { HybridRetrieval } from "../src/hybrid-retrieval";
import { chunkMarkdown } from "../src/chunker";

const chunks = () => [
  ["工具.md", "---\nsecret: HIDDENYAML\n---\n# 后端\n\nPalimpsest 混合检索帮助发现旧笔记原文。"],
  ["回顾.md", "# 个人回顾\n\n回顾过去的生活经历和思考过程。"]
].flatMap(([path, text]) => chunkMarkdown(path, text, { targetLength: 650, maxLength: 1100, minLength: 8 }).map((c, i) => ({ ...c, vector: path === "工具.md" ? [0, 1] : [1, 0] })));

test("real Jieba search feeds the original chunks into hybrid results without indexing YAML", async () => {
  const retrieval = new HybridRetrieval("test-jieba");
  try {
    const snapshot = chunks();
    const result = await retrieval.search("Palimpsest 混合检索", [1, 0], snapshot, { topK: 2, maxPerFile: 1 }, () => true);
    assert.equal(result[0].filePath, "工具.md");
    assert.deepEqual(retrieval.keywordIds("HIDDENYAML", 10), []);
    assert.equal((await retrieval.search("Palimpsest", [1, 0], snapshot, { topK: 2, maxPerFile: 1, excludePath: "工具.md" }, () => true)).some(r => r.filePath === "工具.md"), false);
  } finally { retrieval.close(); }
});

test("excluded current-file hits cannot consume the keyword candidate budget", async () => {
  const retrieval = new HybridRetrieval("test-excluded-budget");
  try {
    const base = chunks()[0];
    const current = Array.from({ length: 210 }, (_, i) => ({ ...base, id: `self-${i}`, filePath: "current.md", fileName: "current", text: "SELFTERM", vector: [1, 0] }));
    const other = { ...base, id: "vector-first", filePath: "vector.md", fileName: "vector", text: "完全不同的向量候选。", vector: [1, 0] };
    const target = { ...base, id: "keyword-target", filePath: "keyword.md", fileName: "keyword", text: "SELFTERM " + "这是需要关键词找到的旧笔记正文。".repeat(150), vector: [0, 1] };
    const result = await retrieval.search("SELFTERM", [1, 0], [...current, other, target], { topK: 1, maxPerFile: 1, excludePath: "current.md" }, () => true);
    assert.equal(result[0].id, "keyword-target");
  } finally { retrieval.close(); }
});

test("committed replacements remove old terms and deleted sources, retaining current locations", async () => {
  const retrieval = new HybridRetrieval("test-updates");
  try {
    const original = chunks();
    await retrieval.synchronize(original, () => true);
    retrieval.invalidate();
    assert.throws(() => retrieval.keywordIds("Palimpsest", 10), /尚未就绪/);
    const changed = [{ ...original[0], text: "UPDATEDANCHOR 修改后的唯一正文。", filePath: "移动/工具.md", fileName: "新名称", startLine: 99 }];
    const result = await retrieval.search("UPDATEDANCHOR", [1, 0], changed, { topK: 2, maxPerFile: 1 }, () => true);
    assert.equal(result[0].filePath, "移动/工具.md");
    assert.equal(result[0].startLine, 99);
    assert.deepEqual(retrieval.keywordIds("Palimpsest", 10), []);
    assert.deepEqual(retrieval.keywordIds("个人回顾", 10), []);
    await retrieval.synchronize([], () => true);
    assert.deepEqual(retrieval.keywordIds("UPDATEDANCHOR", 10), []);
  } finally { retrieval.close(); }
});

test("native load failure has an explicit failure then recovers from the committed snapshot", async () => {
  let fail = true;
  const retrieval = new HybridRetrieval("test-retry", () => {
    if (fail) throw new Error("native unavailable");
    return require("@zvec/zvec");
  });
  try {
    await assert.rejects(retrieval.synchronize(chunks(), () => true), /native unavailable/);
    assert.throws(() => retrieval.keywordIds("Palimpsest", 10), /尚未就绪/);
    fail = false;
    await retrieval.synchronize(chunks(), () => true);
    assert.equal(retrieval.keywordIds("Palimpsest", 10).length, 1);
  } finally { retrieval.close(); }
});

test("keyword reads cannot observe a partly synchronized snapshot", async () => {
  const retrieval = new HybridRetrieval("test-partial");
  try {
    const original = chunks();
    await retrieval.synchronize(original, () => true);
    const changed = original.map(c => ({ ...c, text: "PARTIALANCHOR 等待同步完成的正文。" }));
    const pending = retrieval.synchronize(changed, () => true);
    await Promise.resolve();
    await Promise.resolve();
    assert.throws(() => retrieval.keywordIds("PARTIALANCHOR", 10), /尚未就绪/);
    await pending;
    assert.equal(retrieval.keywordIds("PARTIALANCHOR", 10).length, 2);
  } finally { retrieval.close(); }
});

test("a superseded batch cannot publish, and the next snapshot can recover", async () => {
  const retrieval = new HybridRetrieval("test-superseded");
  try {
    const base = chunks()[0];
    const large = Array.from({ length: 260 }, (_, i) => ({ ...base, id: `item-${i}`, text: `CANCELLEDANCHOR 正文 ${i}` }));
    let current = true;
    const pending = retrieval.synchronize(large, () => current);
    setTimeout(() => { current = false; retrieval.invalidate(); }, 0);
    await assert.rejects(pending, /失效/);
    assert.throws(() => retrieval.keywordIds("CANCELLEDANCHOR", 10), /尚未就绪/);
    await retrieval.synchronize(chunks(), () => true);
    assert.deepEqual(retrieval.keywordIds("CANCELLEDANCHOR", 10), []);
    assert.equal(retrieval.keywordIds("Palimpsest", 10).length, 1);
  } finally { retrieval.close(); }
});

test("a native read failure invalidates the cache and a retry rebuilds successfully", async () => {
  const native: typeof import("@zvec/zvec") = require("@zvec/zvec");
  let failRead = true;
  const retrieval = new HybridRetrieval("test-read-recovery", () => ({ ...native,
    ZVecCreateAndOpen: (...args) => {
      const collection = native.ZVecCreateAndOpen(...args);
      return new Proxy(collection, { get(target, key) {
        if (key === "querySync") return (...queryArgs: Parameters<typeof collection.querySync>) => {
          if (failRead) { failRead = false; throw new Error("native read failed"); }
          return collection.querySync(...queryArgs);
        };
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      } });
    }
  }));
  try {
    const snapshot = chunks();
    await assert.rejects(retrieval.search("Palimpsest", [1, 0], snapshot, { topK: 2, maxPerFile: 1 }, () => true), /native read failed/);
    assert.throws(() => retrieval.keywordIds("Palimpsest", 10), /尚未就绪/);
    assert.equal((await retrieval.search("Palimpsest", [1, 0], snapshot, { topK: 2, maxPerFile: 1 }, () => true))[0].filePath, "工具.md");
  } finally { retrieval.close(); }
});

test("closing and reopening rebuilds solely from the supplied committed content", async () => {
  const old = new HybridRetrieval("test-restart");
  await old.synchronize(chunks(), () => true);
  old.close();
  await assert.rejects(old.synchronize(chunks(), () => true), /失效/);
  const reopened = new HybridRetrieval("test-restart");
  try {
    const latest = [chunks()[1]];
    await reopened.synchronize(latest, () => true);
    assert.deepEqual(reopened.keywordIds("Palimpsest", 10), []);
    assert.equal(reopened.keywordIds("个人回顾", 10).length, 1);
  } finally { reopened.close(); }
});
