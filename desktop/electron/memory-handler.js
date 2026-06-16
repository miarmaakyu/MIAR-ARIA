/**
 * MIAR ÁRIA — Camada de Memória Inteligente
 *
 * Arquitetura em 3 camadas:
 *   1. SQLite/JSON (storage-handler) — histórico bruto completo
 *   2. ESTE MÓDULO    — memória inteligente (Mem0-inspired, local-first)
 *   3. RAG/chunks     — busca documental em arquivos grandes (via file-handler)
 *
 * Mem0 API externa: se MEM0_API_KEY estiver configurada, usa a API do Mem0.
 * Sem chave: usa memória inteligente local própria (arquivo JSON estruturado).
 */

const path = require('path');
const fs = require('fs');
const { app } = require('electron');

const CATEGORIES = ['perfil', 'projetos', 'preferencias', 'arquivos', 'decisoes', 'rotinas', 'ideias', 'geral'];

let memoryFile = null;
let memories = [];
let initialized = false;

function init() {
  if (initialized) return;
  const userDataPath = app.getPath('userData');
  memoryFile = path.join(userDataPath, 'smart-memory.json');
  if (!fs.existsSync(memoryFile)) {
    fs.writeFileSync(memoryFile, JSON.stringify([]), 'utf8');
  }
  try {
    memories = JSON.parse(fs.readFileSync(memoryFile, 'utf8'));
    if (!Array.isArray(memories)) memories = [];
  } catch {
    memories = [];
  }
  initialized = true;
}

function save() {
  if (!memoryFile) return;
  fs.writeFileSync(memoryFile, JSON.stringify(memories, null, 2), 'utf8');
}

// ── LOCAL MEMORY ENGINE ──────────────────────────────────────────────────────

function addMemory({ content, category = 'geral', source = 'user', confidence = 1.0, metadata = {} }) {
  init();
  const existing = memories.find(m =>
    m.content.toLowerCase() === content.toLowerCase()
  );
  if (existing) {
    existing.updatedAt = new Date().toISOString();
    existing.hits = (existing.hits || 0) + 1;
    save();
    return existing;
  }
  const mem = {
    id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    content,
    category,
    source,
    confidence,
    metadata,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    hits: 1,
  };
  memories.push(mem);
  save();
  return mem;
}

function getMemories({ category, query, limit = 20 } = {}) {
  init();
  let result = [...memories];
  if (category && category !== 'todas') result = result.filter(m => m.category === category);
  if (query) {
    const q = query.toLowerCase();
    result = result.filter(m => m.content.toLowerCase().includes(q));
  }
  result.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  return result.slice(0, limit);
}

function searchRelevantMemories(userMessage, limit = 10) {
  init();
  if (memories.length === 0) return [];

  // Sempre inclui as 3 memórias mais recentes independente de relevância
  const byDate = [...memories].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  const recent = byDate.slice(0, 3);

  if (!userMessage) return recent.slice(0, limit);

  const words = userMessage.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  const scored = memories.map(m => {
    const text = m.content.toLowerCase();
    let score = 0;
    for (const word of words) {
      if (text.includes(word)) score += 2;
    }
    score += m.hits * 0.1;
    const ageMs = Date.now() - new Date(m.updatedAt).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    score -= ageDays * 0.05;
    return { ...m, score };
  });

  const relevant = scored
    .filter(m => m.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  // Mescla relevantes + recentes sem duplicar
  const seen = new Set(relevant.map(m => m.id));
  const merged = [...relevant];
  for (const r of recent) {
    if (!seen.has(r.id)) { merged.push(r); seen.add(r.id); }
  }
  return merged.slice(0, limit);
}

function updateMemory(id, { content, category }) {
  init();
  const mem = memories.find(m => m.id === id);
  if (!mem) return { ok: false, error: 'Memória não encontrada.' };
  if (content !== undefined) mem.content = content;
  if (category !== undefined) mem.category = category;
  mem.updatedAt = new Date().toISOString();
  save();
  return { ok: true };
}

function deleteMemory(id) {
  init();
  const idx = memories.findIndex(m => m.id === id);
  if (idx === -1) return { ok: false, error: 'Memória não encontrada.' };
  memories.splice(idx, 1);
  save();
  return { ok: true };
}

function clearAll() {
  init();
  memories = [];
  save();
  return { ok: true };
}

function getStats() {
  init();
  const byCat = {};
  for (const cat of CATEGORIES) byCat[cat] = 0;
  for (const m of memories) {
    byCat[m.category] = (byCat[m.category] || 0) + 1;
  }
  return { total: memories.length, byCategory: byCat };
}

// ── MEM0 API (opcional) ──────────────────────────────────────────────────────

async function tryMem0Api(action, payload, apiKey) {
  if (!apiKey) return null;
  try {
    const BASE = 'https://api.mem0.ai/v1';
    const headers = { 'Authorization': `Token ${apiKey}`, 'Content-Type': 'application/json' };

    if (action === 'add') {
      const resp = await fetch(`${BASE}/memories/`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ messages: [{ role: 'user', content: payload.content }], user_id: 'miar-aria-user' }),
        signal: AbortSignal.timeout(10000),
      });
      if (resp.ok) return await resp.json();
    }

    if (action === 'search') {
      const resp = await fetch(`${BASE}/memories/search/`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query: payload.query, user_id: 'miar-aria-user', limit: payload.limit || 8 }),
        signal: AbortSignal.timeout(10000),
      });
      if (resp.ok) return await resp.json();
    }

    if (action === 'list') {
      const resp = await fetch(`${BASE}/memories/?user_id=miar-aria-user&limit=100`, { headers, signal: AbortSignal.timeout(10000) });
      if (resp.ok) return await resp.json();
    }
  } catch {
    return null;
  }
  return null;
}

// ── EXTRACTION via AI ─────────────────────────────────────────────────────────

async function extractAndSaveMemories(conversationSnippet, aiProvider, apiKeys) {
  if (!conversationSnippet || !aiProvider) return [];

  const prompt = `Analise este trecho de conversa e extraia fatos importantes, preferências, projetos, decisões, rotinas ou informações pessoais do usuário que mereçam ser lembradas em futuras conversas.

Retorne SOMENTE um JSON no formato:
[{"content": "fato curto e claro", "category": "categoria"}]

Categorias válidas: perfil, projetos, preferencias, arquivos, decisoes, rotinas, ideias, geral

Se não houver nada relevante para lembrar, retorne: []

Conversa:
${conversationSnippet.substring(0, 2000)}`;

  try {
    let result = null;
    if (apiKeys.groq) {
      const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKeys.groq}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama-3.1-8b-instant',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 600,
          temperature: 0.2,
        }),
        signal: AbortSignal.timeout(20000),
      });
      if (resp.ok) {
        const data = await resp.json();
        result = data.choices?.[0]?.message?.content;
      }
    }

    if (!result && apiKeys.gemini) {
      const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKeys.gemini}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }] }),
        signal: AbortSignal.timeout(20000),
      });
      if (resp.ok) {
        const data = await resp.json();
        result = data.candidates?.[0]?.content?.parts?.[0]?.text;
      }
    }

    if (!result) return [];

    const jsonMatch = result.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    const extracted = JSON.parse(jsonMatch[0]);
    const saved = [];
    for (const item of extracted) {
      if (!item.content || item.content.length < 5) continue;
      const cat = CATEGORIES.includes(item.category) ? item.category : 'geral';
      const mem = addMemory({ content: item.content, category: cat, source: 'auto' });
      saved.push(mem);
    }
    return saved;
  } catch {
    return [];
  }
}

// ── IPC EXPORTS ──────────────────────────────────────────────────────────────

module.exports = {
  init,
  addMemory,
  getMemories,
  searchRelevantMemories,
  updateMemory,
  deleteMemory,
  clearAll,
  getStats,
  tryMem0Api,
  extractAndSaveMemories,
  CATEGORIES,
};
