const storageHandler = require('./storage-handler');

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

const GROQ_PRIMARY_MODEL = 'llama-3.3-70b-versatile';
const GROQ_FALLBACK_MODEL = 'llama-3.1-8b-instant';
const MAX_CONTEXT_TOKENS = 6000;
const CHUNK_SIZE = 3000;

function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

function sanitizeError(err) {
  const msg = err?.message || String(err);
  return msg.replace(/sk-[a-zA-Z0-9\-_]+/g, '[KEY_REDACTED]')
            .replace(/gsk_[a-zA-Z0-9\-_]+/g, '[KEY_REDACTED]')
            .replace(/AIza[a-zA-Z0-9\-_]+/g, '[KEY_REDACTED]');
}

function limitContext(messages) {
  let total = 0;
  const limited = [];
  const reversed = [...messages].reverse();
  for (const msg of reversed) {
    const tokens = estimateTokens(msg.content || '');
    if (total + tokens > MAX_CONTEXT_TOKENS && limited.length > 0) break;
    limited.unshift(msg);
    total += tokens;
  }
  if (limited.length === 0 && messages.length > 0) {
    limited.push(messages[messages.length - 1]);
  }
  return limited;
}

async function callGroq(messages, key) {
  let model = GROQ_PRIMARY_MODEL;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const resp = await fetch(GROQ_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: 4096,
          temperature: 0.7,
        }),
        signal: AbortSignal.timeout(60000),
      });
      if (!resp.ok) {
        const errText = await resp.text().catch(() => resp.statusText);
        if (resp.status === 404 && attempt === 0) {
          model = GROQ_FALLBACK_MODEL;
          continue;
        }
        throw new Error(`Groq HTTP ${resp.status}: ${errText.substring(0, 200)}`);
      }
      const data = await resp.json();
      return { ok: true, text: data.choices?.[0]?.message?.content || '', provider: 'Groq', model };
    } catch (err) {
      if (attempt === 0 && model === GROQ_PRIMARY_MODEL) {
        model = GROQ_FALLBACK_MODEL;
        continue;
      }
      throw err;
    }
  }
}

async function callGemini(messages, key) {
  const contents = messages
    .filter(m => m.role !== 'system')
    .map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

  const systemMsg = messages.find(m => m.role === 'system');
  const systemInstruction = systemMsg ? { parts: [{ text: systemMsg.content }] } : undefined;

  const body = { contents };
  if (systemInstruction) body.systemInstruction = systemInstruction;

  const resp = await fetch(`${GEMINI_API_URL}?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => resp.statusText);
    throw new Error(`Gemini HTTP ${resp.status}: ${errText.substring(0, 200)}`);
  }
  const data = await resp.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return { ok: true, text, provider: 'Gemini', model: 'gemini-1.5-flash' };
}

async function callOpenRouter(messages, key) {
  const resp = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://miar-aria.app',
      'X-Title': 'MIAR ARIA',
    },
    body: JSON.stringify({
      model: 'meta-llama/llama-3.1-8b-instruct:free',
      messages,
      max_tokens: 4096,
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => resp.statusText);
    throw new Error(`OpenRouter HTTP ${resp.status}: ${errText.substring(0, 200)}`);
  }
  const data = await resp.json();
  return { ok: true, text: data.choices?.[0]?.message?.content || '', provider: 'OpenRouter', model: data.model || '' };
}

async function sendMessage(messages, conversationId, attachments) {
  const settings = storageHandler.getSettings();
  const keys = settings.apiKeys || {};

  const systemPrompt = {
    role: 'system',
    content: `Você é a MIAR ÁRIA, uma assistente de IA pessoal em português do Brasil.
Seja precisa, útil e honesta. Se não souber algo, diga claramente.
Nunca finja ter capacidades que não tem.
Data/hora atual: ${new Date().toLocaleString('pt-BR')}.`,
  };

  let contextMessages = [systemPrompt, ...limitContext(messages)];

  if (attachments && attachments.length > 0) {
    const attachText = attachments
      .map(a => `[Arquivo: ${a.name}]\n${a.content || '(sem texto extraído)'}`)
      .join('\n\n---\n\n');
    const lastUserIdx = [...contextMessages].reverse().findIndex(m => m.role === 'user');
    if (lastUserIdx !== -1) {
      const realIdx = contextMessages.length - 1 - lastUserIdx;
      contextMessages[realIdx] = {
        ...contextMessages[realIdx],
        content: contextMessages[realIdx].content + '\n\n' + attachText,
      };
    }
  }

  const userContent = contextMessages[contextMessages.length - 1]?.content || '';
  const chunks = chunkText(userContent, CHUNK_SIZE);
  if (chunks.length > 1) {
    contextMessages[contextMessages.length - 1] = {
      ...contextMessages[contextMessages.length - 1],
      content: `[Mensagem longa dividida em ${chunks.length} partes - Parte 1/${chunks.length}]\n${chunks[0]}`,
    };
  }

  const errors = [];
  const providers = [
    { name: 'groq', key: keys.groq, fn: callGroq },
    { name: 'gemini', key: keys.gemini, fn: callGemini },
    { name: 'openrouter', key: keys.openrouter, fn: callOpenRouter },
  ];

  for (const { name, key, fn } of providers) {
    if (!key) continue;
    try {
      const result = await fn(contextMessages, key);
      if (result.ok && result.text) {
        storageHandler.appendLog(`[AI OK] Provider: ${result.provider}, model: ${result.model}`);
        return { ok: true, text: result.text, provider: result.provider, model: result.model };
      }
    } catch (err) {
      const sanitized = sanitizeError(err);
      errors.push(`${name}: ${sanitized}`);
      storageHandler.appendLog(`[AI ERRO] ${name}: ${sanitized}`);
    }
  }

  const noKey = providers.filter(p => !p.key).map(p => p.name);
  if (noKey.length === providers.length) {
    return { ok: false, error: 'Nenhuma chave de IA configurada. Abra Configurações e adicione pelo menos uma chave (Groq, Gemini ou OpenRouter).' };
  }

  return { ok: false, error: `Todos os providers falharam:\n${errors.join('\n')}` };
}

function chunkText(text, size) {
  if (!text || estimateTokens(text) <= size) return [text];
  const chunks = [];
  const words = text.split(' ');
  let current = '';
  for (const word of words) {
    if (estimateTokens(current + ' ' + word) > size && current.length > 0) {
      chunks.push(current.trim());
      current = word;
    } else {
      current += (current ? ' ' : '') + word;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

async function testKey(provider, key) {
  if (!key) return { ok: false, error: 'Chave vazia.' };
  const testMessages = [
    { role: 'user', content: 'Responda apenas: OK' }
  ];
  try {
    let result;
    if (provider === 'groq') result = await callGroq(testMessages, key);
    else if (provider === 'gemini') result = await callGemini(testMessages, key);
    else if (provider === 'openrouter') result = await callOpenRouter(testMessages, key);
    else return { ok: false, error: 'Provider desconhecido.' };
    return { ok: true, text: result.text, provider: result.provider, model: result.model };
  } catch (err) {
    return { ok: false, error: sanitizeError(err) };
  }
}

module.exports = { sendMessage, testKey };
