import { EmbeddingError } from "./embedding-provider";
import { HybridRetrieval, KeywordIndexUnavailable } from "./hybrid-retrieval";
import type { IndexedChunk, NumericVector } from "./types";

export interface TextQueryRequest {
  text: string;
  sourcePath: string;
  candidatePaths: string[];
  limit?: number;
}
export type TextQueryCode = "invalid-input" | "index-needed" | "index-incompatible" | "temporarily-unavailable" | "backend-unavailable" | "query-failed";
export interface TextQueryFailure { ok: false; code: TextQueryCode; message: string }
export interface TextQueryResult { filePath: string; excerpt: { text: string; startLine: number; endLine: number } }
export type TextQueryResponse = { ok: true; results: TextQueryResult[]; knownPendingUpdates: boolean } | TextQueryFailure;
export interface RetrievalApi { readonly apiVersion: 1; query(request: TextQueryRequest): Promise<TextQueryResponse> }

export interface TextQuerySnapshot {
  chunks: readonly IndexedChunk[];
  retrieval: HybridRetrieval;
  embedQuery(text: string): Promise<NumericVector>;
  /** Checks committed generation, model input configuration and plugin lifetime, never a caller's UI epoch. */
  isCurrent(): boolean;
}

export const queryFailure = (code: TextQueryCode, message: string): TextQueryFailure => ({ ok: false, code, message });

function vaultPath(value: unknown): string | undefined {
  if (typeof value !== "string" || !value || /[\u0000-\u001f*?]/.test(value)) return;
  const path = value.replace(/\\/g, "/");
  if (path.startsWith("/") || /^[a-zA-Z]:/.test(path) || path.includes(":")) return;
  const parts = path.split("/").filter(part => part && part !== ".");
  if (!parts.length || parts.includes("..")) return;
  return parts.join("/");
}

/** A one-shot public query; no editor state, automatic indexing or presentation side effects. */
export function createRetrievalApi(host: {
  snapshot(): TextQuerySnapshot | TextQueryFailure;
  knownPendingUpdates(): boolean;
}): RetrievalApi {
  return {
    apiVersion: 1,
    async query(request) {
      if (!request || typeof request.text !== "string" || !request.text.trim() || request.text.length > 16000 ||
          !Array.isArray(request.candidatePaths) || request.limit !== undefined && typeof request.limit !== "number" || !Number.isInteger(request.limit ?? 5) || (request.limit ?? 5) < 1 || (request.limit ?? 5) > 20) {
        return queryFailure("invalid-input", "请输入非空正文（最多 16000 字符），结果数量须为 1–20 的整数。");
      }
      const sourcePath = vaultPath(request.sourcePath);
      const paths = request.candidatePaths.map(vaultPath);
      if (!sourcePath || paths.some(path => !path)) return queryFailure("invalid-input", "请使用 Vault 内的相对文件路径，不支持绝对路径或上级目录。");
      let isCurrent: (() => boolean) | undefined;
      const failure = () => queryFailure("temporarily-unavailable", "索引或插件状态已改变，请稍后重新查询。");
      try {
        const snapshot = host.snapshot();
        if ("ok" in snapshot) return snapshot;
        const { chunks, retrieval } = snapshot;
        isCurrent = snapshot.isCurrent;
        const candidates = new Set(paths as string[]);
        candidates.delete(sourcePath);
        if (!isCurrent()) return failure();
        if (!chunks.some(chunk => candidates.has(chunk.filePath))) return { ok: true, results: [], knownPendingUpdates: host.knownPendingUpdates() };
        const vector = await snapshot.embedQuery(request.text.trim());
        if (!isCurrent()) return failure();
        const results = await retrieval.search(request.text.trim(), vector, chunks, {
          topK: request.limit ?? 5, maxPerFile: 1, excludePath: sourcePath, candidatePaths: candidates
        }, isCurrent);
        if (!isCurrent()) return failure();
        return {
          ok: true,
          results: results.map(result => ({ filePath: result.filePath, excerpt: { text: result.text, startLine: result.startLine, endLine: result.endLine } })),
          knownPendingUpdates: host.knownPendingUpdates()
        };
      } catch (error) {
        if (isCurrent && !isCurrent()) return failure();
        console.error("[Palimpsest] Text query failed", error);
        const unavailable = error instanceof KeywordIndexUnavailable || error instanceof EmbeddingError && error.kind === "connection";
        return queryFailure(unavailable ? "backend-unavailable" : "query-failed", `检索失败：${error instanceof Error ? error.message : String(error)}`);
      }
    }
  };
}
