import { chunkMarkdown } from "./chunker";
import { Chunk, IndexIdentity } from "./types";

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
  return { ...snapshot, chunks };
}
