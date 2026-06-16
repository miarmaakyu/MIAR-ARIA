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
  if (!fs.existsSync(settingsFile)) {
    fs.writeFileSync(settingsFile, JSON.stringify({
      apiKeys: { groq: [], gemini: [], openrouter: [], mem0: '' },
      ttsEnabled: true, ttsVoice: '', ttsRate: 1.0, ttsPitch: 1.1,
      memoryEnabled: true,
    }), 'utf8');
  }
  if (!fs.existsSync(metaFile)) fs.writeFileSync(metaFile, JSON.stringify({ lastConversationId: null }), 'utf8');
}

function readJSON(file, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJSON(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8'); }

// ── SETTINGS ─────────────────────────────────────────────────────────────────

/** Mascara uma chave: mostra prefixo + últimos 4 chars */
function maskKey(key) {
  if (!key || key.length < 8) return '****';
  return key.substring(0, 8) + '••••••••' + key.slice(-4);
}

function getSettings() {
  const s = readJSON(settingsFile, { apiKeys: {} });
  const result = {
    ttsEnabled: s.ttsEnabled ?? true,
    ttsVoice: s.ttsVoice || '',
    ttsRate: s.ttsRate || 1.0,
    ttsPitch: s.ttsPitch || 1.1,
    memoryEnabled: s.memoryEnabled ?? true,
    customInstructions: s.customInstructions || '',
    userEmail: s.userEmail || '',
    apiKeysSet: {},
    apiKeysCounts: {},
    apiKeysMasked: {},   // versão mascarada para exibição
  };
  const raw = s.apiKeys || {};
  for (const provider of ['groq', 'gemini', 'openrouter', 'mem0']) {
    const val = raw[provider];
    if (Array.isArray(val)) {
      const valid = val.filter(Boolean);
      result.apiKeysCounts[provider] = valid.length;
      result.apiKeysSet[provider]    = valid.length > 0;
      result.apiKeysMasked[provider] = valid.map(maskKey);
    } else {
      result.apiKeysCounts[provider] = val ? 1 : 0;
      result.apiKeysSet[provider]    = !!val;
      result.apiKeysMasked[provider] = val ? [maskKey(val)] : [];
    }
  }
  return result;
}

/** Adiciona novas chaves a um provider sem apagar as existentes (sem duplicatas) */
function appendProviderKeys(provider, newKeys) {
  const current = readJSON(settingsFile, { apiKeys: {} });
  current.apiKeys = current.apiKeys || {};
  const existing = Array.isArray(current.apiKeys[provider]) ? current.apiKeys[provider] : (current.apiKeys[provider] ? [current.apiKeys[provider]] : []);
  const merged = [...existing];
  for (const k of newKeys) {
    if (k && !merged.includes(k)) merged.push(k);
  }
  current.apiKeys[provider] = merged.filter(Boolean);
  writeJSON(settingsFile, current);
  appendLog(`[SETTINGS] ${newKeys.length} chave(s) adicionada(s) ao ${provider}. Total: ${merged.length}`);
  return { ok: true, total: merged.length };
}

/** Remove todas as chaves de um provider */
function deleteProviderKeys(provider) {
  const current = readJSON(settingsFile, { apiKeys: {} });
  current.apiKeys = current.apiKeys || {};
  if (provider === 'mem0') current.apiKeys.mem0 = '';
  else current.apiKeys[provider] = [];
  writeJSON(settingsFile, current);
  appendLog(`[SETTINGS] Chaves de ${provider} apagadas.`);
  return { ok: true };
}

/** Remove uma chave específica pelo índice */
function deleteProviderKey(provider, index) {
  const current = readJSON(settingsFile, { apiKeys: {} });
  current.apiKeys = current.apiKeys || {};
  const arr = Array.isArray(current.apiKeys[provider]) ? current.apiKeys[provider] : [];
  arr.splice(index, 1);
  current.apiKeys[provider] = arr.filter(Boolean);
  writeJSON(settingsFile, current);
  appendLog(`[SETTINGS] Chave ${index} de ${provider} apagada.`);
  return { ok: true };
}

function saveSettings(incoming) {
  const current = readJSON(settingsFile, { apiKeys: { groq: [], gemini: [], openrouter: [], mem0: '' } });
  const updated = { ...current };

  if (incoming.apiKeys) {
    updated.apiKeys = updated.apiKeys || {};
    for (const [provider, val] of Object.entries(incoming.apiKeys)) {
      if (provider === 'mem0') {
        if (val && typeof val === 'string' && !val.startsWith('•')) updated.apiKeys.mem0 = val.trim();
      } else if (Array.isArray(val)) {
        const existing = Array.isArray(updated.apiKeys[provider]) ? updated.apiKeys[provider] : (updated.apiKeys[provider] ? [updated.apiKeys[provider]] : []);
        updated.apiKeys[provider] = val.map((v, i) => {
          if (!v || v.startsWith('•')) return existing[i] || '';
          return v.trim();
        }).filter(Boolean);
      } else if (typeof val === 'string' && val && !val.startsWith('•')) {
        const existing = Array.isArray(updated.apiKeys[provider]) ? updated.apiKeys[provider] : [];
        if (!existing.includes(val.trim())) existing.push(val.trim());
        updated.apiKeys[provider] = existing;
      }
    }
  }
  if (incoming.ttsEnabled !== undefined) updated.ttsEnabled = incoming.ttsEnabled;
  if (incoming.ttsVoice !== undefined) updated.ttsVoice = incoming.ttsVoice;
  if (incoming.ttsRate !== undefined) updated.ttsRate = incoming.ttsRate;
  if (incoming.ttsPitch !== undefined) updated.ttsPitch = incoming.ttsPitch;
  if (incoming.memoryEnabled !== undefined) updated.memoryEnabled = incoming.memoryEnabled;
  if (incoming.customInstructions !== undefined) updated.customInstructions = incoming.customInstructions;
  if (incoming.userEmail !== undefined) updated.userEmail = incoming.userEmail;

  writeJSON(settingsFile, updated);
  appendLog('[SETTINGS] Configurações salvas.');
  return { ok: true };
}

function getSettingsRaw() { return readJSON(settingsFile, { apiKeys: {} }); }

// ── CONVERSATIONS ─────────────────────────────────────────────────────────────

function getConversations() {
  const files = fs.readdirSync(conversationsDir).filter(f => f.endsWith('.json'));
  const list = [];
  for (const f of files) {
    try {
      const d = readJSON(path.join(conversationsDir, f));
      list.push({ id: d.id, title: d.title || 'Conversa', createdAt: d.createdAt, updatedAt: d.updatedAt, messageCount: (d.messages || []).length });
    } catch {}
  }
  return list.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

function getConversation(id) {
  const file = path.join(conversationsDir, `${id}.json`);
  return fs.existsSync(file) ? readJSON(file) : null;
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
    role, content,
    attachments: (attachments || []).map(a => ({ name: a.name, type: a.type, size: a.size })),
    timestamp: new Date().toISOString(),
  };
  conv.messages = conv.messages || [];
  conv.messages.push(message);
  conv.updatedAt = message.timestamp;
  if ((!conv.title || conv.title === 'Nova conversa') && role === 'user' && content) {
    conv.title = content.substring(0, 60) + (content.length > 60 ? '…' : '');
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
  if (meta.lastConversationId === id) { meta.lastConversationId = null; writeJSON(metaFile, meta); }
  return { ok: true };
}

function searchConversations(query) {
  const q = (query || '').toLowerCase();
  const files = fs.readdirSync(conversationsDir).filter(f => f.endsWith('.json'));
  const results = [];
  for (const f of files) {
    try {
      const d = readJSON(path.join(conversationsDir, f));
      const inTitle = (d.title || '').toLowerCase().includes(q);
      const inMessages = (d.messages || []).some(m => (m.content || '').toLowerCase().includes(q));
      if (inTitle || inMessages) results.push({ id: d.id, title: d.title, updatedAt: d.updatedAt });
    } catch {}
  }
  return results.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

function getLastConversationId() { return readJSON(metaFile).lastConversationId || null; }
function setLastConversationId(id) {
  const meta = readJSON(metaFile, {});
  meta.lastConversationId = id;
  writeJSON(metaFile, meta);
}

function appendLog(line) {
  try { fs.appendFileSync(logsFile, `${new Date().toISOString()} ${line}\n`, 'utf8'); } catch {}
}

module.exports = {
  init, getSettings, saveSettings, getSettingsRaw,
  appendProviderKeys, deleteProviderKeys, deleteProviderKey,
  getConversations, getConversation, createConversation,
  saveMessage, updateConversationTitle, deleteConversation,
  searchConversations, getLastConversationId, setLastConversationId,
  appendLog,
};
