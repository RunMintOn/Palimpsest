import { chunkMarkdown } from "./chunker";
import { Chunk, IndexIdentity, SkippedDocumentReasonCode } from "./types";

/** The file facts and chunks observed during one stable cached-read window. */
export interface ScannedIndexDocument {
  filePath: string;
  fileName: string;
  sourceMtime: number;
  sourceSize: number;
  chunks: readonly Chunk[];
}

/** Minimal structural view of TFile, kept testable without an Obsidian runtime. */
export interface IndexScannableFile {
  path: string;
  basename: string;
  stat: { mtime: number; size: number };
}

/** A read observed a changed path, name, or stat and cannot represent one document version. */
export class IndexDocumentScanStale extends Error {
  constructor() {
    super("Index document changed while it was being scanned");
    this.name = "IndexDocumentScanStale";
  }
}

/** A safe, file-local scan result failure that may be persisted as skipped. */
export class IndexDocumentStructureError extends Error {
  readonly reasonCode: SkippedDocumentReasonCode = "invalid-chunk-structure";

  constructor(readonly document: Omit<ScannedIndexDocument, "chunks">) {
    super("Document chunks cannot be stored safely");
    this.name = "IndexDocumentStructureError";
  }
}

/**
 * This preflight intentionally runs before any embedding request. IndexStore
 * repeats it defensively, but normal malformed chunk candidates are caught
 * while their stable source-file snapshot is still available.
 */
export function validateScannedDocumentChunks(document: ScannedIndexDocument): void {
  for (const chunk of document.chunks) {
    if (!chunk || typeof chunk.id !== "string" || !chunk.id || typeof chunk.contentHash !== "string" || !chunk.contentHash ||
      chunk.filePath !== document.filePath || chunk.fileName !== document.fileName || typeof chunk.fileName !== "string" || !chunk.fileName ||
      !Array.isArray(chunk.breadcrumb) || chunk.breadcrumb.some((heading) => typeof heading !== "string" || !heading) ||
      typeof chunk.text !== "string" || !chunk.text || !Number.isInteger(chunk.startLine) || chunk.startLine < 1 ||
      !Number.isInteger(chunk.endLine) || chunk.endLine < chunk.startLine) {
      throw new IndexDocumentStructureError({
        filePath: document.filePath,
        fileName: document.fileName,
        sourceMtime: document.sourceMtime,
        sourceSize: document.sourceSize
      });
    }
  }
}

/**
 * Captures a document metadata/content snapshot. Callers must abandon their
 * entire batch when this rejects: mixing its chunks with later stat values is
 * never a valid recovery.
 */
export async function scanIndexDocument(
  file: IndexScannableFile,
  identity: IndexIdentity,
  read: (file: IndexScannableFile) => Promise<string>,
  assertCanContinue: () => void
): Promise<ScannedIndexDocument> {
  assertCanContinue();
  const snapshot = {
    filePath: file.path,
    fileName: file.basename,
    sourceMtime: file.stat.mtime,
    sourceSize: file.stat.size
  };
  const markdown = await read(file);
  assertCanContinue();
  if (file.path !== snapshot.filePath || file.basename !== snapshot.fileName ||
    file.stat.mtime !== snapshot.sourceMtime || file.stat.size !== snapshot.sourceSize) {
    throw new IndexDocumentScanStale();
  }
  const chunks = chunkMarkdown(snapshot.filePath, markdown, {
    targetLength: identity.chunkTargetLength,
    maxLength: identity.chunkMaxLength,
    minLength: identity.chunkMinLength
  });
  assertCanContinue();
  const document = { ...snapshot, chunks };
  validateScannedDocumentChunks(document);
  return document;
}
