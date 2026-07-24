import type { IndexBuildSummary } from "./index-build-plan";

export interface IndexBuildConfirmationLine {
  label: string;
  value: string;
}

export interface IndexBuildConfirmationModel {
  title: string;
  confirmLabel: string;
  prompt: string;
  lines: readonly IndexBuildConfirmationLine[];
  noEmbeddingMessage?: string;
}

/** Formats the small, user-visible summary independently from Obsidian's DOM. */
export function formatIndexBuildNumber(value: number): string {
  return value.toLocaleString();
}

function excludedDirectoryLabel(directories: readonly string[]): string {
  return directories.length ? directories.join("、") : "未排除目录";
}

/** Creates the complete confirmation copy from an opaque prepared-plan summary. */
export function indexBuildConfirmationModel(
  summary: IndexBuildSummary,
  hasUsableIndex: boolean
): IndexBuildConfirmationModel {
  const rebuilding = hasUsableIndex;
  return {
    title: rebuilding ? "准备全量重建" : "准备建立索引",
    confirmLabel: rebuilding ? "开始重建" : "开始建立",
    prompt: rebuilding
      ? "重建成功前将保留当前索引。取消或失败不会删除现有索引。"
      : "首次生成向量可能需要较长时间，实际耗时取决于模型和硬件。开始后可以取消。",
    lines: [
      { label: "Markdown 文件", value: formatIndexBuildNumber(summary.totalMarkdownFiles) },
      { label: "排除文件", value: formatIndexBuildNumber(summary.excludedFiles) },
      { label: "参与索引", value: formatIndexBuildNumber(summary.includedFiles) },
      { label: "预计片段", value: formatIndexBuildNumber(summary.totalChunks) },
      { label: "可复用向量", value: formatIndexBuildNumber(summary.reusableChunks) },
      { label: "需要生成向量", value: formatIndexBuildNumber(summary.pendingChunks) },
      { label: "模型", value: summary.model },
      { label: "向量维度", value: formatIndexBuildNumber(summary.dimensions) },
      { label: "排除目录", value: excludedDirectoryLabel(summary.scope.excludedDirectories) }
    ],
    noEmbeddingMessage: summary.pendingChunks === 0 ? "所有向量均可复用，本次无需重新生成向量。" : undefined
  };
}
