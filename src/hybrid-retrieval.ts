import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ZVecCollection, ZVecStatus } from "@zvec/zvec";
import { fuseRankings, vectorRanking, type RankOptions } from "./retrieval";
import type { IndexedChunk, NumericVector, SearchResult } from "./types";

type Native = typeof import("@zvec/zvec");
export class KeywordIndexUnavailable extends Error {}

function keywordText(chunk: IndexedChunk): string {
  return [chunk.fileName, ...chunk.breadcrumb, chunk.text].join("\n");
}

function checkStatus(statuses: ZVecStatus[]): void {
  for (const status of statuses) if (!status.ok) throw new Error(`关键词索引写入失败：${status.message}`);
}

/** The only authority is the supplied committed snapshot; native storage is disposable. */
export class HybridRetrieval {
  private collection: ZVecCollection | undefined;
  private applied = new Map<string, string>();
  private snapshot: readonly IndexedChunk[] | undefined;
  private epoch = 0;
  private closed = false;
  private pending: Promise<void> = Promise.resolve();

  constructor(private readonly vaultId: string, private readonly loadNative: () => Native = () => require("@zvec/zvec")) {}

  invalidate(): void { this.epoch++; this.snapshot = undefined; }

  close(): void {
    this.closed = true;
    this.invalidate();
    this.release();
  }

  private release(): void {
    this.collection?.closeSync();
    this.collection = undefined;
    this.applied.clear();
    this.snapshot = undefined;
  }

  private create(): ZVecCollection {
    const native = this.loadNative();
    native.ZVecInitialize({ logLevel: native.ZVecLogLevel.ERROR });
    const directory = mkdtempSync(join(tmpdir(), `palimpsest-${this.vaultId.replace(/[^a-zA-Z0-9-]/g, "")}-`));
    const schema = new native.ZVecCollectionSchema({ name: "palimpsest_keywords", fields: [
      { name: "text", dataType: native.ZVecDataType.STRING, indexParams: { indexType: native.ZVecIndexType.FTS, tokenizerName: "jieba", filters: ["lowercase"] } }
    ] });
    return native.ZVecCreateAndOpen(join(directory, "keywords"), schema);
  }

  async synchronize(chunks: readonly IndexedChunk[], isCurrent: () => boolean): Promise<void> {
    const epoch = this.epoch;
    const assertCurrent = () => {
      if (this.closed || epoch !== this.epoch || !isCurrent()) throw new KeywordIndexUnavailable("关键词同步已失效，请重新查询");
    };
    const work = this.pending.catch(() => {}).then(async () => {
      assertCurrent();
      if (this.snapshot === chunks) return;
      this.snapshot = undefined;
      try {
        this.collection ??= this.create();
        const next = new Map(chunks.map(chunk => [chunk.id, keywordText(chunk)]));
        const deletes = [...this.applied.keys()].filter(id => !next.has(id));
        const updates = [...next].filter(([id, text]) => this.applied.get(id) !== text);
        for (let i = 0; i < deletes.length; i += 128) {
          assertCurrent();
          checkStatus(this.collection.deleteSync(deletes.slice(i, i + 128)));
          await new Promise(resolve => setTimeout(resolve, 0));
        }
        for (let i = 0; i < updates.length; i += 128) {
          assertCurrent();
          checkStatus(this.collection.upsertSync(updates.slice(i, i + 128).map(([id, text]) => ({ id, fields: { text } }))));
          await new Promise(resolve => setTimeout(resolve, 0));
        }
        assertCurrent();
        if (updates.length || deletes.length) this.collection.optimizeSync();
        assertCurrent();
        this.applied = next;
        this.snapshot = chunks;
      } catch (error) {
        this.release();
        throw error;
      }
    });
    this.pending = work;
    return work;
  }

  keywordIds(text: string, limit: number): string[] {
    if (!this.collection || !this.snapshot) throw new KeywordIndexUnavailable("关键词检索尚未就绪，请重新查询");
    if (!this.snapshot.length) return [];
    try {
      return this.collection.querySync({ fieldName: "text", fts: { matchString: text }, topk: limit, includeVector: false })
        .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).map(doc => doc.id);
    } catch (error) {
      this.release();
      throw error;
    }
  }

  async search(text: string, vector: NumericVector, chunks: readonly IndexedChunk[], options: RankOptions, isCurrent: () => boolean): Promise<SearchResult[]> {
    await this.synchronize(chunks, isCurrent);
    if (this.closed || !isCurrent() || this.snapshot !== chunks) throw new KeywordIndexUnavailable("查询快照已失效，请重新查询");
    const eligible = chunks.filter(chunk => chunk.filePath !== options.excludePath);
    const eligibleIds = new Set(eligible.map(chunk => chunk.id));
    const vectors = vectorRanking(vector, eligible).map(chunk => chunk.id);
    let depth = Math.min(chunks.length, Math.max(200, options.topK * 5));
    let results: SearchResult[];
    do {
      const keywords = depth ? this.keywordIds(text, Math.min(chunks.length, depth + chunks.length - eligible.length)).filter(id => eligibleIds.has(id)).slice(0, depth) : [];
      results = fuseRankings(eligible, [vectors.slice(0, depth), keywords], options);
      if (results.length >= options.topK || depth >= chunks.length || depth >= 2000) return results;
      depth = Math.min(chunks.length, 2000, depth * 2);
    } while (true);
  }
}
