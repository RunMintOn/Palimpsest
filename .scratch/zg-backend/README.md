# 混合检索 Lite：已完成材料

当前实现与本机验收已完成，正式 Vault 尚未安装新版。产品代码提交为 `b64e025` 与 `f673f14`。

## 版本化入口

- [最终 spec](spec.md)
- [ZG 拼装清单与方案推导](zg-assembly-map.md)
- [01 当前段落查询](issues/01-current-paragraph-query.md)
- [02 混合检索](issues/02-hybrid-retrieval-sidebar.md)
- [03 同步与恢复](issues/03-keyword-sync-recovery.md)
- [04 独立安装与验收](issues/04-macos-install-e2e.md)
- [01 review](reviews/01-current-paragraph.md)
- [最终 review 与验收](reviews/02-04-final.md)
- [主路径 E2E](e2e/macos-live.mjs)
- [交互 E2E](e2e/macos-interactions.mjs)
- [正式安装说明](../../NATIVE.md)

## 本地保留材料

`results/`保存机器相关的JSON结果，`probes/`及历史调查文件保存早期完整ZG/纯JS候选记录；均已忽略，不随克隆提供。review中的这些链接是本地证据入口，复现依据是版本化的测试代码与E2E脚本。

运行E2E会修改独立测试Vault并通过trash清理fixture。仅在用户授权测试时，传入测试Vault完整路径；脚本核对CLI实际目标。勿对正式Vault运行。

旧workspace handoff已移入系统废纸篓。当前交接只保存在系统临时目录，不新增仓库handoff副本。用户最新要求是不安装新版到真实Vault；收尾不改变正式插件或索引。
