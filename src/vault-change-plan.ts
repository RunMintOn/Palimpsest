export type VaultChange =
  | { kind: "path"; path: string }
  | { kind: "folder-delete"; path: string }
  | { kind: "rename"; oldPath: string; newPath: string; isFolder: boolean };

function isMarkdownPath(path: string): boolean {
  return path.endsWith(".md");
}

/** Keeps non-Markdown files from waking the incremental-index pipeline. */
export function indexRelevantVaultChange(change: VaultChange): boolean {
  if (change.kind === "folder-delete") return true;
  if (change.kind === "path") return isMarkdownPath(change.path);
  return change.isFolder || isMarkdownPath(change.oldPath) || isMarkdownPath(change.newPath);
}

export interface VaultChangePlanInput {
  changes: readonly VaultChange[];
  /** Includes empty documents, not merely paths which currently have chunks. */
  indexedDocumentPaths: readonly string[];
  currentMarkdownPaths: readonly string[];
  isIncluded(path: string): boolean;
}

export interface VaultChangePlan {
  upsertPaths: string[];
  deletes: string[];
}

/** Snapshot-and-restore queue prevents events arriving during an async batch from being lost. */
export class VaultChangeQueue {
  private changes: Array<{ change: VaultChange; revision: number }> = [];
  private readonly snapshotRevisions = new WeakMap<readonly VaultChange[], readonly number[]>();

  get size(): number { return this.changes.length; }

  enqueue(change: VaultChange, revision = Number.POSITIVE_INFINITY): void { this.changes.push({ change, revision }); }

  take(): VaultChange[] {
    const snapshot = this.changes;
    this.changes = [];
    const changes = snapshot.map((item) => item.change);
    this.snapshotRevisions.set(changes, snapshot.map((item) => item.revision));
    return changes;
  }

  restore(snapshot: readonly VaultChange[]): void {
    const revisions = this.snapshotRevisions.get(snapshot);
    this.changes = [
      ...snapshot.map((change, index) => ({ change, revision: revisions?.[index] ?? Number.POSITIVE_INFINITY })),
      ...this.changes
    ];
  }

  /** Drops events whose vault revision was included in a published full scan. */
  discardThrough(revision: number): void {
    this.changes = this.changes.filter((item) => item.revision > revision);
  }

  clear(): void { this.changes = []; }
}

/**
 * Coalesces Vault events into one document patch. It deliberately plans from
 * current vault paths, so repeated create/modify/delete events collapse and a
 * folder rename becomes one batch rather than one transaction per document.
 */
export function planVaultChanges(input: VaultChangePlanInput): VaultChangePlan {
  const current = new Set(input.currentMarkdownPaths);
  const indexed = new Set(input.indexedDocumentPaths);
  const upserts = new Set<string>();
  const deletes = new Set<string>();

  const addCurrent = (path: string) => {
    if (current.has(path) && input.isIncluded(path)) {
      upserts.add(path);
      deletes.delete(path);
    } else if (indexed.has(path)) {
      deletes.add(path);
    }
  };
  const remove = (path: string) => {
    upserts.delete(path);
    if (indexed.has(path)) deletes.add(path);
  };

  for (const change of input.changes) {
    if (change.kind === "path") {
      addCurrent(change.path);
      continue;
    }
    if (change.kind === "folder-delete") {
      const prefix = `${change.path}/`;
      for (const path of indexed) if (path === change.path || path.startsWith(prefix)) remove(path);
      continue;
    }
    if (!change.isFolder) {
      if (change.oldPath !== change.newPath) remove(change.oldPath);
      addCurrent(change.newPath);
      continue;
    }

    const oldPrefix = `${change.oldPath}/`;
    const newPrefix = `${change.newPath}/`;
    const movedOldPaths = [...indexed].filter((path) => path === change.oldPath || path.startsWith(oldPrefix));
    for (const oldPath of movedOldPaths) {
      const suffix = oldPath === change.oldPath ? "" : oldPath.slice(change.oldPath.length);
      const newPath = `${change.newPath}${suffix}`;
      remove(oldPath);
      addCurrent(newPath);
    }
    // A folder can move in from an excluded/unindexed location, or contain an
    // empty document not represented by old chunk data. Current paths fill both gaps.
    for (const path of current) {
      if (path === change.newPath || path.startsWith(newPrefix)) addCurrent(path);
    }
  }

  return {
    upsertPaths: [...upserts].sort(),
    deletes: [...deletes].filter((path) => !upserts.has(path)).sort()
  };
}
