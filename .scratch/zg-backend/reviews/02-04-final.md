# 02–04：最终 review 与验收

## Scope

起点：`b64e025`（01实现）。本次检查其后的正式代码、依赖、构建/安装脚本、测试与对应说明；排除用户原有AGENTS、MAINTENANCE、gitignore其他规则、实验源代码和脚本修改。

来源：Lite spec、02/03/04任务与项目索引约束。按code-review分别检查Standards和Spec；当前工具没有sub-agent接口，由同一代理执行两轴检查，未宣称独立并行审查。

## Standards

未发现待修复的阻塞问题。

- Zvec使用锁定公开接口，只提供派生词法库；没有引入ZG、模型迁移、Fork、双库事务、镜像Vault或通用后端框架。
- 原IndexedDB提交与计划校验保留；三处成功提交统一失效派生快照与查询请求，metadata-only提交也刷新来源位置。
- 分批同步期间不可读；失败关闭句柄并丢弃应用记录，重试从已提交快照恢复。关闭/隐藏/过期批次不发布结果。
- 检索模块复用现有余弦与最终选择规则；review阶段提取共同选择逻辑，避免vector-only工具与融合路径重复维护去重。
- 结果类型不要求向量，rankScore没有被当成余弦或概率展示。
- 回归通过公开检索/来源/响应seam和真实native；故障注入仅在native系统边界。没有测试私有实现调用次数。
- native资源从安装目录解析，安装不复制用户设置或索引。原Windows同步与正式Vault未执行。

## Spec

四票要求已完成，未发现当前本机交付范围内的阻塞缺项。

实现包括现有片段＋Jieba/FTS＋向量候选＋RRF、最终去重/每文件限额、明确的失败重试、快照一致性、增量替换/删除、重启重建派生库、约30MiB独立runtime，以及原侧边栏交互。

已修复验收实际发现的阅读视图问题：隐形editor buffer加载与后台editor-change不得阻止或覆盖实际浏览器选区查询；阅读视图不借用隐形editor的旧选区。

本机目标为macOS ARM64。没有承诺Windows/BRAT分发、大库性能或质量等价。临时缓存每次插件启动重建，不新建持久化真相源；系统临时目录由OS临时清理机制管理。这一取舍写入NATIVE说明。

## Final executed checks

- typecheck：通过。
- 全套自动化：185 passed，0 failed，0 skipped。
- build与bundle检查：通过；build:native：通过。
- git diff --check：通过。
- real Obsidian dev:errors：没有捕获到错误；受控native加载故障由插件显示并恢复，不作为未处理异常。

关键red→green：RRF新接口、native读取失败后缓存失效、部分同步禁止读取、阅读视图缓冲/选区规则。其他仍正确的索引与取消测试保留。

## Real Obsidian results

使用现有独立实验Vault，明确验证完整Vault路径后才操作。旧插件与Vault身份目录已备份；测试新建文件用Vault trash清理，测试设置与期望/有效范围已恢复。测试结束保留新插件安装，以便继续使用或检查；备份入口见结果文件。

### 主用户路径

[完整结果](../results/macos-e2e.json)，`passed: true`：

- 安装目录内独立native binding加载，无开发仓库绝对路径依赖。
- 当前段落混合查询，YAML不命中，界面没有旧分数。
- 空段落不查全文。
- 真正的本地HTTP代理延迟第一段的Ollama响应：第二段先完成，旧响应释放后不能覆盖结果。
- 显式选区。
- 新增、修改、移动、删除后的两路同步。
- 范围先pending后增量应用。
- 取消重建预览保留旧索引。
- 插件重载重建关键词缓存，打开正确来源。

### 交互与故障路径

[完整结果](../results/macos-interactions.json)，`passed: true`：

- 移走安装runtime、清理相关模块缓存并重载：可见失败；恢复runtime后刷新成功。没有修改native私有方法。
- 真DOM拖动事件产生链接和引用；点击引用实际插入编辑器。
- Reading view实际Range选区触发新的查询完成；验证状态发生变化且面板实际可见，避免旧完成状态造成假阳性。
- 隐藏面板后新增文件不自动入索引，恢复可见后先更新再查询。
- 已读取并检查真实侧边栏截图：`/tmp/palimpsest-lite-sidebar.png`。

### 安装保留数据

[安装结果](../results/install-preservation.json)，`passed: true`：目标data.json与Vault身份文件字节不变，runtime独立复制。

复现脚本：[主路径](../e2e/macos-live.mjs)、[交互路径](../e2e/macos-interactions.mjs)。参数传独立测试Vault的完整路径；脚本校验CLI实际目标，不能用于正式Vault。

## Verification boundaries

真实Obsidian重新执行了小规模范围应用和重建预览取消。全量执行中断、durable故障、大规模范围取消由原自动化保护，并未宣称本轮所有场景都在实机重跑。

首次E2E脚本曾遇到CLI字符串返回、重复fixture去重、测试视图选错等问题；脚本已修正，失败fixture已trash，两份最终脚本在最终代码安装上重新通过。旧失败日志不是最终结果。

尚未验证跨平台发布、大库延迟/内存、native内部不可中断操作的最长耗时或与ZG检索质量等价。这些不阻塞用户已批准的本机Lite范围。

## Summary

Standards：0个待修复阻塞发现。Spec：0个本机范围待完成阻塞要求。四票resolved，当前实现与验收结束，不开始额外路线调查。正式提交为01的 `b64e025` 与02–04的 `f673f14`；仅本次实现被暂存/提交，用户原有改动保留。
