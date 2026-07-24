# 异常文档跳过、报告与重试

## 目标

单篇异常 Markdown 不得阻塞 vault 的索引。稳定地无法生成可保存片段的文件会被跳过；其他文件仍然完成 embedding 和发布。完成提示始终使用：

```text
索引完成：N 个片段；M 篇笔记未索引
```

设置页的“索引”页长期显示未索引数量、路径、安全原因和“重试所有未索引文档”操作。它不是一次性的 Notice。

合法 Markdown 仍必须正常索引。特别是文档从 `##` 开始、或标题层级跳跃（如 `#` 到 `###`）是合法输入；chunker 以实际标题深度维护 breadcrumb，绝不产生 `undefined`。

## 状态与持久化

`IndexStore` 的 `documents` object store 保留同一 generation 的两种明确记录：

- **indexed**：文件 stat 与 `chunks`；空笔记也是 indexed，`chunks: []`。
- **skipped**：文件 stat 与 `reasonCode`，没有 `chunks`、正文、向量或原始错误。

目前唯一 reason code 是：

- `invalid-chunk-structure`：稳定读取后的 chunk 不满足存储需要的路径归属、breadcrumb、行号或必要字符串字段。

读取旧 IndexedDB 记录时，没有 `kind` 的原有 document record 按 indexed 解释，因此已有数据可继续加载。全量 generation 的 documentCount 同时计入 indexed 和 skipped 记录；generation 校验、发布、回退和清理也都覆盖两种记录。

`PersistentIndexData` 分别暴露 `documents` 和 `skippedDocuments`，以便搜索数据不把 skipped 当作空文档，而 reconciliation 可以把两者都视为已处理。

## 扫描与错误分类

每篇文件在 `cachedRead` 前后都核对 path、basename、mtime 与 size。chunk 生成后、任何 Ollama 请求前，扫描器验证 chunk 的可存储结构。

只有 `IndexDocumentStructureError` 会被转换为 skipped。它是在已经稳定读取的单篇文件上，由上述结构预检产生，并只写入固定的 `invalid-chunk-structure`。

以下情况**绝不**转换为 skipped，仍使当前全量构建或增量批次失败：

- 读取时路径、文件名、mtime 或 size 变化（stale）；
- 用户取消或插件 unload；
- 未明确归类的 parser/chunker 异常（不能用 skipped 隐藏 parser bug）；
- Ollama 的连接、响应、数量、维度或有限值错误；
- IndexedDB、quota、transaction、generation 校验或发布错误；
- identity、scope、设置或 vault revision 变化；
- 批次重复 chunk ID 等不能归因于一篇文件的冲突。

`IndexStore` 继续在写入边界重复验证 indexed chunks 和 skipped metadata，作为最终防御；正常的 chunk 结构问题已经在 embedding 前被挡住。

## 全量与增量

全量构建扫描全部范围：

1. indexed 文件进入 embedding；
2. skipped 文件进入候选 generation 的 skip record，绝不调用 Ollama；
3. stale 或全局错误取消候选 generation；
4. 成功时一次发布同时包含两种状态。

增量 patch 在同一 IndexedDB transaction 中替换一个路径的 document record：

- indexed → skipped：旧 chunks 被覆盖删除，保存 skip；
- skipped → indexed：保存 chunks 并删除 skip；
- 删除 skipped 文件：删除其 record；
- rename 使用既有的 delete/upsert 语义。

启动 reconciliation 对 indexed 和 skipped 的 path/stat 一视同仁：未变化的 skipped 不会反复成为新增文件；其 mtime 或 size 改变后会走正常增量扫描，并在成功时只补充该文件索引。

## 手动重试

`SideGrepPlugin.retrySkippedDocuments()` 是设置页调用的窄接口。它仅把当前 persisted skipped 路径交给既有的增量扫描、embedding 与 patch 流程：

- 没有 skipped 时不显示按钮；
- 不存在的文件由普通增量 delete 清除 skip record；
- 成功的文件只补充自己的 chunks；
- 再次出现结构错误则更新/保留 skip record；
- 全局失败不写 patch，保留原有报告，并只显示一次简短 Notice；
- 执行期间设置页按钮禁用，结束后重新渲染。

不实现断点续建、独立向量缓存或任务系统。