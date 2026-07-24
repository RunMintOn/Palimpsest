import type { IndexBuildSummary } from "./index-build-plan";
import type { IncrementalIndexSummary } from "./incremental-index-plan";

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

/** Formats the same confirmation Modal for a prepared large incremental patch. */
export function incrementalIndexConfirmationModel(summary: IncrementalIndexSummary): IndexBuildConfirmationModel {
  const changes = summary.changes;
  const changeParts = [
    changes.added ? `新增 ${formatIndexBuildNumber(changes.added)} 篇` : undefined,
    changes.renamed ? `移动或改名 ${formatIndexBuildNumber(changes.renamed)} 篇` : undefined,
    changes.modified ? `修改 ${formatIndexBuildNumber(changes.modified)} 篇` : undefined,
    changes.deleted ? `删除 ${formatIndexBuildNumber(changes.deleted)} 篇` : undefined
  ].filter((part): part is string => Boolean(part));
  return {
    title: "确认大规模索引更新",
    confirmLabel: "继续更新",
    prompt: "此更新需要生成较多向量。确认后将继续使用已扫描的结果；如果文件或设置已变化，会要求重新扫描。",
    lines: [
      { label: "涉及文档", value: formatIndexBuildNumber(summary.documents) },
      { label: "可复用向量", value: formatIndexBuildNumber(summary.reusableChunks) },
      { label: "待生成向量片段", value: formatIndexBuildNumber(summary.pendingChunks) },
      { label: "变化概要", value: changeParts.join("、") || "路径或文件状态变化" }
    ],
    noEmbeddingMessage: summary.pendingChunks === 0 ? "此次变化无需生成向量。" : undefined
  };
}
