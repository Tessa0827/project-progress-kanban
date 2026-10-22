'use strict';
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const STATUSES = new Set(['todo', 'doing', 'review', 'done']);
function validateState(source) {
  if (!source || !Array.isArray(source.projects) || !Array.isArray(source.tasks)) throw new Error('不是有效的看板数据文件');
  const data = JSON.parse(JSON.stringify(source));
  const projects = new Set(), tasks = new Set();
  for (const p of data.projects) {
    if (!p || typeof p.id !== 'string' || !p.id || projects.has(p.id) || typeof p.name !== 'string') throw new Error('项目编号重复或名称缺失');
    projects.add(p.id);
  }
  for (const task of data.tasks) {
    if (!task || typeof task.id !== 'string' || !task.id || tasks.has(task.id) || !projects.has(task.projectId) || !STATUSES.has(task.status)) throw new Error('任务数据不完整或编号重复');
    tasks.add(task.id);
    task.localFiles = normalizeRefs(task.localFiles);
  }
  return data;
}

function normalizeRefs(refs) {
  if (refs === undefined) return [];
  if (!Array.isArray(refs)) throw new Error('关联文件列表格式不正确');
  const ids = new Set();
  return refs.map(ref => {
    if (!ref || typeof ref.id !== 'string' || !ref.id || ids.has(ref.id) || typeof ref.name !== 'string' || !ref.name.trim()) throw new Error('关联文件编号或名称不正确');
    ids.add(ref.id);
    const locations = {};
    if (!ref.locations || typeof ref.locations !== 'object' || Array.isArray(ref.locations)) throw new Error('关联文件路径格式不正确');
    for (const [device, location] of Object.entries(ref.locations)) {
      if (device === '__proto__' || device === 'constructor' || device === 'prototype') continue;
      if (typeof location !== 'string' || !location || location.includes('\0') || (!path.posix.isAbsolute(location) && !path.win32.isAbsolute(location))) throw new Error('关联文件需要完整的本地路径');
      locations[device] = location;
    }
    return { id: ref.id, name: ref.name, locations };
  });
}

function fileRef(filename, deviceId, platform = process.platform) {
  if (typeof filename !== 'string' || filename.includes('\0') || !path.isAbsolute(filename)) throw new Error('请选择电脑中的文件');
  const stat = fs.statSync(filename);
  if (!stat.isFile() && !(platform === 'darwin' && stat.isDirectory() && /\.(app|pages|numbers|key)$/i.test(filename))) throw new Error('请拖入文件；普通文件夹暂不支持关联');
  return { id: crypto.randomUUID(), name: path.basename(filename), locations: { [deviceId]: filename } };
}

function findRef(state, taskId, refId) {
  const task = state?.tasks.find(t => t.id === taskId);
  return task?.localFiles?.find(ref => ref.id === refId);
}

class StateStore {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.filename = path.join(dir, 'kanban-data.json');
    this.backup = path.join(dir, 'kanban-data.previous.json');
    this.error = '';
    this.state = null;
    if (fs.existsSync(this.filename)) {
      try { this.state = validateState(JSON.parse(fs.readFileSync(this.filename, 'utf8'))); }
      catch (_) { this.error = '本机看板数据未能读取，原文件已保留。请从“打开文件”导入备份，或从数据文件夹取回 previous 文件。'; }
    }
  }
  save(source, { recover = false } = {}) {
    if (this.error && !recover) throw new Error(this.error);
    const next = validateState(source);
    const tmp = this.filename + '.tmp';
    const raw = JSON.stringify(next, null, 2);
    const fd = fs.openSync(tmp, 'w', 0o600);
    try { fs.writeFileSync(fd, raw, 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    if (fs.existsSync(this.filename)) {
      if (this.error) fs.copyFileSync(this.filename, this.filename + '.unreadable-' + Date.now());
      else fs.copyFileSync(this.filename, this.backup);
    }
    fs.renameSync(tmp, this.filename);
    this.state = next;
    this.error = '';
    return next;
  }
}

module.exports = { validateState, normalizeRefs, fileRef, findRef, StateStore };
