import assert from "node:assert/strict";
import test from "node:test";
import { canApplyIndexScopeChange, shouldRefreshAfterIndexScopeChange } from "../src/index-scope-application";

const readyPending = {
  scopePending: true,
  indexReady: true,
  buildActive: false,
  fullBuildRequestActive: false,
  fallbackGenerationInUse: false,
  deferredLargeIndexUpdate: false,
  applying: false
};

test("a deferred ordinary incremental update blocks applying an index scope change", () => {
  assert.equal(canApplyIndexScopeChange({ ...readyPending, deferredLargeIndexUpdate: true }), false);
  assert.equal(canApplyIndexScopeChange(readyPending), true);
});

test("an index scope change refreshes queries whenever it adds or removes documents, including the active document", () => {
  assert.equal(shouldRefreshAfterIndexScopeChange({ upsertCount: 1, deleteCount: 0 }), true);
  assert.equal(shouldRefreshAfterIndexScopeChange({ upsertCount: 0, deleteCount: 1 }), true);
  assert.equal(shouldRefreshAfterIndexScopeChange({ upsertCount: 0, deleteCount: 0 }), false);
});
