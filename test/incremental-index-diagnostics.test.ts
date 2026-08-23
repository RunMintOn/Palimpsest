import assert from "node:assert/strict";
import test from "node:test";
import { incrementalIndexConfirmationModel } from "../src/index-build-confirmation";
import { diagnoseIncrementalIndexUpdate, formatIncrementalIndexDiagnostic } from "../src/incremental-index-diagnostics";
import { indexScope } from "../src/index-scope";
import { Chunk, IndexedChunk } from "../src/types";

function chunk(filePath: string, text: string): Chunk {
  return {
    id: `${filePath}:${text}`,
    contentHash: text,
    filePath,
    fileName: filePath.split("/").at(-1)!.replace(/\.md$/, ""),
    breadcrumb: ["Heading"],
    text,
    startLine: 1,
    endLine: 1
  };
}

function indexed(source: Chunk): IndexedChunk {
  return { ...source, vector: new Float32Array([1, 2, 3]) };
}

test("incremental diagnostics classify reusable documents without exposing Markdown text", () => {
  const oldChunks = [
    indexed(chunk("old/fully-reused.md", "fully reusable body")),
    indexed(chunk("old/partially-reused.md", "unchanged section")),
    indexed(chunk("old/unmatched.md", "old unmatched body"))
  ];
  const diagnostic = diagnoseIncrementalIndexUpdate({
    scope: indexScope(["Excluded"]),
    changes: [
      { kind: "path", path: "new/fully-reused.md" },
      { kind: "rename", oldPath: "old", newPath: "new", isFolder: true },
      { kind: "folder-delete", path: "Removed" }
    ],
    upsertPaths: ["new/fully-reused.md", "new/partially-reused.md", "new/unmatched.md"],
    deletes: ["old/fully-reused.md", "old/partially-reused.md", "Removed/old.md"],
    indexedDocumentPaths: ["old/fully-reused.md", "old/partially-reused.md", "old/unmatched.md", "Removed/old.md"],
    indexedChunks: oldChunks,
    documents: [
      { filePath: "new/fully-reused.md", fileName: "fully-reused", sourceMtime: 2, sourceSize: 1, chunks: [chunk("new/fully-reused.md", "fully reusable body")] },
      {
        filePath: "new/partially-reused.md", fileName: "partially-reused", sourceMtime: 2, sourceSize: 2,
        chunks: [chunk("new/partially-reused.md", "changed section"), chunk("new/partially-reused.md", "unchanged section")]
      },
      { filePath: "new/unmatched.md", fileName: "unmatched", sourceMtime: 2, sourceSize: 3, chunks: [chunk("new/unmatched.md", "new unmatched body")] }
    ],
    skippedDocuments: [{ filePath: "new/skipped.md", fileName: "skipped", sourceMtime: 2, sourceSize: 4, reasonCode: "invalid-chunk-structure" }],
    summary: {
      documents: 4,
      reusableChunks: 2,
      pendingChunks: 2,
      pendingDocuments: 2,
      changes: { added: 3, renamed: 0, modified: 0, skipped: 1, deleted: 3 }
    }
  });

  assert.deepEqual(diagnostic.effectiveScope, { excludedDirectories: ["Excluded"] });
  assert.deepEqual(diagnostic.observedEvents, { path: 1, fileRename: 0, folderRename: 1, folderDelete: 1 });
  assert.deepEqual(diagnostic.plan, {
    upsertPaths: 3,
    newPaths: 3,
    deletes: 3,
    upsertTopLevelDirectories: [{ path: "new", documents: 3 }],
    deleteTopLevelDirectories: [{ path: "old", documents: 2 }, { path: "Removed", documents: 1 }]
  });
  assert.deepEqual(diagnostic.vectorReuse, {
    scannedDocuments: 3,
    skippedDocuments: 1,
    fullyReusableDocuments: 1,
    partiallyReusableDocuments: 1,
    noReusableChunksDocuments: 1,
    reusableChunks: 2,
    pendingChunks: 2,
    pendingTopLevelDirectories: [
      { path: "new", documents: 2, reusableChunks: 1, pendingChunks: 2 }
    ]
  });
  assert.deepEqual(diagnostic.pendingDocumentSamples, [
    {
      path: "new/partially-reused.md",
      reusableChunks: 1,
      pendingChunks: 1,
      wasIndexedAtThisPath: false,
      indexedSameFilenamePathCount: 1,
      indexedSameFilenamePaths: ["old/partially-reused.md"]
    },
    {
      path: "new/unmatched.md",
      reusableChunks: 0,
      pendingChunks: 1,
      wasIndexedAtThisPath: false,
      indexedSameFilenamePathCount: 1,
      indexedSameFilenamePaths: ["old/unmatched.md"]
    }
  ]);
  assert.deepEqual(diagnostic.pendingDocuments, diagnostic.pendingDocumentSamples);
  const formatted = formatIncrementalIndexDiagnostic(diagnostic);
  assert.match(formatted, /# Palimpsest 增量索引诊断/);
  assert.doesNotMatch(formatted, /fully reusable body|changed section|new unmatched body/);
  assert.doesNotMatch(formatted, /1,2,3/);
  assert.doesNotMatch(formatted, /"pendingDocuments"/);

  const preview = incrementalIndexConfirmationModel({
    documents: 4,
    reusableChunks: 2,
    pendingChunks: 2,
    pendingDocuments: 2,
    changes: { added: 3, renamed: 0, modified: 0, skipped: 1, deleted: 3 }
  }, diagnostic).incrementalPreview;
  assert.deepEqual(preview, {
    directoryRows: [{ path: "new", detail: "待生成 2 · 可复用 1 · 2 篇" }],
    documentRows: [
      { path: "new/partially-reused.md", detail: "待生成 1 · 可复用 1" },
      { path: "new/unmatched.md", detail: "待生成 1 · 可复用 0" }
    ]
  });
  const manualPreview = incrementalIndexConfirmationModel({
    documents: 4,
    reusableChunks: 2,
    pendingChunks: 2,
    pendingDocuments: 2,
    changes: { added: 3, renamed: 0, modified: 0, skipped: 1, deleted: 3 }
  }, diagnostic, true);
  assert.equal(manualPreview.title, "待处理索引更新");
  assert.match(manualPreview.prompt, /只读预览/);
});
