import assert from "node:assert/strict";
import test from "node:test";
import { IndexDocumentScanStale, IndexDocumentStructureError, IndexScannableFile, scanIndexDocument, validateScannedDocumentChunks } from "../src/index-document-scan";
import { CHUNKER_VERSION, IndexIdentity } from "../src/types";

const identity: IndexIdentity = {
  model: "test",
  dimensions: 3,
  chunkerVersion: CHUNKER_VERSION,
  chunkTargetLength: 10,
  chunkMaxLength: 20,
  chunkMinLength: 1
};

function file(): IndexScannableFile {
  return { path: "note.md", basename: "note", stat: { mtime: 1, size: 4 } };
}

test("document scanner returns chunks and metadata from one stable read window", async () => {
  const source = file();
  const scanned = await scanIndexDocument(source, identity, async () => "body", () => undefined);
  assert.deepEqual(
    { filePath: scanned.filePath, fileName: scanned.fileName, sourceMtime: scanned.sourceMtime, sourceSize: scanned.sourceSize },
    { filePath: "note.md", fileName: "note", sourceMtime: 1, sourceSize: 4 }
  );
  assert.equal(scanned.chunks.length, 1);
});

test("document scanner rejects stat and content changes during cachedRead", async () => {
  const source = file();
  await assert.rejects(() => scanIndexDocument(source, identity, async () => {
    source.stat = { mtime: 2, size: 8 };
    return "old body";
  }, () => undefined), IndexDocumentScanStale);
});

test("document scanner rejects a rename during cachedRead", async () => {
  const source = file();
  await assert.rejects(() => scanIndexDocument(source, identity, async () => {
    source.path = "renamed.md";
    source.basename = "renamed";
    return "body";
  }, () => undefined), IndexDocumentScanStale);
});

test("an empty document is still a valid stable scan snapshot", async () => {
  const scanned = await scanIndexDocument(file(), identity, async () => "", () => undefined);
  assert.deepEqual(scanned.chunks, []);
  assert.equal(scanned.filePath, "note.md");
});

test("unload barriers stop document scanning before and after cachedRead", async () => {
  let reads = 0;
  await assert.rejects(() => scanIndexDocument(file(), identity, async () => { reads++; return "body"; }, () => { throw new Error("unloaded"); }), /unloaded/);
  assert.equal(reads, 0);

  let active = true;
  await assert.rejects(() => scanIndexDocument(file(), identity, async () => {
    active = false;
    return "body";
  }, () => { if (!active) throw new Error("unloaded"); }), /unloaded/);
});

test("a stale document aborts a multi-document scan before a patch candidate exists", async () => {
  const first = await scanIndexDocument(file(), identity, async () => "body", () => undefined);
  const changed = file();
  await assert.rejects(() => scanIndexDocument(changed, identity, async () => {
    changed.stat.size = 5;
    return "changed";
  }, () => undefined), IndexDocumentScanStale);
  // Callers receive no completed batch to hand to prepare/commit.
  assert.equal(first.filePath, "note.md");
});

test("skipped Markdown heading levels still produce storage-valid breadcrumbs", async () => {
  const scanned = await scanIndexDocument(file(), identity, async () => "## 看板\n\n卡片内容", () => undefined);
  assert.deepEqual(scanned.chunks[0].breadcrumb, ["看板"]);
  assert.ok(scanned.chunks[0].breadcrumb.every((heading) => typeof heading === "string"));
});

test("arbitrary heading jumps retain only defined ancestor breadcrumbs", async () => {
  const scanned = await scanIndexDocument(file(), identity, async () => "# 总览\n\n总览内容\n\n### 深层\n\n深层内容\n\n## 同级父层\n\n父层内容", () => undefined);
  assert.deepEqual(scanned.chunks.map((chunk) => chunk.breadcrumb), [["总览"], ["总览", "深层"], ["总览", "同级父层"]]);
  assert.ok(scanned.chunks.flatMap((chunk) => chunk.breadcrumb).every((heading) => typeof heading === "string"));
});

test("chunk storage preflight produces a safe file-local error before embedding can begin", () => {
  assert.throws(() => validateScannedDocumentChunks({
    filePath: "bad.md",
    fileName: "bad",
    sourceMtime: 1,
    sourceSize: 1,
    chunks: [{ id: "bad", contentHash: "bad", filePath: "other.md", fileName: "bad", breadcrumb: [], text: "body", startLine: 1, endLine: 1 }]
  }), (error: unknown) => error instanceof IndexDocumentStructureError &&
    error.reasonCode === "invalid-chunk-structure" && error.document.filePath === "bad.md");
});
