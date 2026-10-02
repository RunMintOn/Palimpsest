# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Palimpsest 面向长期使用 Obsidian，并积累了大量日记、摘录、反思、复盘或写作材料的人。他们仍在持续写作和思考，但过去记录的内容很少再次进入视野。

主要用户不受单一写作类型限制。共同点是拥有不断增长的个人文字档案，并感到其中有价值的内容正在沉没。

## Product Purpose

Palimpsest 让用户在书写当下时，自然重新遇见过去记录的相关想法。它帮助用户看见被遗忘的记录、观点变化和意外关联，让旧内容重新参与今天的思考。

产品的中心价值是“重新遇见过去的自己”，同时支持重新利用积累的知识。成功意味着用户无需中断写作去主动搜索，也能再次发现有价值的旧内容。

## Positioning

Palimpsest 是 Obsidian 中的环境式记忆召回工具。普通搜索要求用户先意识到自己要找什么，再输入关键词；Palimpsest 根据当前正在书写的内容，主动呈现语义相关的旧笔记原文片段。

它的核心承诺是：当用户书写当下，过去记录的相关想法会自然浮现。

## Operating Context

用户在 Obsidian 中写日记、反思、复盘、文章或其他长期笔记。Palimpsest 安静地位于右侧边栏，在用户停笔后根据当前笔记内容检索个人 Vault，并显示相关旧片段。用户可以阅读片段、打开原文，或把链接和引用拖入当前笔记。

首次使用需要通过 Ollama 和本地 embedding 模型建立索引。此后，新增和修改的笔记会增量更新。自动查询和自动增量索引只在至少一个 Palimpsest 面板实际可见时运行。

## Capabilities and Constraints

- 当前是 Obsidian 桌面端 beta，最低支持 Obsidian 1.12.0。
- 当前通过 BRAT 或 GitHub Release 安装，尚未进入 Obsidian 官方社区插件目录。
- 使用当前笔记全文或有效选区进行语义查询。
- 以相关原文片段为结果，而非只显示文件名。
- 支持 Markdown 渲染、打开来源、拖动插入链接和引用。
- 索引和检索全部在本地完成，不调用云端 API。
- 默认依赖本地 Ollama 服务和 `qwen3-embedding:0.6b` 模型。
- 索引保存在按 Vault 隔离的本机 IndexedDB 中，不随 Vault 文件夹复制。
- Landing page 使用静态 HTML、CSS 和 JavaScript，托管于 GitHub Pages：`https://runminton.github.io/Palimpsest/`。

## Brand Commitments

产品名称是 Palimpsest。名称来自“重写本”：旧字迹被刮去并覆写后，仍可能重新显现。这个含义对应产品让被新内容覆盖的旧想法再次进入视野的理念。

现有产品描述为“an Obsidian side channel to your past”。产品表达应保持克制、诚实，并把个人记忆、知识沉积和重新发现作为长期主题。

## Evidence on Hand

- `README.md` 和 `README.zh-CN.md` 包含现有功能、安装方式、运行机制和本机资源实测数据。
- `image.png` 是 AI 生成的宣传图，可以作为现有视觉素材或方向参考，不能作为真实产品效果证据。
- 当前主要由产品作者本人使用。
- 目前没有可公开使用的用户评价、安装量、案例研究或演示视频。未来页面不得虚构这些证据。
- 产品界面和交互可以从现有插件源码、`styles.css` 与测试 Vault 中验证。

## Product Principles

1. 让旧内容在相关时刻自然出现，而不是要求用户先想起并主动搜索。
2. 优先帮助用户重新遇见过去的自己，同时支持知识和写作材料的复用。
3. 保持写作流程连续；召回应安静地发生在用户当前工作的旁边。
4. 展示可回到原文的真实片段，让用户理解关联并自行判断价值。
5. 坚持本地处理与清楚的数据边界，不用便利性换取用户私人文字的外泄。
