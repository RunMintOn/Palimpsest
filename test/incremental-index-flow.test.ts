import assert from "node:assert/strict";
import test from "node:test";
import { BulkIndexUpdateDeferral } from "../src/bulk-index-update-deferral";
import { runPreparedIncrementalIndexUpdate } from "../src/incremental-index-flow";

test("cancelling a large update neither executes nor commits and defers repeat prompts until rebuild", async () => {
  let confirms = 0;
  let executions = 0;
  let commits = 0;
  const outcome = await runPreparedIncrementalIndexUpdate({
    needsConfirmation: true,
    confirm: async () => { confirms++; return false; },
    execute: async () => { executions++; return "prepared"; },
    commit: async () => { commits++; }
  });
  assert.equal(outcome, "cancelled");
  assert.deepEqual({ confirms, executions, commits }, { confirms: 1, executions: 0, commits: 0 });

  const deferral = new BulkIndexUpdateDeferral();
  deferral.defer();
  assert.equal(deferral.isDeferred, true, "event handling must not reopen the cancelled confirmation");
  deferral.clear();
  assert.equal(deferral.isDeferred, false, "a successful full rebuild re-enables incremental updates");
});
