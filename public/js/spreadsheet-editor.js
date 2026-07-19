/**
 * SpreadsheetEditor — Expanded Table Editor
 * Fitur: Edit cell, Formula Engine, Tambah/Hapus/Hide Kolom, Undo/Redo, Export
 *
 * Data asli TIDAK diubah di server. Semua perubahan disimpan di localStorage.
 * Aktif hanya saat card.card-expanded ada di halaman.
 */
(function () {
  'use strict';

  /* ──────────────────────────────────────────────
     FORMULA ENGINE (minimal, aman, tanpa eval)
  ────────────────────────────────────────────── */
  const FormulaEngine = {
    /** Resolve nilai sebuah cell reference (e.g. "D3") dari tabel DOM */
    resolveCellRef(ref, table) {
      const m = ref.trim().match(/^([A-Z]+)(\d+)$/i);
      if (!m) return null;
      const colIdx = this.colLetterToIndex(m[1]);
      const rowIdx = parseInt(m[2], 10) - 1;
      const rows = Array.from(table.querySelectorAll('tbody tr')).filter(
        r => r.style.display !== 'none' && !r.classList.contains('sheet-col-hidden')
      );
      const row = rows[rowIdx];
      if (!row) return null;
      const cells = Array.from(row.querySelectorAll('td'));
      const cell = cells[colIdx];
      if (!cell) return null;
      const raw = cell.dataset.rawValue !== undefined ? cell.dataset.rawValue : cell.innerText.trim();
      const n = parseFloat(raw.replace(/[.,]/g, m => m === '.' ? '.' : ''));
      return isNaN(n) ? raw : n;
    },

    /** Resolve semua nilai dalam range (e.g. "D2:D50" atau "D:D") */
    resolveRange(range, table) {
      const m = range.trim().match(/^([A-Z]+)(\d*):([A-Z]+)(\d*)$/i);
      if (!m) return [];
      const col1 = this.colLetterToIndex(m[1]);
      const col2 = this.colLetterToIndex(m[3]);

      const rows = Array.from(table.querySelectorAll('tbody tr')).filter(
        r => r.style.display !== 'none'
      );

      const startRow = m[2] ? parseInt(m[2], 10) - 1 : 0;
      const endRow   = m[4] ? parseInt(m[4], 10) - 1 : rows.length - 1;

      const values = [];
      for (let ri = startRow; ri <= Math.min(endRow, rows.length - 1); ri++) {
        const row = rows[ri];
        if (!row) continue;
        for (let ci = col1; ci <= col2; ci++) {
          const cell = row.querySelectorAll('td')[ci];
          if (!cell) continue;
          const raw = cell.dataset.rawValue !== undefined ? cell.dataset.rawValue : cell.innerText.trim();
          const n = parseFloat(raw.replace(/,/g, ''));
          if (!isNaN(n)) values.push(n);
        }
      }
      return values;
    },

    colLetterToIndex(letters) {
      let idx = 0;
      for (let i = 0; i < letters.length; i++) {
        idx = idx * 26 + letters.toUpperCase().charCodeAt(i) - 64;
      }
      return idx - 1;
    },

    indexToColLetter(idx) {
      let s = '';
      idx += 1;
      while (idx > 0) {
        const rem = (idx - 1) % 26;
        s = String.fromCharCode(65 + rem) + s;
        idx = Math.floor((idx - 1) / 26);
      }
      return s;
    },

    /** Parse dan evaluasi formula string sederhana */
    evaluate(formula, table) {
      if (!formula.startsWith('=')) return formula;
      const expr = formula.slice(1).trim();

      try {
        return this._evalExpr(expr, table);
      } catch (e) {
        return '#VALUE!';
      }
    },

    _evalExpr(expr, table) {
      // Fungsi dengan nama
      const fnMatch = expr.match(/^([A-Z]+)\((.+)\)$/i);
      if (fnMatch) {
        return this._callFn(fnMatch[1].toUpperCase(), fnMatch[2], table);
      }

      // Operator aritmatika sederhana antar fungsi / referensi
      // Split by + - * / tapi tidak di dalam parentheses
      const parts = this._splitArithmetic(expr);
      if (parts) {
        const [left, op, right] = parts;
        const l = this._resolveScalar(left, table);
        const r = this._resolveScalar(right, table);
        if (typeof l === 'number' && typeof r === 'number') {
          if (op === '+') return l + r;
          if (op === '-') return l - r;
          if (op === '*') return l * r;
          if (op === '/') return r === 0 ? '#DIV/0!' : l / r;
        }
      }

      // Single cell ref
      if (/^[A-Z]+\d+$/i.test(expr)) {
        const v = this.resolveCellRef(expr, table);
        return v !== null ? v : '#REF!';
      }

      // String literal
      if ((expr.startsWith('"') && expr.endsWith('"')) ||
          (expr.startsWith("'") && expr.endsWith("'"))) {
        return expr.slice(1, -1);
      }

      // Number literal
      const n = parseFloat(expr);
      if (!isNaN(n)) return n;

      return '#VALUE!';
    },

    _resolveScalar(expr, table) {
      expr = expr.trim();
      if (/^[A-Z]+\d+$/i.test(expr)) {
        return this.resolveCellRef(expr, table) ?? 0;
      }
      const fnMatch = expr.match(/^([A-Z]+)\((.+)\)$/i);
      if (fnMatch) return this._callFn(fnMatch[1].toUpperCase(), fnMatch[2], table);
      const n = parseFloat(expr);
      return isNaN(n) ? 0 : n;
    },

    _splitArithmetic(expr) {
      // Find topmost +/- first, then */
      let depth = 0;
      // Go right-to-left for left-associativity (lower precedence first)
      for (let i = expr.length - 1; i >= 0; i--) {
        const c = expr[i];
        if (c === ')') depth++;
        else if (c === '(') depth--;
        else if (depth === 0 && (c === '+' || c === '-') && i > 0) {
          return [expr.slice(0, i), c, expr.slice(i + 1)];
        }
      }
      depth = 0;
      for (let i = expr.length - 1; i >= 0; i--) {
        const c = expr[i];
        if (c === ')') depth++;
        else if (c === '(') depth--;
        else if (depth === 0 && (c === '*' || c === '/') && i > 0) {
          return [expr.slice(0, i), c, expr.slice(i + 1)];
        }
      }
      return null;
    },

    /** Parse argumen fungsi, menghargai tanda kutip dan nested parens */
    _parseArgs(argsStr) {
      const args = [];
      let cur = '';
      let depth = 0;
      let inStr = false;
      let strChar = '';
      for (let i = 0; i < argsStr.length; i++) {
        const c = argsStr[i];
        if (!inStr && (c === '"' || c === "'")) { inStr = true; strChar = c; cur += c; continue; }
        if (inStr && c === strChar) { inStr = false; cur += c; continue; }
        if (!inStr && c === '(') { depth++; cur += c; continue; }
        if (!inStr && c === ')') { depth--; cur += c; continue; }
        if (!inStr && depth === 0 && c === ',') { args.push(cur.trim()); cur = ''; continue; }
        cur += c;
      }
      if (cur.trim()) args.push(cur.trim());
      return args;
    },

    _callFn(name, argsStr, table) {
      const args = this._parseArgs(argsStr);

      const getRange = (a) => {
        if (/^[A-Z]+\d*:[A-Z]+\d*$/i.test(a)) return this.resolveRange(a, table);
        const v = this._resolveScalar(a, table);
        return typeof v === 'number' ? [v] : [];
      };

      const numericArgs = () => getRange(args[0]);
      const round2 = n => Math.round(n * 100) / 100;

      switch (name) {
        case 'SUM':    { const vals = numericArgs(); return round2(vals.reduce((s, v) => s + v, 0)); }
        case 'AVG':
        case 'AVERAGE':{ const vals = numericArgs(); return vals.length ? round2(vals.reduce((s,v)=>s+v,0)/vals.length) : 0; }
        case 'MIN':    { const vals = numericArgs(); return vals.length ? Math.min(...vals) : 0; }
        case 'MAX':    { const vals = numericArgs(); return vals.length ? Math.max(...vals) : 0; }
        case 'COUNT':  { const vals = numericArgs(); return vals.length; }
        case 'COUNTA': { // Count all non-empty
          if (/^[A-Z]+\d*:[A-Z]+\d*$/i.test(args[0])) {
            const m = args[0].match(/^([A-Z]+)(\d*):([A-Z]+)(\d*)$/i);
            const col1 = this.colLetterToIndex(m[1]);
            const rows = Array.from(table.querySelectorAll('tbody tr')).filter(r => r.style.display !== 'none');
            return rows.filter(r => {
              const td = r.querySelectorAll('td')[col1];
              return td && td.innerText.trim() !== '';
            }).length;
          }
          return 0;
        }
        case 'ROUND': {
          const val = this._resolveScalar(args[0], table);
          const dec = args[1] ? parseInt(args[1], 10) : 0;
          return typeof val === 'number' ? +val.toFixed(dec) : '#VALUE!';
        }
        case 'ABS': {
          const val = this._resolveScalar(args[0], table);
          return typeof val === 'number' ? Math.abs(val) : '#VALUE!';
        }
        case 'IF': {
          if (args.length < 3) return '#VALUE!';
          const cond = this._evalCondition(args[0], table);
          const trueVal = args[1].trim();
          const falseVal = args[2].trim();
          const chosen = cond ? trueVal : falseVal;
          if ((chosen.startsWith('"') && chosen.endsWith('"')) ||
              (chosen.startsWith("'") && chosen.endsWith("'"))) {
            return chosen.slice(1, -1);
          }
          return this._resolveScalar(chosen, table);
        }
        case 'AND': return args.every(a => this._evalCondition(a, table)) ? 'TRUE' : 'FALSE';
        case 'OR':  return args.some(a  => this._evalCondition(a, table)) ? 'TRUE' : 'FALSE';
        case 'NOT': return this._evalCondition(args[0], table) ? 'FALSE' : 'TRUE';
        case 'CONCAT':
        case 'CONCATENATE': {
          return args.map(a => {
            const v = this._resolveScalar(a.trim().replace(/^["']|["']$/g, ''), table);
            // string literal
            if ((a.trim().startsWith('"') && a.trim().endsWith('"')) ||
                (a.trim().startsWith("'") && a.trim().endsWith("'"))) {
              return a.trim().slice(1,-1);
            }
            return v;
          }).join('');
        }
        case 'LEN': {
          const arg = args[0];
          const v = (arg.startsWith('"') || arg.startsWith("'"))
            ? arg.slice(1,-1)
            : String(this._resolveScalar(arg, table));
          return v.length;
        }
        case 'UPPER': { const v = this._resolveScalar(args[0], table); return String(v).toUpperCase(); }
        case 'LOWER': { const v = this._resolveScalar(args[0], table); return String(v).toLowerCase(); }
        case 'TRIM':  { const v = this._resolveScalar(args[0], table); return String(v).trim(); }
        case 'COUNTIF': {
          if (args.length < 2) return '#VALUE!';
          const criteria = args[1].trim().replace(/^["']|["']$/g, '');
          const vals = this.resolveRange(args[0], table);
          // Also resolve text values for COUNTIF
          const m = args[0].match(/^([A-Z]+)(\d*):([A-Z]+)(\d*)$/i);
          if (!m) return 0;
          const col1 = this.colLetterToIndex(m[1]);
          const rows = Array.from(table.querySelectorAll('tbody tr')).filter(r => r.style.display !== 'none');
          return rows.filter(r => {
            const td = r.querySelectorAll('td')[col1];
            if (!td) return false;
            const raw = (td.dataset.rawValue ?? td.innerText).trim();
            return this._matchCriteria(raw, criteria);
          }).length;
        }
        case 'SUMIF': {
          if (args.length < 3) return '#VALUE!';
          const criteria = args[1].trim().replace(/^["']|["']$/g, '');
          const m1 = args[0].match(/^([A-Z]+)/i);
          const m2 = args[2].match(/^([A-Z]+)/i);
          if (!m1 || !m2) return '#REF!';
          const condCol = this.colLetterToIndex(m1[1]);
          const sumCol  = this.colLetterToIndex(m2[1]);
          const rows = Array.from(table.querySelectorAll('tbody tr')).filter(r => r.style.display !== 'none');
          let total = 0;
          rows.forEach(r => {
            const condTd = r.querySelectorAll('td')[condCol];
            const sumTd  = r.querySelectorAll('td')[sumCol];
            if (!condTd || !sumTd) return;
            const condRaw = (condTd.dataset.rawValue ?? condTd.innerText).trim();
            if (this._matchCriteria(condRaw, criteria)) {
              const n = parseFloat((sumTd.dataset.rawValue ?? sumTd.innerText).replace(/,/g,''));
              if (!isNaN(n)) total += n;
            }
          });
          return Math.round(total * 100) / 100;
        }
        default: return `#NAME?`;
      }
    },

    _evalCondition(condStr, table) {
      condStr = condStr.trim();
      // Comparison: A > B, A >= B, etc.
      const ops = ['>=', '<=', '<>', '!=', '>', '<', '='];
      for (const op of ops) {
        const idx = condStr.indexOf(op);
        if (idx > 0) {
          const left  = this._resolveScalar(condStr.slice(0, idx).trim(), table);
          const right = this._resolveScalar(condStr.slice(idx + op.length).trim().replace(/^["']|["']$/g, ''), table);
          switch (op) {
            case '>':  return left > right;
            case '<':  return left < right;
            case '>=': return left >= right;
            case '<=': return left <= right;
            case '=':
            case '==': return left == right;
            case '<>':
            case '!=': return left != right;
          }
        }
      }
      const v = this._resolveScalar(condStr, table);
      return !!v && v !== 'FALSE' && v !== 0;
    },

    _matchCriteria(value, criteria) {
      if (criteria.startsWith('>') || criteria.startsWith('<') || criteria.startsWith('=')) {
        return this._evalCondition(`"${value}"${criteria.slice(0,1)}${criteria.slice(1)}`, null);
      }
      return String(value).toLowerCase() === String(criteria).toLowerCase();
    }
  };

  /* ──────────────────────────────────────────────
     SPREADSHEET EDITOR CLASS
  ────────────────────────────────────────────── */
  class SpreadsheetEditor {
    constructor(card) {
      this.card      = card;
      this.table     = card.querySelector('table');
      if (!this.table) return;

      this.tableId   = this.table.id || ('tbl_' + Math.random().toString(36).slice(2, 8));
      this.table.id  = this.tableId;

      this.storageKey = `sheet_state_${this.tableId}`;
      this.editMode   = false;
      this.activeCell = null;        // {td, rowIdx, colIdx}
      this.historyStack = [];
      this.historyPtr   = -1;
      this.MAX_HISTORY  = 50;

      // State
      this.state = this._loadState();

      this._buildUI();
      this._applyState();
      this._bindEvents();
    }

    /* ── State persistence ── */
    _loadState() {
      try {
        const raw = localStorage.getItem(this.storageKey);
        if (raw) return JSON.parse(raw);
      } catch (_) {}
      return { editedCells: {}, customCols: [], hiddenCols: [] };
    }

    _saveState() {
      try {
        localStorage.setItem(this.storageKey, JSON.stringify(this.state));
      } catch (_) {}
    }

    _hasOverrides() {
      return (
        Object.keys(this.state.editedCells).length > 0 ||
        this.state.customCols.length > 0 ||
        this.state.hiddenCols.length > 0
      );
    }

    /* ── Build toolbar + formula bar DOM ── */
    _buildUI() {
      const card = this.card;

      // Toolbar
      this.toolbar = document.createElement('div');
      this.toolbar.className = 'sheet-toolbar';
      this.toolbar.innerHTML = `
        <span class="sheet-edit-badge"><i class="bi bi-pencil-fill"></i> Edit Mode</span>
        <button class="sheet-btn" data-action="toggle-edit" title="Aktifkan / nonaktifkan mode edit">
          <i class="bi bi-pencil"></i><span class="sheet-btn-label">Edit</span>
        </button>
        <div class="sheet-toolbar-sep"></div>
        <button class="sheet-btn" data-action="undo" title="Undo (Ctrl+Z)" disabled>
          <i class="bi bi-arrow-counterclockwise"></i>
        </button>
        <button class="sheet-btn" data-action="redo" title="Redo (Ctrl+Y)" disabled>
          <i class="bi bi-arrow-clockwise"></i>
        </button>
        <div class="sheet-toolbar-sep"></div>
        <button class="sheet-btn" data-action="add-col" title="Tambah kolom kustom">
          <i class="bi bi-plus-square"></i><span class="sheet-btn-label">Kolom</span>
        </button>
        <button class="sheet-btn" data-action="toggle-col-panel" title="Sembunyikan / tampilkan kolom">
          <i class="bi bi-eye"></i><span class="sheet-btn-label">Lihat</span>
        </button>
        <div class="sheet-toolbar-sep"></div>
        <button class="sheet-btn danger" data-action="reset" title="Reset semua perubahan ke data asli" style="display:none">
          <i class="bi bi-arrow-counterclockwise"></i><span class="sheet-btn-label">Reset</span>
        </button>
      `;

      // Formula bar
      this.formulaBar = document.createElement('div');
      this.formulaBar.className = 'sheet-formula-bar';
      this.formulaBar.innerHTML = `
        <span class="sheet-cell-ref" id="sheetCellRef_${this.tableId}">—</span>
        <span class="sheet-fx-icon">fx</span>
        <input class="sheet-formula-input" id="sheetFormulaInput_${this.tableId}" placeholder="Ketik nilai atau =FORMULA()" autocomplete="off" spellcheck="false">
      `;

      // Column visibility panel (fixed position overlay)
      this.colPanel = document.createElement('div');
      this.colPanel.className = 'sheet-col-panel';
      this.colPanel.id = `sheetColPanel_${this.tableId}`;
      document.body.appendChild(this.colPanel);

      // Add-column dialog (fixed position)
      this.addColDialog = document.createElement('div');
      this.addColDialog.className = 'sheet-add-col-dialog';
      this.addColDialog.id = `sheetAddColDlg_${this.tableId}`;
      document.body.appendChild(this.addColDialog);

      // Dialog backdrop
      this.backdrop = document.createElement('div');
      this.backdrop.className = 'sheet-backdrop';
      document.body.appendChild(this.backdrop);

      // Context menu
      this.ctxMenu = document.createElement('div');
      this.ctxMenu.className = 'sheet-ctx-menu';
      document.body.appendChild(this.ctxMenu);

      // Inject toolbar + formula bar before .table-wrap inside the card
      const tableWrap = card.querySelector('.table-wrap');
      if (tableWrap) {
        card.insertBefore(this.formulaBar, tableWrap);
        card.insertBefore(this.toolbar, this.formulaBar);
      }

      this.formulaInput = document.getElementById(`sheetFormulaInput_${this.tableId}`);
      this.cellRefLabel = document.getElementById(`sheetCellRef_${this.tableId}`);

      this._updateResetBtn();
    }

    /* ── Apply persisted state to DOM ── */
    _applyState() {
      this._renderCustomCols();
      this._applyHiddenCols();
      this._applyEditedCells();
      this._recalcAllFormulas();
    }

    /* ── Toolbar event bindings ── */
    _bindEvents() {
      this.toolbar.addEventListener('click', e => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const action = btn.dataset.action;
        if (action === 'toggle-edit')       this._toggleEditMode();
        else if (action === 'undo')         this._undo();
        else if (action === 'redo')         this._redo();
        else if (action === 'add-col')      this._openAddColDialog();
        else if (action === 'toggle-col-panel') this._toggleColPanel();
        else if (action === 'reset')        this._confirmReset();
      });

      // Formula bar input → sync to active cell
      this.formulaInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); this._commitFormulaBarInput(); this._moveActive(1, 0); }
        else if (e.key === 'Escape') { e.preventDefault(); this._cancelEdit(); }
        else if (e.key === 'Tab') { e.preventDefault(); this._commitFormulaBarInput(); this._moveActive(0, 1); }
      });

      this.formulaInput.addEventListener('input', () => {
        if (this.activeCell) {
          this.activeCell.td.dataset.pendingValue = this.formulaInput.value;
        }
      });

      // Table cell interactions
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

      // Right-click context menu on th
      this.table.addEventListener('contextmenu', e => {
        const th = e.target.closest('th');
        if (!th || !this.editMode) return;
        e.preventDefault();
        const colIdx = this._getColIndex(th);
        this._showCtxMenu(e.clientX, e.clientY, th, colIdx);
      });

      // Global keyboard shortcuts
      document.addEventListener('keydown', e => {
        if (!this.card.classList.contains('card-expanded')) return;
        if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); this._undo(); }
        if (e.ctrlKey && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
          e.preventDefault(); this._redo();
        }
        if (!this.editMode) return;
        if (e.key === 'Escape') this._cancelEdit();
        if (e.key === 'Enter' && !e.target.closest('.sheet-formula-input, .sheet-cell-input, .sheet-add-col-dialog')) {
          this._moveActive(1, 0);
        }
        if (e.key === 'Tab' && !e.target.closest('.sheet-add-col-dialog')) {
          e.preventDefault(); this._moveActive(0, e.shiftKey ? -1 : 1);
        }
        if (['ArrowDown','ArrowUp','ArrowLeft','ArrowRight'].includes(e.key) &&
            !e.target.closest('input, textarea')) {
          e.preventDefault();
          const dirs = { ArrowDown:[1,0], ArrowUp:[-1,0], ArrowLeft:[0,-1], ArrowRight:[0,1] };
          const [dr, dc] = dirs[e.key];
          this._moveActive(dr, dc);
        }
      });

      // Close panels on outside click
      document.addEventListener('click', e => {
        if (!this.colPanel.contains(e.target) &&
            !e.target.closest('[data-action="toggle-col-panel"]')) {
          this.colPanel.classList.remove('is-open');
        }
        if (!this.ctxMenu.contains(e.target)) {
          this.ctxMenu.classList.remove('is-open');
        }
      });

      // Backdrop closes dialogs
      this.backdrop.addEventListener('click', () => this._closeAllDialogs());

      // Cleanup when card collapses
      const observer = new MutationObserver(() => {
        if (!this.card.classList.contains('card-expanded')) {
          this._deactivateEditMode();
        }
      });
      observer.observe(this.card, { attributes: true, attributeFilter: ['class'] });
    }

    /* ── Edit Mode toggle ── */
    _toggleEditMode() {
      this.editMode = !this.editMode;
      this.card.classList.toggle('sheet-edit-mode', this.editMode);

      const btn = this.toolbar.querySelector('[data-action="toggle-edit"]');
      if (this.editMode) {
        btn.classList.add('active');
        btn.innerHTML = '<i class="bi bi-pencil-fill"></i><span class="sheet-btn-label">Edit ON</span>';
        this._makeTableEditable();
      } else {
        btn.classList.remove('active');
        btn.innerHTML = '<i class="bi bi-pencil"></i><span class="sheet-btn-label">Edit</span>';
        this._deactivateEditMode();
      }
    }

    _deactivateEditMode() {
      this.editMode = false;
      this.card.classList.remove('sheet-edit-mode');
      this._clearActiveCell();
      const btn = this.toolbar.querySelector('[data-action="toggle-edit"]');
      if (btn) {
        btn.classList.remove('active');
        btn.innerHTML = '<i class="bi bi-pencil"></i><span class="sheet-btn-label">Edit</span>';
      }
      this._closeAllDialogs();
    }

    _makeTableEditable() {
      this.table.querySelectorAll('td').forEach(td => {
        td.classList.add('sheet-editable');
        if (!td.dataset.rawValue) {
          td.dataset.rawValue = td.innerText.trim();
        }
      });
    }

    /* ── Cell selection & inline editing ── */
    _selectCell(td) {
      this._clearActiveCell();
      td.classList.add('sheet-cell-active');
      const { rowIdx, colIdx } = this._getCellPosition(td);
      this.activeCell = { td, rowIdx, colIdx };

      const colLetter = FormulaEngine.indexToColLetter(colIdx);
      this.cellRefLabel.textContent = `${colLetter}${rowIdx + 1}`;

      const stored = this.state.editedCells[`${rowIdx}_${colIdx}`];
      this.formulaInput.value = stored !== undefined ? stored : (td.dataset.rawValue ?? td.innerText.trim());
    }

    _clearActiveCell() {
      if (this.activeCell) {
        this.activeCell.td.classList.remove('sheet-cell-active');
      }
      this.activeCell = null;
      this.cellRefLabel.textContent = '—';
      this.formulaInput.value = '';
    }

    _startInlineEdit(td) {
      this._selectCell(td);
      // Create inline input overlay
      const existingInput = td.querySelector('.sheet-cell-input');
      if (existingInput) { existingInput.focus(); return; }

      const inp = document.createElement('input');
      inp.className = 'sheet-cell-input';
      inp.type = 'text';
      const stored = this.state.editedCells[`${this.activeCell.rowIdx}_${this.activeCell.colIdx}`];
      inp.value = stored !== undefined ? stored : (td.dataset.rawValue ?? td.innerText.trim());
      td.style.position = 'relative';
      td.appendChild(inp);
      inp.focus();
      inp.select();

      // Sync formula bar
      inp.addEventListener('input', () => {
        this.formulaInput.value = inp.value;
      });

      inp.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); this._commitInlineEdit(td, inp.value); this._moveActive(1, 0); }
        else if (e.key === 'Escape') { e.preventDefault(); inp.remove(); this._cancelEdit(); }
        else if (e.key === 'Tab') { e.preventDefault(); this._commitInlineEdit(td, inp.value); this._moveActive(0, e.shiftKey ? -1 : 1); }
      });

      inp.addEventListener('blur', () => {
        if (td.contains(inp)) { this._commitInlineEdit(td, inp.value); }
      });
    }

    _commitInlineEdit(td, value) {
      const inp = td.querySelector('.sheet-cell-input');
      if (inp) inp.remove();
      this._setCellValue(td, value);
    }

    _commitFormulaBarInput() {
      if (!this.activeCell) return;
      this._setCellValue(this.activeCell.td, this.formulaInput.value);
    }

    _cancelEdit() {
      const inp = this.activeCell?.td?.querySelector('.sheet-cell-input');
      if (inp) inp.remove();
      this._clearActiveCell();
    }

    /** Core: set a cell's value, persist, record history */
    _setCellValue(td, newValue) {
      // Custom column cell
      if (td.dataset.customColId) {
        const colId = td.dataset.customColId;
        const ri    = td.dataset.customRowIdx;
        const col   = this.state.customCols.find(c => c.id === colId);
        if (col) {
          const oldVal = col.cells[ri] ?? '';
          if (oldVal === newValue) return;
          this._pushHistory({ type: 'custom-cell', colId, ri, old: oldVal, newVal: newValue });
          col.cells[ri] = newValue;
          this._saveState();
          this._renderCellValue(td, newValue);
          td.dataset.rawValue = newValue.startsWith('=') ? td.innerText : newValue;
          this._recalcAllFormulas();
          this._updateResetBtn();
          return;
        }
      }

      // Original table cell
      const { rowIdx, colIdx } = this._getCellPosition(td);
      const key = `${rowIdx}_${colIdx}`;
      const oldValue = this.state.editedCells[key] ?? (td.dataset.rawValue ?? td.innerText.trim());

      if (oldValue === newValue) return;

      this._pushHistory({ type: 'cell', key, old: oldValue, newVal: newValue });

      this.state.editedCells[key] = newValue;
      this._saveState();
      this._updateResetBtn();

      this._renderCellValue(td, newValue);
      td.dataset.rawValue = newValue.startsWith('=') ? td.innerText : newValue;
      this._recalcAllFormulas();
    }

    _renderCellValue(td, value) {
      if (value.startsWith('=')) {
        const result = FormulaEngine.evaluate(value, this.table);
        td.innerText = result;
        td.classList.add('sheet-formula-cell');
        const isError = String(result).startsWith('#');
        td.classList.toggle('sheet-formula-error', isError);
      } else {
        td.innerText = value;
        td.classList.remove('sheet-formula-cell', 'sheet-formula-error');
      }
      td.classList.add('sheet-modified');
    }

    /** Apply all persisted edited cells to DOM */
    _applyEditedCells() {
      const bodyRows = Array.from(this.table.querySelectorAll('tbody tr'));
      for (const [key, value] of Object.entries(this.state.editedCells)) {
        const [r, c] = key.split('_').map(Number);
        const row = bodyRows[r];
        if (!row) continue;
        const td = row.querySelectorAll('td')[c];
        if (!td) continue;
        if (!td.dataset.rawValue) td.dataset.rawValue = td.innerText.trim();
        this._renderCellValue(td, value);
      }
    }

    _recalcAllFormulas() {
      for (const [key, value] of Object.entries(this.state.editedCells)) {
        if (!value.startsWith('=')) continue;
        const [r, c] = key.split('_').map(Number);
        const bodyRows = Array.from(this.table.querySelectorAll('tbody tr'));
        const row = bodyRows[r];
        if (!row) continue;
        const td = row.querySelectorAll('td')[c];
        if (!td) continue;
        this._renderCellValue(td, value);
      }

      // Also recalc custom column cells
      this.state.customCols.forEach((col, ci) => {
        const thIdx = this._getCustomColThIndex(col.id);
        if (thIdx < 0) return;
        const bodyRows = Array.from(this.table.querySelectorAll('tbody tr'));
        bodyRows.forEach((row, ri) => {
          const key = `${ri}`;
          const value = col.cells[key];
          if (!value || !value.startsWith('=')) return;
          const td = row.querySelectorAll('td')[thIdx];
          if (td) this._renderCellValue(td, value);
        });
      });
    }

    /* ── Navigation ── */
    _moveActive(dRow, dCol) {
      const bodyRows = Array.from(this.table.querySelectorAll('tbody tr:not([style*="display: none"])'));
      if (!bodyRows.length) return;
      let rIdx = this.activeCell ? this.activeCell.rowIdx : 0;
      let cIdx = this.activeCell ? this.activeCell.colIdx : 0;
      rIdx = Math.max(0, Math.min(bodyRows.length - 1, rIdx + dRow));
      const colCount = bodyRows[rIdx]?.querySelectorAll('td').length ?? 0;
      cIdx = Math.max(0, Math.min(colCount - 1, cIdx + dCol));
      const row = bodyRows[rIdx];
      const td = row?.querySelectorAll('td')[cIdx];
      if (td) this._selectCell(td);
    }

    _getCellPosition(td) {
      const row = td.closest('tr');
      const bodyRows = Array.from(this.table.querySelectorAll('tbody tr'));
      const rowIdx = bodyRows.indexOf(row);
      const colIdx = Array.from(row.querySelectorAll('td')).indexOf(td);
      return { rowIdx, colIdx };
    }

    _getColIndex(th) {
      const row = th.closest('tr');
      return Array.from(row.querySelectorAll('th')).indexOf(th);
    }

    /* ── Custom Columns ── */
    _openAddColDialog() {
      const headers = Array.from(this.table.querySelectorAll('thead tr:first-child th'))
        .map((th, i) => `<option value="${i}">${th.innerText.trim() || `Kolom ${i+1}`}</option>`)
        .join('');

      this.addColDialog.innerHTML = `
        <div class="sheet-dialog-title"><i class="bi bi-plus-square" style="color:var(--accent-purple)"></i> Tambah Kolom Kustom</div>
        <div class="sheet-dialog-field">
          <label>Nama Kolom</label>
          <input type="text" id="sheetNewColName_${this.tableId}" placeholder="e.g. Keterangan" maxlength="40">
        </div>
        <div class="sheet-dialog-field">
          <label>Posisi (sisipkan setelah kolom)</label>
          <select id="sheetNewColPos_${this.tableId}">
            <option value="-1">— Di awal —</option>
            ${headers}
          </select>
        </div>
        <div class="sheet-dialog-actions">
          <button class="sheet-btn" id="sheetAddColCancel_${this.tableId}">Batal</button>
          <button class="sheet-btn active" id="sheetAddColConfirm_${this.tableId}">Tambah</button>
        </div>
      `;

      this.addColDialog.classList.add('is-open');
      this.backdrop.classList.add('is-open');
      document.getElementById(`sheetNewColName_${this.tableId}`).focus();

      document.getElementById(`sheetAddColCancel_${this.tableId}`).onclick = () => this._closeAllDialogs();
      document.getElementById(`sheetAddColConfirm_${this.tableId}`).onclick = () => {
        const name = document.getElementById(`sheetNewColName_${this.tableId}`).value.trim();
        const pos  = parseInt(document.getElementById(`sheetNewColPos_${this.tableId}`).value, 10);
        if (!name) { alert('Nama kolom tidak boleh kosong.'); return; }
        this._addCustomCol(name, pos);
        this._closeAllDialogs();
      };
    }

    _addCustomCol(label, afterIndex) {
      const id = `custom_${Date.now()}`;
      const col = { id, label, afterIndex, cells: {} };
      this.state.customCols.push(col);
      this._saveState();
      this._pushHistory({ type: 'add-col', col });
      this._renderCustomCols();
      this._updateColPanel();
      this._updateResetBtn();
    }

    _removeCustomCol(colId) {
      const idx = this.state.customCols.findIndex(c => c.id === colId);
      if (idx < 0) return;
      const [removed] = this.state.customCols.splice(idx, 1);
      this._pushHistory({ type: 'remove-col', col: removed });
      this._saveState();
      this._renderCustomCols();
      this._updateColPanel();
      this._updateResetBtn();
    }

    _renderCustomCols() {
      // Remove existing custom col elements
      this.table.querySelectorAll('.sheet-custom-col').forEach(el => el.remove());

      this.state.customCols.forEach(col => {
        // Header
        const headerRow = this.table.querySelector('thead tr:first-child');
        if (!headerRow) return;
        const allThs = Array.from(headerRow.querySelectorAll('th'));
        const insertAfterTh = col.afterIndex >= 0 ? allThs[col.afterIndex] : null;

        const th = document.createElement('th');
        th.className = 'sheet-custom-col';
        th.dataset.customId = col.id;
        th.innerHTML = `<span>${col.label}</span>`;
        th.style.minWidth = '120px';

        if (insertAfterTh) {
          insertAfterTh.after(th);
        } else {
          headerRow.prepend(th);
        }

        // Body cells
        const bodyRows = Array.from(this.table.querySelectorAll('tbody tr'));
        bodyRows.forEach((row, ri) => {
          const rowTds = Array.from(row.querySelectorAll('td'));
          // Determine insertion point matching header
          const thIndexInHeader = Array.from(this.table.querySelector('thead tr:first-child').querySelectorAll('th'))
            .indexOf(th);

          const td = document.createElement('td');
          td.className = 'sheet-editable sheet-custom-col';
          td.dataset.customId = col.id;
          const storedValue = col.cells[String(ri)] ?? '';
          td.dataset.rawValue = storedValue;

          if (storedValue.startsWith('=')) {
            const result = FormulaEngine.evaluate(storedValue, this.table);
            td.innerText = result;
            td.classList.add('sheet-formula-cell');
          } else {
            td.innerText = storedValue;
          }

          // Insert at correct position
          const targetTd = rowTds[thIndexInHeader - 1];
          if (targetTd) {
            targetTd.after(td);
          } else {
            row.prepend(td);
          }

          // Click to edit custom cell
          td.addEventListener('click', () => { if (this.editMode) this._selectCell(td); });
          td.addEventListener('dblclick', () => { if (this.editMode) this._startInlineEdit(td); });
          // Mark cell for custom col dispatch in _setCellValue
          td.dataset.customColId = col.id;
          td.dataset.customRowIdx = String(ri);
        });

        // Apply hidden state
        if (this.state.hiddenCols.includes(col.id)) {
          th.classList.add('sheet-col-hidden');
          this.table.querySelectorAll(`[data-custom-id="${col.id}"]`).forEach(el => {
            if (el.tagName === 'TD') el.classList.add('sheet-col-hidden');
          });
        }
      });
    }

    _getCustomColThIndex(colId) {
      const ths = Array.from(this.table.querySelectorAll('thead tr:first-child th'));
      return ths.findIndex(th => th.dataset.customId === colId);
    }

    /* ── Hidden Columns ── */
    _toggleColPanel() {
      const isOpen = this.colPanel.classList.contains('is-open');
      if (!isOpen) {
        this._buildColPanel();
        this.colPanel.classList.add('is-open');
      } else {
        this.colPanel.classList.remove('is-open');
      }
    }

    _buildColPanel() {
      const ths = Array.from(this.table.querySelectorAll('thead tr:first-child th'));

      const items = ths.map((th, i) => {
        const isCustom = !!th.dataset.customId;
        const colId = isCustom ? th.dataset.customId : String(i);
        const label = th.innerText.trim() || `Kolom ${i + 1}`;
        const isHidden = this.state.hiddenCols.includes(isCustom ? th.dataset.customId : i);
        return { colId, label, isCustom, th, idx: i, isHidden };
      });

      this.colPanel.innerHTML = `
        <div class="sheet-col-panel-header">
          <span><i class="bi bi-eye"></i> Kelola Kolom</span>
        </div>
        ${items.map(item => `
          <div class="sheet-col-item ${item.isCustom ? 'is-custom' : ''}" data-col-id="${item.colId}" data-is-custom="${item.isCustom}">
            <input type="checkbox" id="sheetCol_${this.tableId}_${item.colId}" ${item.isHidden ? '' : 'checked'}>
            <label for="sheetCol_${this.tableId}_${item.colId}">${item.label}${item.isCustom ? ' ✦' : ''}</label>
          </div>
        `).join('')}
        <div class="sheet-col-panel-footer">
          <button class="sheet-btn" id="sheetShowAllCols_${this.tableId}">Tampilkan Semua</button>
        </div>
      `;

      // Checkbox events
      this.colPanel.querySelectorAll('.sheet-col-item').forEach(item => {
        const cb = item.querySelector('input[type="checkbox"]');
        cb.addEventListener('change', () => {
          const colId = item.dataset.colId;
          const isCustom = item.dataset.isCustom === 'true';
          const key = isCustom ? colId : parseInt(colId, 10);
          if (cb.checked) {
            this.state.hiddenCols = this.state.hiddenCols.filter(c => c !== key);
          } else {
            if (!this.state.hiddenCols.includes(key)) this.state.hiddenCols.push(key);
          }
          this._saveState();
          this._applyHiddenCols();
          this._updateResetBtn();
        });
      });

      document.getElementById(`sheetShowAllCols_${this.tableId}`).onclick = () => {
        this.state.hiddenCols = [];
        this._saveState();
        this._applyHiddenCols();
        this._buildColPanel();
        this._updateResetBtn();
      };
    }

    _updateColPanel() {
      if (this.colPanel.classList.contains('is-open')) this._buildColPanel();
    }

    _applyHiddenCols() {
      const ths = Array.from(this.table.querySelectorAll('thead tr:first-child th'));

      ths.forEach((th, i) => {
        const isCustom = !!th.dataset.customId;
        const key = isCustom ? th.dataset.customId : i;
        const isHidden = this.state.hiddenCols.includes(key);
        th.classList.toggle('sheet-col-hidden', isHidden);

        // Toggle all body cells in this column
        const bodyRows = this.table.querySelectorAll('tbody tr');
        bodyRows.forEach(row => {
          const tds = row.querySelectorAll('td');
          if (isCustom) {
            // Custom col: find by data-custom-id
            row.querySelectorAll(`[data-custom-id="${th.dataset.customId}"]`).forEach(td => {
              td.classList.toggle('sheet-col-hidden', isHidden);
            });
          } else {
            if (tds[i]) tds[i].classList.toggle('sheet-col-hidden', isHidden);
          }
        });
      });
    }

    /* ── Context Menu ── */
    _showCtxMenu(x, y, th, colIdx) {
      const isCustom = !!th.dataset.customId;
      const colId = th.dataset.customId;

      this.ctxMenu.innerHTML = `
        ${isCustom ? `<div class="sheet-ctx-item" data-action="rename"><i class="bi bi-pencil"></i> Rename Kolom</div>` : ''}
        <div class="sheet-ctx-item" data-action="hide"><i class="bi bi-eye-slash"></i> Sembunyikan Kolom</div>
        ${isCustom ? `<div class="sheet-ctx-sep"></div><div class="sheet-ctx-item danger" data-action="delete-col"><i class="bi bi-trash3"></i> Hapus Kolom Ini</div>` : ''}
      `;

      // Position
      const menuW = 170, menuH = 100;
      this.ctxMenu.style.left = Math.min(x, window.innerWidth - menuW) + 'px';
      this.ctxMenu.style.top  = Math.min(y, window.innerHeight - menuH) + 'px';
      this.ctxMenu.classList.add('is-open');

      this.ctxMenu.querySelector('[data-action="hide"]')?.addEventListener('click', () => {
        const key = isCustom ? colId : colIdx;
        if (!this.state.hiddenCols.includes(key)) this.state.hiddenCols.push(key);
        this._saveState();
        this._applyHiddenCols();
        this.ctxMenu.classList.remove('is-open');
        this._updateResetBtn();
      });

      this.ctxMenu.querySelector('[data-action="delete-col"]')?.addEventListener('click', () => {
        if (confirm(`Hapus kolom "${th.innerText.trim()}"?`)) {
          this._removeCustomCol(colId);
        }
        this.ctxMenu.classList.remove('is-open');
      });

      this.ctxMenu.querySelector('[data-action="rename"]')?.addEventListener('click', () => {
        const newName = prompt('Nama kolom baru:', th.querySelector('span')?.innerText ?? th.innerText.trim());
        if (newName && newName.trim()) {
          const col = this.state.customCols.find(c => c.id === colId);
          if (col) {
            col.label = newName.trim();
            this._saveState();
            this._renderCustomCols();
          }
        }
        this.ctxMenu.classList.remove('is-open');
      });
    }

    /* ── Undo / Redo ── */
    _pushHistory(action) {
      // Truncate redo stack
      this.historyStack = this.historyStack.slice(0, this.historyPtr + 1);
      this.historyStack.push(action);
      if (this.historyStack.length > this.MAX_HISTORY) this.historyStack.shift();
      this.historyPtr = this.historyStack.length - 1;
      this._updateUndoRedoBtns();
    }

    _undo() {
      if (this.historyPtr < 0) return;
      const action = this.historyStack[this.historyPtr];
      this.historyPtr--;
      this._reverseAction(action, 'undo');
      this._updateUndoRedoBtns();
      this._flashTable();
    }

    _redo() {
      if (this.historyPtr >= this.historyStack.length - 1) return;
      this.historyPtr++;
      const action = this.historyStack[this.historyPtr];
      this._reverseAction(action, 'redo');
      this._updateUndoRedoBtns();
      this._flashTable();
    }

    _reverseAction(action, dir) {
      if (action.type === 'cell') {
        const value = dir === 'undo' ? action.old : action.newVal;
        const [r, c] = action.key.split('_').map(Number);
        const bodyRows = Array.from(this.table.querySelectorAll('tbody tr'));
        const td = bodyRows[r]?.querySelectorAll('td')[c];
        if (td) {
          if (value === action.old && dir === 'undo') {
            delete this.state.editedCells[action.key];
            td.innerText = td.dataset.rawValue ?? value;
            td.classList.remove('sheet-modified', 'sheet-formula-cell', 'sheet-formula-error');
          } else {
            this.state.editedCells[action.key] = value;
            this._renderCellValue(td, value);
          }
          this._saveState();
          this._recalcAllFormulas();
        }
      } else if (action.type === 'add-col') {
        if (dir === 'undo') this._removeCustomCol(action.col.id);
        else { this.state.customCols.push(action.col); this._saveState(); this._renderCustomCols(); }
      } else if (action.type === 'remove-col') {
        if (dir === 'undo') { this.state.customCols.push(action.col); this._saveState(); this._renderCustomCols(); }
        else this._removeCustomCol(action.col.id);
      }
      this._updateResetBtn();
    }

    _updateUndoRedoBtns() {
      const btnUndo = this.toolbar.querySelector('[data-action="undo"]');
      const btnRedo = this.toolbar.querySelector('[data-action="redo"]');
      if (btnUndo) btnUndo.disabled = this.historyPtr < 0;
      if (btnRedo) btnRedo.disabled = this.historyPtr >= this.historyStack.length - 1;
    }

    _flashTable() {
      this.table.classList.add('sheet-undo-flash');
      setTimeout(() => this.table.classList.remove('sheet-undo-flash'), 300);
    }

    /* ── Reset ── */
    _updateResetBtn() {
      const btn = this.toolbar.querySelector('[data-action="reset"]');
      if (btn) btn.style.display = this._hasOverrides() ? 'inline-flex' : 'none';
    }

    _confirmReset() {
      if (!confirm('Reset semua perubahan ke data asli? Tindakan ini tidak dapat di-undo.')) return;
      this.state = { editedCells: {}, customCols: [], hiddenCols: [] };
      this._saveState();
      this.historyStack = [];
      this.historyPtr = -1;
      this._updateUndoRedoBtns();
      // Full DOM reset: remove custom cols, restore edited cells, show all cols
      this.table.querySelectorAll('.sheet-custom-col').forEach(el => el.remove());
      this.table.querySelectorAll('.sheet-modified').forEach(td => {
        const raw = td.dataset.rawValue;
        if (raw !== undefined) td.innerText = raw;
        td.classList.remove('sheet-modified','sheet-formula-cell','sheet-formula-error');
      });
      this.table.querySelectorAll('.sheet-col-hidden').forEach(el => el.classList.remove('sheet-col-hidden'));
      this._updateResetBtn();
      this._updateColPanel();
    }

    /* ── Dialog helpers ── */
    _closeAllDialogs() {
      this.addColDialog.classList.remove('is-open');
      this.backdrop.classList.remove('is-open');
      this.ctxMenu.classList.remove('is-open');
    }
  }

  /* ──────────────────────────────────────────────
     GLOBAL INTEGRATION — Hook into existing expand system
  ────────────────────────────────────────────── */

  // Map of tableId → SpreadsheetEditor instance
  window._sheetEditors = window._sheetEditors || {};

  function attachEditor(card) {
    const table = card.querySelector('table');
    if (!table) return;
    const tableId = table.id;
    if (window._sheetEditors[tableId]) return; // already attached
    window._sheetEditors[tableId] = new SpreadsheetEditor(card);
  }

  /** Called by layout.ejs toggleCardExpand after expanding */
  const origToggle = window.toggleCardExpand;
  if (typeof origToggle === 'function') {
    window.toggleCardExpand = function(card, btn) {
      origToggle(card, btn);
      // If now expanded, attach editor
      if (card.classList.contains('card-expanded')) {
        setTimeout(() => attachEditor(card), 50);
      }
    };
  }

  // Also auto-attach if a card is already expanded on load (e.g. after PJAX)
  document.addEventListener('DOMContentLoaded', () => {
    const expandedCard = document.querySelector('.card.card-expanded');
    if (expandedCard) attachEditor(expandedCard);
  });

  // Expose for PJAX scenarios
  window.SpreadsheetEditor = SpreadsheetEditor;
  window.attachSpreadsheetEditor = attachEditor;

  /* Patch exportTableToXLSX to include custom columns (they're in the DOM) */
  const origExport = window.exportTableToXLSX;
  if (typeof origExport === 'function') {
    window.exportTableToXLSX = async function(tableId, title) {
      // Custom cols are already rendered in the DOM via SpreadsheetEditor,
      // so getCleanTableClone will naturally include them.
      // Hidden cols: mark them visible temporarily for export? No — honor user's hide choice.
      return origExport(tableId, title);
    };
  }

})();
