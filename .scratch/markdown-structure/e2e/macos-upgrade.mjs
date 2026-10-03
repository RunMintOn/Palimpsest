import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, basename, join } from 'node:path';
import { cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
const exec = promisify(execFile);
if (!process.argv[2]) throw new Error('Usage: node macos-upgrade.mjs /absolute/experimental/vault /tmp/results.json');
const vault = resolve(process.argv[2]);
if (!vault.endsWith('/16-palimpsest-zg-experiment/experiments/zvec/vault')) throw new Error('Only the independent experimental Vault is supported');
const output = resolve(process.argv[3] ?? join(tmpdir(), 'palimpsest-markdown-upgrade.json'));
const checks = [];
const folder = `Markdown验收-${Date.now()}`;
const paths = { code: `${folder}/代码.md`, setext: `${folder}/章节.md`, stable: `${folder}/普通.md`, query: `${folder}/当前写作.md` };
const codeLine = '# CODEANCHOR 这是围栏内的代码注释，不能成为章节标题。';
const codeBody = `${codeLine}\nprint("查询旧笔记的原文代码片段")\n${'代码内容参与检索，后续正文应该保留真正章节上下文。'.repeat(4)}`;
const sectionBody = 'SETEXTANCHOR 正文属于使用下划线写出的章节标题，检索结果需要展示正确的章节上下文。'.repeat(4);
const pause = ms => new Promise(r => setTimeout(r, ms));
function canonical(snapshot) {
  return { ...snapshot, chunks: [...snapshot.chunks].sort((a,b)=>a.id.localeCompare(b.id)), documents: [...snapshot.documents].sort((a,b)=>a.filePath.localeCompare(b.filePath)) };
}
async function cli(command, ...params) {
  const { stdout } = await exec('obsidian', [`vault=${basename(vault)}`, command, ...params], { timeout: 60000 });
  if (stdout.trim().startsWith('Error:')) throw new Error(stdout);
  return stdout.trim();
}
async function evaluate(body) {
  const raw = await cli('eval', `code=(async()=>{if(app.vault.adapter.getBasePath()!==${JSON.stringify(vault)})throw new Error('Wrong test Vault');const p=app.plugins.plugins.palimpsest;${body}})()`);
  if (!raw.startsWith('=> ')) throw new Error(raw);
  const value = raw.slice(3);
  try { return JSON.parse(value); } catch { return value; }
}
async function wait(body, label, timeout = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const value = await evaluate(body);
    if (value) return value;
    await pause(200);
  }
  throw new Error(`Timed out: ${label}; ${JSON.stringify(await evaluate('return {state:p.state,status:p.getLocalIndexStatus()};'))}`);
}
async function openQuery(line) {
  await cli('open', `path=${paths.query}`, 'newtab');
  await evaluate(`const v=app.workspace.activeLeaf.view;await v.leaf.setViewState({type:'markdown',state:{file:${JSON.stringify(paths.query)},mode:'source'},active:true});await p.activateView();return true;`);
  await wait(`return p.latestMarkdownView?.file?.path===${JSON.stringify(paths.query)} && !!p.latestMarkdownView.editor;`, 'active query editor available');
  await evaluate(`const v=p.latestMarkdownView;v.editor.setCursor({line:${line},ch:0});p.refreshCurrentQuery();return true;`);
}
let passed = false, originalSettings, originalScope, backup;
try {
  // Optional genuine v2 backup lets this same isolated upgrade be repeated after v3 committed.
  if (process.argv[4]) {
    const baseline = resolve(process.argv[4]);
    await evaluate(`const saved=JSON.parse(require('node:fs').readFileSync(${JSON.stringify(join(baseline, 'v2-snapshot.json'))},'utf8'));if(saved.identity.chunkerVersion!=='2')throw Error('Expected genuine v2 baseline');const documents=saved.documents.filter(d=>app.vault.getAbstractFileByPath(d.filePath)).map(d=>({...d,chunks:saved.chunks.filter(c=>c.filePath===d.filePath).map(c=>({...c,embeddingInputHash:c.embeddingInputHash??'v2-fixture',vector:Float32Array.from(c.vector)}))}));await p.indexStore.commit({kind:'replace-all',identity:saved.identity,scope:saved.scope,documents});return true;`);
    await cp(join(baseline, 'plugin/main.js'), join(vault, '.obsidian/plugins/palimpsest/main.js'));
    await cli('plugin:reload', 'id=palimpsest');
  }
  await evaluate('const w=require("@electron/remote").getCurrentWindow();w.show();w.restore();w.focus();app.workspace.rightSplit.expand();await p.activateView();return true;');
  await wait('return !document.hidden && p.automaticWork.allowed && !p.flushingFileUpdates;', 'test window actually visible');
  assert.equal(String(await evaluate('return p.index.identity.chunkerVersion;')), '2', 'Start with installed v2 plugin and ready v2 snapshot');
  assert.equal(await evaluate('return p.getLocalIndexStatus().status;'), 'ready');
  originalSettings = await evaluate('return p.settings;');
  originalScope = await evaluate('return p.getIndexScopeView();');
  backup = await mkdtemp(join(tmpdir(), 'palimpsest-md-e2e-backup-'));
  await cp(join(vault, '.obsidian/plugins/palimpsest'), join(backup, 'plugin'), { recursive: true });
  await evaluate(`await p.activateView();await app.vault.createFolder(${JSON.stringify(folder)});await app.vault.create(${JSON.stringify(paths.code)},${JSON.stringify(`---\nsecret: YAMLPRIVATEANCHOR\n---\n# 真正章节\n\n\`\`\`python\n${codeBody}\n\`\`\`\n\n后续正文仍然属于真正章节。`)});await app.vault.create(${JSON.stringify(paths.setext)},${JSON.stringify(`Setext章节\n===\n\n${sectionBody}`)});await app.vault.create(${JSON.stringify(paths.stable)},${JSON.stringify('# 普通章节\n\n'+'普通笔记的语义没有变化，不需要重新生成查询向量或文档向量。'.repeat(5))});await app.vault.create(${JSON.stringify(paths.query)},${JSON.stringify(`# 当前写作\n\n\`\`\`python\n${codeBody}\n\`\`\`\n\nSetext查询标题\n===\n\n${sectionBody}`)});return true;`);
  await wait(`return ${JSON.stringify(Object.values(paths))}.every(path=>p.index.documentPaths.includes(path)) && !p.flushingFileUpdates;`, 'v2 fixture indexed');
  const before = await evaluate('return {...p.index.serialize(),chunks:p.index.chunks.map(c=>({...c,vector:Array.from(c.vector)}))};');
  await writeFile(join(backup, 'v2-snapshot.json'), JSON.stringify(before));
  assert(before.chunks.some(c => c.filePath === paths.code && c.breadcrumb.some(h => h.includes('CODEANCHOR'))), 'Old fixture actually reproduces the heading bug');
  checks.push({ name: 'real-v2-fixture-reproduces-structure-bug', passed: true });
  await exec('node', ['scripts/install-native-to-vault.mjs', vault], { timeout: 60000 });
  await cli('plugin:reload', 'id=palimpsest');
  await evaluate('await p.activateView();return true;');
  await wait('return p.getLocalIndexStatus().status==="incompatible";', 'v2 preserved and incompatible');
  assert.equal(String(await evaluate('return p.index.identity.chunkerVersion;')), '2');
  assert.equal(await evaluate('return p.state.kind;'), 'index-needed');
  assert.equal(await evaluate('return p.state.indexAction;'), 'rebuild');
  assert.deepEqual(await evaluate('return p.settings;'), originalSettings);
  const snapshot = await evaluate('return {...p.index.serialize(),chunks:p.index.chunks.map(c=>({...c,vector:Array.from(c.vector)}))};');
  assert.deepEqual(canonical(snapshot), canonical(before));
  checks.push({ name: 'upgrade-keeps-data-settings-and-rebuild-prompt', passed: true });
  await evaluate('void p.requestFullIndexBuild();return true;');
  await wait('return !!document.querySelector(".modal");', 'preview opens');
  const preview = await evaluate('return document.querySelector(".modal").textContent;');
  assert(preview.includes('复用'));
  await evaluate('[...document.querySelectorAll(".modal button")].find(b=>b.textContent==="取消").click();return true;');
  await wait('return !p.fullIndexBuildRequests.isActive;', 'cancel settles');
  assert.equal(await evaluate('return p.getLocalIndexStatus().status;'), 'incompatible');
  assert.deepEqual(canonical(await evaluate('return {...p.index.serialize(),chunks:p.index.chunks.map(c=>({...c,vector:Array.from(c.vector)}))};')), canonical(before));
  const durable = await evaluate('const v=await p.indexStore.load();return {status:v.status,identity:v.data.identity,ids:v.data.chunks.map(c=>c.id)};');
  assert.equal(durable.identity.chunkerVersion, '2');
  assert.deepEqual(durable.ids.sort(), before.chunks.map(c => c.id).sort());
  checks.push({ name: 'preview-cancel-keeps-durable-v2-and-incompatible-state', preview, passed: true });
  await evaluate('void p.requestFullIndexBuild();return true;');
  await wait('return !!document.querySelector(".modal");', 'second preview opens');
  await evaluate('document.querySelector(".modal button.mod-cta").click();return true;');
  await wait('return p.index.identity.chunkerVersion==="3" && p.getLocalIndexStatus().status==="ready" && !p.isBuildActive();', 'v3 committed');
  const after = await evaluate('return p.index.chunks.map(c=>({...c,vector:Array.from(c.vector)}));');
  const stableBefore = before.chunks.find(c => c.filePath === paths.stable);
  const stableAfter = after.find(c => c.filePath === paths.stable);
  assert.notEqual(stableBefore.id, stableAfter.id);
  assert.deepEqual(stableBefore.vector, stableAfter.vector);
  assert(after.filter(c => c.filePath === paths.code).every(c => c.breadcrumb.join() === '真正章节'));
  assert(after.some(c => c.filePath === paths.code && c.text.includes(codeLine)));
  assert(after.some(c => c.filePath === paths.setext && c.breadcrumb.join() === 'Setext章节'));
  checks.push({ name: 'confirmed-v3-preserves-unchanged-vector-and-corrects-structure', passed: true });
  await openQuery(3);
  await wait(`return p.state.kind==='complete' && p.results.some(r=>r.filePath===${JSON.stringify(paths.code)});`, 'code paragraph hybrid query');
  assert.deepEqual(await evaluate('return p.retrieval.keywordIds("YAMLPRIVATEANCHOR",20);'), []);
  const result = await evaluate(`return p.results.find(r=>r.filePath===${JSON.stringify(paths.code)});`);
  assert.deepEqual(result.breadcrumb, ['真正章节']);
  assert(result.text.includes(codeLine));
  checks.push({ name: 'code-comment-query-and-YAML-exclusion', passed: true });
  await evaluate(`await p.openResult(p.results.find(r=>r.filePath===${JSON.stringify(paths.code)}));return true;`);
  assert.equal(await evaluate('return app.workspace.getActiveFile().path;'), paths.code);
  assert.equal(await evaluate('return p.latestMarkdownView.editor.getCursor().line;'), result.startLine - 1);
  checks.push({ name: 'source-opens-original-line', passed: true });
  await openQuery(3);
  await wait(`return p.state.kind==='complete' && p.results.some(r=>r.filePath===${JSON.stringify(paths.code)});`, 'query again for quote');
  const quote = await evaluate('const q=document.querySelector(".obsdn-side-grep-summary-quote-action");const d=new DataTransfer();q.dispatchEvent(new DragEvent("dragstart",{dataTransfer:d,bubbles:true}));return d.getData("text/plain");');
  assert(quote.includes('> '));
  await evaluate('document.querySelector(".obsdn-side-grep-summary-quote-action").click();return true;');
  await wait('return p.latestMarkdownView.editor.getValue().includes("> ");', 'quote inserts');
  checks.push({ name: 'real-quote-drag-and-insertion', passed: true });
  await evaluate(`await p.latestMarkdownView.save();await app.vault.modify(app.vault.getAbstractFileByPath(${JSON.stringify(paths.query)}),${JSON.stringify(`# 当前写作\n\n\`\`\`python\n${codeBody}\n\`\`\`\n\nSetext查询标题\n===\n\n${sectionBody}`)});return true;`);
  await pause(1000);
  await openQuery(2);
  await wait('return p.state.kind==="waiting-input" && p.results.length===0;', 'fence separator waits');
  await openQuery(9);
  await wait('return p.state.kind==="waiting-input" && p.results.length===0;', 'Setext underline waits');
  await openQuery(11);
  await wait(`return p.state.kind==='complete' && p.results.some(r=>r.filePath===${JSON.stringify(paths.setext)});`, 'Setext body query');
  assert.deepEqual(await evaluate(`return p.results.find(r=>r.filePath===${JSON.stringify(paths.setext)}).breadcrumb;`), ['Setext章节']);
  await evaluate('const v=p.latestMarkdownView;v.editor.setSelection({line:3,ch:0},{line:3,ch:20});p.captureQuerySelection();p.querySelectionButton();return true;');
  await wait('return p.state.kind==="complete" && p.queryScopePresentation().kind==="once";', 'explicit code selection');
  checks.push({ name: 'fence-Setext-boundaries-and-explicit-selection', passed: true });
  await cli('plugin:reload', 'id=palimpsest');
  await openQuery(3);
  await wait(`return p.state.kind==='complete' && p.results.some(r=>r.filePath===${JSON.stringify(paths.code)});`, 'reload restores v3 and keyword cache');
  assert.equal(String(await evaluate('return p.index.identity.chunkerVersion;')), '3');
  assert.deepEqual(await evaluate('return p.getIndexScopeView();'), originalScope);
  checks.push({ name: 'reload-ready-v3-and-unchanged-effective-scope', passed: true });
  await cli('dev:screenshot', `path=${join(backup, 'sidebar.png')}`);
  passed = true;
} finally {
  await evaluate(`for(const leaf of app.workspace.getLeavesOfType('markdown')){if(leaf.view.file?.path.startsWith(${JSON.stringify(folder+'/')}))leaf.detach();}const f=app.vault.getAbstractFileByPath(${JSON.stringify(folder)});if(f)await app.vault.trash(f,true);return true;`).catch(() => {});
  await wait(`return !p.index.documentPaths.some(path=>path.startsWith(${JSON.stringify(folder + '/')}));`, 'fixture deletion committed', 15000).catch(() => {});
  await mkdir(resolve(output, '..'), { recursive: true });
  await writeFile(output, JSON.stringify({ passed, checks, vault, backup, fixtureFolder: folder, note: 'Independent test Vault only; v2 backup retained outside the worktree. New v3 plugin remains installed. Full durable execution fault injection is covered by automation, not this live check.' }, null, 2));
  console.log(JSON.stringify({ passed, checks, output, backup }, null, 2));
}
