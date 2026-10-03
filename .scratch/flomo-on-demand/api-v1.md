# retrievalApi v1

共同范围以 [spec](spec.md) 为准。类型见 `src/text-query-api.ts`；Flomo 只声明消费端的结构类型，不依赖 Palimpsest 源码或共享运行时包。

```ts
const api = app.plugins.plugins.palimpsest?.retrievalApi;
if (api?.apiVersion !== 1) throw new Error("Palimpsest 未启用或接口版本不支持");
const response = await api.query({
  text: "关键词和语义向量一起检索旧笔记",
  sourcePath: "Flomo/当前记录.md",
  candidatePaths: ["Flomo/旧记录.md", "Flomo/其他记录.md"],
  limit: 5
});
```

`app.plugins` 是 Obsidian 非公开类型边界，只在 Flomo 的 `discoverRetrievalApi()` 中适配；以上例子用于说明调用。每次手动请求重新发现实例。

成功示例：

```json
{
  "ok": true,
  "results": [{
    "filePath": "Flomo/旧记录.md",
    "excerpt": { "text": "**关键词**与向量召回的原文", "startLine": 6, "endLine": 8 }
  }],
  "knownPendingUpdates": true
}
```

- 顺序为排名；每文件最多一个最佳片段，不返回分数、向量或 chunk ID。
- 行号从 1 开始，包含端点；位置失效时仍可打开文件。
- `candidatePaths: []` 表示没有候选，不表示全库；来源路径规范化后排除。
- 默认 5 个结果，limit 为 1–20 整数；正文非空，最长 16000 个 JavaScript 字符单位。
- 候选限于正式索引实际覆盖的文件；候选未索引不会自动建库。
- `knownPendingUpdates: false` 不承诺绝对最新。

预期失败为 `{ "ok": false, "code": "index-needed", "message": "请打开 Palimpsest，先建立索引。" }`。稳定 code：

| code | 含义 |
| --- | --- |
| invalid-input | 正文、路径或 limit 无效 |
| index-needed | 尚未建立索引 |
| index-incompatible | 索引与当前配置不兼容 |
| temporarily-unavailable | 更新、卸载或快照／配置变化，需要稍后重试 |
| backend-unavailable | Ollama 连接或关键词后端不可用 |
| query-failed | 其他查询错误 |

插件缺失和版本不支持由 Flomo Adapter 提示。Flomo 还兜底处理意外 Promise rejection，错误不会伪装为空结果。

第一版没有外部索引维护、订阅、自动查询、重连或缓存协议。
