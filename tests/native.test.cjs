'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const appDir = path.resolve(__dirname, '../app');
async function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-native-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const sync = {}, asyncIPC = {}, opened = [], revealed = [], dialogs = { files: [], messages: [] }, browserEvents = {};
  let window, permission, requestFilter, menu;
  class Window {
    constructor(options) { window = this; this.options = options; this.messages = []; this.webContents = { mainFrame: { url: '' }, setZoomFactor(value) { this.zoom = value; }, setWindowOpenHandler(fn) { this.newWindow = fn; }, on(k, fn) { browserEvents[k] = fn; }, send: (...args) => this.messages.push(args) }; }
    loadFile(filename) { this.webContents.mainFrame.url = pathToFileURL(filename).href; }
    on() {} isMinimized() { return false; } show() {} focus() {} isDestroyed() { return false; } destroy() {}
  }
  const electron = {
    app: { setName() {}, getPath: () => dir, setPath() {}, setAppUserModelId() {}, requestSingleInstanceLock: () => true, whenReady: () => Promise.resolve(), on() {}, quit() {} }, BrowserWindow: Window,
    ipcMain: { on(k, fn) { sync[k] = fn; }, handle(k, fn) { asyncIPC[k] = fn; } },
    dialog: { showOpenDialog: async () => dialogs.files.shift() || { canceled: true, filePaths: [] }, showMessageBox: async () => dialogs.messages.shift() || { response: 1 }, showErrorBox() {} },
    shell: { openPath: async filename => { opened.push(filename); return ''; }, showItemInFolder(filename) { revealed.push(filename); } }, Menu: { buildFromTemplate: a => a, setApplicationMenu(value) { menu = value; } },
    session: { defaultSession: { setPermissionRequestHandler(fn) { permission = fn; }, setPermissionCheckHandler() {}, webRequest: { onBeforeRequest(fn) { requestFilter = fn; } } } }
  };
  const context = vm.createContext({ require: name => name === 'electron' ? electron : name.startsWith('./') ? require(path.join(appDir, name)) : require(name), __dirname: appDir, process, structuredClone, console });
  vm.runInContext(fs.readFileSync(path.join(appDir, 'main.cjs'), 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  const event = () => ({ sender: window.webContents, senderFrame: window.webContents.mainFrame });
  const callSync = (name, ...args) => { const e = event(); sync[name](e, ...args); return e.returnValue; };
  const call = (name, ...args) => asyncIPC[name](event(), ...args);
  const state = { version: 1, activeProject: 'p', projects: [{ id: 'p', name: '项目' }], tasks: [{ id: 't', projectId: 'p', status: 'todo', localFiles: [] }] };
  return { dir, dialogs, opened, revealed, call, callSync, state, sync, asyncIPC, event, permission: () => permission, requestFilter: () => requestFilter, browserEvents, electron, window, menu };
}
test('Native picker, disk persistence, OS opening, folder reveal and removal work by reference ID', async t => {
  const a = await setup(t), filename = path.join(a.dir, '文件 #1&测试.pdf'); fs.writeFileSync(filename, 'content');
  a.dialogs.files.push({ canceled: false, filePaths: [filename] }); const picked = await a.call('kanban:choose-files'); assert.ok(picked.ok);
  a.state.tasks[0].localFiles = picked.value; assert.ok(a.callSync('kanban:save', a.state).ok);
  const ref = picked.value[0]; assert.ok((await a.call('kanban:open-file', 't', ref.id)).ok); assert.deepEqual(a.opened, [filename]);
  await a.call('kanban:reveal-file', 't', ref.id); assert.deepEqual(a.revealed, [filename]);
  a.state.tasks[0].localFiles = []; a.callSync('kanban:save', a.state);
  assert.equal((await a.call('kanban:open-file', 't', ref.id)).ok, false); assert.equal(fs.readFileSync(filename, 'utf8'), 'content');
});
test('Missing file can be relinked on a different machine without losing old machine paths', async t => {
  const a = await setup(t), filename = path.join(a.dir, '预算最终版.xlsx'); fs.writeFileSync(filename, 'content');
  a.state.tasks[0].localFiles = [{ id: 'ref', name: '预算.xlsx', locations: { otherMac: '/Users/another/预算.xlsx', otherWin: 'C:\\预算.xlsx' } }];
  a.callSync('kanban:save', a.state); a.dialogs.messages.push({ response: 0 }); a.dialogs.files.push({ canceled: false, filePaths: [filename] });
  const result = await a.call('kanban:open-file', 't', 'ref'); assert.ok(result.ok);
  assert.equal(result.value.ref.name, '预算最终版.xlsx'); assert.equal(result.value.ref.locations.otherWin, 'C:\\预算.xlsx'); assert.ok(Object.values(result.value.ref.locations).includes(filename)); assert.deepEqual(a.opened, [filename]);
  const stored = a.callSync('kanban:load').value.state; assert.ok(Object.values(stored.tasks[0].localFiles[0].locations).includes(filename));
});
test('Canceling a missing-file dialog preserves metadata and opens nothing', async t => {
  const a = await setup(t); a.state.tasks[0].localFiles = [{ id: 'f', name: '丢失.pdf', locations: {} }]; a.callSync('kanban:save', a.state);
  const before = JSON.stringify(a.callSync('kanban:load').value.state);
  const result = await a.call('kanban:open-file', 't', 'f'); assert.equal(result.value, null); assert.equal(a.opened.length, 0); assert.equal(JSON.stringify(a.callSync('kanban:load').value.state), before);
});
test('Unsafe IPC senders, remote requests and navigations are blocked', async t => {
  const a = await setup(t); const response = await a.asyncIPC['kanban:open-file']({ sender: {}, senderFrame: { url: 'https://other/' } }, 't', 'f'); assert.equal(response.ok, false);
  const e = { sender: {}, senderFrame: {} }; a.sync['kanban:save'](e, a.state); assert.equal(e.returnValue.ok, false);
  let denied = false; a.requestFilter()({ url: 'https://example.com/upload' }, value => { denied = value.cancel; }); assert.equal(denied, true);
  let prevented = false; a.browserEvents['will-navigate']({ preventDefault() { prevented = true; } }, 'https://example.com'); assert.equal(prevented, true);
  assert.equal(a.window.webContents.newWindow().action, 'deny');
});
test('A failed OS open reports a useful error without changing the original', async t => {
  const a = await setup(t), filename = path.join(a.dir, '未知格式.special'); fs.writeFileSync(filename, 'original');
  const refs = await a.call('kanban:describe-files', [filename]); a.state.tasks[0].localFiles = refs.value; a.callSync('kanban:save', a.state);
  a.electron.shell.openPath = async () => 'No application'; const result = await a.call('kanban:open-file', 't', refs.value[0].id);
  assert.ok(result.value.error.includes('对应软件')); assert.equal(fs.readFileSync(filename, 'utf8'), 'original');
});
test('View controls use native zoom, persist separately, and stay synchronized with the menu', async t => {
  const a = await setup(t);
  assert.equal(a.window.options.webPreferences.zoomFactor, .85);
  a.browserEvents['did-finish-load'](); assert.equal(a.window.webContents.zoom, .85);
  a.callSync('kanban:save', a.state);
  const before = JSON.stringify(a.callSync('kanban:load').value.state);
  const response = await a.call('kanban:set-view', { zoomPercent: 75, sidebarCollapsed: true });
  assert.equal(response.ok, true); assert.equal(a.window.webContents.zoom, .75);
  const { ViewStore } = require('../app/view.cjs');
  const saved = new ViewStore(path.join(a.dir, 'ProjectProgressKanban')).value;
  assert.equal(saved.zoomPercent, 75); assert.equal(saved.sidebarCollapsed, true);
  const display = a.menu.find(item => item.label === '显示').submenu;
  display.find(item => item.label === '放大').click(); assert.equal(a.window.webContents.zoom, .8);
  display.find(item => item.accelerator === 'CmdOrCtrl+B').click();
  assert.equal(a.callSync('kanban:load').value.view.sidebarCollapsed, false);
  assert.equal(a.window.messages.at(-1)[0], 'kanban:view-changed');
  assert.equal(a.window.messages.at(-1)[1].zoomPercent, 80);
  display.find(item => item.accelerator === 'CmdOrCtrl+0').click(); assert.equal(a.window.webContents.zoom, 1);
  await a.call('kanban:set-view', { zoomPercent: 999 }); assert.equal(a.window.webContents.zoom, 1.25);
  assert.equal(JSON.stringify(a.callSync('kanban:load').value.state), before);
  assert.equal((await a.asyncIPC['kanban:set-view']({ sender: {}, senderFrame: {} }, { zoomPercent: 70 })).ok, false);
});
