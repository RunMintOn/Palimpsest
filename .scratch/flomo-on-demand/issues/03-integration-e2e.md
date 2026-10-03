# 03: 按需检索双插件联调

**What to build:** 在同一独立测试 Vault 中完成“Flomo 点击卡片 → Palimpsest 查询 → 展示原文与打开来源”，并证明简化版没有引入自动更新联动或跨视图请求干扰。

**Blocked by:** [01 — Palimpsest 查询入口](01-text-query-api.md)；[02 — Flomo 找相关](file:///Users/ziqian/20-dev/20-ecosystems/02-obsidian/obs-flomo-view/.scratch/palimpsest-on-demand/issues/02-related-records.md)。两张票 resolved 后开始。

**Status:** resolved

## Context

验收范围以 [共同 spec](../spec.md) 为准。本票归 Palimpsest 任务目录管理，但同时检查两个仓库的完成记录。只修复此次接入引起的问题，不开展新的架构优化。

## Acceptance criteria

- [x] 确认两边实现的协议一致，01／02 自动化与构建实际通过，记录使用的源码版本或工作区状态。
- [x] 准备明确完整路径的独立测试 Vault，安装两个构建；Palimpsest 使用自包含本机 native runtime，保留目标设置。测试不接触正式 Vault 或正式索引。
- [x] 保存可重复的脚本或明确操作步骤，强制检查实际目标；不得直接运行 Flomo 当前硬编码实际使用 Vault 的脚本。
- [x] 用测试数据显式建立索引后关闭 Palimpsest 侧边栏，Flomo 仍能按卡片正文查询。来源文件尚未入库也能查询已索引候选。
- [x] 候选包含超过一页记录；未渲染记录可召回，空间外和排除文件不能返回，来源文件不返回，同文件最多一条。标签与每日回顾抽样不意外缩小候选。
- [x] 验证 Markdown 摘录、来源上下文、打开来源、位置变化及文件删除处理；无结果与不可用的界面表现不同。
- [x] 同时发起 Flomo A／B 乱序查询及 Palimpsest 侧边栏查询，各自结果不覆盖；关闭一个 Flomo 视图不影响其他使用中的视图。
- [x] 验证未建库、不兼容、后端故障、插件缺失或版本不支持有明确提示，记录、编辑、回顾仍可使用。
- [x] 实测 Flomo 先启用／Palimpsest 后启用、Palimpsest 卸载／重载、在途查询后卸载；旧实例不成功发布，下次手动重试使用新实例。不要求后台自动重连。
- [x] 只有 Flomo 可见时修改测试文件，证明 query 不自动维护正式索引，并显示已有索引提示；用户主动打开 Palimpsest 按原流程完成更新后，重新点击可取得更新结果。
- [x] 需要测试更新时只对独立测试索引执行，不通过外部查询绕过确认、deferred 或范围 pending。
- [x] 修复本次问题后重跑受影响测试，保留可检查结果及必要截图；清理测试 fixture 使用 Vault trash，恢复测试设置和范围。
- [x] 最终记录已验证／未验证项、两边交付入口与简化版限制，不把按需版本宣称为完整自动联动；完成后停止，不自动发布或安装正式 Vault。

## Implementation constraints

未执行或不可执行的实机项保持未勾选，不能仅凭模拟成功标记整票 resolved。受控向量和 fixture 用于验证接入行为，不声称相关性效果提升。

不新增生命周期注册、服务总线、状态流或缓存体系。若发现协议必须变更，先在共同 spec 更新决定，并让两边契约测试保持一致，不各自加隐式兼容分支。

## Completion

双方实现与验证已完成。独立实验 Vault 最终 E2E 8 组旅程通过并完成清理，复现脚本为 `../e2e/macos-integration.mjs`；实际目标、验证结果和未验证范围见 [最终 review](../reviews/final.md)。正式 Vault 未操作。

用户本轮通过 implement 明确授权完成后提交，覆盖本票早期不提交的默认限制。

## Comments

- 本票的测试安装仅针对实施阶段明确确认的独立 Vault。当前写票操作未执行任何安装、索引更新或插件重载。
