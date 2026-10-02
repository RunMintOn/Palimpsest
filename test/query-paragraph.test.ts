import assert from "node:assert/strict";
import test from "node:test";
import { currentQuerySelection, QuerySourceCoordinator, sameQueryParagraph } from "../src/query-source";
import { queryBufferIsCurrent, queryResponseDisposition, type QueryRequestState } from "../src/query-response-disposition";

test("default query uses the complete current paragraph rather than the document", () => {
  const source = new QuerySourceCoordinator();
  const paragraph = "当前段落的完整内容。".repeat(200) + "\n同一段的第二行也需要参与查询。";
  const buffer = `# 标题\n\n前面另一段的有效查询文本。\n\n${paragraph}\n\n最后另一段的有效查询文本。`;
  assert.deepEqual(source.sourceForCurrentSelection(buffer, "", 5), {
    kind: "paragraph", text: paragraph, startLine: 4
  });
});

test("blank lines, headings, and absent reading-view cursors never fall back to the document", () => {
  const source = new QuerySourceCoordinator();
  const buffer = "正文段落包含足够的查询文字。\n\n# 章节标题\n下一段也包含足够的查询文字。\n\nSetext title\n===\n标题之后的有效查询段落。";
  for (const line of [1, 2, 5, 6, undefined]) {
    const candidate = source.sourceForCurrentSelection(buffer, "", line);
    assert.equal(candidate?.text, "", `line ${line} must not query surrounding prose`);
  }
  assert.deepEqual(source.sourceForCurrentSelection(buffer, "", 3), {
    kind: "paragraph", text: "下一段也包含足够的查询文字。", startLine: 3
  });
  assert.deepEqual(source.sourceForCurrentSelection(buffer, "", 7), {
    kind: "paragraph", text: "标题之后的有效查询段落。", startLine: 7
  });
});

test("moving to another paragraph discards an in-flight response even with the same buffer", () => {
  const state = {
    automaticWorkAllowed: true, generationCurrent: true, bufferCurrent: true,
    markdownViewCurrent: true, pathCurrent: true, selectionCurrent: true,
    paragraphCurrent: false
  };
  assert.equal(queryResponseDisposition(state), "discard");
});

test("same-paragraph cursor moves keep the query, but identical text in another paragraph does not", () => {
  const source = new QuerySourceCoordinator();
  const buffer = "相同的有效段落文本。\n第二行文本。\n\n相同的有效段落文本。\n第二行文本。";
  const first = source.sourceForCurrentSelection(buffer, "", 0)!;
  const same = source.sourceForCurrentSelection(buffer, "", 1)!;
  const other = source.sourceForCurrentSelection(buffer, "", 3)!;
  assert.equal(sameQueryParagraph(first, same), true);
  assert.equal(sameQueryParagraph(first, other), false);
});

test("an empty or short paragraph resets a one-shot label without using surrounding text", () => {
  const source = new QuerySourceCoordinator();
  const action = source.selectionButton("足够长的显式选区查询文本");
  assert.equal(action.kind, "one-shot");
  if (action.kind === "one-shot") source.adopt(action.source);
  const candidate = source.sourceForCurrentSelection("其他段落有足够的查询文本。\n\n短句", "", 2)!;
  assert.equal(candidate.text, "短句");
  assert.equal(source.presentation("").kind, "once", "candidate lookup does not publish a new scope");
  source.adopt(candidate);
  assert.deepEqual(source.presentation(""), {
    kind: "paragraph", text: "查询范围：当前段落 · 等待至少 8 个非空白字符", tooltip: "开启跟随选区查询"
  });
});

test("the old paragraph response cannot publish after the second paragraph finishes first", async () => {
  const source = new QuerySourceCoordinator();
  const buffer = "第一段请求稍后完成的有效文本。\n\n第二段先完成的有效查询文本。";
  const first = source.sourceForCurrentSelection(buffer, "", 0)!;
  let current = first;
  let finishFirst!: () => void;
  const firstFinished = new Promise<void>(resolve => { finishFirst = resolve; });
  const results: string[] = [];
  const publish = (scheduled: typeof first) => {
    const request: QueryRequestState = {
      automaticWorkAllowed: true, generationCurrent: true, bufferCurrent: true,
      markdownViewCurrent: true, pathCurrent: true, selectionCurrent: true,
      paragraphCurrent: sameQueryParagraph(scheduled, current)
    };
    if (queryResponseDisposition(request) === "apply") results.push(scheduled.text);
  };
  const oldResponse = firstFinished.then(() => publish(first));
  current = source.sourceForCurrentSelection(buffer, "", 2)!;
  publish(current);
  finishFirst();
  await oldResponse;
  assert.deepEqual(results, ["第二段先完成的有效查询文本。"]);
});

test("reading view never borrows the hidden editor selection", () => {
  assert.equal(currentQuerySelection("不可见的旧编辑器选区", undefined, true), "");
  assert.equal(currentQuerySelection("不可见的旧编辑器选区", "", true), "");
  assert.equal(currentQuerySelection("不可见的旧编辑器选区", "实际阅读视图选区", true), "实际阅读视图选区");
});

test("reading-view selections do not depend on the hidden editor buffer finishing loading", () => {
  assert.equal(queryBufferIsCurrent("selection-once", true, "旧编辑器内容", ""), true);
  assert.equal(queryBufferIsCurrent("selection-follow", true, "旧编辑器内容", "新编辑器内容"), true);
  assert.equal(queryBufferIsCurrent("selection-once", false, "旧编辑器内容", "新编辑器内容"), false);
  assert.equal(queryBufferIsCurrent("paragraph", true, "旧编辑器内容", ""), false);
});

test("CRLF paragraphs preserve their content and headings delimit adjacent prose", () => {
  const source = new QuerySourceCoordinator();
  assert.deepEqual(source.sourceForCurrentSelection("前一段的完整查询文本。\r\n## 新章节\r\n  当前段落文本。\r\n第二行也参与查询。  ", "", 3), {
    kind: "paragraph", text: "当前段落文本。\n第二行也参与查询。", startLine: 2
  });
});
