import { IndexIdentity, IndexedChunk, IndexLifecycle, PersistentIndexData } from "./types";

export function sameIdentity(left: IndexIdentity, right: IndexIdentity): boolean {
  return left.model === right.model &&
    left.dimensions === right.dimensions &&
    left.chunkerVersion === right.chunkerVersion &&
    left.chunkTargetLength === right.chunkTargetLength &&
    left.chunkMaxLength === right.chunkMaxLength &&
    left.chunkMinLength === right.chunkMinLength;
}

export class PersistentIndex {
  private data: PersistentIndexData;

  constructor(identity: IndexIdentity, saved?: PersistentIndexData) {
    // v1 did not have initialized. A non-zero updatedAt only came from the old
    // full-build commit path, so it is a safe migration signal and preserves
    // existing vectors rather than forcing a destructive reset.
    this.data = saved && Array.isArray(saved.chunks)
      ? { ...saved, schemaVersion: 2, initialized: saved.initialized ?? saved.updatedAt > 0 }
      : { schemaVersion: 2, identity, chunks: [], updatedAt: 0, initialized: false };
  }

  isCompatible(identity: IndexIdentity): boolean {
    return sameIdentity(this.data.identity, identity);
  }

  get identity(): IndexIdentity { return this.data.identity; }
  get chunks(): readonly IndexedChunk[] { return this.data.chunks; }
  get size(): number { return this.data.chunks.length; }

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

  replacement(identity: IndexIdentity, chunks: IndexedChunk[]): PersistentIndexData {
    const ids = new Set<string>();
    for (const chunk of chunks) {
      if (ids.has(chunk.id)) throw new Error(`Duplicate chunk ID: ${chunk.id}`);
      if (chunk.vector.length !== identity.dimensions) throw new Error(`Chunk ${chunk.id} vector does not match index dimensions`);
      ids.add(chunk.id);
    }
    return { schemaVersion: 2, identity, chunks, updatedAt: Date.now(), initialized: true };
  }

  commit(data: PersistentIndexData): void {
    this.data = { ...data, schemaVersion: 2, initialized: data.initialized ?? data.updatedAt > 0 };
  }

  replace(identity: IndexIdentity, chunks: IndexedChunk[]): void {
    this.commit(this.replacement(identity, chunks));
  }

  serialize(): PersistentIndexData {
    return this.data;
  }
}
