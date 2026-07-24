import assert from "node:assert/strict";
import test from "node:test";
import { indexLoadRecoveryMessage } from "../src/index-load-feedback";
import { indexScope } from "../src/index-scope";
import { CHUNKER_VERSION } from "../src/types";

const data = { identity: { model: "test", dimensions: 3, chunkerVersion: CHUNKER_VERSION, chunkTargetLength: 1, chunkMaxLength: 2, chunkMinLength: 1 }, chunks: [], documents: [], updatedAt: 1, initialized: true, scope: indexScope([]) };

test("previous-generation fallback remains queryable and has a short user-safe notice", () => {
  const result = { status: "ready" as const, data, recovery: "used-previous-generation" as const };
  assert.equal(result.data.initialized, true);
  assert.equal(indexLoadRecoveryMessage(result), "本地索引已回退到上一份可用版本，建议稍后全量重建。");
  assert.equal(indexLoadRecoveryMessage({ status: "uninitialized" }), undefined);
});

test("an incompatible previous generation has no usable-fallback notice", () => {
  assert.equal(indexLoadRecoveryMessage({ status: "uninitialized" }), undefined);
});
