# Palimpsest
[中文版](README.zh-CN.md)

![](image.png)

**Palimpsest — an Obsidian side channel to your past**

Palimpsest is an Obsidian plugin that quietly watches from the right side of
your workspace and brings older notes back into view while you write.

---

## How is it different from ordinary search?

| | Ordinary search | Palimpsest |
|---|---|---|
| Who starts it | You | It does |
| When | When you remember to search | While you are writing |
| What it searches | Keywords you enter | The semantics of the current note |
| Results | A list of file names | Relevant source passages, rendered for reading |

Your past writing is not waiting to be searched. It is waiting to be
rediscovered. Palimpsest makes that happen naturally.

---

## How does it work?

Palimpsest works in three stages:

1. **Build an index**: On first use, it splits each note in your vault into
   knowledge passages by headings and paragraphs, generates an embedding for
   each passage, and stores the vectors in a local index.
2. **Search while you write**: After you stop typing for about 800 ms, the
   plugin uses the complete current note as an embedding query and searches
   for the semantically closest older passages.
3. **Show the results**: Matching passages are sorted by similarity and shown
   in the right sidebar. Click a result to open the source note, or drag it to
   insert a link or quotation.

Everything runs locally and does not pass through a cloud service.

The initial indexing time depends on the size of your vault. A larger vault
may take several minutes to index. This is a one-time cost: new and changed
notes are updated incrementally afterward, without a manual rebuild. Moving a
file or folder reuses existing vectors; changing a file name, heading, or
body updates the affected vectors. Changing the query scope does not affect
the index and does not require a rebuild.

Palimpsest only runs automatic queries and automatic incremental indexing
while at least one sidebar panel is actually visible. When the right sidebar
is collapsed, you switch to another sidebar tab, or you close the panel,
Palimpsest keeps the existing results and pauses this automatic work. Vault
changes during that time are coalesced into a queue. When the panel becomes
visible again, Palimpsest first catches up on incremental indexing and then
searches using the current query scope.

### Local index

Plugin settings and vector indexes are stored separately. Settings remain
small plugin data, while the index is stored in IndexedDB in Obsidian's local
application data. The index therefore does not travel with a copied vault
folder. If Obsidian's application data is cleared, the index must be rebuilt.
You can view document and passage counts under **Settings → Palimpsest →
Index**, and clear the local index for the **current vault**. Clearing it does
not delete Markdown notes, plugin settings, or the vault identity.

---

## Why “Palimpsest”?

A palimpsest was a medieval writing surface on which old writing was scraped
away and overwritten. Over time, the underlying text could still be made out.

Your knowledge base is similar. New notes cover old notes, and old ideas are
buried beneath newer ones. They are still there; they are simply harder to
see. Palimpsest brings those old traces back into view.

---

## Quick start

### Requirements

- [Obsidian](https://obsidian.md) v1.12.0+
- [Ollama](https://ollama.com) running locally
- A Qwen3 Embedding model

```bash
ollama pull qwen3-embedding:0.6b
```

### Installation

Copy `main.js`, `manifest.json`, and `styles.css` into your vault's plugin
directory, then enable the plugin in Obsidian.

```
your-vault/.obsidian/plugins/palimpsest/
```

### First use

1. Open the Palimpsest panel in the right sidebar.
2. Click **Build index**.
3. Start writing; relevant material will appear automatically.

See [MAINTENANCE.md](MAINTENANCE.md) for development, testing, build artifact
synchronization, and recovery procedures.

---

## Features

- **Full-note queries**: After about 800 ms of inactivity, the complete current
  Markdown editor buffer is used as a semantic query.
- **Selection queries**: The selection button immediately runs a one-shot query
  for a valid selection of at least 8 non-whitespace characters. With no
  selection, it enters follow-selection mode; click again to exit and return
  to full-note queries.
- **Passage retrieval**: Shows relevant passages instead of entire notes.
- **Markdown rendering**: Bold text, lists, blockquotes, code blocks, and
  internal links render correctly in source passages.
- **Open the source**: Click a result title to jump to the corresponding line
  in the source file.
- **Drag to insert links or quotations**: Drag a title to insert an Obsidian
  link, or drag the quotation icon to insert a quote block.
- **Expansion policy**: The first three results are expanded by default.
  You can configure the number of expanded results and the similarity
  threshold; manual actions take priority.
- **Local operation**: Everything runs locally; no cloud API is called.
- **Local IndexedDB index**: Settings changes do not rewrite vectors. The
  existing index remains usable until a full rebuild completes.
- **Visibility-aware sleep**: Automatic queries and incremental embeddings
  pause while the sidebar is hidden and catch up incrementally when it becomes
  visible again.

---

## Settings

| Setting | Default | Description |
|---|---|---|
| Ollama endpoint | `http://127.0.0.1:11434/api/embed` | |
| Model | `qwen3-embedding:0.6b` | |
| Vector dimensions | 1024 | Changing this requires a rebuild |
| Query debounce | 800 ms | Delay after typing stops |
| Default expanded results | First 3 | Options include all collapsed, first 1/3/5, or all expanded |
| Minimum similarity for auto-expansion | Off | When enabled, results below the threshold are not expanded automatically |
| Target passage length | 650 characters | |
| Excluded directories | `.obsidian` | Comma-separated |

---

## Technology

- **Editor**: TypeScript + Obsidian API
- **Embedding model**: Qwen3-Embedding-0.6B (GGUF Q8_0, 1024 dimensions)
- **Retrieval backend**: Local Ollama service
- **Index**: Markdown heading and paragraph splitting + cosine similarity

### Resource usage (Qwen3-Embedding-0.6B)

| Resource | Measured value |
|---|---|
| GPU memory (model only) | ~2.2 GiB |
| System memory (private `llama-server`) | ~3 GiB |
| First cold-start query | ~2.7 s |
| Warm query | ~150 ms |

### Other models (additional setup required)

[Jina Embeddings v2 Base - Chinese](https://huggingface.co/jinaai/jina-embeddings-v2-base-zh)
is a bilingual Chinese-English embedding model with 768 dimensions. The
original model on Hugging Face cannot be entered directly as an Ollama model
name: you must first prepare an Ollama-compatible GGUF file. You can refer to
this [third-party Q4_K_M conversion](https://huggingface.co/Ashcomposer/jina-embeddings-v2-base-zh-Q4_K_M-GGUF)
(about 109 MB) and [Ollama's import instructions](https://docs.ollama.com/import):

```text
# Modelfile
FROM /path/to/jina-embeddings-v2-base-zh-q4_k_m.gguf
```

```bash
ollama create palimpsest-jina-zh -f Modelfile
```

Then enter the following in Palimpsest settings:

- Model name: `palimpsest-jina-zh` (the name used with `ollama create`)
- Vector dimensions: `768`
- Rebuild the index after changing the model or dimensions

The plugin's default query instruction format is tailored to Qwen3. Jina's
official usage does not use the `Instruct:` / `Query:` prefix, so Jina should
currently be treated as an alternative that requires validation rather than
as a guaranteed equivalent model that works after changing settings alone.

---

## License

This project is licensed under the [MIT License](LICENSE).
