import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { chunkMarkdown } from "../src/chunker";
import { embeddingInputHash } from "../src/embedding-reuse";
import { PersistentIndex } from "../src/persistent-index";
import { createIndexStore } from "../src/index-store";
import { prepareIndexBuild, executePreparedIndexBuild } from "../src/index-build-plan";
import { runConfirmedIndexBuild } from "../src/index-build-flow";
import { scanIndexDocument } from "../src/index-document-scan";
import { HybridRetrieval } from "../src/hybrid-retrieval";
import { indexScope } from "../src/index-scope";
import { CHUNKER_VERSION, type IndexIdentity } from "../src/types";

const identity: IndexIdentity = { model: "test", dimensions: 2, chunkerVersion: CHUNKER_VERSION, chunkTargetLength: 650, chunkMaxLength: 1100, chunkMinLength: 1 };
const options = { targetLength: 650, maxLength: 1100, minLength: 1 };

test("a chunk-version upgrade reuses unchanged inputs but never vectors from a different model or dimension", async () => {
  const oldChunk = { ...chunkMarkdown("note.md", "# 章节\n\n未改变的正文内容", options)[0], id: "old-v2-id", vector: [1, 0] };
  const saved = { schemaVersion: 3, identity: { ...identity, chunkerVersion: "2" }, chunks: [oldChunk], updatedAt: 1, initialized: true, scope: indexScope([]) };
  const index = new PersistentIndex(identity, saved);
  assert.equal(index.lifecycle(identity), "incompatible");
  assert.equal(index.reusableChunks(identity).length, 1);
  assert.equal(index.reusableChunks({ ...identity, model: "other" }).length, 0);
  assert.equal(index.reusableChunks({ ...identity, dimensions: 3 }).length, 0);
  assert.equal(index.serialize().chunks[0].id, "old-v2-id");
});

test("upgrade preview cancellation and embedding failure retain v2; successful commit publishes only changed semantic inputs", async () => {
  const store = createIndexStore("markdown-upgrade-fixture");
  const retrieval = new HybridRetrieval("markdown-upgrade-fixture");
  const stableText = "# 章节\n\n未改变的正文内容";
  const changedText = "---\nsecret: HIDDENYAML\n---\n# 真正章节\n\n```python\n# CODEANCHOR 这是代码注释\nprint(123)\n```\n\n后续正文";
  const stable = chunkMarkdown("stable.md", stableText, options)[0];
  const obsolete = { ...stable, id: "old-code", filePath: "code.md", fileName: "code", breadcrumb: ["WRONGHEADING"], text: "print(123)\n```\n\n后续正文" };
  const oldDocuments = [stable, obsolete].map((c, i) => ({ filePath: c.filePath, fileName: c.fileName, sourceMtime: 1, sourceSize: 1, chunks: [{ ...c, id: `v2-${i}`, embeddingInputHash: embeddingInputHash(c), vector: [1, 0] }] }));
  try {
    const old = await store.commit({ kind: "replace-all", identity: { ...identity, chunkerVersion: "2" }, scope: indexScope([]), documents: oldDocuments });
    const index = new PersistentIndex(identity, old);
    await retrieval.synchronize(old.chunks, () => true);
    assert.equal(retrieval.keywordIds("WRONGHEADING", 10).length, 1);
    const documents = await Promise.all([["stable.md", "\n\n" + stableText], ["code.md", changedText]].map(([path, text]) =>
      scanIndexDocument({ path, basename: path.slice(0, -3), stat: { mtime: 2, size: text.length } }, identity, async () => text, () => {})));
    const current = { identity, scope: indexScope([]), vaultRevision: 1 };
    const prepare = () => prepareIndexBuild({ totalMarkdownFiles: 2, documents, reusableById: index.reusableById(identity), reusableChunks: index.reusableChunks(identity), ...current });
    const plan = prepare();
    assert.equal(plan.summary.reusableChunks, 1);
    assert.equal(plan.summary.pendingChunks, 1);
    assert.equal(await runConfirmedIndexBuild({ prepare: async () => plan, confirm: async () => false, execute: async () => { assert.fail("cancelled preview cannot execute"); } }), "cancelled");
    const load = async () => { const value = await store.load(); assert.equal(value.status, "ready"); return value.data; };
    assert.deepEqual(await load(), old);
    await assert.rejects(executePreparedIndexBuild(plan, { current, batchSize: 16, embedDocuments: async () => { throw new Error("provider failed"); }, assertCanContinue: () => {}, yieldToUi: async () => {} }), /provider failed/);
    assert.deepEqual(await load(), old);
    await assert.rejects(executePreparedIndexBuild(plan, { current: { ...current, vaultRevision: 2 }, batchSize: 16, embedDocuments: async () => { assert.fail("stale plans must not embed"); }, assertCanContinue: () => {}, yieldToUi: async () => {} }), /stale/);
    const embedded: string[] = [];
    const result = await executePreparedIndexBuild(prepare(), { current, batchSize: 16, embedDocuments: async chunks => { embedded.push(...chunks.map(c => c.text)); return chunks.map(() => [0, 1]); }, assertCanContinue: () => {}, yieldToUi: async () => {} });
    assert.deepEqual(embedded, ["```python\n# CODEANCHOR 这是代码注释\nprint(123)\n```\n\n后续正文"]);
    assert.deepEqual([...result.documents[0].chunks[0].vector], [1, 0]);
    assert.equal(result.documents[0].chunks[0].startLine, 5);
    assert.equal(index.lifecycle(identity), "incompatible", "execution alone cannot publish");
    const committed = await store.commit({ kind: "replace-all", identity, scope: current.scope, documents: result.documents.map(d => ({ ...d, chunks: d.chunks.map(c => ({ ...c, embeddingInputHash: embeddingInputHash(c) })) })) });
    index.commit(committed);
    retrieval.invalidate();
    const hits = await retrieval.search("CODEANCHOR", [0, 1], index.chunks, { topK: 2, maxPerFile: 1 }, () => true);
    assert.equal(index.lifecycle(identity), "ready");
    assert.equal(hits[0].filePath, "code.md");
    assert.deepEqual(hits[0].breadcrumb, ["真正章节"]);
    assert.equal(hits[0].startLine, 6);
    assert.deepEqual(retrieval.keywordIds("WRONGHEADING", 10), []);
    assert.deepEqual(retrieval.keywordIds("HIDDENYAML", 10), []);
    assert.deepEqual(await load(), committed);
  } finally { retrieval.close(); store.close(); }
});

for (const replacement of [{ ...identity, model: "different-model" }, { ...identity, dimensions: 3 }]) {
  test(`full rebuild actually embeds identical text after embedding identity changes: ${replacement.model}/${replacement.dimensions}`, async () => {
    const [source] = chunkMarkdown("note.md", "正文语义完全相同", options);
    const index = new PersistentIndex(replacement, { schemaVersion: 3, identity, chunks: [{ ...source, vector: [1, 0] }], initialized: true, updatedAt: 1, scope: indexScope([]) });
    const current = { identity: replacement, scope: indexScope([]), vaultRevision: 0 };
    const plan = prepareIndexBuild({ totalMarkdownFiles: 1, documents: [{ filePath: source.filePath, fileName: source.fileName, sourceMtime: 1, sourceSize: 1, chunks: [source] }], reusableById: index.reusableById(replacement), reusableChunks: index.reusableChunks(replacement), ...current });
    assert.equal(plan.summary.pendingChunks, 1);
    const result = await executePreparedIndexBuild(plan, { current, batchSize: 1, embedDocuments: async chunks => { assert.equal(chunks[0].text, "正文语义完全相同"); return [Array(replacement.dimensions).fill(0.5)]; }, assertCanContinue: () => {}, yieldToUi: async () => {} });
    assert.deepEqual(result.documents[0].chunks[0].vector, Array(replacement.dimensions).fill(0.5));
  });
}
