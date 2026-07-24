import assert from "node:assert/strict";
import test from "node:test";
import { completionActions } from "../src/index-update-coordination";
import { runSettingsRetryAction } from "../src/settings-retry-action";

test("successful manual retry refreshes only after flags are cleared and schedules events queued during retry", () => {
  const actions = completionActions({
    pluginActive: true,
    indexReady: true,
    buildActive: false,
    pendingChanges: 1,
    fallbackGenerationInUse: false,
    deferredLargeIndexUpdate: false,
    patchSucceeded: true,
    refreshRequested: true,
    schedulePendingAfterFailure: true
  });
  assert.deepEqual(actions, { refreshQuery: true, schedulePending: true });
});

test("failed manual retry preserves queued events for scheduling but never refreshes a query", () => {
  const actions = completionActions({
    pluginActive: true,
    indexReady: true,
    buildActive: false,
    pendingChanges: 2,
    fallbackGenerationInUse: false,
    deferredLargeIndexUpdate: false,
    patchSucceeded: false,
    refreshRequested: true,
    schedulePendingAfterFailure: true
  });
  assert.deepEqual(actions, { refreshQuery: false, schedulePending: true });
});

test("completion does not revive queued updates after unload or while fallback/defer blocks patching", () => {
  const base = {
    pluginActive: true,
    indexReady: true,
    buildActive: false,
    pendingChanges: 1,
    fallbackGenerationInUse: false,
    deferredLargeIndexUpdate: false,
    patchSucceeded: true,
    refreshRequested: true,
    schedulePendingAfterFailure: true
  };
  assert.deepEqual(completionActions({ ...base, pluginActive: false }), { refreshQuery: false, schedulePending: false });
  assert.deepEqual(completionActions({ ...base, fallbackGenerationInUse: true }), { refreshQuery: true, schedulePending: false });
  assert.deepEqual(completionActions({ ...base, deferredLargeIndexUpdate: true }), { refreshQuery: true, schedulePending: false });
});

test("settings retry action redraws after failure and reports it exactly once", async () => {
  let redraws = 0;
  let notices = 0;
  await runSettingsRetryAction({
    retry: async () => { throw new Error("preflight failed"); },
    reportFailure: () => { notices++; },
    redraw: () => { redraws++; }
  });
  assert.deepEqual({ redraws, notices }, { redraws: 1, notices: 1 });
});
