# Ollama / Qwen3 Embedding 环境验证报告

- 验证时间：2026-07-24（本机本地时间）
- 工作目录：`D:\15_dev\obsdn-side-grep`
- 范围：仅 Ollama 安装、模型准备与本地 embedding API 验证；未开发 Obsidian 插件。
- 安全确认：未修改任何 Obsidian vault 或 Smart Connections；未更新驱动、BIOS；未重启；未创建 git commit。

## 1. 系统与硬件

| 项目 | 实测值 |
|---|---|
| Windows | Windows 11 家庭中文版，10.0.26200，64 位 |
| CPU | AMD Ryzen 7 8845H w/ Radeon 780M Graphics（8 核 / 16 线程） |
| 物理内存 | 31.29 GiB |
| NVIDIA GPU | NVIDIA GeForce RTX 4060 Laptop GPU，`nvidia-smi` 实测 8188 MiB 显存，驱动 572.83 / CUDA 驱动 12.8 |
| AMD GPU | AMD Radeon 780M Graphics（集成显卡；Windows WMI 报告 512 MiB 专用显存） |
| Intel GPU | 未检测到 |
| 其他显示设备 | GameViewer Virtual Display Adapter |

Ollama 启动日志检测到了 NVIDIA CUDA（compute capability 8.9，加载前可用显存约 6.9 GiB）。AMD ROCm 路径记录“驱动过旧 / gfx1103 无对应 rocBLAS 支持”，因此被丢弃；**未按安全要求更新 AMD 驱动**。集成 AMD Vulkan GPU 也未启用。实际 embedding 推理使用 NVIDIA GPU，证据见第 7 节。

## 2. Ollama 安装与服务状态

- 安装前：未安装 `ollama`，`127.0.0.1:11434` 拒绝连接，无 Windows `ollama` 服务。
- 官方资料：Ollama Windows 文档推荐 `OllamaSetup.exe`，说明其按用户安装、无需管理员权限，并默认在 `http://localhost:11434` 提供 API。
- 安装方式：从 `https://ollama.com/download/OllamaSetup.exe` 下载。该官方 URL 重定向至 Ollama GitHub Release 的 Azure 发布资产；安装包 Authenticode 签名有效，签名者为 `Ollama Inc.`（DigiCert 颁发）。使用官方 Inno Setup 安装器的静默用户级参数安装，未提权、未请求重启。
- 安装器版本 / Ollama 版本：`0.32.3`。
- 安装路径：`C:\Users\l3e\AppData\Local\Programs\Ollama\`。
- 当前运行方式：`ollama serve` 正在本机 PID 31912 运行，`GET /api/version` 返回 `{"version":"0.32.3"}`。这是用户级应用进程，不是 Windows Service，故 `Get-Service ollama` 无条目。
- 模型存储：用户环境变量 `OLLAMA_MODELS=D:\OllamaModels`；服务日志已确认该值。模型文件现位于 D 盘。

## 3. 模型状态

执行目标命令：

```powershell
ollama pull qwen3-embedding:0.6b
```

| 项目 | 实测值 |
|---|---|
| 实际模型名 | `qwen3-embedding:0.6b` |
| 模型 ID / digest 前缀 | `ac6da0dfba84` |
| `ollama list` 显示大小 | 639 MB |
| D 盘模型目录实际占用 | 639,151,388 bytes（609.54 MiB） |
| 格式 / 架构 | GGUF / qwen3 |
| 参数量 | 595.78M |
| 量化 | `Q8_0` |
| 上下文窗口 | 32,768 |
| 默认 embedding 维度 | 1024 |
| Ollama capabilities | 包含 `embedding`（不是普通生成模型） |

模型库的官方页面也列出该精确 tag、639 MB、32K context，并将其描述为 text embedding 模型。没有替换为其他模型。

## 4. 已验证 API

依据 Ollama 当前官方 API 文档，使用：

```text
POST http://127.0.0.1:11434/api/embed
Content-Type: application/json
```

### 文档批量建库请求示例

```json
{
  "model": "qwen3-embedding:0.6b",
  "input": [
    "Obsidian 可以用于管理本地 Markdown 知识库。",
    "知识管理软件能够组织本地笔记。"
  ],
  "keep_alive": "5m"
}
```

### 查询请求示例（插件建议手工加 instruction）

```json
{
  "model": "qwen3-embedding:0.6b",
  "input": "Instruct: Given a Chinese note search query, retrieve relevant passages from a local Markdown knowledge base.\nQuery:中文短文本的语义向量检索。",
  "keep_alive": "5m"
}
```

删减后的成功响应结构如下；`total_duration` 与 `load_duration` 单位均为纳秒：

```json
{
  "model": "qwen3-embedding:0.6b",
  "embeddings": [[0.0123, -0.0456]],
  "total_duration": 178407400,
  "load_duration": 0
}
```

上例的 embedding 数组仅保留前两个数以展示结构；实测完整默认向量为 1024 个数值。

## 5. 中文 API 与向量验证

测试了单条和批量中文输入：

1. `Obsidian 可以用于管理本地 Markdown 知识库。`
2. `知识管理软件能够组织本地笔记。`
3. `烤箱烘焙面包时需要控制温度。`
4. `中文短文本的语义向量检索。`

结果：

- 单条请求：HTTP 200，向量非空、1024 维、全部为有限数值，L2 norm = 0.99999980。
- 批量请求：HTTP 200，返回 4 个向量；每个均 1024 维、非空、有限。实测 L2 norm 范围约为 0.99999988–1.00000022。
- `dimensions: 512`：HTTP 200，返回非空 512 维有限向量，L2 norm = 1.00000007。因此本模型经 Ollama API 已实测支持缩短至 512 维。
- 空输入 `"input": ""`：HTTP 200，但 `embeddings: []`，不是错误响应。
- 缺少 `input` 的请求：HTTP 200，但同样返回 `embeddings: []`。

因此插件必须自行检查 `embeddings` 数量是否等于输入数量，不能只以 HTTP 200 作为成功条件。

### Cosine sanity check（非正式质量评测）

使用原始三句文本向量和标准 cosine 公式：

| 比较 | cosine similarity |
|---|---:|
| 第一句 vs 第二句（语义相关） | **0.626030** |
| 第一句 vs 第三句（烘焙，无关） | **0.235246** |

相关文本明显更高，sanity check 通过。Ollama 官方 embedding 文档说明 `/api/embed` 返回 L2-normalized unit vectors；本机范数也验证了这一点。

## 6. 轻量延迟基线

计时范围：Python `perf_counter` 覆盖**完整本地 HTTP POST、响应等待与响应体读取**，因此包含 HTTP client 开销；不是理论 token/s，也不是大规模 benchmark。

基线输入为约 50 个中文字符（外加 `Obsidian` 和 `Markdown`）：

> Obsidian 本地语义检索插件需要快速处理中文 Markdown 笔记内容，自动生成检索向量并返回最相关的知识片段，帮助用户定位历史笔记记录。

先以 `keep_alive: "0"` 请求并通过 `/api/ps` 确认为空，随后测量第一次冷请求；之后保持 `keep_alive: "5m"`，连续请求 10 次。

| 指标 | 实测值 |
|---|---:|
| 冷请求端到端 HTTP 耗时 | **2706.32 ms** |
| 冷请求 API `total_duration` | 2682.52 ms |
| 冷请求 API `load_duration` | 2636.55 ms |
| 预热 10 次逐次端到端耗时（ms） | 137.02, 146.86, 159.49, 149.33, 132.61, 150.73, 151.18, 150.23, 153.55, 129.79 |
| 预热 P50 | **149.33 ms** |
| 预热 P95 | **159.49 ms** |
| 预热最大值 | **159.49 ms** |

P50/P95 使用 nearest-rank 计算；样本只有 10 个，所以 P95 等于最大值。

### 资源与 GPU 观察

模型保持加载时：

- `/api/ps` 报告 `size_vram=2,370,652,077` bytes（约 2.21 GiB），且 `context_length=4096`。
- `llama-server.exe`：Working Set 581.0 MiB、Private Memory 3101.4 MiB；Ollama 主进程 Working Set 73.0 MiB、Private Memory 119.2 MiB。
- NVIDIA 全卡快照：4536 / 8188 MiB 已用、利用率 7%。该值包含其它桌面进程；以 `/api/ps` 的 `size_vram` 和启动日志中的 `library=CUDA` 作为 Ollama GPU 使用的直接证据。
- NVIDIA 的 per-process 显存查询受当前权限限制，不能可靠分配全卡已用显存给每个进程；报告未将 4536 MiB 全部归因于 Ollama。

服务日志明确记录：`inference compute ... library=CUDA ... NVIDIA GeForce RTX 4060 Laptop GPU`，并以 `--embedding` 启动 `llama-server.exe`，所以本次实际使用 RTX 4060，而非 CPU-only 或 AMD iGPU。

### 空闲卸载 / keep_alive

- 默认服务配置：`OLLAMA_KEEP_ALIVE=5m0s`。
- `keep_alive: "5m"` 时，`/api/ps` 显示已加载模型及 5 分钟左右的 `expires_at`。
- 额外实测 `keep_alive: "2s"`：请求后模型在 `/api/ps` 中存在；等待 4 秒后 `/api/ps` 为 `{"models":[]}`，`llama-server.exe` 退出，GPU 快照降至 2167 / 8188 MiB。
- `keep_alive: "0"` 也已实测可在请求后卸载模型，适合作为显式释放显存的参数。

## 7. Qwen3 Embedding 调用结论

| 问题 | 结论 |
|---|---|
| Query 要不要 instruction | **推荐要。**Qwen 官方 Qwen3-Embedding README 建议每个 retrieval query 加一句任务 instruction，称多数下游任务通常提升约 1%–5%；多语言场景建议使用英文 instruction。 |
| Document 要不要 instruction | **不要。**Qwen 官方示例明确表示 retrieval documents 不需要 instruction。 |
| Ollama 是否自动添加 instruction | **否，未发现自动添加。**本机 `ollama show --modelfile` 输出为 `TEMPLATE {{ .Prompt }}`，只透传 Prompt；`/api/embed` 官方 schema 也没有 `instruction` 或 `text_type` 字段。客户端必须手工将 query 组成 `Instruct: ...\nQuery:{query}`。 |
| 文档批量与 query 调用是否不同 | HTTP endpoint 相同，都是 `/api/embed`，也都支持 `input` string 或 string array。差别在客户端输入格式：文档批量传原文数组；query 应单独传带 instruction 的格式化文本（或同一 instruction 的 query 批）。不要将未加 instruction 的 documents 和带 instruction 的 queries 混在同一批次。 |
| 可否调整输出维度 | **支持。**Ollama API 有 `dimensions` 字段；Qwen3-Embedding-0.6B 官方资料称支持 32–1024 维。本机已成功实测 `dimensions: 512`。新索引建议先采用默认 1024；一旦建库，不可混用维度。 |
| cosine 前是否必须显式归一化 | 对此 Ollama endpoint **不必**：官方文档称输出为 L2-normalized，实测范数约为 1。但 cosine 实现仍应使用 `dot/(norm(a)*norm(b))` 或在接入其他 provider 时归一化，以避免假设被破坏。 |

## 8. 给后续 Obsidian 插件的建议参数

```text
URL        http://127.0.0.1:11434/api/embed
model      qwen3-embedding:0.6b
文档       input: string[]（原始 Markdown chunk；按合理批次发送）
查询       input: "Instruct: Given a Chinese note search query, retrieve relevant passages from a local Markdown knowledge base.\nQuery:{用户查询}"
维度       默认 1024（索引元数据固定记录此值）
keep_alive "5m"（交互检索）；需要立即释放显存时使用 "0"
校验       HTTP 200 后仍验证 embeddings 数量、每个向量维度和 finite 数值
相似度     cosine；当前输出已经是单位向量
```

不要使用普通 Qwen 对话模型替代此 embedding 模型；不要假设空输入会由服务端返回 HTTP error。

## 9. 遇到的问题与处理

1. 官方 Windows 安装包 v0.32.3 为 1,562,770,448 bytes（包含多 GPU 运行库），直连下载初始速度约 0.2–0.55 MiB/s；改用现有本地代理后分段实测约 4.86–10.20 MiB/s。下载中一次 TLS `missing close_notify`（curl exit 56）发生在已保存 1.14 GiB 后；只进行了一次显式断点续传，随后验证完整长度和有效 Authenticode 签名。
2. 首次使用不适用于 Inno Setup 的 `/S` 参数，未在非交互环境完成；识别安装器类型后改用 Inno Setup 静默参数。安装日志确认无重启要求且安装成功。外层工具等待常驻应用而超时，但不是安装仍在执行。
3. 安装器启动的初始服务没有继承刚设置的 `OLLAMA_MODELS`，模型先落在默认 C 盘。已停止 Ollama 进程、按字节数校验后将完整模型存储移动至 `D:\OllamaModels`，以显式 D 盘环境重启服务；没有重新下载模型。当前服务日志确认 `OLLAMA_MODELS:D:\OllamaModels`。
4. `ollama pull` 的终端 spinner 在 manifest 阶段不显示大小，但服务日志确认下载完成。模型现在已由 `ollama list` 和 `/api/tags` 验证。
5. 空输入和缺少 `input` 返回 HTTP 200 加空数组，验证脚本已显式覆盖此行为。
6. AMD 驱动兼容性警告仅记录，未按要求更新驱动；NVIDIA CUDA 已正常可用。

## 10. 资料来源

- Ollama Windows 安装文档：<https://docs.ollama.com/windows>
- Ollama Embed API：<https://docs.ollama.com/api/embed>
- Ollama Embeddings capability（L2-normalized 说明）：<https://docs.ollama.com/capabilities/embeddings>
- Ollama 模型库：<https://ollama.com/library/qwen3-embedding:0.6b>
- Qwen 官方 Qwen3-Embedding README（instruction、document、归一化、MRL）：<https://github.com/QwenLM/Qwen3-Embedding>
- Qwen 官方 0.6B 模型卡（1024 维及 32–1024 MRL 范围）：<https://huggingface.co/Qwen/Qwen3-Embedding-0.6B>

## 附件

轻量、零第三方依赖的复核脚本：

```text
scripts/verify-ollama-embedding.py
```

它调用 `/api/embed`、验证单条/批量/空输入/缺输入、检查维度和有限数、计算 cosine，并输出冷请求与 10 次预热请求的 HTTP 端到端延迟。
