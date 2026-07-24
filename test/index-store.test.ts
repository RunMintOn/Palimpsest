import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { createIndexStore, IndexedDocument } from "../src/index-store";
import { indexScope } from "../src/index-scope";
import { CHUNKER_VERSION, IndexIdentity, NumericVector } from "../src/types";
import { ensureVaultIdentity, VaultIdentityDataAdapter } from "../src/vault-identity";
import { rankChunks } from "../src/retrieval";

const DATABASE_NAME = "palimpsest-index-v1";
const METADATA = "metadata";
const DOCUMENTS = "documents";
const vaultA = "11111111-1111-4111-8111-111111111111";
const vaultB = "22222222-2222-4222-8222-222222222222";
const identity: IndexIdentity = {
  model: "test-model",
  dimensions: 3,
  chunkerVersion: CHUNKER_VERSION,
  chunkTargetLength: 10,
  chunkMaxLength: 20,
  chunkMinLength: 1
};

function document(filePath: string, text: string, vector: NumericVector = [1, 2, 3], id = `${filePath}:${text}`): IndexedDocument {
  return {
    filePath,
    fileName: filePath.replace(/\.md$/, ""),
    sourceMtime: 1,
    sourceSize: text.length,
    chunks: [{
      id,
      contentHash: `content:${id}`,
      embeddingInputHash: `embedding:${id}`,
      filePath,
      fileName: filePath.replace(/\.md$/, ""),
      breadcrumb: ["Heading"],
      text,
      startLine: 1,
      endLine: 1,
      vector
    }]
  };
}

async function replace(store: ReturnType<typeof createIndexStore>, documents: readonly IndexedDocument[], replacementIdentity = identity) {
  return store.commit({ kind: "replace-all", identity: replacementIdentity, scope: indexScope(["Archive"]), documents });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
    transaction.onerror = () => { /* onabort is terminal */ };
  });
}

async function withRawDatabase(action: (database: IDBDatabase) => Promise<void>): Promise<void> {
  const request = indexedDB.open(DATABASE_NAME);
  const database = await requestResult(request);
  try {
    await action(database);
  } finally {
    database.close();
  }
}

async function deleteCurrentDocument(vaultId: string): Promise<void> {
  await withRawDatabase(async (database) => {
    const transaction = database.transaction([METADATA, DOCUMENTS], "readwrite");
    const done = transactionDone(transaction);
    const metadata = await requestResult(transaction.objectStore(METADATA).get(vaultId)) as { currentGeneration: string };
    transaction.objectStore(DOCUMENTS).delete([vaultId, metadata.currentGeneration, "current.md"]);
    await done;
  });
}

async function addUnpublishedDocument(vaultId: string): Promise<void> {
  await withRawDatabase(async (database) => {
    const transaction = database.transaction(DOCUMENTS, "readwrite");
    const done = transactionDone(transaction);
    transaction.objectStore(DOCUMENTS).put({
      vaultId,
      generation: "unpublished-generation",
      filePath: "unpublished.md",
      fileName: "unpublished",
      sourceMtime: 1,
      sourceSize: 4,
      chunks: [{
        id: "unpublished",
        contentHash: "unpublished",
        embeddingInputHash: "unpublished",
        filePath: "unpublished.md",
        fileName: "unpublished",
        breadcrumb: [],
        text: "hidden",
        startLine: 1,
        endLine: 1,
        vector: new Float32Array([1, 2, 3])
      }]
    });
    await done;
  });
}

async function storedGenerations(vaultId: string): Promise<string[]> {
  let generations: string[] = [];
  await withRawDatabase(async (database) => {
    const transaction = database.transaction(DOCUMENTS, "readonly");
    const done = transactionDone(transaction);
    const documents = await requestResult(transaction.objectStore(DOCUMENTS).getAll(IDBKeyRange.bound([vaultId, "", ""], [vaultId, "\uffff", "\uffff"]))) as Array<{ generation: string }>;
    generations = [...new Set(documents.map((document) => document.generation))].sort();
    await done;
  });
  return generations;
}

async function eventually<T>(read: () => Promise<T>, predicate: (value: T) => boolean): Promise<T> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  return read();
}

async function resetDatabase(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("Could not reset IndexedDB"));
    request.onblocked = () => reject(new Error("IndexStore test left an IndexedDB connection open"));
  });
}

test.afterEach(async () => { await resetDatabase(); });

test("IndexStore load on an empty database is uninitialized", async () => {
  const store = createIndexStore(vaultA);
  try {
    assert.deepEqual(await store.load(), { status: "uninitialized" });
  } finally {
    store.close();
  }
});

test("IndexStore round-trips Float32Array vectors without array expansion", async () => {
  const store = createIndexStore(vaultA);
  try {
    const vector = new Float32Array([0.25, -0.5, 0.75]);
    await replace(store, [document("typed.md", "typed", vector)]);
    const loaded = await store.load();
    assert.equal(loaded.status, "ready");
    assert.ok(loaded.data.chunks[0].vector instanceof Float32Array);
    assert.deepEqual([...loaded.data.chunks[0].vector], [...vector]);
  } finally {
    store.close();
  }
});

test("replace-all publishes a complete generation", async () => {
  const store = createIndexStore(vaultA);
  try {
    const committed = await replace(store, [document("first.md", "first"), document("second.md", "second", [3, 2, 1])]);
    assert.equal(committed.initialized, true);
    assert.ok(committed.chunks.every((chunk) => chunk.vector instanceof Float32Array), "number[] inputs are normalized before persistence");
    assert.deepEqual(committed.chunks.map((chunk) => chunk.filePath), ["first.md", "second.md"]);
    const loaded = await store.load();
    assert.equal(loaded.status, "ready");
    assert.deepEqual(loaded.data.chunks.map((chunk) => chunk.text), ["first", "second"]);
  } finally {
    store.close();
  }
});

test("replace-all can publish an initialized empty vault", async () => {
  const store = createIndexStore(vaultA);
  try {
    await replace(store, []);
    const loaded = await store.load();
    assert.equal(loaded.status, "ready");
    assert.equal(loaded.data.initialized, true);
    assert.deepEqual(loaded.data.chunks, []);
  } finally {
    store.close();
  }
});

test("replace-all retains an empty document for later folder-change planning", async () => {
  const store = createIndexStore(vaultA);
  try {
    const empty = { ...document("empty.md", "empty"), chunks: [] };
    await replace(store, [empty]);
    const loaded = await store.load();
    assert.equal(loaded.status, "ready");
    assert.deepEqual(loaded.data.documents?.map((item) => item.filePath), ["empty.md"]);
    assert.deepEqual(loaded.data.chunks, []);
  } finally {
    store.close();
  }
});

test("startup cleanup removes unpublished generations without touching the published generation", async () => {
  const store = createIndexStore(vaultA);
  try {
    await replace(store, [document("published.md", "published")]);
    await addUnpublishedDocument(vaultA);
    const loaded = await store.load();
    assert.equal(loaded.status, "ready");
    assert.deepEqual(loaded.data.chunks.map((chunk) => chunk.filePath), ["published.md"]);
    const generations = await eventually(() => storedGenerations(vaultA), (value) => value.length === 1);
    assert.equal(generations.length, 1);
  } finally {
    store.close();
  }
});

test("a second replace-all retains the previous generation for recovery", async () => {
  const store = createIndexStore(vaultA);
  await replace(store, [document("previous.md", "previous")]);
  await replace(store, [document("current.md", "current")]);
  store.close();
  await deleteCurrentDocument(vaultA); // Corrupt fixture: this is the permitted direct-IDB recovery setup.

  const reopened = createIndexStore(vaultA);
  try {
    const loaded = await reopened.load();
    assert.equal(loaded.status, "ready");
    assert.equal(loaded.recovery, "used-previous-generation");
    assert.deepEqual(loaded.data.chunks.map((chunk) => chunk.text), ["previous"]);
    assert.deepEqual(rankChunks(new Float32Array([1, 2, 3]), loaded.data.chunks, { topK: 1, maxPerFile: 1 }).map((chunk) => chunk.text), ["previous"]);
  } finally {
    reopened.close();
  }
});

test("a corrupt current generation falls back to the validated previous generation", async () => {
  const store = createIndexStore(vaultA);
  await replace(store, [document("previous.md", "previous")]);
  await replace(store, [document("current.md", "current")]);
  store.close();
  await deleteCurrentDocument(vaultA);

  const reopened = createIndexStore(vaultA);
  try {
    const loaded = await reopened.load();
    assert.equal(loaded.status, "ready");
    assert.equal(loaded.recovery, "used-previous-generation");
  } finally {
    reopened.close();
  }
});

for (const [label, incompatibleIdentity] of [
  ["model", { ...identity, model: "other-model" }],
  ["dimensions", { ...identity, dimensions: 4 }],
  ["chunker version", { ...identity, chunkerVersion: "other" }],
  ["chunk lengths", { ...identity, chunkTargetLength: 11, chunkMaxLength: 21 }]
] as const) {
  test(`a corrupt current generation never exposes a ${label}-incompatible previous generation`, async () => {
    const store = createIndexStore(vaultA);
    await replace(store, [document("previous.md", "previous")]);
    await replace(store, [document("current.md", "current", new Float32Array(incompatibleIdentity.dimensions).fill(1))], incompatibleIdentity);
    store.close();
    await deleteCurrentDocument(vaultA);

    const reopened = createIndexStore(vaultA);
    try {
      assert.deepEqual(await reopened.load(), { status: "uninitialized" });
    } finally {
      reopened.close();
    }
  });
}

test("a full rebuild after fallback retains the generation actually serving queries, not the corrupt current", async () => {
  const store = createIndexStore(vaultA);
  await replace(store, [document("previous.md", "previous")]);
  await replace(store, [document("current.md", "current")]);
  store.close();
  await deleteCurrentDocument(vaultA);

  const reopened = createIndexStore(vaultA);
  try {
    const fallback = await reopened.load();
    assert.equal(fallback.status, "ready");
    assert.equal(fallback.recovery, "used-previous-generation");
    await replace(reopened, [document("new.md", "new")]);
    const loaded = await reopened.load();
    assert.equal(loaded.status, "ready");
    assert.deepEqual(loaded.data.chunks.map((chunk) => chunk.text), ["new"]);
    assert.equal((await storedGenerations(vaultA)).length, 2, "cleanup retains only new current and usable fallback");
  } finally {
    reopened.close();
  }
});

test("patch-documents changes only its specified document", async () => {
  const store = createIndexStore(vaultA);
  try {
    await replace(store, [document("a.md", "old-a"), document("b.md", "old-b")]);
    const committed = await store.commit({ kind: "patch-documents", identity, upserts: [document("a.md", "new-a")], deletes: [] });
    assert.deepEqual(committed.chunks.map((chunk) => chunk.text).sort(), ["new-a", "old-b"]);
    const loaded = await store.load();
    assert.equal(loaded.status, "ready");
    assert.deepEqual(loaded.data.chunks.map((chunk) => chunk.text), ["new-a", "old-b"]);
  } finally {
    store.close();
  }
});

test("patch-documents atomically updates, deletes, and inserts documents", async () => {
  const store = createIndexStore(vaultA);
  try {
    await replace(store, [document("update.md", "old"), document("delete.md", "delete")]);
    await store.commit({
      kind: "patch-documents",
      identity,
      upserts: [document("update.md", "new"), document("insert.md", "insert")],
      deletes: ["delete.md"]
    });
    const loaded = await store.load();
    assert.equal(loaded.status, "ready");
    assert.deepEqual(loaded.data.chunks.map((chunk) => `${chunk.filePath}:${chunk.text}`).sort(), ["insert.md:insert", "update.md:new"]);
  } finally {
    store.close();
  }
});

test("IndexStore serializes queued patch commits", async () => {
  const store = createIndexStore(vaultA);
  try {
    await replace(store, [document("a.md", "a")]);
    const first = store.commit({ kind: "patch-documents", identity, upserts: [document("b.md", "b")], deletes: ["a.md"] });
    const second = store.commit({ kind: "patch-documents", identity, upserts: [document("c.md", "c")], deletes: ["b.md"] });
    await Promise.all([first, second]);
    const loaded = await store.load();
    assert.equal(loaded.status, "ready");
    assert.deepEqual(loaded.data.chunks.map((chunk) => chunk.filePath), ["c.md"]);
  } finally {
    store.close();
  }
});

test("an invalid patch vector leaves the entire batch unchanged", async () => {
  const store = createIndexStore(vaultA);
  try {
    await replace(store, [document("stable.md", "stable")]);
    await assert.rejects(() => store.commit({
      kind: "patch-documents",
      identity,
      upserts: [document("new.md", "new"), document("invalid.md", "invalid", [1, Number.NaN, 3])],
      deletes: ["stable.md"]
    }), /non-finite/);
    const loaded = await store.load();
    assert.equal(loaded.status, "ready");
    assert.deepEqual(loaded.data.chunks.map((chunk) => chunk.filePath), ["stable.md"]);
  } finally {
    store.close();
  }
});

test("patch-documents rejects an identity mismatch", async () => {
  const store = createIndexStore(vaultA);
  try {
    await replace(store, [document("a.md", "a")]);
    await assert.rejects(() => store.commit({
      kind: "patch-documents",
      identity: { ...identity, model: "other" },
      upserts: [document("a.md", "changed")],
      deletes: []
    }), /identity/);
  } finally {
    store.close();
  }
});

test("IndexStore rejects duplicate chunk IDs across documents", async () => {
  const store = createIndexStore(vaultA);
  try {
    await assert.rejects(() => replace(store, [document("a.md", "a", [1, 2, 3], "duplicate"), document("b.md", "b", [1, 2, 3], "duplicate")]), /Duplicate chunk ID/);
    assert.deepEqual(await store.load(), { status: "uninitialized" });
  } finally {
    store.close();
  }
});

test("vault IDs isolate identical document paths", async () => {
  const first = createIndexStore(vaultA);
  const second = createIndexStore(vaultB);
  try {
    await replace(first, [document("same.md", "vault-a")]);
    await replace(second, [document("same.md", "vault-b")]);
    const a = await first.load();
    const b = await second.load();
    assert.equal(a.status, "ready");
    assert.equal(b.status, "ready");
    assert.equal(a.data.chunks[0].text, "vault-a");
    assert.equal(b.data.chunks[0].text, "vault-b");
  } finally {
    first.close();
    second.close();
  }
});

test("clear removes only the current vault's records", async () => {
  const first = createIndexStore(vaultA);
  const second = createIndexStore(vaultB);
  try {
    await replace(first, [document("same.md", "vault-a")]);
    await replace(second, [document("same.md", "vault-b")]);
    await first.clear();
    assert.deepEqual(await first.load(), { status: "uninitialized" });
    const remaining = await second.load();
    assert.equal(remaining.status, "ready");
    assert.equal(remaining.data.chunks[0].text, "vault-b");
  } finally {
    first.close();
    second.close();
  }
});

test("close prevents later commits", async () => {
  const store = createIndexStore(vaultA);
  store.close();
  await assert.rejects(() => replace(store, [document("a.md", "a")]), /closed/);
});

class MemoryAdapter implements VaultIdentityDataAdapter {
  readonly files = new Map<string, string>();
  readonly directories = new Set<string>();

  async exists(path: string): Promise<boolean> { return this.files.has(path) || this.directories.has(path); }
  async mkdir(path: string): Promise<void> { this.directories.add(path); }
  async read(path: string): Promise<string> {
    const value = this.files.get(path);
    if (value === undefined) throw new Error(`Missing file: ${path}`);
    return value;
  }
  async write(path: string, data: string): Promise<void> { this.files.set(path, data); }
  async process(path: string, fn: (data: string) => string): Promise<string> {
    const next = fn(this.files.get(path) ?? "");
    this.files.set(path, next);
    return next;
  }
}

const identityPath = ".obsidian/palimpsest/vault-id.json";
const prototypeMarker = "PALIMPSEST_INDEXEDDB_VALIDATION_PROTOTYPE_DO_NOT_USE_FOR_PRODUCTION";

test("vault identity creates and then reuses a UUID", async () => {
  const adapter = new MemoryAdapter();
  const created = await ensureVaultIdentity({ configDir: ".obsidian", adapter, createUuid: () => vaultA });
  const reused = await ensureVaultIdentity({ configDir: ".obsidian", adapter, createUuid: () => vaultB });
  assert.deepEqual(created, { vaultId: vaultA, created: true, absorbedPrototypeMarker: false });
  assert.deepEqual(reused, { vaultId: vaultA, created: false, absorbedPrototypeMarker: false });
  assert.equal(adapter.files.has(".obsidian/plugins/palimpsest/vault-id.json"), false);
});

test("an already formal vault identity does not write its file", async () => {
  const adapter = new MemoryAdapter();
  adapter.files.set(identityPath, JSON.stringify({ schemaVersion: 1, vaultId: vaultA }));
  let writes = 0;
  let processes = 0;
  adapter.write = async () => { writes++; };
  adapter.process = async () => { processes++; return ""; };
  const result = await ensureVaultIdentity({ configDir: ".obsidian", adapter });
  assert.deepEqual(result, { vaultId: vaultA, created: false, absorbedPrototypeMarker: false });
  assert.deepEqual({ writes, processes }, { writes: 0, processes: 0 });
});

test("vault identity absorbs the exact validation-prototype marker without changing its UUID", async () => {
  const adapter = new MemoryAdapter();
  adapter.files.set(identityPath, JSON.stringify({ schemaVersion: 1, vaultId: vaultA, prototypeMarker }));
  const result = await ensureVaultIdentity({ configDir: ".obsidian", adapter });
  assert.deepEqual(result, { vaultId: vaultA, created: false, absorbedPrototypeMarker: true });
  assert.deepEqual(JSON.parse(adapter.files.get(identityPath)!), { schemaVersion: 1, vaultId: vaultA });
});

test("vault identity rejects a prototype absorption whose formal write cannot be read back", async () => {
  const adapter = new MemoryAdapter();
  adapter.files.set(identityPath, JSON.stringify({ schemaVersion: 1, vaultId: vaultA, prototypeMarker }));
  const read = adapter.read.bind(adapter);
  let processes = 0;
  adapter.process = async (path, fn) => { processes++; adapter.files.set(path, fn(adapter.files.get(path)!)); return adapter.files.get(path)!; };
  adapter.read = async (path) => processes ? "not json" : read(path);
  await assert.rejects(() => ensureVaultIdentity({ configDir: ".obsidian", adapter }), /verify written vault identity/);
  assert.equal(processes, 1);
  assert.equal(JSON.parse(adapter.files.get(identityPath)!).vaultId, vaultA, "a failed verification never replaces the existing UUID");
});

test("vault identity rejects an unknown marker without overwriting the file", async () => {
  const adapter = new MemoryAdapter();
  const original = JSON.stringify({ schemaVersion: 1, vaultId: vaultA, prototypeMarker: "unknown" });
  adapter.files.set(identityPath, original);
  await assert.rejects(() => ensureVaultIdentity({ configDir: ".obsidian", adapter }), /unknown marker/);
  assert.equal(adapter.files.get(identityPath), original);
});

test("vault identity process callback leaves an unknown concurrent marker completely unchanged", async () => {
  const adapter = new MemoryAdapter();
  const original = JSON.stringify({ schemaVersion: 1, vaultId: vaultA, prototypeMarker: "changed-by-other-writer" });
  adapter.files.set(identityPath, JSON.stringify({ schemaVersion: 1, vaultId: vaultA, prototypeMarker }));
  adapter.process = async (_path, fn) => {
    adapter.files.set(identityPath, original);
    return fn(original);
  };
  await assert.rejects(() => ensureVaultIdentity({ configDir: ".obsidian", adapter }), /changed while absorbing/);
  assert.equal(adapter.files.get(identityPath), original);
});

test("concurrent vault identity initialization creates one UUID", async () => {
  const adapter = new MemoryAdapter();
  let generated = 0;
  const [first, second] = await Promise.all([
    ensureVaultIdentity({ configDir: ".obsidian", adapter, createUuid: () => { generated++; return vaultA; } }),
    ensureVaultIdentity({ configDir: ".obsidian", adapter, createUuid: () => { generated++; return vaultB; } })
  ]);
  assert.equal(generated, 1);
  assert.equal(first.vaultId, vaultA);
  assert.equal(second.vaultId, vaultA);
});
