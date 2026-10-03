# 本机混合检索安装与验收

当前源码版保留 Ollama、Markdown 分块与 IndexedDB，使用 Zvec 0.7.1 的 FTS/Jieba关键词召回，与现有向量候选通过 RRF融合。默认查询当前段落。

## 支持范围

此轮已验收 macOS ARM64＋桌面 Obsidian。没有发布新的 Release，没有验证 Windows或BRAT的native资源分发。现有三文件Release不能代表此源码版的完整安装。

## 构建与独立安装

```bash
npm ci
npm run typecheck
npm test
npm run build:native
node scripts/install-native-to-vault.mjs /absolute/path/to/test-vault
```

测试 Vault 的 `.obsidian/plugins` 必须已存在。目标插件目录不能是软链接。安装脚本保留 `data.json`，不复制、覆盖或清除 IndexedDB/派生缓存。

安装目录除 `main.js`、`manifest.json`、`styles.css` 外，需要 `runtime/`。它包含当前平台的 Zvec、native binding、Jieba资源和detect-libc，总计约30MiB，未压缩。不包含ZG、原生embedding模型或模型缓存。插件只从自己的安装目录加载这些库，不从开发仓库加载。

`npm run build`只构建主bundle和执行bundle检查；`build:native`才准备本机runtime。`scripts/sync-to-vault.sh`已转交同一个native安装脚本。Windows三文件同步流程不能用于部署此native版，暂不将此bundle作为跨平台Release发布。

在Obsidian启用或重载插件，继续使用已有本地Ollama设置。新关键词能力不要求重新生成向量；只有原有索引身份不兼容、尚未建库等情况才按现有流程建库。

## Markdown 分块升级

当前分块身份为版本3，识别顶层反引号／波浪号围栏和ATX／Setext标题。代码内的井号行保留为正文，不改变标题上下文。默认查询排除文首frontmatter、标题和围栏分隔行；围栏正文仍按空行取当前段落。显式选区不受自动段落过滤影响。

版本2索引载入后保留原数据，但在新版中显示不兼容并要求全量重建。升级不会自动重建或清除旧索引；先预览再确认。取消或失败后原数据仍在，不兼容状态也仍在，不能据此声称旧索引仍可查询。

重建只为语义输入变化的片段生成新向量。模型与维度兼容且文件名、标题上下文、原文完全相同的片段可跨分块版本、chunk ID和行号变化复用；模型或维度变化时不可复用。无需因身份升级而必然重新embedding全库。

规则限于顶层基础结构，不提供完整CommonMark容器解析、重叠窗口或章节实体。长代码服从片段预算，不保证每片有成对围栏。

## 查询与设置

- 空行、标题和少于8个非空白字符的段落不回退全文。
- 可显式查询选区；全选后点击选区按钮可查全文。阅读视图支持实际浏览器选区。
- 结果排序是两路融合，不是余弦相似度或概率。卡片不再显示旧分数。
- 自动展开只按数量控制；旧余弦展开阈值保存字段被忽略，不变成融合阈值。
- 当前文件排除、每文件限额、去重、来源跳转、引用与链接保持。

## 关键词缓存与恢复

IndexedDB仍是唯一持久化真相源。关键词库只接受成功提交的片段，不从原文件另行扫描；YAML继续由现有分块排除。

关键词缓存使用按Vault身份区分的独立系统临时目录，关闭插件时关闭native句柄。每次插件启动从IndexedDB快照重建缓存，日常更新只替换或删除变化片段。临时缓存目录由系统临时文件清理机制处理，不进入Vault同步或安装包。

失败、过期或未完成的同步不可查询。native加载/读取失败时显示查询失败，恢复资源后用侧边栏刷新按钮重试；不悄悄退回纯向量，也不将旧关键词库当成最新状态。无需因此清除已有向量索引。

全量重建、取消、范围pending/deferred、计划有效性和durable commit继续使用原流程。metadata-only提交也刷新结果，避免继续展示旧位置。

## 验收范围

自动化保护RRF、真实Jieba/YAML、替换与删除、失效批次、部分同步不可读、native失败重试、重启恢复和查询来源。

本机真实Obsidian已验证独立native库、当前段落与空段落、延迟旧响应、选区、阅读视图、文件更新、范围pending/应用、重建预览取消、插件重载、native资源缺失后重试、来源、链接拖动及引用插入。

完整全量重建执行中的取消/失败与大规模范围取消继续由现有自动化保护；本轮真实Obsidian只重新检查了重建预览取消，不将它宣称为所有durable故障场景均已实机重跑。

没有进行大库性能基准或检索质量评测，没有承诺与完整ZG效果等价。
