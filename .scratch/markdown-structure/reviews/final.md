# Markdown 结构两票：最终 review 与验收

## Scope

基线：`ae146feed7bd3daa8ecb8777fb1b914196a9cfd6`，对照[spec](../spec.md)及两张ticket检查本次工作区差异。排除已有flomo-on-demand文档与它的忽略规则。

使用code-review的Standards／Spec两轴检查。当前无sub-agent工具，由同一代理分别检查；不宣称独立并行review。

## Standards

0个待修复阻塞发现。

- 最小共享结构识别由chunker与默认查询使用，不新增AST、依赖、后端框架或公开私有测试接口。
- YAML、原始位置、片段预算、语义比较、计划确认、取消与durable commit沿用现有职责。
- 模型兼容的语义复用与正式索引身份兼容分开；全量重建入口不再将不同模型／维度的旧chunks无条件投入复用。
- 测试通过chunkMarkdown、查询来源、扫描、计划、PersistentIndex、IndexStore及真实native公开入口观察行为；只替换embedding／文件读取等系统输入。
- review中检查长文本行为：保留代码换行，普通长段落维持旧分割策略，避免无关语义变化引起额外重算。
- main.js与runtime只由构建生成。未对正式Vault、Windows或发布流程操作。

## Spec

0个待完成范围项。

- 支持顶层ATX、单行Setext、反引号／波浪号围栏；关闭字符和长度正确，未闭合与伪关闭不会使代码改变breadcrumb。
- 代码与原围栏保留为索引正文；frontmatter不进入索引及默认来源。默认查询在围栏正文按空行取段，不跨边界；显式选区保持原行为。
- 分块版本3通过现有身份检查阻止混用v2。取消／失败保留旧数据，不伪装兼容；取消文案明确区分保留与可查询。
- 模型与维度兼容的相同文件名、breadcrumb与正文可跨版本／ID／行号复用；不同模型或维度会实际生成向量。
- 旧generation在预览取消、embedding失败、stale plan后保留；成功后才提交新快照并同步词法输入。
- 排名、召回、模型、数据库schema及索引范围语义保持。没有扩展诊断平台、reranker、HNSW、重叠窗口或章节实体。

## Executed checks

- typecheck：通过。
- 完整自动化：204 passed，0 failed，0 skipped。
- build、bundle检查、build:native：通过。
- git diff --check：通过。
- 真实Obsidian dev:errors：No errors captured。

实际red→green：围栏井号造成片段拆坏／标题污染、版本2未被视为不兼容、围栏代码默认来源错误返回空字符串、长代码分割丢失换行。模型不兼容路径有执行结果回归。

## Real Obsidian E2E

完整目标：`/Users/ziqian/20-dev/10-projects/16-palimpsest-zg-experiment/experiments/zvec/vault`。正式Vault未读取、安装或重建。

[复现脚本](../e2e/macos-upgrade.mjs)在真实v2插件与快照上创建fixture，再独立安装最终v3构建。最终运行的9项检查全部通过：

1. v2真实fixture复现代码标题污染。
2. 安装重载后保留旧数据、设置和重建提示，status为incompatible。
3. 预览取消保留内存与durable v2快照。最终预览14片段，可复用10、需生成4。
4. 确认升级提交v3；未变普通片段ID更新但向量逐项相同，代码和Setext上下文修正。
5. 围栏注释实际触发混合查询、返回正确正文及breadcrumb，YAML标记词不命中。
6. 打开来源到原文件及原始行。
7. 真DOM拖动产生引用，按钮实际插入编辑器。
8. 围栏与Setext分隔位置等待，Setext正文与显式代码选区查询完成。
9. 再次插件重载保持v3 ready、重建关键词缓存、期望／生效范围不变。

最终fixture已通过Vault trash清理并从索引移除。实验Vault保留最终新版：7篇文档、9片段、0 skipped，范围current。原设置未修改。

### 本机证据与复现边界

最终结果：`/tmp/palimpsest-markdown-upgrade.json`，passed=true。
最终日志：`/tmp/palimpsest-markdown-live.log`。
最终备份及已读取检查的截图：`/var/folders/zh/qf_nccyd0_b0fc84rk8dl4lm0000gp/T/palimpsest-md-e2e-backup-Neghuy/sidebar.png`。
备份目录包含真正v2插件及fixture快照。以上均在worktree外，不随clone分发。

```bash
# 从已安装v2且ready的独立实验Vault开始，先在项目根目录构建：
npm run build:native
node .scratch/markdown-structure/e2e/macos-upgrade.mjs \
  /absolute/path/16-palimpsest-zg-experiment/experiments/zvec/vault \
  /tmp/palimpsest-markdown-upgrade.json
```

脚本拒绝其他目标路径，并在每次eval验证实际Vault完整路径。重跑可传第四个参数为该脚本保留的真实v2备份目录；这会仅在独立实验Vault恢复旧测试基线，通过IndexStore durable提交构造测试初态，然后重新走真实的预览确认升级。不得用于正式索引。

首次脚本曾因CLI将字符串2解析成数字、重载改变数组次序、窗口隐藏、eval无Obsidian模块以及程序化打开文件未产生可靠活动视图事件失败。已修正比较方式、显示实际窗口并改用CLI open事件；最终在最终代码上从v2重跑全部路径通过。失败运行不作为验收结果。

## Verification boundaries

不是检索相关性评测，无量化效果提升结论。真实Obsidian重跑预览取消、成功升级、来源／引用和重载；执行中取消、durable故障和复杂范围取消沿用自动化保护，未宣称全部实机重跑。未验证跨平台或完整CommonMark嵌套容器。

## Summary

两票resolved。Standards 0个待修复发现；Spec 0个待完成项。正式使用Vault仍未安装新版。任务完成后停止，不开始其他架构优化。
