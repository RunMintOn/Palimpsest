# obsdn-side-grep 实现报告

## 交付结果

已在本目录完成独立 Obsidian 插件原型（ID：`obsdn-side-grep`）、自动测试、构建产物和独立测试 vault。没有修改 `D:\8_backup\WaytotheOtherShore`、现有 Smart Connections、Ollama 模型目录，也没有创建 commit。

## 2026-07 生命周期与自动查询修复

- 新增纯 TypeScript `QueryLifecycleCoordinator` 作为事件 → 查询调度的测试 seam，并由 `main.ts` 实际调用；它区分 typing（debounce）与 file-open/sidebar-open/index-ready/layout-ready（立即查询）。非 Markdown leaf 不会丢掉最近的 Markdown 上下文。
- `PersistentIndex` schema 升至 2，单独持久化 `initialized`。旧数据若 `updatedAt > 0` 自动迁移为已完成的索引；因此一个成功扫描但产生零片段的 vault 仍为 `ready`，首次未完成索引不会被 vault 事件增量写入。
- 全量建库在本地候选集合中完成，保存成功后才 commit；重建保留旧索引直至新索引完整成功。支持取消 flag（扫描循环、embedding batch、保存前检查）；取消/失败不会保存半成品，旧的兼容索引仍可查询。
- 侧边栏新增首次使用 CTA、重建/重试/取消按钮，以及结构化扫描、向量化、保存进度。正常编辑不会覆盖建库中的进度状态。
- 查询不再把任意 `active-leaf-change` 视为“等待输入”。插件保留最近活动 MarkdownView，故点击 Side Grep ItemView 不会清空结果；建库提交、layout ready、文件打开/切换、侧栏打开都会从该编辑器自动查询。

## 实现内容

- 使用 Obsidian 官方 API 注册右侧 `ItemView`、命令、设置页、编辑器事件和 Vault create/modify/delete 事件。
- Markdown chunker：跳过首部 frontmatter，识别 1–6 级标题，按自然段/章节组织，合并短尾段、拆分长段，保留原文、breadcrumb 与起止行；chunk ID/content hash 为确定性值。
- `OllamaEmbeddingProvider`：独立 provider 接口；文档批量调用不加 instruction；query 严格加 `Instruct: ...\nQuery:`；检查 HTTP 状态、返回数量、1024 维及有限数值、空数组。
- 持久化索引：通过插件 `loadData/saveData` 保存向量和索引身份；模型、维度、chunker 版本/长度不一致时禁止混用，并提示重建。未改变的 chunk 复用已有向量。
- 索引：命令建立/重建；批量向量化并让出事件循环；监听 Markdown 增删改做增量更新；默认排除 `.obsidian` 和可配置目录。
- 实时 query：直接读取 Editor buffer，不读 `cachedRead`；800 ms debounce；8 个非空白字符阈值；局部上下文为当前段落、标题、前一段；generation gate 和 buffer/active-file 检查阻止过期请求覆盖新结果。
- 检索：brute-force cosine、Top K、按分数降序、同文件上限、当前文件排除、重复片段去重。
- 侧边栏：固定高度工具栏通过右上角图标表达后台状态；结果卡片按 chunk ID 增量协调，不再随“等待停笔/查询中”等状态清空并重建整个视图。结果集合或顺序变化时只做 140ms 轻微淡入，分数更高的结果始终按真实顺序排列。普通单文件增量索引静默执行，不再显示全量扫描进度或触发当前文件的重复 query。
- 知识卡片：左侧灰色相似度 badge；文件标题是可点击、可拖动的链接；箭头、badge 和行内空白控制展开。展开后左对齐显示 breadcrumb，并使用 Obsidian `MarkdownRenderer` 在中性片段容器中渲染 Markdown；真实 blockquote 保持内部语义。右上角使用“轻背景、无边框”的引用操作，支持点击、拖动和选中文字后引用。
- 展开策略：设置可选全部折叠、前 1/3/5 个或全部展开，默认前 3 个；可选最低相似度阈值，默认关闭。排名变化时未手动操作的卡片重新应用策略，用户手动状态在卡片仍存在期间优先保留。
- 设置：endpoint、模型、维度、keep_alive、debounce、query 最大长度、chunk 长度、Top K、每文件上限、排除目录、instruction、批量大小。

## 文件清单

| 路径 | 用途 |
|---|---|
| `src/chunker.ts` | 可测试 Markdown 切分、稳定哈希、embedding 输入 |
| `src/query-context.ts` | 实时编辑上下文构造 |
| `src/embedding-provider.ts` | provider 接口及 Ollama 实现/校验 |
| `src/persistent-index.ts` | 索引身份兼容性、schema 迁移和已完成建库状态 |
| `src/query-lifecycle.ts` | 可测试的查询生命周期调度策略 |
| `src/result-presentation.ts` | 判断是否需要触发柔和的结果区更新 |
| `src/expansion-policy.ts` | 自动展开数量与相似度阈值策略 |
| `src/retrieval.ts` | cosine、排序、限额、去重 |
| `src/query-gate.ts` | 异步 query 竞态门控 |
| `src/sidebar-view.ts` | 右侧 ItemView 和交互 |
| `src/settings.ts` | 设置类型、默认值、设置页面 |
| `src/main.ts` | 插件生命周期、索引、事件、查询 |
| `test/core.test.ts` | 纯逻辑自动测试 |
| `test/fixtures/chinese-notes.md` | 中文知识管理/RAG/烘焙旅行 fixture |
| `scripts/smoke-ollama.ts` | 一次轻量的真实 Ollama 建库+查询 smoke test |
| `test-vault/` | 独立测试 vault（含三篇中文笔记和已复制插件） |
| `main.js`、`manifest.json`、`styles.css` | Obsidian 可加载产物 |

## 架构

```text
Vault Markdown -> chunker -> document batch embeddings -> PersistentIndex
Editor live buffer -> local context builder -> instructed query embedding
                 -> cosine ranking -> SideGrepView
```

索引身份固定记录 `model + dimensions + chunkerVersion + chunk lengths`。因此不同模型或维度的向量不会进入同一次 cosine 搜索。索引构建、增量更新和 query 分属小模块；未来可在 `retrieval.ts` 前加入 BM25/混合候选而不改 UI 或 provider。

## 安装到独立测试 vault

已准备 `test-vault`，它不是用户现有 vault。

1. 在 Obsidian 用“Open folder as vault”打开 `D:\15_dev\obsdn-side-grep\test-vault`。
2. 已有插件文件位于 `test-vault\.obsidian\plugins\obsdn-side-grep\`。若重新构建，请在项目根目录运行 `npm run build`，再复制 `main.js`、`manifest.json`、`styles.css` 到该目录。
3. 在 Obsidian 的 Community plugins 中启用 **Side Grep**。
4. Settings → Side Grep 保持默认的 `http://127.0.0.1:11434/api/embed`、`qwen3-embedding:0.6b`、`1024`；模型环境已存在，无需下载或迁移。

## 建立索引和打开侧边栏

1. Command palette 执行 **Side Grep: 建立/重建知识片段索引**。
2. Command palette 执行 **Side Grep: 打开 Side Grep 侧边栏**。
3. 在任一 Markdown 编辑器输入至少 8 个非空白字符，停止输入约 800 ms。未保存的新笔记也会直接从 Editor buffer 查询。
4. 点击卡片/“打开来源”打开片段起始行；在编辑器内点“插入链接”或“引用片段”。

## 自动验证结果

最终执行并通过：

```text
npm run typecheck  # pass
npm test           # 17/17 pass
npm run build      # pass，main.js 182.2 kB
```

测试覆盖：标题层级、自然段、短段合并、长段拆分、frontmatter、行号、ID/hash 稳定性、query context、cosine、排序、同文件限额、去重、过期 query、索引身份失效、legacy 索引迁移、零片段 ready、取消重建保留旧索引、取消 token 不泄漏到增量 commit、unload 提交屏障、生命周期自动查询策略、柔和更新判断、自动展开数量与阈值，以及 HTTP 200 空 embeddings 报错。

还执行了一次非 benchmark 的真实 Ollama smoke test：它对独立 `test-vault` 的 5 个中文 chunk 批量建库，随后 query。结果为 1024 维；Top 结果是 `Obsidian知识管理`（0.830），其次为同文件的另一片段（0.736），再是 `语义检索与RAG`（0.442）；烘焙/旅行没有进入前三。

## 查询延迟

真实 provider smoke test 对一次正常 instructed query 记录的端到端耗时为 **153 ms**。这是插件 provider 层从发 POST 到读完整 response 的一次预热态观察，不是重复性能 benchmark。响应未触发本插件定义的实质冷加载阈值（500 ms）；实际 UI 会在请求超过 600 ms 时显示“模型加载中/查询中”。

## 尚未完成的手工验证

没有声称已完成 Obsidian GUI 手工验收。仍应在上述独立 vault 中手工验证：连续输入时卡片不再闪烁、展开状态和滚动位置保持、右上角状态图标、结果发生真实变化时的局部移动，以及按钮插入位置。

## 已知限制

- 索引为 JSON 持久化和 brute-force cosine，适合原型/中小 vault，不适合超大 vault。
- chunker 是启发式，不处理表格、代码块或复杂 Markdown AST。
- 长段落若在同一物理行内被按句切开，子片段只能共享该行的行号范围。
- 没有实现 HNSW、BM25、混合排序或拖拽。
- 已发出的 HTTP 请求不会取消，但 generation gate 保证其旧结果不会写入 UI。

## 下一步最值得验证的产品问题

在真实中文写作中，**“当前段落 + 前一段 + 标题”的 query 上下文是否比整篇笔记更稳定地提升相关片段的前三名质量**，以及 800 ms debounce 是否让用户感觉及时而不干扰，是最值得先做的产品验证。
