// MIAR ÁRIA — Renderer (frontend)
'use strict';

// ── STATE ─────────────────────────────────────────────────────────────────────
const state = {
  currentConvId: null,
  messages: [],
  attachments: [],
  folderFiles: [],
  folderPath: null,
  selectedFolderFiles: [],
  ttsEnabled: true,
  ttsVoice: null,
  ttsRate: 1.0,
  ttsPitch: 1.1,
  memoryEnabled: true,
  isSending: false,
  isListening: false,
  recognition: null,
  voices: [],
};

// ── INIT ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  loadVoices();
  if (window.speechSynthesis) speechSynthesis.onvoiceschanged = loadVoices;
  await loadSettings();
  await loadConversationList();
  const lastId = await window.miar.getLastConversationId();
  if (lastId) await openConversation(lastId);
  updateAiStatus();
  setupMic();
  setupEventListeners();
  // Mostra versão no canto superior direito
  if (window.miar?.getAppVersion) {
    window.miar.getAppVersion().then(v => {
      const el = document.getElementById('app-version');
      if (el) el.textContent = `v${v}`;
    });
  }
});

// ── VOICES / TTS ──────────────────────────────────────────────────────────────
function loadVoices() {
  if (!window.speechSynthesis) return;
  state.voices = window.speechSynthesis.getVoices();
  const sel = document.getElementById('voice-select');
  if (!sel) return;
  const saved = sel.value;
  sel.innerHTML = '';
  const ptVoices = state.voices.filter(v => v.lang.startsWith('pt'));
  const others = state.voices.filter(v => !v.lang.startsWith('pt'));
  for (const v of [...ptVoices, ...others]) {
    const opt = document.createElement('option');
    opt.value = v.name;
    opt.textContent = `${v.name} (${v.lang})`;
    sel.appendChild(opt);
  }
  const target = saved || state.ttsVoice;
  if (target) sel.value = target;
  else {
    const best = ptVoices.find(v => /francisca|maria|vitoria|vitória|fernanda|ana|lucia|bianca/i.test(v.name)) || ptVoices[0];
    if (best) { sel.value = best.name; state.ttsVoice = best.name; }
  }
}

function speak(text) {
  if (!state.ttsEnabled || !window.speechSynthesis) return;
  speechSynthesis.cancel();
  const clean = text.replace(/```[\s\S]*?```/g, 'código omitido').replace(/[*_#`~]/g, '');
  const utter = new SpeechSynthesisUtterance(clean.substring(0, 800));
  utter.lang = 'pt-BR';
  utter.rate = state.ttsRate;
  utter.pitch = state.ttsPitch;
  const voiceName = document.getElementById('voice-select')?.value || state.ttsVoice;
  if (voiceName) {
    const v = state.voices.find(x => x.name === voiceName);
    if (v) utter.voice = v;
  }
  speechSynthesis.speak(utter);
}

// ── SETTINGS ──────────────────────────────────────────────────────────────────
async function loadSettings() {
  const s = await window.miar.getSettings();
  state.ttsEnabled = s.ttsEnabled ?? true;
  state.ttsVoice = s.ttsVoice || '';
  state.ttsRate = s.ttsRate || 1.0;
  state.ttsPitch = s.ttsPitch || 1.1;
  state.memoryEnabled = s.memoryEnabled ?? true;
  updateTtsBtn();

  const rateEl = document.getElementById('tts-rate');
  const pitchEl = document.getElementById('tts-pitch');
  if (rateEl) { rateEl.value = state.ttsRate; document.getElementById('tts-rate-val').textContent = state.ttsRate; }
  if (pitchEl) { pitchEl.value = state.ttsPitch; document.getElementById('tts-pitch-val').textContent = state.ttsPitch; }

  for (const provider of ['groq', 'gemini', 'openrouter', 'mem0']) {
    const badge    = document.getElementById(`${provider}-badge`);
    const clearBtn = document.getElementById(`${provider}-clear`);
    const list     = document.getElementById(`${provider}-keys-list`);
    const count    = s.apiKeysCounts?.[provider] || 0;
    const masked   = s.apiKeysMasked?.[provider] || [];

    if (badge) {
      badge.textContent = count > 0 ? `${count} chave${count > 1 ? 's' : ''}` : 'Nenhuma';
      badge.className   = `key-badge ${count > 0 ? 'set' : 'unset'}`;
    }
    if (clearBtn) clearBtn.classList.toggle('hidden', count === 0);

    // Renderiza lista de chaves salvas (mascaradas) com botão deletar individual
    if (list) {
      list.innerHTML = masked.map((m, i) => `
        <div class="saved-key-item">
          <span class="saved-key-icon">🔑</span>
          <span class="saved-key-value">${escHtml(m)}</span>
          <button class="saved-key-del" onclick="deleteOneKey('${provider}',${i})" title="Remover esta chave">✕</button>
        </div>`).join('');
    }
  }
}

window.deleteOneKey = async function (provider, index) {
  await window.miar.deleteProviderKey({ provider, index });
  await loadSettings();
  updateAiStatus();
};

window.clearProviderKeys = async function (provider) {
  if (!confirm(`Apagar todas as chaves de ${provider}?`)) return;
  await window.miar.deleteProviderKeys(provider);
  await loadSettings();
  updateAiStatus();
  showKeyResult(provider, true, 'Chaves apagadas.');
};

window.saveAllSettings = async function () {
  const voiceSel = document.getElementById('voice-select');
  const rate = parseFloat(document.getElementById('tts-rate')?.value || '1.0');
  const pitch = parseFloat(document.getElementById('tts-pitch')?.value || '1.1');
  state.ttsVoice = voiceSel?.value || '';
  state.ttsRate = rate;
  state.ttsPitch = pitch;
  await window.miar.saveSettings({ ttsEnabled: state.ttsEnabled, ttsVoice: state.ttsVoice, ttsRate: rate, ttsPitch: pitch, memoryEnabled: state.memoryEnabled });
  closeModal('settings-modal');
  updateAiStatus();
};

// ── KEY MANAGEMENT ────────────────────────────────────────────────────────────

/** Lê o textarea, parseia chaves (vírgula ou newline), ADICIONA às existentes */
window.saveKeyTextarea = async function (provider) {
  const ta = document.getElementById(`${provider}-textarea`);
  const raw = ta?.value || '';
  const newKeys = raw.split(/[\n,;]+/).map(k => k.trim()).filter(Boolean);
  if (!newKeys.length) { showKeyResult(provider, false, 'Cole pelo menos uma chave.'); return; }
  const res = await window.miar.appendProviderKeys({ provider, keys: newKeys });
  if (ta) ta.value = '';
  await loadSettings();
  showKeyResult(provider, true, `✓ ${newKeys.length} adicionada(s). Total: ${res.total}`);
  updateAiStatus();
};

/** Testa a primeira chave colada no textarea */
window.testKeyFromTextarea = async function (provider) {
  const ta = document.getElementById(`${provider}-textarea`);
  const raw = ta?.value || '';
  const keys = raw.split(/[\n,;]+/).map(k => k.trim()).filter(Boolean);
  if (!keys.length) { showKeyResult(provider, false, 'Cole uma chave para testar.'); return; }
  showKeyResult(provider, null, 'Testando…');
  const res = await window.miar.testKey({ provider, key: keys[0] });
  if (res.ok) showKeyResult(provider, true, `✓ OK — modelo: ${res.model} — "${(res.text||'').substring(0,50)}"`);
  else showKeyResult(provider, false, `✗ ${res.error}`);
};

/** Salva chave do Mem0 */
window.saveMem0Key = async function () {
  const inp = document.getElementById('mem0-key-input');
  const key = inp?.value.trim();
  if (!key) { showKeyResult('mem0', false, 'Chave vazia.'); return; }
  await window.miar.saveSettings({ apiKeys: { mem0: key } });
  if (inp) inp.value = '';
  await loadSettings();
  showKeyResult('mem0', true, '✓ Chave Mem0 salva. Memória em nuvem ativa.');
};

function showKeyResult(provider, ok, msg) {
  const el = document.getElementById(`${provider}-result`);
  if (!el) return;
  el.className = 'key-result ' + (ok === true ? 'ok' : ok === false ? 'error' : '');
  el.textContent = msg;
  el.classList.remove('hidden');
}

// ── CONVERSATION LIST ─────────────────────────────────────────────────────────
async function loadConversationList() {
  const conversations = await window.miar.getConversations();
  const container = document.getElementById('conversations');
  container.innerHTML = '';
  if (!conversations.length) {
    container.innerHTML = '<div style="padding:16px 12px;font-size:12px;color:var(--text3)">Nenhuma conversa ainda.</div>';
    return;
  }
  for (const conv of conversations) {
    const item = document.createElement('div');
    item.className = 'conv-item' + (conv.id === state.currentConvId ? ' active' : '');
    const date = new Date(conv.updatedAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    item.innerHTML = `
      <span class="conv-item-title" title="${escHtml(conv.title)}">${escHtml(conv.title)}</span>
      <span style="display:flex;align-items:center;gap:4px">
        <span class="conv-item-date">${date}</span>
        <button class="conv-del" data-id="${conv.id}" title="Apagar">✕</button>
      </span>`;
    item.addEventListener('click', (e) => { if (!e.target.classList.contains('conv-del')) openConversation(conv.id); });
    item.querySelector('.conv-del').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(`Apagar "${conv.title}"?`)) return;
      await window.miar.deleteConversation(conv.id);
      if (state.currentConvId === conv.id) { state.currentConvId = null; clearChat(); }
      await loadConversationList();
    });
    container.appendChild(item);
  }
}

async function openConversation(id) {
  const conv = await window.miar.getConversation(id);
  if (!conv) return;
  state.currentConvId = id;
  state.messages = (conv.messages || []).map(m => ({ role: m.role, content: m.content, timestamp: m.timestamp, attachments: m.attachments || [] }));
  await window.miar.setLastConversationId(id);
  document.getElementById('conv-title').textContent = conv.title || 'MIAR ÁRIA';
  renderMessages();
  await loadConversationList();
}

function clearChat() {
  state.messages = [];
  document.getElementById('conv-title').textContent = 'MIAR ÁRIA';
  document.getElementById('messages').innerHTML = `
    <div id="empty-state">
      <h2>MIAR ÁRIA</h2>
      <p>Assistente de IA com voz, microfone e memória local.</p>
      <div class="empty-hint">Configure sua chave de IA em ⚙ Configurações para começar.</div>
    </div>`;
}

function renderMessages() {
  const container = document.getElementById('messages');
  container.innerHTML = '';
  if (!state.messages.length) { clearChat(); return; }
  for (const msg of state.messages) appendMessageEl(msg);
  scrollToBottom();
}

function setThinkingText(text) {
  const el = document.querySelector('.msg-thinking .msg-bubble');
  if (el) el.textContent = text;
}

function appendMessageEl(msg) {
  const container = document.getElementById('messages');
  document.getElementById('empty-state')?.remove();

  const div = document.createElement('div');
  div.className = `msg ${msg.role}${msg.isError ? ' msg-error' : ''}${msg.isThinking ? ' msg-thinking' : ''}`;

  const time = msg.timestamp
    ? new Date(msg.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false })
    : '';
  const attachHtml = (msg.attachments || []).length > 0
    ? `<div class="msg-attachments">${msg.attachments.map(a => `<span class="attach-tag">📎 ${escHtml(a.name || a)}</span>`).join('')}</div>`
    : '';
  const providerHtml = msg.provider ? `<span class="msg-provider">${escHtml(msg.provider)}</span>` : '';
  const msgId = 'msg-' + Math.random().toString(36).slice(2);

  div.innerHTML = `
    ${attachHtml}
    <div class="msg-bubble" id="${msgId}">${formatContent(msg.content || '')}</div>
    <div class="msg-meta">
      <span class="msg-time">${time}</span>
      ${providerHtml}
      <button class="copy-btn" onclick="copyMsg('${msgId}')" title="Copiar texto">⧉</button>
    </div>`;

  container.appendChild(div);
  return div;
}

function formatContent(text) {
  return escHtml(text)
    .replace(/```([\s\S]*?)```/g, '<pre style="background:var(--bg4);padding:10px;border-radius:6px;overflow-x:auto;font-size:12px;margin:6px 0;white-space:pre-wrap">$1</pre>')
    .replace(/`([^`]+)`/g, '<code style="background:var(--bg4);padding:1px 5px;border-radius:3px;font-size:12px">$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}

function escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function scrollToBottom() {
  const c = document.getElementById('messages');
  c.scrollTop = c.scrollHeight;
}

// ── SEND MESSAGE ──────────────────────────────────────────────────────────────
async function sendMessage() {
  if (state.isSending) return;
  const input = document.getElementById('message-input');
  const text = input.value.trim();
  const allAttachments = [...state.attachments, ...state.selectedFolderFiles];
  if (!text && !allAttachments.length) return;

  if (!state.currentConvId) {
    const conv = await window.miar.createConversation(text.substring(0, 60) || 'Nova conversa');
    state.currentConvId = conv.id;
    await loadConversationList();
  }

  const userMsg = { role: 'user', content: text, attachments: allAttachments, timestamp: new Date().toISOString() };
  state.messages.push(userMsg);
  appendMessageEl(userMsg);
  input.value = '';
  input.style.height = 'auto';
  clearAttachmentsPreview();

  await window.miar.saveMessage({ conversationId: state.currentConvId, role: 'user', content: text, attachments: allAttachments });

  state.isSending = true;
  document.getElementById('send-btn').disabled = true;

  const thinkingEl = appendMessageEl({ role: 'assistant', content: '⋯', isThinking: true, timestamp: new Date().toISOString() });
  scrollToBottom();

  try {
    let relevantMemories = [];
    if (state.memoryEnabled && text) {
      relevantMemories = await window.miar.memorySearch(text);
    }

    const apiMessages = state.messages
      .filter(m => !m.isThinking && !m.isError)
      .slice(-20)
      .map(m => ({ role: m.role, content: m.content }));

    // ── Loop de execução de comandos Windows ──────────────────────────────────
    // A IA pode responder com [CMD: powershell_command] → app executa → devolve resultado → IA continua
    let loopMessages = [...apiMessages];
    let finalResult  = null;
    let loopCount    = 0;
    const MAX_CMD_LOOPS = 8; // evita loop infinito

    while (loopCount < MAX_CMD_LOOPS) {
      loopCount++;
      const result = await window.miar.sendMessage({
        messages: loopMessages,
        conversationId: state.currentConvId,
        attachments: loopCount === 1 ? allAttachments.filter(a => a.content) : [],
        memories: loopCount === 1 ? relevantMemories : [],
      });

      if (!result.ok) { finalResult = result; break; }

      // Detecta marcadores [CMD: ...]
      const cmdMatches = [...(result.text.matchAll(/\[CMD:\s*([\s\S]+?)\]/g))];

      if (!cmdMatches.length) {
        // Sem comandos — resposta final
        finalResult = result;
        break;
      }

      // Tem comandos — executar todos e coletar resultados
      const execResults = [];
      for (const match of cmdMatches) {
        const cmd = match[1].trim();
        setThinkingText(`⚙ Executando: ${cmd.substring(0, 60)}…`);
        const execRes = await window.miar.runCommand(cmd);
        execResults.push({
          command: cmd,
          ok: execRes.ok,
          output: execRes.stdout || execRes.stderr || '(sem output)',
          exitCode: execRes.exitCode,
        });
      }

      // Monta mensagem de retorno dos resultados ao contexto da IA
      const cmdFeedback = execResults.map(r =>
        `[RESULTADO_CMD: ${r.command}]\n${r.ok ? '✓ Saída:' : '✗ Erro (código ' + r.exitCode + '):'}\n${r.output}`
      ).join('\n\n---\n\n');

      // Adiciona resposta parcial da IA + resultados ao contexto e continua o loop
      loopMessages = [
        ...loopMessages,
        { role: 'assistant', content: result.text },
        { role: 'user', content: `[SISTEMA — resultados dos comandos executados no Windows]\n\n${cmdFeedback}\n\nContinue com base nos resultados acima.` },
      ];

      setThinkingText('⋯ Processando resultados…');
    }

    thinkingEl.remove();

    if (!finalResult) {
      finalResult = { ok: false, error: 'Limite de loops de comando atingido.' };
    }

    const aiMsg = {
      role: 'assistant',
      content: finalResult.ok ? finalResult.text : finalResult.error,
      provider: finalResult.provider || '',
      timestamp: new Date().toISOString(),
      isError: !finalResult.ok,
    };
    state.messages.push(aiMsg);
    appendMessageEl(aiMsg);

    await window.miar.saveMessage({ conversationId: state.currentConvId, role: 'assistant', content: aiMsg.content, attachments: [] });
    await loadConversationList();

    if (finalResult.ok) {
      if (state.ttsEnabled) speak(finalResult.text);
      if (state.memoryEnabled && state.messages.length >= 2) {
        const snippet = state.messages.slice(-4).map(m => `${m.role === 'user' ? 'Usuário' : 'MIAR ÁRIA'}: ${m.content}`).join('\n');
        window.miar.memoryExtract({ snippet }).catch(() => {});
      }
      if (state.messages.filter(m => m.role === 'user').length === 1) {
        const newTitle = text.substring(0, 60) + (text.length > 60 ? '…' : '');
        await window.miar.updateConversationTitle({ id: state.currentConvId, title: newTitle });
        document.getElementById('conv-title').textContent = newTitle;
        await loadConversationList();
      }
    }
  } catch (e) {
    thinkingEl?.remove();
    appendMessageEl({ role: 'assistant', content: `Erro inesperado: ${e.message}`, isError: true, timestamp: new Date().toISOString() });
  } finally {
    state.isSending = false;
    document.getElementById('send-btn').disabled = false;
    scrollToBottom();
  }
}

// ── MICROPHONE SAGAZ — auto-disparo após 1,5 s de silêncio ──────────────────
const MIC_SILENCE_MS = 1500;  // ms de silêncio para disparar
let _silenceTimer       = null;
let _hasSpoken          = false;
let _countdownTimer     = null;
let _userWantsListening = false;

function setupMic() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    const btn = document.getElementById('mic-btn');
    btn.title = 'Reconhecimento de voz indisponível. Verifique permissão de microfone.';
    btn.style.opacity = '0.4';
    return;
  }

  const rec = new SR();
  rec.lang            = 'pt-BR';
  rec.continuous      = false;  // Electron: false é mais estável; auto-reinicia via onend
  rec.interimResults  = false;  // só resultado final para evitar duplicação
  rec.maxAlternatives = 1;

  rec.onstart = () => {
    state.isListening = true;
    _hasSpoken        = false;
    document.getElementById('mic-btn').classList.add('listening');
    setMicStatus('🎙 Ouvindo…', 'listening-active');
  };

  rec.onspeechstart = () => { _hasSpoken = true; };

  rec.onresult = (e) => {
    const input = document.getElementById('message-input');
    let finalText = '', interimText = '';

    for (const r of e.results) {
      if (r.isFinal) finalText   += r[0].transcript + ' ';
      else           interimText += r[0].transcript;
    }

    const combined = (finalText || interimText).trim();
    if (combined) {
      input.value = combined;
      autoResizeTextarea(input);
      _hasSpoken = true;
    }

    // Reinicia o temporizador de silêncio a cada resultado
    clearTimeout(_silenceTimer);
    clearTimeout(_countdownTimer);

    if (finalText.trim()) {
      // Após fala final detectada, aguarda silêncio e dispara
      setMicStatus(`✔ "${finalText.trim().substring(0, 40)}…" — disparando em ${MIC_SILENCE_MS / 1000}s`, 'listening-active');
      _silenceTimer = setTimeout(() => {
        if (state.isListening) {
          rec.stop();  // onend cuidará do envio
        }
      }, MIC_SILENCE_MS);
    } else {
      setMicStatus('🎙 Ouvindo…', 'listening-active');
    }
  };

  rec.onend = () => {
    clearTimeout(_silenceTimer);
    clearTimeout(_countdownTimer);

    const v = document.getElementById('message-input').value.trim();
    if (v && _hasSpoken) {
      // Tinha fala — envia e para
      _userWantsListening = false;
      state.isListening   = false;
      document.getElementById('mic-btn').classList.remove('listening');
      setMicStatus('');
      sendMessage();
      return;
    }

    // Sem fala — reinicia automaticamente se o usuário ainda quer ouvir
    if (_userWantsListening) {
      try { rec.start(); } catch {}
      return;
    }

    state.isListening = false;
    document.getElementById('mic-btn').classList.remove('listening');
    setMicStatus('');
  };

  rec.onerror = (e) => {
    clearTimeout(_silenceTimer);
    clearTimeout(_countdownTimer);
    state.isListening = false;
    document.getElementById('mic-btn').classList.remove('listening');
    const msgs = {
      'not-allowed' : 'Permissão de microfone negada. Vá em Configurações do Windows → Privacidade → Microfone.',
      'no-speech'   : 'Nenhuma fala detectada. Tente novamente.',
      'network'     : 'Reconhecimento de voz requer conexão à internet.',
      'aborted'     : '',
    };
    const m = msgs[e.error];
    if (m !== '') setMicStatus(m || `Erro: ${e.error}`);
    setTimeout(() => setMicStatus(''), 5000);
  };

  state.recognition = rec;
}

function toggleMic() {
  if (!state.recognition) {
    alert('Reconhecimento de voz indisponível.\nVerifique: Configurações do Windows → Privacidade → Microfone → ative para aplicativos de desktop.');
    return;
  }
  if (state.isListening || _userWantsListening) {
    _userWantsListening = false;
    clearTimeout(_silenceTimer);
    state.recognition.stop();
  } else {
    speechSynthesis.cancel();
    _hasSpoken          = false;
    _userWantsListening = true;
    state.recognition.start();
  }
}

function setMicStatus(msg, extraClass = '') {
  const el = document.getElementById('mic-status');
  el.textContent = msg;
  el.className = 'mic-status' + (msg ? ' visible' : '') + (extraClass ? ' ' + extraClass : '');
}

// ── AI STATUS ─────────────────────────────────────────────────────────────────
async function updateAiStatus() {
  const el = document.getElementById('ai-status');
  try {
    const s = await window.miar.getKeyStatus();
    const total = (s.groq?.count || 0) + (s.gemini?.count || 0) + (s.openrouter?.count || 0);
    if (total === 0) { el.textContent = 'Sem chave'; el.className = 'ai-status error'; return; }
    const parts = [];
    if (s.groq?.count) parts.push(`Groq×${s.groq.count}`);
    if (s.gemini?.count) parts.push(`Gemini×${s.gemini.count}`);
    if (s.openrouter?.count) parts.push(`OR×${s.openrouter.count}`);
    el.textContent = parts.join(' · ');
    el.className = 'ai-status ok';
  } catch { el.textContent = 'Erro'; el.className = 'ai-status error'; }
}

// ── ATTACHMENTS ───────────────────────────────────────────────────────────────
async function handleAttach() {
  const result = await window.miar.selectFiles();
  if (result.canceled || !result.files.length) return;
  result.files.forEach(f => state.attachments.push(f));
  renderAttachmentsPreview();
}

async function handleFolder() {
  const result = await window.miar.selectFolder();
  if (result.canceled) return;
  state.folderPath = result.folderPath;
  state.folderFiles = result.files || [];
  openFolderModal();
}

function renderAttachmentsPreview() {
  const container = document.getElementById('attachments-preview');
  container.innerHTML = '';
  state.attachments.forEach((a, i) => {
    const item = document.createElement('div');
    item.className = 'attach-preview-item';
    item.innerHTML = `📎 ${escHtml(a.name)}<button onclick="removeAttachment(${i})">✕</button>`;
    container.appendChild(item);
  });
  if (state.selectedFolderFiles.length > 0) {
    const fp = document.createElement('div');
    fp.className = 'folder-preview';
    fp.innerHTML = `📁 ${state.selectedFolderFiles.length} arquivo(s) de pasta<button onclick="clearFolderFiles()">✕</button>`;
    container.appendChild(fp);
  }
}

window.removeAttachment = (i) => { state.attachments.splice(i, 1); renderAttachmentsPreview(); };
window.clearFolderFiles = () => { state.selectedFolderFiles = []; renderAttachmentsPreview(); };

function clearAttachmentsPreview() {
  state.attachments = [];
  state.selectedFolderFiles = [];
  document.getElementById('attachments-preview').innerHTML = '';
}

// ── FOLDER MODAL ──────────────────────────────────────────────────────────────
function openFolderModal() {
  document.getElementById('folder-path-label').textContent = state.folderPath || '';
  const list = document.getElementById('folder-files-list');
  list.innerHTML = '';
  if (!state.folderFiles.length) {
    list.innerHTML = '<div style="color:var(--text3);font-size:13px;padding:8px">Pasta vazia.</div>';
  }
  for (const file of state.folderFiles) {
    const item = document.createElement('div');
    item.className = 'folder-file-item';
    item.dataset.path = file.path;
    const icons = { '.pdf': '📄', '.docx': '📝', '.txt': '📃', '.md': '📋', '.json': '🔧', '.png': '🖼', '.jpg': '🖼', '.jpeg': '🖼' };
    const icon = file.isDirectory ? '📁' : (icons[file.type] || '📄');
    const size = file.size ? ` — ${Math.round(file.size / 1024)}KB` : '';
    item.innerHTML = `<span>${icon}</span><span class="folder-file-name">${escHtml(file.name)}</span><span class="folder-file-size">${file.type || ''}${size}</span>`;
    item.addEventListener('click', () => {
      item.classList.toggle('selected');
      const sel = list.querySelectorAll('.selected');
      document.getElementById('folder-selected-count').textContent = `${sel.length} selecionado(s)`;
    });
    list.appendChild(item);
  }
  openModal('folder-modal');
}

window.confirmFolderFiles = async function () {
  const selected = document.querySelectorAll('#folder-files-list .selected');
  const files = [];
  for (const el of selected) files.push(await window.miar.readFolderFile(el.dataset.path));
  state.selectedFolderFiles = files;
  closeModal('folder-modal');
  renderAttachmentsPreview();
};

// ── MODALS ────────────────────────────────────────────────────────────────────
window.openSettingsModal = async function () {
  await loadSettings();
  loadVoices();
  openModal('settings-modal');
};

window.openMaintenanceModal = async function () {
  openModal('maintenance-modal');
  const [structure, logs] = await Promise.all([window.miar.getAppStructure(), window.miar.getLogs()]);
  document.getElementById('maintenance-structure').textContent =
    (structure.structure || []).map(e => `${e.type === 'dir' ? '📁' : '📄'} ${e.path}${e.size ? ` (${Math.round(e.size / 1024)}KB)` : ''}`).join('\n') || 'Sem dados.';
  document.getElementById('maintenance-logs').textContent = logs.logs || 'Sem logs.';
};

window.runMaintenanceDiagnosis = async function () {
  const prompt = document.getElementById('maintenance-prompt').value.trim();
  if (!prompt) return;
  const result = document.getElementById('maintenance-result');
  result.textContent = 'Analisando com IA…';
  const [structure, logs] = await Promise.all([window.miar.getAppStructure(), window.miar.getLogs()]);
  const context = `Estrutura:\n${(structure.structure || []).slice(0, 40).map(e => e.path).join('\n')}\n\nLogs:\n${(logs.logs || '').slice(-500)}`;
  const res = await window.miar.sendMessage({
    messages: [{ role: 'user', content: `Problema: ${prompt}\n\n${context}\n\nDiagnostique e sugira correções. Seja honesta. Não altere arquivos — apenas sugira para revisão.` }],
    memories: [],
  });
  result.textContent = res.ok ? res.text : `Erro: ${res.error}`;
};

window.createBackup = async function () {
  const status = document.getElementById('backup-status');
  status.textContent = 'Criando backup…';
  const res = await window.miar.createBackup();
  status.textContent = res.ok ? `✓ Backup criado (${res.conversationCount} conversa(s))` : `✗ ${res.error}`;
};

// ── MEMORY ────────────────────────────────────────────────────────────────────
window.openMemoryModal = async function () {
  openModal('memory-modal');
  await loadMemories();
};

window.loadMemories = async function (category = 'todas', query = '') {
  const stats = await window.miar.memoryStats();
  const memories = await window.miar.memoryGet({ category: category !== 'todas' ? category : undefined, query });
  const statsEl = document.getElementById('memory-stats');
  if (statsEl) statsEl.textContent = `Total: ${stats.total} memória${stats.total !== 1 ? 's' : ''}`;
  const container = document.getElementById('memory-list');
  if (!container) return;
  container.innerHTML = '';
  if (!memories.length) {
    container.innerHTML = '<div style="color:var(--text3);font-size:13px;padding:12px">Nenhuma memória encontrada.</div>';
    return;
  }
  for (const mem of memories) {
    const item = document.createElement('div');
    item.style.cssText = 'background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:10px 12px;display:flex;gap:10px;align-items:flex-start;margin-bottom:6px';
    item.innerHTML = `
      <div style="flex:1">
        <div style="font-size:13px;color:var(--text)">${escHtml(mem.content)}</div>
        <div style="font-size:11px;color:var(--text3);margin-top:3px">${mem.category} · ${new Date(mem.updatedAt).toLocaleDateString('pt-BR')} · ${mem.hits || 1}× usado</div>
      </div>
      <button onclick="window.deleteMemory('${mem.id}')" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:14px;padding:2px 6px;border-radius:4px;flex-shrink:0" title="Apagar">✕</button>`;
    container.appendChild(item);
  }
};

window.deleteMemory = async function (id) {
  await window.miar.memoryDelete(id);
  const cat = document.getElementById('memory-category-filter')?.value || 'todas';
  const q = document.getElementById('memory-search-input')?.value || '';
  await window.loadMemories(cat, q);
};

window.clearAllMemories = async function () {
  if (!confirm('Apagar TODAS as memórias? Esta ação não pode ser desfeita.')) return;
  await window.miar.memoryClearAll();
  await window.loadMemories();
};

// ── COPY MESSAGE ──────────────────────────────────────────────────────────────
window.copyMsg = function (id) {
  const el = document.getElementById(id);
  if (!el) return;
  const text = el.innerText || el.textContent || '';
  navigator.clipboard.writeText(text).then(() => {
    const btn = el.parentElement?.querySelector('.copy-btn');
    if (btn) { btn.textContent = '✓'; setTimeout(() => { btn.textContent = '⧉'; }, 1500); }
  }).catch(() => {
    // fallback
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy');
    document.body.removeChild(ta);
  });
};

// ── UPDATER NOTIFICATIONS ─────────────────────────────────────────────────────
if (window.miar?.onUpdaterStatus) {
  window.miar.onUpdaterStatus((data) => {
    const bar = document.getElementById('update-bar');
    const span = bar?.querySelector('span');
    if (data.type === 'available') {
      if (bar) { bar.style.display = 'flex'; }
      if (span) span.textContent = `⬇ Nova versão ${data.version} — baixando…`;
    } else if (data.type === 'progress') {
      if (bar) { bar.style.display = 'flex'; }
      if (span) span.textContent = `⬇ Baixando atualização… ${data.percent}%`;
    } else if (data.type === 'downloaded') {
      if (bar) { bar.style.display = 'flex'; }
      if (span) span.textContent = `⬆ Versão ${data.version} pronta — clique para instalar`;
    } else if (data.type === 'error') {
      if (span) span.textContent = `⚠ Erro ao atualizar: ${data.message?.substring(0, 60)}`;
      if (bar) { bar.style.display = 'flex'; }
    }
  });
}

// ── MODAL HELPERS ─────────────────────────────────────────────────────────────
function openModal(id) { document.getElementById(id)?.classList.remove('hidden'); }
window.closeModal = function (id) { document.getElementById(id)?.classList.add('hidden'); };

// ── EVENT LISTENERS ───────────────────────────────────────────────────────────
function setupEventListeners() {
  document.getElementById('new-conv-btn').addEventListener('click', async () => {
    const conv = await window.miar.createConversation('Nova conversa');
    state.currentConvId = conv.id;
    state.messages = [];
    clearChat();
    await loadConversationList();
  });

  document.getElementById('send-btn').addEventListener('click', sendMessage);

  const msgInput = document.getElementById('message-input');
  msgInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
  msgInput.addEventListener('input', function () { autoResizeTextarea(this); });

  document.getElementById('toggle-sidebar').addEventListener('click', () => document.getElementById('sidebar').classList.toggle('collapsed'));
  document.getElementById('settings-btn').addEventListener('click', window.openSettingsModal);
  document.getElementById('maintenance-btn').addEventListener('click', window.openMaintenanceModal);
  document.getElementById('attach-btn').addEventListener('click', handleAttach);
  document.getElementById('folder-btn').addEventListener('click', handleFolder);
  document.getElementById('mic-btn').addEventListener('click', toggleMic);

  document.getElementById('tts-btn').addEventListener('click', () => {
    state.ttsEnabled = !state.ttsEnabled;
    updateTtsBtn();
    if (!state.ttsEnabled) speechSynthesis.cancel();
    window.miar.saveSettings({ ttsEnabled: state.ttsEnabled });
  });

  document.getElementById('conv-title').addEventListener('click', async () => {
    if (!state.currentConvId) return;
    const cur = document.getElementById('conv-title').textContent;
    const newTitle = prompt('Renomear conversa:', cur);
    if (newTitle?.trim()) {
      await window.miar.updateConversationTitle({ id: state.currentConvId, title: newTitle.trim() });
      document.getElementById('conv-title').textContent = newTitle.trim();
      await loadConversationList();
    }
  });

  document.getElementById('search-box').addEventListener('input', async function () {
    const q = this.value.trim();
    if (!q) { await loadConversationList(); return; }
    const results = await window.miar.searchConversations(q);
    const container = document.getElementById('conversations');
    container.innerHTML = results.length
      ? results.map(r => `<div class="conv-item" onclick="openConversation('${r.id}')"><span class="conv-item-title">${escHtml(r.title)}</span></div>`).join('')
      : '<div style="padding:12px;font-size:12px;color:var(--text3)">Sem resultados.</div>';
  });

  document.getElementById('tts-rate').addEventListener('input', function () {
    document.getElementById('tts-rate-val').textContent = this.value;
    state.ttsRate = parseFloat(this.value);
  });
  document.getElementById('tts-pitch').addEventListener('input', function () {
    document.getElementById('tts-pitch-val').textContent = this.value;
    state.ttsPitch = parseFloat(this.value);
  });

  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.add('hidden'); });
  });
}

function updateTtsBtn() {
  const btn = document.getElementById('tts-btn');
  btn.textContent = state.ttsEnabled ? '🔊' : '🔇';
  btn.classList.toggle('active', state.ttsEnabled);
  btn.title = state.ttsEnabled ? 'Voz ligada (clique para desligar)' : 'Voz desligada (clique para ligar)';
}

function autoResizeTextarea(el) {
  el.style.height = 'auto';
  // Sem limite de altura — cresce conforme o conteúdo (uso pessoal)
  el.style.height = Math.min(el.scrollHeight, 420) + 'px';
}
