# 01: 正确索引 Markdown 并安全升级旧索引

**What to build:** 笔记中的围栏代码不会再污染章节标题，Setext 标题能够提供正确上下文；已有用户能通过预览、确认和全量重建安全启用新版分块，复用语义未变且模型兼容的向量。

**Blocked by:** None (can start immediately).

**Status:** resolved

## Context

依据 [Markdown 结构 spec](../spec.md)。这是从原文到正式索引、混合召回及来源的完整路径，包含新语义发布所必需的旧索引处理。共享结构逻辑的最小提取在本票内完成，不另开纯重构票。查询侧采用新规则由 02 完成。

## Acceptance criteria

- [x] 先增加可在旧实现上失败的公开行为测试：围栏内井号行保留为正文，不改变后续 breadcrumb；Setext 标题进入正确层级的 breadcrumb，不进入片段正文。
- [x] 按 spec 支持反引号／波浪号围栏、起始长度与字符匹配、info string、过短或不同字符的伪关闭、未闭合围栏、零到三个前导空格及 LF／CRLF。
- [x] ATX／Setext 在围栏外按 spec 识别；空标题不产生空 breadcrumb；孤立下划线不借用不相邻文本；跳级标题保持结构合法。
- [x] 原有 frontmatter 排除契约保持；代码内容和围栏原文不因标题识别被删除或改写。长代码仍服从片段预算，不增加重叠窗口、合成围栏或章节实体。
- [x] 围栏前后正文归属正确，受影响片段来源位置能指向原文件。未受新规则影响的普通正文和 breadcrumb 保持原行为。
- [x] 分块版本由 2 升级到 3；载入旧索引显示 incompatible 与重建入口，旧数据仍保留。启动不自动重建，旧版本不进行普通增量 patch 或冒充新版兼容索引。
- [x] 重建预览在 embedding 前完成，基于实际复用规则报告成本；确认后只生成不可复用输入的向量，保留重复输入分组复用。
- [x] 模型与维度兼容时，文件名、breadcrumb、正文完全一致即可跨 chunk ID／版本／行号变化复用向量；正文或上下文变化不能误复用。
- [x] 模型或维度不同不得通过任何本次全量重建的 chunks 复用入口绕过兼容检查；以不同模型但相同文本、相同维度的样例保护该风险。
- [x] 取消、失败、过期计划不替换旧 generation；不兼容旧数据保留后仍显示重建提示，不承诺新版中继续查询旧分块。既有 durable commit 取消边界保持。
- [x] 成功后才采用新版正式快照并失效关键词缓存；通过真实 native 的公开检索入口验证代码正文可命中、旧错误标题输入被替换、YAML 不可命中。
- [x] 使用独立 fixture 经扫描、计划、受控 embedding、提交和混合查询验证完整路径；更新必要的升级说明，准确区分重建扫描与全库重新 embedding。
- [x] typecheck、相关回归、全套测试及 build 通过；记录红到绿证据与本票尚未执行的真实 Obsidian 项目。

## Implementation constraints

沿用 chunkMarkdown／scanIndexDocument、重建计划、PersistentIndex／IndexStore 和 HybridRetrieval 的公开 seam。结构识别只在内部共享；不对其私有状态或调用次数编写测试。实施细节以 spec 的结构规则为准。

不放宽正式索引的模型／分块身份检查。向量复用兼容与正式索引可查询兼容是不同判断，不能为节省 embedding 将旧索引整体视为 ready。

不扩大为完整 Markdown parser、模型身份重构、缓存重构或第二套迁移系统。不修改正式 Vault、不发布、不同步、不自动提交。

## Verification and handoff

为 02 提供含普通标题、Setext、围栏注释、frontmatter 及 CRLF 的共享行为 fixture，以及可复现的旧版快照升级测试。说明哪些文本被识别为结构、哪些输入复用了向量。旧快照由 fixture 生成，不从用户正式索引导出。

## Final verification

最终typecheck、204项自动化测试、build与build:native通过。独立测试Vault的v2→v3完整升级E2E通过；验收边界、复现方式和实际结果见[最终review](../reviews/final.md)。未操作正式Vault。完成后停止，不自动开展其他架构改动。

## Comments

- 按用户要求直接发布。此票包括升级以避免新分块行为在旧身份下被局部发布；后续查询票不再次提升分块版本。
- 实现完成：结构识别、v3身份、模型兼容复用保护及取消文案已完成。围栏正文丢失／错误breadcrumb、升级身份测试已实际red→green；相关14项回归、typecheck与build通过。最终全套与真实Obsidian验收随02统一执行，最终review补齐各项验收记录。
