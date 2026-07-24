import { IndexScope, IndexScopeStatus, indexScope, indexScopeStatus } from "./index-scope";
import { IndexIdentity, IndexedChunk, IndexedDocumentMetadata, IndexLifecycle, PersistentIndexData, SkippedIndexedDocument } from "./types";

const CURRENT_SCHEMA_VERSION = 3;

export function sameIdentity(left: IndexIdentity, right: IndexIdentity): boolean {
  return left.model === right.model &&
    left.dimensions === right.dimensions &&
    left.chunkerVersion === right.chunkerVersion &&
    left.chunkTargetLength === right.chunkTargetLength &&
    left.chunkMaxLength === right.chunkMaxLength &&
    left.chunkMinLength === right.chunkMinLength;
}

function copyScope(scope: IndexScope): IndexScope {
  return { excludedDirectories: [...scope.excludedDirectories] };
}

function copyDocuments(documents: readonly IndexedDocumentMetadata[] | undefined): IndexedDocumentMetadata[] | undefined {
  return documents?.map((document) => ({ ...document }));
}

function copySkippedDocuments(documents: readonly SkippedIndexedDocument[] | undefined): SkippedIndexedDocument[] | undefined {
  return documents?.map((document) => ({ ...document }));
}

export class PersistentIndex {
  private data: PersistentIndexData;

  constructor(identity: IndexIdentity, saved?: PersistentIndexData, legacySettingsScope: IndexScope = indexScope([])) {
    // v1 did not have initialized. A non-zero updatedAt only came from the old
    // full-build commit path, so it is a safe migration signal and preserves
    // existing vectors rather than forcing a destructive reset.
    const initialized = saved?.initialized ?? (saved?.updatedAt ?? 0) > 0;
    if (saved && Array.isArray(saved.chunks)) {
      // Schema v1/v2 stored no scope. For a completed legacy index we assume
      // the saved settings describe the scope used for that old build. This
      // compatibility migration keeps a usable index ready rather than forcing
      // a rebuild solely to add the new scope metadata.
      const scope = initialized
        ? indexScope(saved.scope?.excludedDirectories ?? legacySettingsScope.excludedDirectories)
        : undefined;
      this.data = { ...saved, documents: copyDocuments(saved.documents), skippedDocuments: copySkippedDocuments(saved.skippedDocuments), schemaVersion: CURRENT_SCHEMA_VERSION, initialized, scope };
    } else {
      this.data = { schemaVersion: CURRENT_SCHEMA_VERSION, identity, chunks: [], updatedAt: 0, initialized: false };
    }
  }

  isCompatible(identity: IndexIdentity): boolean {
    return sameIdentity(this.data.identity, identity);
  }

  get identity(): IndexIdentity { return this.data.identity; }
  get chunks(): readonly IndexedChunk[] { return this.data.chunks; }
  get size(): number { return this.data.chunks.length; }

  /** Includes indexed Markdown files that produced zero chunks. */
  get documents(): readonly IndexedDocumentMetadata[] { return copyDocuments(this.data.documents) ?? []; }

  /** Skipped documents are processed state, not empty indexed documents. */
  get skippedDocuments(): readonly SkippedIndexedDocument[] { return copySkippedDocuments(this.data.skippedDocuments) ?? []; }

  /** Every path known to the current generation, for reconciliation and patches. */
  get documentPaths(): readonly string[] { return [...this.documents, ...this.skippedDocuments].map((document) => document.filePath); }

  /** A copy prevents callers from changing the persisted effective scope. */
  get scope(): IndexScope | undefined {
    return this.data.scope ? copyScope(this.data.scope) : undefined;
  }

  scopeStatus(desiredScope: IndexScope): IndexScopeStatus {
    return indexScopeStatus(desiredScope, this.scope);
  }

  lifecycle(identity: IndexIdentity): IndexLifecycle {
    if (!this.isCompatible(identity)) return "incompatible";
    return this.data.initialized ? "ready" : "uninitialized";
  }

  isReady(identity: IndexIdentity): boolean {
    return this.lifecycle(identity) === "ready";
  }

  reusableById(identity: IndexIdentity): Map<string, IndexedChunk> {
    if (!this.isCompatible(identity)) return new Map();
    return new Map(this.data.chunks.map((chunk) => [chunk.id, chunk]));
  }

  /** Creates a candidate for a successful full build with its explicit scope snapshot. */
  fullReplacement(identity: IndexIdentity, chunks: IndexedChunk[], scope: IndexScope): PersistentIndexData {
    return this.replacement(identity, chunks, scope);
  }

  /** Creates an incremental candidate while explicitly retaining the current effective scope. */
  incrementalReplacement(identity: IndexIdentity, chunks: IndexedChunk[]): PersistentIndexData {
    if (!this.data.initialized || !this.data.scope) {
      throw new Error("Cannot incrementally replace an index without an effective scope");
    }
    return this.replacement(identity, chunks, this.data.scope);
  }

  private replacement(identity: IndexIdentity, chunks: IndexedChunk[], scope: IndexScope): PersistentIndexData {
    const ids = new Set<string>();
    for (const chunk of chunks) {
      if (ids.has(chunk.id)) throw new Error(`Duplicate chunk ID: ${chunk.id}`);
      if (chunk.vector.length !== identity.dimensions) throw new Error(`Chunk ${chunk.id} vector does not match index dimensions`);
      ids.add(chunk.id);
    }
    return {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      identity,
      chunks,
      updatedAt: Date.now(),
      initialized: true,
      scope: indexScope(scope.excludedDirectories)
    };
  }

  commit(data: PersistentIndexData): void {
    const initialized = data.initialized ?? data.updatedAt > 0;
    this.data = {
      ...data,
      documents: copyDocuments(data.documents),
      skippedDocuments: copySkippedDocuments(data.skippedDocuments),
      schemaVersion: CURRENT_SCHEMA_VERSION,
      initialized,
      scope: initialized
        ? indexScope(data.scope?.excludedDirectories ?? this.data.scope?.excludedDirectories ?? [])
        : undefined
    };
  }

  serialize(): PersistentIndexData {
    return { ...this.data, scope: this.scope, documents: copyDocuments(this.data.documents), skippedDocuments: copySkippedDocuments(this.data.skippedDocuments) };
  }
}
