# Flomo 按需接入：最终验证与 review

## 范围与比较基点

- Palimpsest 基点：`2a77b9d95737169126d0a5bd1a12619f3b2666f8`。
- Flomo 基点：`0823d7bf42111aa080ab7d7f56845dd09e36d4cd`；本轮 Flomo 交付提交：`c74edb7`。
- 共同 spec：`../spec.md`；实施票 01、02、03。
- 仅按需查询已有索引。无外部自动更新、订阅、持久连接、查询缓存或排序算法迁移。
- 用户本轮明确授权完成后提交，覆盖早期草案中“不提交”的默认限制。
- 当前工具没有子代理。Standards、Spec 与 UI 结束检查由同一代理分开执行，不宣称独立双代理 review。

## Standards

审查两个仓库本次源码、测试、样式和保留的 E2E 脚本，依据 Palimpsest `AGENTS.md`、`MAINTENANCE.md`、共同 spec 约束及 code-review smell baseline。

- 正式索引仍是唯一真相源；关键词缓存只从已提交快照派生。
- 接口与编辑器调度隔离；共享缓存失效与调用方展示失效分离，无新的通用并发框架。
- Flomo 复用完整元数据快照和既有卡片，插件发现集中在 Adapter。
- 未直接编辑构建产物、未增加运行时依赖、未操作正式 Vault。
- 无待修复的规范违反或需要当前重构的 smell。

## Spec

- 普通对象 v1 协议、输入预算、相对路径规范化、稳定错误、pending 提示均符合要求。
- 候选在两路排名／截断前约束；关键词候选预算补偿范围外片段；文件级最佳片段与有界扩展复用现有规则。
- 外部请求不共享侧边栏 QueryGate，不启动正式索引扫描或更新。
- UI 覆盖时间流／回顾、原文读取与 frontmatter 排除、错误和空结果区分、重新查询、打开来源。
- 请求序号独立于页面刷新；关闭、来源删除和空间变化会失效；展示前过滤当前有效集合。
- Review 修正：源片段可能只是某一行的一部分。行号有效性检查改为“对应行范围包含原文片段”，避免完整行不等于片段时错误退回文件打开；新增实机检查并重跑受影响测试与联调。
- 无待修复的漏项、错误实现或范围扩张。

## 实际执行的自动化

| 仓库 | 检查 | 结果 |
| --- | --- | --- |
| Palimpsest | `npm run typecheck` | 通过 |
| Palimpsest | `npm test` | 212 项通过（新增公开文本查询入口 8 项） |
| Palimpsest | `npm run build:native` | build、bundle 检查与 macOS ARM64 runtime 构建通过 |
| Flomo | `npx tsc --noEmit` | 通过 |
| Flomo | `npm test` | 19 项通过（新增请求会话／Adapter 4 项） |
| Flomo | `npm run build` | 通过 |
| 双方 | `git diff --check` | 通过 |

先运行入口与会话红测，再实现；路径通配符回归在修正前失败。最后一次行号修正后重跑 Flomo 会话测试 4 项、构建（含类型检查）及实机 E2E；没有把之前全套测试称作行号修正后的重跑。

## 独立 Obsidian E2E

实际目标：`/Users/ziqian/20-dev/10-projects/16-palimpsest-zg-experiment/experiments/zvec/vault`。

两个插件安装的是本轮构建，Palimpsest 为自包含 macOS ARM64 runtime。脚本在文件操作前和 Obsidian eval 内同时校验目标完整路径。通过正常预览／确认建立测试索引，清理使用 Vault trash，随后正常预览／确认重建以恢复正式快照。原设置与侧栏折叠状态恢复。

最终结果：8 组旅程检查通过，`passed: true`、`cleaned: true`。各组涵盖：

1. Palimpsest 侧边栏隐藏，未索引来源仍查询完整空间；第 36 条未渲染记录召回，范围外和排除记录不返回，文件结果不重复。
2. 真实 Markdown 摘录、粗体与文件上下文；点击结果定位行号，部分行片段仍定位；旧位置退回打开文件，删除文件给出提示。
3. 标签与回顾不缩小候选；frontmatter 私有属性不进入查询；零结果具有成功空状态。
4. A/B 乱序只发布 B；关闭一个视图不影响另一个视图请求。
5. 未建库、不兼容、Ollama 故障和接口版本错误有明确提示。
6. Flomo 存在而 Palimpsest 缺失时仍可保存记录；Palimpsest 晚加载、真实卸载／重载、在途卸载的旧实例拒绝成功，下次手动查询发现新实例。
7. 仅 Flomo 可见时修改文件不发布正式索引；query 保持旧快照并提示 pending；打开 Palimpsest 后由原流程更新，再查询得到新原文；双方查询排除与展示隔离。
8. 异步期间新增排除、删除结果、删除来源、切换空间均正确过滤或丢弃响应。

最初重跑发现安装脚本对“Flomo 已启用”不幂等，已修正为仅缺失时启用。加上 Markdown 后，重复 fixture 文本触发现有去重，使“必须返回某一重复文件”的断言失效；fixture 改为唯一目标，不修改检索算法。上述问题均修正并实际重跑通过。

保留的本机结果（worktree 外，不提交）：

- `/tmp/palimpsest-flomo-e2e.json`
- `/tmp/palimpsest-flomo-e2e-desktop.png`
- `/tmp/palimpsest-full-test.log`
- `/tmp/flomo-full-test.log`
- `/tmp/flomo-ui-detect.json`（`[]`，无机械样式发现）

## UI 结束检查

`disposition: ship`（本次局部接入范围）。

- persistence：沿用既有源码和 Obsidian 主题，缺少 PRODUCT／DESIGN 文件不扩展本次工作。
- fidelity：卡片操作、单组结果、来源按钮、错误／空状态与固定新鲜度提示匹配 spec；字体、背景、控件继承原界面和 Obsidian 原生主题。
- ceiling：无新增视觉系统或动画要求。
- material_fixes：无待处理项。截图检查范围为 macOS 桌面，不声称移动端或其他主题通过。
- keep：保留原卡片编辑、标签和回顾行为，不加入隐式查询。

## 未验证与保留限制

- 未安装正式 Vault，未验证 Windows、Linux 或移动端运行时。
- 未做真实笔记相关性评测；测试证明范围、一致性和交互，不证明算法更好。
- Flomo 单独使用不驱动索引维护；最近修改可能不在结果里。这是第一版约定。
- 本轮保留 Flomo 原有 `.gitignore` 改动及未跟踪 `HANDOFF.md`、`PALIMPSEST-INTEGRATION.md`，不纳入本次提交。

## 重复执行

先在两个仓库构建，随后从 Palimpsest 根目录执行：

```bash
node .scratch/flomo-on-demand/e2e/macos-integration.mjs \
  /Users/ziqian/20-dev/10-projects/16-palimpsest-zg-experiment/experiments/zvec/vault \
  /Users/ziqian/20-dev/20-ecosystems/02-obsidian/obs-flomo-view \
  /tmp/palimpsest-flomo-e2e.json
```

目标机器需能通过 Obsidian CLI 访问这个独立 Vault，并已配置可用 Ollama 模型；迁移机器时应显式修改脚本 allowlist 到新的独立测试路径，不能取消校验或改用正式 Vault。
