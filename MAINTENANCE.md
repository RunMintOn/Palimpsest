# 维护与操作

所有命令从项目根目录运行。代码真相源是 `src/`；`main.js` 是由构建生成的
Obsidian 产物，不直接修改。

## 验证

首次安装依赖或锁文件变化后运行：

```powershell
npm ci
```

提交前运行：

```powershell
npm run typecheck
npm test
npm run build
```

需要运行单个测试文件时直接调用 `tsx`：

```powershell
npx tsx --test test/core.test.ts
```

构建从 `src/main.ts` 生成 `main.js`，并检查没有重复打包 Obsidian 提供的
CodeMirror runtime。

## 测试 Vault

`test-vault/.obsidian/plugins/palimpsest` 已是指向项目根目录的 Windows
Junction，因此不需要复制构建产物。运行构建后，测试 Vault 会直接看到
根目录的 `main.js`、`manifest.json` 和 `styles.css`：

```powershell
npm run build
(Get-Item .\test-vault\.obsidian\plugins\palimpsest).Target
```

第二条命令应指向项目根目录。不要把这个 Junction 当作普通目录删除或
覆盖；测试 Vault 只用于独立验收，不要替换为用户 Vault。当前清单要求
Obsidian `1.12.0` 或更高；`obsidian` 类型依赖约为 `1.12.3`。类型依赖
不代表实际运行时版本，升级或更换 Obsidian 后应重新做手工验证。

## Ollama 配置与验证

插件默认配置定义在 `src/settings.ts`；Obsidian 中已保存的插件设置覆盖
代码默认值。`OLLAMA_MODELS` 只决定 Ollama 模型文件的存储目录，不改变
插件 endpoint 或模型设置。

确认本机服务和模型：

```powershell
Invoke-RestMethod http://127.0.0.1:11434/api/version
ollama list
```

真实 provider smoke test 会读取 `test-vault` fixture 并调用 Ollama：

```powershell
npx tsx scripts/smoke-ollama.ts
py scripts/verify-ollama-embedding.py
```

`/api/embed` 对空输入或缺少 `input` 可能返回 HTTP 200 和空
`embeddings`；验证成功时必须同时检查向量数量、维度和有限数值。

## 索引数据与恢复

- 插件设置通过 Obsidian 的 `loadData`/`saveData` 保存；向量索引存放在
  IndexedDB `palimpsest-index-v1`，按 `.obsidian/palimpsest/vault-id.json`
  中的稳定 Vault UUID 隔离。
- 旧 `data.json` 中的向量索引不迁移；首次使用 IndexedDB 或清除本地索引后，
  必须执行全量建立索引。
- 清除 Obsidian 应用数据可能删除索引，但不会删除 Markdown；重新建立索引
  即可恢复。
- 修改模型、维度或切分身份后，旧索引不会混用，必须全量重建。
- 排除目录设置先保存为期望范围；当前索引保持原生效范围，直到应用范围变化
  或全量重建成功。
- 全量重建先写候选 generation，成功发布后才替换当前索引；取消、失败或
  Ollama 不可用时，旧索引继续可查询。

出现“恢复上一代索引”的提示时，结果来自 previous generation；先完成一次
成功的全量重建，再依赖增量更新。

## 发布 beta 版本

版本号需要同时更新 `manifest.json` 和 `package.json`，并使用三段式 SemVer。
`main.js` 不提交到仓库；GitHub Actions 会在推送与版本号完全一致的 tag 后，
自动执行检查、测试、构建，并创建带有以下文件的 GitHub Release：

```text
main.js
manifest.json
styles.css
```

发布流程：

```powershell
npm run typecheck
npm test
npm run build
git tag 0.1.0
git push origin 0.1.0
```

将示例版本替换为实际版本。tag 必须与两个 JSON 文件中的 `version` 完全一致，
不要只改其中一个。Release 创建后，测试者可以通过 BRAT 安装该版本。

## 提交时同步 Windows 插件目录

仓库包含一个可追踪的 `.githooks/pre-commit`。启用后，每次提交会先运行
`npm run build`，再调用 `scripts/sync-to-windows.sh`，把最新的
`main.js`、`manifest.json` 和 `styles.css` 同步到 Windows 插件目录，同时保留
目标目录中的 `data.json`。

在当前工作区启用一次：

```bash
git config core.hooksPath .githooks
```

如果临时没有 Windows 目标目录，只有在明确确认不需要同步时才跳过：

```bash
PALIMPSEST_SKIP_WINDOWS_SYNC=1 git commit ...
```

这个 hook 只负责构建和同步，不代替提交前的类型检查和测试。
