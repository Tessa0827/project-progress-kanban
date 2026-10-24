'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const html = fs.readFileSync(path.join(__dirname, '../app/kanban.html'), 'utf8');
const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
const code=scripts.at(-1);

function setup(native = false, payload = null, view = null) {
  const elements = new Map(), storage = new Map(view ? [['kanban-view-v1', JSON.stringify(view)]] : []), handlers = {}, nativeCalls = [];
  let stored = payload;
  function element(id) {
    if (!elements.has(id)) elements.set(id, { id, innerHTML: '', textContent: '', value: '', hidden: true, title: '', dataset: {}, style: {}, attributes: {}, classList: { add() {}, remove() {}, toggle() {} }, closest(selector) { return element(id+' closest '+selector); }, querySelectorAll() { return []; }, querySelector(selector) { return element(id + ' ' + selector); }, addEventListener(type, fn) { handlers[id + ':' + type] = fn; }, after() {}, appendChild() {}, focus() {}, click() { this.onclick?.(); }, setAttribute(name, value) { this.attributes[name] = value; } });
    return elements.get(id);
  }
  const document = { documentElement: { dataset: {}, style:{setProperty(){}} }, getElementById: element, createElement: tag => element('created ' + tag), querySelectorAll: () => [], querySelector: selector => element(selector), addEventListener(type, fn) { (handlers[type] ||= []).push(fn); }, activeElement: null };
  const bridge = { platform: 'darwin', loadState: () => ({ ok: true, value: { state: stored, deviceId: 'mac', dataPath: '/local/kanban-data.json' } }), saveState(state) { stored = JSON.parse(JSON.stringify(state)); nativeCalls.push('save'); return { ok: true }; }, chooseFiles: async () => ({ ok: true, value: [] }), openFile: async () => ({ ok: true, value: null }), revealFile: async () => ({ ok: true, value: null }), importData: async () => ({ ok: true, value: null }), exportData: async () => ({ ok: true, value: null }) };
  const celebrations=[];
  const window = { kanbanPersonalUI:{installMotion(){},installSelectControls(){},showProjectCelebration(projects){celebrations.push(projects);}}, addEventListener() {}, ...(native ? { kanbanDesktop: bridge } : {}) };
  const ctx = vm.createContext({ document, window, localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) }, setTimeout: () => 1, clearTimeout() {}, confirm: () => true, structuredClone, crypto: crypto.webcrypto, Blob, URL, console, queueMicrotask:fn=>fn() });
  vm.runInContext(scripts[0],ctx);
  Object.assign(window.kanbanPersonalUI,{installMotion(){},installSelectControls(){},installDateControls(){},installBoardTools(){},installProjectOrder(){},createTaskCelebration(){return {start(tasks){celebrations.push(tasks);},stop(){},reconcile(){}};}});
  vm.runInContext(code, ctx);
  return { run: value => vm.runInContext(value, ctx), ctx, element, bridge, storage, handlers, nativeCalls, celebrations, stored: () => stored };
}

test('Native initialization persists to disk and explicitly reports local-machine storage', () => {
  const a = setup(true); assert.equal(a.nativeCalls.length, 1); assert.equal(a.stored().tasks.length, 18);
  assert.match(a.element('fileInfo').innerHTML, /已存本机/); assert.match(a.element('fileInfo').title, /kanban-data.json/);
  a.run('state.tasks[0].desc="刚写的备注";markDirty()'); const b = setup(true, a.stored()); assert.equal(b.run('state.tasks[0].desc'), '刚写的备注');
});

test('Task completion celebrates once after persistence and never on initial load or failed save', () => {
  const a=setup(true);assert.equal(a.celebrations.length,0);
  a.run('state.tasks[0].status="done";state.tasks[0].progress=100;markDirty()');assert.equal(a.celebrations.length,1);
  a.run('markDirty()');assert.equal(a.celebrations.length,1);
  const b=setup(true,a.stored());assert.equal(b.celebrations.length,0);
  b.bridge.saveState=()=>({ok:false,error:'disk full'});
  b.run('state.tasks[1].status="done";state.tasks[1].progress=100;markDirty()');assert.equal(b.celebrations.length,0);
  assert.ok(!html.includes('id="projectLife"'));assert.ok(!html.includes('class="column-colors"'));
});
test('Custom workflow, completion undo, arbitrary colors and file references survive saving and reload',()=>{
 const a=setup(true);a.run('state.projects[0].workflowColumns=[{key:"col-test-12345678",name:"验收",color:"#123456"}];state.tasks[0].workflowColumn="col-test-12345678";state.tasks[0].status="doing";state.tasks[0].progress=45;markDirty()');
 const b=setup(true,a.stored());assert.equal(b.run('columnOf(state.tasks[0])'),'col-test-12345678');
 b.run('toggleTaskCompletion(state.tasks[0],true)');assert.equal(b.run('state.tasks[0].status'),'done');
 b.run('toggleTaskCompletion(state.tasks[0],false)');assert.equal(b.run('columnOf(state.tasks[0])'),'col-test-12345678');assert.equal(b.run('state.tasks[0].progress'),45);
 const c=setup(true,b.stored());assert.equal(c.run('columnOf(state.tasks[0])'),'col-test-12345678');assert.equal(c.run('getColumns().find(x=>x.key==="col-test-12345678").color'),'#123456');
});
test('File names wrap to two lines, retain suffixes, escape markup and include the full hover title', () => {
  const a = setup(true); a.ctx.name = '特别长的项目名称'.repeat(25) + '.xlsx';
  assert.deepEqual(JSON.parse(a.run('JSON.stringify(splitLocalFilename(name))')), ['特别长的项目名称'.repeat(25), '.xlsx']);
  assert.match(html, /-webkit-line-clamp: 2/); assert.match(html, /local-file-ext \{ flex-shrink: 0; white-space: nowrap/);
  a.run('state.tasks[0].localFiles=[{id:"f",name:name,locations:{mac:"/tmp/local.xlsx"}}];renderBoard()'); assert.ok(a.element('board').innerHTML.includes('title="' + a.ctx.name));
  a.ctx.name = '<bad onerror="x">.pdf'; const safe = a.run('filenameHTML(name)'); assert.ok(safe.includes('&lt;bad')); assert.ok(!safe.includes('<bad'));
  assert.deepEqual(JSON.parse(a.run('JSON.stringify(splitLocalFilename(".gitignore"))')), ['.gitignore', '']);
  assert.deepEqual(JSON.parse(a.run('JSON.stringify(splitLocalFilename("无后缀文件"))')), ['无后缀文件', '']);
});
test('Linking and duplicate suppression use paths, so equal names in different folders remain distinct', async () => {
  const a = setup(true), card = a.element('card-test');
  const refs = [{ id: 'a', name: '预算.xlsx', locations: { mac: '/a/预算.xlsx' } }, { id: 'b', name: '预算.xlsx', locations: { mac: '/b/预算.xlsx' } }];
  a.bridge.chooseFiles = async () => ({ ok: true, value: refs }); a.ctx.card = card;
  await a.run('chooseTaskFiles(card,state.tasks[0],()=>markDirty())'); assert.equal(a.stored().tasks[0].localFiles.length, 2);
  await a.run('chooseTaskFiles(card,state.tasks[0],()=>markDirty())'); assert.equal(a.stored().tasks[0].localFiles.length, 2);
  a.run('filters.q="预算"'); assert.equal(a.run('matchFilter(state.tasks[0])'), true);
  assert.match(card.querySelector('.files').innerHTML, / 4$/);
});
test('File double-click opens exactly once; a single click has no opening handler', async () => {
  const a = setup(true); a.run('state.tasks[0].localFiles=[{id:"f",name:"方案.pdf",locations:{mac:"/project/方案.pdf"}}];markDirty()');
  const card = a.element('card-file'), row = a.element('file-row'); row.dataset.fileIndex = '0';
  card.querySelector('.local-file-list').querySelectorAll = selector => selector === '[data-file-index]' ? [row] : [];
  let opens = 0; a.bridge.openFile = async (task, ref) => { opens++; assert.equal(task, 't1'); assert.equal(ref, 'f'); return { ok: true, value: null }; };
  a.ctx.card = card; a.run('refreshLocalFileList(card,state.tasks[0],()=>markDirty())');
  assert.equal(row.querySelector('.local-file-open').onclick, undefined);
  await row.querySelector('.local-file-open').ondblclick(); assert.equal(opens, 1);
  row.querySelector('.local-file-open').onkeydown({ key: 'Enter', preventDefault() {} }); await Promise.resolve(); assert.equal(opens, 2);
  row.querySelector('.local-file-remove').onclick(); assert.equal(a.stored().tasks[0].localFiles.length, 0);
});
test('Canceling selection keeps legacy records and file count unchanged', async () => {
  const a = setup(true); a.ctx.card = a.element('card-cancel'); const before = a.run('JSON.stringify(state)');
  await a.run('chooseTaskFiles(card,state.tasks[0],()=>markDirty(),0)'); assert.equal(a.run('JSON.stringify(state)'), before);
});
test('Dropping files associates them with the task without changing its status or copying content', async () => {
  const a = setup(true), card = a.element('drop-card'); a.ctx.card = card;
  a.run('bindLocalFiles(card,state.tasks[0],()=>markDirty())');
  const files = [{ name: '拖入的文件.txt' }];
  a.bridge.droppedFiles = async received => { assert.deepEqual(Array.from(received), files); return { ok: true, value: [{ id: 'dropped', name: '拖入的文件.txt', locations: { mac: '/tmp/拖入的文件.txt' } }] }; };
  let prevented = false, stopped = false;
  await a.handlers['drop-card:drop']({ dataTransfer: { types: ['Files'], files }, preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
  assert.equal(prevented, true); assert.equal(stopped, true); assert.equal(a.stored().tasks[0].status, 'todo'); assert.equal(a.stored().tasks[0].localFiles[0].id, 'dropped');
});
test('Plain browser preview cannot claim to open or upload local files', async () => {
  const a = setup(false); a.ctx.card = a.element('card-browser'); await a.run('chooseTaskFiles(card,state.tasks[0],()=>markDirty())');
  assert.equal(a.nativeCalls.length, 0); assert.equal(a.run('state.tasks[0].localFiles.length'), 0); assert.match(a.element('fileInfo').innerHTML, /已存浏览器/);
});
test('Desktop CSP matches the actual inline script and disallows network and untrusted scripts', () => {
  for(const script of scripts){const hash=crypto.createHash('sha256').update(script).digest('base64');assert.ok(html.includes("'sha256-"+hash+"'"));}
  assert.ok(html.includes("connect-src 'none'")); assert.ok(!html.includes("script-src 'unsafe-inline'"));
});
test('Malformed native file metadata leaves existing board untouched', () => {
  const a = setup(true); const before = a.run('JSON.stringify(state)');
  a.ctx.data = JSON.parse(before); a.ctx.data.tasks[0].localFiles = [{ id: 'x', name: 'x', locations: { mac: 'relative-path' } }];
  assert.equal(a.run('loadData(data)'), false); assert.equal(a.run('JSON.stringify(state)'), before);
});

test('Sidebar and browser zoom survive reopening without modifying project data', async () => {
  const a = setup(false), before = a.run('JSON.stringify(state)');
  assert.equal(a.element('zoomResetBtn').textContent, '85%');
  assert.equal(a.element('projectSidebar').hidden, false);
  await a.element('sidebarToggle').onclick();
  assert.equal(a.element('projectSidebar').hidden, true);
  assert.equal(a.element('sidebarToggle').attributes['aria-expanded'], 'false');
  assert.equal(a.element('sidebarToggle').title, '展开侧边栏');
  await a.element('zoomOutBtn').onclick(); await a.element('zoomOutBtn').onclick();
  assert.equal(a.element('zoomResetBtn').textContent, '75%');
  const surface = a.element('appSurface');
  assert.equal(surface.style.transform, 'scale(0.75)');
  assert.ok(Math.abs(parseFloat(surface.style.width) * .75 - 100) < .001);
  assert.ok(Math.abs(parseFloat(surface.style.height) * .75 - 100) < .001);
  const b = setup(false, null, JSON.parse(a.storage.get('kanban-view-v1')));
  assert.equal(b.element('zoomResetBtn').textContent, '75%'); assert.equal(b.element('projectSidebar').hidden, true);
  for (let i = 0; i < 20; i++) await a.element('zoomOutBtn').onclick();
  assert.equal(a.element('zoomResetBtn').textContent, '70%'); assert.equal(a.element('zoomOutBtn').disabled, true);
  await a.element('zoomResetBtn').onclick(); assert.equal(a.element('zoomResetBtn').textContent, '100%');
  assert.equal(a.run('JSON.stringify(state)'), before);
});
test('Rapid desktop clicks are applied in order and menu events refresh the controls', async () => {
  const a = setup(true); let updates = [], listener;
  a.bridge.setView = async view => { await Promise.resolve(); updates.push(view); return { ok: true, value: view }; };
  a.bridge.onViewChanged = fn => { listener = fn; };
  a.run('initView()');
  await Promise.all([a.element('zoomOutBtn').onclick(), a.element('zoomOutBtn').onclick(), a.element('zoomInBtn').onclick()]);
  assert.deepEqual(updates.map(view => view.zoomPercent), [80, 75, 80]);
  assert.equal(a.element('zoomResetBtn').textContent, '80%');
  assert.equal(a.element('appSurface').style.transform, undefined);
  listener({ zoomPercent: 100, sidebarCollapsed: true });
  assert.equal(a.element('zoomResetBtn').textContent, '100%'); assert.equal(a.element('projectSidebar').hidden, true);
});
