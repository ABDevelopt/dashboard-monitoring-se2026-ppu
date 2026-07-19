/**
 * SpreadsheetEditor v3
 *
 * Fix utama vs v2:
 * - Toolbar/formulaBar dipindah ke FIXED OVERLAY (bukan diinjeksi ke dalam card)
 *   sehingga collapse/expand card tidak merusak layout
 * - Re-entrancy guard pada _deactivate agar tidak double-fire dari MutationObserver
 * - Null-safe di seluruh method
 * - Cleanup proper: fixed DOM elements dibuang saat card collpase permanen (PJAX)
 * - Global event listeners dibatasi dan di-cleanup
 */
(function () {
  'use strict';

  /* ══════════════════════════════════════════════════════════
     FORMULA ENGINE  (tanpa eval)
  ══════════════════════════════════════════════════════════ */
  const FE = {
    colToIdx(letters) {
      let n = 0;
      for (let i = 0; i < letters.length; i++)
        n = n * 26 + letters.toUpperCase().charCodeAt(i) - 64;
      return n - 1;
    },
    idxToCol(n) {
      let s = ''; n += 1;
      while (n > 0) {
        const r = (n - 1) % 26;
        s = String.fromCharCode(65 + r) + s;
        n = Math.floor((n - 1) / 26);
      }
      return s;
    },
    bodyRows(table) {
      return Array.from(table.querySelectorAll('tbody tr'))
        .filter(r => getComputedStyle(r).display !== 'none');
    },
    cellVal(td) {
      const raw = td.dataset.rawValue ?? td.innerText.trim();
      const n = parseFloat(raw.replace(/,/g, ''));
      return isNaN(n) ? raw : n;
    },
    resolveRef(ref, table) {
      const m = ref.trim().match(/^([A-Z]+)(\d+)$/i);
      if (!m) return null;
      const c = this.colToIdx(m[1]), r = parseInt(m[2], 10) - 1;
      const row = this.bodyRows(table)[r]; if (!row) return null;
      const td = row.querySelectorAll('td')[c]; if (!td) return null;
      return this.cellVal(td);
    },
    resolveRange(range, table) {
      const m = range.trim().match(/^([A-Z]+)(\d*):([A-Z]+)(\d*)$/i);
      if (!m) return [];
      const c1 = this.colToIdx(m[1]), c2 = this.colToIdx(m[3]);
      const rows = this.bodyRows(table);
      const r1 = m[2] ? parseInt(m[2], 10) - 1 : 0;
      const r2 = m[4] ? parseInt(m[4], 10) - 1 : rows.length - 1;
      const vals = [];
      for (let r = r1; r <= Math.min(r2, rows.length - 1); r++)
        for (let c = c1; c <= c2; c++) {
          const td = rows[r]?.querySelectorAll('td')[c];
          if (td) { const v = this.cellVal(td); if (typeof v === 'number') vals.push(v); }
        }
      return vals;
    },
    evaluate(formula, table) {
      if (!String(formula).startsWith('=')) return formula;
      try { return this._expr(formula.slice(1).trim(), table); }
      catch (_) { return '#VALUE!'; }
    },
    _expr(s, table) {
      const fnM = s.match(/^([A-Z_]+)\(([\s\S]*)\)$/i);
      if (fnM) return this._fn(fnM[1].toUpperCase(), fnM[2], table);
      for (const ops of [['+', '-'], ['*', '/']]) {
        let depth = 0;
        for (let i = s.length - 1; i > 0; i--) {
          const c = s[i];
          if (c === ')') depth++; else if (c === '(') depth--;
          if (!depth && ops.includes(c)) {
            const L = this._scalar(s.slice(0, i), table);
            const R = this._scalar(s.slice(i + 1), table);
            if (c === '+') return +L + +R;
            if (c === '-') return +L - +R;
            if (c === '*') return +L * +R;
            if (c === '/') return +R === 0 ? '#DIV/0!' : +L / +R;
          }
        }
      }
      if (/^[A-Z]+\d+$/i.test(s)) { const v = this.resolveRef(s, table); return v ?? '#REF!'; }
      if (/^["'].*["']$/.test(s)) return s.slice(1, -1);
      const n = parseFloat(s); if (!isNaN(n)) return n;
      return '#VALUE!';
    },
    _scalar(s, table) {
      s = s.trim();
      const fnM = s.match(/^([A-Z_]+)\(([\s\S]*)\)$/i);
      if (fnM) return this._fn(fnM[1].toUpperCase(), fnM[2], table);
      if (/^[A-Z]+\d+$/i.test(s)) return this.resolveRef(s, table) ?? 0;
      if (/^["'].*["']$/.test(s)) return s.slice(1, -1);
      const n = parseFloat(s); return isNaN(n) ? s : n;
    },
    _args(str) {
      const a = []; let cur = '', depth = 0, inStr = false, sc = '';
      for (const c of str) {
        if (!inStr && (c === '"' || c === "'")) { inStr = true; sc = c; cur += c; }
        else if (inStr && c === sc) { inStr = false; cur += c; }
        else if (!inStr && c === '(') { depth++; cur += c; }
        else if (!inStr && c === ')') { depth--; cur += c; }
        else if (!inStr && !depth && c === ',') { a.push(cur.trim()); cur = ''; }
        else cur += c;
      }
      if (cur.trim()) a.push(cur.trim());
      return a;
    },
    _cond(s, table) {
      s = s.trim();
      for (const op of ['>=', '<=', '<>', '!=', '>', '<', '=']) {
        const i = s.indexOf(op);
        if (i > 0) {
          const L = this._scalar(s.slice(0, i).trim(), table);
          const R = this._scalar(s.slice(i + op.length).trim().replace(/^["']|["']$/g, ''), table);
          if (op === '>') return L > R; if (op === '<') return L < R;
          if (op === '>=') return L >= R; if (op === '<=') return L <= R;
          if (op === '=' || op === '==') return L == R;
          if (op === '<>' || op === '!=') return L != R;
        }
      }
      const v = this._scalar(s, table);
      return !!v && v !== 'FALSE' && v !== 0;
    },
    _match(raw, crit) { return String(raw).toLowerCase() === String(crit).toLowerCase(); },
    _r2(n) { return Math.round(n * 100) / 100; },
    _fn(name, argsStr, table) {
      const A = this._args(argsStr);
      const nums = () => this.resolveRange(A[0], table);
      switch (name) {
        case 'SUM':     return this._r2(nums().reduce((s, v) => s + v, 0));
        case 'AVG': case 'AVERAGE': { const v = nums(); return v.length ? this._r2(v.reduce((s, x) => s + x, 0) / v.length) : 0; }
        case 'MIN':     return nums().length ? Math.min(...nums()) : 0;
        case 'MAX':     return nums().length ? Math.max(...nums()) : 0;
        case 'COUNT':   return nums().length;
        case 'COUNTA': {
          const m = A[0].match(/^([A-Z]+)/i); if (!m) return 0;
          const c = this.colToIdx(m[1]);
          return this.bodyRows(table).filter(r => r.querySelectorAll('td')[c]?.innerText.trim()).length;
        }
        case 'ROUND': { const v = this._scalar(A[0], table), d = A[1] ? +A[1] : 0; return typeof v === 'number' ? +v.toFixed(d) : '#VALUE!'; }
        case 'ABS':   { const v = this._scalar(A[0], table); return typeof v === 'number' ? Math.abs(v) : '#VALUE!'; }
        case 'IF': {
          if (A.length < 3) return '#VALUE!';
          const chosen = this._cond(A[0], table) ? A[1].trim() : A[2].trim();
          return /^["'].*["']$/.test(chosen) ? chosen.slice(1, -1) : this._scalar(chosen, table);
        }
        case 'AND': return A.every(a => this._cond(a, table)) ? 'TRUE' : 'FALSE';
        case 'OR':  return A.some(a => this._cond(a, table)) ? 'TRUE' : 'FALSE';
        case 'NOT': return this._cond(A[0], table) ? 'FALSE' : 'TRUE';
        case 'CONCAT': case 'CONCATENATE':
          return A.map(a => /^["'].*["']$/.test(a.trim()) ? a.trim().slice(1, -1) : this._scalar(a.trim(), table)).join('');
        case 'LEN': { const v = /^["'].*["']$/.test(A[0].trim()) ? A[0].trim().slice(1, -1) : String(this._scalar(A[0], table)); return v.length; }
        case 'UPPER': return String(this._scalar(A[0], table)).toUpperCase();
        case 'LOWER': return String(this._scalar(A[0], table)).toLowerCase();
        case 'TRIM':  return String(this._scalar(A[0], table)).trim();
        case 'COUNTIF': {
          if (A.length < 2) return '#VALUE!';
          const crit = A[1].trim().replace(/^["']|["']$/g, '');
          const m = A[0].match(/^([A-Z]+)/i); if (!m) return 0;
          const c = this.colToIdx(m[1]);
          return this.bodyRows(table).filter(r => {
            const td = r.querySelectorAll('td')[c]; if (!td) return false;
            return this._match((td.dataset.rawValue ?? td.innerText).trim(), crit);
          }).length;
        }
        case 'SUMIF': {
          if (A.length < 3) return '#VALUE!';
          const crit = A[1].trim().replace(/^["']|["']$/g, '');
          const m1 = A[0].match(/^([A-Z]+)/i), m2 = A[2].match(/^([A-Z]+)/i);
          if (!m1 || !m2) return '#REF!';
          const cc = this.colToIdx(m1[1]), sc2 = this.colToIdx(m2[1]);
          let t = 0;
          this.bodyRows(table).forEach(r => {
            const ct = r.querySelectorAll('td')[cc], st = r.querySelectorAll('td')[sc2];
            if (!ct || !st) return;
            if (this._match((ct.dataset.rawValue ?? ct.innerText).trim(), crit)) {
              const n = parseFloat((st.dataset.rawValue ?? st.innerText).replace(/,/g, ''));
              if (!isNaN(n)) t += n;
            }
          });
          return this._r2(t);
        }
        default: return '#NAME?';
      }
    }
  };

  /* ══════════════════════════════════════════════════════════
     COLUMN MAP — Menangani colspan/rowspan
  ══════════════════════════════════════════════════════════ */
  function buildColumnMap(table) {
    // Hanya thead yang visible
    const theadEls = Array.from(table.querySelectorAll('thead')).filter(
      el => getComputedStyle(el).display !== 'none'
    );
    const theadRows = theadEls.flatMap(el =>
      Array.from(el.querySelectorAll('tr')).filter(r => getComputedStyle(r).display !== 'none')
    );
    if (!theadRows.length) return [];

    const firstBodyRow = table.querySelector('tbody tr');
    const totalBodyCols = firstBodyRow ? firstBodyRow.querySelectorAll('td').length : 0;
    if (!totalBodyCols) return [];

    // Bangun grid [theadRowIdx][bodyColIdx] = thElement
    const grid = theadRows.map(() => new Array(totalBodyCols).fill(null));

    theadRows.forEach((tr, ri) => {
      let cursor = 0;
      Array.from(tr.querySelectorAll('th')).forEach(th => {
        while (cursor < totalBodyCols && grid[ri][cursor] !== null) cursor++;
        if (cursor >= totalBodyCols) return;
        const cs = Math.max(1, parseInt(th.getAttribute('colspan') || 1, 10));
        const rs = Math.max(1, parseInt(th.getAttribute('rowspan') || 1, 10));
        for (let r = ri; r < Math.min(ri + rs, theadRows.length); r++)
          for (let c = cursor; c < Math.min(cursor + cs, totalBodyCols); c++)
            grid[r][c] = th;
        cursor += cs;
      });
    });

    const lastRow = grid[grid.length - 1] || [];
    const firstRow = grid[0] || [];
    return Array.from({ length: totalBodyCols }, (_, c) => {
      const thEl = lastRow[c] || null;
      const groupThEl = (firstRow[c] && firstRow[c] !== thEl) ? firstRow[c] : null;
      return {
        bodyIdx: c,
        label: thEl ? (thEl.innerText.trim() || `Kolom ${c + 1}`) : `Kolom ${c + 1}`,
        thEl,
        groupThEl
      };
    });
  }

  /* ══════════════════════════════════════════════════════════
     SPREADSHEET EDITOR  v3
  ══════════════════════════════════════════════════════════ */
  class SpreadsheetEditor {
    constructor(card) {
      this.card    = card;
      this.table   = card.querySelector('table');
      if (!this.table) return;
      if (!this.table.id) this.table.id = 'tbl_' + Math.random().toString(36).slice(2, 9);
      this.tableId = this.table.id;
      this.storageKey = `sheet_v3_${this.tableId}`;

      this.editMode     = false;
      this.activeCell   = null;
      this.history      = [];
      this.histPtr      = -1;
      this.MAX_HIST     = 50;
      this._deactivating = false; // Re-entrancy guard

      this.state = this._loadState();
      this._buildOverlay();   // Toolbar sebagai FIXED overlay, bukan child card
      this._applyState();
      this._bindEvents();
    }

    /* ── State ── */
    _loadState() {
      try { const r = localStorage.getItem(this.storageKey); if (r) return JSON.parse(r); }
      catch (_) {}
      return { editedCells: {}, customCols: [], hiddenBodyCols: [] };
    }
    _saveState() {
      try { localStorage.setItem(this.storageKey, JSON.stringify(this.state)); } catch (_) {}
    }
    _hasOverrides() {
      return Object.keys(this.state.editedCells).length > 0 ||
             this.state.customCols.length > 0 ||
             this.state.hiddenBodyCols.length > 0;
    }

    /* ══════════════════════════════════════════════
       BUILD UI — Toolbar sebagai FIXED overlay
       (tidak diinjeksi ke dalam card)
    ══════════════════════════════════════════════ */
    _buildOverlay() {
      // Wrap container fixed di atas layar (di bawah topbar)
      this.overlay = document.createElement('div');
      this.overlay.className = 'sheet-overlay';
      this.overlay.id = `shOverlay_${this.tableId}`;
      this.overlay.innerHTML = `
        <div class="sheet-toolbar" id="shToolbar_${this.tableId}">
          <span class="sheet-edit-badge"><i class="bi bi-pencil-fill"></i> Edit</span>
          <button class="sheet-btn" data-sh="toggle-edit" title="Aktifkan/nonaktifkan mode edit">
            <i class="bi bi-pencil"></i><span class="sheet-btn-label"> Edit</span>
          </button>
          <div class="sheet-toolbar-sep"></div>
          <button class="sheet-btn" data-sh="undo" title="Undo (Ctrl+Z)" disabled>
            <i class="bi bi-arrow-counterclockwise"></i><span class="sheet-btn-label"> Undo</span>
          </button>
          <button class="sheet-btn" data-sh="redo" title="Redo (Ctrl+Y)" disabled>
            <i class="bi bi-arrow-clockwise"></i><span class="sheet-btn-label"> Redo</span>
          </button>
          <div class="sheet-toolbar-sep"></div>
          <button class="sheet-btn" data-sh="add-col" title="Tambah kolom kustom">
            <i class="bi bi-plus-square"></i><span class="sheet-btn-label"> + Kolom</span>
          </button>
          <button class="sheet-btn" data-sh="col-panel" title="Kelola visibilitas kolom">
            <i class="bi bi-eye"></i><span class="sheet-btn-label"> Kolom</span>
          </button>
          <div class="sheet-toolbar-sep"></div>
          <button class="sheet-btn danger" data-sh="reset" style="display:none" title="Reset semua perubahan ke data asli">
            <i class="bi bi-arrow-counterclockwise"></i><span class="sheet-btn-label"> Reset</span>
          </button>
          
          <!-- Tombol Collapse disematkan di paling kanan toolbar -->
          <div style="margin-left: auto; display: flex; gap: 6px; align-items: center;">
            <button class="sheet-btn" data-sh="collapse" style="background: rgba(239, 68, 68, 0.1); color: #ef4444; border-color: rgba(239, 68, 68, 0.2);" title="Kembalikan ukuran tabel ke normal">
              <i class="bi bi-fullscreen-exit"></i><span class="sheet-btn-label" style="color: #ef4444;"> Collapse</span>
            </button>
          </div>
        </div>
        <div class="sheet-formula-bar" id="shFxBar_${this.tableId}">
          <span class="sheet-cell-ref" id="shCellRef_${this.tableId}">—</span>
          <span class="sheet-fx-icon">fx</span>
          <input class="sheet-formula-input" id="shFxInput_${this.tableId}"
                 placeholder="Ketik nilai atau =FORMULA()" autocomplete="off" spellcheck="false">
        </div>
      `;
      document.body.appendChild(this.overlay);

      // Column panel
      this.colPanel = this._mkEl('div', 'sheet-col-panel', `shColPanel_${this.tableId}`);
      // Add-col dialog + backdrop
      this.addColDlg = this._mkEl('div', 'sheet-add-col-dialog', `shAddColDlg_${this.tableId}`);
      this.backdrop  = this._mkEl('div', 'sheet-backdrop', `shBackdrop_${this.tableId}`);
      // Context menu
      this.ctxMenu   = this._mkEl('div', 'sheet-ctx-menu', `shCtxMenu_${this.tableId}`);

      // Shortcuts to key elements
      this.toolbar   = this.overlay.querySelector('.sheet-toolbar');
      this.fxBar     = this.overlay.querySelector('.sheet-formula-bar');
      this.fxInput   = document.getElementById(`shFxInput_${this.tableId}`);
      this.cellRefEl = document.getElementById(`shCellRef_${this.tableId}`);

      this._updateResetBtn();
    }

    _mkEl(tag, cls, id) {
      const el = document.createElement(tag);
      el.className = cls; if (id) el.id = id;
      document.body.appendChild(el);
      return el;
    }

    /* ── Apply State to DOM ── */
    _applyState() {
      this._renderCustomCols();
      this._applyHiddenCols();
      this._applyEditedCells();
    }

    /* ══════════════════════════════════════════════
       EVENTS
    ══════════════════════════════════════════════ */
    _bindEvents() {
      // Toolbar clicks
      this._onToolbar = e => {
        const btn = e.target.closest('[data-sh]');
        if (!btn) return;
        const a = btn.dataset.sh;
        if (a === 'toggle-edit') this._toggleEditMode();
        else if (a === 'undo')      this._undo();
        else if (a === 'redo')      this._redo();
        else if (a === 'add-col')   this._openAddColDlg();
        else if (a === 'col-panel') this._toggleColPanel();
        else if (a === 'reset')     this._confirmReset();
        else if (a === 'collapse') {
          // Trigger tombol expand bawaan card untuk meng-collapse kembali
          const nativeCollapseBtn = this.card.querySelector('.btn-expand-table');
          if (nativeCollapseBtn) {
            nativeCollapseBtn.click();
          } else {
            // Fallback jika tombol tidak ditemukan, hapus kelas expanded langsung
            this.card.classList.remove('card-expanded');
            window.dispatchEvent(new Event('resize'));
          }
        }
      };
      this.toolbar.addEventListener('click', this._onToolbar);

      // Formula bar
      this._onFxKey = e => {
        if (e.key === 'Enter')  { e.preventDefault(); this._commitFx(); this._moveActive(1, 0); }
        if (e.key === 'Escape') { e.preventDefault(); this._cancelEdit(); }
        if (e.key === 'Tab')    { e.preventDefault(); this._commitFx(); this._moveActive(0, e.shiftKey ? -1 : 1); }
      };
      if (this.fxInput) {
        this.fxInput.addEventListener('input', () => {
          if (this.activeCell) this.activeCell.td.dataset.pendingValue = this.fxInput.value;
        });
        this.fxInput.addEventListener('keydown', this._onFxKey);
      }

      // Table cell interactions
      this._onTableClick = e => {
        const td = e.target.closest('td');
        if (!td || !this.editMode) return;
        this._selectCell(td);
      };
      this._onTableDblclick = e => {
        const td = e.target.closest('td');
        if (!td || !this.editMode) return;
        this._startInlineEdit(td);
      };
      this._onTableCtx = e => {
        const th = e.target.closest('th');
        if (!th || !this.editMode) return;
        e.preventDefault();
        this._showCtxMenu(e.clientX, e.clientY, th);
      };
      this.table.addEventListener('click',       this._onTableClick);
      this.table.addEventListener('dblclick',    this._onTableDblclick);
      this.table.addEventListener('contextmenu', this._onTableCtx);

      // Global keyboard
      this._onKeydown = e => {
        if (!this.card.classList.contains('card-expanded')) return;
        const ctrl = e.ctrlKey || e.metaKey;
        if (ctrl && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); this._undo(); return; }
        if (ctrl && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); this._redo(); return; }
        if (!this.editMode) return;
        if (e.key === 'Escape') { this._cancelEdit(); return; }
        if (e.key === 'Tab' && !e.target.closest('.sheet-add-col-dialog')) {
          e.preventDefault(); this._moveActive(0, e.shiftKey ? -1 : 1); return;
        }
        const dirs = { ArrowDown: [1, 0], ArrowUp: [-1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
        if (dirs[e.key] && !e.target.closest('input, textarea')) {
          e.preventDefault(); this._moveActive(...dirs[e.key]);
        }
      };
      document.addEventListener('keydown', this._onKeydown);

      // Outside clicks close panels
      this._onDocClick = e => {
        if (this.colPanel && !this.colPanel.contains(e.target) && !e.target.closest('[data-sh="col-panel"]'))
          this.colPanel.classList.remove('is-open');
        if (this.ctxMenu && !this.ctxMenu.contains(e.target))
          this.ctxMenu.classList.remove('is-open');
      };
      document.addEventListener('click', this._onDocClick);

      // Backdrop
      if (this.backdrop) {
        this._onBackdrop = () => this._closeDialogs();
        this.backdrop.addEventListener('click', this._onBackdrop);
      }

      // MutationObserver: card-expanded removed → deactivate
      // Using a flag to prevent re-entrancy
      this._observer = new MutationObserver(() => {
        if (!this.card.classList.contains('card-expanded')) {
          this._onCardCollapsed();
        }
      });
      this._observer.observe(this.card, { attributes: true, attributeFilter: ['class'] });
    }

    /* ── Show/Hide overlay when card expands/collapses ── */
    _onCardCollapsed() {
      if (this._deactivating) return;   // Re-entrancy guard
      this._deactivating = true;
      try {
        this._hideOverlay();
        if (this.editMode) {
          this.editMode = false;
          const btn = this.toolbar?.querySelector('[data-sh="toggle-edit"]');
          if (btn) { btn.classList.remove('active'); btn.innerHTML = '<i class="bi bi-pencil"></i><span class="sheet-btn-label"> Edit</span>'; }
        }
        // Jangan hapus sheet-edit-mode di sini (sudah tidak di class list card-expanded)
        this._safeClose();
      } finally {
        this._deactivating = false;
      }
    }

    showOverlay() {
      if (this.overlay) {
        this.overlay.style.display = 'flex';
        this._applyState(); // Re-apply karena mungkin ada perubahan saat tidak visible
      }
    }

    _hideOverlay() {
      if (this.overlay) this.overlay.style.display = 'none';
      // Juga sembunyikan panels
      if (this.colPanel)  this.colPanel.classList.remove('is-open');
      if (this.ctxMenu)   this.ctxMenu.classList.remove('is-open');
      if (this.addColDlg) this.addColDlg.classList.remove('is-open');
      if (this.backdrop)  this.backdrop.classList.remove('is-open');
    }

    _safeClose() {
      if (this.activeCell?.td) {
        try { this.activeCell.td.classList.remove('sheet-cell-active'); } catch (_) {}
        try { this.activeCell.td.querySelector('.sheet-cell-input')?.remove(); } catch (_) {}
      }
      this.activeCell = null;
      if (this.cellRefEl) try { this.cellRefEl.textContent = '—'; } catch (_) {}
      if (this.fxInput)   try { this.fxInput.value = ''; } catch (_) {}
    }

    /* ── Cleanup (called when editor is fully destroyed) ── */
    destroy() {
      try {
        if (this._observer) { this._observer.disconnect(); this._observer = null; }
        if (this._onToolbar && this.toolbar)  this.toolbar.removeEventListener('click', this._onToolbar);
        if (this._onKeydown)  document.removeEventListener('keydown', this._onKeydown);
        if (this._onDocClick) document.removeEventListener('click', this._onDocClick);
        if (this.fxInput && this._onFxKey)    this.fxInput.removeEventListener('keydown', this._onFxKey);
        if (this.table) {
          if (this._onTableClick)    this.table.removeEventListener('click',       this._onTableClick);
          if (this._onTableDblclick) this.table.removeEventListener('dblclick',    this._onTableDblclick);
          if (this._onTableCtx)      this.table.removeEventListener('contextmenu', this._onTableCtx);
        }
        // Remove fixed DOM elements
        [this.overlay, this.colPanel, this.addColDlg, this.backdrop, this.ctxMenu].forEach(el => {
          try { el?.remove(); } catch (_) {}
        });
      } catch (_) {}
    }

    /* ── Edit Mode ── */
    _toggleEditMode() {
      this.editMode = !this.editMode;
      this.card.classList.toggle('sheet-edit-mode', this.editMode);
      this.overlay.classList.toggle('sheet-edit-mode', this.editMode);

      const btn = this.toolbar.querySelector('[data-sh="toggle-edit"]');
      if (this.editMode) {
        btn?.classList.add('active');
        if (btn) btn.innerHTML = '<i class="bi bi-pencil-fill"></i><span class="sheet-btn-label"> Edit ON</span>';
        this._markEditableCells();
      } else {
        btn?.classList.remove('active');
        if (btn) btn.innerHTML = '<i class="bi bi-pencil"></i><span class="sheet-btn-label"> Edit</span>';
        this.card.classList.remove('sheet-edit-mode');
        this._safeClose();
      }
    }
    _markEditableCells() {
      this.table.querySelectorAll('td').forEach(td => {
        td.classList.add('sheet-editable');
        if (!td.dataset.rawValue) td.dataset.rawValue = td.innerText.trim();
      });
    }

    /* ── Cell Selection ── */
    _selectCell(td) {
      if (!td) return;
      this._safeClose();
      td.classList.add('sheet-cell-active');
      const pos = this._cellPos(td);
      this.activeCell = { td, ...pos };
      if (this.cellRefEl) this.cellRefEl.textContent = `${FE.idxToCol(pos.colIdx)}${pos.rowIdx + 1}`;
      const stored = this._getStoredValue(td, pos);
      if (this.fxInput) this.fxInput.value = stored !== null ? stored : (td.dataset.rawValue ?? td.innerText.trim());
    }
    _cellPos(td) {
      const row = td.closest('tr');
      const rows = Array.from(this.table.querySelectorAll('tbody tr'));
      return {
        rowIdx: rows.indexOf(row),
        colIdx: Array.from(row.querySelectorAll('td')).indexOf(td)
      };
    }
    _getStoredValue(td, pos) {
      if (td.dataset.customColId) {
        const col = this.state.customCols.find(c => c.id === td.dataset.customColId);
        return col ? (col.cells[String(pos.rowIdx)] ?? null) : null;
      }
      const k = `${pos.rowIdx}_${pos.colIdx}`;
      return this.state.editedCells[k] ?? null;
    }

    /* ── Inline Edit ── */
    _startInlineEdit(td) {
      if (!td) return;
      this._selectCell(td);
      if (td.querySelector('.sheet-cell-input')) return;
      const inp = document.createElement('input');
      inp.className = 'sheet-cell-input'; inp.type = 'text';
      const pos = this._cellPos(td);
      const stored = this._getStoredValue(td, pos);
      inp.value = stored !== null ? stored : (td.dataset.rawValue ?? td.innerText.trim());
      td.style.position = 'relative';
      td.appendChild(inp);
      inp.focus(); inp.select();
      inp.addEventListener('input', () => { if (this.fxInput) this.fxInput.value = inp.value; });
      inp.addEventListener('keydown', e => {
        if (e.key === 'Enter')  { e.preventDefault(); this._commitInline(td, inp.value); this._moveActive(1, 0); }
        if (e.key === 'Escape') { e.preventDefault(); inp.remove(); this._cancelEdit(); }
        if (e.key === 'Tab')    { e.preventDefault(); this._commitInline(td, inp.value); this._moveActive(0, e.shiftKey ? -1 : 1); }
      });
      inp.addEventListener('blur', () => { if (td.contains(inp)) this._commitInline(td, inp.value); });
    }
    _commitInline(td, val) { td.querySelector('.sheet-cell-input')?.remove(); this._setCell(td, val); }
    _commitFx()             { if (this.activeCell?.td) this._setCell(this.activeCell.td, this.fxInput?.value ?? ''); }
    _cancelEdit()           { this.activeCell?.td?.querySelector('.sheet-cell-input')?.remove(); this._safeClose(); }

    /* ── Core: Set Cell Value ── */
    _setCell(td, newVal) {
      if (!td) return;
      const pos = this._cellPos(td);

      // Custom column cell
      if (td.dataset.customColId) {
        const colId = td.dataset.customColId;
        const ri    = String(pos.rowIdx);
        const col   = this.state.customCols.find(c => c.id === colId);
        if (!col) return;
        const old = col.cells[ri] ?? '';
        if (old === newVal) return;
        this._push({ type: 'custom-cell', colId, ri, old, newVal });
        col.cells[ri] = newVal;
        this._saveState(); this._updateResetBtn();
        this._renderCell(td, newVal);
        td.dataset.rawValue = String(newVal).startsWith('=') ? td.innerText : newVal;
        this._recalc(); return;
      }

      // Original cell
      const k = `${pos.rowIdx}_${pos.colIdx}`;
      const old = this.state.editedCells[k] ?? (td.dataset.rawValue ?? td.innerText.trim());
      if (old === newVal) return;
      this._push({ type: 'cell', k, old, newVal });
      this.state.editedCells[k] = newVal;
      this._saveState(); this._updateResetBtn();
      this._renderCell(td, newVal);
      td.dataset.rawValue = String(newVal).startsWith('=') ? td.innerText : newVal;
      this._recalc();
    }

    _renderCell(td, val) {
      const s = String(val);
      if (s.startsWith('=')) {
        const res = FE.evaluate(val, this.table);
        td.innerText = res;
        td.classList.add('sheet-formula-cell');
        td.classList.toggle('sheet-formula-error', String(res).startsWith('#'));
      } else {
        td.innerText = val;
        td.classList.remove('sheet-formula-cell', 'sheet-formula-error');
      }
      td.classList.add('sheet-modified');
    }

    _applyEditedCells() {
      const rows = Array.from(this.table.querySelectorAll('tbody tr'));
      for (const [k, val] of Object.entries(this.state.editedCells)) {
        const [r, c] = k.split('_').map(Number);
        const td = rows[r]?.querySelectorAll('td')[c];
        if (!td) continue;
        if (!td.dataset.rawValue) td.dataset.rawValue = td.innerText.trim();
        this._renderCell(td, val);
      }
    }

    _recalc() {
      const rows = Array.from(this.table.querySelectorAll('tbody tr'));
      for (const [k, val] of Object.entries(this.state.editedCells)) {
        if (!String(val).startsWith('=')) continue;
        const [r, c] = k.split('_').map(Number);
        const td = rows[r]?.querySelectorAll('td')[c];
        if (td) this._renderCell(td, val);
      }
      this.state.customCols.forEach(col => {
        Object.entries(col.cells).forEach(([ri, val]) => {
          if (!String(val).startsWith('=')) return;
          const td = this.table.querySelector(`[data-custom-col-id="${col.id}"][data-custom-row-idx="${ri}"]`);
          if (td) this._renderCell(td, val);
        });
      });
    }

    /* ── Navigation ── */
    _moveActive(dr, dc) {
      const rows = FE.bodyRows(this.table);
      if (!rows.length) return;
      let ri = this.activeCell?.rowIdx ?? 0;
      let ci = this.activeCell?.colIdx ?? 0;
      ri = Math.max(0, Math.min(rows.length - 1, ri + dr));
      const tds = rows[ri]?.querySelectorAll('td') ?? [];
      ci = Math.max(0, Math.min(tds.length - 1, ci + dc));
      const td = tds[ci];
      if (td) this._selectCell(td);
    }

    /* ══════════════════════════════════════════════
       CUSTOM COLUMNS
    ══════════════════════════════════════════════ */
    _openAddColDlg() {
      const map = buildColumnMap(this.table);
      const opts = map.map((col, i) =>
        `<option value="${i}">${col.label}</option>`
      ).join('');
      this.addColDlg.innerHTML = `
        <div class="sheet-dialog-title"><i class="bi bi-plus-square" style="color:var(--accent-purple)"></i> Tambah Kolom Kustom</div>
        <div class="sheet-dialog-field">
          <label>Nama Kolom</label>
          <input type="text" id="shNColName_${this.tableId}" placeholder="Contoh: Keterangan" maxlength="40">
        </div>
        <div class="sheet-dialog-field">
          <label>Sisipkan setelah kolom</label>
          <select id="shNColPos_${this.tableId}">
            <option value="-1">— Di awal tabel —</option>
            ${opts}
          </select>
        </div>
        <div class="sheet-dialog-actions">
          <button class="sheet-btn" id="shNColCancel_${this.tableId}">Batal</button>
          <button class="sheet-btn active" id="shNColOk_${this.tableId}">Tambah</button>
        </div>
      `;
      this.addColDlg.classList.add('is-open');
      this.backdrop.classList.add('is-open');
      document.getElementById(`shNColName_${this.tableId}`)?.focus();
      document.getElementById(`shNColCancel_${this.tableId}`).onclick = () => this._closeDialogs();
      document.getElementById(`shNColOk_${this.tableId}`).onclick = () => {
        const name = document.getElementById(`shNColName_${this.tableId}`)?.value.trim();
        const pos  = parseInt(document.getElementById(`shNColPos_${this.tableId}`)?.value ?? '-1', 10);
        if (!name) { alert('Nama kolom tidak boleh kosong.'); return; }
        this._addCustomCol(name, pos);
        this._closeDialogs();
      };
    }

    _addCustomCol(label, afterBodyIdx) {
      const id = `cc_${Date.now()}`;
      const col = { id, label, afterBodyIdx, cells: {} };
      this.state.customCols.push(col);
      this._saveState();
      this._push({ type: 'add-col', col: JSON.parse(JSON.stringify(col)) });
      this._renderCustomCols();
      this._rebuildColPanel();
      this._updateResetBtn();
    }

    _removeCustomCol(colId) {
      const idx = this.state.customCols.findIndex(c => c.id === colId);
      if (idx < 0) return;
      const removed = JSON.parse(JSON.stringify(this.state.customCols[idx]));
      this.state.customCols.splice(idx, 1);
      this._push({ type: 'remove-col', col: removed });
      this._saveState();
      this._renderCustomCols();
      this._rebuildColPanel();
      this._updateResetBtn();
    }

    _renderCustomCols() {
      // Bersihkan existing
      this.table.querySelectorAll('.sheet-custom-col').forEach(el => el.remove());

      const bodyRows    = Array.from(this.table.querySelectorAll('tbody tr'));
      const headerRows  = Array.from(this.table.querySelectorAll('thead'))
        .filter(el => getComputedStyle(el).display !== 'none')
        .flatMap(el => Array.from(el.querySelectorAll('tr')).filter(r => getComputedStyle(r).display !== 'none'));

      const lastHRow = headerRows[headerRows.length - 1];

      this.state.customCols.forEach(col => {
        const after = col.afterBodyIdx; // -1 = prepend

        // Header (sisipkan ke baris thead terakhir saja)
        if (lastHRow) {
          const ths = Array.from(lastHRow.querySelectorAll('th:not(.sheet-custom-col)'));
          const th  = document.createElement('th');
          th.className = 'sheet-custom-col';
          th.dataset.customColId = col.id;
          th.innerHTML = `<span>${col.label}</span>`;
          th.style.minWidth = '120px';
          if (after < 0 || !ths.length) lastHRow.prepend(th);
          else { const anchor = ths[Math.min(after, ths.length - 1)]; anchor ? anchor.after(th) : lastHRow.appendChild(th); }
        }

        // Body cells
        bodyRows.forEach((row, ri) => {
          const tds = Array.from(row.querySelectorAll('td:not(.sheet-custom-col)'));
          const td  = document.createElement('td');
          td.className = 'sheet-editable sheet-custom-col';
          td.dataset.customColId  = col.id;
          td.dataset.customRowIdx = String(ri);
          const storedVal = col.cells[String(ri)] ?? '';
          td.dataset.rawValue = storedVal;
          if (String(storedVal).startsWith('=')) {
            td.innerText = FE.evaluate(storedVal, this.table);
            td.classList.add('sheet-formula-cell');
          } else {
            td.innerText = storedVal;
          }
          if (after < 0 || !tds.length) row.prepend(td);
          else { const anchor = tds[Math.min(after, tds.length - 1)]; anchor ? anchor.after(td) : row.appendChild(td); }
          td.addEventListener('click',    () => { if (this.editMode) this._selectCell(td); });
          td.addEventListener('dblclick', () => { if (this.editMode) this._startInlineEdit(td); });
        });
      });

      this._applyHiddenCols();
    }

    /* ── Hide/Unhide ── */
    _applyHiddenCols() {
      const map       = buildColumnMap(this.table);
      const hiddenSet = new Set(this.state.hiddenBodyCols);

      // Kolom asli
      map.forEach(info => {
        if (!info) return;
        const hidden = hiddenSet.has(info.bodyIdx);
        const seenThs = new Set();
        if (info.thEl)      seenThs.add(info.thEl);
        if (info.groupThEl) seenThs.add(info.groupThEl);
        seenThs.forEach(th => { try { th.classList.toggle('sheet-col-hidden', hidden); } catch (_) {} });
        Array.from(this.table.querySelectorAll('tbody tr')).forEach(row => {
          const td = row.querySelectorAll('td')[info.bodyIdx];
          if (td && !td.dataset.customColId) {
            try { td.classList.toggle('sheet-col-hidden', hidden); } catch (_) {}
          }
        });
      });

      // Kolom kustom
      this.state.customCols.forEach(col => {
        const hidden = hiddenSet.has(col.id);
        this.table.querySelectorAll(`[data-custom-col-id="${col.id}"]`).forEach(el => {
          try { el.classList.toggle('sheet-col-hidden', hidden); } catch (_) {}
        });
      });
    }

    _toggleColPanel() {
      if (this.colPanel.classList.contains('is-open')) {
        this.colPanel.classList.remove('is-open');
      } else {
        this._rebuildColPanel();
        this.colPanel.classList.add('is-open');
      }
    }

    _rebuildColPanel() {
      const map       = buildColumnMap(this.table);
      const hiddenSet = new Set(this.state.hiddenBodyCols);
      const entries   = [
        ...map.map(info => ({ key: info.bodyIdx, label: info.label, isCustom: false, hidden: hiddenSet.has(info.bodyIdx) })),
        ...this.state.customCols.map(col => ({ key: col.id, label: `✦ ${col.label}`, isCustom: true, hidden: hiddenSet.has(col.id) }))
      ];

      this.colPanel.innerHTML = `
        <div class="sheet-col-panel-header"><span><i class="bi bi-eye"></i> Kelola Kolom</span></div>
        ${entries.map(e => `
          <div class="sheet-col-item ${e.isCustom ? 'is-custom' : ''}" data-col-key="${e.key}" data-is-custom="${e.isCustom}">
            <input type="checkbox" id="shCV_${this.tableId}_${e.key}" ${e.hidden ? '' : 'checked'}>
            <label for="shCV_${this.tableId}_${e.key}">${e.label}</label>
          </div>`).join('')}
        <div class="sheet-col-panel-footer">
          <button class="sheet-btn" id="shShowAll_${this.tableId}">Tampilkan Semua</button>
        </div>
      `;

      this.colPanel.querySelectorAll('.sheet-col-item').forEach(item => {
        item.querySelector('input').addEventListener('change', e => {
          const raw = item.dataset.colKey;
          const key = item.dataset.isCustom === 'true' ? raw : parseInt(raw, 10);
          if (e.target.checked) this.state.hiddenBodyCols = this.state.hiddenBodyCols.filter(k => k !== key);
          else if (!this.state.hiddenBodyCols.includes(key)) this.state.hiddenBodyCols.push(key);
          this._saveState(); this._applyHiddenCols(); this._updateResetBtn();
        });
      });

      const showAllBtn = document.getElementById(`shShowAll_${this.tableId}`);
      if (showAllBtn) showAllBtn.onclick = () => {
        this.state.hiddenBodyCols = [];
        this._saveState(); this._applyHiddenCols(); this._rebuildColPanel(); this._updateResetBtn();
      };
    }

    /* ── Context Menu ── */
    _showCtxMenu(x, y, th) {
      const isCustom = !!th.dataset.customColId;
      const colId    = th.dataset.customColId;
      let bodyIdx = -1;
      if (!isCustom) {
        const info = buildColumnMap(this.table).find(c => c.thEl === th || c.groupThEl === th);
        if (info) bodyIdx = info.bodyIdx;
      }

      this.ctxMenu.innerHTML = `
        ${isCustom ? `<div class="sheet-ctx-item" data-ctx="rename"><i class="bi bi-pencil"></i> Rename Kolom</div>` : ''}
        <div class="sheet-ctx-item" data-ctx="hide"><i class="bi bi-eye-slash"></i> Sembunyikan Kolom</div>
        ${isCustom ? `<div class="sheet-ctx-sep"></div>
          <div class="sheet-ctx-item danger" data-ctx="del"><i class="bi bi-trash3"></i> Hapus Kolom</div>` : ''}
      `;
      this.ctxMenu.style.left = Math.min(x, innerWidth  - 185) + 'px';
      this.ctxMenu.style.top  = Math.min(y, innerHeight - 130) + 'px';
      this.ctxMenu.classList.add('is-open');

      this.ctxMenu.querySelector('[data-ctx="hide"]')?.addEventListener('click', () => {
        const key = isCustom ? colId : bodyIdx;
        if (key !== -1 && !this.state.hiddenBodyCols.includes(key)) this.state.hiddenBodyCols.push(key);
        this._saveState(); this._applyHiddenCols(); this._updateResetBtn();
        this.ctxMenu.classList.remove('is-open');
      }, { once: true });

      this.ctxMenu.querySelector('[data-ctx="del"]')?.addEventListener('click', () => {
        if (confirm(`Hapus kolom "${th.querySelector('span')?.innerText ?? th.innerText.trim()}"?`))
          this._removeCustomCol(colId);
        this.ctxMenu.classList.remove('is-open');
      }, { once: true });

      this.ctxMenu.querySelector('[data-ctx="rename"]')?.addEventListener('click', () => {
        const cur  = th.querySelector('span')?.innerText ?? th.innerText.trim();
        const name = prompt('Nama kolom baru:', cur);
        if (name?.trim()) {
          const col = this.state.customCols.find(c => c.id === colId);
          if (col) { col.label = name.trim(); this._saveState(); this._renderCustomCols(); }
        }
        this.ctxMenu.classList.remove('is-open');
      }, { once: true });
    }

    /* ── Undo / Redo ── */
    _push(action) {
      this.history = this.history.slice(0, this.histPtr + 1);
      this.history.push(action);
      if (this.history.length > this.MAX_HIST) this.history.shift();
      this.histPtr = this.history.length - 1;
      this._syncUndoRedo();
    }
    _undo() { if (this.histPtr < 0) return; this._apply(this.history[this.histPtr], 'undo'); this.histPtr--; this._syncUndoRedo(); this._flash(); }
    _redo() { if (this.histPtr >= this.history.length - 1) return; this.histPtr++; this._apply(this.history[this.histPtr], 'redo'); this._syncUndoRedo(); this._flash(); }

    _apply(action, dir) {
      try {
        const rows = () => Array.from(this.table.querySelectorAll('tbody tr'));

        if (action.type === 'cell') {
          const val = dir === 'undo' ? action.old : action.newVal;
          const [r, c] = action.k.split('_').map(Number);
          const td = rows()[r]?.querySelectorAll('td')[c];
          if (!td) return;
          if (dir === 'undo') {
            delete this.state.editedCells[action.k];
            td.innerText = td.dataset.rawValue ?? val;
            td.classList.remove('sheet-modified', 'sheet-formula-cell', 'sheet-formula-error');
          } else {
            this.state.editedCells[action.k] = val;
            this._renderCell(td, val);
          }
          this._saveState(); this._recalc(); this._updateResetBtn();

        } else if (action.type === 'custom-cell') {
          const val = dir === 'undo' ? action.old : action.newVal;
          const col = this.state.customCols.find(c => c.id === action.colId);
          if (!col) return;
          if (dir === 'undo' && !action.old) delete col.cells[action.ri];
          else col.cells[action.ri] = val;
          this._saveState();
          const td = this.table.querySelector(`[data-custom-col-id="${action.colId}"][data-custom-row-idx="${action.ri}"]`);
          if (td) {
            if (dir === 'undo' && !action.old) {
              td.innerText = '';
              td.classList.remove('sheet-modified', 'sheet-formula-cell', 'sheet-formula-error');
            } else { this._renderCell(td, val); }
          }
          this._recalc(); this._updateResetBtn();

        } else if (action.type === 'add-col') {
          if (dir === 'undo') this._removeCustomCol(action.col.id);
          else { this.state.customCols.push(JSON.parse(JSON.stringify(action.col))); this._saveState(); this._renderCustomCols(); this._rebuildColPanel(); }

        } else if (action.type === 'remove-col') {
          if (dir === 'undo') { this.state.customCols.push(JSON.parse(JSON.stringify(action.col))); this._saveState(); this._renderCustomCols(); this._rebuildColPanel(); }
          else this._removeCustomCol(action.col.id);
        }
        this._updateResetBtn();
      } catch (err) {
        console.warn('[SpreadsheetEditor] _apply error:', err);
      }
    }

    _syncUndoRedo() {
      const u = this.toolbar?.querySelector('[data-sh="undo"]');
      const r = this.toolbar?.querySelector('[data-sh="redo"]');
      if (u) u.disabled = this.histPtr < 0;
      if (r) r.disabled = this.histPtr >= this.history.length - 1;
    }
    _flash() {
      this.table.classList.add('sheet-undo-flash');
      setTimeout(() => this.table.classList.remove('sheet-undo-flash'), 280);
    }

    /* ── Reset ── */
    _updateResetBtn() {
      const btn = this.toolbar?.querySelector('[data-sh="reset"]');
      if (btn) btn.style.display = this._hasOverrides() ? 'inline-flex' : 'none';
    }
    _confirmReset() {
      if (!confirm('Reset semua perubahan ke data asli? Tidak dapat di-undo.')) return;
      this.state = { editedCells: {}, customCols: [], hiddenBodyCols: [] };
      this._saveState();
      this.history = []; this.histPtr = -1; this._syncUndoRedo();
      try {
        this.table.querySelectorAll('.sheet-custom-col').forEach(el => el.remove());
        this.table.querySelectorAll('.sheet-modified').forEach(td => {
          if (td.dataset.rawValue != null) td.innerText = td.dataset.rawValue;
          td.classList.remove('sheet-modified', 'sheet-formula-cell', 'sheet-formula-error');
        });
        this.table.querySelectorAll('.sheet-col-hidden').forEach(el => el.classList.remove('sheet-col-hidden'));
      } catch (_) {}
      this._updateResetBtn(); this._rebuildColPanel();
    }

    /* ── Dialogs ── */
    _closeDialogs() {
      try { this.addColDlg?.classList.remove('is-open'); } catch (_) {}
      try { this.backdrop?.classList.remove('is-open');  } catch (_) {}
      try { this.ctxMenu?.classList.remove('is-open');   } catch (_) {}
    }
  }

  /* ══════════════════════════════════════════════════════════
     CSS: Sheet Overlay (Fixed, tidak dalam card)
  ══════════════════════════════════════════════════════════ */
  const OVERLAY_CSS = `
    .sheet-overlay {
      display: none;
      flex-direction: column;
      position: fixed;
      top: var(--header-height, 56px);
      left: 0; right: 0;
      z-index: 2010;
      background: var(--bg-card);
      border-bottom: 1px solid var(--border);
      padding: 4px 16px 0;
      gap: 0;
      box-shadow: 0 2px 8px rgba(0,0,0,0.12);
    }
    /* Geser table-wrap ke bawah saat overlay aktif */
    body.has-expanded-card .table-wrap {
      margin-top: 0;
    }
    .sheet-overlay .sheet-toolbar {
      display: flex !important;
    }
    .sheet-overlay.sheet-edit-mode .sheet-formula-bar {
      display: flex !important;
    }
    .sheet-overlay .sheet-formula-bar {
      display: none;
    }
  `;
  if (!document.getElementById('sheet-overlay-styles')) {
    const style = document.createElement('style');
    style.id = 'sheet-overlay-styles';
    style.textContent = OVERLAY_CSS;
    document.head.appendChild(style);
  }

  /* ══════════════════════════════════════════════════════════
     GLOBAL INTEGRATION
  ══════════════════════════════════════════════════════════ */
  window._sheetEditors = window._sheetEditors || {};

  window.attachSpreadsheetEditor = function (card) {
    const table = card.querySelector('table');
    if (!table) return;
    if (!table.id) table.id = 'tbl_' + Math.random().toString(36).slice(2, 9);
    const tid = table.id;

    // Destroy stale editor if card changed (PJAX scenario)
    if (window._sheetEditors[tid]) {
      const existing = window._sheetEditors[tid];
      if (existing.card !== card) {
        existing.destroy();
        delete window._sheetEditors[tid];
      } else {
        // Same card re-expanded: show overlay
        existing.showOverlay();
        return;
      }
    }

    const editor = new SpreadsheetEditor(card);
    window._sheetEditors[tid] = editor;
    editor.showOverlay();
  };

  // Cleanup on PJAX navigation
  window.addEventListener('pjax:start', () => {
    Object.values(window._sheetEditors).forEach(ed => {
      try { ed.destroy(); } catch (_) {}
    });
    window._sheetEditors = {};
  });

  // Auto-attach if card already expanded on load
  const autoAttach = () => {
    const ec = document.querySelector('.card.card-expanded');
    if (ec) window.attachSpreadsheetEditor(ec);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', autoAttach);
  else setTimeout(autoAttach, 100);

  window.SpreadsheetEditor = SpreadsheetEditor;
})();
