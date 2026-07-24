import assert from "node:assert/strict";
import test from "node:test";
import { EmbeddingReuseLookup, embeddingInputHash, groupChunksByEmbeddingInput } from "../src/embedding-reuse";
import { Chunk, IndexedChunk } from "../src/types";

function chunk(filePath: string, fileName: string, text = "body", breadcrumb = ["Heading"]): Chunk {
  return { id: `${filePath}:${text}`, contentHash: text, filePath, fileName, breadcrumb, text, startLine: 1, endLine: 1 };
}

function indexed(source: Chunk, vector = new Float32Array([1, 2, 3])): IndexedChunk {
  return { ...source, vector };
}

test("embedding input lookup reuses a pure move and rejects filename, heading, and text changes", () => {
  const old = indexed(chunk("old-folder/note.md", "note"));
  const lookup = new EmbeddingReuseLookup([old]);
  assert.strictEqual(lookup.find(chunk("new-folder/note.md", "note")), old.vector);
  assert.equal(lookup.find(chunk("new-folder/renamed.md", "renamed")), undefined);
  assert.equal(lookup.find(chunk("new-folder/note.md", "note", "body", ["Changed"])), undefined);
  assert.equal(lookup.find(chunk("new-folder/note.md", "note", "changed")), undefined);
  assert.equal(embeddingInputHash(old), embeddingInputHash(chunk("elsewhere/note.md", "note")));
});

test("equal new embedding inputs share one group while hash collisions still require exact comparison", () => {
  const first = chunk("a.md", "a", "same");
  const second = { ...chunk("b.md", "a", "same"), id: "second" };
  const third = chunk("c.md", "c", "different");
  const groups = groupChunksByEmbeddingInput([first, second, third]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].chunks.map((item) => item.id), [first.id, second.id]);
  assert.deepEqual(groups[1].chunks.map((item) => item.id), [third.id]);
});
