import assert from "node:assert/strict";
import test from "node:test";
import { executeIncrementalIndexPlan, isLargeIncrementalIndexPlan, prepareIncrementalIndexPlan, summarizeIncrementalChanges } from "../src/incremental-index-plan";
import { indexScope } from "../src/index-scope";
import { planIndexReconciliation } from "../src/index-reconciliation";
import { planIndexScopeTransition } from "../src/index-scope-transition";
import { CHUNKER_VERSION, Chunk, IndexIdentity, IndexedChunk } from "../src/types";
import { planVaultChanges } from "../src/vault-change-plan";

const identity: IndexIdentity = { model: "test", dimensions: 3, chunkerVersion: CHUNKER_VERSION, chunkTargetLength: 10, chunkMaxLength: 20, chunkMinLength: 1 };
const current = { vaultRevision: 1, identity, scope: indexScope([]) };

function chunk(path: string, text = "body"): Chunk {
  return { id: `${path}:${text}`, contentHash: text, filePath: path, fileName: path.split("/").at(-1)!.replace(/\.md$/, ""), breadcrumb: ["Heading"], text, startLine: 1, endLine: 1 };
}

function document(path: string, text = "body") {
  return { filePath: path, fileName: path.split("/").at(-1)!.replace(/\.md$/, ""), sourceMtime: 1, sourceSize: text.length, chunks: [chunk(path, text)] };
}

function indexed(source: Chunk): IndexedChunk { return { ...source, vector: new Float32Array([1, 2, 3]) }; }

test("incremental change summaries ignore stat-only updates and count semantic changes", () => {
  const summary = summarizeIncrementalChanges({
    changes: [
      { kind: "path", path: "same.md" },
      { kind: "path", path: "changed.md" },
      { kind: "path", path: "new.md" }
    ],
    upsertPaths: ["changed.md", "new-skipped.md", "new.md", "same.md", "skipped.md"],
    deletes: ["deleted.md"],
    indexedDocumentPaths: ["same.md", "changed.md", "deleted.md", "skipped.md"],
    indexedChunks: [indexed(chunk("same.md")), indexed(chunk("changed.md", "old"))],
    documents: [
      { ...document("same.md"), chunks: [{ ...chunk("same.md"), startLine: 99, endLine: 99 }] },
      document("changed.md", "new"),
      document("new.md")
    ],
    skippedDocuments: [
      { filePath: "skipped.md", fileName: "skipped", sourceMtime: 2, sourceSize: 3, reasonCode: "invalid-chunk-structure" },
      { filePath: "new-skipped.md", fileName: "new-skipped", sourceMtime: 2, sourceSize: 3, reasonCode: "invalid-chunk-structure" }
    ]
  });
  assert.deepEqual(summary, { added: 2, renamed: 0, modified: 1, skipped: 2, deleted: 1 });
});

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

test("incremental embedding progress starts immediately and counts only request groups", async () => {
  const plan = prepareIncrementalIndexPlan({
    documents: [document("first.md"), document("second.md")], deletes: [], reusableChunks: [], current,
    changes: { added: 2, renamed: 0, modified: 0, deleted: 0 }
  });
  const progress: Array<[number, number]> = [];
  await executeIncrementalIndexPlan(plan, {
    current,
    batchSize: 1,
    embedDocuments: async () => [new Float32Array([1, 2, 3])],
    assertCanContinue: () => undefined,
    yieldToUi: async () => undefined,
    onEmbeddingProgress: (completed, total) => progress.push([completed, total])
  });
  assert.deepEqual(progress, [[0, 2], [1, 2], [2, 2]]);
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

test("a restart reconciliation of a pure folder move reuses vectors despite added and deleted paths", () => {
  const oldDocuments = [document("old/a.md"), document("old/nested/b.md")];
  const currentPaths = ["new/a.md", "new/nested/b.md"];
  const reconciliation = planIndexReconciliation(oldDocuments, currentPaths.map((path) => ({ path, mtime: 1, size: 4 })));
  const vaultPlan = planVaultChanges({
    changes: reconciliation.changes,
    indexedDocumentPaths: oldDocuments.map((item) => item.filePath),
    currentMarkdownPaths: currentPaths,
    isIncluded: () => true
  });
  const oldChunks = oldDocuments.flatMap((item) => item.chunks.map(indexed));
  const scanned = currentPaths.map((path) => document(path));
  const changes = summarizeIncrementalChanges({
    changes: reconciliation.changes,
    upsertPaths: vaultPlan.upsertPaths,
    deletes: vaultPlan.deletes,
    indexedDocumentPaths: oldDocuments.map((item) => item.filePath),
    indexedChunks: oldChunks,
    documents: scanned
  });
  const plan = prepareIncrementalIndexPlan({
    documents: scanned,
    deletes: vaultPlan.deletes,
    reusableChunks: oldChunks,
    current,
    changes
  });

  assert.deepEqual(changes, { added: 2, renamed: 0, modified: 0, skipped: undefined, deleted: 2 });
  assert.equal(plan.summary.reusableChunks, 2);
  assert.equal(plan.summary.pendingDocuments, 0);
  assert.equal(plan.summary.pendingChunks, 0);
});

test("a changed chunk re-embeds while unchanged chunks in the same document reuse their vectors", () => {
  const oldChunks = [
    indexed(chunk("note.md", "See [[Old/target]]")),
    indexed(chunk("note.md", "Unchanged B")),
    indexed(chunk("note.md", "Unchanged C"))
  ];
  const scanned = {
    filePath: "note.md", fileName: "note", sourceMtime: 2, sourceSize: 44,
    chunks: [
      chunk("note.md", "See [[New/target]]"),
      chunk("note.md", "Unchanged B"),
      chunk("note.md", "Unchanged C")
    ]
  };
  const plan = prepareIncrementalIndexPlan({
    documents: [scanned],
    deletes: [],
    reusableChunks: oldChunks,
    current,
    changes: { added: 0, renamed: 0, modified: 1, deleted: 0 }
  });

  assert.equal(plan.summary.reusableChunks, 2);
  assert.equal(plan.summary.pendingDocuments, 1);
  assert.equal(plan.summary.pendingChunks, 1);
});

test("a scope addition plans only newly admitted paths and reuses compatible vectors without Ollama", async () => {
  const transition = planIndexScopeTransition({
    effectiveScope: indexScope(["BatchB"]),
    desiredScope: indexScope([]),
    markdownPaths: ["BatchA/note.md", "BatchB/note.md"],
    indexedDocumentPaths: ["BatchA/note.md"]
  });
  assert.deepEqual(transition.upsertPaths, ["BatchB/note.md"]);
  const plan = prepareIncrementalIndexPlan({
    documents: transition.upsertPaths.map((path) => document(path)),
    deletes: transition.deletePaths,
    reusableChunks: [indexed(chunk("BatchA/note.md"))],
    current,
    changes: { added: 1, renamed: 0, modified: 0, deleted: 0 }
  });
  let embeddingCalls = 0;
  const executed = await executeIncrementalIndexPlan(plan, {
    current,
    batchSize: 1,
    embedDocuments: async () => { embeddingCalls++; return []; },
    assertCanContinue: () => undefined,
    yieldToUi: async () => undefined
  });
  assert.equal(embeddingCalls, 0);
  assert.deepEqual(executed.upserts.map((item) => item.filePath), ["BatchB/note.md"]);
});

test("a scope removal executes a delete-only patch without requesting Ollama", async () => {
  const transition = planIndexScopeTransition({
    effectiveScope: indexScope([]),
    desiredScope: indexScope(["BatchB"]),
    markdownPaths: ["BatchA/note.md", "BatchB/indexed.md"],
    indexedDocumentPaths: ["BatchA/note.md", "BatchB/indexed.md", "BatchB/skipped.md"]
  });
  const desiredCurrent = { ...current, scope: indexScope(["BatchB"]) };
  const plan = prepareIncrementalIndexPlan({
    documents: [],
    deletes: transition.deletePaths,
    reusableChunks: [],
    current: desiredCurrent,
    changes: { added: 0, renamed: 0, modified: 0, deleted: 2 }
  });
  let embeddingCalls = 0;
  const executed = await executeIncrementalIndexPlan(plan, {
    current: desiredCurrent,
    batchSize: 1,
    embedDocuments: async () => { embeddingCalls++; return []; },
    assertCanContinue: () => undefined,
    yieldToUi: async () => undefined
  });
  assert.equal(embeddingCalls, 0);
  assert.deepEqual(executed.deletes, ["BatchB/indexed.md", "BatchB/skipped.md"]);
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
