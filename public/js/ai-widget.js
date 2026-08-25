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
    const VALID_MODELS = ['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.6-flash', 'gemini-3.7-flash', 'gemini-3.1-flash-lite', 'gemini-2.5-flash'];
    try {
      const saved = localStorage.getItem(SELECTED_AI_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.model && VALID_MODELS.includes(parsed.model)) {
          return { provider: 'gemini', model: parsed.model };
        }
      }
    } catch (e) {}
    return { provider: 'gemini', model: 'gemini-3.5-flash' };
  }

  // Format model string for clean header display
  function formatModelDisplayName(provider, model) {
    if (!model) return 'Gemini 3.5 Flash';
    
    let clean = model;
    if (clean.includes('/')) {
      clean = clean.split('/')[1] || clean;
    }
    clean = clean.replace(':free', '').replace('-instruct', '');

    const map = {
      'gemini-3.5-flash': 'Gemini 3.5 Flash',
      'gemini-3.5-flash-lite': 'Gemini 3.5 Flash-Lite',
      'gemini-3.6-flash': 'Gemini 3.6 Flash',
      'gemini-3.7-flash': 'Gemini 3.7 Flash',
      'gemini-3.1-flash-lite': 'Gemini 3.1 Flash-Lite',
      'gemini-2.5-flash': 'Gemini 2.5 Flash'
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
    fab.setAttribute('title', 'Tanyakan Pananyo Taka AI (Alt+A)');
    fab.setAttribute('aria-label', 'Tanyakan Pananyo Taka AI');
    fab.innerHTML = `
      <i class="bi bi-chevron-left fab-icon-dock"></i>
      <i class="bi bi-robot fab-icon-chat"></i>
      <i class="bi bi-x-lg fab-icon-close"></i>
      <span class="fab-badge" title="Pananyo Taka Aktif"></span>
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
            <div class="ai-widget-title" style="display: flex; align-items: center; gap: 6px;">
              Pananyo Taka <span class="gemini-gradient-text" style="font-size: 10px; font-weight: 800; padding: 1px 5px; border-radius: 4px; background: rgba(6, 182, 212, 0.12); color: var(--accent-cyan);">AI</span>
            </div>
            <div class="ai-widget-status" id="ai-widget-status-text">Pananyo Taka Active</div>
          </div>
        </div>
        <div class="ai-widget-actions">
          <button id="ai-widget-expand" class="ai-widget-btn-icon" title="Buka Layar Penuh Pananyo Taka (/agent)">
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
        <span>Konteks Halaman: <strong id="ai-widget-context-name">${getPageContextName()}</strong></span>
      </div>

      <!-- Messages Body -->
      <div id="ai-widget-body" class="ai-widget-body">
        <!-- Default Welcome Message -->
        <div class="ai-msg ai-msg-assistant">
          <div class="ai-msg-bubble">
            Halo! 👋 Saya <strong>Pananyo Taka</strong>, Asisten Pintar Sensus Ekonomi 2026 Penajam Paser Utara.<br>
            Ada yang bisa saya bantu terkait progres pendataan, status milestone, evaluasi petugas, atau deteksi anomali data?
          </div>
          <span class="ai-msg-time">Sekarang</span>
        </div>
      </div>


      <!-- Footer Input -->
      <div class="ai-widget-footer">
        <div class="ai-widget-input-wrap">
          <textarea id="ai-widget-input" class="ai-widget-textarea" placeholder="Tanyakan sesuatu tentang SE2026..." rows="1"></textarea>
          <button id="ai-widget-stop" class="ai-widget-stop-btn" title="Hentikan Jawaban" style="display: none;">
            <i class="bi bi-stop-fill"></i>
          </button>
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

  function getLinkIcon(href, label) {
    const cleanHref = String(href || '').toLowerCase().replace(/^\/[^/]+(?=\/)/, '');
    const norm = cleanHref.split('?')[0].split('#')[0];
    const lbl = String(label || '').toLowerCase();

    // 1. Path Matching (Highest Priority)
    if (norm === '' || norm === '/' || norm === '/overview') return 'bi-house-door';
    if (norm.includes('leaderboard')) return 'bi-trophy';
    if (norm.includes('performa')) return 'bi-graph-down';
    if (norm.includes('early')) return 'bi-exclamation-octagon';
    if (norm.includes('anomali')) return 'bi-shield-exclamation';
    if (norm.includes('harian')) return 'bi-calendar3';
    if (norm.includes('map')) return 'bi-map';
    if (norm.includes('kecamatan')) return 'bi-geo-alt';
    if (norm.includes('subsls') || norm.includes('sls')) return 'bi-box-seam';
    if (norm.includes('pcl')) return 'bi-person-workspace';
    if (norm.includes('pml')) return 'bi-clipboard2-data';
    if (norm.includes('korlap')) return 'bi-person-gear';
    if (norm.includes('export') || norm.includes('unduh')) return 'bi-download';
    if (norm.includes('upload')) return 'bi-cloud-arrow-up';
    if (norm.includes('table')) return 'bi-table';
    if (norm.includes('agent')) return 'bi-robot';

    // 2. Label Keyword Fallback
    if (lbl.includes('leaderboard') || lbl.includes('prestasi') || lbl.includes('peringkat')) return 'bi-trophy';
    if (lbl.includes('terendah') || lbl.includes('lambat')) return 'bi-graph-down';
    if (lbl.includes('early warning') || lbl.includes('peringatan')) return 'bi-exclamation-octagon';
    if (lbl.includes('anomali') || lbl.includes('ganda') || lbl.includes('reject')) return 'bi-shield-exclamation';
    if (lbl.includes('harian') || lbl.includes('tren') || lbl.includes('kecepatan')) return 'bi-calendar3';
    if (lbl.includes('peta') || lbl.includes('spasial')) return 'bi-map';
    if (lbl.includes('kecamatan')) return 'bi-geo-alt';
    if (lbl.includes('sls') || lbl.includes('blok sensus') || lbl.includes('wilayah')) return 'bi-box-seam';
    if (lbl.includes('pengawas') || lbl.includes('pml')) return 'bi-clipboard2-data';
    if (lbl.includes('korlap') || lbl.includes('koordinator')) return 'bi-person-gear';
    if (lbl.includes('pcl') || lbl.includes('ppl') || lbl.includes('petugas')) return 'bi-person-workspace';
    if (lbl.includes('unduh') || lbl.includes('export') || lbl.includes('laporan')) return 'bi-download';
    if (lbl.includes('beranda') || lbl.includes('ringkasan')) return 'bi-house-door';
    if (lbl.includes('tabel')) return 'bi-table';

    return 'bi-arrow-right-circle';
  }

  function formatInline(text) {
    const navPrefix = window.location.pathname.split('/')[1] && ['sakernas-pemutakhiran', 'sakernas-pendataan'].includes(window.location.pathname.split('/')[1])
      ? '/' + window.location.pathname.split('/')[1]
      : '';
    return escapeHtml(text)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, label, href) => {
        let finalHref = href;
        if (finalHref.startsWith('/') && !finalHref.startsWith('//') && navPrefix && !finalHref.startsWith(navPrefix + '/') && finalHref !== navPrefix) {
          finalHref = navPrefix + (finalHref === '/' ? '' : finalHref);
        }
        const isInternal = finalHref.startsWith('/') || finalHref.startsWith('#');
        const targetAttr = isInternal ? '' : ' target="_blank" rel="noopener"';
        const iconClass = getLinkIcon(href, label);
        return `<a href="${finalHref}" class="ai-widget-link"${targetAttr}><i class="bi ${iconClass}" style="font-size: 11.5px; opacity: 0.85; margin-right: 2px;"></i><span>${label}</span> <i class="bi bi-arrow-right-short" style="font-size: 12px; margin-left: 1px; opacity: 0.7;"></i></a>`;
      })
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
  function appendMessage(role, text, timeStr = null, queryId = null, rowCount = null) {
    const body = document.getElementById('ai-widget-body');
    if (!body) return;

    const msgDiv = document.createElement('div');
    const isUser = role === 'user';
    msgDiv.className = `ai-msg ai-msg-${isUser ? 'user' : 'assistant'}`;

    const now = new Date();
    const timeDisplay = timeStr || now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    let btnHtml = '';
    if (queryId) {
      const rowBadge = rowCount ? ` (${rowCount} Baris)` : '';
      const navPrefix = window.location.pathname.split('/')[1] && ['sakernas-pemutakhiran', 'sakernas-pendataan'].includes(window.location.pathname.split('/')[1])
        ? '/' + window.location.pathname.split('/')[1]
        : '';
      btnHtml = `<br><a href="${navPrefix}/agent/table?id=${queryId}" target="_blank" class="ai-widget-full-table-btn"><i class="bi bi-table"></i> Buka Tabel Lengkap${rowBadge} <i class="bi bi-box-arrow-up-right"></i></a>`;
    }

    msgDiv.innerHTML = `
      <div class="ai-msg-bubble">${isUser ? escapeHtml(text) : renderMarkdown(text)}${btnHtml}</div>
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

  let activeWidgetAbortController = null;

  function stopWidgetGeneration() {
    if (activeWidgetAbortController) {
      activeWidgetAbortController.abort();
      activeWidgetAbortController = null;
    }
  }

  function createWidgetStreamingMessage() {
    const body = document.getElementById('ai-widget-body');
    if (!body) return null;

    const msgDiv = document.createElement('div');
    msgDiv.className = 'ai-msg ai-msg-assistant';

    const bubble = document.createElement('div');
    bubble.className = 'ai-msg-bubble';

    const thinkingPill = document.createElement('div');
    thinkingPill.className = 'ai-widget-thinking-pill';
    thinkingPill.innerHTML = `
      <span class="ai-widget-pulse-dot"></span>
      <span class="ai-widget-thinking-text">Berpikir...</span>
    `;
    bubble.appendChild(thinkingPill);

    const stepsContainer = document.createElement('div');
    stepsContainer.className = 'ai-widget-steps-container';
    bubble.appendChild(stepsContainer);

    const contentEl = document.createElement('div');
    contentEl.className = 'ai-widget-stream-content';
    bubble.appendChild(contentEl);

    const cursorEl = document.createElement('span');
    cursorEl.className = 'ai-streaming-cursor';
    bubble.appendChild(cursorEl);

    const timeSpan = document.createElement('span');
    timeSpan.className = 'ai-msg-time';
    timeSpan.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    msgDiv.appendChild(bubble);
    msgDiv.appendChild(timeSpan);
    body.appendChild(msgDiv);
    body.scrollTop = body.scrollHeight;

    let accumulatedText = '';
    const stepItems = {};

    return {
      element: msgDiv,
      updateStatus(text) {
        const textEl = thinkingPill.querySelector('.ai-widget-thinking-text');
        if (textEl && text) textEl.textContent = text;
      },
      addStep(tool, message) {
        thinkingPill.style.display = 'inline-flex';
        this.updateStatus(message || tool);
        const item = document.createElement('div');
        item.className = 'ai-widget-step-item';
        item.innerHTML = `<i class="bi bi-arrow-repeat spin"></i> <span>${escapeHtml(message || tool)}</span>`;
        stepsContainer.appendChild(item);
        stepItems[tool] = item;
        body.scrollTop = body.scrollHeight;
      },
      completeStep(tool, message) {
        const item = stepItems[tool];
        if (item) {
          item.innerHTML = `<i class="bi bi-check-circle-fill text-success" style="color: #22c55e;"></i> <span>${escapeHtml(message || tool)}</span>`;
        }
        body.scrollTop = body.scrollHeight;
      },
      appendChunk(chunk) {
        if (!accumulatedText && chunk) {
          thinkingPill.style.display = 'none';
        }
        accumulatedText += chunk;
        contentEl.innerHTML = renderMarkdown(accumulatedText);
        body.scrollTop = body.scrollHeight;
      },
      getText() {
        return accumulatedText;
      },
      finalize(finalText, queryId = null, rowCount = null) {
        const textToRender = finalText || accumulatedText || 'Tidak ada tanggapan.';
        accumulatedText = textToRender;
        if (cursorEl.parentElement) cursorEl.remove();
        if (thinkingPill.parentElement) thinkingPill.remove();
        contentEl.innerHTML = renderMarkdown(textToRender);

        if (queryId) {
          const rowBadge = rowCount ? ` (${rowCount} Baris)` : '';
          const navPrefix = window.location.pathname.split('/')[1] && ['sakernas-pemutakhiran', 'sakernas-pendataan'].includes(window.location.pathname.split('/')[1])
            ? '/' + window.location.pathname.split('/')[1]
            : '';
          const tableBtn = document.createElement('a');
          tableBtn.href = `${navPrefix}/agent/table?id=${queryId}`;
          tableBtn.target = '_blank';
          tableBtn.className = 'ai-widget-full-table-btn';
          tableBtn.innerHTML = `<i class="bi bi-table"></i> Buka Tabel Lengkap${rowBadge} <i class="bi bi-box-arrow-up-right"></i>`;
          contentEl.appendChild(tableBtn);
        }

        body.scrollTop = body.scrollHeight;
      },
      showError(errText) {
        if (cursorEl.parentElement) cursorEl.remove();
        if (thinkingPill.parentElement) thinkingPill.remove();
        contentEl.innerHTML = `⚠️ ${escapeHtml(errText)}`;
        body.scrollTop = body.scrollHeight;
      },
      abortNotice() {
        if (cursorEl.parentElement) cursorEl.remove();
        if (thinkingPill.parentElement) thinkingPill.remove();
        if (accumulatedText.trim()) {
          contentEl.innerHTML = renderMarkdown(accumulatedText) + `<div style="font-size: 10px; color: var(--text-muted); font-style: italic; margin-top: 4px;"><i class="bi bi-stop-circle"></i> Dihentikan</div>`;
        } else {
          contentEl.innerHTML = `<em>Permintaan dihentikan oleh pengguna.</em>`;
        }
        body.scrollTop = body.scrollHeight;
      }
    };
  }

  // Show Typing Indicator (legacy fallback)
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
      window.dispatchEvent(new CustomEvent('ai_chat_history_updated', { detail: { source: 'widget' } }));
    } catch (e) {
      console.warn('[AI-WIDGET] Unable to save chat history to localStorage', e);
    }
  }

  function restoreLocalStorageHistory() {
    try {
      const saved = localStorage.getItem(HISTORY_STORAGE_KEY);
      const body = document.getElementById('ai-widget-body');
      if (!body) return;

      const DEFAULT_GREETING_HTML = `
        <div class="ai-msg ai-msg-assistant">
          <div class="ai-msg-bubble">
            Halo! 👋 Saya <strong>Pananyo Taka</strong>, Asisten Pintar Sensus Ekonomi 2026 Penajam Paser Utara.<br>
            Ada yang bisa saya bantu terkait progres pendataan, status milestone, evaluasi petugas, atau deteksi anomali data?
          </div>
          <span class="ai-msg-time">Sekarang</span>
        </div>`;

      if (!saved) {
        chatHistory = [];
        body.innerHTML = DEFAULT_GREETING_HTML;
        return;
      }

      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        chatHistory = parsed;
        body.innerHTML = '';
        chatHistory.forEach(msg => {
          appendMessage(msg.role === 'user' ? 'user' : 'assistant', msg.content, null, msg.queryId || null, msg.rowCount || null);
        });
      } else {
        chatHistory = [];
        body.innerHTML = DEFAULT_GREETING_HTML;
      }
    } catch (e) {
      console.warn('[AI-WIDGET] Unable to restore chat history', e);
    }
  }

  // Send Query to /agent/chat/stream with SSE
  async function handleSendMessage(customMessage = null) {
    if (isSending) return;

    const input = document.getElementById('ai-widget-input');
    const sendBtn = document.getElementById('ai-widget-send');
    const stopBtn = document.getElementById('ai-widget-stop');
    const message = (customMessage || (input ? input.value : '')).trim();

    if (!message) return;

    if (input && !customMessage) {
      input.value = '';
      input.style.height = 'auto';
    }

    isSending = true;
    if (sendBtn) sendBtn.style.display = 'none';
    if (stopBtn) stopBtn.style.display = 'inline-flex';
    if (input) input.disabled = true;

    // Render User Message
    while (chatHistory.length > 0 && chatHistory[chatHistory.length - 1].role === 'user') {
      chatHistory.pop();
    }

    appendMessage('user', message);
    chatHistory.push({ role: 'user', content: message });
    saveLocalStorageHistory();

    // Context hint for system
    const pageContext = getPageContextName();
    const contextPrompt = `[Pengguna membuka halaman: ${pageContext}] ${message}`;

    // Selected AI Model & Provider
    const aiInfo = getSelectedAI();

    const streamMsg = createWidgetStreamingMessage();
    const controller = new AbortController();
    activeWidgetAbortController = controller;

    try {
      const response = await fetch('/agent/chat/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
          'X-Requested-With': 'XMLHttpRequest',
          'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || ''
        },
        signal: controller.signal,
        body: JSON.stringify({
          message: contextPrompt,
          history: chatHistory.slice(0, -1).slice(-MAX_HISTORY),
          provider: aiInfo.provider,
          model: aiInfo.model
        })
      });

      if (response.status === 401) {
        streamMsg.showError('Akses ditolak. Sesi Anda telah berakhir. Silakan login kembali.');
        return;
      }

      if (!response.ok) {
        let errData;
        try { errData = await response.json(); } catch (_) {}
        throw new Error(errData?.error || `HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let currentEvent = 'message';
      let hasReceivedError = false;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          if (trimmed.startsWith('event:')) {
            currentEvent = trimmed.slice(6).trim();
          } else if (trimmed.startsWith('data:')) {
            const rawData = trimmed.slice(5).trim();
            try {
              const data = JSON.parse(rawData);
              if (currentEvent === 'status') {
                streamMsg.updateStatus(data.text);
              } else if (currentEvent === 'tool_start') {
                streamMsg.addStep(data.tool, data.message);
              } else if (currentEvent === 'tool_end') {
                streamMsg.completeStep(data.tool, data.message);
              } else if (currentEvent === 'chunk') {
                streamMsg.appendChunk(data.text || '');
              } else if (currentEvent === 'done') {
                streamMsg.finalize(data.reply || streamMsg.getText(), data.queryId, data.rowCount);
                const finalReply = streamMsg.getText();
                if (finalReply.trim()) {
                  chatHistory.push({ role: 'assistant', content: finalReply, queryId: data.queryId || null, rowCount: data.rowCount || null });
                  saveLocalStorageHistory();
                }
              } else if (currentEvent === 'error') {
                hasReceivedError = true;
                streamMsg.showError(data.error || 'Terjadi kesalahan AI.');
                if (chatHistory.length > 0 && chatHistory[chatHistory.length - 1].role === 'user') {
                  chatHistory.pop();
                  saveLocalStorageHistory();
                }
              }
            } catch (err) {
              console.warn('[AI-WIDGET:STREAM] Parse error:', err);
            }
          }
        }
      }

      // If finished stream without explicit done event or error
      const finalReply = streamMsg.getText();
      if (!hasReceivedError && finalReply.trim() && chatHistory[chatHistory.length - 1]?.role !== 'assistant') {
        streamMsg.finalize(finalReply);
        chatHistory.push({ role: 'assistant', content: finalReply });
        saveLocalStorageHistory();
      }

    } catch (err) {
      if (err.name === 'AbortError') {
        streamMsg.abortNotice();
        const partial = streamMsg.getText();
        if (partial.trim()) {
          chatHistory.push({ role: 'assistant', content: partial });
          saveLocalStorageHistory();
        } else if (chatHistory.length > 0 && chatHistory[chatHistory.length - 1].role === 'user') {
          chatHistory.pop();
          saveLocalStorageHistory();
        }
      } else {
        if (chatHistory.length > 0 && chatHistory[chatHistory.length - 1].role === 'user') {
          chatHistory.pop();
          saveLocalStorageHistory();
        }
        console.error('[AI-WIDGET] Stream error:', err);
        // Translate technical errors into user-friendly messages
        const raw = err?.message || '';
        let friendly = 'Gagal terhubung ke server AI. Pastikan koneksi stabil.';
        if (raw.includes('429') || raw.includes('quota') || raw.toLowerCase().includes('rate limit')) {
          friendly = 'Kuota harian API Gemini habis (429). Coba lagi besok atau ganti API Key.';
        } else if (raw.includes('403') || raw.includes('leaked')) {
          friendly = 'API Key Gemini tidak valid atau dicabut (403). Periksa pengaturan.';
        } else if (raw.includes('503') || raw.includes('Service Unavailable')) {
          friendly = 'Server Gemini sedang kelebihan beban (503). Coba lagi sebentar.';
        } else if (raw.includes('pipeThrough') || raw.includes('Cannot read properties of undefined')) {
          friendly = 'Terjadi error streaming AI (kemungkinan kuota habis). Coba lagi.';
        } else if (raw.includes('timed out') || raw.includes('timeout')) {
          friendly = 'Koneksi ke AI melebihi batas waktu. Periksa koneksi internet Anda.';
        } else if (raw.includes('HTTP 4') || raw.includes('HTTP 5')) {
          friendly = `Kesalahan server: ${raw}. Coba muat ulang halaman.`;
        }
        streamMsg.showError(friendly);
      }
    } finally {
      isSending = false;
      activeWidgetAbortController = null;
      if (stopBtn) stopBtn.style.display = 'none';
      if (sendBtn) sendBtn.style.display = 'inline-flex';
      if (input) {
        input.disabled = false;
        input.focus();
      }
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
          window.dispatchEvent(new CustomEvent('ai_chat_history_updated', { detail: { source: 'widget' } }));
        }
      });
    }

    if (sendBtn) sendBtn.addEventListener('click', () => handleSendMessage());
    const stopBtn = document.getElementById('ai-widget-stop');
    if (stopBtn) stopBtn.addEventListener('click', () => stopWidgetGeneration());

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

    // Keyboard Shortcut (Alt + A) & Escape to stop
    document.addEventListener('keydown', function (e) {
      if (e.altKey && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        toggleWidget();
      }
      if (e.key === 'Escape' && isSending) {
        stopWidgetGeneration();
      }
    });

    // Realtime sync across tabs or when changed in /agent page
    function handleWidgetHistorySync(e) {
      if (e.type === 'storage' && e.key === HISTORY_STORAGE_KEY) {
        restoreLocalStorageHistory();
      } else if (e.type === 'ai_chat_history_updated') {
        if (e.detail && e.detail.source === 'widget') return;
        restoreLocalStorageHistory();
      }
      if (e.type === 'storage' && e.key === SELECTED_AI_KEY) {
        updateAiWidgetModelDisplay();
      }
    }

    window.addEventListener('storage', handleWidgetHistorySync);
    window.addEventListener('ai_chat_history_updated', handleWidgetHistorySync);

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
