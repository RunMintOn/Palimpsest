import assert from "node:assert/strict";
import test from "node:test";
import { executeIncrementalIndexPlan, isLargeIncrementalIndexPlan, prepareIncrementalIndexPlan } from "../src/incremental-index-plan";
import { indexScope } from "../src/index-scope";
import { CHUNKER_VERSION, Chunk, IndexIdentity, IndexedChunk } from "../src/types";

const identity: IndexIdentity = { model: "test", dimensions: 3, chunkerVersion: CHUNKER_VERSION, chunkTargetLength: 10, chunkMaxLength: 20, chunkMinLength: 1 };
const current = { vaultRevision: 1, identity, scope: indexScope([]) };

function chunk(path: string, text = "body"): Chunk {
  return { id: `${path}:${text}`, contentHash: text, filePath: path, fileName: path.split("/").at(-1)!.replace(/\.md$/, ""), breadcrumb: ["Heading"], text, startLine: 1, endLine: 1 };
}

function document(path: string, text = "body") {
  return { filePath: path, fileName: path.split("/").at(-1)!.replace(/\.md$/, ""), sourceMtime: 1, sourceSize: text.length, chunks: [chunk(path, text)] };
}

function indexed(source: Chunk): IndexedChunk { return { ...source, vector: new Float32Array([1, 2, 3]) }; }

test("threshold-below incremental plan proceeds automatically with one document patch", async () => {
  const plan = prepareIncrementalIndexPlan({
    documents: [document("changed.md")], deletes: [], reusableChunks: [], current,
    changes: { added: 0, renamed: 0, modified: 1, deleted: 0 }
  });
  assert.equal(isLargeIncrementalIndexPlan(plan.summary), false);
  let requested = 0;
  const executed = await executeIncrementalIndexPlan(plan, {
    current, batchSize: 10,
    embedDocuments: async () => { requested++; return [new Float32Array([1, 2, 3])]; },
    assertCanContinue: () => undefined,
    yieldToUi: async () => undefined
  });
  assert.equal(requested, 1);
  assert.deepEqual(executed.upserts.map((item) => item.filePath), ["changed.md"]);
});

test("a pure move of more than 50 documents is fully reusable and does not require confirmation", () => {
  const old = Array.from({ length: 51 }, (_, index) => indexed(chunk(`old/note-${index}.md`)));
  const moved = Array.from({ length: 51 }, (_, index) => document(`new/note-${index}.md`));
  const plan = prepareIncrementalIndexPlan({
    documents: moved, deletes: old.map((item) => item.filePath), reusableChunks: old, current,
    changes: { added: 0, renamed: 51, modified: 0, deleted: 0 }
  });
  assert.equal(plan.summary.pendingChunks, 0);
  assert.equal(isLargeIncrementalIndexPlan(plan.summary), false);
});

test("pending embeddings over the document or chunk threshold require confirmation", () => {
  const documents = Array.from({ length: 51 }, (_, index) => document(`new-${index}.md`));
  const plan = prepareIncrementalIndexPlan({
    documents, deletes: [], reusableChunks: [], current,
    changes: { added: 51, renamed: 0, modified: 0, deleted: 0 }
  });
  assert.equal(plan.summary.pendingDocuments, 51);
  assert.equal(isLargeIncrementalIndexPlan(plan.summary), true);
});

test("a bulk plan made stale before execution performs no embedding or patch preparation", async () => {
  const plan = prepareIncrementalIndexPlan({
    documents: [document("changed.md")], deletes: [], reusableChunks: [], current,
    changes: { added: 0, renamed: 0, modified: 1, deleted: 0 }
  });
  let embeddingCalls = 0;
  await assert.rejects(() => executeIncrementalIndexPlan(plan, {
    current: { ...current, vaultRevision: 2 }, batchSize: 1,
    embedDocuments: async () => { embeddingCalls++; return [new Float32Array([1, 2, 3])]; },
    assertCanContinue: () => undefined,
    yieldToUi: async () => undefined
  }), /stale/);
  assert.equal(embeddingCalls, 0);
});

test("unload seam stops an incremental plan after embedding before it can produce a commit candidate", async () => {
  const plan = prepareIncrementalIndexPlan({
    documents: [document("changed.md")], deletes: [], reusableChunks: [], current,
    changes: { added: 0, renamed: 0, modified: 1, deleted: 0 }
  });
  let active = true;
  await assert.rejects(() => executeIncrementalIndexPlan(plan, {
    current,
    batchSize: 1,
    embedDocuments: async () => { active = false; return [new Float32Array([1, 2, 3])]; },
    assertCanContinue: () => { if (!active) throw new Error("unloaded"); },
    yieldToUi: async () => undefined
  }), /unloaded/);
});

test("an incremental retry embeds only successful rescans and patches a skipped document back to indexed", async () => {
  const skipped = { filePath: "bad.md", fileName: "bad", sourceMtime: 1, sourceSize: 3, reasonCode: "invalid-chunk-structure" as const };
  const plan = prepareIncrementalIndexPlan({
    documents: [document("fixed.md")],
    skippedDocuments: [skipped],
    deletes: [],
    reusableChunks: [],
    current,
    changes: { added: 0, renamed: 0, modified: 2, deleted: 0 }
  });
  let embedded = 0;
  const executed = await executeIncrementalIndexPlan(plan, {
    current, batchSize: 1,
    embedDocuments: async (chunks) => { embedded += chunks.length; return [new Float32Array([1, 2, 3])]; },
    assertCanContinue: () => undefined,
    yieldToUi: async () => undefined
  });
  assert.equal(embedded, 1);
  assert.deepEqual(executed.upserts.map((item) => item.filePath), ["fixed.md", "bad.md"]);
  assert.equal("reasonCode" in executed.upserts[1], true);
});
