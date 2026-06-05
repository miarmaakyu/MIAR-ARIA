const path = require('path');
const fs = require('fs');
const { app } = require('electron');

let userDataPath = null;
let conversationsDir = null;
let settingsFile = null;
let metaFile = null;
let logsFile = null;

function init() {
  userDataPath = app.getPath('userData');
  conversationsDir = path.join(userDataPath, 'conversations');
  settingsFile = path.join(userDataPath, 'settings.json');
  metaFile = path.join(userDataPath, 'meta.json');
  logsFile = path.join(userDataPath, 'miar-aria.log');

  if (!fs.existsSync(conversationsDir)) fs.mkdirSync(conversationsDir, { recursive: true });
  if (!fs.existsSync(settingsFile)) fs.writeFileSync(settingsFile, JSON.stringify({ apiKeys: {}, ttsEnabled: true, ttsVoice: '', ttsRate: 1.0, ttsPitch: 1.1 }), 'utf8');
  if (!fs.existsSync(metaFile)) fs.writeFileSync(metaFile, JSON.stringify({ lastConversationId: null }), 'utf8');
}

function readJSON(file, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function getSettings() {
  const s = readJSON(settingsFile, { apiKeys: {}, ttsEnabled: true, ttsVoice: '', ttsRate: 1.0, ttsPitch: 1.1 });
  const masked = { ...s };
  if (masked.apiKeys) {
    masked.apiKeysMasked = {};
    for (const [k, v] of Object.entries(masked.apiKeys)) {
      masked.apiKeysMasked[k] = v ? '••••••••' + v.slice(-4) : '';
      masked.apiKeysSet = masked.apiKeysSet || {};
      masked.apiKeysSet[k] = !!v;
    }
    delete masked.apiKeys;
  }
  return masked;
}

function saveSettings(incoming) {
  const current = readJSON(settingsFile, { apiKeys: {} });
  const updated = { ...current };
  if (incoming.apiKeys) {
    updated.apiKeys = updated.apiKeys || {};
    for (const [k, v] of Object.entries(incoming.apiKeys)) {
      if (v && v !== '••••••••' + (current.apiKeys?.[k] || '').slice(-4)) {
        updated.apiKeys[k] = v;
      }
    }
  }
  if (incoming.ttsEnabled !== undefined) updated.ttsEnabled = incoming.ttsEnabled;
  if (incoming.ttsVoice !== undefined) updated.ttsVoice = incoming.ttsVoice;
  if (incoming.ttsRate !== undefined) updated.ttsRate = incoming.ttsRate;
  if (incoming.ttsPitch !== undefined) updated.ttsPitch = incoming.ttsPitch;
  writeJSON(settingsFile, updated);
  appendLog(`[SETTINGS] Configurações salvas.`);
  return { ok: true };
}

function getConversations() {
  const files = fs.readdirSync(conversationsDir).filter(f => f.endsWith('.json'));
  const list = [];
  for (const f of files) {
    try {
      const data = readJSON(path.join(conversationsDir, f));
      list.push({
        id: data.id,
        title: data.title || 'Conversa sem título',
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
        messageCount: (data.messages || []).length,
      });
    } catch {}
  }
  return list.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

function getConversation(id) {
  const file = path.join(conversationsDir, `${id}.json`);
  if (!fs.existsSync(file)) return null;
  return readJSON(file);
}

function createConversation(title) {
  const id = `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();
  const conv = { id, title: title || 'Nova conversa', createdAt: now, updatedAt: now, messages: [] };
  writeJSON(path.join(conversationsDir, `${id}.json`), conv);
  setLastConversationId(id);
  return conv;
}

function saveMessage(conversationId, role, content, attachments) {
  const file = path.join(conversationsDir, `${conversationId}.json`);
  const conv = readJSON(file);
  if (!conv.id) return { ok: false, error: 'Conversa não encontrada.' };
  const message = {
    id: `msg_${Date.now()}`,
    role,
    content,
    attachments: attachments || [],
    timestamp: new Date().toISOString(),
  };
  conv.messages = conv.messages || [];
  conv.messages.push(message);
  conv.updatedAt = message.timestamp;
  if (!conv.title || conv.title === 'Nova conversa') {
    if (role === 'user' && content) {
      conv.title = content.substring(0, 60) + (content.length > 60 ? '…' : '');
    }
  }
  writeJSON(file, conv);
  return { ok: true, message };
}

function updateConversationTitle(id, title) {
  const file = path.join(conversationsDir, `${id}.json`);
  const conv = readJSON(file);
  if (!conv.id) return { ok: false };
  conv.title = title;
  conv.updatedAt = new Date().toISOString();
  writeJSON(file, conv);
  return { ok: true };
}

function deleteConversation(id) {
  const file = path.join(conversationsDir, `${id}.json`);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  const meta = readJSON(metaFile);
  if (meta.lastConversationId === id) {
    meta.lastConversationId = null;
    writeJSON(metaFile, meta);
  }
  return { ok: true };
}

function searchConversations(query) {
  const q = (query || '').toLowerCase();
  const files = fs.readdirSync(conversationsDir).filter(f => f.endsWith('.json'));
  const results = [];
  for (const f of files) {
    try {
      const data = readJSON(path.join(conversationsDir, f));
      const inTitle = (data.title || '').toLowerCase().includes(q);
      const inMessages = (data.messages || []).some(m =>
        (m.content || '').toLowerCase().includes(q)
      );
      if (inTitle || inMessages) {
        results.push({ id: data.id, title: data.title, updatedAt: data.updatedAt });
      }
    } catch {}
  }
  return results.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

function getLastConversationId() {
  return readJSON(metaFile).lastConversationId || null;
}

function setLastConversationId(id) {
  const meta = readJSON(metaFile, {});
  meta.lastConversationId = id;
  writeJSON(metaFile, meta);
}

function appendLog(line) {
  try {
    const ts = new Date().toISOString();
    fs.appendFileSync(logsFile, `${ts} ${line}\n`, 'utf8');
  } catch {}
}

function getKeysRaw() {
  return readJSON(settingsFile, { apiKeys: {} }).apiKeys || {};
}

function getSettingsRaw() {
  return readJSON(settingsFile, { apiKeys: {} });
}

module.exports = {
  init, getSettings, saveSettings,
  getConversations, getConversation,
  createConversation, saveMessage,
  updateConversationTitle, deleteConversation,
  searchConversations, getLastConversationId, setLastConversationId,
  appendLog, getKeysRaw, getSettingsRaw,
};
