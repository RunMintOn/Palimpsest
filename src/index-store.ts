import { IndexScope, indexScope, sameIndexScope } from "./index-scope";
import { IndexIdentity, IndexedChunk, NumericVector, PersistentIndexData } from "./types";

const DATABASE_NAME = "palimpsest-index-v1";
const DATABASE_VERSION = 1;
const METADATA_STORE = "metadata";
const DOCUMENTS_STORE = "documents";
const REPLACE_BATCH_SIZE = 100;

interface StoredIndexedChunk extends Omit<IndexedChunk, "vector"> {
  embeddingInputHash: string;
  vector: Float32Array;
}

interface StoredIndexedDocument {
  vaultId: string;
  generation: string;
  filePath: string;
  fileName: string;
  sourceMtime: number;
  sourceSize: number;
  chunks: StoredIndexedChunk[];
}

interface GenerationSnapshot {
  generation: string;
  identity: IndexIdentity;
  scope: IndexScope;
  documentCount: number;
  chunkCount: number;
  updatedAt: number;
}

interface StoredIndexMetadata extends GenerationSnapshot {
  vaultId: string;
  storageSchemaVersion: 1;
  currentGeneration: string;
  previousGeneration?: string;
  /** Internal completeness data makes a previous generation independently recoverable. */
  previousSnapshot?: GenerationSnapshot;
  initialized: true;
}

/** A document is the storage and patch unit, including documents with no chunks. */
export interface IndexedDocument {
  filePath: string;
  fileName: string;
  sourceMtime: number;
  sourceSize: number;
  chunks: Array<IndexedChunk & { embeddingInputHash: string }>;
}

export type IndexCommit =
  | {
      kind: "replace-all";
      identity: IndexIdentity;
      scope: IndexScope;
      documents: readonly IndexedDocument[];
    }
  | {
      kind: "patch-documents";
      identity: IndexIdentity;
      upserts: readonly IndexedDocument[];
      deletes: readonly string[];
    };

export type IndexLoadResult =
  | { status: "uninitialized" }
  | { status: "ready"; data: PersistentIndexData; recovery?: "used-previous-generation" };

/** The production seam: all IndexedDB mechanics remain behind these four operations. */
export interface IndexStore {
  load(): Promise<IndexLoadResult>;
  commit(change: IndexCommit): Promise<PersistentIndexData>;
  clear(): Promise<void>;
  close(): void;
}

/** Creates a store for one stable vault identity. The database remains origin-wide and namespaced internally. */
export function createIndexStore(vaultId: string): IndexStore {
  return new IndexedDbIndexStore(vaultId);
}

class IndexedDbIndexStore implements IndexStore {
  private database: IDBDatabase | undefined;
  private opening: Promise<IDBDatabase> | undefined;
  private closed = false;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly vaultId: string) {
    if (!isNonEmptyString(vaultId)) throw new Error("IndexStore requires a vaultId");
  }

  async load(): Promise<IndexLoadResult> {
    const database = await this.open();
    const metadata = await readMetadata(database, this.vaultId);
    if (!metadata) {
      this.scheduleGenerationCleanup(database, []);
      return { status: "uninitialized" };
    }
    if (!isValidMetadata(metadata, this.vaultId)) return { status: "uninitialized" };

    const currentSnapshotData = currentSnapshot(metadata);
    const current = await this.tryLoadSnapshot(database, metadata, currentSnapshotData);
    if (current) {
      this.scheduleGenerationCleanup(database, [metadata.currentGeneration, metadata.previousGeneration].filter(isNonEmptyString));
      return { status: "ready", data: current };
    }

    const previous = metadata.previousSnapshot;
    // A previous generation can only serve queries for the same embedding and
    // chunking semantics as the failed current snapshot. Scope is deliberately
    // allowed to remain the previous effective scope.
    if (previous && metadata.previousGeneration === previous.generation && sameIdentity(currentSnapshotData.identity, previous.identity)) {
      const fallback = await this.tryLoadSnapshot(database, metadata, previous);
      if (fallback) {
        // Keep both metadata references. In particular, do not let best-effort
        // startup cleanup delete the generation currently serving queries.
        this.scheduleGenerationCleanup(database, [metadata.currentGeneration, metadata.previousGeneration].filter(isNonEmptyString));
        return { status: "ready", data: fallback, recovery: "used-previous-generation" };
      }
    }
    return { status: "uninitialized" };
  }

  commit(change: IndexCommit): Promise<PersistentIndexData> {
    return this.enqueueWrite(async () => {
      if (change.kind === "replace-all") return this.replaceAll(change);
      return this.patchDocuments(change);
    });
  }

  clear(): Promise<void> {
    return this.enqueueWrite(async () => {
      const database = await this.open();
      const transaction = database.transaction([METADATA_STORE, DOCUMENTS_STORE], "readwrite");
      const done = transactionDone(transaction);
      try {
        await deleteDocumentsInRange(transaction.objectStore(DOCUMENTS_STORE), generationRange(this.vaultId));
        transaction.objectStore(METADATA_STORE).delete(this.vaultId);
        await done;
      } catch (error) {
        abort(transaction);
        await done.catch(() => undefined);
        throw error;
      }
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.database?.close();
    this.database = undefined;
  }

  private enqueueWrite<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.writeQueue.then(async () => {
      this.assertOpen();
      return operation();
    });
    this.writeQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  private async replaceAll(change: Extract<IndexCommit, { kind: "replace-all" }>): Promise<PersistentIndexData> {
    const identity = validateIdentity(change.identity);
    const scope = validateScope(change.scope);
    const normalizedDocuments = normalizeDocuments(change.documents, identity);
    const generation = crypto.randomUUID();
    const updatedAt = Date.now();
    const documents = normalizedDocuments.map((document) => ({ ...document, vaultId: this.vaultId, generation }));
    const documentCount = documents.length;
    const chunkCount = countChunks(documents);
    const database = await this.open();

    try {
      for (let start = 0; start < documents.length; start += REPLACE_BATCH_SIZE) {
        await writeDocuments(database, documents.slice(start, start + REPLACE_BATCH_SIZE));
      }
      const snapshot: GenerationSnapshot = { generation, identity, scope, documentCount, chunkCount, updatedAt };
      const verified = await readGeneration(database, this.vaultId, snapshot);
      if (!verified) throw new Error("New index generation failed validation before publication");

      const oldMetadata = await readMetadata(database, this.vaultId);
      const previous = oldMetadata && isValidMetadata(oldMetadata, this.vaultId)
        ? await this.lastUsableSnapshot(database, oldMetadata)
        : undefined;
      const metadata: StoredIndexMetadata = {
        vaultId: this.vaultId,
        storageSchemaVersion: 1,
        currentGeneration: generation,
        previousGeneration: previous?.generation,
        previousSnapshot: previous,
        ...snapshot,
        initialized: true
      };
      await writeMetadata(database, metadata);
      // Cleanup is best effort: publication is already durable and remains valid if it fails.
      // Awaiting it also keeps every IndexedDB write under this instance's write queue.
      await this.cleanupGenerations(database, [generation, metadata.previousGeneration].filter(isNonEmptyString));
      return verified;
    } catch (error) {
      await this.deleteGeneration(database, generation);
      throw error;
    }
  }

  private async patchDocuments(change: Extract<IndexCommit, { kind: "patch-documents" }>): Promise<PersistentIndexData> {
    const identity = validateIdentity(change.identity);
    const upserts = normalizeDocuments(change.upserts, identity);
    validateDeletes(change.deletes, upserts);
    const database = await this.open();
    const transaction = database.transaction([METADATA_STORE, DOCUMENTS_STORE], "readwrite");
    const done = transactionDone(transaction);
    try {
      const metadata = await requestResult(transaction.objectStore(METADATA_STORE).get(this.vaultId)) as StoredIndexMetadata | undefined;
      if (!metadata || !isValidMetadata(metadata, this.vaultId)) throw new Error("Cannot patch an uninitialized or invalid index");
      if (!sameIdentity(metadata.identity, identity)) throw new Error("Patch identity does not match the current index");

      const documentsStore = transaction.objectStore(DOCUMENTS_STORE);
      const existing = await requestResult(documentsStore.getAll(generationRange(this.vaultId, metadata.currentGeneration))) as StoredIndexedDocument[];
      const currentSnapshotData = currentSnapshot(metadata);
      if (!validateGenerationDocuments(existing, this.vaultId, currentSnapshotData)) throw new Error("Cannot patch an invalid current generation");

      const storedUpserts = upserts.map((document) => ({ ...document, vaultId: this.vaultId, generation: metadata.currentGeneration }));
      const replacements = new Map(storedUpserts.map((document) => [document.filePath, document]));
      const deleted = new Set(change.deletes);
      const resulting = [
        ...existing.filter((document) => !deleted.has(document.filePath) && !replacements.has(document.filePath)),
        ...storedUpserts
      ];
      validateGlobalDocumentInvariants(resulting, identity);
      for (const path of change.deletes) documentsStore.delete([this.vaultId, metadata.currentGeneration, path]);
      for (const document of storedUpserts) documentsStore.put(document);

      const updatedAt = Date.now();
      const updatedMetadata: StoredIndexMetadata = {
        ...metadata,
        documentCount: resulting.length,
        chunkCount: countChunks(resulting),
        updatedAt
      };
      // All document and metadata requests are queued before awaiting completion.
      transaction.objectStore(METADATA_STORE).put(updatedMetadata);
      await done;
      return persistentData(updatedMetadata, resulting);
    } catch (error) {
      abort(transaction);
      await done.catch(() => undefined);
      throw error;
    }
  }

  private async tryLoadSnapshot(database: IDBDatabase, metadata: StoredIndexMetadata, snapshot: GenerationSnapshot): Promise<PersistentIndexData | undefined> {
    const documents = await getDocuments(database, this.vaultId, snapshot.generation);
    if (!validateGenerationDocuments(documents, this.vaultId, snapshot)) return undefined;
    return persistentData({ ...metadata, ...snapshot }, documents);
  }

  /** Chooses a genuinely valid prior generation, including a previously used fallback. */
  private async lastUsableSnapshot(database: IDBDatabase, metadata: StoredIndexMetadata): Promise<GenerationSnapshot | undefined> {
    const current = currentSnapshot(metadata);
    if (await this.tryLoadSnapshot(database, metadata, current)) return current;
    const previous = metadata.previousSnapshot;
    if (previous && metadata.previousGeneration === previous.generation && sameIdentity(current.identity, previous.identity) &&
      await this.tryLoadSnapshot(database, metadata, previous)) return previous;
    return undefined;
  }

  private async cleanupGenerations(database: IDBDatabase, keep: readonly string[]): Promise<void> {
    try {
      const transaction = database.transaction(DOCUMENTS_STORE, "readwrite");
      const done = transactionDone(transaction);
      const store = transaction.objectStore(DOCUMENTS_STORE);
      await visitDocuments(store, generationRange(this.vaultId), (cursor) => {
        const document = cursor.value as StoredIndexedDocument;
        if (!keep.includes(document.generation)) cursor.delete();
      });
      await done;
    } catch (error) {
      // Orphaned records are invisible because load only follows published metadata.
      console.warn("[Palimpsest] Could not clean obsolete local index generations", error);
    }
  }

  /** Cleanup shares the write queue, so it cannot race a newly prepared generation. */
  private scheduleGenerationCleanup(database: IDBDatabase, keep: readonly string[]): void {
    void this.enqueueWrite(() => this.cleanupGenerations(database, keep)).catch((error) => {
      console.warn("[Palimpsest] Could not schedule obsolete local index generation cleanup", error);
    });
  }

  private async deleteGeneration(database: IDBDatabase, generation: string): Promise<void> {
    try {
      const transaction = database.transaction(DOCUMENTS_STORE, "readwrite");
      const done = transactionDone(transaction);
      await deleteDocumentsInRange(transaction.objectStore(DOCUMENTS_STORE), generationRange(this.vaultId, generation));
      await done;
    } catch (error) {
      // A failed cleanup cannot affect metadata publication.
      console.warn("[Palimpsest] Could not clean an unpublished local index generation", error);
    }
  }

  private open(): Promise<IDBDatabase> {
    this.assertOpen();
    if (this.database) return Promise.resolve(this.database);
    if (this.opening) return this.opening;
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    this.opening = new Promise<IDBDatabase>((resolve, reject) => {
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(METADATA_STORE)) database.createObjectStore(METADATA_STORE, { keyPath: "vaultId" });
        if (!database.objectStoreNames.contains(DOCUMENTS_STORE)) database.createObjectStore(DOCUMENTS_STORE, { keyPath: ["vaultId", "generation", "filePath"] });
      };
      request.onerror = () => reject(request.error ?? new Error("Unable to open the index database"));
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => {
          database.close();
          if (this.database === database) this.database = undefined;
        };
        if (this.closed) {
          database.close();
          reject(new Error("IndexStore is closed"));
          return;
        }
        this.database = database;
        resolve(database);
      };
    }).finally(() => { this.opening = undefined; });
    return this.opening;
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("IndexStore is closed");
  }
}

function validateIdentity(identity: IndexIdentity): IndexIdentity {
  if (!identity || !isNonEmptyString(identity.model) || !isNonEmptyString(identity.chunkerVersion) ||
    !isPositiveInteger(identity.dimensions) || !isPositiveInteger(identity.chunkTargetLength) ||
    !isPositiveInteger(identity.chunkMaxLength) || !isPositiveInteger(identity.chunkMinLength) ||
    identity.chunkMinLength > identity.chunkTargetLength || identity.chunkTargetLength > identity.chunkMaxLength) {
    throw new Error("Invalid index identity");
  }
  return { ...identity };
}

function validateScope(scope: IndexScope): IndexScope {
  if (!scope || !Array.isArray(scope.excludedDirectories) || scope.excludedDirectories.some((path) => !isNonEmptyString(path))) {
    throw new Error("Invalid index scope");
  }
  const normalized = indexScope(scope.excludedDirectories);
  if (!sameIndexScope(scope, normalized) || scope.excludedDirectories.length !== normalized.excludedDirectories.length ||
    scope.excludedDirectories.some((path, index) => path !== normalized.excludedDirectories[index])) {
    throw new Error("Index scope must be normalized");
  }
  return { excludedDirectories: [...normalized.excludedDirectories] };
}

function normalizeDocuments(documents: readonly IndexedDocument[], identity: IndexIdentity): StoredIndexedDocument[] {
  if (!Array.isArray(documents)) throw new Error("Documents must be an array");
  const normalized = documents.map((document) => normalizeDocument(document, identity));
  validateGlobalDocumentInvariants(normalized, identity);
  return normalized;
}

function normalizeDocument(document: IndexedDocument, identity: IndexIdentity): StoredIndexedDocument {
  if (!document || !isNonEmptyString(document.filePath) || !isNonEmptyString(document.fileName) ||
    !isNonNegativeFinite(document.sourceMtime) || !isNonNegativeFinite(document.sourceSize) || !Array.isArray(document.chunks)) {
    throw new Error("Invalid indexed document");
  }
  return {
    vaultId: "", // Filled exactly once by the store, never accepted from a caller.
    generation: "",
    filePath: document.filePath,
    fileName: document.fileName,
    sourceMtime: document.sourceMtime,
    sourceSize: document.sourceSize,
    chunks: document.chunks.map((chunk) => normalizeChunk(chunk, document.filePath, identity))
  };
}

function normalizeChunk(chunk: IndexedChunk & { embeddingInputHash: string }, documentPath: string, identity: IndexIdentity): StoredIndexedChunk {
  if (!chunk || !isNonEmptyString(chunk.id) || !isNonEmptyString(chunk.contentHash) || !isNonEmptyString(chunk.embeddingInputHash) ||
    chunk.filePath !== documentPath || !isNonEmptyString(chunk.fileName) || !Array.isArray(chunk.breadcrumb) ||
    chunk.breadcrumb.some((heading) => typeof heading !== "string") || typeof chunk.text !== "string" ||
    !isPositiveInteger(chunk.startLine) || !isPositiveInteger(chunk.endLine) || chunk.endLine < chunk.startLine) {
    throw new Error(`Invalid chunk in ${documentPath}`);
  }
  return {
    id: chunk.id,
    contentHash: chunk.contentHash,
    embeddingInputHash: chunk.embeddingInputHash,
    filePath: chunk.filePath,
    fileName: chunk.fileName,
    breadcrumb: [...chunk.breadcrumb],
    text: chunk.text,
    startLine: chunk.startLine,
    endLine: chunk.endLine,
    vector: normalizeVector(chunk.vector, identity.dimensions, chunk.id)
  };
}

function normalizeVector(vector: NumericVector, dimensions: number, chunkId: string): Float32Array {
  if (!(Array.isArray(vector) || vector instanceof Float32Array) || vector.length !== dimensions) {
    throw new Error(`Chunk ${chunkId} vector does not match index dimensions`);
  }
  for (let index = 0; index < vector.length; index++) {
    if (!Number.isFinite(vector[index])) throw new Error(`Chunk ${chunkId} vector contains a non-finite value`);
  }
  const normalized = Float32Array.from(vector);
  for (let index = 0; index < normalized.length; index++) {
    if (!Number.isFinite(normalized[index])) throw new Error(`Chunk ${chunkId} vector cannot be represented as Float32Array`);
  }
  return normalized;
}

function validateGlobalDocumentInvariants(documents: readonly StoredIndexedDocument[], identity: IndexIdentity): void {
  const paths = new Set<string>();
  const chunkIds = new Set<string>();
  for (const document of documents) {
    if (paths.has(document.filePath)) throw new Error(`Duplicate document path: ${document.filePath}`);
    paths.add(document.filePath);
    for (const chunk of document.chunks) {
      if (chunk.filePath !== document.filePath) throw new Error(`Chunk ${chunk.id} belongs to ${chunk.filePath}, not ${document.filePath}`);
      if (chunkIds.has(chunk.id)) throw new Error(`Duplicate chunk ID: ${chunk.id}`);
      chunkIds.add(chunk.id);
      normalizeVector(chunk.vector, identity.dimensions, chunk.id);
    }
  }
}

function validateDeletes(deletes: readonly string[], upserts: readonly StoredIndexedDocument[]): void {
  const paths = new Set<string>();
  const upsertPaths = new Set(upserts.map((document) => document.filePath));
  for (const path of deletes) {
    if (!isNonEmptyString(path)) throw new Error("Invalid document deletion path");
    if (paths.has(path)) throw new Error(`Duplicate document deletion path: ${path}`);
    if (upsertPaths.has(path)) throw new Error(`Document cannot be both upserted and deleted: ${path}`);
    paths.add(path);
  }
}

async function readMetadata(database: IDBDatabase, vaultId: string): Promise<StoredIndexMetadata | undefined> {
  const transaction = database.transaction(METADATA_STORE, "readonly");
  const done = transactionDone(transaction);
  const metadata = await requestResult(transaction.objectStore(METADATA_STORE).get(vaultId)) as StoredIndexMetadata | undefined;
  await done;
  return metadata;
}

async function writeMetadata(database: IDBDatabase, metadata: StoredIndexMetadata): Promise<void> {
  const transaction = database.transaction(METADATA_STORE, "readwrite");
  const done = transactionDone(transaction);
  transaction.objectStore(METADATA_STORE).put(metadata);
  await done;
}

async function writeDocuments(database: IDBDatabase, documents: readonly StoredIndexedDocument[]): Promise<void> {
  const transaction = database.transaction(DOCUMENTS_STORE, "readwrite");
  const done = transactionDone(transaction);
  const store = transaction.objectStore(DOCUMENTS_STORE);
  for (const source of documents) {
    store.put(source);
  }
  await done;
}

async function getDocuments(database: IDBDatabase, vaultId: string, generation: string): Promise<StoredIndexedDocument[]> {
  const transaction = database.transaction(DOCUMENTS_STORE, "readonly");
  const done = transactionDone(transaction);
  const documents = await requestResult(transaction.objectStore(DOCUMENTS_STORE).getAll(generationRange(vaultId, generation))) as StoredIndexedDocument[];
  await done;
  return documents;
}

async function readGeneration(database: IDBDatabase, vaultId: string, snapshot: GenerationSnapshot): Promise<PersistentIndexData | undefined> {
  const documents = await getDocuments(database, vaultId, snapshot.generation);
  if (!validateGenerationDocuments(documents, vaultId, snapshot)) return undefined;
  return persistentData(snapshot, documents);
}

function validateGenerationDocuments(documents: readonly StoredIndexedDocument[], vaultId: string, snapshot: GenerationSnapshot): boolean {
  try {
    if (documents.length !== snapshot.documentCount || countChunks(documents) !== snapshot.chunkCount) return false;
    for (const document of documents) {
      if (document.vaultId !== vaultId || document.generation !== snapshot.generation) return false;
      if (document.chunks.some((chunk) => !(chunk.vector instanceof Float32Array))) return false;
      normalizeDocument(document, snapshot.identity);
    }
    validateGlobalDocumentInvariants(documents, snapshot.identity);
    return true;
  } catch {
    return false;
  }
}

function persistentData(metadata: GenerationSnapshot, documents: readonly StoredIndexedDocument[]): PersistentIndexData {
  return {
    schemaVersion: 3,
    identity: { ...metadata.identity },
    scope: { excludedDirectories: [...metadata.scope.excludedDirectories] },
    chunks: documents.flatMap((document) => document.chunks.map((chunk) => ({
      id: chunk.id,
      contentHash: chunk.contentHash,
      filePath: chunk.filePath,
      fileName: chunk.fileName,
      breadcrumb: [...chunk.breadcrumb],
      text: chunk.text,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      vector: chunk.vector
    }))),
    documents: documents.map((document) => ({
      filePath: document.filePath,
      fileName: document.fileName,
      sourceMtime: document.sourceMtime,
      sourceSize: document.sourceSize
    })),
    updatedAt: metadata.updatedAt,
    initialized: true
  };
}

function currentSnapshot(metadata: StoredIndexMetadata): GenerationSnapshot {
  return {
    generation: metadata.currentGeneration,
    identity: { ...metadata.identity },
    scope: { excludedDirectories: [...metadata.scope.excludedDirectories] },
    documentCount: metadata.documentCount,
    chunkCount: metadata.chunkCount,
    updatedAt: metadata.updatedAt
  };
}

function isValidMetadata(metadata: StoredIndexMetadata, vaultId: string): boolean {
  try {
    if (!metadata || metadata.vaultId !== vaultId || metadata.storageSchemaVersion !== 1 || !metadata.initialized ||
      !isNonEmptyString(metadata.currentGeneration) || !isNonNegativeInteger(metadata.documentCount) || !isNonNegativeInteger(metadata.chunkCount) ||
      !isNonNegativeFinite(metadata.updatedAt)) return false;
    validateIdentity(metadata.identity);
    validateScope(metadata.scope);
    if (metadata.previousGeneration !== undefined && !isNonEmptyString(metadata.previousGeneration)) return false;
    if (metadata.previousSnapshot) {
      const previous = metadata.previousSnapshot;
      if (metadata.previousGeneration !== previous.generation || !isNonEmptyString(previous.generation) ||
        !isNonNegativeInteger(previous.documentCount) || !isNonNegativeInteger(previous.chunkCount) || !isNonNegativeFinite(previous.updatedAt)) return false;
      validateIdentity(previous.identity);
      validateScope(previous.scope);
    }
    return true;
  } catch {
    return false;
  }
}

function generationRange(vaultId: string, generation?: string): IDBKeyRange {
  return generation === undefined
    ? IDBKeyRange.bound([vaultId, "", ""], [vaultId, "\uffff", "\uffff"])
    : IDBKeyRange.bound([vaultId, generation, ""], [vaultId, generation, "\uffff"]);
}

function countChunks(documents: readonly { chunks: readonly unknown[] }[]): number {
  return documents.reduce((count, document) => count + document.chunks.length, 0);
}

function visitDocuments(store: IDBObjectStore, range: IDBKeyRange, visit: (cursor: IDBCursorWithValue) => void): Promise<void> {
  const request = store.openCursor(range);
  return new Promise<void>((resolve, reject) => {
    request.onerror = () => reject(request.error ?? new Error("IndexedDB cursor failed"));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return resolve();
      visit(cursor);
      cursor.continue();
    };
  });
}

function deleteDocumentsInRange(store: IDBObjectStore, range: IDBKeyRange): Promise<void> {
  return visitDocuments(store, range, (cursor) => { cursor.delete(); });
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
    transaction.onerror = () => { /* onabort provides the terminal error */ };
  });
}

function abort(transaction: IDBTransaction): void {
  try { transaction.abort(); } catch { /* It may already have completed or aborted. */ }
}

function sameIdentity(left: IndexIdentity, right: IndexIdentity): boolean {
  return left.model === right.model && left.dimensions === right.dimensions && left.chunkerVersion === right.chunkerVersion &&
    left.chunkTargetLength === right.chunkTargetLength && left.chunkMaxLength === right.chunkMaxLength && left.chunkMinLength === right.chunkMinLength;
}

function isNonEmptyString(value: unknown): value is string { return typeof value === "string" && value.length > 0; }
function isPositiveInteger(value: unknown): value is number { return typeof value === "number" && Number.isInteger(value) && value > 0; }
function isNonNegativeInteger(value: unknown): value is number { return typeof value === "number" && Number.isInteger(value) && value >= 0; }
function isNonNegativeFinite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0; }
