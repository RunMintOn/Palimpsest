import { IndexedDocumentMetadata, SkippedIndexedDocument } from "./types";
import { VaultChange } from "./vault-change-plan";

/** The only file facts needed to decide whether an indexed document may be stale. */
export interface ReconciliationFile {
  path: string;
  mtime: number;
  size: number;
}

export interface IndexReconciliationPlan {
  changes: VaultChange[];
  added: string[];
  deleted: string[];
  statChanged: string[];
}

/**
 * Compares paths and cheap vault stat fields only. It deliberately has no
 * content reader: callers must not read every Markdown body at startup.
 */
export function planIndexReconciliation(
  indexedDocuments: readonly (IndexedDocumentMetadata | SkippedIndexedDocument)[],
  currentFiles: readonly ReconciliationFile[]
): IndexReconciliationPlan {
  const indexed = new Map(indexedDocuments.map((document) => [document.filePath, document]));
  const current = new Map(currentFiles.map((file) => [file.path, file]));
  const added: string[] = [];
  const deleted: string[] = [];
  const statChanged: string[] = [];

  for (const [path, file] of current) {
    const document = indexed.get(path);
    if (!document) added.push(path);
    else if (document.sourceMtime !== file.mtime || document.sourceSize !== file.size) statChanged.push(path);
  }
  for (const path of indexed.keys()) if (!current.has(path)) deleted.push(path);

  const changes = [...added, ...statChanged, ...deleted]
    .sort()
    .map((path) => ({ kind: "path", path }) as VaultChange);
  return { changes, added: added.sort(), deleted: deleted.sort(), statChanged: statChanged.sort() };
}

/** Runs a plan without exposing a content-read operation or submitting an empty patch. */
export async function runIndexReconciliation(
  indexedDocuments: readonly (IndexedDocumentMetadata | SkippedIndexedDocument)[],
  listCurrentFiles: () => readonly ReconciliationFile[],
  submitChanges: (changes: readonly VaultChange[]) => Promise<void> | void
): Promise<IndexReconciliationPlan> {
  const plan = planIndexReconciliation(indexedDocuments, listCurrentFiles());
  if (plan.changes.length) await submitChanges(plan.changes);
  return plan;
}
