import { IndexedChunk, NumericVector, SearchResult } from "./types";

export function cosineSimilarity(left: NumericVector, right: NumericVector): number {
  if (!left.length || left.length !== right.length) throw new Error("Cosine vectors must be non-empty and have equal dimensions");
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let i = 0; i < left.length; i++) {
    const a = left[i];
    const b = right[i];
    if (!Number.isFinite(a) || !Number.isFinite(b)) throw new Error("Cosine vectors must be finite");
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (!leftNorm || !rightNorm) return 0;
  return dot / Math.sqrt(leftNorm * rightNorm);
}

export interface RankOptions {
  topK: number;
  maxPerFile: number;
  excludePath?: string;
  duplicateSimilarity?: number;
}

export interface VectorRankedChunk extends IndexedChunk { similarity: number }

export function vectorRanking(query: NumericVector, candidates: readonly IndexedChunk[], excludePath?: string): VectorRankedChunk[] {
  return candidates.filter(chunk => chunk.filePath !== excludePath)
    .map(chunk => ({ ...chunk, similarity: cosineSimilarity(query, chunk.vector) }))
    .sort((a, b) => b.similarity - a.similarity || a.id.localeCompare(b.id));
}

function selectChunks<T extends IndexedChunk>(ordered: readonly T[], options: RankOptions): T[] {
  const selected: T[] = [];
  const perFile = new Map<string, number>();
  for (const chunk of ordered) {
    if (chunk.filePath === options.excludePath || (perFile.get(chunk.filePath) ?? 0) >= options.maxPerFile) continue;
    const normalized = chunk.text.replace(/\s+/g, " ").trim();
    if (selected.some(result => result.text.replace(/\s+/g, " ").trim() === normalized ||
      (result.filePath === chunk.filePath && cosineSimilarity(result.vector, chunk.vector) >= (options.duplicateSimilarity ?? 0.995)))) continue;
    selected.push(chunk);
    perFile.set(chunk.filePath, (perFile.get(chunk.filePath) ?? 0) + 1);
    if (selected.length >= options.topK) break;
  }
  return selected;
}

export function fuseRankings(chunks: readonly IndexedChunk[], routes: readonly (readonly string[])[], options: RankOptions): SearchResult[] {
  const scores = new Map<string, number>();
  for (const route of routes) {
    const seen = new Set<string>();
    let rank = 0;
    for (const id of route) {
      if (seen.has(id)) continue;
      seen.add(id);
      rank++;
      scores.set(id, (scores.get(id) ?? 0) + 1 / (60 + rank));
    }
  }
  const ordered = chunks.filter(chunk => scores.has(chunk.id))
    .sort((a, b) => scores.get(b.id)! - scores.get(a.id)! || a.id.localeCompare(b.id));
  return selectChunks(ordered, options).map(({ vector: _vector, ...chunk }) => ({ ...chunk, rankScore: scores.get(chunk.id)! }));
}

export function rankChunks(query: NumericVector, candidates: readonly IndexedChunk[], options: RankOptions): VectorRankedChunk[] {
  return selectChunks(vectorRanking(query, candidates, options.excludePath), options);
}
