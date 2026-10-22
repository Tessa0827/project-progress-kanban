'use strict';
const fs = require('node:fs');
const path = require('node:path');

function normalizeView(value) {
  value = value || {};
  return {
    zoomPercent: typeof value.zoomPercent === 'number' && Number.isFinite(value.zoomPercent)
      ? Math.max(70, Math.min(125, Math.round(value.zoomPercent / 5) * 5)) : 85,
    sidebarCollapsed: value.sidebarCollapsed === true
  };
}
class ViewStore {
  constructor(dir) {
    this.filename = path.join(dir, 'view-preferences.json');
    let saved;
    try { saved = JSON.parse(fs.readFileSync(this.filename, 'utf8')); } catch (_) {}
    this.value = normalizeView(saved);
  }
  save(change) {
    const next = normalizeView({ ...this.value, ...change });
    const temp = this.filename + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(next), { mode: 0o600 });
    fs.renameSync(temp, this.filename);
    this.value = next;
    return next;
  }
}
module.exports = { ViewStore, normalizeView };
