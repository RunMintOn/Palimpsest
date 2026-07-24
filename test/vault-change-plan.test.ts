import assert from "node:assert/strict";
import test from "node:test";
import { planVaultChanges, VaultChangeQueue } from "../src/vault-change-plan";

const included = (path: string) => !path.startsWith("Archive/");

test("path events coalesce into one document patch and delete a missing document", () => {
  const plan = planVaultChanges({
    changes: [{ kind: "path", path: "a.md" }, { kind: "path", path: "a.md" }, { kind: "path", path: "gone.md" }],
    indexedDocumentPaths: ["a.md", "gone.md"],
    currentMarkdownPaths: ["a.md"],
    isIncluded: included
  });
  assert.deepEqual(plan, { upsertPaths: ["a.md"], deletes: ["gone.md"] });
});

test("a pure file move upserts the new path and deletes only the old path", () => {
  const plan = planVaultChanges({
    changes: [{ kind: "rename", oldPath: "old/note.md", newPath: "new/note.md", isFolder: false }],
    indexedDocumentPaths: ["old/note.md"],
    currentMarkdownPaths: ["new/note.md"],
    isIncluded: included
  });
  assert.deepEqual(plan, { upsertPaths: ["new/note.md"], deletes: ["old/note.md"] });
});

test("folder rename batches every matching document once and discovers moved-in files", () => {
  const plan = planVaultChanges({
    changes: [{ kind: "rename", oldPath: "old", newPath: "new", isFolder: true }],
    indexedDocumentPaths: ["old/a.md", "old/nested/b.md"],
    currentMarkdownPaths: ["new/a.md", "new/nested/b.md", "new/newly-included.md"],
    isIncluded: included
  });
  assert.deepEqual(plan, {
    upsertPaths: ["new/a.md", "new/nested/b.md", "new/newly-included.md"],
    deletes: ["old/a.md", "old/nested/b.md"]
  });
});

test("moving a document into or out of an excluded directory becomes delete or insert", () => {
  const intoExcluded = planVaultChanges({
    changes: [{ kind: "rename", oldPath: "note.md", newPath: "Archive/note.md", isFolder: false }],
    indexedDocumentPaths: ["note.md"], currentMarkdownPaths: ["Archive/note.md"], isIncluded: included
  });
  const outOfExcluded = planVaultChanges({
    changes: [{ kind: "rename", oldPath: "Archive/note.md", newPath: "note.md", isFolder: false }],
    indexedDocumentPaths: [], currentMarkdownPaths: ["note.md"], isIncluded: included
  });
  assert.deepEqual(intoExcluded, { upsertPaths: [], deletes: ["note.md"] });
  assert.deepEqual(outOfExcluded, { upsertPaths: ["note.md"], deletes: [] });
});

test("deleting a folder deletes every indexed child in the same patch", () => {
  const plan = planVaultChanges({
    changes: [{ kind: "folder-delete", path: "removed" }],
    indexedDocumentPaths: ["removed/a.md", "removed/nested/b.md", "kept.md"],
    currentMarkdownPaths: ["kept.md"], isIncluded: included
  });
  assert.deepEqual(plan, { upsertPaths: [], deletes: ["removed/a.md", "removed/nested/b.md"] });
});

test("queue preserves rename facts and can discard only events covered by a full scan", () => {
  const queue = new VaultChangeQueue();
  queue.enqueue({ kind: "rename", oldPath: "old.md", newPath: "new.md", isFolder: false }, 4);
  queue.enqueue({ kind: "path", path: "changed-during-build.md" }, 5);
  queue.discardThrough(4);
  assert.deepEqual(queue.take(), [{ kind: "path", path: "changed-during-build.md" }]);
});

test("restoring a failed batch keeps it ahead of new events without an automatic retry", () => {
  const queue = new VaultChangeQueue();
  queue.enqueue({ kind: "path", path: "failed.md" }, 1);
  const failed = queue.take();
  queue.enqueue({ kind: "rename", oldPath: "old.md", newPath: "new.md", isFolder: false }, 2);
  queue.restore(failed);
  assert.deepEqual(queue.take(), [
    { kind: "path", path: "failed.md" },
    { kind: "rename", oldPath: "old.md", newPath: "new.md", isFolder: false }
  ]);
});
