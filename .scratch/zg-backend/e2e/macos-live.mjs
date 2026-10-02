import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { resolve, basename } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
const exec = promisify(execFile);
const vault = resolve(process.argv[2]);
const output = resolve(process.argv[3] ?? '.scratch/zg-backend/results/macos-e2e.json');
const checks = [];
const pause = ms => new Promise(r => setTimeout(r, ms));
async function cli(command, ...params) {
  const { stdout } = await exec('obsidian', [`vault=${basename(vault)}`, command, ...params], { timeout: 60000 });
  if (stdout.startsWith('Error:')) throw new Error(stdout);
  return stdout.trim();
}
async function evaluate(body) {
  const code = `(async()=>{if(app.vault.adapter.getBasePath()!==${JSON.stringify(vault)})throw new Error('Wrong test Vault'); const p=app.plugins.plugins.palimpsest; ${body}})()`;
  const raw = await cli('eval', `code=${code}`);
  if (!raw.startsWith('=> ')) throw new Error(raw);
  const value = raw.slice(3);
  if (value === 'undefined') return undefined;
  try { return JSON.parse(value); } catch { return value; }
}
async function wait(body, label, timeout = 45000) {
  console.log('Waiting:', label);
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const value = await evaluate(body);
    if (value) return value;
    await pause(200);
  }
  throw new Error(`Timed out: ${label}; ${JSON.stringify(await evaluate('return {state:p.state,index:p.getLocalIndexStatus()};'))}`);
}
const folder = `Lite验收-${Date.now()}`;
const queryPath = `${folder}/当前写作.md`;
const toolPath = `${folder}/工具.md`;
const breadPath = `${folder}/烘焙.md`;
const toolQuery = 'ZVECANCHOR Palimpsest 后端混合检索帮助回顾写作工具。';
const breadQuery = '制作面包需要观察发酵温度和面团含水量。';
let releaseOld;
let hold = false;
const server = createServer(async (req, res) => {
  try {
    let body = ''; for await (const data of req) body += data;
    const response = await fetch('http://127.0.0.1:11434/api/embed', { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    const text = await response.text();
    if (hold && body.includes('ZVECANCHOR')) { hold = false; await new Promise(r => { releaseOld = r; }); }
    res.writeHead(response.status, { 'content-type': 'application/json' }); res.end(text);
  } catch (error) { res.writeHead(500); res.end(String(error)); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const endpoint = `http://127.0.0.1:${server.address().port}/api/embed`;
let originalSettings;
let passed = false;
try {
  originalSettings = await evaluate('return {...p.settings};');
  const initial = await evaluate('return {status:p.getLocalIndexStatus(),runtime:Object.keys(require.cache).filter(k=>k.includes("plugins/palimpsest/runtime/") && k.endsWith(".node"))};');
  assert.equal(initial.status.status, 'ready');
  assert.equal(initial.runtime.length, 1);
  checks.push({ name: 'independent-native-installed', runtime: initial.runtime });
  await evaluate(`await app.vault.createFolder(${JSON.stringify(folder)}); await app.vault.create(${JSON.stringify(queryPath)}, ${JSON.stringify(`# 当前写作\n\n${toolQuery}\n\n\n\n${breadQuery}`)}); await app.vault.create(${JSON.stringify(toolPath)}, ${JSON.stringify('---\nsecret: YAMLPRIVATEANCHOR\n---\n# 混合检索工具\n\n' + (toolQuery + '关键词召回与向量召回可以帮助定位工具名称和相关的旧笔记。').repeat(3))}); await app.vault.create(${JSON.stringify(breadPath)}, ${JSON.stringify('# 烘焙\n\n' + (breadQuery + '烘焙时记录配方、室温、等待时间和面团状态，可以复盘每次制作面包的过程。').repeat(3))}); await p.activateView(); return true;`);
  await wait(`return p.index.documentPaths.includes(${JSON.stringify(toolPath)}) && p.index.documentPaths.includes(${JSON.stringify(breadPath)});`, 'new files indexed');
  await evaluate(`await app.workspace.getLeaf(false).openFile(app.vault.getAbstractFileByPath(${JSON.stringify(queryPath)})); return true;`);
  await pause(300);
  await evaluate('const v=app.workspace.activeLeaf.view; v.editor.setCursor({line:2,ch:0}); p.refreshCurrentQuery(); return true;');
  await wait(`return p.state.kind==='complete' && p.results.some(r=>r.filePath===${JSON.stringify(toolPath)});`, 'tool paragraph query');
  assert.deepEqual(await evaluate('return p.retrieval.keywordIds("YAMLPRIVATEANCHOR",10);'), []);
  assert.equal(await evaluate('return document.querySelectorAll(".obsdn-side-grep-score").length;'), 0);
  checks.push({ name: 'paragraph-hybrid-YAML-and-score-UI', passed: true });
  await evaluate('const v=app.workspace.activeLeaf.view; v.editor.setCursor({line:3,ch:0}); return true;');
  await wait('return p.state.kind==="waiting-input" && p.results.length===0;', 'blank paragraph waits');
  checks.push({ name: 'blank-does-not-query-document', passed: true });
  await evaluate(`p.settings.endpoint=${JSON.stringify(endpoint)}; const v=app.workspace.activeLeaf.view; v.editor.setCursor({line:2,ch:0}); return true;`);
  hold = true;
  await wait('return p.state.kind==="querying" || p.state.kind==="loading-model";', 'first request starts');
  const started = Date.now(); while (!releaseOld && Date.now()-started<30000) await pause(100);
  assert(releaseOld, 'proxy actually held the first response');
  await evaluate('app.workspace.activeLeaf.view.editor.setCursor({line:6,ch:0}); return true;');
  await wait(`return p.state.kind==='complete' && p.results.some(r=>r.filePath===${JSON.stringify(breadPath)});`, 'new paragraph finishes before old');
  const fresh = await evaluate('return p.results.map(r=>r.id);');
  releaseOld(); releaseOld = undefined;
  await pause(1000);
  assert.deepEqual(await evaluate('return p.results.map(r=>r.id);'), fresh);
  checks.push({ name: 'real-delayed-old-response-discarded', passed: true });
  await evaluate(`p.settings.endpoint=${JSON.stringify(originalSettings.endpoint)}; const v=app.workspace.activeLeaf.view; v.editor.setSelection({line:2,ch:0},{line:2,ch:${toolQuery.length}}); p.captureQuerySelection(); p.querySelectionButton(); return true;`);
  await wait('return p.state.kind==="complete" && p.queryScopePresentation().kind==="once";', 'selection query');
  checks.push({ name: 'explicit-selection-query', passed: true });
  const renamed = `${folder}/移动工具.md`;
  await evaluate(`await app.vault.rename(app.vault.getAbstractFileByPath(${JSON.stringify(toolPath)}),${JSON.stringify(renamed)}); return true;`);
  await wait(`return p.index.documentPaths.includes(${JSON.stringify(renamed)}) && !p.index.documentPaths.includes(${JSON.stringify(toolPath)});`, 'rename committed');
  await evaluate('p.refreshCurrentQuery(); return true;');
  await wait(`return p.state.kind==='complete' && p.results.every(r=>r.filePath!==${JSON.stringify(toolPath)});`, 'rename reflected');
  await evaluate(`await app.vault.modify(app.vault.getAbstractFileByPath(${JSON.stringify(renamed)}),${JSON.stringify('# 更新\n\n' + 'UPDATEDANCHOR 替换后的唯一内容，关键词索引不应该继续保留旧术语。'.repeat(4))}); return true;`);
  await wait(`return p.index.chunks.some(c=>c.filePath===${JSON.stringify(renamed)} && c.text.includes('UPDATEDANCHOR'));`, 'edit committed');
  await evaluate('p.refreshCurrentQuery(); return true;');
  await wait('return p.state.kind==="complete";', 'edit keyword sync');
  assert.equal((await evaluate('return p.retrieval.keywordIds("UPDATEDANCHOR",20);')).length > 0, true);
  await evaluate(`await app.vault.trash(app.vault.getAbstractFileByPath(${JSON.stringify(renamed)}),true); return true;`);
  await wait(`return !p.index.documentPaths.includes(${JSON.stringify(renamed)});`, 'delete committed');
  await evaluate('p.refreshCurrentQuery(); return true;');
  await wait('return p.state.kind==="complete";', 'delete keyword sync');
  assert.deepEqual(await evaluate('return p.retrieval.keywordIds("UPDATEDANCHOR",20);'), []);
  checks.push({ name: 'create-edit-rename-delete-two-route-sync', passed: true });
  await evaluate(`p.settings.excludedDirectories=[...p.settings.excludedDirectories,${JSON.stringify(folder)}]; await p.saveSettings(); p.onSettingsChanged(); return true;`);
  assert.equal(await evaluate('return p.getIndexScopeView().status;'), 'pending');
  await evaluate('void p.applyIndexScopeChanges(); return true;');
  await wait('return p.getIndexScopeView().status==="current";', 'scope applied');
  await evaluate('p.refreshCurrentQuery(); return true;');
  await wait('return p.state.kind==="complete";', 'scope query');
  assert.equal(await evaluate(`return p.results.some(r=>r.filePath.startsWith(${JSON.stringify(folder+'/')}));`), false);
  checks.push({ name: 'scope-pending-and-small-incremental-apply', passed: true });
  await evaluate('const count=p.index.size; window.__liteBeforeRebuild=count; void p.requestFullIndexBuild(); return true;');
  await wait('return !!document.querySelector(".modal");', 'rebuild preview');
  await evaluate('[...document.querySelectorAll(".modal button")].find(b=>b.textContent==="取消").click(); return true;');
  assert.equal(await evaluate('return p.index.size===window.__liteBeforeRebuild;'), true);
  checks.push({ name: 'cancelled-rebuild-preserves-old-index', passed: true });
  await evaluate(`p.settings=${JSON.stringify(originalSettings)}; await p.saveSettings(); p.onSettingsChanged(); return true;`);
  await cli('plugin:reload', 'id=palimpsest');
  await evaluate('await p.activateView(); return true;');
  await wait('return p.state.kind==="complete";', 'reloaded plugin rebuilds keyword cache');
  checks.push({ name: 'plugin-reload-and-cache-reconstruction', passed: true });
  const sourceResult = await evaluate('return p.results[0];');
  assert(sourceResult);
  await evaluate('await p.openResult(p.results[0]); return true;');
  assert.equal(await evaluate('return app.workspace.getActiveFile()?.path;'), sourceResult.filePath);
  checks.push({ name: 'open-result-source', passed: true });
  passed = true;
} finally {
  hold = false;
  releaseOld?.();
  await evaluate(`const fixture=app.vault.getAbstractFileByPath(${JSON.stringify(folder)}); if(fixture)await app.vault.trash(fixture,true); return true;`).catch(()=>{});
  if (originalSettings) await evaluate(`p.settings=${JSON.stringify(originalSettings)}; await p.saveSettings(); await p.applyIndexScopeChanges(); return true;`).catch(()=>{});
  server.closeAllConnections();
  await new Promise(r=>server.close(r));
  await mkdir(resolve(output,'..'), { recursive: true });
  await writeFile(output, JSON.stringify({ passed, checks, fixtureFolder: folder, backupPathFile: '/tmp/palimpsest-lite-e2e-backup-path', note:'Only the independent experimental Vault was modified; source/runtime references are inspected in the real Obsidian process.' }, null, 2));
  console.log(JSON.stringify({ passed, checks }, null, 2));
}
