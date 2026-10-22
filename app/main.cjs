'use strict';
const { app, BrowserWindow, dialog, ipcMain, Menu, shell, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { StateStore, validateState, fileRef, findRef } = require('./model.cjs');
const { ViewStore } = require('./view.cjs');

app.setName('项目进度看板');
// Stable across app updates and across source/packaged launch locations.
const dataDir = path.join(app.getPath('appData'), 'ProjectProgressKanban');
app.setPath('userData', dataDir);
if (process.platform === 'win32') app.setAppUserModelId('local.project-progress-kanban');
let win, store, deviceId, viewStore;
const page = path.join(__dirname, 'kanban.html');
const pageURL = pathToFileURL(page).href;
const ok = value => ({ ok: true, value });
const fail = error => ({ ok: false, error: error.message || String(error) });
function trusted(event) {
  if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || event.senderFrame.url !== pageURL) throw new Error('仅允许看板窗口执行此操作');
}
function handle(channel, action) {
  ipcMain.handle(channel, async (event, ...args) => {
    try { trusted(event); return ok(await action(...args)); } catch (error) { return fail(error); }
  });
}
function setView(change) {
  const value = viewStore.save(change);
  if (win && !win.isDestroyed()) {
    win.webContents.setZoomFactor(value.zoomPercent / 100);
    win.webContents.send('kanban:view-changed', value);
  }
  return value;
}
function menuView(change) {
  try { setView(change); }
  catch (error) { dialog.showErrorBox('显示设置未保存', error.message); }
}
function getRef(taskId, refId) {
  const ref = findRef(store.state, taskId, refId);
  if (!ref) throw new Error('这条文件关联已移除，请重新关联');
  return ref;
}
function currentPath(ref) {
  const filename = ref.locations[deviceId];
  return filename && path.isAbsolute(filename) && fs.existsSync(filename) ? filename : null;
}
async function resolveFile(taskId, refId) {
  const ref = getRef(taskId, refId);
  const existing = currentPath(ref);
  if (existing) return { filename: existing, ref };
  const result = await dialog.showMessageBox(win, {
    type: 'question', title: '重新关联文件',
    message: '在这台电脑上找不到“' + ref.name + '”',
    detail: '文件可能移动了位置，或来自另一台电脑。选择本机的对应文件后，下次即可直接打开。',
    buttons: ['选择对应文件', '取消'], defaultId: 0, cancelId: 1
  });
  if (result.response !== 0) return null;
  const picked = await dialog.showOpenDialog(win, { title: '重新关联：' + ref.name, properties: ['openFile'] });
  if (picked.canceled || !picked.filePaths.length) return null;
  const latest = getRef(taskId, refId);
  const selected = fileRef(picked.filePaths[0], deviceId);
  const replacement = { ...latest, name: selected.name, locations: { ...latest.locations, [deviceId]: selected.locations[deviceId] } };
  const next = structuredClone(store.state);
  Object.assign(findRef(next, taskId, refId), replacement);
  store.save(next);
  return { filename: picked.filePaths[0], ref: replacement };
}
function registerIPC() {
  ipcMain.on('kanban:load', event => {
    try { trusted(event); event.returnValue = ok({ state: store.state, error: store.error, deviceId, dataPath: store.filename, view: viewStore.value }); }
    catch (error) { event.returnValue = fail(error); }
  });
  ipcMain.on('kanban:save', (event, source, recover) => {
    try { trusted(event); store.save(source, { recover: recover === true }); event.returnValue = ok(true); }
    catch (error) { event.returnValue = fail(error); }
  });
  handle('kanban:set-view', value => setView(value));
  handle('kanban:choose-files', async () => {
    const picked = await dialog.showOpenDialog(win, { title: '关联本地文件（保留原位置）', properties: ['openFile', 'multiSelections'] });
    return picked.canceled ? [] : picked.filePaths.map(filename => fileRef(filename, deviceId));
  });
  handle('kanban:describe-files', paths => {
    if (!Array.isArray(paths) || paths.length > 1000) throw new Error('请一次关联不超过 1000 个文件');
    return paths.map(filename => fileRef(filename, deviceId));
  });
  handle('kanban:open-file', async (taskId, refId) => {
    const resolved = await resolveFile(taskId, refId);
    if (!resolved) return null;
    // openPath passes the filename directly to the OS; no shell command is constructed.
    let error;
    try { error = await shell.openPath(resolved.filename); } catch (failure) { error = failure.message; }
    return { ref: resolved.ref, error: error ? '系统未能打开文件。请确认已安装对应软件，或点击文件夹按钮定位文件。' : '' };
  });
  handle('kanban:reveal-file', async (taskId, refId) => {
    const resolved = await resolveFile(taskId, refId);
    if (!resolved) return null;
    shell.showItemInFolder(resolved.filename);
    return { ref: resolved.ref };
  });
  handle('kanban:import', async () => {
    const picked = await dialog.showOpenDialog(win, { title: '导入看板数据', filters: [{ name: '看板数据 JSON', extensions: ['json'] }], properties: ['openFile'] });
    if (picked.canceled || !picked.filePaths.length) return null;
    const raw = fs.readFileSync(picked.filePaths[0], 'utf8').replace(/^\uFEFF/, '');
    const data = validateState(JSON.parse(raw));
    return { data, name: path.basename(picked.filePaths[0]) };
  });
  handle('kanban:export', async source => {
    const data = validateState(source);
    const picked = await dialog.showSaveDialog(win, { title: '导出看板备份', defaultPath: '项目进度看板备份.json', filters: [{ name: '看板数据 JSON', extensions: ['json'] }] });
    if (picked.canceled || !picked.filePath) return null;
    fs.writeFileSync(picked.filePath, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
    return path.basename(picked.filePath);
  });
  handle('kanban:reveal-data', async () => { shell.showItemInFolder(store.filename); return true; });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1320, height: 850, minWidth: 800, minHeight: 580,
    title: '项目进度看板', backgroundColor: '#ffffff',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, zoomFactor: viewStore.value.zoomPercent / 100 }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => { if (url !== pageURL) event.preventDefault(); });
  win.webContents.on('will-attach-webview', event => event.preventDefault());
  win.webContents.on('did-finish-load', () => win?.webContents.setZoomFactor(viewStore.value.zoomPercent / 100));
  win.webContents.on('will-prevent-unload', async event => {
    const answer = await dialog.showMessageBox(win, { type: 'warning', message: '有内容未能保存到本机。', detail: '建议先回到看板，使用“保存文件”导出备份。', buttons: ['返回看板', '仍然关闭'], defaultId: 0, cancelId: 0 });
    if (answer.response === 1 && !win.isDestroyed()) win.destroy();
  });
  win.on('closed', () => { win = null; });
  win.loadFile(page);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
  app.whenReady().then(() => {
    store = new StateStore(dataDir);
    viewStore = new ViewStore(dataDir);
    const identity = path.join(dataDir, 'device-id');
    if (fs.existsSync(identity)) deviceId = fs.readFileSync(identity, 'utf8').trim();
    if (!/^[a-f0-9-]{36}$/.test(deviceId || '')) { deviceId = crypto.randomUUID(); fs.writeFileSync(identity, deviceId, { mode: 0o600 }); }
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      callback({ cancel: !details.url.startsWith('file:') && !details.url.startsWith('data:') && !details.url.startsWith('blob:') });
    });
    registerIPC();
    const send = action => win?.webContents.send('kanban:menu', action);
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ role: 'appMenu', label: '项目进度看板' }] : []),
      { label: '文件', submenu: [
        { label: '导入看板数据…', accelerator: 'CmdOrCtrl+O', click: () => send('import') },
        { label: '导出看板备份…', accelerator: 'CmdOrCtrl+Shift+S', click: () => send('export') },
        { type: 'separator' }, { label: '打开本机数据文件夹', click: () => shell.showItemInFolder(store.filename) },
        ...(process.platform !== 'darwin' ? [{ type: 'separator' }, { role: 'quit', label: '退出' }] : [])
      ] },
      { label: '编辑', submenu: [{ role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' }, { type: 'separator' }, { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' }, { role: 'paste', label: '粘贴' }, { role: 'selectAll', label: '全选' }] },
      { label: '显示', submenu: [
        { label: '实际大小（100%）', accelerator: 'CmdOrCtrl+0', click: () => menuView({ zoomPercent: 100 }) },
        { label: '放大', accelerator: 'CmdOrCtrl+Plus', click: () => menuView({ zoomPercent: viewStore.value.zoomPercent + 5 }) },
        { label: '缩小', accelerator: 'CmdOrCtrl+-', click: () => menuView({ zoomPercent: viewStore.value.zoomPercent - 5 }) },
        { type: 'separator' },
        { label: '展开／收起侧边栏', accelerator: 'CmdOrCtrl+B', click: () => menuView({ sidebarCollapsed: !viewStore.value.sidebarCollapsed }) },
        { type: 'separator' }, { role: 'togglefullscreen', label: '全屏' }
      ] }
    ]));
    createWindow();
    app.on('activate', () => { if (!win) createWindow(); });
  }).catch(error => { dialog.showErrorBox('看板启动失败', error.message); app.quit(); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
