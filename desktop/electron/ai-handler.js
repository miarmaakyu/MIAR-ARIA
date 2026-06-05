/**
 * MIAR ÁRIA — AI Handler
 * Suporta múltiplas chaves por provider com rotação automática.
 * Fallback: Groq → Gemini → OpenRouter
 * Chaves salvas como array: groq: ["gsk_...", "gsk_..."]
 */

const storageHandler = require('./storage-handler');

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

const GROQ_PRIMARY_MODEL = 'llama-3.3-70b-versatile';
const GROQ_FALLBACK_MODEL = 'llama-3.1-8b-instant';
const MAX_CONTEXT_TOKENS = 6000;
const CHUNK_SIZE = 3000;

// Índice atual por provider para rotação
const keyIndexes = { groq: 0, gemini: 0, openrouter: 0 };

function estimateTokens(text) {
  return Math.ceil((text || '').length / 4);
}

function sanitizeError(err) {
  const msg = err?.message || String(err);
  return msg
    .replace(/gsk_[a-zA-Z0-9\-_]+/g, '[KEY_REDACTED]')
    .replace(/AIza[a-zA-Z0-9\-_]+/g, '[KEY_REDACTED]')
    .replace(/sk-or-[a-zA-Z0-9\-_]+/g, '[KEY_REDACTED]')
    .replace(/sk-[a-zA-Z0-9\-_]+/g, '[KEY_REDACTED]');
}

/** Retorna array de chaves válidas para um provider */
function getKeys(provider) {
  const raw = storageHandler.getSettingsRaw();
  const keys = raw.apiKeys || {};
  const val = keys[provider];
  if (!val) return [];
  if (Array.isArray(val)) return val.filter(Boolean);
  return [val];
}

/** Retorna próxima chave com rotação round-robin */
function nextKey(provider) {
  const keys = getKeys(provider);
  if (!keys.length) return null;
  const idx = keyIndexes[provider] % keys.length;
  keyIndexes[provider] = (idx + 1) % keys.length;
  return keys[idx];
}

/** Avança para próxima chave (em caso de 429 ou 401) */
function rotateKey(provider) {
  const keys = getKeys(provider);
  if (keys.length <= 1) return;
  keyIndexes[provider] = (keyIndexes[provider] + 1) % keys.length;
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

// ── GROQ ─────────────────────────────────────────────────────────────────────

async function callGroq(messages, key) {
  let model = GROQ_PRIMARY_MODEL;
  for (let attempt = 0; attempt < 2; attempt++) {
    const resp = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, max_tokens: 4096, temperature: 0.7 }),
      signal: AbortSignal.timeout(60000),
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => resp.statusText);
      if ((resp.status === 429 || resp.status === 401) && attempt === 0) {
        rotateKey('groq');
      }
      if (resp.status === 404 && attempt === 0) {
        model = GROQ_FALLBACK_MODEL;
        continue;
      }
      throw new Error(`Groq HTTP ${resp.status}: ${errText.substring(0, 200)}`);
    }
    const data = await resp.json();
    return { ok: true, text: data.choices?.[0]?.message?.content || '', provider: 'Groq', model };
  }
  throw new Error('Groq: tentativas esgotadas.');
}

async function callGroqWithRotation(messages) {
  const keys = getKeys('groq');
  if (!keys.length) throw new Error('Nenhuma chave Groq configurada.');
  const errors = [];
  for (let i = 0; i < keys.length; i++) {
    const key = nextKey('groq');
    try {
      return await callGroq(messages, key);
    } catch (e) {
      errors.push(sanitizeError(e));
    }
  }
  throw new Error(`Groq (${keys.length} chave(s)): ${errors.join(' | ')}`);
}

// ── GEMINI ───────────────────────────────────────────────────────────────────

async function callGemini(messages, key) {
  const contents = messages
    .filter(m => m.role !== 'system')
    .map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  const systemMsg = messages.find(m => m.role === 'system');
  const body = { contents };
  if (systemMsg) body.systemInstruction = { parts: [{ text: systemMsg.content }] };

  const resp = await fetch(`${GEMINI_BASE_URL}?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => resp.statusText);
    if (resp.status === 429 || resp.status === 401) rotateKey('gemini');
    throw new Error(`Gemini HTTP ${resp.status}: ${errText.substring(0, 200)}`);
  }
  const data = await resp.json();
  return { ok: true, text: data.candidates?.[0]?.content?.parts?.[0]?.text || '', provider: 'Gemini', model: 'gemini-1.5-flash' };
}

async function callGeminiWithRotation(messages) {
  const keys = getKeys('gemini');
  if (!keys.length) throw new Error('Nenhuma chave Gemini configurada.');
  const errors = [];
  for (let i = 0; i < keys.length; i++) {
    const key = nextKey('gemini');
    try {
      return await callGemini(messages, key);
    } catch (e) {
      errors.push(sanitizeError(e));
    }
  }
  throw new Error(`Gemini (${keys.length} chave(s)): ${errors.join(' | ')}`);
}

// ── OPENROUTER ───────────────────────────────────────────────────────────────

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
    if (resp.status === 429 || resp.status === 401) rotateKey('openrouter');
    throw new Error(`OpenRouter HTTP ${resp.status}: ${errText.substring(0, 200)}`);
  }
  const data = await resp.json();
  return { ok: true, text: data.choices?.[0]?.message?.content || '', provider: 'OpenRouter', model: data.model || '' };
}

async function callOpenRouterWithRotation(messages) {
  const keys = getKeys('openrouter');
  if (!keys.length) throw new Error('Nenhuma chave OpenRouter configurada.');
  const errors = [];
  for (let i = 0; i < keys.length; i++) {
    const key = nextKey('openrouter');
    try {
      return await callOpenRouter(messages, key);
    } catch (e) {
      errors.push(sanitizeError(e));
    }
  }
  throw new Error(`OpenRouter (${keys.length} chave(s)): ${errors.join(' | ')}`);
}

// ── SEND MESSAGE ─────────────────────────────────────────────────────────────

async function sendMessage(messages, conversationId, attachments, memories, systemInfo) {
  const memoryBlock = memories && memories.length > 0
    ? '\n\nMemórias relevantes do usuário:\n' + memories.map(m => `- ${m.content}`).join('\n')
    : '';

  const sysBlock = systemInfo ? `\n\nSistema do usuário:
- OS: ${systemInfo.os} | Arch: ${systemInfo.arch}
- CPU: ${systemInfo.cpuModel} (${systemInfo.cpus} núcleos)
- RAM: ${systemInfo.freeMemGB}GB livre / ${systemInfo.totalMemGB}GB total
- Usuário: ${systemInfo.username} | Home: ${systemInfo.homeDir}
- Uptime: ${systemInfo.uptime}` : '';

  const systemPrompt = {
    role: 'system',
    content: `Você é a MIAR ÁRIA, assistente de IA pessoal e nativa no Windows de Robson Calaça.
Você está rodando como aplicativo Electron instalado diretamente no computador dele — NÃO é um serviço web externo.
Você TEM ACESSO TOTAL E REAL ao computador via execução de comandos PowerShell/CMD.

COMO EXECUTAR COMANDOS NO WINDOWS:
Quando precisar executar algo no sistema, escreva o marcador exato:
[CMD: seu_comando_powershell_aqui]

O aplicativo vai executar o comando imediatamente e te retornar o resultado (stdout/stderr).
Você pode então usar o resultado para continuar a tarefa.

EXEMPLOS DE USO:
- Listar arquivos:     [CMD: Get-ChildItem C:\\Users\\${systemInfo?.username || 'usuario'} -Force]
- Ver processos:       [CMD: Get-Process | Select-Object Name,CPU,WorkingSet | Sort-Object CPU -Descending | Select-Object -First 20]
- Info do sistema:     [CMD: Get-ComputerInfo | Select-Object WindowsProductName,TotalPhysicalMemory,OsArchitecture]
- Disco:               [CMD: Get-PSDrive -PSProvider FileSystem | Select-Object Name,Used,Free]
- Instalar software:   [CMD: winget install nome_do_software]
- Limpeza de disco:    [CMD: Cleanmgr /sagerun:1]
- Serviços:            [CMD: Get-Service | Where-Object Status -eq Running]
- Rede:                [CMD: ipconfig /all]
- Abrir pasta:         [CMD: explorer.exe C:\\caminho]
- Criar arquivo:       [CMD: New-Item -Path C:\\caminho\\arquivo.txt -ItemType File]
- Tarefas agendadas:   [CMD: Get-ScheduledTask | Where-Object State -eq Ready]

REGRAS IMPORTANTES:
1. SEMPRE execute comandos quando o usuário pedir ação no sistema — não diga "não posso".
2. Use vários [CMD: ...] em sequência se necessário para completar uma tarefa.
3. Após receber o resultado do comando, interprete e explique ao usuário.
4. Se um comando falhar, tente uma alternativa.
5. Você pode fazer manutenção completa do Windows: limpeza, diagnóstico, configuração, instalação, remoção, monitoramento.
6. Fale sempre em português do Brasil.
7. Seja direta e técnica — o usuário é experiente.

Data/hora atual: ${new Date().toLocaleString('pt-BR')}.${sysBlock}${memoryBlock}`,
  };

  let contextMessages = [systemPrompt, ...limitContext(messages)];

  if (attachments && attachments.length > 0) {
    const attachText = attachments
      .map(a => `[Arquivo: ${a.name}]\n${a.content || '(sem texto extraído)'}`)
      .join('\n\n---\n\n');
    const lastIdx = contextMessages.length - 1;
    if (contextMessages[lastIdx]?.role === 'user') {
      contextMessages[lastIdx] = {
        ...contextMessages[lastIdx],
        content: contextMessages[lastIdx].content + '\n\n' + attachText,
      };
    }
  }

  const groqKeys = getKeys('groq');
  const geminiKeys = getKeys('gemini');
  const openrouterKeys = getKeys('openrouter');
  const totalKeys = groqKeys.length + geminiKeys.length + openrouterKeys.length;

  if (totalKeys === 0) {
    return { ok: false, error: 'Nenhuma chave de IA configurada.\n\nAbra ⚙ Configurações e adicione pelo menos uma chave (Groq, Gemini ou OpenRouter).' };
  }

  const errors = [];
  const providers = [
    { name: 'Groq', hasKeys: groqKeys.length > 0, fn: callGroqWithRotation },
    { name: 'Gemini', hasKeys: geminiKeys.length > 0, fn: callGeminiWithRotation },
    { name: 'OpenRouter', hasKeys: openrouterKeys.length > 0, fn: callOpenRouterWithRotation },
  ];

  for (const { name, hasKeys, fn } of providers) {
    if (!hasKeys) continue;
    try {
      const result = await fn(contextMessages);
      if (result.ok && result.text) {
        storageHandler.appendLog(`[AI OK] Provider: ${result.provider} | Model: ${result.model}`);
        return { ok: true, text: result.text, provider: result.provider, model: result.model };
      }
    } catch (err) {
      const sanitized = sanitizeError(err);
      errors.push(sanitized);
      storageHandler.appendLog(`[AI ERRO] ${name}: ${sanitized}`);
    }
  }

  return { ok: false, error: `Todos os providers falharam:\n${errors.join('\n')}` };
}

// ── TEST KEY ─────────────────────────────────────────────────────────────────

async function testKey(provider, key) {
  if (!key || !key.trim()) return { ok: false, error: 'Chave vazia.' };
  const k = key.trim();
  const msg = [{ role: 'user', content: 'Responda apenas: OK' }];
  try {
    let result;
    if (provider === 'groq') result = await callGroq(msg, k);
    else if (provider === 'gemini') result = await callGemini(msg, k);
    else if (provider === 'openrouter') result = await callOpenRouter(msg, k);
    else return { ok: false, error: 'Provider desconhecido.' };
    return { ok: true, text: result.text, provider: result.provider, model: result.model };
  } catch (err) {
    return { ok: false, error: sanitizeError(err) };
  }
}

// ── KEY STATUS ───────────────────────────────────────────────────────────────

function getKeyStatus() {
  return {
    groq: { count: getKeys('groq').length, current: keyIndexes.groq },
    gemini: { count: getKeys('gemini').length, current: keyIndexes.gemini },
    openrouter: { count: getKeys('openrouter').length, current: keyIndexes.openrouter },
  };
}

module.exports = { sendMessage, testKey, getKeyStatus };
