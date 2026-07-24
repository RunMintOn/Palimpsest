import assert from "node:assert/strict";
import test from "node:test";
import { planIndexScopeTransition } from "../src/index-scope-transition";
import { indexScope } from "../src/index-scope";

function plan(effective: string[], desired: string[], markdownPaths: string[], indexedDocumentPaths: string[]) {
  return planIndexScopeTransition({
    effectiveScope: indexScope(effective),
    desiredScope: indexScope(desired),
    markdownPaths,
    indexedDocumentPaths
  });
}

test("including a formerly excluded directory scans only its Markdown paths", () => {
  assert.deepEqual(plan(["B", "C"], ["C"], ["A/a.md", "B/b.md", "B/nested/c.md", "C/c.md"], ["A/a.md"]), {
    hasScopeChange: true,
    upsertPaths: ["B/b.md", "B/nested/c.md"],
    deletePaths: []
  });
});

test("excluding a formerly included directory deletes indexed and skipped paths only", () => {
  assert.deepEqual(plan([], ["B"], ["A/a.md", "B/present.md"], ["A/a.md", "B/indexed.md", "B/skipped.md"]), {
    hasScopeChange: true,
    upsertPaths: [],
    deletePaths: ["B/indexed.md", "B/skipped.md"]
  });
});

test("scope transitions respect directory boundaries and do not touch unchanged paths", () => {
  assert.deepEqual(plan(["Work"], [], ["Work/note.md", "Workflow/note.md", "Elsewhere/note.md"], ["Workflow/note.md", "Elsewhere/note.md"]), {
    hasScopeChange: true,
    upsertPaths: ["Work/note.md"],
    deletePaths: []
  });
});

test("parent and child exclusions produce only the paths newly included or excluded", () => {
  assert.deepEqual(plan(["Parent"], ["Parent/Child"], ["Parent/top.md", "Parent/Child/nested.md"], ["Parent/top.md"]), {
    hasScopeChange: true,
    upsertPaths: ["Parent/top.md"],
    deletePaths: []
  });
  assert.deepEqual(plan(["Parent/Child"], ["Parent"], ["Parent/top.md", "Parent/Child/nested.md"], ["Parent/top.md", "Parent/Child/nested.md"]), {
    hasScopeChange: true,
    upsertPaths: [],
    deletePaths: ["Parent/top.md"]
  });
});

test("one transition can include and exclude separate directories", () => {
  assert.deepEqual(plan(["B"], ["C"], ["A/a.md", "B/b.md", "C/c.md"], ["A/a.md", "C/c.md"]), {
    hasScopeChange: true,
    upsertPaths: ["B/b.md"],
    deletePaths: ["C/c.md"]
  });
});

test("an empty-directory scope change still produces an empty document patch", () => {
  assert.deepEqual(plan(["Empty"], [], ["A/a.md"], ["A/a.md"]), {
    hasScopeChange: true,
    upsertPaths: [],
    deletePaths: []
  });
});
