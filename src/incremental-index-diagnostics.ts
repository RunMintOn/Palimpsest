import { EmbeddingReuseLookup } from "./embedding-reuse";
import { IncrementalIndexSummary, IncrementalScannedDocument } from "./incremental-index-plan";
import { IndexScope } from "./index-scope";
import { IndexedChunk, SkippedIndexedDocument } from "./types";
import { VaultChange } from "./vault-change-plan";

const SAMPLE_LIMIT = 20;
const SAME_FILENAME_PATH_LIMIT = 3;

export interface IncrementalIndexDiagnosticInput {
  scope: IndexScope;
  changes: readonly VaultChange[];
  upsertPaths: readonly string[];
  deletes: readonly string[];
  indexedDocumentPaths: readonly string[];
  indexedChunks: readonly IndexedChunk[];
  documents: readonly IncrementalScannedDocument[];
  skippedDocuments?: readonly SkippedIndexedDocument[];
  summary: IncrementalIndexSummary;
}

interface PathCount {
  path: string;
  documents: number;
}

export interface PendingDocumentDiagnostic {
  path: string;
  reusableChunks: number;
  pendingChunks: number;
  wasIndexedAtThisPath: boolean;
  indexedSameFilenamePathCount: number;
  indexedSameFilenamePaths: readonly string[];
}

export interface PendingTopLevelDirectoryDiagnostic {
  path: string;
  documents: number;
  reusableChunks: number;
  pendingChunks: number;
}

export interface IncrementalIndexDiagnostic {
  readonly formatVersion: 1;
  readonly effectiveScope: { readonly excludedDirectories: readonly string[] };
  readonly observedEvents: {
    readonly path: number;
    readonly fileRename: number;
    readonly folderRename: number;
    readonly folderDelete: number;
  };
  readonly plan: {
    readonly upsertPaths: number;
    readonly newPaths: number;
    readonly deletes: number;
    readonly upsertTopLevelDirectories: readonly PathCount[];
    readonly deleteTopLevelDirectories: readonly PathCount[];
  };
  readonly vectorReuse: {
    readonly scannedDocuments: number;
    readonly skippedDocuments: number;
    readonly fullyReusableDocuments: number;
    readonly partiallyReusableDocuments: number;
    readonly noReusableChunksDocuments: number;
    readonly reusableChunks: number;
    readonly pendingChunks: number;
    readonly pendingTopLevelDirectories: readonly PendingTopLevelDirectoryDiagnostic[];
  };
  readonly changeSummary: IncrementalIndexSummary["changes"];
  /** Every pending document, sorted by model cost. This stays in memory for the preview UI. */
  readonly pendingDocuments: readonly PendingDocumentDiagnostic[];
  /** High-impact examples only; no Markdown body or vectors are included. */
  readonly pendingDocumentSamples: readonly PendingDocumentDiagnostic[];
}

function filenameFromPath(path: string): string {
  const filename = path.split("/").at(-1) ?? path;
  return filename.replace(/\.md$/i, "");
}

function topLevelDirectory(path: string): string {
  return path.split("/")[0] || "（Vault 根目录）";
}

function countTopLevelDirectories(paths: readonly string[]): PathCount[] {
  const counts = new Map<string, number>();
  for (const path of paths) {
    const directory = topLevelDirectory(path);
    counts.set(directory, (counts.get(directory) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([path, documents]) => ({ path, documents }))
    .sort((left, right) => right.documents - left.documents || left.path.localeCompare(right.path));
}

function eventCounts(changes: readonly VaultChange[]): IncrementalIndexDiagnostic["observedEvents"] {
  let path = 0;
  let fileRename = 0;
  let folderRename = 0;
  let folderDelete = 0;
  for (const change of changes) {
    if (change.kind === "path") path++;
    else if (change.kind === "folder-delete") folderDelete++;
    else if (change.isFolder) folderRename++;
    else fileRename++;
  }
  return { path, fileRename, folderRename, folderDelete };
}

/**
 * Creates a copy-safe explanation of an already prepared incremental update.
 * It uses the same path-independent embedding-input comparison as the planner,
 * but never exposes Markdown body text or vector values.
 */
export function diagnoseIncrementalIndexUpdate(input: IncrementalIndexDiagnosticInput): IncrementalIndexDiagnostic {
  const indexedPaths = new Set(input.indexedDocumentPaths);
  const indexedPathsByFilename = new Map<string, string[]>();
  for (const path of input.indexedDocumentPaths) {
    const filename = filenameFromPath(path);
    const paths = indexedPathsByFilename.get(filename) ?? [];
    paths.push(path);
    indexedPathsByFilename.set(filename, paths);
  }
  for (const paths of indexedPathsByFilename.values()) paths.sort();

  const lookup = new EmbeddingReuseLookup(input.indexedChunks);
  let fullyReusableDocuments = 0;
  let partiallyReusableDocuments = 0;
  let noReusableChunksDocuments = 0;
  let reusableChunks = 0;
  let pendingChunks = 0;
  const pendingDocuments: PendingDocumentDiagnostic[] = [];
  const pendingDirectories = new Map<string, { documents: number; reusableChunks: number; pendingChunks: number }>();

  for (const document of input.documents) {
    let documentReusableChunks = 0;
    let documentPendingChunks = 0;
    for (const chunk of document.chunks) {
      if (lookup.find(chunk)) documentReusableChunks++;
      else documentPendingChunks++;
    }
    reusableChunks += documentReusableChunks;
    pendingChunks += documentPendingChunks;
    if (!documentPendingChunks) fullyReusableDocuments++;
    else if (documentReusableChunks) partiallyReusableDocuments++;
    else noReusableChunksDocuments++;

    if (documentPendingChunks) {
      const sameFilenamePaths = (indexedPathsByFilename.get(document.fileName) ?? [])
        .filter((path) => path !== document.filePath);
      pendingDocuments.push({
        path: document.filePath,
        reusableChunks: documentReusableChunks,
        pendingChunks: documentPendingChunks,
        wasIndexedAtThisPath: indexedPaths.has(document.filePath),
        indexedSameFilenamePathCount: sameFilenamePaths.length,
        indexedSameFilenamePaths: sameFilenamePaths.slice(0, SAME_FILENAME_PATH_LIMIT)
      });
      const directory = topLevelDirectory(document.filePath);
      const total = pendingDirectories.get(directory) ?? { documents: 0, reusableChunks: 0, pendingChunks: 0 };
      total.documents++;
      total.reusableChunks += documentReusableChunks;
      total.pendingChunks += documentPendingChunks;
      pendingDirectories.set(directory, total);
    }
  }

  pendingDocuments.sort((left, right) => right.pendingChunks - left.pendingChunks || left.path.localeCompare(right.path));
  const pendingTopLevelDirectories = [...pendingDirectories.entries()]
    .map(([path, total]) => ({ path, ...total }))
    .sort((left, right) => right.pendingChunks - left.pendingChunks || left.path.localeCompare(right.path));
  return {
    formatVersion: 1,
    effectiveScope: { excludedDirectories: [...input.scope.excludedDirectories] },
    observedEvents: eventCounts(input.changes),
    plan: {
      upsertPaths: input.upsertPaths.length,
      newPaths: input.upsertPaths.filter((path) => !indexedPaths.has(path)).length,
      deletes: input.deletes.length,
      upsertTopLevelDirectories: countTopLevelDirectories(input.upsertPaths),
      deleteTopLevelDirectories: countTopLevelDirectories(input.deletes)
    },
    vectorReuse: {
      scannedDocuments: input.documents.length,
      skippedDocuments: input.skippedDocuments?.length ?? 0,
      fullyReusableDocuments,
      partiallyReusableDocuments,
      noReusableChunksDocuments,
      reusableChunks,
      pendingChunks,
      pendingTopLevelDirectories
    },
    changeSummary: { ...input.summary.changes },
    pendingDocuments,
    pendingDocumentSamples: pendingDocuments.slice(0, SAMPLE_LIMIT)
  };
}

/** A user-controlled clipboard payload that excludes Markdown body text and vector values. */
export function formatIncrementalIndexDiagnostic(diagnostic: IncrementalIndexDiagnostic): string {
  const { pendingDocuments: _pendingDocuments, ...copySafeDiagnostic } = diagnostic;
  return [
    "# Palimpsest 增量索引诊断",
    "此报告不含笔记正文或向量值。",
    "",
    "```json",
    JSON.stringify(copySafeDiagnostic, null, 2),
    "```"
  ].join("\n");
}
