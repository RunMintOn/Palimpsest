import { IndexedChunk, SearchResult } from "./types";

export function cosineSimilarity(left: number[], right: number[]): number {
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

export function rankChunks(query: number[], candidates: readonly IndexedChunk[], options: RankOptions): SearchResult[] {
  const scored = candidates
    .filter((chunk) => chunk.filePath !== options.excludePath)
    .map((chunk) => ({ ...chunk, similarity: cosineSimilarity(query, chunk.vector) }))
    .sort((a, b) => b.similarity - a.similarity);
  const results: SearchResult[] = [];
  const perFile = new Map<string, number>();
  const duplicateAt = options.duplicateSimilarity ?? 0.995;
  for (const candidate of scored) {
    if ((perFile.get(candidate.filePath) ?? 0) >= options.maxPerFile) continue;
    const normalized = candidate.text.replace(/\s+/g, " ").trim();
    const duplicate = results.some((result) =>
      result.text.replace(/\s+/g, " ").trim() === normalized ||
      (result.filePath === candidate.filePath && cosineSimilarity(result.vector, candidate.vector) >= duplicateAt));
    if (duplicate) continue;
    results.push(candidate);
    perFile.set(candidate.filePath, (perFile.get(candidate.filePath) ?? 0) + 1);
    if (results.length >= options.topK) break;
  }
  return results;
}
