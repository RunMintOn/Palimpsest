import assert from "node:assert/strict";
import test from "node:test";
import { planIndexReconciliation, runIndexReconciliation } from "../src/index-reconciliation";

const indexed = [
  { filePath: "changed.md", fileName: "changed", sourceMtime: 1, sourceSize: 10 },
  { filePath: "deleted.md", fileName: "deleted", sourceMtime: 2, sourceSize: 20 }
];

test("startup reconciliation identifies added, deleted, and stat-changed documents", () => {
  const plan = planIndexReconciliation(indexed, [
    { path: "changed.md", mtime: 3, size: 10 },
    { path: "added.md", mtime: 4, size: 30 }
  ]);
  assert.deepEqual(plan, {
    added: ["added.md"],
    deleted: ["deleted.md"],
    statChanged: ["changed.md"],
    changes: [
      { kind: "path", path: "added.md" },
      { kind: "path", path: "changed.md" },
      { kind: "path", path: "deleted.md" }
    ]
  });
});

test("unchanged reconciliation neither reads bodies nor submits a patch", async () => {
  let submitted = 0;
  const plan = await runIndexReconciliation(indexed, () => indexed.map((document) => ({
    path: document.filePath, mtime: document.sourceMtime, size: document.sourceSize
  })), () => { submitted++; });
  assert.deepEqual(plan.changes, []);
  assert.equal(submitted, 0);
});

test("a rename after a full-build scan is an added new path and a deleted scanned path", () => {
  const plan = planIndexReconciliation([
    { filePath: "old.md", fileName: "old", sourceMtime: 1, sourceSize: 2 }
  ], [
    { path: "new.md", mtime: 1, size: 2 }
  ]);
  assert.deepEqual(plan.added, ["new.md"]);
  assert.deepEqual(plan.deleted, ["old.md"]);
});
