# Smart Connections 4.5.3：新笔记、编辑与 Connections 查询机制

**调查对象**：`D:\8_backup\WaytotheOtherShore\.obsidian\plugins\smart-connections`，manifest 版本 **4.5.3**。

**源码基准**：本地安装的 `main.js`（构建包中保留了原始模块注释和源码行号）；另以官方 GitHub `4.5.3` tag 的源代码和 Smart Connections 官方文档交叉核对。实际 vault 的 `.smart-env/smart_env.json` 也确认了 `min_chars: 200`、`re_import_wait_time: 13` 和默认模型。

## 结论速览

| 问题 | 结论 |
|---|---|
| 何时进入 embedding | 文件创建和编辑事件都会触发 re-import 队列；**不需要关闭文件**。实际向量化要等 re-import debounce（本 vault 为 13 秒）、内容超过最小长度、模型可用。保存会产生 `vault.modify`，但没有一个“关闭时才 embedding”的机制。 |
| 编辑后是否重 embedding | 是。编辑事件使旧 import 失效，重新读取文件并在 import 后 `queue_embed()`；连续编辑会把 13 秒计时器重置。实现没有单独的“输入字符 debounce”。 |
| Connections 的 query | Core Connections 面板以 active file 对应的 `SmartSource` 的**整篇笔记向量**作 query；不是当前段落，也不是直接读取当前编辑器 buffer。编辑后只有在 re-import/re-embed 完成后，整篇已保存/可由 Vault 读取的内容才会反映。 |
| 短笔记无推荐的首要原因 | 实际 `smart_sources.min_chars=200`，判断是 `size > min_chars`；短笔记没有 source vector，similarity 对没有 `vec` 的 query/candidates 都返回空。 |
| 默认模型/tokenizer | `TaylorAI/bge-micro-v2`，Transformers.js `AutoTokenizer.from_pretrained(model_key)`；该模型是 BERT/WordPiece tokenizer，`[UNK]` ID 为 100。 |
| 中文支持 | 模型目录包含 `Xenova/jina-embeddings-v2-base-zh`，标注为 Chinese/English bilingual；换模型后必须为整个参与 embedding 的集合重新生成向量，不能把不同模型的向量混用。 |

## 1. 创建、编辑、保存、关闭：准确触发链

### 事件入口

构建包 `main.js` **2066–2100**（原模块：`obsidian-smart-env` 的 Obsidian source watcher）注册：

- `app.vault.on("create", ...)` → `sources:created`
- `app.vault.on("modify", ...)` → `sources:modified`
- `app.workspace.on("editor-change", (_editor, info) ...)` → `sources:modified`
- rename/delete 也有对应事件；**没有 close-file 作为 embedding 触发条件**。

`SmartSources.handle_source_created()` 在 **6508–6520** 初始化 source 并调用 `queue_source_re_import()`；`handle_source_modified()` 在 **6550–6562** 做同样的事。

### re-import debounce

`queue_source_re_import()` 在 **6622–6626** 将 source 的 `last_import` 清零并放入队列。`debounce_re_import_queue()` 在 **6632–6646** 使用：

```js
const wait_seconds = typeof this.env?.settings?.re_import_wait_time === "number"
  ? this.env.settings.re_import_wait_time : 13;
setTimeout(() => this.run_re_import(), wait_seconds * 1e3);
```

本 vault 的 `.smart-env/smart_env.json` 和构建包默认值（**11932**）都是 `re_import_wait_time: 13`。所以每次编辑事件不是立即 embedding，而是约 **13 秒没有新事件后**开始 re-import；连续打字会重置计时器。

这 13 秒是 re-import/embedding 前置队列的 debounce，不要与：

- Connections 视图切换 source 的 **250 ms** UI debounce（`main.js` **29820–29835**）；
- collection 持久化的 save debounce（**4020–4021**、**4517–4521**）

混为一谈。

### re-import 读取什么、何时 queue embedding

Markdown adapter 在 `main.js` **8395–8442**：

1. 判断 source 是否 outdated；
2. `const content = await this.read()`；
3. 解析整篇内容、更新 `last_import`；
4. `if (this.item.should_embed ...) this.item.queue_embed()`。

底层 `FileSourceContentAdapter.read()` 在 **8058–8064** 调用 `this.fs.read(this.file_path)` 并记录 hash/time；Obsidian FS 的 `read()` 在 **1946–1953** 对 Markdown 使用 `vault.cachedRead(tfile)`。因此 editor-change 回调虽然接收了 `_editor`，但并没有把 editor 文本传给 embedding；真正的 embedding input 稍后由 source adapter 读取 Vault 内容。

**实际回答**：

- 新建：create 事件即可进入 source/re-import 队列；文件内容超过阈值且模型正常时会 embedding。
- 编辑：editor-change 即可触发；保存后的 vault modify 也会触发。编辑后会重新 embedding。
- 保存：不是唯一触发点，但保存使 Vault 的可读内容可靠地更新；没有 save-only 的专门逻辑。
- 关闭：不需要，也不是触发条件。

## 2. 编辑后重 embedding、长度条件与 token 条件

### 会重新 embedding

`MarkdownSourceContentAdapter.import()` 在 **8410–8442** 对变更内容完成 import 后调用 `item.queue_embed()`。`SmartEntity.queue_embed()` 在 **5399–5401** 是：

```js
this._queue_embed = this.should_embed;
```

实际 embedding 队列在 **5730–5735** 过滤 `_queue_embed` 或 `is_unembedded && should_embed`。`process_embed_queue()` 在 **4792–4850** 批量调用 `get_embed_input()` 和 `embed_batch()`；完成后在 **4865–4870** 写入 `embed_hash`。因此不是“只在首次创建 embedding”。

### 最小长度

source entity 的 `should_embed` 在 **5514–5516**：

```js
return this.size > (this.settings?.min_chars || 300);
```

构建包默认 Smart Environment 设置在 **11915–11924**：

```js
smart_sources: { min_chars: 200, embed_model: ... }
```

本 vault 实际配置也是 `smart_sources.min_chars = 200`。因此当前有效条件是 **size 严格大于 200**；不是 `>=`，也不是 token 数下限。插件 settings schema 在 **5753–5763** 把“Minimum length”描述为字符数，但 source adapter 的 `size`（**6279–6281**、**8207–8209**）来自 Obsidian `file.stat.size`，所以对 Markdown source 实际上应理解为文件大小/字节数近似，而不能机械地当作 Unicode 字符数。

### 最小 token 数

源码没有最小 token 门槛。Transformers adapter 的 `_prepare_input()`（构建包 **10000 左右的内嵌 iframe 源码；外层实现对应 **11000–11200** 区域）只检查是否超过 `max_tokens`，没有 lower bound。空输入会被 `embed_batch()` 的 `filtered_inputs` 过滤，但正常 source 是否入队主要由 `min_chars` 决定。

source embed input 由 `SmartSource.get_embed_input()`（**5960–5982**）构造：

- 先读整篇 source；
- 删除配置的 excluded lines；
- 前面加文件路径 breadcrumb；
- 以 `max_tokens * 3.7` 的字符上限预截断（默认模型为 512 tokens，因此约 1894 个 JS 字符）；
- 随后 tokenizer 仍会按模型的 `max_tokens` 再处理。

因此：**有最小 size 条件，没有最小 token 条件；有最大 token/truncation 条件。**

## 3. Connections 面板到底 query 什么

Core 面板的 active item 选择在官方仓库 `src/views/connections_item_view.js` **15–23**：按 `workspace.getActiveFile()?.path` 取 `env.smart_sources.get(active_path)`，而不是取 EditorView 文本。

官方仓库 `src/actions/connections-list/pre_process.js` **6–11**（构建包 **29381–29389**）明确设置：

```js
params.to_item = this.item;
```

`ConnectionsList._get_results()`（构建包 **27037–27047**）随后对 candidates 做 score。默认 `similarity()`（构建包 **23379–23384**）只是：

```js
if (!this.vec) return { score: null, ... };
return { score: cos_sim(this.vec, params.to_item.vec) };
```

也就是说 query 是当前 source 已保存/已导入/已 embedding 的**整篇笔记向量**；source 的 embed input 在 **5960–5982** 也明确是整篇 content（加 breadcrumb），不是当前段落。

**重要边界**：编辑事件会让它最终重读整篇文件；但在 13 秒 debounce、Vault 尚未反映 buffer、或 embedding 尚未完成期间，Connections 仍使用旧 vector 或没有 vector。Core Connections 面板本身没有把当前 editor 内容即时 embed 成临时 query。Pro 的 inline/block 功能是另一条 block-level 路径，不应倒推为 Core 面板的当前段落 query。

## 4. “新笔记只有几句话，没有推荐”的源码原因

按可能性排序：

1. **小于 `min_chars`**：`should_embed`（**5514–5516**）为 false；没有 source vector。默认/本 vault 为 200。
2. **刚刚创建或编辑，还在 13 秒 re-import debounce / embedding 队列中**：create/editor-change 只先排队（**6622–6646**）。
3. **未保存内容尚未进入 `vault.cachedRead`**：editor-change 不传 Editor 内容，source 之后从 Vault read（**8058–8064**、**1946–1953**）。
4. **当前 note 没有 vector**：默认 similarity 对 `!this.vec` 返回 null（**23379–23384**），Connections list 会丢弃无 score 的结果（**27050–27060**）。
5. **候选笔记没有 vector**：新 vault 或大量短笔记会让候选也被丢弃；Connections 不是普通全文搜索。
6. **路径/文件夹/文件被 Smart Environment exclusion 排除**，或文件超过 Markdown adapter 的最大 import size。`can_import` 在 **8468–8483** 检查缺失文件和默认约 300 KB 的 max import size；Connections 官方设置文档也特别区分“结果过滤”和“是否被索引/embedding”。
7. **模型仍在加载或加载失败**：`process_embed_queue()` 在 **4803–4814** 处理模型 load failure；没有 vector 时推荐自然为空。
8. **中文内容被默认英文模型 tokenizer 大量变成 `[UNK]`**：不会必然阻止 vector 生成，但会显著削弱语义质量（下一节实测）。
9. source 内容大量落在 excluded headings/lines，或被 max token truncation 截掉：embedding 可能存在，但表达的信息不完整。

官方 Getting Started 文档也建议对 active note 执行 Inspect，并确认 `should embed` 与 `vectorized` 都为绿色；文档明确把“低于 minimum character count / 被 preparation 排除”列为没有结果的检查项。

## 5. 默认模型、tokenizer 与中文 `[UNK]` 实测

### 源码结论

- 默认模型：`transformers_defaults.default_model`，构建包 **9549–9555**：`TaylorAI/bge-micro-v2`。
- 模型 catalog 给出它是 384 维、512 max tokens（模型条目紧随 **9556** 后）。
- adapter 在内嵌 Transformers.js iframe 源码中执行 `AutoTokenizer.from_pretrained(this.model_key)`，并用 `input_ids.data.length` 计数；对应构建包内的 `load_transformers_with_fallback()`、`count_tokens()`。
- `TaylorAI/bge-micro-v2` 官方 Hugging Face model card 的 config 是 `BertModel`，tokenizer special token 包含 `[UNK]`；其 `vocab.txt` 中 `[UNK]` ID 为 100。

### 实测方法与结果

使用插件内声明的 `@huggingface/transformers@4.1.0`，从官方 Hugging Face `TaylorAI/bge-micro-v2` 下载 `tokenizer.json`/`tokenizer_config.json`/`vocab.txt`，调用同一 `AutoTokenizer`。结果包含 BERT 的 `[CLS]`、`[SEP]`：

| 输入 | 总 token | `[UNK]` 数量 | `[UNK]` 比例 |
|---|---:|---:|---:|
| `这是一个用于测试中文分词的句子。Smart Connections 使用本地 embedding 模型。` | 30 | 13 | 43.3% |
| `中文笔记：人工智能、知识管理与语义搜索。` | 22 | 13 | 59.1% |
| `量子力学` | 6 | 1 | 16.7% |

所以答案是：**是，中文实际会大量产生 `[UNK]`（视词汇而变，以上两段为 43%/59%）；不能把默认模型当成中文模型。** 这解释“有 vector 但中文推荐很弱”，但短笔记无推荐仍首先检查 min_chars/queue/vector 状态。

## 6. 是否可换中文/多语言模型，换后是否全量重建

### 支持情况

Transformers model catalog 在构建包 **9556–9680**。除默认英文/通用模型外，明确包含：

```js
"Xenova/jina-embeddings-v2-base-zh": {
  dims: 768,
  max_tokens: 8192,
  description: "Local, 8,192 tokens, 768 dim, Chinese/English bilingual"
}
```

位置为 **9639–9646**。因此在当前 core 的 Transformers provider 中可以选择中文/中英双语模型；是否使用某个模型还受设备、Transformers.js 下载/缓存和模型兼容性影响。Pro/provider 还可能提供更多模型，但本调查只把已安装 core 源码实际列出的模型作为确定结论。

### 是否必须重建整个 embedding index

**必须全量重新生成 embedding 向量**（不一定需要重新解析所有 Markdown 元数据，但所有要参与语义检索的 source/block 都要有新模型的向量）。理由直接来自源码：

- 每个 entity 的 vector 按 `embed_model_key` 存取：`DefaultEntityVectorAdapter.vec` 在 **5235–5249** 访问 `data.embeddings[this.item.embed_model_key]`。
- `SmartEntity.init()` 在 **5381–5391** 检查当前模型没有 vector 就 `queue_embed()`，并删除不是当前 `embed_model_key` 的旧 embedding。
- `process_embed_queue()` 会重新对 queue 中实体调用当前 embedding model（**4770–4779**、**4840–4849**）。

所以换模型不是只改变 Connections 的 query 参数；旧模型的向量不能与新模型的向量做 cosine similarity。实际操作中应等待自动 re-embed；如果切换后状态未自动开始，使用 Smart Environment 的 Reload/Clear sources data + Reload sources/rebuild 操作，以确保整个集合都用新模型完成 embedding。官方 Smart Environment 文档把“change/rebuild embedding model”作为独立操作，并说明 source/embedding data 位于 vault 的 `.smart-env/`。

## 7. 来源链接

### 官方 Smart Connections

- GitHub repository：<https://github.com/brianpetro/obsidian-smart-connections>
- 4.5.3 tag：<https://github.com/brianpetro/obsidian-smart-connections/tree/4.5.3>
- 官方 README（当前笔记、自动更新 Connections 的说明）：<https://github.com/brianpetro/obsidian-smart-connections/blob/4.5.3/README.md>
- 官方 Connections guide：<https://smartconnections.app/smart-connections/list-feature/>
- 官方 Getting Started（Inspect active note / minimum length / vectorized）：<https://smartconnections.app/smart-connections/getting-started/>
- 官方 Settings guide（区分 Connections 结果过滤与 Smart Environment indexing）：<https://smartconnections.app/smart-connections/settings/>
- 官方 Smart Environment settings（sources、embedding model、rebuild/change、`.smart-env`）：<https://smartconnections.app/smart-environment/settings/>
- 视图源文件：<https://github.com/brianpetro/obsidian-smart-connections/blob/4.5.3/src/views/connections_item_view.js>
- Connections pre-process 源文件：<https://github.com/brianpetro/obsidian-smart-connections/blob/4.5.3/src/actions/connections-list/pre_process.js>

### 官方模型/Tokenizer

- 默认模型 card：<https://huggingface.co/TaylorAI/bge-micro-v2>
- 默认 tokenizer config：<https://huggingface.co/TaylorAI/bge-micro-v2/blob/main/tokenizer_config.json>
- 默认 vocabulary：<https://huggingface.co/TaylorAI/bge-micro-v2/blob/main/vocab.txt>
- 可选中文双语模型：<https://huggingface.co/Xenova/jina-embeddings-v2-base-zh>

### 本地审计文件

- 插件 manifest：`D:\8_backup\WaytotheOtherShore\.obsidian\plugins\smart-connections\manifest.json`（version 4.5.3）
- 插件构建包：`D:\8_backup\WaytotheOtherShore\.obsidian\plugins\smart-connections\main.js`
- 本 vault Smart Environment 设置：`D:\8_backup\WaytotheOtherShore\.smart-env\smart_env.json`
