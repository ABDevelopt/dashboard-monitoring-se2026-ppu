/**
 * AI Chatbot Floating Widget — Dashboard Monitoring SE2026 PPU
 * Seamlessly synced with the main AI Assistant page (/agent), PJAX-aware, and AI model synced.
 */

(function () {
  'use strict';

  // Do not initialize on login page
  if (document.body && document.body.classList.contains('page-login')) {
    return;
  }
  if (window.location.pathname.startsWith('/login')) {
    return;
  }

  // Prevent duplicate initialization
  if (window._aiWidgetInitialized) return;
  window._aiWidgetInitialized = true;

  // Shared Storage Keys with /agent page
  const HISTORY_STORAGE_KEY = 'se2026_agent_chat_history';
  const SELECTED_AI_KEY = 'se2026_selected_ai';
  const OPEN_STATE_KEY = 'se2026_ai_widget_open_state';
  const MAX_HISTORY = 15;
  let chatHistory = [];
  let isSending = false;

  // Page context mapping
  function getPageContextName() {
    const path = window.location.pathname;
    if (path === '/' || path === '/overview') return 'Overview Dashboard';
    if (path.startsWith('/kecamatan')) return 'Monitoring Kecamatan';
    if (path.startsWith('/korlap')) return 'Monitoring Korlap';
    if (path.startsWith('/pml')) return 'Monitoring PML';
    if (path.startsWith('/pcl')) return 'Monitoring PCL';
    if (path.startsWith('/subsls')) return 'Monitoring SubSLS';
    if (path.startsWith('/harian')) return 'Progres Harian';
    if (path.startsWith('/earlywarning')) return 'Early Warning System';
    if (path.startsWith('/deteksianomali')) return 'Deteksi Anomali Data';
    if (path.startsWith('/leaderboard')) return 'Leaderboard & Peringkat';
    if (path.startsWith('/performa-terendah')) return 'Performa Terendah';
    if (path.startsWith('/map')) return 'Peta Spasial GIS';
    if (path.startsWith('/master')) return 'Master Data';
    if (path.startsWith('/agent')) return 'Halaman AI Asisten';
    if (path.startsWith('/kipp')) return 'Chatbot KIPP';
    if (path.startsWith('/upload')) return 'Upload Data FASIH';
    if (path.startsWith('/settings')) return 'Pengaturan Sistem';
    return document.title.split('—')[0].trim() || 'Monitoring SE2026';
  }

  // Get active selected AI info from localStorage
  function getSelectedAI() {
    try {
      const saved = localStorage.getItem(SELECTED_AI_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.model) return parsed;
      }
    } catch (e) {}
    return { provider: 'gemini', model: 'gemini-2.5-flash' };
  }

  // Format model string for clean header display
  function formatModelDisplayName(provider, model) {
    if (!model) return 'Gemini 2.5 Flash';
    
    let clean = model;
    if (clean.includes('/')) {
      clean = clean.split('/')[1] || clean;
    }
    clean = clean.replace(':free', '').replace('-instruct', '');

    const map = {
      'gemini-2.5-flash': 'Gemini 2.5 Flash',
      'gemini-3.1-flash-lite': 'Gemini 3.1 Flash-Lite',
      'gemini-3.5-flash': 'Gemini 3.5 Flash',
      'gemini-2.5-pro': 'Gemini 2.5 Pro',
      'gpt-5.5': 'OpenAI GPT-5.5',
      'gpt-4o': 'OpenAI GPT-4o',
      'llama-3.3-70b': 'Llama 3.3 70B',
      'deepseek-r1': 'DeepSeek R1',
      'qwen-2.5-coder-32b': 'Qwen 2.5 Coder 32B',
      'owl-alpha': 'Owl Alpha'
    };

    if (map[model]) return map[model];
    if (map[clean]) return map[clean];

    return clean
      .split('-')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }

  // Update status text in widget header to show active AI model
  function updateAiWidgetModelDisplay() {
    const statusElem = document.getElementById('ai-widget-status-text');
    if (!statusElem) return;
    const aiInfo = getSelectedAI();
    statusElem.textContent = formatModelDisplayName(aiInfo.provider, aiInfo.model);
  }

  window.updateAiWidgetModelDisplay = updateAiWidgetModelDisplay;

  // Update visibility & context dynamically based on current page URL
  function updateVisibilityForCurrentPage() {
    const fab = document.getElementById('ai-widget-fab');
    const container = document.getElementById('ai-widget-container');
    const contextElem = document.getElementById('ai-widget-context-name');

    const isAgentPage = window.location.pathname.startsWith('/agent');

    if (isAgentPage) {
      if (fab) {
        fab.style.display = 'none';
        fab.classList.remove('is-open');
      }
      if (container) {
        container.classList.remove('is-visible');
      }
    } else {
      if (fab) {
        fab.style.display = 'flex';
      }
      // Preserve widget open state across page navigation
      const wasOpen = sessionStorage.getItem(OPEN_STATE_KEY) === 'true';
      if (wasOpen && container && fab) {
        container.classList.add('is-visible');
        fab.classList.add('is-open');
        fab.classList.remove('is-idle');
      }
    }

    if (contextElem) {
      contextElem.textContent = getPageContextName();
    }

    updateAiWidgetModelDisplay();
  }

  // Expose globally for PJAX integration
  window.updateAiWidgetVisibility = updateVisibilityForCurrentPage;

  // Intercept history.pushState and replaceState to detect SPA/PJAX navigation immediately
  const originalPushState = history.pushState;
  history.pushState = function () {
    const result = originalPushState.apply(this, arguments);
    setTimeout(updateVisibilityForCurrentPage, 10);
    return result;
  };

  const originalReplaceState = history.replaceState;
  history.replaceState = function () {
    const result = originalReplaceState.apply(this, arguments);
    setTimeout(updateVisibilityForCurrentPage, 10);
    return result;
  };

  // Create DOM Elements
  function createWidgetDOM() {
    if (document.getElementById('ai-widget-container')) {
      updateVisibilityForCurrentPage();
      return;
    }

    // 1. Floating Action Button (FAB)
    const fab = document.createElement('button');
    fab.id = 'ai-widget-fab';
    fab.setAttribute('title', 'Buka Asisten AI SE2026 (Alt+A)');
    fab.setAttribute('aria-label', 'Buka Asisten AI');
    fab.innerHTML = `
      <i class="bi bi-chevron-left fab-icon-dock"></i>
      <i class="bi bi-robot fab-icon-chat"></i>
      <i class="bi bi-x-lg fab-icon-close"></i>
      <span class="fab-badge" title="AI Siap"></span>
    `;

    // 2. Chat Drawer Container
    const container = document.createElement('div');
    container.id = 'ai-widget-container';
    container.innerHTML = `
      <!-- Header -->
      <div class="ai-widget-header">
        <div class="ai-widget-header-info">
          <div class="ai-widget-avatar">
            <i class="bi bi-robot"></i>
          </div>
          <div>
            <div class="ai-widget-title">Asisten AI SE2026</div>
            <div class="ai-widget-status" id="ai-widget-status-text">Gemini 2.5 Flash</div>
          </div>
        </div>
        <div class="ai-widget-actions">
          <button id="ai-widget-expand" class="ai-widget-btn-icon" title="Buka Halaman Layar Penuh (/agent)">
            <i class="bi bi-box-arrow-up-right"></i>
          </button>
          <button id="ai-widget-clear" class="ai-widget-btn-icon" title="Bersihkan Percakapan">
            <i class="bi bi-trash3"></i>
          </button>
          <button id="ai-widget-close" class="ai-widget-btn-icon" title="Tutup">
            <i class="bi bi-chevron-down"></i>
          </button>
        </div>
      </div>

      <!-- Page Context Bar -->
      <div id="ai-widget-context" class="ai-widget-context-bar">
        <i class="bi bi-geo-alt-fill"></i>
        <span>Konteks: <strong id="ai-widget-context-name">${getPageContextName()}</strong></span>
      </div>

      <!-- Messages Body -->
      <div id="ai-widget-body" class="ai-widget-body">
        <!-- Default Welcome Message -->
        <div class="ai-msg ai-msg-assistant">
          <div class="ai-msg-bubble">
            Halo! 👋 Saya <strong>Asisten AI Monitoring SE2026 PPU</strong>.<br>
            Ada yang bisa saya bantu terkait progres pendataan, status milestone, petugas berisiko, atau deteksi anomali?
          </div>
          <span class="ai-msg-time">Sekarang</span>
        </div>
      </div>

      <!-- Quick Chips -->
      <div class="ai-widget-chips">
        <button class="ai-chip" data-query="Petugas mana saja yang 0 progres?"><i class="bi bi-exclamation-triangle"></i> PCL 0 Progres</button>
        <button class="ai-chip" data-query="Bagaimana pencapaian Milestone 2 saat ini?"><i class="bi bi-flag"></i> Milestone 2</button>
        <button class="ai-chip" data-query="Kecamatan mana yang paling lambat?"><i class="bi bi-bar-chart"></i> Kecamatan Tertinggal</button>
        <button class="ai-chip" data-query="Berapa banyak anomali data yang terdeteksi?"><i class="bi bi-shield-alert"></i> Deteksi Anomali</button>
      </div>

      <!-- Footer Input -->
      <div class="ai-widget-footer">
        <div class="ai-widget-input-wrap">
          <textarea id="ai-widget-input" class="ai-widget-textarea" placeholder="Tanyakan sesuatu tentang SE2026..." rows="1"></textarea>
          <button id="ai-widget-send" class="ai-widget-send-btn" title="Kirim Pesan (Enter)">
            <i class="bi bi-send-fill"></i>
          </button>
        </div>
        <div class="ai-widget-hint">Tekan <strong>Enter</strong> untuk mengirim • <strong>Alt + A</strong> untuk toggle</div>
      </div>
    `;

    document.body.appendChild(fab);
    document.body.appendChild(container);

    // Apply visibility and active AI model immediately
    updateVisibilityForCurrentPage();

    // Load shared chat history from localStorage
    restoreLocalStorageHistory();

    // Attach Event Listeners
    setupEventListeners();
  }

  function escapeHtml(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatInline(text) {
    return escapeHtml(text)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/&lt;br&gt;/g, '<br>');
  }

  function renderMarkdownBlocks(text) {
    const lines = String(text || '').split(/\r?\n/);
    const blocks = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      // Headers (# ## ###)
      if (/^#+\s+/.test(line)) {
        const level = Math.min(line.match(/^#+/)[0].length, 6);
        const content = line.replace(/^#+\s+/, '');
        blocks.push(`<h${level}>${formatInline(content)}</h${level}>`);
        i++; continue;
      }

      // Code blocks (```)
      if (line.trim().startsWith('```')) {
        const codeLanguage = line.trim().slice(3).trim() || 'code';
        i++;
        const codeLines = [];
        while (i < lines.length && !lines[i].trim().startsWith('```')) {
          codeLines.push(lines[i]);
          i++;
        }
        if (i < lines.length) i++;
        const codeContent = escapeHtml(codeLines.join('\n'));
        blocks.push(`<pre><div class="ai-widget-code-header"><span>${escapeHtml(codeLanguage)}</span><button class="ai-widget-copy-btn" onclick="copyWidgetCodeToClipboard(this)"><i class="bi bi-clipboard"></i> Salin</button></div><code>${codeContent}</code></pre>`);
        continue;
      }

      // Blockquotes (>)
      if (/^>\s+/.test(line)) {
        const quotes = [];
        while (i < lines.length && /^>\s+/.test(lines[i])) {
          quotes.push(lines[i].replace(/^>\s+/, ''));
          i++;
        }
        blocks.push(`<blockquote>${formatInline(quotes.join('<br>'))}</blockquote>`);
        continue;
      }

      // Tables (| Header | Header |)
      if (/^\s*\|.+\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|(?:\s*[:-]+\s*\|)+\s*$/.test(lines[i + 1])) {
        const headers = line.trim().slice(1, -1).split('|').map(c => c.trim());
        i += 2;
        const rows = [];
        while (i < lines.length && /^\s*\|.+\|\s*$/.test(lines[i])) {
          rows.push(lines[i].trim().slice(1, -1).split('|').map(c => c.trim()));
          i++;
        }
        blocks.push(`<div class="ai-widget-table-wrap"><table><thead><tr>${headers.map(h => `<th>${formatInline(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(c => `<td>${formatInline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
        continue;
      }

      // Unordered lists (- or *)
      if (/^\s*[-*]\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*[-*]\s+/, ''));
          i++;
        }
        blocks.push(`<ul>${items.map(item => `<li>${formatInline(item)}</li>`).join('')}</ul>`);
        continue;
      }

      // Ordered lists (1.)
      if (/^\s*\d+\.\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
          i++;
        }
        blocks.push(`<ol>${items.map(item => `<li>${formatInline(item)}</li>`).join('')}</ol>`);
        continue;
      }

      // Empty lines
      if (line.trim() === '') { i++; continue; }

      // Paragraphs
      const paragraph = [];
      paragraph.push(lines[i]);
      i++;
      while (
        i < lines.length &&
        lines[i].trim() !== '' &&
        !/^#+\s+/.test(lines[i]) &&
        !/^\s*\|.+\|\s*$/.test(lines[i]) &&
        !/^\s*[-*]\s+/.test(lines[i]) &&
        !/^\s*\d+\.\s+/.test(lines[i]) &&
        !/^>\s+/.test(lines[i]) &&
        !lines[i].trim().startsWith('```')
      ) {
        paragraph.push(lines[i]);
        i++;
      }
      if (paragraph.length > 0) {
        blocks.push(`<p>${formatInline(paragraph.join('<br>'))}</p>`);
      }
    }

    return blocks;
  }

  function renderMarkdown(text) {
    return renderMarkdownBlocks(text).join('');
  }

  window.copyWidgetCodeToClipboard = function(btn) {
    const codeBlock = btn.closest('pre');
    const codeElement = codeBlock ? codeBlock.querySelector('code') : null;
    if (!codeElement) return;
    const text = codeElement.textContent;
    
    navigator.clipboard.writeText(text).then(() => {
      const originalText = btn.innerHTML;
      btn.innerHTML = '<i class="bi bi-check"></i> Tersalin!';
      btn.style.background = 'rgba(34, 197, 94, 0.3)';
      setTimeout(() => {
        btn.innerHTML = originalText;
        btn.style.background = '';
      }, 2000);
    }).catch(() => {
      btn.innerHTML = '<i class="bi bi-exclamation-circle"></i> Gagal';
    });
  };

  // Append Message to UI
  function appendMessage(role, text, timeStr = null) {
    const body = document.getElementById('ai-widget-body');
    if (!body) return;

    const msgDiv = document.createElement('div');
    const isUser = role === 'user';
    msgDiv.className = `ai-msg ai-msg-${isUser ? 'user' : 'assistant'}`;

    const now = new Date();
    const timeDisplay = timeStr || now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    msgDiv.innerHTML = `
      <div class="ai-msg-bubble">${isUser ? escapeHtml(text) : renderMarkdown(text)}</div>
      <span class="ai-msg-time">${timeDisplay}</span>
    `;

    body.appendChild(msgDiv);
    body.scrollTop = body.scrollHeight;
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML.replace(/\n/g, '<br>');
  }

  // Show Typing Indicator
  function showTypingIndicator() {
    const body = document.getElementById('ai-widget-body');
    if (!body || document.getElementById('ai-widget-typing')) return;

    const typingDiv = document.createElement('div');
    typingDiv.id = 'ai-widget-typing';
    typingDiv.className = 'ai-msg ai-msg-assistant';
    typingDiv.innerHTML = `
      <div class="ai-typing-indicator">
        <span></span><span></span><span></span>
      </div>
    `;

    body.appendChild(typingDiv);
    body.scrollTop = body.scrollHeight;
  }

  // Remove Typing Indicator
  function removeTypingIndicator() {
    const typing = document.getElementById('ai-widget-typing');
    if (typing) typing.remove();
  }

  // Shared LocalStorage Persistence (synced with /agent page)
  function saveLocalStorageHistory() {
    try {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(chatHistory));
    } catch (e) {
      console.warn('[AI-WIDGET] Unable to save chat history to localStorage', e);
    }
  }

  function restoreLocalStorageHistory() {
    try {
      const saved = localStorage.getItem(HISTORY_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          chatHistory = parsed;
          const body = document.getElementById('ai-widget-body');
          if (body) body.innerHTML = ''; // clear default greeting
          chatHistory.forEach(msg => {
            appendMessage(msg.role === 'user' ? 'user' : 'assistant', msg.content);
          });
        }
      }
    } catch (e) {
      console.warn('[AI-WIDGET] Unable to restore chat history', e);
    }
  }

  // Send Query to /agent/chat
  async function handleSendMessage(customMessage = null) {
    if (isSending) return;

    const input = document.getElementById('ai-widget-input');
    const sendBtn = document.getElementById('ai-widget-send');
    const message = (customMessage || (input ? input.value : '')).trim();

    if (!message) return;

    if (input && !customMessage) {
      input.value = '';
      input.style.height = 'auto';
    }

    isSending = true;
    if (sendBtn) sendBtn.disabled = true;

    // Render User Message
    appendMessage('user', message);
    chatHistory.push({ role: 'user', content: message });
    saveLocalStorageHistory();

    // Show Typing Indicator
    showTypingIndicator();

    // Context hint for system
    const pageContext = getPageContextName();
    const contextPrompt = `[Pengguna membuka halaman: ${pageContext}] ${message}`;

    // Selected AI Model & Provider
    const aiInfo = getSelectedAI();

    try {
      const response = await fetch('/agent/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: JSON.stringify({
          message: contextPrompt,
          history: chatHistory.slice(-MAX_HISTORY),
          provider: aiInfo.provider,
          model: aiInfo.model
        })
      });

      removeTypingIndicator();

      if (response.status === 401) {
        appendMessage('assistant', '⚠️ *Akses ditolak.* Sesi Anda telah berakhir. Silakan login kembali untuk menggunakan Asisten AI.');
        return;
      }

      const data = await response.json();

      if (!response.ok || data.error) {
        appendMessage('assistant', `⚠️ ${data.error || 'Terjadi kesalahan saat memproses pertanyaan.'}`);
      } else {
        const replyText = data.reply || 'Maaf, tidak ada tanggapan.';
        appendMessage('assistant', replyText);
        chatHistory.push({ role: 'assistant', content: replyText });
        saveLocalStorageHistory();
      }

    } catch (err) {
      removeTypingIndicator();
      console.error('[AI-WIDGET] Fetch error:', err);
      appendMessage('assistant', '⚠️ Gagal terhubung ke server AI. Pastikan koneksi jaringan Anda stabil.');
    } finally {
      isSending = false;
      if (sendBtn) sendBtn.disabled = false;
      const body = document.getElementById('ai-widget-body');
      if (body) body.scrollTop = body.scrollHeight;
    }
  }

  // Setup Event Listeners
  function setupEventListeners() {
    const fab = document.getElementById('ai-widget-fab');
    const container = document.getElementById('ai-widget-container');
    const closeBtn = document.getElementById('ai-widget-close');
    const clearBtn = document.getElementById('ai-widget-clear');
    const expandBtn = document.getElementById('ai-widget-expand');
    const sendBtn = document.getElementById('ai-widget-send');
    const input = document.getElementById('ai-widget-input');

    function toggleWidget(show = null) {
      const isCurrentlyVisible = container.classList.contains('is-visible');
      const shouldShow = show !== null ? show : !isCurrentlyVisible;
      const isAgentPage = window.location.pathname.startsWith('/agent');

      if (shouldShow && !isAgentPage) {
        container.classList.add('is-visible');
        if (fab) {
          fab.classList.add('is-open');
          fab.classList.remove('is-idle');
        }
        try { sessionStorage.setItem(OPEN_STATE_KEY, 'true'); } catch (_) {}
        const contextElem = document.getElementById('ai-widget-context-name');
        if (contextElem) contextElem.textContent = getPageContextName();
        updateAiWidgetModelDisplay();
        if (input) setTimeout(() => input.focus(), 150);
      } else {
        container.classList.remove('is-visible');
        if (fab) fab.classList.remove('is-open');
        if (!isAgentPage) {
          try { sessionStorage.setItem(OPEN_STATE_KEY, 'false'); } catch (_) {}
        }
      }
    }

    if (fab) fab.addEventListener('click', () => toggleWidget());
    if (closeBtn) closeBtn.addEventListener('click', () => toggleWidget(false));

    // Expand to Full Page /agent
    if (expandBtn) {
      expandBtn.addEventListener('click', () => {
        try { sessionStorage.setItem(OPEN_STATE_KEY, 'false'); } catch (_) {}
        toggleWidget(false);
        window.location.href = '/agent';
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (confirm('Bersihkan seluruh percakapan Asisten AI? (Akan terhapus juga di halaman AI utama)')) {
          chatHistory = [];
          localStorage.removeItem(HISTORY_STORAGE_KEY);
          const body = document.getElementById('ai-widget-body');
          if (body) {
            body.innerHTML = `
              <div class="ai-msg ai-msg-assistant">
                <div class="ai-msg-bubble">
                  Percakapan dibersihkan. Ada yang bisa saya bantu lagi terkait monitoring SE2026?
                </div>
                <span class="ai-msg-time">Sekarang</span>
              </div>
            `;
          }
        }
      });
    }

    if (sendBtn) sendBtn.addEventListener('click', () => handleSendMessage());

    if (input) {
      // Auto resize textarea
      input.addEventListener('input', function () {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';
      });

      // Keydown Enter (Send) vs Shift+Enter (Newline)
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          handleSendMessage();
        }
      });
    }

    // Quick Chips Handler
    document.querySelectorAll('.ai-chip').forEach(chip => {
      chip.addEventListener('click', function () {
        const query = this.getAttribute('data-query');
        if (query) {
          handleSendMessage(query);
        }
      });
    });

    // Keyboard Shortcut (Alt + A)
    document.addEventListener('keydown', function (e) {
      if (e.altKey && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        toggleWidget();
      }
    });

    // Realtime sync across tabs or when changed in /agent page
    window.addEventListener('storage', function (e) {
      if (e.key === HISTORY_STORAGE_KEY) {
        restoreLocalStorageHistory();
      }
      if (e.key === SELECTED_AI_KEY) {
        updateAiWidgetModelDisplay();
      }
    });

    // Listen to history navigation & PJAX events — maintain open state and update context label!
    window.addEventListener('popstate', updateVisibilityForCurrentPage);
    window.addEventListener('pjax:start', updateVisibilityForCurrentPage);
    window.addEventListener('pjax:end', updateVisibilityForCurrentPage);
    window.addEventListener('pjax:complete', updateVisibilityForCurrentPage);

    // ── Inactivity / Idle Auto-Hide Timer (60 seconds) ────────────────
    const IDLE_TIMEOUT_MS = 60000;
    let idleTimer = null;

    function resetIdleTimer() {
      const fab = document.getElementById('ai-widget-fab');
      const container = document.getElementById('ai-widget-container');

      if (fab) fab.classList.remove('is-idle');

      if (idleTimer) clearTimeout(idleTimer);

      idleTimer = setTimeout(() => {
        // 1. Auto-close chat drawer if open
        if (container && container.classList.contains('is-visible')) {
          toggleWidget(false);
        }
        // 2. Dim FAB button when user is idle
        if (fab && !fab.classList.contains('is-open')) {
          fab.classList.add('is-idle');
        }
      }, IDLE_TIMEOUT_MS);
    }

    // Attach global user activity listeners
    ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'].forEach(evtName => {
      window.addEventListener(evtName, resetIdleTimer, { passive: true });
    });

    // Start initial timer
    resetIdleTimer();
  }

  // Initialize DOM on ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createWidgetDOM);
  } else {
    createWidgetDOM();
  }
})();
