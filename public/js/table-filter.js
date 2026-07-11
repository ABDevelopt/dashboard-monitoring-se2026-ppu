/**
 * Excel-like Column Filter for Dashboard Tables
 * Allows sorting, searching, and checking unique values for client-side filtering.
 */

(function () {
  // Helpers
  function parseVal(text) {
    if (!text) return 0;
    const clean = text.replace(/%/g, '').replace(/[\$,]/g, '').trim();
    const num = parseFloat(clean);
    return isNaN(num) ? text.toLowerCase().trim() : num;
  }

  function getUniqueValues(table, colIdx) {
    const values = new Set();
    const rows = table.querySelectorAll('tbody > tr');
    rows.forEach(row => {
      // Exclude empty state rows or hidden helper rows
      if (row.classList.contains('no-data') || row.style.display === 'none' && row.dataset.filtered === 'true') {
        // Continue
      }
      const cell = row.cells[colIdx];
      if (cell) {
        let txt = cell.textContent.trim();
        // Clean up text if it contains badge or extra spaces
        txt = txt.replace(/\s+/g, ' ');
        if (txt) values.add(txt);
      }
    });
    return Array.from(values).sort((a, b) => {
      const valA = parseVal(a);
      const valB = parseVal(b);
      if (typeof valA === 'number' && typeof valB === 'number') {
        return valA - valB;
      }
      return String(a).localeCompare(String(b), 'id', { sensitivity: 'base' });
    });
  }

  // Sorting logic
  function sortTable(table, colIdx, ascending) {
    const tbody = table.querySelector('tbody');
    if (!tbody) return;
    const rows = Array.from(tbody.querySelectorAll('tr:not(.no-data)'));
    
    rows.sort((rowA, rowB) => {
      const cellA = rowA.cells[colIdx];
      const cellB = rowB.cells[colIdx];
      const valA = cellA ? parseVal(cellA.textContent) : '';
      const valB = cellB ? parseVal(cellB.textContent) : '';

      if (typeof valA === 'number' && typeof valB === 'number') {
        return ascending ? valA - valB : valB - valA;
      }
      const strA = String(valA);
      const strB = String(valB);
      return ascending 
        ? strA.localeCompare(strB, 'id', { sensitivity: 'base' })
        : strB.localeCompare(strA, 'id', { sensitivity: 'base' });
    });

    // Re-append sorted rows
    rows.forEach(row => tbody.appendChild(row));
  }

  // Apply all column filters of a table
  function applyAllFilters(table) {
    const tbody = table.querySelector('tbody');
    if (!tbody) return;
    const rows = tbody.querySelectorAll('tr:not(.no-data)');
    const activeFilters = table.dataset.activeFilters ? JSON.parse(table.dataset.activeFilters) : {};

    let visibleCount = 0;
    rows.forEach(row => {
      let isMatch = true;
      
      // Check each column filter
      for (const [colIdxStr, checkedVals] of Object.entries(activeFilters)) {
        const colIdx = parseInt(colIdxStr);
        const cell = row.cells[colIdx];
        if (!cell) continue;
        
        let cellText = cell.textContent.trim().replace(/\s+/g, ' ');
        if (!checkedVals.includes(cellText)) {
          isMatch = false;
          break;
        }
      }

      if (isMatch) {
        row.style.display = '';
        row.dataset.filtered = 'false';
        visibleCount++;
      } else {
        row.style.display = 'none';
        row.dataset.filtered = 'true';
      }
    });

    // Handle empty state row
    let emptyRow = tbody.querySelector('.no-data-filter-row');
    if (visibleCount === 0) {
      if (!emptyRow) {
        emptyRow = document.createElement('tr');
        emptyRow.className = 'no-data-filter-row';
        const colCount = table.querySelectorAll('thead th').length || 10;
        emptyRow.innerHTML = `<td colspan="${colCount}" class="no-data" style="padding: 48px; text-align: center; color: var(--text-secondary);">
          <i class="bi bi-filter-circle" style="font-size: 32px; display: block; margin-bottom: 8px;"></i>
          Tidak ada baris data yang cocok dengan kriteria filter kolom.
        </td>`;
        tbody.appendChild(emptyRow);
      } else {
        emptyRow.style.display = '';
      }
    } else if (emptyRow) {
      emptyRow.style.display = 'none';
    }
  }

  // Main initialization function
  window.initExcelFilters = function () {
    // Find all data tables that should be filterable (we auto-apply to tables with th elements)
    const tables = document.querySelectorAll('table:not(.no-filter-table)');
    
    tables.forEach(table => {
      // Don't double initialize
      if (table.dataset.filtersInitialized === 'true') return;
      table.dataset.filtersInitialized = 'true';
      table.dataset.activeFilters = JSON.stringify({});

      const thead = table.querySelector('thead');
      if (!thead) return;

      // Find the row containing th headers (for multi-row header, pick the last row containing headers)
      const headerRows = thead.querySelectorAll('tr');
      if (headerRows.length === 0) return;
      const headerRow = headerRows[headerRows.length - 1]; // last header row maps to data columns
      const headers = headerRow.querySelectorAll('th');

      headers.forEach((th, colIdx) => {
        // Skip action or index columns
        if (th.classList.contains('no-filter') || th.textContent.trim() === 'No' || th.textContent.trim() === 'Aksi') {
          return;
        }

        // Style the TH cell relative for dropdown positioning
        th.style.position = 'relative';
        
        // Wrap original TH contents
        const wrapper = document.createElement('div');
        wrapper.className = 'filter-header-container';
        wrapper.style.display = 'inline-flex';
        wrapper.style.alignItems = 'center';
        wrapper.style.gap = '6px';
        wrapper.style.justifyContent = 'space-between';
        wrapper.style.width = '100%';

        const textSpan = document.createElement('span');
        textSpan.innerHTML = th.innerHTML;
        wrapper.appendChild(textSpan);

        // Create filter funnel button
        const filterBtn = document.createElement('span');
        filterBtn.className = 'filter-btn no-print';
        filterBtn.innerHTML = '<i class="bi bi-funnel"></i>';
        filterBtn.style.cursor = 'pointer';
        filterBtn.style.color = 'var(--text-muted)';
        filterBtn.style.padding = '2px';
        filterBtn.style.borderRadius = '4px';
        filterBtn.title = 'Filter Kolom';
        wrapper.appendChild(filterBtn);

        th.innerHTML = '';
        th.appendChild(wrapper);

        // Create Filter Dropdown Panel
        const dropdown = document.createElement('div');
        dropdown.className = 'filter-dropdown no-print';
        
        // Build Dropdown DOM
        dropdown.innerHTML = `
          <div class="filter-sort-btn" data-sort="asc" style="display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 4px; cursor: pointer; transition: background 0.15s; font-weight: 500;">
            <i class="bi bi-sort-alpha-down"></i> Urutkan A ke Z (Meningkat)
          </div>
          <div class="filter-sort-btn" data-sort="desc" style="display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 4px; cursor: pointer; transition: background 0.15s; font-weight: 500; border-bottom: 1px solid #21262d; padding-bottom: 8px;">
            <i class="bi bi-sort-alpha-down-alt"></i> Urutkan Z ke A (Menurun)
          </div>
          <div style="margin-top: 6px;">
            <input type="text" class="filter-search-input" placeholder="Cari kriteria..." style="background-color: #0d1117; border: 1px solid #30363d; color: var(--text-primary); padding: 6px 10px; border-radius: 4px; width: 100%; box-sizing: border-box; font-size: 11px; outline: none;">
          </div>
          <div class="filter-options-list" style="max-height: 150px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; margin-top: 8px; padding-right: 4px; border-top: 1px solid #21262d; padding-top: 8px;">
            <!-- Options dynamically populated -->
          </div>
          <div class="filter-actions" style="display: flex; justify-content: space-between; gap: 8px; margin-top: 8px; border-top: 1px solid #21262d; padding-top: 8px;">
            <button class="filter-action-btn clear" style="padding: 4px 10px; border-radius: 4px; font-size: 11px; font-weight: 600; cursor: pointer; border: 1px solid #30363d; background: #30363d; color: var(--text-primary); flex: 1;">Kosongkan</button>
            <button class="filter-action-btn apply" style="padding: 4px 10px; border-radius: 4px; font-size: 11px; font-weight: 600; cursor: pointer; border: none; background: var(--accent-blue); color: #fff; flex: 1;">Terapkan</button>
          </div>
        `;
        
        wrapper.appendChild(dropdown);

        // Click funnel button to toggle dropdown panel
        filterBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          
          // Close other open filter dropdowns first
          document.querySelectorAll('.filter-dropdown.active').forEach(d => {
            if (d !== dropdown) d.classList.remove('active');
          });

          const isActive = dropdown.classList.contains('active');
          if (!isActive) {
            // Populate checkboxes dynamically
            const listContainer = dropdown.querySelector('.filter-options-list');
            const searchInput = dropdown.querySelector('.filter-search-input');
            searchInput.value = ''; // reset search
            
            const uniqueVals = getUniqueValues(table, colIdx);
            const activeFilters = JSON.parse(table.dataset.activeFilters);
            const isColFiltered = activeFilters[colIdx] !== undefined;
            const checkedSet = isColFiltered ? new Set(activeFilters[colIdx]) : null;

            listContainer.innerHTML = '';
            
            // Add Select All option
            const selectAllItem = document.createElement('label');
            selectAllItem.className = 'filter-option-item';
            selectAllItem.style.display = 'flex';
            selectAllItem.style.alignItems = 'center';
            selectAllItem.style.gap = '8px';
            selectAllItem.style.cursor = 'pointer';
            selectAllItem.innerHTML = `
              <input type="checkbox" class="select-all-checkbox" checked style="cursor: pointer;">
              <span class="filter-option-label" style="font-weight: bold; color: var(--text-primary);">Pilih Semua</span>
            `;
            listContainer.appendChild(selectAllItem);

            const optionCheckboxes = [];

            uniqueVals.forEach(val => {
              const label = document.createElement('label');
              label.className = 'filter-option-item';
              label.style.display = 'flex';
              label.style.alignItems = 'center';
              label.style.gap = '8px';
              label.style.cursor = 'pointer';
              
              const isChecked = !isColFiltered || checkedSet.has(val);
              label.innerHTML = `
                <input type="checkbox" class="option-checkbox" value="${val.replace(/"/g, '&quot;')}" ${isChecked ? 'checked' : ''} style="cursor: pointer;">
                <span class="filter-option-label">${val}</span>
              `;
              
              listContainer.appendChild(label);
              
              const cb = label.querySelector('.option-checkbox');
              optionCheckboxes.push(cb);
            });

            // Select All listener
            const selectAllCb = selectAllItem.querySelector('.select-all-checkbox');
            selectAllCb.addEventListener('change', () => {
              const isChecked = selectAllCb.checked;
              optionCheckboxes.forEach(cb => {
                if (cb.parentElement.style.display !== 'none') {
                  cb.checked = isChecked;
                }
              });
            });

            // Autocomplete Search input listener
            searchInput.addEventListener('input', () => {
              const query = searchInput.value.toLowerCase().trim();
              let visibleCount = 0;
              optionCheckboxes.forEach(cb => {
                const labelText = cb.value.toLowerCase();
                const item = cb.parentElement;
                if (labelText.includes(query)) {
                  item.style.display = 'flex';
                  visibleCount++;
                } else {
                  item.style.display = 'none';
                }
              });
              selectAllItem.style.display = query ? 'none' : 'flex';
            });

            dropdown.classList.add('active');
            searchInput.focus();
          } else {
            dropdown.classList.remove('active');
          }
        });

        // Dropdown actions listeners
        dropdown.addEventListener('click', (e) => e.stopPropagation()); // prevent auto-close

        // Apply filter action
        dropdown.querySelector('.filter-action-btn.apply').addEventListener('click', () => {
          const checkedCheckboxes = dropdown.querySelectorAll('.option-checkbox:checked');
          const allCheckboxes = dropdown.querySelectorAll('.option-checkbox');
          const activeFilters = JSON.parse(table.dataset.activeFilters);

          if (checkedCheckboxes.length === allCheckboxes.length) {
            // No filter active for this column
            delete activeFilters[colIdx];
            filterBtn.classList.remove('active');
            filterBtn.style.color = 'var(--text-muted)';
            filterBtn.innerHTML = '<i class="bi bi-funnel"></i>';
          } else {
            // Apply filtering
            const checkedVals = Array.from(checkedCheckboxes).map(cb => cb.value);
            activeFilters[colIdx] = checkedVals;
            filterBtn.classList.add('active');
            filterBtn.style.color = 'var(--accent-cyan)';
            filterBtn.innerHTML = '<i class="bi bi-funnel-fill"></i>';
          }

          table.dataset.activeFilters = JSON.stringify(activeFilters);
          applyAllFilters(table);
          dropdown.classList.remove('active');
        });

        // Clear filter action
        dropdown.querySelector('.filter-action-btn.clear').addEventListener('click', () => {
          const activeFilters = JSON.parse(table.dataset.activeFilters);
          delete activeFilters[colIdx];
          table.dataset.activeFilters = JSON.stringify(activeFilters);
          
          filterBtn.classList.remove('active');
          filterBtn.style.color = 'var(--text-muted)';
          filterBtn.innerHTML = '<i class="bi bi-funnel"></i>';
          
          applyAllFilters(table);
          dropdown.classList.remove('active');
        });

        // Sort ascending listener
        dropdown.querySelector('.filter-sort-btn[data-sort="asc"]').addEventListener('click', () => {
          sortTable(table, colIdx, true);
          dropdown.classList.remove('active');
        });

        // Sort descending listener
        dropdown.querySelector('.filter-sort-btn[data-sort="desc"]').addEventListener('click', () => {
          sortTable(table, colIdx, false);
          dropdown.classList.remove('active');
        });
      });
    });
  };

  // Close dropdowns on clicking outside
  document.addEventListener('click', () => {
    document.querySelectorAll('.filter-dropdown.active').forEach(d => {
      d.classList.remove('active');
    });
  });

  // Auto-init on page load
  document.addEventListener('DOMContentLoaded', window.initExcelFilters);
})();
