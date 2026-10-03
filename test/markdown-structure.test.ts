import assert from "node:assert/strict";
import test from "node:test";
import { chunkMarkdown, embeddingText } from "../src/chunker";

const options = { targetLength: 650, maxLength: 1100, minLength: 1 };

for (const [opening, inside, closing] of [
  ["```js", "# 注释\n~~~\n# 仍是注释", "````"],
  ["  ~~~~ lang", "### 注释\n~~~\n~~~ trailing\n# 仍是注释", "   ~~~~~"],
  ["````", "```\n# 注释", "````"],
  ["~~~", "# 未闭合的代码注释", ""],
]) {
  test(`fence matching preserves code and original positions: ${opening}`, () => {
    const code = [opening, inside, closing].filter(Boolean).join("\n");
    const text = `---\nsecret: HIDDENYAML\n...\n   ## 章节\n\n${code}`;
    for (const source of [text, text.replace(/\n/g, "\r\n")]) {
      const chunks = chunkMarkdown("fixture.md", source, options);
      assert.equal(chunks.length, 1);
      assert.equal(chunks[0].text, code);
      assert.deepEqual(chunks[0].breadcrumb, ["章节"]);
      assert.equal(chunks[0].startLine, 6);
      assert.equal(chunks[0].endLine, text.split("\n").length);
      assert.doesNotMatch(embeddingText(chunks[0]), /HIDDENYAML/);
    }
  });
}

test("Setext and ATX headings form defined breadcrumbs and retain literal trailing hashes", () => {
  const chunks = chunkMarkdown("fixture.md", "顶层标题\n===\n\n第一段正文\n\n子章节\n  ---\n\n第二段正文\n\n   ### 跳级###\n\n第三段正文\n\n##\n\n空标题后的正文", options);
  assert.deepEqual(chunks.map(c => c.breadcrumb), [["顶层标题"], ["顶层标题", "子章节"], ["顶层标题", "子章节", "跳级###"], ["顶层标题"]]);
  assert.deepEqual(chunks.map(c => c.text), ["第一段正文", "第二段正文", "第三段正文", "空标题后的正文"]);
  assert.deepEqual(chunks.map(c => c.startLine), [4, 9, 13, 17]);
});

test("isolated underlines, unclosed frontmatter and invalid backtick info remain content", () => {
  const body = "---\n\n===\n\n```bad`info\n\n普通正文";
  const [chunk] = chunkMarkdown("fixture.md", body, options);
  assert.equal(chunk.text, body);
  assert.deepEqual(chunk.breadcrumb, []);
});

test("long fenced content preserves newlines and whitespace while respecting chunk budgets", () => {
  const code = "~~~\n# CODEANCHOR\n" + "abc def\n".repeat(30) + "~~~";
  const chunks = chunkMarkdown("fixture.md", code, { targetLength: 50, maxLength: 60, minLength: 1 });
  assert.ok(chunks.every(c => c.text.length <= 60));
  assert.equal(chunks.map(c => c.text).join(""), code);
  assert.ok(chunks.every(c => c.breadcrumb.length === 0));
});

test("regrouping long code fragments does not insert blank lines into the source", () => {
  const code = "~~~\n" + "x".repeat(120) + "\n~~~";
  const chunks = chunkMarkdown("fixture.md", code, { targetLength: 50, maxLength: 60, minLength: 1 });
  assert.ok(chunks.every(c => c.text.length <= 60));
  assert.equal(chunks.map(c => c.text).join(""), code);
});

test("fenced heading-like code remains searchable content without changing the next paragraph's breadcrumb", () => {
  const code = "```python\n# CODEANCHOR 这是代码注释\nprint(123)\n```";
  const text = `# 真正章节\n\n开头正文\n\n${code}\n\n后续正文`;
  const chunks = chunkMarkdown("fixture.md", text, options);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].text, `开头正文\n\n${code}\n\n后续正文`);
  assert.deepEqual(chunks[0].breadcrumb, ["真正章节"]);
  assert.equal(chunks[0].startLine, 3);
  assert.equal(chunks[0].endLine, 10);
  assert.match(embeddingText(chunks[0]), /标题：真正章节\n原文：/);
});
