import assert from "node:assert/strict";
import test from "node:test";
import { fuseRankings } from "../src/retrieval";
import type { IndexedChunk } from "../src/types";

export function chunk(id: string, path: string, text: string, vector = [1, 0]): IndexedChunk {
  return { id, contentHash: id, filePath: path, fileName: path, breadcrumb: [], text, startLine: 1, endLine: 1, vector };
}

test("keyword and vector ranks fuse before final selection and repeated IDs contribute once", () => {
  const chunks = [chunk("a", "a.md", "向量独有内容", [1, 0]), chunk("b", "b.md", "混合检索工具", [0, 1]), chunk("c", "c.md", "词法独有内容", [-1, 0])];
  const options = { topK: 3, maxPerFile: 1 };
  const result = fuseRankings(chunks, [["a", "b"], ["b", "b", "c"]], options);
  assert.deepEqual(result.map(r => r.id), ["b", "a", "c"]);
  assert.ok(Math.abs(result[0].rankScore - 0.03252247488101534) < 1e-12);
  assert.equal("vector" in result[0], false);
});
