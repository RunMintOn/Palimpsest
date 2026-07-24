import { IndexScope, indexScope, sameIndexScope } from "./index-scope";
import { sameIdentity } from "./persistent-index";
import { Chunk, IndexIdentity, IndexedChunk } from "./types";

export interface IndexBuildSummary {
  totalMarkdownFiles: number;
  excludedFiles: number;
  includedFiles: number;
  totalChunks: number;
  reusableChunks: number;
  pendingChunks: number;
  scope: IndexScope;
  model: string;
  dimensions: number;
}

export interface IndexBuildPlanInput {
  totalMarkdownFiles: number;
  includedFiles: number;
  chunks: readonly Chunk[];
  reusableById: ReadonlyMap<string, IndexedChunk>;
  vaultRevision: number;
  scope: IndexScope;
  identity: IndexIdentity;
  /** Reads live state after scanning, before a plan is returned to the UI. */
  currentState?(): IndexBuildPlanState;
}

export interface IndexBuildPlanState {
  vaultRevision: number;
  identity: IndexIdentity;
  scope: IndexScope;
}

/** Monotonic vault event generation used to invalidate an unexecuted plan. */
export class VaultRevision {
  private revision = 0;

  get value(): number { return this.revision; }

  noteChange(): void { this.revision++; }
}

interface PlannedChunk {
  chunk: Chunk;
  reusableVector?: number[];
}

interface PreparedIndexBuildData {
  chunks: readonly PlannedChunk[];
  vaultRevision: number;
  identity: IndexIdentity;
  scope: IndexScope;
}

const preparedBuildData = new WeakMap<PreparedIndexBuild, PreparedIndexBuildData>();

function dataFor(plan: PreparedIndexBuild): PreparedIndexBuildData {
  const data = preparedBuildData.get(plan);
  if (!data) throw new Error("Unknown prepared index build");
  return data;
}

function copyScope(scope: IndexScope): IndexScope {
  return indexScope(scope.excludedDirectories);
}

function copyIdentity(identity: IndexIdentity): IndexIdentity {
  return { ...identity };
}

function copyChunk(chunk: Chunk): Chunk {
  return { ...chunk, breadcrumb: [...chunk.breadcrumb] };
}

function chunkContext(chunk: Chunk): string {
  const summary = chunk.text.replace(/\s+/g, " ").slice(0, 80);
  return `file=${chunk.filePath}, breadcrumb=${JSON.stringify(chunk.breadcrumb)}, line=${chunk.startLine}, contentHash=${chunk.contentHash}, text=${JSON.stringify(summary)}`;
}

/** A global scan conflict which must be fixed instead of silently deduplicated. */
export class DuplicateIndexChunkIdError extends Error {
  constructor(readonly id: string, readonly first: Chunk, readonly second: Chunk) {
    super(`Duplicate chunk ID ${id}: ${chunkContext(first)} conflicts with ${chunkContext(second)}`);
    this.name = "DuplicateIndexChunkIdError";
  }
}

/** A prepared scan no longer represents the vault/settings it was derived from. */
export class IndexBuildPlanStale extends Error {
  constructor(readonly reason: "vault" | "identity" | "scope") {
    super(`Prepared index build is stale because its ${reason} changed`);
    this.name = "IndexBuildPlanStale";
  }
}

/**
 * Opaque plan for the UI: only summary is public. Chunks, cached vectors, and
 * freshness snapshots remain module-private and are consumed by execute.
 * Vectors are immutable values in practice, so reusable vectors deliberately
 * share the formal-index reference to keep large builds' peak memory bounded.
 */
export class PreparedIndexBuild {
  readonly summary: Readonly<IndexBuildSummary>;

  constructor(input: IndexBuildPlanInput, chunks: readonly PlannedChunk[], reusableChunks: number) {
    const scope = copyScope(input.scope);
    this.summary = Object.freeze({
      totalMarkdownFiles: input.totalMarkdownFiles,
      excludedFiles: input.totalMarkdownFiles - input.includedFiles,
      includedFiles: input.includedFiles,
      totalChunks: chunks.length,
      reusableChunks,
      pendingChunks: chunks.length - reusableChunks,
      scope: Object.freeze({ excludedDirectories: Object.freeze([...scope.excludedDirectories]) as unknown as string[] }),
      model: input.identity.model,
      dimensions: input.identity.dimensions
    });
    preparedBuildData.set(this, {
      chunks: Object.freeze(chunks.map((item) => Object.freeze({
        chunk: copyChunk(item.chunk),
        reusableVector: item.reusableVector
      }))),
      vaultRevision: input.vaultRevision,
      identity: copyIdentity(input.identity),
      scope
    });
  }
}

/** Creates a plan after scanning, before any document embedding is requested. */
export function prepareIndexBuild(input: IndexBuildPlanInput): PreparedIndexBuild {
  const seen = new Map<string, Chunk>();
  for (const chunk of input.chunks) {
    const first = seen.get(chunk.id);
    if (first) throw new DuplicateIndexChunkIdError(chunk.id, first, chunk);
    seen.set(chunk.id, chunk);
  }

  let reusableChunks = 0;
  const chunks = input.chunks.map((chunk) => {
    const cached = input.reusableById.get(chunk.id);
    const reusableVector = cached?.contentHash === chunk.contentHash ? cached.vector : undefined;
    if (reusableVector) reusableChunks++;
    return { chunk: copyChunk(chunk), reusableVector };
  });
  const plan = new PreparedIndexBuild(input, chunks, reusableChunks);
  if (input.currentState) assertIndexBuildPlanCurrent(plan, input.currentState());
  return plan;
}

export function assertIndexBuildPlanCurrent(plan: PreparedIndexBuild, current: IndexBuildPlanState): void {
  const data = dataFor(plan);
  if (data.vaultRevision !== current.vaultRevision) throw new IndexBuildPlanStale("vault");
  if (!sameIdentity(data.identity, current.identity)) throw new IndexBuildPlanStale("identity");
  if (!sameIndexScope(data.scope, current.scope)) throw new IndexBuildPlanStale("scope");
}

export interface ExecutePreparedIndexBuildOptions {
  current: IndexBuildPlanState;
  batchSize: number;
  embedDocuments(chunks: readonly Chunk[]): Promise<readonly number[][]>;
  assertCanContinue(): void;
  yieldToUi(): Promise<void>;
  onEmbeddingProgress?(current: number, total: number): void;
}

export interface ExecutedIndexBuild {
  identity: IndexIdentity;
  scope: IndexScope;
  chunks: IndexedChunk[];
}

/** Validates freshness, embeds only pending chunks, and restores scan order. */
export async function executePreparedIndexBuild(plan: PreparedIndexBuild, options: ExecutePreparedIndexBuildOptions): Promise<ExecutedIndexBuild> {
  assertIndexBuildPlanCurrent(plan, options.current);
  options.assertCanContinue();
  if (!Number.isInteger(options.batchSize) || options.batchSize < 1) throw new Error("Embedding batch size must be a positive integer");

  const data = dataFor(plan);
  const pending = data.chunks.filter((item) => !item.reusableVector);
  const embeddedVectors = new Map<string, number[]>();
  for (let start = 0; start < pending.length; start += options.batchSize) {
    options.assertCanContinue();
    const batch = pending.slice(start, start + options.batchSize);
    const vectors = await options.embedDocuments(batch.map((item) => item.chunk));
    options.assertCanContinue();
    if (vectors.length !== batch.length) throw new Error(`Embedding response count ${vectors.length} does not match requested chunk count ${batch.length}`);
    for (let index = 0; index < batch.length; index++) embeddedVectors.set(batch[index].chunk.id, vectors[index]);
    options.onEmbeddingProgress?.(Math.min(start + batch.length, pending.length), pending.length);
    await options.yieldToUi();
  }
  options.assertCanContinue();

  return {
    identity: copyIdentity(data.identity),
    scope: copyScope(data.scope),
    chunks: data.chunks.map(({ chunk, reusableVector }) => ({
      ...chunk,
      vector: reusableVector ?? embeddedVectors.get(chunk.id)!
    }))
  };
}
