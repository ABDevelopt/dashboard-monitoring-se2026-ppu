/**
 * SpreadsheetEditor v2 — Expanded Table Editor
 *
 * Perbaikan:
 * - Column management bekerja dengan tabel multi-row header (colspan/rowspan)
 * - Kolom diidentifikasi berdasarkan "data column index" (posisi td di body),
 *   bukan posisi th di header row tertentu
 * - Undo/Redo diperbaiki termasuk custom-cell
 * - Hide/unhide kolom menggunakan CSS nth-child yang tepat
 *
 * Data asli TIDAK diubah di server. Semua perubahan disimpan di localStorage.
 */
(function () {
  'use strict';

  /* ══════════════════════════════════════════════════════════
     FORMULA ENGINE  (tanpa eval, aman)
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
      while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
      return s;
    },
    /** Baris visible di tbody */
    bodyRows(table) {
      return Array.from(table.querySelectorAll('tbody tr'))
        .filter(r => getComputedStyle(r).display !== 'none');
    },
    /** Nilai cell (td) — angka atau string */
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
      // function call
      const fnM = s.match(/^([A-Z_]+)\(([\s\S]*)\)$/i);
      if (fnM) return this._fn(fnM[1].toUpperCase(), fnM[2], table);
      // arithmetic (low precedence split right-to-left)
      for (const ops of [['+','-'],['*','/']])  {
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
      // single cell ref
      if (/^[A-Z]+\d+$/i.test(s)) { const v = this.resolveRef(s, table); return v ?? '#REF!'; }
      // string literal
      if (/^["'].*["']$/.test(s)) return s.slice(1, -1);
      // number
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
    _match(raw, crit) {
      return String(raw).toLowerCase() === String(crit).toLowerCase();
    },
    _r2(n) { return Math.round(n * 100) / 100; },
    _fn(name, argsStr, table) {
      const A = this._args(argsStr);
      const nums = () => this.resolveRange(A[0], table);
      switch (name) {
        case 'SUM':       return this._r2(nums().reduce((s, v) => s + v, 0));
        case 'AVG': case 'AVERAGE': { const v = nums(); return v.length ? this._r2(v.reduce((s,x)=>s+x,0)/v.length) : 0; }
        case 'MIN':       return nums().length ? Math.min(...nums()) : 0;
        case 'MAX':       return nums().length ? Math.max(...nums()) : 0;
        case 'COUNT':     return nums().length;
        case 'COUNTA': {
          const m = A[0].match(/^([A-Z]+)/i); if (!m) return 0;
          const c = this.colToIdx(m[1]);
          return this.bodyRows(table).filter(r => r.querySelectorAll('td')[c]?.innerText.trim()).length;
        }
        case 'ROUND': { const v = this._scalar(A[0], table), d = A[1] ? +A[1] : 0; return typeof v==='number' ? +v.toFixed(d) : '#VALUE!'; }
        case 'ABS':   { const v = this._scalar(A[0], table); return typeof v==='number' ? Math.abs(v) : '#VALUE!'; }
        case 'IF': {
          if (A.length < 3) return '#VALUE!';
          const chosen = this._cond(A[0], table) ? A[1].trim() : A[2].trim();
          return /^["'].*["']$/.test(chosen) ? chosen.slice(1,-1) : this._scalar(chosen, table);
        }
        case 'AND': return A.every(a => this._cond(a, table)) ? 'TRUE' : 'FALSE';
        case 'OR':  return A.some(a  => this._cond(a, table)) ? 'TRUE' : 'FALSE';
        case 'NOT': return this._cond(A[0], table) ? 'FALSE' : 'TRUE';
        case 'CONCAT': case 'CONCATENATE':
          return A.map(a => /^["'].*["']$/.test(a.trim()) ? a.trim().slice(1,-1) : this._scalar(a.trim(), table)).join('');
        case 'LEN':   { const v = /^["'].*["']$/.test(A[0].trim()) ? A[0].trim().slice(1,-1) : String(this._scalar(A[0], table)); return v.length; }
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
              const n = parseFloat((st.dataset.rawValue ?? st.innerText).replace(/,/g,''));
              if (!isNaN(n)) t += n;
            }
          });
          return this._r2(t);
        }
        default: return `#NAME?`;
      }
    }
  };

  /* ══════════════════════════════════════════════════════════
     COLUMN MAP — Menghitung layout kolom sesungguhnya
     Menangani colspan/rowspan pada multi-row thead
  ══════════════════════════════════════════════════════════ */
  function buildColumnMap(table) {
    /**
     * Hasil: array of ColInfo, index = posisi td di body (0-based)
     * Menangani colspan/rowspan pada multi-row thead
     * Mengabaikan thead/tr yang tidak visible (display:none)
     */
    // Ambil hanya thead yang tidak hidden
    const theadEls = Array.from(table.querySelectorAll('thead')).filter(
      th => getComputedStyle(th).display !== 'none'
    );
    const theadRows = theadEls.flatMap(th =>
      Array.from(th.querySelectorAll('tr')).filter(r => getComputedStyle(r).display !== 'none')
    );
    if (!theadRows.length) return [];

    // Temukan jumlah kolom dari baris body pertama
    const firstBodyRow = table.querySelector('tbody tr');
    const totalBodyCols = firstBodyRow ? firstBodyRow.querySelectorAll('td').length : 0;

    // Bangun grid thead
    const grid = []; // grid[row][col] = thEl
    theadRows.forEach(() => grid.push(new Array(totalBodyCols).fill(null)));

    theadRows.forEach((tr, ri) => {
      let colCursor = 0;
      Array.from(tr.querySelectorAll('th')).forEach(th => {
        // Cari cell kosong berikutnya di baris ini
        while (colCursor < totalBodyCols && grid[ri][colCursor] !== null) colCursor++;
        const cs = parseInt(th.getAttribute('colspan') || 1, 10);
        const rs = parseInt(th.getAttribute('rowspan') || 1, 10);
        for (let r = ri; r < Math.min(ri + rs, theadRows.length); r++)
          for (let c = colCursor; c < Math.min(colCursor + cs, totalBodyCols); c++)
            if (r < grid.length) grid[r][c] = th;
        colCursor += cs;
      });
    });

    // Kolom info — ambil dari grid baris terakhir thead
    const lastRow = grid[grid.length - 1] || grid[0];
    const firstRow = grid[0];
    const cols = [];
    for (let c = 0; c < totalBodyCols; c++) {
      const th = lastRow[c];
      const groupTh = (firstRow[c] !== th) ? firstRow[c] : null;
      const label = th ? (th.innerText.trim() || `Kolom ${c + 1}`) : `Kolom ${c + 1}`;
      cols.push({ bodyIdx: c, label, thEl: th || null, groupThEl: groupTh });
    }
    return cols;
  }

  /* ══════════════════════════════════════════════════════════
     SPREADSHEET EDITOR
  ══════════════════════════════════════════════════════════ */
  class SpreadsheetEditor {
    constructor(card) {
      this.card  = card;
      this.table = card.querySelector('table');
      if (!this.table) return;
      if (!this.table.id) this.table.id = 'tbl_' + Math.random().toString(36).slice(2, 8);
      this.tableId = this.table.id;
      this.storageKey = `sheet_v2_${this.tableId}`;

      this.editMode  = false;
      this.activeCell = null;  // { td, rowIdx, colIdx }
      this.history   = [];
      this.histPtr   = -1;
      this.MAX_HIST  = 50;

      this.state = this._loadState();
      this.colMap = buildColumnMap(this.table); // recomputed on each _renderCustomCols

      this._buildUI();
      this._applyState();
      this._bindEvents();
    }

    /* ── State ── */
    _loadState() {
      try { const r = localStorage.getItem(this.storageKey); if (r) return JSON.parse(r); }
      catch (_) {}
      return { editedCells: {}, customCols: [], hiddenBodyCols: [] };
      // hiddenBodyCols: array of bodyIdx (number) or customCol id (string)
    }
    _saveState() {
      try { localStorage.setItem(this.storageKey, JSON.stringify(this.state)); } catch (_) {}
    }
    _hasOverrides() {
      return Object.keys(this.state.editedCells).length > 0 ||
             this.state.customCols.length > 0 ||
             this.state.hiddenBodyCols.length > 0;
    }

    /* ── UI ── */
    _buildUI() {
      this.toolbar = document.createElement('div');
      this.toolbar.className = 'sheet-toolbar';
      this.toolbar.innerHTML = `
        <span class="sheet-edit-badge"><i class="bi bi-pencil-fill"></i> Edit</span>
        <button class="sheet-btn" data-sh="toggle-edit" title="Aktifkan edit mode">
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
        <button class="sheet-btn danger" data-sh="reset" style="display:none" title="Reset semua perubahan">
          <i class="bi bi-arrow-counterclockwise"></i><span class="sheet-btn-label"> Reset</span>
        </button>
      `;

      this.formulaBar = document.createElement('div');
      this.formulaBar.className = 'sheet-formula-bar';
      this.formulaBar.innerHTML = `
        <span class="sheet-cell-ref" id="shCellRef_${this.tableId}">—</span>
        <span class="sheet-fx-icon">fx</span>
        <input class="sheet-formula-input" id="shFxInput_${this.tableId}"
               placeholder="Ketik nilai atau =FORMULA()" autocomplete="off" spellcheck="false">
      `;

      // Column panel (fixed overlay)
      this.colPanel = this._mkFixed('sheet-col-panel', `shColPanel_${this.tableId}`);
      // Add-col dialog
      this.addColDlg = this._mkFixed('sheet-add-col-dialog', `shAddColDlg_${this.tableId}`);
      // Backdrop
      this.backdrop = this._mkFixed('sheet-backdrop', `shBackdrop_${this.tableId}`);
      // Context menu
      this.ctxMenu = this._mkFixed('sheet-ctx-menu', `shCtxMenu_${this.tableId}`);

      // Inject before .table-wrap
      const tw = this.card.querySelector('.table-wrap');
      if (tw) {
        this.card.insertBefore(this.formulaBar, tw);
        this.card.insertBefore(this.toolbar, this.formulaBar);
      }

      this.fxInput   = document.getElementById(`shFxInput_${this.tableId}`);
      this.cellRefEl = document.getElementById(`shCellRef_${this.tableId}`);
      this._updateResetBtn();
    }
    _mkFixed(cls, id) {
      const el = document.createElement('div');
      el.className = cls; el.id = id;
      document.body.appendChild(el);
      return el;
    }

    /* ── Apply persisted state to DOM ── */
    _applyState() {
      this.colMap = buildColumnMap(this.table);
      this._renderCustomCols();
      this._applyHiddenCols();
      this._applyEditedCells();
    }

    /* ── Events ── */
    _bindEvents() {
      // Toolbar
      this.toolbar.addEventListener('click', e => {
        const btn = e.target.closest('[data-sh]');
        if (!btn) return;
        const a = btn.dataset.sh;
        if (a === 'toggle-edit') this._toggleEditMode();
        else if (a === 'undo')      this._undo();
        else if (a === 'redo')      this._redo();
        else if (a === 'add-col')   this._openAddColDlg();
        else if (a === 'col-panel') this._toggleColPanel();
        else if (a === 'reset')     this._confirmReset();
      });

      // Formula bar
      this.fxInput.addEventListener('input', () => {
        if (this.activeCell) this.activeCell.td.dataset.pendingValue = this.fxInput.value;
      });
      this.fxInput.addEventListener('keydown', e => {
        if (e.key === 'Enter')  { e.preventDefault(); this._commitFx(); this._moveActive(1, 0); }
        if (e.key === 'Escape') { e.preventDefault(); this._cancelEdit(); }
        if (e.key === 'Tab')    { e.preventDefault(); this._commitFx(); this._moveActive(0, e.shiftKey ? -1 : 1); }
      });

      // Table cell clicks
      this.table.addEventListener('click', e => {
        const td = e.target.closest('td');
        if (!td || !this.editMode) return;
        this._selectCell(td);
      });
      this.table.addEventListener('dblclick', e => {
        const td = e.target.closest('td');
        if (!td || !this.editMode) return;
        this._startInlineEdit(td);
      });

      // Right-click on th
      this.table.addEventListener('contextmenu', e => {
        const th = e.target.closest('th');
        if (!th || !this.editMode) return;
        e.preventDefault();
        this._showCtxMenu(e.clientX, e.clientY, th);
      });

      // Keyboard shortcuts
      document.addEventListener('keydown', e => {
        if (!this.card.classList.contains('card-expanded')) return;
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); this._undo(); }
        if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); this._redo(); }
        if (!this.editMode) return;
        if (e.key === 'Escape') this._cancelEdit();
        if (e.key === 'Enter' && document.activeElement === document.body) this._moveActive(1, 0);
        if (e.key === 'Tab' && !e.target.closest('.sheet-add-col-dialog')) {
          e.preventDefault(); this._moveActive(0, e.shiftKey ? -1 : 1);
        }
        if (['ArrowDown','ArrowUp','ArrowLeft','ArrowRight'].includes(e.key) &&
            !e.target.closest('input, textarea')) {
          e.preventDefault();
          const d = { ArrowDown:[1,0], ArrowUp:[-1,0], ArrowLeft:[0,-1], ArrowRight:[0,1] };
          this._moveActive(...d[e.key]);
        }
      });

      // Close panels on outside click
      document.addEventListener('click', e => {
        if (!this.colPanel.contains(e.target) && !e.target.closest('[data-sh="col-panel"]'))
          this.colPanel.classList.remove('is-open');
        if (!this.ctxMenu.contains(e.target))
          this.ctxMenu.classList.remove('is-open');
      });

      this.backdrop.addEventListener('click', () => this._closeDialogs());

      // Collapse cleanup
      const obs = new MutationObserver(() => {
        if (!this.card.classList.contains('card-expanded')) this._deactivate();
      });
      obs.observe(this.card, { attributes: true, attributeFilter: ['class'] });
    }

    /* ── Edit Mode ── */
    _toggleEditMode() {
      this.editMode = !this.editMode;
      this.card.classList.toggle('sheet-edit-mode', this.editMode);
      const btn = this.toolbar.querySelector('[data-sh="toggle-edit"]');
      if (this.editMode) {
        btn.classList.add('active');
        btn.innerHTML = '<i class="bi bi-pencil-fill"></i><span class="sheet-btn-label"> Edit ON</span>';
        this._markEditableCells();
      } else {
        btn.classList.remove('active');
        btn.innerHTML = '<i class="bi bi-pencil"></i><span class="sheet-btn-label"> Edit</span>';
        this._deactivate();
      }
    }
    _deactivate() {
      this.editMode = false;
      this.card.classList.remove('sheet-edit-mode');
      this._clearActive();
      this._closeDialogs();
      const btn = this.toolbar.querySelector('[data-sh="toggle-edit"]');
      if (btn) { btn.classList.remove('active'); btn.innerHTML = '<i class="bi bi-pencil"></i><span class="sheet-btn-label"> Edit</span>'; }
    }
    _markEditableCells() {
      this.table.querySelectorAll('td').forEach(td => {
        td.classList.add('sheet-editable');
        if (!td.dataset.rawValue) td.dataset.rawValue = td.innerText.trim();
      });
    }

    /* ── Cell selection ── */
    _selectCell(td) {
      this._clearActive();
      td.classList.add('sheet-cell-active');
      const pos = this._cellPos(td);
      this.activeCell = { td, ...pos };
      this.cellRefEl.textContent = `${FE.idxToCol(pos.colIdx)}${pos.rowIdx + 1}`;
      const stored = this._getStoredValue(td, pos);
      this.fxInput.value = stored !== null ? stored : (td.dataset.rawValue ?? td.innerText.trim());
    }
    _clearActive() {
      this.activeCell?.td?.classList.remove('sheet-cell-active');
      this.activeCell = null;
      this.cellRefEl.textContent = '—';
      this.fxInput.value = '';
    }
    _cellPos(td) {
      const row  = td.closest('tr');
      const rows = Array.from(this.table.querySelectorAll('tbody tr'));
      const rowIdx = rows.indexOf(row);
      const colIdx = Array.from(row.querySelectorAll('td')).indexOf(td);
      return { rowIdx, colIdx };
    }
    _getStoredValue(td, pos) {
      if (td.dataset.customColId) {
        const col = this.state.customCols.find(c => c.id === td.dataset.customColId);
        return col ? (col.cells[String(pos.rowIdx)] ?? null) : null;
      }
      const k = `${pos.rowIdx}_${pos.colIdx}`;
      return this.state.editedCells[k] ?? null;
    }

    /* ── Inline edit ── */
    _startInlineEdit(td) {
      this._selectCell(td);
      if (td.querySelector('.sheet-cell-input')) return;
      const inp = document.createElement('input');
      inp.className = 'sheet-cell-input'; inp.type = 'text';
      const pos = this._cellPos(td);
      const stored = this._getStoredValue(td, pos);
      inp.value = stored !== null ? stored : (td.dataset.rawValue ?? td.innerText.trim());
      td.style.position = 'relative'; td.appendChild(inp);
      inp.focus(); inp.select();
      inp.addEventListener('input', () => { this.fxInput.value = inp.value; });
      inp.addEventListener('keydown', e => {
        if (e.key === 'Enter')  { e.preventDefault(); this._commitInline(td, inp.value); this._moveActive(1, 0); }
        if (e.key === 'Escape') { e.preventDefault(); inp.remove(); this._cancelEdit(); }
        if (e.key === 'Tab')    { e.preventDefault(); this._commitInline(td, inp.value); this._moveActive(0, e.shiftKey ? -1 : 1); }
      });
      inp.addEventListener('blur', () => { if (td.contains(inp)) this._commitInline(td, inp.value); });
    }
    _commitInline(td, val) { td.querySelector('.sheet-cell-input')?.remove(); this._setCell(td, val); }
    _commitFx()             { if (this.activeCell) this._setCell(this.activeCell.td, this.fxInput.value); }
    _cancelEdit()           { this.activeCell?.td?.querySelector('.sheet-cell-input')?.remove(); this._clearActive(); }

    /* ── Core: set cell value ── */
    _setCell(td, newVal) {
      const pos = this._cellPos(td);

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
        td.dataset.rawValue = newVal.startsWith('=') ? td.innerText : newVal;
        this._recalc(); return;
      }

      const k = `${pos.rowIdx}_${pos.colIdx}`;
      const old = this.state.editedCells[k] ?? (td.dataset.rawValue ?? td.innerText.trim());
      if (old === newVal) return;
      this._push({ type: 'cell', k, old, newVal });
      this.state.editedCells[k] = newVal;
      this._saveState(); this._updateResetBtn();
      this._renderCell(td, newVal);
      td.dataset.rawValue = newVal.startsWith('=') ? td.innerText : newVal;
      this._recalc();
    }

    _renderCell(td, val) {
      if (String(val).startsWith('=')) {
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
      const bodyRows = Array.from(this.table.querySelectorAll('tbody tr'));
      for (const [k, val] of Object.entries(this.state.editedCells)) {
        const [r, c] = k.split('_').map(Number);
        const td = bodyRows[r]?.querySelectorAll('td')[c];
        if (!td) continue;
        if (!td.dataset.rawValue) td.dataset.rawValue = td.innerText.trim();
        this._renderCell(td, val);
      }
    }

    _recalc() {
      // Re-render all formula cells
      const bodyRows = Array.from(this.table.querySelectorAll('tbody tr'));
      for (const [k, val] of Object.entries(this.state.editedCells)) {
        if (!String(val).startsWith('=')) continue;
        const [r, c] = k.split('_').map(Number);
        const td = bodyRows[r]?.querySelectorAll('td')[c];
        if (td) this._renderCell(td, val);
      }
      this.state.customCols.forEach(col => {
        Object.entries(col.cells).forEach(([ri, val]) => {
          if (!String(val).startsWith('=')) return;
          const row = bodyRows[+ri]; if (!row) return;
          const td = row.querySelector(`[data-custom-col-id="${col.id}"]`);
          if (td) this._renderCell(td, val);
        });
      });
    }

    /* ── Navigation ── */
    _moveActive(dr, dc) {
      const rows = Array.from(this.table.querySelectorAll('tbody tr'))
        .filter(r => getComputedStyle(r).display !== 'none');
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
       COLUMN MANAGEMENT (colspan-safe)
    ══════════════════════════════════════════════ */

    /** ── Tambah kolom kustom ── */
    _openAddColDlg() {
      this.colMap = buildColumnMap(this.table);
      const opts = this.colMap.map((col, i) =>
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
        const name = document.getElementById(`shNColName_${this.tableId}`).value.trim();
        const pos  = parseInt(document.getElementById(`shNColPos_${this.tableId}`).value, 10);
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

    /**
     * Render semua custom cols ke DOM.
     * Menggunakan afterBodyIdx (posisi td di body) sebagai anchor, bukan posisi th.
     */
    _renderCustomCols() {
      // Bersihkan existing custom col elements
      this.table.querySelectorAll('.sheet-custom-col').forEach(el => el.remove());
      // Reset style inline yg sudah di-set
      this.table.querySelectorAll('th, td').forEach(el => el.style.removeProperty('position'));

      const bodyRows = Array.from(this.table.querySelectorAll('tbody tr'));
      const headerRows = Array.from(this.table.querySelectorAll('thead tr'));

      this.state.customCols.forEach(col => {
        const insertAfter = col.afterBodyIdx; // -1 = prepend

        // -- Header injection --
        // Kita inject ke baris TERAKHIR thead saja (baris sub-header / kolom aktual)
        // Baris atas yang punya colspan tidak kita ubah agar tidak merusak struktur
        const lastHeaderRow = headerRows[headerRows.length - 1];
        if (lastHeaderRow) {
          const ths = Array.from(lastHeaderRow.querySelectorAll('th'));
          const th = document.createElement('th');
          th.className = 'sheet-custom-col';
          th.dataset.customColId = col.id;
          th.innerHTML = `<span>${col.label}</span>`;
          th.style.minWidth = '120px';

          if (insertAfter < 0) {
            lastHeaderRow.prepend(th);
          } else {
            const anchor = ths[Math.min(insertAfter, ths.length - 1)];
            anchor ? anchor.after(th) : lastHeaderRow.appendChild(th);
          }
        }

        // -- Body cells injection --
        bodyRows.forEach((row, ri) => {
          const tds = Array.from(row.querySelectorAll('td'));
          const td = document.createElement('td');
          td.className = 'sheet-editable sheet-custom-col';
          td.dataset.customColId = col.id;
          td.dataset.customRowIdx = String(ri);

          const storedVal = col.cells[String(ri)] ?? '';
          td.dataset.rawValue = storedVal;

          if (String(storedVal).startsWith('=')) {
            td.innerText = FE.evaluate(storedVal, this.table);
            td.classList.add('sheet-formula-cell');
          } else {
            td.innerText = storedVal;
          }

          if (insertAfter < 0) {
            row.prepend(td);
          } else {
            const anchor = tds[Math.min(insertAfter, tds.length - 1)];
            anchor ? anchor.after(td) : row.appendChild(td);
          }

          td.addEventListener('click',   () => { if (this.editMode) this._selectCell(td); });
          td.addEventListener('dblclick',() => { if (this.editMode) this._startInlineEdit(td); });
        });
      });

      // Rebuild colMap setelah custom cols dirender
      this.colMap = buildColumnMap(this.table);
      this._applyHiddenCols();
    }

    /* ── Hide / Unhide Columns ── */

    /**
     * Menyembunyikan kolom berdasarkan bodyIdx (posisi td sesungguhnya).
     * Untuk kolom asli: cari td[bodyIdx] di setiap baris, dan th yg sesuai di grid.
     * Untuk kolom kustom: cari elemen berdasarkan data-custom-col-id.
     */
    _applyHiddenCols() {
      this.colMap = buildColumnMap(this.table);
      const hiddenSet = new Set(this.state.hiddenBodyCols);

      // Tangani kolom asli
      this.colMap.forEach(info => {
        const hidden = hiddenSet.has(info.bodyIdx);
        // Sembunyikan th di semua baris thead berdasarkan grid
        const affectedThs = new Set();
        if (info.thEl)      affectedThs.add(info.thEl);
        if (info.groupThEl) affectedThs.add(info.groupThEl);
        affectedThs.forEach(th => th.classList.toggle('sheet-col-hidden', hidden));

        // Sembunyikan td di setiap baris body
        Array.from(this.table.querySelectorAll('tbody tr')).forEach(row => {
          const td = row.querySelectorAll('td')[info.bodyIdx];
          if (td && !td.dataset.customColId) td.classList.toggle('sheet-col-hidden', hidden);
        });
      });

      // Tangani kolom kustom
      this.state.customCols.forEach(col => {
        const hidden = hiddenSet.has(col.id);
        this.table.querySelectorAll(`[data-custom-col-id="${col.id}"]`).forEach(el => {
          el.classList.toggle('sheet-col-hidden', hidden);
        });
      });
    }

    _toggleColPanel() {
      const open = this.colPanel.classList.contains('is-open');
      if (!open) { this._rebuildColPanel(); this.colPanel.classList.add('is-open'); }
      else this.colPanel.classList.remove('is-open');
    }

    _rebuildColPanel() {
      if (!this.colPanel.classList.contains('is-open') &&
          !this.colPanel.innerHTML) return; // lazy build

      this.colMap = buildColumnMap(this.table);
      const hiddenSet = new Set(this.state.hiddenBodyCols);

      // Buat daftar: kolom asli (dari colMap) + kolom kustom
      const entries = [];

      // Deduplicate: jika kolom group (colspan) — kita tampilkan 1 entri per kolom body
      this.colMap.forEach(info => {
        entries.push({
          key: info.bodyIdx,       // number
          label: info.label,
          isCustom: false,
          hidden: hiddenSet.has(info.bodyIdx)
        });
      });

      this.state.customCols.forEach(col => {
        entries.push({
          key: col.id,             // string
          label: `✦ ${col.label}`,
          isCustom: true,
          hidden: hiddenSet.has(col.id)
        });
      });

      this.colPanel.innerHTML = `
        <div class="sheet-col-panel-header">
          <span><i class="bi bi-eye"></i> Kelola Kolom</span>
        </div>
        ${entries.map(e => `
          <div class="sheet-col-item ${e.isCustom ? 'is-custom' : ''}" data-col-key="${e.key}" data-is-custom="${e.isCustom}">
            <input type="checkbox" id="shCV_${this.tableId}_${e.key}" ${e.hidden ? '' : 'checked'}>
            <label for="shCV_${this.tableId}_${e.key}">${e.label}</label>
          </div>
        `).join('')}
        <div class="sheet-col-panel-footer">
          <button class="sheet-btn" id="shShowAll_${this.tableId}">Tampilkan Semua</button>
        </div>
      `;

      this.colPanel.querySelectorAll('.sheet-col-item').forEach(item => {
        const cb = item.querySelector('input');
        cb.addEventListener('change', () => {
          const raw  = item.dataset.colKey;
          const key  = item.dataset.isCustom === 'true' ? raw : parseInt(raw, 10);
          if (cb.checked) {
            this.state.hiddenBodyCols = this.state.hiddenBodyCols.filter(k => k !== key);
          } else {
            if (!this.state.hiddenBodyCols.includes(key)) this.state.hiddenBodyCols.push(key);
          }
          this._saveState();
          this._applyHiddenCols();
          this._updateResetBtn();
        });
      });

      document.getElementById(`shShowAll_${this.tableId}`).onclick = () => {
        this.state.hiddenBodyCols = [];
        this._saveState();
        this._applyHiddenCols();
        this._rebuildColPanel();
        this._updateResetBtn();
      };
    }

    /* ── Context Menu on TH ── */
    _showCtxMenu(x, y, th) {
      const isCustom = !!th.dataset.customColId;
      const colId    = th.dataset.customColId;

      // Find bodyIdx for this th
      let bodyIdx = -1;
      if (!isCustom) {
        this.colMap = buildColumnMap(this.table);
        const info = this.colMap.find(c => c.thEl === th || c.groupThEl === th);
        if (info) bodyIdx = info.bodyIdx;
      }

      this.ctxMenu.innerHTML = `
        ${isCustom ? `<div class="sheet-ctx-item" data-ctx="rename"><i class="bi bi-pencil"></i> Rename Kolom</div>` : ''}
        <div class="sheet-ctx-item" data-ctx="hide"><i class="bi bi-eye-slash"></i> Sembunyikan Kolom</div>
        ${isCustom ? `<div class="sheet-ctx-sep"></div>
          <div class="sheet-ctx-item danger" data-ctx="del"><i class="bi bi-trash3"></i> Hapus Kolom</div>` : ''}
      `;

      const w = 180, h = 120;
      this.ctxMenu.style.left = Math.min(x, innerWidth  - w) + 'px';
      this.ctxMenu.style.top  = Math.min(y, innerHeight - h) + 'px';
      this.ctxMenu.classList.add('is-open');

      this.ctxMenu.querySelector('[data-ctx="hide"]')?.addEventListener('click', () => {
        const key = isCustom ? colId : bodyIdx;
        if (!this.state.hiddenBodyCols.includes(key)) this.state.hiddenBodyCols.push(key);
        this._saveState(); this._applyHiddenCols(); this._updateResetBtn();
        this.ctxMenu.classList.remove('is-open');
      }, { once: true });

      this.ctxMenu.querySelector('[data-ctx="del"]')?.addEventListener('click', () => {
        if (confirm(`Hapus kolom "${th.querySelector('span')?.innerText ?? th.innerText.trim()}"?`))
          this._removeCustomCol(colId);
        this.ctxMenu.classList.remove('is-open');
      }, { once: true });

      this.ctxMenu.querySelector('[data-ctx="rename"]')?.addEventListener('click', () => {
        const cur = th.querySelector('span')?.innerText ?? th.innerText.trim();
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
    _undo() {
      if (this.histPtr < 0) return;
      this._apply(this.history[this.histPtr], 'undo');
      this.histPtr--;
      this._syncUndoRedo();
      this._flash();
    }
    _redo() {
      if (this.histPtr >= this.history.length - 1) return;
      this.histPtr++;
      this._apply(this.history[this.histPtr], 'redo');
      this._syncUndoRedo();
      this._flash();
    }
    _apply(action, dir) {
      const bodyRows = () => Array.from(this.table.querySelectorAll('tbody tr'));

      if (action.type === 'cell') {
        const val = dir === 'undo' ? action.old : action.newVal;
        const [r, c] = action.k.split('_').map(Number);
        const td = bodyRows()[r]?.querySelectorAll('td')[c];
        if (!td) return;
        if (dir === 'undo' && val === action.old) {
          // Kembalikan ke nilai asli → hapus override jika sama dengan rawValue
          delete this.state.editedCells[action.k];
          td.innerText = td.dataset.rawValue ?? val;
          td.classList.remove('sheet-modified','sheet-formula-cell','sheet-formula-error');
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
            td.classList.remove('sheet-modified','sheet-formula-cell','sheet-formula-error');
          } else {
            this._renderCell(td, val);
          }
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
    }
    _syncUndoRedo() {
      const u = this.toolbar.querySelector('[data-sh="undo"]');
      const r = this.toolbar.querySelector('[data-sh="redo"]');
      if (u) u.disabled = this.histPtr < 0;
      if (r) r.disabled = this.histPtr >= this.history.length - 1;
    }
    _flash() {
      this.table.classList.add('sheet-undo-flash');
      setTimeout(() => this.table.classList.remove('sheet-undo-flash'), 280);
    }

    /* ── Reset ── */
    _updateResetBtn() {
      const btn = this.toolbar.querySelector('[data-sh="reset"]');
      if (btn) btn.style.display = this._hasOverrides() ? 'inline-flex' : 'none';
    }
    _confirmReset() {
      if (!confirm('Reset semua perubahan ke data asli? Tidak dapat di-undo.')) return;
      this.state = { editedCells: {}, customCols: [], hiddenBodyCols: [] };
      this._saveState();
      this.history = []; this.histPtr = -1; this._syncUndoRedo();
      // DOM cleanup
      this.table.querySelectorAll('.sheet-custom-col').forEach(el => el.remove());
      this.table.querySelectorAll('.sheet-modified').forEach(td => {
        if (td.dataset.rawValue != null) td.innerText = td.dataset.rawValue;
        td.classList.remove('sheet-modified','sheet-formula-cell','sheet-formula-error');
      });
      this.table.querySelectorAll('.sheet-col-hidden').forEach(el => el.classList.remove('sheet-col-hidden'));
      this._updateResetBtn(); this._rebuildColPanel();
    }

    /* ── Helpers ── */
    _closeDialogs() {
      this.addColDlg.classList.remove('is-open');
      this.backdrop.classList.remove('is-open');
      this.ctxMenu.classList.remove('is-open');
    }
  }

  /* ══════════════════════════════════════════════════════════
     GLOBAL INTEGRATION
  ══════════════════════════════════════════════════════════ */
  window._sheetEditors = window._sheetEditors || {};

  window.attachSpreadsheetEditor = function (card) {
    const table = card.querySelector('table');
    if (!table) return;
    if (!table.id) table.id = 'tbl_' + Math.random().toString(36).slice(2, 8);
    // Hindari duplicate
    if (window._sheetEditors[table.id]) return;
    window._sheetEditors[table.id] = new SpreadsheetEditor(card);
  };

  // Auto-attach jika sudah ada expanded card saat script load
  document.addEventListener('DOMContentLoaded', () => {
    const ec = document.querySelector('.card.card-expanded');
    if (ec) window.attachSpreadsheetEditor(ec);
  });
  // Fallback untuk PJAX (card sudah ada di DOM)
  const ec = document.querySelector('.card.card-expanded');
  if (ec) setTimeout(() => window.attachSpreadsheetEditor(ec), 100);

  window.SpreadsheetEditor = SpreadsheetEditor;
})();
