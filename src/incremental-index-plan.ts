import { embeddingInputHash, EmbeddingReuseLookup, groupChunksByEmbeddingInput } from "./embedding-reuse";
import { ScannedIndexDocument } from "./index-document-scan";
import { IndexDocument } from "./index-store";
import { IndexScope, sameIndexScope } from "./index-scope";
import { sameIdentity } from "./persistent-index";
import { Chunk, IndexIdentity, IndexedChunk, NumericVector, SkippedIndexedDocument } from "./types";

export const LARGE_INCREMENTAL_DOCUMENT_THRESHOLD = 50;
export const LARGE_INCREMENTAL_CHUNK_THRESHOLD = 500;

export type IncrementalScannedDocument = ScannedIndexDocument;

export interface IncrementalChangeSummary {
  added: number;
  renamed: number;
  modified: number;
  deleted: number;
}

export interface IncrementalIndexSummary {
  documents: number;
  reusableChunks: number;
  pendingChunks: number;
  pendingDocuments: number;
  changes: IncrementalChangeSummary;
}

export interface IncrementalIndexPlanState {
  vaultRevision: number;
  identity: IndexIdentity;
  scope: IndexScope;
}

export interface PrepareIncrementalIndexPlanInput {
  documents: readonly IncrementalScannedDocument[];
  skippedDocuments?: readonly SkippedIndexedDocument[];
  deletes: readonly string[];
  reusableChunks: readonly IndexedChunk[];
  current: IncrementalIndexPlanState;
  changes: IncrementalChangeSummary;
}

interface PlannedChunk {
  chunk: Chunk;
  vector?: NumericVector;
}

interface PlanData {
  documents: readonly { document: IncrementalScannedDocument; chunks: readonly PlannedChunk[] }[];
  skippedDocuments: readonly SkippedIndexedDocument[];
  deletes: readonly string[];
  current: IncrementalIndexPlanState;
}

const planData = new WeakMap<PreparedIncrementalIndexPlan, PlanData>();

/** Opaque prepared scan retained across the bulk-change confirmation modal. */
export class PreparedIncrementalIndexPlan {
  readonly summary: Readonly<IncrementalIndexSummary>;

  constructor(input: PrepareIncrementalIndexPlanInput, documents: PlanData["documents"], reusableChunks: number, pendingChunks: number, pendingDocuments: number) {
    this.summary = Object.freeze({
      documents: input.documents.length + (input.skippedDocuments?.length ?? 0),
      reusableChunks,
      pendingChunks,
      pendingDocuments,
      changes: Object.freeze({ ...input.changes })
    });
    planData.set(this, {
      documents,
      skippedDocuments: Object.freeze((input.skippedDocuments ?? []).map((document) => ({ ...document }))),
      deletes: Object.freeze([...input.deletes]),
      current: copyState(input.current)
    });
  }
}

function copyState(state: IncrementalIndexPlanState): IncrementalIndexPlanState {
  return {
    vaultRevision: state.vaultRevision,
    identity: { ...state.identity },
    scope: { excludedDirectories: [...state.scope.excludedDirectories] }
  };
}

function dataFor(plan: PreparedIncrementalIndexPlan): PlanData {
  const data = planData.get(plan);
  if (!data) throw new Error("Unknown prepared incremental index plan");
  return data;
}

export function prepareIncrementalIndexPlan(input: PrepareIncrementalIndexPlanInput): PreparedIncrementalIndexPlan {
  const lookup = new EmbeddingReuseLookup(input.reusableChunks);
  let reusableChunks = 0;
  let pendingChunks = 0;
  let pendingDocuments = 0;
  const documents = input.documents.map((document) => {
    let documentHasPending = false;
    const chunks = document.chunks.map((chunk) => {
      const vector = lookup.find(chunk);
      if (vector) reusableChunks++;
      else {
        pendingChunks++;
        documentHasPending = true;
      }
      return { chunk: { ...chunk, breadcrumb: [...chunk.breadcrumb] }, vector };
    });
    if (documentHasPending) pendingDocuments++;
    return { document: { ...document, chunks: document.chunks.map((chunk) => ({ ...chunk, breadcrumb: [...chunk.breadcrumb] })) }, chunks };
  });
  const skippedDocuments = input.skippedDocuments ?? [];
  const paths = new Set<string>();
  for (const document of [...input.documents, ...skippedDocuments]) {
    if (paths.has(document.filePath)) throw new Error(`Duplicate scanned document path: ${document.filePath}`);
    paths.add(document.filePath);
  }
  return new PreparedIncrementalIndexPlan({ ...input, skippedDocuments }, documents, reusableChunks, pendingChunks, pendingDocuments);
}

export function isLargeIncrementalIndexPlan(summary: IncrementalIndexSummary): boolean {
  return summary.pendingDocuments > LARGE_INCREMENTAL_DOCUMENT_THRESHOLD || summary.pendingChunks > LARGE_INCREMENTAL_CHUNK_THRESHOLD;
}

/** The confirmation is only valid for the vault, settings, and scope it scanned. */
export function assertIncrementalIndexPlanCurrent(plan: PreparedIncrementalIndexPlan, current: IncrementalIndexPlanState): void {
  const prepared = dataFor(plan).current;
  if (prepared.vaultRevision !== current.vaultRevision || !sameIdentity(prepared.identity, current.identity) || !sameIndexScope(prepared.scope, current.scope)) {
    throw new Error("Prepared incremental index update is stale; scan again before applying it");
  }
}

export interface ExecuteIncrementalIndexPlanOptions {
  current: IncrementalIndexPlanState;
  batchSize: number;
  embedDocuments(chunks: readonly Chunk[]): Promise<readonly NumericVector[]>;
  /** Lifecycle seam: callers stop work without coupling this plan to Obsidian. */
  assertCanContinue(): void;
  yieldToUi(): Promise<void>;
}

export interface ExecutedIncrementalIndexPlan {
  upserts: IndexDocument[];
  deletes: readonly string[];
}

/** Embeds only after stale validation, then produces one document-level patch. */
export async function executeIncrementalIndexPlan(
  plan: PreparedIncrementalIndexPlan,
  options: ExecuteIncrementalIndexPlanOptions
): Promise<ExecutedIncrementalIndexPlan> {
  assertIncrementalIndexPlanCurrent(plan, options.current);
  options.assertCanContinue();
  if (!Number.isInteger(options.batchSize) || options.batchSize < 1) throw new Error("Embedding batch size must be a positive integer");
  const data = dataFor(plan);
  const pending = data.documents.flatMap((document) => document.chunks.filter((chunk) => !chunk.vector).map((chunk) => chunk.chunk));
  const vectors = new Map<string, NumericVector>();
  for (const document of data.documents) for (const item of document.chunks) if (item.vector) vectors.set(item.chunk.id, item.vector);
  const groups = groupChunksByEmbeddingInput(pending);
  for (let start = 0; start < groups.length; start += options.batchSize) {
    options.assertCanContinue();
    const batch = groups.slice(start, start + options.batchSize);
    const embedded = await options.embedDocuments(batch.map((group) => group.representative));
    options.assertCanContinue();
    if (embedded.length !== batch.length) throw new Error(`Embedding response count ${embedded.length} does not match requested input groups ${batch.length}`);
    for (let index = 0; index < batch.length; index++) for (const chunk of batch[index].chunks) vectors.set(chunk.id, embedded[index]);
    await options.yieldToUi();
    options.assertCanContinue();
  }
  options.assertCanContinue();
  assertIncrementalIndexPlanCurrent(plan, options.current);
  return {
    deletes: data.deletes,
    upserts: [
      ...data.documents.map(({ document, chunks }) => ({
        filePath: document.filePath,
        fileName: document.fileName,
        sourceMtime: document.sourceMtime,
        sourceSize: document.sourceSize,
        chunks: chunks.map(({ chunk }) => ({ ...chunk, vector: vectors.get(chunk.id)!, embeddingInputHash: embeddingInputHash(chunk) }))
      })),
      ...data.skippedDocuments.map((document) => ({ ...document }))
    ]
  };
}
