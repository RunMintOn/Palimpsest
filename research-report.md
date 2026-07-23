# 调研报告：写作时主动上下文召回（Active Context Recall While Writing）

> **调研范围**：Obsidian 插件（优先）、Logseq、Roam Research、Notion、Mem、Reflect、Tana  
> **区分对象**：普通全文搜索 / 模糊搜索 / backlinks & unlinked mentions / embedding & semantic search & RAG / **主动实时更新推荐结果**  
> **日期**：2026-07-24（最初版本于 2026-07-04 完成，标题日期错误为 2025 年，已修正）
> **⚠️ 致歉**：首次撰写时未确认当前时间，误标为 2025 年。本版本已更正为 2026-07-24，并对关键信息做了二次验证。

---

## 目录

1. [核心结论](#1-核心结论)
2. [Obsidian 插件](#2-obsidian-插件)
3. [Logseq](#3-logseq)
4. [Roam Research](#4-roam-research)
5. [Notion](#5-notion)
6. [Mem](#6-mem)
7. [Reflect](#7-reflect)
8. [Tana](#8-tana)
9. [总结：产品机会分析](#9-总结产品机会分析)

---

## 1. 核心结论

**"根据用户当前正在输入的句子或段落，自动在侧边栏推荐知识库相关文件、段落或句子"——这个想法已有接近成熟的实现，但仍有明显的产品缺口。**

### 已存在的关键区分

| 类别 | 是否被调研对象 | 说明 |
|---|---|---|
| 普通全文搜索 / 模糊搜索 | ❌ 不相关 | 需要用户主动输入关键词，非被动召回 |
| backlinks / unlinked mentions | ❌ 部分相关 | 基于已存在的链接结构，不分析语义 |
| embedding / semantic search / RAG | ✅ 相关但不完全 | 许多工具实现了语义搜索，但多为"搜索后展示"而非"写作中主动推送" |
| **主动实时更新推荐** | ✅ **这是核心关注点** | 随当前编辑内容自动、被动地更新侧边栏推荐 |

### 总体判断

- **最佳匹配产品**：**Mem**（Heads Up 功能）和 **Smart Connections（Obsidian）** 最接近"写作时主动上下文召回"的设想
- **次接近**：Semantic Backlinks（Obsidian）、Open Connections（Obsidian）、Obsidian Insights（Obsidian）
- **关键缺口**：绝大多数工具只能根据**当前打开的整篇笔记**做推荐，而不是根据**当前正在输入的句子/段落的局部语义**做细粒度召回。能做到"逐句级"或"逐段落级"实时推荐的极少。

---

## 2. Obsidian 插件

### 2.1 Smart Connections

| 项目 | 内容 |
|---|---|
| **名称** | Smart Connections |
| **链接** | https://github.com/brianpetro/obsidian-smart-connections / https://smartconnections.app |
| **维护状态** | ✅ 非常活跃，5.3k Stars，372 个 release，最近更新 2026-07-04 |
| **交互方式** | 右/下侧边栏展示与当前笔记语义相关的笔记列表 + 摘要片段；v4 新增 footer 内联推荐、graph view；可以拖拽结果创建 `[[链接]]`；支持 inline discovery（Pro） |
| **是否本地运行** | ✅ 默认本地，使用 Transformers.js 在浏览器内运行 embedding 模型（WebGPU/WASM），零配置零 API key |
| **是否使用 AI/embedding** | ✅ 本地 embedding 模型（默认），也支持 OpenAI / Gemini / Claude / Ollama 等 |
| **与设想的相似度** | ★★★★☆ 高度相似——自动根据当前笔记内容推荐相关笔记，写作时被动推送 |
| **与设想的缺口** | ① 以"整篇笔记"为单位做语义匹配，而非逐句逐段；② 需要先打开/切换到某笔记才触发，不是严格意义上的"输入过程中逐句更新"；③ Pro 功能（inline discovery）更接近但需付费 |

**评定**：目前 Obsidian 生态中最成熟的"写作时主动推荐"方案。

---

### 2.2 Semantic Backlinks

| 项目 | 内容 |
|---|---|
| **名称** | Semantic Backlinks |
| **链接** | https://community.obsidian.md/plugins/semantic-backlinks |
| **维护状态** | ✅ 活跃，189 downloads（增长较慢，可能因为需要外部 Ollama），有更新 |
| **交互方式** | ① **内联建议弹窗**——打字时自动弹出，类似 Various Complements，混合精确匹配（instant）和语义匹配（下方）；② 右侧面板显示语义相近笔记和最佳匹配句子预览 |
| **是否本地运行** | ✅ 通过 Ollama/LM Studio 本地 embedding（推荐），也可用 OpenAI API |
| **是否使用 AI/embedding** | ✅ Ollama bge-m3 或 OpenAI text-embedding-3-small |
| **与设想的相似度** | ★★★★★ **最接近设想**——在输入过程中弹窗建议相关笔记和段落，精确匹配即时显示、语义匹配稍后出现，还有 snippet 预览 |
| **与设想的缺口** | ① 弹窗建议以"笔记标题"为主，段落级匹配是辅助；② 需要运行外部 Ollama/LM Studio 进程；③ 较新，生态尚小 |

**评定**：在"输入过程中逐句/逐词触发推荐"这个维度上，Semantic Backlinks 是最接近设想的插件。

---

### 2.3 Link Link！（2026年6月新发现）

| 项目 | 内容 |
|---|---|
| **名称** | Link Link! |
| **链接** | https://github.com/Artieficr/link-link / https://community.obsidian.md/plugins/link-link |
| **维护状态** | ✅ 非常新（2026-06-05 首次发布），11 releases 到 1.4.1，活跃 |
| **交互方式** | 侧边栏展示语义相似笔记（列表 + graph 双视图），按相似度 0.00-1.00 排序+颜色标记；可以拖入编辑器粘贴 `[[link]]`；支持一键批量互连整个 vault；**最关键的：v1.4.0 新增 Selection Mode——选中任意段落文字，点击按钮即可以该段落为 query 做语义搜索** |
| **是否本地运行** | ✅ 完全本地，ONNX WASM（bge-small-en-v1.5），零配置 |
| **是否使用 AI/embedding** | ✅ 本地 embedding 模型 |
| **与设想的相似度** | ★★★★☆ **非常接近**——Selection Mode 允许用户手动选中一段文字后做段落级语义匹配，是逐段召回的重要突破 |
| **与设想的缺口** | ① Selection Mode 需要手动选中 + 点击按钮，不是完全自动化；② 默认以整篇笔记为单位，段落级匹配需要用户主动触发；③ 仅在 Editor 模式生效 |

---

### 2.4 Open Connections

| 项目 | 内容 |
|---|---|
| **名称** | Open Connections |
| **链接** | https://github.com/GoBeromsu/open-connections |
| **维护状态** | ✅ 活跃，98 releases，最近更新 2026-05 |
| **交互方式** | 侧边栏显示与当前文件语义相关的笔记；支持多种 embedding provider（Transformers.js 本地、OpenAI、Gemini、Ollama、LM Studio 等） |
| **是否本地运行** | ✅ 本地 embedding 默认 |
| **是否使用 AI/embedding** | ✅ |
| **与设想的相似度** | ★★★☆☆ 根据当前笔记推荐相关笔记，但没有"输入中逐句更新"机制 |
| **与设想的缺口** | 以整篇笔记为单位，非逐句级；无内联弹窗 |

---

### 2.5 Smart Related Notes

| 项目 | 内容 |
|---|---|
| **名称** | Smart Related Notes |
| **链接** | https://community.obsidian.md/plugins/smart-related-notes |
| **维护状态** | ✅ 活跃，1k downloads，50 个更新 |
| **交互方式** | 左侧边栏卡片堆叠显示语义最相似笔记，按余弦相似度百分比排序；全文本地运行，支持 100+ 语言 |
| **是否本地运行** | ✅ 完全本地，Transformers.js + ONNX WASM，无需任何外部依赖 |
| **是否使用 AI/embedding** | ✅ 小型多语言 embedding 模型 |
| **与设想的相似度** | ★★★☆☆ 根据当前笔记推荐，但仅限整篇笔记级别 |
| **与设想的缺口** | 无输入中逐句更新；无内联弹窗；只在切换笔记时刷新 |

---

### 2.6 Smart Relations（2026年4月新发现）

| 项目 | 内容 |
|---|---|
| **名称** | Smart Relations |
| **链接** | https://github.com/DMDerelyn/Obsidian-smart-relations / https://community.obsidian.md/plugins/smart-relations |
| **维护状态** | ✅ 2026-04 发布，266 downloads，活跃开发中 |
| **交互方式** | 基于 BM25 + tag 共现 + n-gram + 图接近度的确定性索引（非 embedding）。侧边栏展示相关笔记，支持单信号得分分解、增量索引（500ms debounce）、UUID 稳定身份 |
| **是否本地运行** | ✅ 完全本地，零 API 调用 |
| **是否使用 AI/embedding** | ❌ 非 embedding/向量，而是 BM25 + 统计方法 |
| **与设想的相似度** | ★★☆☆☆ 非语义方法，但作为纯统计方法的参考基线有价值 |
| **与设想的缺口** | ① 无语义理解；② 需要 frontmatter 中有 UUID；③ 以笔记为单位 |

---

### 2.7 Obsidian Insights

| 项目 | 内容 |
|---|---|
| **名称** | Obsidian Insights |
| **链接** | https://briansunter.com/projects/obsidian-insights |
| **维护状态** | ✅ 活跃，个人项目 |
| **交互方式** | 右侧面板实时生成写作反馈：改进建议、下一步想法、反驳论点、参考资料、关联笔记等；自动随文档变化刷新（有 debounce）；支持增量刷新而非全量重生成 |
| **是否本地运行** | ❌ 需要 LLM API（未明确说明是否支持本地模型） |
| **是否使用 AI/embedding** | ✅ 使用 LLM（GPT/Claude 类）分析全文，本地 qmd 可选 |
| **与设想的相似度** | ★★★★☆ 非常接近——写作时实时在侧边栏推荐相关笔记和观点；而且它有增量刷新机制，比完全重新生成更流畅 |
| **与设想的缺口** | ① 需要 API 调用，非纯本地；② 更偏向"AI 写作建议"而非"知识库段落级召回"；③ 个人项目，规模较小 |

---

### 2.8 Various Complements（用于对比）

| 项目 | 内容 |
|---|---|
| **名称** | Various Complements |
| **链接** | https://github.com/tadashi-aikawa/obsidian-various-complements-plugin |
| **维护状态** | ✅ 非常活跃，903 Stars，526k downloads |
| **交互方式** | IDE 风格自动补全——打字时弹出建议，包括内部链接、词汇等 |
| **是否本地运行** | ✅ 完全本地 |
| **是否使用 AI/embedding** | ❌ 纯词法匹配 |
| **与设想的相似度** | ★★☆☆☆ 只有词法自动补全，不涉及语义理解 |
| **说明** | 属于"自动补全"而非"知识推荐"，但对理解 Semantic Backlinks 的交互范式有帮助（后者借鉴了它的 UI） |

---

### 2.8 其他相关 Obsidian 插件

| 名称 | 简介 | 与设想的关系 |
|---|---|---|
| **Sidekick**（137 Stars） | 自动下划线匹配标签/页面的文本，建议建立链接 | 词法级，非语义 |
| **See Also Sidebar**（1 Star） | 从 frontmatter 读取 see-also 属性展示在侧边栏 | 需要手动配置，非自动 |
| **Contextual Guides**（197 downloads） | 基于标签/文件夹条件在侧边栏显示指南笔记 | 规则驱动，非语义 |
| **Copilot Auto Completion Plus**（251 downloads） | LLM 驱动的 FIM 代码补全式写作建议 | 生成式补全，非知识库召回 |
| **Semantic Linker**（242 downloads） | 基于 frontmatter 元数据的语义图推荐 | 仅限于元数据，非全文 |
| **Related Notes**（3k downloads） | Bloom filter n-gram 相似度推荐 | 非 embedding，统计方法 |
| **Vector Search**（0 Stars，pending） | Orama + Transformers.js 混合搜索 | 手动搜索式，非主动推送 |
| **Note Copilot**（268 downloads） | AI 侧边栏聊天助手 | 需主动提问，非被动推送 |
| **AI Sidebar**（2 Stars） | VS Code 风格 AI 侧边栏 | 通用 AI 面板，非专为上下文召回设计 |

---

## 3. Logseq

### 3.1 内置语义搜索（2025-2026 新增）

| 项目 | 内容 |
|---|---|
| **名称** | Logseq 内置语义搜索（native） |
| **链接** | PR #12009 + #12710，已合并到主线 |
| **维护状态** | ✅ Logseq 核心功能，活跃开发中 |
| **交互方式** | 设置中启用（Settings > AI > 选择 embedding 模型）；使用 Transformers.js 在本地计算 block embeddings；搜索时混合关键词 + 向量（RRF 排序） |
| **是否本地运行** | ✅ 完全本地，Transformers.js + ONNX |
| **是否使用 AI/embedding** | ✅ 支持 Xenova/all-MiniLM-L6-v2 和 Qwen3-Embedding-0.6B-ONNX |
| **与设想的相似度** | ★★☆☆☆ 这是一个**搜索**功能升级，不是写作中的被动推荐 |
| **缺口** | 用户仍然需要主动搜索才能触发语义匹配；无侧边栏自动推送 |

### 3.2 Logseq Composer

| 项目 | 内容 |
|---|---|
| **名称** | Logseq Composer |
| **链接** | https://github.com/martindev9999/logseq-composer |
| **维护状态** | ✅ 活跃，36 Stars |
| **交互方式** | RAG 插件——用 OpenAI embedding 做向量搜索，将相关笔记作为 context 传给 LLM |
| **是否使用 AI/embedding** | ✅ OpenAI embeddings + LiteLLM |
| **与设想的关系** | 聊天式 RAG，非写作中自动推荐 |

### 3.3 AssistSeq

| 项目 | 内容 |
|---|---|
| **名称** | AssistSeq |
| **链接** | https://github.com/galihlprakoso/logseq-plugin-assistseq-ai-assistant |
| **维护状态** | ✅ 80 Stars |
| **交互方式** | AI 助手分析当前文档和相关笔记作为对话上下文 |
| **与设想的关系** | 对话式 AI 助手，需要主动交互 |

### 3.4 Logseq 自动链接器

| 项目 | 内容 |
|---|---|
| **名称** | Automatic Linker |
| **链接** | https://github.com/sawhney17/logseq-automatic-linker |
| **维护状态** | ⚠️ 110 Stars，但 51 open issues，可能维护放缓 |
| **交互方式** | 自动检测可能链接的页面并创建 `[[]]` 链接 |
| **是否使用 AI/embedding** | ❌ 纯文本匹配 |
| **与设想的关系** | 自动链接工具，非语义推荐 |

**Logseq 整体评价**：Logseq 的内置语义搜索是重要进步，但仍是"搜索"而非"写作中主动推送"。插件生态中没有 Obsidian 那样成熟的主动推荐方案。Logseq 基于 block 的数据模型理论上更适合逐句/逐块推荐，但目前没有插件充分利用这一点。

---

## 4. Roam Research

| 项目 | 内容 |
|---|---|
| **名称** | Roam References Radar |
| **链接** | https://github.com/dive2Pro/roam-references-radar |
| **维护状态** | ✅ 活跃，2 Stars |
| **交互方式** | 自动检测当前 block 中可与已有页面关联的文本，显示图标指示器，点击弹出建议列表 |
| **是否本地运行** | ✅ |
| **是否使用 AI/embedding** | ❌ 词法匹配 |
| **与设想的关系** | 最基本形式的自动引用建议，非语义 |

| 项目 | 内容 |
|---|---|
| **名称** | Roam Copilot |
| **链接** | https://github.com/qcrao/copilot |
| **维护状态** | ✅ 12 Stars，最近更新 2026-03 |
| **交互方式** | 右侧 AI 面板，自动读取当前页面内容作为上下文，支持多 provider |
| **是否使用 AI/embedding** | ✅ OpenAI/Anthropic/Ollama 等 |
| **与设想的关系** | 通用 AI 侧边栏，非专为上下文召回设计 |

**Roam 整体评价**：Roam 的右侧边栏（按住 Shift 点击链接打开）是其核心交互范式，但这需要用户**手动**操作。Roam 的 block 引用系统（`((block-uuid))`）和 unlinked references 是强大的手动工具，但没有自动、实时的语义推荐。社区有 feature request 讨论 AI Related Nodes（ideas.tana.inc 的帖子实际上来自原 Tana 社区），但 Roam 自身的 AI 进展有限。

---

## 5. Notion

| 项目 | 内容 |
|---|---|
| **名称** | Notion AI |
| **链接** | https://www.notion.com/help/guides/notion-ai-for-docs |
| **维护状态** | ✅ 官方功能，持续更新（Notion Agent、AI Q&A、Autofill 等） |
| **交互方式** | ① 空间键触发 AI 写作/编辑；② 侧边栏 AI 聊天（Q&A）；③ 选中文本后 Ask AI；④ Notion Agent 可自动执行多步任务 |
| **是否本地运行** | ❌ 云端，需要 API 调用 |
| **是否使用 AI/embedding** | ✅ GPT-4 / Claude 等 |
| **与设想的相似度** | ★★☆☆☆ Notion AI 可以回答关于你 workspace 的问题（Q&A），但它不会在写作时**自动**推送相关内容到侧边栏——你需要主动提问 |
| **缺口** | ① 无"写作时被动推送"机制；② 云端处理，隐私性较弱；③ 以页面为单位，无段落级推荐 |

Notion 最近推出了 **"Q&A"** 功能可以搜索整个 workspace（包括连接 Slack/Google Drive），但仍然需要用户主动提问。Notion Agent 可以执行多步骤任务，但并非"边写边推"的范式。

---

## 6. Mem

| 项目 | 内容 |
|---|---|
| **名称** | Mem（Heads Up 功能） |
| **链接** | https://help.mem.ai/features/heads-up |
| **维护状态** | ✅ 官方核心功能，持续更新，付费产品 |
| **交互方式** | **Heads Up**——打开或创建笔记时，自动在右侧面板展示相关笔记，分为 Meeting Timeline（时间线）、Related Topic Bundle（主题包）等；支持 Find More 扩展结果、Briefings（会议前自动摘要）、Heads Up Live（会议中主动推送） |
| **是否本地运行** | ❌ 云端，Pinecone 向量数据库 + LLM |
| **是否使用 AI/embedding** | ✅ Pinecone 向量搜索 + LLM 管道 |
| **与设想的相似度** | ★★★★★ **最接近设想的商业产品**——被动、实时、自动在侧边栏推送相关内容 |
| **缺口** | ① 以"整篇笔记"为单位，非段落/句子级；② 云端运行，非本地；③ 付费 SaaS（$8.33/月起）；④ 需要将数据存在 Mem 平台，无法用于本地 Markdown 仓库 |

Mem 的 Heads Up 是目前最符合"写作时主动上下文召回"这一设想的商业产品。"Like a friendly tap on the shoulder"是它的设计哲学。但 Mem 是一个封闭平台（不能像 Obsidian 那样管理本地文件），且推荐粒度是整篇笔记而非段落。

---

## 7. Reflect

| 项目 | 内容 |
|---|---|
| **名称** | Reflect Notes AI |
| **链接** | https://reflect.app/ |
| **维护状态** | ✅ 付费产品，活跃开发中 |
| **交互方式** | ① AI 调色板（选中文本后做总结/改写/提取要点等）；② Chat with Notes（对话式查询全量笔记）；③ 自动生成 backlinks；④ 图级 AI 理解（2025-09 发布） |
| **是否本地运行** | ❌ 云端（端到端加密，但 AI 处理在云上） |
| **是否使用 AI/embedding** | ✅ GPT-4 / Whisper / Claude |
| **与设想的相似度** | ★★★☆☆ Reflect 2025 年 9 月发布了"图级 AI"，声称是首个 AI 理解整个 note graph 的工具。但它的推荐仍然是通过 Chat 互动触发，而非写作中被动推送 |
| **缺口** | ① 无自动侧边栏推送；② 需要主动 Chat 或选中文本调用 AI；③ 云端处理 |

Reflect 的优势在于端到端加密和类似 Apple Notes 的简洁体验，但它在"主动上下文召回"方面不如 Mem 激进。

---

## 8. Tana

| 项目 | 内容 |
|---|---|
| **名称** | Tana Outliner（原 Tana） |
| **链接** | https://outliner.tana.inc/ |
| **维护状态** | ✅ 付费产品，正在转型（公司重心转向 Tana 会议平台） |
| **交互方式** | ① AI Chat 侧边栏——按 Space 在任何 node 上开始对话，可 @ 引用特定 node；② Supertag 系统自动结构化数据；③ Search 面板 |
| **是否本地运行** | ❌ 云端 |
| **是否使用 AI/embedding** | ✅ |
| **与设想的相似度** | ★☆☆☆☆ Tana 的 AI Chat 只能与**选中的 node** 对话，不支持全 workspace 上下文（官方承认"requires a different approach entirely"） |
| **缺口** | ① 无"全 workspace 语义推荐"（有 feature request 但未实现）；② AI 交互需要主动触发；③ 公司重心转向 Tana 会议平台，Outliner 产品未来的投入存疑 |

Tana 社区有明确的 feature request 要求"AI Related Nodes + GPT Copilot Panel"（在写作时自动推测并展示相关 node），以及"AI chat with the whole workspace as context"，但截至 2026 年 7 月尚未实现。

---

## 9. 总结：产品机会分析

### 是否已有成熟实现？

| 指标 | 判断 |
|---|---|
| **写作时被动推送** | ⚠️ **半成熟**——Mem Heads Up 实现了，但粒度粗（整篇笔记）；Obsidian 的 Smart Connections 和 Semantic Backlinks 也做到了，但在逐句级上有限 |
| **段落/句子级召回** | ❌ **无成熟实现**——Semantic Backlinks 显示 snippet 预览是最接近的，但推荐仍然以笔记为单位 |
| **纯本地运行** | ✅ Obsidian 生态有多款本地方案，但它们在逐句实时性上不如云端产品 |
| **跨平台闭源工具** | ✅ Mem 的 Heads Up 体验最好，但数据锁定在平台内 |

### 仍然存在的产品机会

1. **段落级（sub-note）实时召回**：目前所有工具都以"整篇笔记"为单位做推荐。如果一个笔记包含多个主题（常见的长笔记），当前技术只能将其视作一个向量。机会：将笔记切割为语义段落/块，对用户正在输入的句子做实时 embedding，匹配最相关的段落。

2. **输入过程中实时刷新（非保存后/切换后刷新）**：大部分插件在"切换笔记"或"保存文件"时触发更新。真正的"边写边推"需要对 editor 的 change 事件做 debounced embedding 查询，目前只有 Obsidian Insights 有增量刷新机制。

3. **混合召回 + 显式区分来源类型**：将词法匹配（精确标题、标签）、语义匹配（embedding cosine similarity）、结构匹配（backlinks、相同父文件夹）综合排序，并在 UI 上区分标注。Semantic Backlinks 做了词法+语义混合，但其他维度未覆盖。

4. **不依赖外部 embedding 服务的段落级实时引擎**：可以用 Transformers.js + 小型 embedding 模型（如 all-MiniLM-L6-v2）在浏览器内完成，无需 Ollama 等外部进程。Smart Related Notes 已经证明了 WASM 路径可行，但它只在切换笔记时计算。

5. **"参考线"式 UI 而非侧边栏**：Sidekick 做了一种有趣的交互——在正文中下划线提示可能的链接。可以更进一步：在段落旁边显示淡化的参考标记，悬停时展开 snippet 预览。

6. **针对中文的优化**：大多数 embedding 模型以英文为主。虽然 bge-m3 和 Qwen3-Embedding 支持中文，但"中文写作时的实时片段召回"这个场景几乎没有被专门设计过。

### 最终判断

> **这个想法还没有一个完全成熟的产品实现。**
>
> 最接近的三款是 Mem（体验最好但封闭/云端/粗粒度）、Smart Connections（生态最大但整篇级）、Semantic Backlinks（交互最精准但需要外部进程且较新）。
>
> **2026 年值得关注的新入局者**：**Link Link!**（2026-06 发布）的 Selection Mode 允许用户选中任意段落做语义搜索，是段落级匹配的重要探索——目前仍需手动触发，但方向正确。
>
> **最大产品缺口**：在 Obsidian 生态中，缺少一个结合了 Semantic Backlinks 的交互范式（内联弹窗 + 侧边栏）、Smart Related Notes 的纯本地 WASM embedding / Link Link! 的段落级 Selection Mode、以及真正自动化（无需手动选中）的实时段落级语义切分的插件。这个组合可以真正做到"用户输入每个句子时，侧边栏和弹窗精确推荐最相关的知识库段落"。
