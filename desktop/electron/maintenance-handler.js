const path = require('path');
const fs = require('fs');
const { app } = require('electron');

const APP_DIR = path.join(__dirname, '..');

function getAppStructure() {
  const result = [];
  function walk(dir, prefix = '') {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        if (['node_modules', 'dist', '.git'].includes(e.name)) continue;
        const rel = path.join(prefix, e.name);
        if (e.isDirectory()) {
          result.push({ type: 'dir', path: rel });
          walk(path.join(dir, e.name), rel);
        } else {
          const stat = fs.statSync(path.join(dir, e.name));
          result.push({ type: 'file', path: rel, size: stat.size });
        }
      }
    } catch {}
  }
  walk(APP_DIR);
  return { ok: true, structure: result, appDir: APP_DIR };
}

function createBackup() {
  try {
    const userDataPath = app.getPath('userData');
    const backupDir = path.join(userDataPath, 'backups');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(backupDir, `backup_${ts}.json`);
    const conversationsDir = path.join(userDataPath, 'conversations');
    const settingsFile = path.join(userDataPath, 'settings.json');
    const backup = { createdAt: new Date().toISOString(), conversations: {}, settings: {} };
    if (fs.existsSync(settingsFile)) {
      const raw = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
      backup.settings = { ...raw, apiKeys: Object.fromEntries(Object.keys(raw.apiKeys || {}).map(k => [k, '[REDACTED]'])) };
    }
    if (fs.existsSync(conversationsDir)) {
      const files = fs.readdirSync(conversationsDir).filter(f => f.endsWith('.json'));
      for (const f of files) {
        try {
          backup.conversations[f] = JSON.parse(fs.readFileSync(path.join(conversationsDir, f), 'utf8'));
        } catch {}
      }
    }
    fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2), 'utf8');
    return { ok: true, backupFile, conversationCount: Object.keys(backup.conversations).length };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function getLogs() {
  try {
    const userDataPath = app.getPath('userData');
    const logsFile = path.join(userDataPath, 'miar-aria.log');
    if (!fs.existsSync(logsFile)) return { ok: true, logs: '' };
    const content = fs.readFileSync(logsFile, 'utf8');
    const lines = content.split('\n').slice(-200);
    return { ok: true, logs: lines.join('\n') };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { getAppStructure, createBackup, getLogs };
