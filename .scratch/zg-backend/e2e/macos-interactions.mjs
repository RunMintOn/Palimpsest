import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolve, basename, join } from 'node:path';
import { rename, lstat, writeFile } from 'node:fs/promises';
const vault=resolve(process.argv[2]);
const plugin=join(vault,'.obsidian/plugins/palimpsest');
const runtime=join(plugin,'runtime');
const backup=join(plugin,'runtime-e2e-backup');
const file=`交互验收-${Date.now()}.md`;
const hiddenFile=`隐藏更新-${Date.now()}.md`;
const checks=[];
function cli(command,...args){const out=execFileSync('obsidian',[`vault=${basename(vault)}`,command,...args],{encoding:'utf8',timeout:60000}).trim();if(out.startsWith('Error:'))throw new Error(out);return out;}
function evaluate(body){const raw=cli('eval',`code=(async()=>{if(app.vault.adapter.getBasePath()!==${JSON.stringify(vault)})throw new Error('Wrong Vault');const p=app.plugins.plugins.palimpsest;${body}})()`);if(!raw.startsWith('=> '))throw new Error(raw);try{return JSON.parse(raw.slice(3));}catch{return raw.slice(3);}}
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function wait(body,label){for(let i=0;i<100;i++){if(evaluate(body))return;await pause(250);}throw new Error(`Timed out: ${label}; ${JSON.stringify(evaluate('return {state:p.state,source:p.queryScopePresentation()};'))}`);}
let moved=false,passed=false;
try{
  assert.equal(await lstat(backup).catch(()=>undefined),undefined);
  evaluate(`await app.vault.create(${JSON.stringify(file)},${JSON.stringify('# 交互验收\n\n用提取练习帮助回顾长期积累的旧笔记知识。')});await app.workspace.getLeaf(false).openFile(app.vault.getAbstractFileByPath(${JSON.stringify(file)}));await app.workspace.activeLeaf.setViewState({type:'markdown',state:{file:${JSON.stringify(file)},mode:'source'},active:true});await p.activateView();return true;`);
  await pause(200);
  evaluate('p.latestMarkdownView.editor.setCursor({line:2,ch:0});p.refreshCurrentQuery();return true;');
  await wait('return p.state.kind==="complete" && p.results.length>0;','initial results');
  await rename(runtime,backup);moved=true;
  evaluate(`for(const key of Object.keys(require.cache)){if(key.startsWith(${JSON.stringify(runtime+'/')}))delete require.cache[key];}return true;`);
  cli('plugin:reload','id=palimpsest');
  evaluate(`await app.workspace.getLeaf('tab').openFile(app.vault.getAbstractFileByPath(${JSON.stringify(file)}));await p.activateView();return true;`);
  await pause(200);
  evaluate('p.latestMarkdownView.editor.setCursor({line:2,ch:0});p.refreshCurrentQuery();return true;');
  await wait('return p.state.kind==="query-failed";','missing native library is a visible failure');
  assert(evaluate('return p.state.message;').includes('查询失败'));
  await rename(backup,runtime);moved=false;
  evaluate('p.refreshCurrentQuery();return true;');
  await wait('return p.state.kind==="complete" && p.results.length>0;','restored native library retry');
  checks.push('real-native-load-failure-and-retry');
  const dragging=evaluate('const a=document.querySelector(".obsdn-side-grep-file"),q=document.querySelector(".obsdn-side-grep-summary-quote-action");const link=new DataTransfer(),quote=new DataTransfer();a.dispatchEvent(new DragEvent("dragstart",{dataTransfer:link,bubbles:true}));q.dispatchEvent(new DragEvent("dragstart",{dataTransfer:quote,bubbles:true}));return {link:link.getData("text/plain"),quote:quote.getData("text/plain")};');
  assert(dragging.link.includes('[['));assert(dragging.quote.includes('> '));
  evaluate('document.querySelector(".obsdn-side-grep-summary-quote-action").click();return true;');
  await wait('return p.latestMarkdownView.editor.getValue().includes("> ");','quote inserts into editor');
  checks.push('real-sidebar-link-drag-quote-drag-and-insertion');
  evaluate('await p.latestMarkdownView.save();return true;');
  await wait(`return !p.flushingFileUpdates && p.state.kind==='complete' && p.index.documents.find(d=>d.filePath===${JSON.stringify(file)})?.sourceMtime===app.vault.getAbstractFileByPath(${JSON.stringify(file)}).stat.mtime;`,'quote update settled');
  evaluate(`await p.latestMarkdownView.leaf.setViewState({type:'markdown',state:{file:${JSON.stringify(file)},mode:'preview'},active:true});return true;`);
  await pause(500);
  evaluate('window.__beforeReadingState=p.state;const v=p.latestMarkdownView;const para=v.contentEl.querySelector(".markdown-preview-view p");if(!para)throw new Error("No preview paragraph");const range=document.createRange();range.selectNodeContents(para);window.getSelection().removeAllRanges();window.getSelection().addRange(range);p.captureQuerySelection();p.querySelectionButton();return true;');
  await wait('return p.automaticWork.allowed && p.state!==window.__beforeReadingState && p.state.kind==="complete" && p.queryScopePresentation().kind==="once";','reading view explicit selection');
  checks.push('real-reading-view-selection');
  assert.equal(evaluate('return [...document.querySelectorAll(".obsdn-side-grep-result")].some(card=>card.getClientRects().length>0);'),true);
  cli('dev:screenshot','path=/tmp/palimpsest-lite-sidebar.png');
  checks.push('sidebar-screenshot-retained');
  evaluate(`window.getSelection().removeAllRanges();await p.latestMarkdownView.leaf.setViewState({type:'markdown',state:{file:${JSON.stringify(file)},mode:'source'},active:true});p.latestMarkdownView.editor.setCursor({line:2,ch:0});app.workspace.detachLeavesOfType('palimpsest-sidebar');return true;`);
  await wait('return !p.automaticWork.allowed;','panel hidden');
  const before=evaluate('return p.getLocalIndexStatus().documents;');
  evaluate(`await app.vault.create(${JSON.stringify(hiddenFile)},${JSON.stringify('隐藏面板期间新增的文件，恢复可见后才应用索引更新。'.repeat(5))});return true;`);
  await pause(1200);
  assert.equal(evaluate('return p.getLocalIndexStatus().documents;'),before);
  evaluate('await p.activateView();return true;');
  await wait(`return p.index.documentPaths.includes(${JSON.stringify(hiddenFile)}) && p.state.kind==='complete';`,'visibility resume updates then queries');
  checks.push('real-hidden-panel-pauses-and-visible-panel-resumes');
  passed=true;
}finally{
  if(moved)await rename(backup,runtime);
  evaluate(`for(const path of ${JSON.stringify([file,hiddenFile])}){const f=app.vault.getAbstractFileByPath(path);if(f)await app.vault.trash(f,true);}await p.applyIndexScopeChanges();return true;`);
  await writeFile('.scratch/zg-backend/results/macos-interactions.json',JSON.stringify({passed,checks,screenshot:'/tmp/palimpsest-lite-sidebar.png'},null,2));
  console.log(JSON.stringify({passed,checks},null,2));
}
