import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { chunkMarkdown, embeddingText } from "../src/chunker";
import { OllamaEmbeddingProvider } from "../src/embedding-provider";
import { rankChunks } from "../src/retrieval";

const provider = new OllamaEmbeddingProvider({
  endpoint: "http://127.0.0.1:11434/api/embed",
  model: "qwen3-embedding:0.6b",
  dimensions: 1024,
  keepAlive: "5m",
  queryInstruction: "Given a Chinese note search query, retrieve relevant passages from a local Markdown knowledge base."
}, async (url, body) => {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
  return { status: response.status, text: await response.text() };
});

const vault = "test-vault";
const files = ["Obsidian知识管理.md", "语义检索与RAG.md", "烘焙和旅行.md"];

async function main(): Promise<void> {
  const chunks = (await Promise.all(files.map(async (file) =>
    chunkMarkdown(file, await readFile(join(vault, file), "utf8"), { targetLength: 650, maxLength: 1100, minLength: 80 })
  ))).flat();
  const indexedResponse = await provider.embedDocuments(chunks.map(embeddingText));
  const indexed = chunks.map((chunk, index) => ({ ...chunk, vector: indexedResponse.vectors[index] }));
  const started = performance.now();
  const queried = await provider.embedQuery("我想在写作时找回关于 Obsidian Markdown 知识库的笔记");
  const elapsed = performance.now() - started;
  const results = rankChunks(queried.vectors[0], indexed, { topK: 3, maxPerFile: 2 });
  console.log(JSON.stringify({
    indexedChineseChunks: indexed.length,
    dimensions: queried.vectors[0].length,
    queryEndToEndMs: Math.round(elapsed),
    coldLoad: queried.coldLoad,
    topFiles: results.map((result) => ({ file: result.fileName, similarity: Number(result.similarity.toFixed(3)) }))
  }, null, 2));
}

void main();
