import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdir, writeFile, lstat } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
const exec = promisify(execFile);
const vault = resolve(process.argv[2] ?? '');
const supported = '/Users/ziqian/20-dev/10-projects/16-palimpsest-zg-experiment/experiments/zvec/vault';
if (vault !== supported) throw Error('Pass the exact independent experimental Vault path. No production Vault is supported.');
const flomo = resolve(process.argv[3] ?? '../obs-flomo-view');
const output = resolve(process.argv[4] ?? '/tmp/palimpsest-flomo-e2e.json');
async function cli(command, ...args) {
  const { stdout } = await exec('obsidian', [`vault=${basename(vault)}`, command, ...args], { timeout: 120000 });
  if (stdout.trim().startsWith('Error:')) throw Error(stdout);
  return stdout.trim();
}
async function evaluate(code) {
  const raw = await cli('eval', `code=(async()=>{if(app.vault.adapter.getBasePath()!==${JSON.stringify(vault)})throw Error('Wrong Vault');${code}})()`);
  if (!raw.startsWith('=> ')) throw Error(raw);
  try { return JSON.parse(raw.slice(3)); } catch { return raw.slice(3); }
}
// The Vault is both allowlisted on disk and checked inside the actual Obsidian instance.
await evaluate('return true;');
await exec('node', ['scripts/install-native-to-vault.mjs', vault], { timeout: 120000 });
const target = join(vault, '.obsidian/plugins/obs-flomo-view');
if ((await lstat(target).catch(() => null))?.isSymbolicLink()) throw Error('Refusing symlink plugin target');
await mkdir(target, { recursive: true });
for (const file of ['main.js', 'manifest.json', 'styles.css']) await cp(join(flomo, file), join(target, file));
await cli('plugin:reload', 'id=palimpsest');
if (!(await evaluate("return !!app.plugins.plugins['obs-flomo-view'];"))) await cli('plugin:enable', 'id=obs-flomo-view');
await cli('plugin:reload', 'id=obs-flomo-view');

async function journey() {
  const f = app.plugins.plugins['obs-flomo-view'];
  let p = app.plugins.plugins.palimpsest;
  const folder = `Flomo接入验收-${Date.now()}`;
  const previous = JSON.parse(JSON.stringify(f.settings));
  const pSettings = JSON.parse(JSON.stringify(p.settings));
  const splits = { left: app.workspace.leftSplit.collapsed, right: app.workspace.rightSplit.collapsed };
  const leavesBefore = new Set(); app.workspace.iterateAllLeaves(l => leavesBefore.add(l));
  const result = window.__flomoIntegration = { running: true, checks: [], folder };
  const assert = (condition, message) => { if (!condition) throw Error(message); };
  const record = name => result.checks.push({ name, passed: true });
  const sleep = ms => new Promise(r => require('timers').setTimeout(r, ms));
  const wait = async (predicate, label) => {
    for (let i = 0; i < 600; i++) { if (await predicate()) return; await sleep(100); }
    throw Error(`Timed out: ${label}`);
  };
  const build = async () => {
    void p.requestFullIndexBuild();
    await wait(() => !!document.querySelector('.modal button.mod-cta'), 'build confirmation');
    document.querySelector('.modal button.mod-cta').click();
    await wait(() => !p.fullIndexBuildRequests.isActive && p.getLocalIndexStatus().status === 'ready', 'durable build');
  };
  let view, leaf, second, source;
  const button = (root, text) => [...root.querySelectorAll('button')].find(b => b.textContent === text);
  const root = () => view.contentEl;
  const query = async path => {
    const el = root().querySelector(`.flomo-card[data-path="${path}"] .flomo-find-related`);
    assert(el, `Missing query button: ${path}`);
    el.click();
    await wait(() => ['success', 'error'].includes(view.related.state.kind), 'query settled');
    await sleep(150);
    return view.related.state;
  };
  try {
    const w = require('@electron/remote').getCurrentWindow(); w.show(); w.restore(); w.focus();
    for (const l of app.workspace.getLeavesOfType('palimpsest-sidebar')) l.detach();
    await wait(() => !p.automaticWork.allowed && !p.isAnyIndexUpdateActive(), 'Palimpsest hidden');
    await app.vault.createFolder(folder);
    await app.vault.createFolder(`${folder}/excluded`);
    await app.vault.createFolder(`${folder}/outside`);
    const body = 'HYBRIDANCHOR **关键词**和语义向量一起检索旧笔记。[来源](item-00.md)帮助理解 Markdown 命中上下文。'.repeat(3);
    for (let i = 0; i < 36; i++) {
      await app.vault.create(`${folder}/item-${String(i).padStart(2, '0')}.md`, `---\ncreated: "2020-01-01 10:00"\ntags: [${i === 0 ? '来源' : '其他'}]\n---\n\n${i === 35 ? body : `普通记录 ${i} 关于生活日常，内容与检索主题不同。`.repeat(3)}`);
    }
    await app.vault.create(`${folder}/excluded/hidden.md`, `---\ncreated: "2020-01-01 10:00"\n---\n\n${body}`);
    await app.vault.create(`${folder}/outside/other.md`, `---\ncreated: "2020-01-01 10:00"\n---\n\n${body}`);
    await build();
    const sourceFile = await app.vault.create(`${folder}/unindexed.md`, `---\ncreated: "2025-01-01 10:00"\nsecret: FRONTMATTERPRIVATE\n---\n\n${body}`);
    source = sourceFile.path;
    await f.setExcluded([`${folder}/excluded`, `${folder}/outside`]);
    await f.setSaveFolder(folder);
    await f.setFolder(folder);
    await wait(() => f.getSnapshot(folder).memos.length === 37, 'metadata snapshot');
    leaf = app.workspace.getLeaf('tab');
    await leaf.setViewState({ type: 'obs-flomo-view', active: true });
    view = leaf.view;
    await wait(() => root().querySelectorAll('.flomo-card').length === 30, 'first page');
    assert(!p.index.chunks.some(c => c.filePath === source), 'Source must really be unindexed');
    assert(!root().querySelector(`[data-path="${folder}/item-35.md"]`), 'target beyond rendered page');
    let state = await query(source);
    assert(state.kind === 'success', JSON.stringify(state));
    assert(state.response.results.some(r => r.filePath === `${folder}/item-35.md`), 'unrendered candidate recalled');
    assert(state.response.results.every(r => r.filePath !== source && !r.filePath.includes('/excluded/') && !r.filePath.includes('/outside/')), 'scope and source exclusion');
    assert(new Set(state.response.results.map(r => r.filePath)).size === state.response.results.length, 'one result per file');
    assert(root().querySelector('.flomo-related-result .markdown-rendered')?.textContent.includes('HYBRIDANCHOR'), 'real excerpt rendered');
    assert(root().querySelector('.flomo-related-result strong')?.textContent === '关键词', 'Markdown formatting rendered');
    const firstResult = state.response.results[0];
    button(root().querySelector('.flomo-related-result'), firstResult.filePath).click();
    await wait(() => view.editorLeaf?.view.file?.path === firstResult.filePath, 'source opened');
    assert(view.editorLeaf.view.editor.getCursor().line === firstResult.excerpt.startLine - 1, 'returned line used');
    view.editorLeaf.view.editor.setCursor({ line: 0, ch: 0 });
    await view.openRelated({ ...firstResult, excerpt: { ...firstResult.excerpt, text: 'HYBRIDANCHOR' } });
    assert(view.editorLeaf.view.editor.getCursor().line === firstResult.excerpt.startLine - 1, 'partial-line chunk still uses its source line');
    view.editorLeaf.detach(); view.editorLeaf = null; view.editorFile = null;
    app.workspace.setActiveLeaf(leaf, { focus: true });
    assert(root().querySelector('.flomo-related').textContent.includes('已有索引'), 'freshness notice');
    record('hidden-sidebar-unindexed-source-full-space-recall-and-markdown');
    app.workspace.leftSplit.collapse(); app.workspace.rightSplit.collapse();
    await sleep(250);
    view.scroller.scrollTop += view.relatedEl.getBoundingClientRect().top - view.scroller.getBoundingClientRect().top;
    await sleep(250);
    result.screenshotReady = true;
    await wait(() => result.screenshotCaptured, 'screenshot capture');

    // The mock remains a v1 object at the cross-plugin boundary, not a view/private renderer mock.
    const realApi = p.retrievalApi;
    const requests = [];
    p.retrievalApi = { apiVersion: 1, query: async request => { requests.push(request); return { ok: true, results: [], knownPendingUpdates: false }; } };
    await query(source);
    assert(!requests.at(-1).text.includes('FRONTMATTERPRIVATE'), 'source private YAML excluded');
    view.selectTag('来源');
    await wait(() => root().querySelectorAll('.flomo-card').length === 1, 'tag filter');
    await query(`${folder}/item-00.md`);
    assert(requests.at(-1).candidatePaths.length === 36 && requests.at(-1).candidatePaths.includes(`${folder}/item-35.md`), 'tag does not narrow candidates');
    assert(!requests.at(-1).text.includes('created:') && !requests.at(-1).text.includes('secret:'), 'frontmatter removed');
    view.reviewMode = true; view.selectedTag = ''; view.requestRefresh(0);
    await wait(() => root().querySelectorAll('.flomo-card').length === 1 && root().querySelector('.flomo-review-controls')?.hidden === false, 'review card');
    await query(root().querySelector('.flomo-card').dataset.path);
    assert(requests.at(-1).candidatePaths.length === 36, 'review sample does not narrow candidates');
    assert(root().querySelector('.flomo-related').textContent.includes('没有找到'), 'empty is explicit success');
    record('tag-review-full-candidates-frontmatter-and-empty-state');
    view.reviewMode = false; view.requestRefresh(0);
    await wait(() => root().querySelectorAll('.flomo-card').length === 30, 'timeline restored');
    const deferred = new Map();
    p.retrievalApi = { apiVersion: 1, query: request => new Promise(resolve => deferred.set(request.sourcePath, resolve)) };
    button(root().querySelector(`.flomo-card[data-path="${source}"]`), '找相关').click();
    await wait(() => deferred.has(source), 'A request');
    const other = `${folder}/item-00.md`;
    button(root().querySelector(`.flomo-card[data-path="${other}"]`), '找相关').click();
    await wait(() => deferred.has(other), 'B request');
    deferred.get(other)({ ok: false, code: 'query-failed', message: 'LATEST-B' });
    await wait(() => root().querySelector('.flomo-related').textContent.includes('LATEST-B'), 'B published');
    deferred.get(source)({ ok: true, results: [], knownPendingUpdates: false });
    await sleep(150);
    assert(root().querySelector('.flomo-related').textContent.includes('LATEST-B'), 'A cannot overwrite B');
    record('A-B-out-of-order-results-isolated');

    second = app.workspace.getLeaf('tab'); await second.setViewState({ type: 'obs-flomo-view', active: true });
    await wait(() => second.view.contentEl.querySelector('.flomo-find-related'), 'second view');
    deferred.clear();
    view.findRelated(source); await wait(() => deferred.has(source), 'view one query');
    second.view.findRelated(other); await wait(() => deferred.has(other), 'view two query');
    leaf.detach();
    deferred.get(source)({ ok: true, results: [], knownPendingUpdates: false });
    deferred.get(other)({ ok: false, code: 'query-failed', message: 'SECOND-VIEW' });
    await wait(() => second.view.contentEl.querySelector('.flomo-related').textContent.includes('SECOND-VIEW'), 'second independent');
    leaf = second; view = leaf.view; second = null;
    record('view-close-does-not-cancel-another-view');
    p.retrievalApi = realApi;

    const model = p.settings.model;
    p.settings.model = 'incompatible-test';
    state = await query(source); assert(state.kind === 'error' && state.message.includes('不兼容'), 'incompatible prompt');
    p.settings.model = model;
    const initialized = p.index.data.initialized; p.index.data.initialized = false;
    state = await query(source); assert(state.kind === 'error' && state.message.includes('建立索引'), 'missing index prompt');
    p.index.data.initialized = initialized;
    const endpoint = p.settings.endpoint; p.settings.endpoint = 'http://127.0.0.1:1/api/embed';
    state = await query(source); assert(state.kind === 'error', 'backend failure not empty'); p.settings.endpoint = endpoint;
    p.retrievalApi = { apiVersion: 2 };
    state = await query(source); assert(state.kind === 'error' && state.message.includes('版本'), 'version prompt'); p.retrievalApi = realApi;
    record('index-needed-incompatible-backend-and-version-errors');

    // Actual unload while an embedding is pending: the old instance must not publish success.
    const originalProvider = p.provider;
    let release;
    p.provider = () => ({ embedQuery: () => new Promise(resolve => { release = resolve; }) });
    const oldApi = p.retrievalApi;
    const underway = oldApi.query({ text: body, sourcePath: source, candidatePaths: [`${folder}/item-35.md`] });
    await wait(() => !!release, 'embedding in flight');
    await app.plugins.disablePlugin('palimpsest');
    release({ vectors: [new Float32Array(p.settings.dimensions).fill(1)], coldLoad: false });
    const oldResponse = await underway;
    assert(!oldResponse.ok && oldResponse.code === 'temporarily-unavailable', 'old instance after unload');
    state = await query(source); assert(state.kind === 'error' && state.message.includes('未启用'), 'missing plugin prompt');
    view.input.value = 'Palimpsest 不可用时仍然可以保存新的记录。';
    view.input.dispatchEvent(new Event('input', { bubbles: true }));
    root().querySelector('.flomo-compose-actions .mod-cta').click();
    await wait(() => !view.saving && f.getSnapshot(folder).memos.length === 38, 'normal save with backend absent');
    await app.plugins.enablePlugin('palimpsest'); p = app.plugins.plugins.palimpsest;
    state = await query(source); assert(state.kind === 'success', 'next click discovers replacement');
    record('flomo-first-pal-late-load-unload-in-flight-and-manual-rediscovery');

    const before = p.index.chunks;
    const targetFile = app.vault.getAbstractFileByPath(`${folder}/item-35.md`);
    await app.vault.modify(targetFile, `---\ncreated: "2020-01-01 10:00"\n---\n\nUPDATEDANCHOR ${body}`);
    await sleep(650);
    state = await query(source);
    assert(state.kind === 'success' && state.response.knownPendingUpdates, 'pending notice');
    assert(p.index.chunks === before && !p.index.chunks.some(c => c.text.includes('UPDATEDANCHOR')), 'query did not maintain formal index');
    const opening = state.response.results.find(r => r.filePath === targetFile.path);
    await view.openRelated(opening);
    assert(view.editorLeaf.view.file.path === targetFile.path, 'stale line still opens file');
    await p.activateView();
    await wait(() => p.index.chunks.some(c => c.filePath === targetFile.path && c.text.includes('UPDATEDANCHOR')) && !p.isAnyIndexUpdateActive(), 'normal sidebar maintenance');
    view.findRelated(source);
    await wait(() => view.related.state.kind === 'success', 'Flomo with sidebar');
    assert(view.related.state.response.results.some(r => r.excerpt.text.includes('UPDATEDANCHOR')), 'updated result');
    await wait(() => p.state.kind !== 'querying' && p.state.kind !== 'loading-model', 'sidebar query');
    assert(!p.results.some(r => r.filePath === targetFile.path), 'sidebar retains its own exclusion');
    record('no-query-index-maintenance-pending-normal-update-and-sidebar-isolation');
    for (const l of app.workspace.getLeavesOfType('palimpsest-sidebar')) l.detach();

    // Move source and results out of the active space while the public call is pending.
    const nextApi = p.retrievalApi;
    let finish;
    p.retrievalApi = { apiVersion: 1, query: () => new Promise(r => { finish = r; }) };
    view.findRelated(source); await wait(() => !!finish, 'range-change query');
    await f.setExcluded([`${folder}/excluded`, `${folder}/outside`, targetFile.path]);
    finish({ ok: true, results: [opening], knownPendingUpdates: false });
    await wait(() => view.related.state.kind === 'success', 'range response');
    assert(!root().querySelector('.flomo-related-result'), 'new exclusions respected before rendering');
    await app.vault.trash(targetFile, true);
    await view.openRelated(opening);
    finish = undefined;
    view.findRelated(source); await wait(() => !!finish, 'source deletion in flight');
    await app.vault.trash(app.vault.getAbstractFileByPath(source), true);
    await wait(() => view.related.state.kind === 'idle', 'source delete invalidates');
    finish({ ok: true, results: [], knownPendingUpdates: false });
    await sleep(100);
    assert(view.related.state.kind === 'idle', 'late result after source delete discarded');
    await f.setFolder('/');
    await wait(() => view.related.state.kind === 'idle', 'space invalidates session');
    p.retrievalApi = nextApi;
    record('range-change-deletion-open-fallback-and-space-invalidation');
    result.passed = true;
  } catch (error) { result.error = String(error.stack ?? error); }
  finally {
    try {
      p = app.plugins.plugins.palimpsest;
      if (!p) { await app.plugins.enablePlugin('palimpsest'); p = app.plugins.plugins.palimpsest; }
      // Reload discards all in-memory probes, including a probe left by a failed assertion.
      await app.plugins.disablePlugin('palimpsest'); await app.plugins.enablePlugin('palimpsest'); p = app.plugins.plugins.palimpsest;
      const added = []; app.workspace.iterateAllLeaves(l => { if (!leavesBefore.has(l)) added.push(l); }); added.forEach(l => l.detach());
      f.settings = previous; await f.persist(); f.refreshViews();
      p.settings = pSettings; await p.saveSettings();
      const fixture = app.vault.getAbstractFileByPath(folder); if (fixture) await app.vault.trash(fixture, true);
      await build();
      if (splits.left) app.workspace.leftSplit.collapse(); else app.workspace.leftSplit.expand();
      if (splits.right) app.workspace.rightSplit.collapse(); else app.workspace.rightSplit.expand();
      result.cleaned = true;
    } catch (error) { result.cleanupError = String(error.stack ?? error); }
    result.running = false;
  }
}
await evaluate(`void (${journey.toString()})(); return true;`);
for (let i = 0; i < 900; i++) {
  const result = await evaluate('return window.__flomoIntegration;');
  if (result.screenshotReady && !result.screenshotCaptured) {
    await cli('dev:screenshot', `path=${output.replace(/\.json$/, '-desktop.png')}`);
    await evaluate('window.__flomoIntegration.screenshotCaptured=true;return true;');
  }
  if (!result.running) {
    await writeFile(output, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
    if (!result.passed || !result.cleaned) process.exitCode = 1;
    break;
  }
  await new Promise(r => setTimeout(r, 500));
  if (i === 899) throw Error('Integration timed out; inspect window.__flomoIntegration before rerunning');
}
