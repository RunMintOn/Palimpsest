# Side Grep 索引生命周期与自动查询修复说明

## 根因

原实现把 `PersistentIndex.chunks.length` 同时当作“是否已完成全量建库”和“是否有可搜索片段”。因此首次使用时，任何 Vault 事件都可能进入单文件更新路径；而成功但零 Markdown/零片段的 vault 又会被误判为未建库。

查询只由 `editor-change` 启动，并且所有 `active-leaf-change` 都会使 query gate 失效、清掉 timer、清空结果并显示“等待输入”。打开右侧 ItemView 本身也会触发这个路径，故用户点击 Side Grep 可能丢失结果。全量建库完成后也没有重新读取当前编辑器并查询。

## 新增回归测试

`test/core.test.ts` 新增并执行了以下真实调用方使用的纯 TypeScript seam：`QueryLifecycleCoordinator`。

- 未初始化时 typing 和 sidebar-open 不会安排 query，因而不会启动增量索引或覆盖“建立索引”主状态。
- ready 后，Markdown 激活、layout ready、sidebar 打开、建库完成均安排立即查询。
- 非 Markdown leaf 不会清除最近 Markdown 上下文；随后打开 sidebar 仍可查询。
- typing 仍返回 `immediate: false`，由 `main.ts` 应用既有的 800 ms debounce；其余生命周期事件为立即查询。
- 旧数据迁移为 ready、合法零片段 vault 为 ready、首次索引尚未 commit 前为 uninitialized、取消重建不 commit 候选且保留旧索引，均有 `PersistentIndex` 回归测试。

测试先于实现运行，初始结果为缺少 `src/query-lifecycle` 的失败；实现并接入 `main.ts` 后通过。

## 索引生命周期状态

持久化 schema 已升至 2：`PersistentIndexData` 记录 `initialized` 与 `schemaVersion`。

- `uninitialized`：尚未成功 commit 一次全量扫描。此时 Vault create/modify/delete 不会启动增量更新。
- `ready`：已成功完成至少一次全量建库，不依赖片段数量；零 Markdown 内容也可以 ready。
- `incompatible`：模型、维度或 chunker identity 不一致。旧向量保留在持久化数据中但不会参与查询，直到新建库成功。
- `building`：插件内当前全量任务正在运行。
- `cancelled` / `failed`：当前任务结果状态。若此前有兼容的 ready 索引，它继续保留和可用。

兼容旧测试 vault 数据：缺少 `initialized` 的旧索引在 `updatedAt > 0` 时迁移为 ready，原有向量不被无故丢弃。

全量建库先生成本地候选 chunks；仅在扫描、embedding 都完成且保存成功后 commit。重建期间 `PersistentIndex` 一直持有旧索引，因此取消或失败不会替换成半成品。

## 自动查询触发条件

`main.ts` 的 `scheduleQueryFromCurrentEditor` 是 typing、文件打开、侧栏打开、建库完成和 layout ready 的统一入口。

- 编辑：直接使用实时 Editor buffer，保留 generation gate，800 ms debounce。
- Markdown 文件打开或切换：记录为最近 MarkdownView，立即查询。
- Side Grep 打开：基于最近 MarkdownView 立即查询，不依赖当前 active leaf 是否已变为 ItemView。
- 全量建库成功：commit 后立即查询最近 MarkdownView，不要求再输入。
- 插件 layout ready：若恢复了 ready 索引和 Markdown 编辑器，立即查询；不会主动打开侧栏。
- 增量索引：只会在 ready 后运行；完成后刷新当前有效上下文。

`active-leaf-change` 现在只在 leaf 是 `MarkdownView` 时处理文件查询。对 Side Grep 或其他非 Markdown leaf 不再 invalidate、清 timer 或清空结果。

## 进度条实现

`SidebarState` 带有结构化 `IndexProgress`：`phase`、`current`、`total`、`label`。侧边栏以原生 `<progress>` 渲染：

- scanning：显示“正在扫描笔记”以及 `current / total 个文件`；
- embedding：显示“正在生成向量”以及 `current / total 个片段`；
- saving：使用不确定进度并显示“正在保存索引……”。

`total === 0` 时不会设定 progress 的数值，避免除零或无效比例。侧栏在建库过程中重新打开会渲染最新结构化 state；输入仅使旧 query 失效，不会覆盖建库进度。

## 取消语义

建库时侧边栏显示“取消”。取消仅设置当前 build 的 cancellation token，不尝试强制中断已发出的 Ollama HTTP 请求；当前请求返回后，在文件扫描循环、embedding batches 和保存前会检查该 token。

- 首次建库取消：显示“已取消。尚未建立知识库索引”及“建立索引”CTA。
- 已有索引重建取消：显示“已取消重建，正在继续使用原有索引”，不写候选数据。
- 失败：显示错误和“重试”。
- `onunload` 会触发当前 token 并设置永久 unload barrier，阻止后续扫描、embedding 和保存开始。

### 取消状态泄漏修复

后续审查发现原先的 `indexCancelled` 是插件长期共享的布尔值：一次取消后，即使该次 `rebuildIndex()` 已结束，它仍为 `true`；而全量建库和 Vault 增量更新共用的 `commitIndex()` 会无条件检查它。因此下一次独立增量更新可能被误判为已取消。

现改为 `src/build-cancellation.ts` 的 `BuildCancellationController`：每次全量 build 从 `startBuild()` 获得一个新的 `BuildCancellationToken`，`cancelIndex()` 只取消当前 token，`finally` 以该 token 调用 `finishBuild()`。全量扫描、batch 之间和保存前继续检查该 token，候选索引仍只在完整成功后提交。

`commitIndex()` 仅在全量建库调用时传入 build token；增量更新不传 token，故不会继承已经结束的取消状态。两类提交都会检查 controller 的永久 unload barrier，因此插件卸载后仍不能 commit。新增回归测试覆盖“取消一次重建后，独立增量提交成功”、“新 build 获得未取消 token”以及“unload 阻止 build/incremental commit”。

## 自动验证结果

已运行且通过：

```text
npm run typecheck  # pass
npm test           # 15/15 pass
npm run build      # pass，main.js 147.7 kB
```

构建后的 `main.js`、`manifest.json`、`styles.css` 已同步至实际独立 vault 路径：

```text
test-vault/.obsidian/plugins/obsdn-side-grep/
```

并使用 `cmp` 验证三个文件与项目根目录构建产物一致。未重新安装 Ollama、未下载模型、未执行完整 Ollama benchmark。

## 尚待用户手工验证

无法在此环境自动操作 Obsidian GUI，以下场景需要在 `D:\15_dev\obsdn-side-grep\test-vault` 复核：

1. **首次安装**：清除该插件的索引数据但保留 fixture；打开 Side Grep 应见“尚未建立知识库索引”和“建立索引”。输入文字不应触发单文件建库；点击后应看到扫描/向量化进度，完成后无需按键即出现当前编辑器结果。
2. **已有索引重开**：保留数据后重载插件，打开 Markdown 再打开侧栏；不输入也应显示结果。
3. **切换文件**：在两篇 Markdown 间切换，结果应自动改变；随后点击右侧 Side Grep，结果不能消失。
4. **正常写作**：在未保存新笔记输入至少十几个中文字，停止约 800 ms 后应查询；继续输入应继续 debounce。
5. **取消**：启动重建后点击取消。不得保存半成品；若此前已有索引，原结果仍应能使用。

## 修改文件清单

- `src/main.ts`
- `src/build-cancellation.ts`（新增）
- `src/query-lifecycle.ts`（新增）
- `src/persistent-index.ts`
- `src/types.ts`
- `src/sidebar-view.ts`
- `test/core.test.ts`
- `styles.css`
- `main.js`（构建）
- `test-vault/.obsidian/plugins/obsdn-side-grep/main.js`
- `test-vault/.obsidian/plugins/obsdn-side-grep/manifest.json`
- `test-vault/.obsidian/plugins/obsdn-side-grep/styles.css`
- `implementation-report.md`
- `index-lifecycle-fix-report.md`（新增）
