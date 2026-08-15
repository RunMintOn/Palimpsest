import { stableHash } from "./chunker";
import { Chunk, IndexedChunk, NumericVector } from "./types";

/** The exact semantic input to the document embedding endpoint, excluding path and line numbers. */
export function embeddingInputHash(chunk: Pick<Chunk, "fileName" | "breadcrumb" | "text">): string {
  return stableHash(JSON.stringify([chunk.fileName, chunk.breadcrumb, chunk.text]));
}

export function sameEmbeddingInput(
  left: Pick<Chunk, "fileName" | "breadcrumb" | "text">,
  right: Pick<Chunk, "fileName" | "breadcrumb" | "text">
): boolean {
  return left.fileName === right.fileName && left.text === right.text &&
    left.breadcrumb.length === right.breadcrumb.length &&
    left.breadcrumb.every((heading, index) => heading === right.breadcrumb[index]);
}

/** Compares a document's embedding inputs as a multiset, ignoring line positions and chunk IDs. */
export function sameEmbeddingInputs(
  left: readonly Pick<Chunk, "fileName" | "breadcrumb" | "text">[],
  right: readonly Pick<Chunk, "fileName" | "breadcrumb" | "text">[]
): boolean {
  if (left.length !== right.length) return false;
  const counts = new Map<string, number>();
  const key = (chunk: Pick<Chunk, "fileName" | "breadcrumb" | "text">) => JSON.stringify([chunk.fileName, chunk.breadcrumb, chunk.text]);
  for (const chunk of left) counts.set(key(chunk), (counts.get(key(chunk)) ?? 0) + 1);
  for (const chunk of right) counts.set(key(chunk), (counts.get(key(chunk)) ?? 0) - 1);
  return [...counts.values()].every((count) => count === 0);
}

/** Hash lookup is only a candidate filter; exact fields decide whether a vector is reusable. */
export class EmbeddingReuseLookup {
  private readonly candidates = new Map<string, IndexedChunk[]>();

  constructor(chunks: readonly IndexedChunk[]) {
    for (const chunk of chunks) {
      const hash = embeddingInputHash(chunk);
      const bucket = this.candidates.get(hash);
      if (bucket) bucket.push(chunk);
      else this.candidates.set(hash, [chunk]);
    }
  }

  find(chunk: Chunk): NumericVector | undefined {
    return this.candidates.get(embeddingInputHash(chunk))?.find((candidate) => sameEmbeddingInput(candidate, chunk))?.vector;
  }
}

export interface EmbeddingInputGroup {
  representative: Chunk;
  chunks: Chunk[];
}

/** Groups equal inputs so new duplicate passages share one embedding request and vector. */
export function groupChunksByEmbeddingInput(chunks: readonly Chunk[]): EmbeddingInputGroup[] {
  const byHash = new Map<string, EmbeddingInputGroup[]>();
  const groups: EmbeddingInputGroup[] = [];
  for (const chunk of chunks) {
    const hash = embeddingInputHash(chunk);
    const bucket = byHash.get(hash) ?? [];
    let group = bucket.find((candidate) => sameEmbeddingInput(candidate.representative, chunk));
    if (!group) {
      group = { representative: chunk, chunks: [] };
      bucket.push(group);
      byHash.set(hash, bucket);
      groups.push(group);
    }
    group.chunks.push(chunk);
  }
  return groups;
}
