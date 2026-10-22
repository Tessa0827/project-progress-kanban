'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { StateStore, fileRef, validateState } = require('../app/model.cjs');
const sample = () => ({ version: 1, projects: [{ id: 'p1', name: '真实项目' }], tasks: [{ id: 't1', projectId: 'p1', status: 'todo', title: '真实任务', files: ['旧附件说明'], estimate: 8 }] });
function temp(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-test-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }

test('Associating a Unicode file records metadata without copying or modifying the original', t => {
  const dir = temp(t), filename = path.join(dir, '预算表 2026「最终版」#1 & $() `本地`.xlsx');
  fs.writeFileSync(filename, '原来的文件内容');
  const ref = fileRef(filename, 'device-mac');
  assert.equal(ref.name, path.basename(filename)); assert.equal(ref.locations['device-mac'], filename);
  assert.equal(fs.readFileSync(filename, 'utf8'), '原来的文件内容');
  assert.deepEqual(fs.readdirSync(dir), [path.basename(filename)]);
});
test('Persistent state writes atomically, reloads and keeps the previous valid snapshot', t => {
  const dir = temp(t), store = new StateStore(dir), state = sample();
  store.save(state); state.tasks[0].title = '最新任务'; store.save(state);
  assert.equal(new StateStore(dir).state.tasks[0].title, '最新任务');
  assert.equal(JSON.parse(fs.readFileSync(store.backup)).tasks[0].title, '真实任务');
  assert.equal(fs.existsSync(store.filename + '.tmp'), false);
});
test('Invalid saves leave existing disk state intact', t => {
  const store = new StateStore(temp(t)); store.save(sample());
  assert.throws(() => store.save({ projects: [], tasks: [{ id: 't', projectId: 'missing', status: 'todo' }] }));
  assert.equal(JSON.parse(fs.readFileSync(store.filename)).tasks[0].title, '真实任务');
});
test('Corrupt disk data is preserved, and only an explicit recovery can replace it', t => {
  const dir = temp(t), filename = path.join(dir, 'kanban-data.json'); fs.writeFileSync(filename, '{ broken');
  const store = new StateStore(dir); assert.ok(store.error); assert.throws(() => store.save(sample()));
  assert.equal(fs.readFileSync(filename, 'utf8'), '{ broken');
  store.save(sample(), { recover: true });
  const archived = fs.readdirSync(dir).find(name => name.includes('.unreadable-'));
  assert.ok(archived); assert.equal(fs.readFileSync(path.join(dir, archived), 'utf8'), '{ broken');
});
test('Removing a reference never deletes the original file', t => {
  const dir = temp(t), filename = path.join(dir, '方案.pdf'); fs.writeFileSync(filename, 'original');
  const state = sample(), store = new StateStore(path.join(dir, 'data')); state.tasks[0].localFiles = [fileRef(filename, 'mac')]; store.save(state);
  state.tasks[0].localFiles = []; store.save(state);
  assert.equal(fs.readFileSync(filename, 'utf8'), 'original'); assert.equal(new StateStore(store.dir).state.tasks[0].localFiles.length, 0);
});
test('One reference preserves different machine paths, all task metadata and legacy references', () => {
  const state = sample(); state.tasks[0].localFiles = [{ id: 'file1', name: '预算.xlsx', locations: { mac1: '/Users/me/预算.xlsx', win1: 'D:\\项目\\预算.xlsx', win2: '\\\\NAS\\share\\预算.xlsx' } }];
  const data = validateState(state);
  assert.deepEqual(data.tasks[0].localFiles, state.tasks[0].localFiles); assert.equal(data.tasks[0].estimate, 8); assert.deepEqual(data.tasks[0].files, ['旧附件说明']);
});
test('Malformed, duplicate and relative local references are rejected', () => {
  for (const refs of ['bad', [{ id: 'f', name: '', locations: {} }], [{ id: 'f', name: 'x', locations: { mac: 'relative/x' } }], [{ id: 'f', name: 'x', locations: { mac: '/bad\0path' } }], [{ id: 'f', name: 'x', locations: {} }, { id: 'f', name: 'x', locations: {} }]]) {
    const state = sample(); state.tasks[0].localFiles = refs; assert.throws(() => validateState(state));
  }
});
test('Directories are rejected, but macOS document packages remain usable', t => {
  const dir = temp(t); assert.throws(() => fileRef(dir, 'mac'));
  const document = path.join(dir, '项目.pages'); fs.mkdirSync(document); assert.equal(fileRef(document, 'mac', 'darwin').name, '项目.pages');
});
