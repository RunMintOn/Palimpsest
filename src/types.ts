import { IndexScope } from "./index-scope";

export const CHUNKER_VERSION = "2";

export interface Chunk {
  id: string;
  contentHash: string;
  filePath: string;
  fileName: string;
  breadcrumb: string[];
  text: string;
  startLine: number;
  endLine: number;
}

/** Both embedding responses and persisted Float32Array values are numeric vectors. */
export type NumericVector = number[] | Float32Array;

export interface IndexedChunk extends Chunk {
  vector: NumericVector;
}

/** Source metadata retained for document-level persistence and change planning. */
export interface IndexedDocumentMetadata {
  filePath: string;
  fileName: string;
  sourceMtime: number;
  sourceSize: number;
}

export interface IndexIdentity {
  model: string;
  dimensions: number;
  chunkerVersion: string;
  chunkTargetLength: number;
  chunkMaxLength: number;
  chunkMinLength: number;
}

export interface PersistentIndexData {
  /** Schema 2 records a successful full build independently from chunk count. */
  schemaVersion?: number;
  identity: IndexIdentity;
  chunks: IndexedChunk[];
  updatedAt: number;
  initialized?: boolean;
  /** Schema 3 snapshots the directories used by the successful full build. */
  scope?: IndexScope;
  /** Documents include empty Markdown files, which have no query chunks. */
  documents?: IndexedDocumentMetadata[];
}

export type IndexLifecycle = "uninitialized" | "ready" | "incompatible" | "building" | "cancelled" | "failed";

export interface IndexProgress {
  phase: "scanning" | "embedding" | "saving";
  current: number;
  total: number;
  label: string;
}

export type SidebarStatusKind =
  | "waiting-input"
  | "waiting-debounce"
  | "loading-model"
  | "querying"
  | "indexing"
  | "index-needed"
  | "index-failed"
  | "index-cancelled"
  | "complete"
  | "ollama-unavailable"
  | "index-empty"
  | "query-failed";

export interface SidebarState {
  kind: SidebarStatusKind;
  message: string;
  detail?: string;
  latencyMs?: number;
  progress?: IndexProgress;
  /** The view derives its CTA solely from this structured state. */
  indexAction?: "build" | "rebuild" | "retry";
}

export interface SearchResult extends IndexedChunk {
  similarity: number;
}
