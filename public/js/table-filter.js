/**
 * Excel-like Column Filter for Dashboard Tables
 * Allows sorting, searching, and checking unique values for client-side filtering.
 * Filter selections are persisted in sessionStorage across PJAX navigations and row detail clicks.
 */

(function () {
  // Storage helpers
  function getStorageKey(table) {
    const tableId = table.id || table.getAttribute('name') || 'default_table';
    const path = window.location.pathname.replace(/\/$/, '') || '/';
    return 'tbl_filter_' + path + '_' + tableId;
  }

  function saveFilters(table, activeFilters) {
    try {
      const key = getStorageKey(table);
      if (activeFilters && Object.keys(activeFilters).length > 0) {
        sessionStorage.setItem(key, JSON.stringify(activeFilters));
      } else {
        sessionStorage.removeItem(key);
      }
    } catch (e) {
      console.warn('Could not save table filters to sessionStorage:', e);
    }
  }

  function loadFilters(table) {
    try {
      const key = getStorageKey(table);
      const data = sessionStorage.getItem(key);
      if (data) {
        return JSON.parse(data);
      }
    } catch (e) {
      console.warn('Could not load table filters from sessionStorage:', e);
    }
    return {};
  }

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
      if (row.classList.contains('no-data') || row.classList.contains('no-data-filter-row')) {
        return;
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
    const rows = Array.from(tbody.querySelectorAll('tr:not(.no-data):not(.no-data-filter-row)'));
    
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
    const rows = tbody.querySelectorAll('tr:not(.no-data):not(.no-data-filter-row)');
    const activeFilters = table.dataset.activeFilters ? JSON.parse(table.dataset.activeFilters) : {};

    let visibleCount = 0;
    rows.forEach(row => {
      let isMatch = true;
      
      // Check each column filter
      for (const [colIdxStr, checkedVals] of Object.entries(activeFilters)) {
        const colIdx = parseInt(colIdxStr, 10);
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
    if (visibleCount === 0 && rows.length > 0) {
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

  // Helper to map each th to its actual visual column index in the table body
  function mapHeadersToColIdx(table) {
    const thead = table.querySelector('thead');
    if (!thead) return new Map();
    
    const rows = thead.querySelectorAll('tr');
    const grid = [];
    for (let y = 0; y < rows.length; y++) {
      grid[y] = [];
    }
    
    const thMap = new Map();
    
    rows.forEach((tr, y) => {
      let x = 0;
      const ths = tr.querySelectorAll('th');
      ths.forEach(th => {
        while (grid[y][x]) {
          x++;
        }
        
        const colspan = parseInt(th.getAttribute('colspan') || 1, 10);
        const rowspan = parseInt(th.getAttribute('rowspan') || 1, 10);
        
        for (let r = 0; r < rowspan; r++) {
          for (let c = 0; c < colspan; c++) {
            if (grid[y + r]) {
              grid[y + r][x + c] = true;
            }
          }
        }
        
        thMap.set(th, x);
        x += colspan;
      });
    });
    
    return thMap;
  }

  // Main initialization function
  window.initExcelFilters = function () {
    const tables = document.querySelectorAll('table:not(.no-filter-table)');
    
    tables.forEach(table => {
      const activeFilters = loadFilters(table);
      table.dataset.activeFilters = JSON.stringify(activeFilters);

      // If headers are already set up, just re-apply filter matching on tbody
      if (table.dataset.filtersInitialized === 'true') {
        applyAllFilters(table);
        return;
      }
      table.dataset.filtersInitialized = 'true';

      const thead = table.querySelector('thead');
      if (!thead) return;

      const thMap = mapHeadersToColIdx(table);
      const allThs = thead.querySelectorAll('th');

      allThs.forEach((th) => {
        const colIdx = thMap.get(th);
        if (colIdx === undefined) return;

        // Skip headers with colspan > 1 (grouped headers like 'Assignment FASIH')
        const colspan = parseInt(th.getAttribute('colspan') || 1, 10);
        if (colspan > 1) return;

        const thText = th.textContent.trim().toLowerCase();
        // Skip action columns
        if (th.classList.contains('no-filter') || thText === 'aksi') {
          return;
        }

        const isColFiltered = activeFilters[colIdx] !== undefined && Array.isArray(activeFilters[colIdx]);

        // Style the TH cell relative for dropdown positioning
        th.classList.add('has-filter');
        th.style.position = 'relative';
        th.style.paddingRight = '30px';

        const originalContent = th.innerHTML;
        th.innerHTML = '';

        // Wrap original TH contents in a marquee-scrollable wrapper
        const wrapper = document.createElement('span');
        wrapper.className = 'filter-header-wrapper';

        const scrollInner = document.createElement('span');
        scrollInner.className = 'th-text-scroll';
        scrollInner.innerHTML = originalContent;

        wrapper.appendChild(scrollInner);
        th.appendChild(wrapper);

        // Auto marquee scroll trigger if text overflows wrapper
        const updateMarquee = () => {
          scrollInner.classList.remove('has-marquee');
          scrollInner.style.removeProperty('--marquee-dist');
          const overflowDist = scrollInner.scrollWidth - wrapper.clientWidth;
          if (overflowDist > 3) {
            scrollInner.style.setProperty('--marquee-dist', `-${overflowDist + 6}px`);
            scrollInner.classList.add('has-marquee');
          }
        };

        requestAnimationFrame(() => setTimeout(updateMarquee, 80));
        window.addEventListener('resize', updateMarquee, { passive: true });

        // Create filter funnel button
        const filterBtn = document.createElement('span');
        filterBtn.className = 'filter-btn no-print' + (isColFiltered ? ' active' : '');
        filterBtn.innerHTML = isColFiltered 
          ? '<i class="bi bi-funnel-fill" style="font-size: 13px;"></i>' 
          : '<i class="bi bi-funnel" style="font-size: 13px;"></i>';
        filterBtn.style.position = 'absolute';
        filterBtn.style.right = '6px';
        filterBtn.style.top = '50%';
        filterBtn.style.transform = 'translateY(-50%)';
        filterBtn.style.cursor = 'pointer';
        filterBtn.style.color = isColFiltered ? 'var(--accent-cyan)' : 'var(--text-muted)';
        filterBtn.style.padding = '4px 6px';
        filterBtn.style.borderRadius = '4px';
        filterBtn.style.display = 'inline-flex';
        filterBtn.style.alignItems = 'center';
        filterBtn.style.justifyContent = 'center';
        filterBtn.style.transition = 'all 0.2s ease';
        filterBtn.title = 'Filter Kolom';

        // Hover effects
        filterBtn.addEventListener('mouseenter', () => {
          filterBtn.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
          if (!filterBtn.classList.contains('active')) {
            filterBtn.style.color = 'var(--text-primary)';
          }
        });
        filterBtn.addEventListener('mouseleave', () => {
          filterBtn.style.backgroundColor = 'transparent';
          if (!filterBtn.classList.contains('active')) {
            filterBtn.style.color = 'var(--text-muted)';
          }
        });

        th.appendChild(filterBtn);

        // Create Filter Dropdown Panel
        const dropdown = document.createElement('div');
        dropdown.className = 'filter-dropdown no-print';
        
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
        
        th.appendChild(dropdown);

        // Click funnel button to toggle dropdown panel
        filterBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          
          document.querySelectorAll('.filter-dropdown.active').forEach(d => {
            if (d !== dropdown) d.classList.remove('active');
          });

          const isActive = dropdown.classList.contains('active');
          if (!isActive) {
            const listContainer = dropdown.querySelector('.filter-options-list');
            const searchInput = dropdown.querySelector('.filter-search-input');
            searchInput.value = '';
            
            const uniqueVals = getUniqueValues(table, colIdx);
            const currentActiveFilters = JSON.parse(table.dataset.activeFilters || '{}');
            const isColFilteredNow = currentActiveFilters[colIdx] !== undefined;
            const checkedSet = isColFilteredNow ? new Set(currentActiveFilters[colIdx]) : null;

            listContainer.innerHTML = '';
            
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
              
              const isChecked = !isColFilteredNow || checkedSet.has(val);
              label.innerHTML = `
                <input type="checkbox" class="option-checkbox" value="${val.replace(/"/g, '&quot;')}" ${isChecked ? 'checked' : ''} style="cursor: pointer;">
                <span class="filter-option-label">${val}</span>
              `;
              
              listContainer.appendChild(label);
              
              const cb = label.querySelector('.option-checkbox');
              optionCheckboxes.push(cb);
            });

            const selectAllCb = selectAllItem.querySelector('.select-all-checkbox');
            selectAllCb.addEventListener('change', () => {
              const isChecked = selectAllCb.checked;
              optionCheckboxes.forEach(cb => {
                if (cb.parentElement.style.display !== 'none') {
                  cb.checked = isChecked;
                }
              });
            });

            searchInput.addEventListener('input', () => {
              const query = searchInput.value.trim().toLowerCase();
              optionCheckboxes.forEach(cb => {
                const labelText = cb.value.toLowerCase();
                const item = cb.parentElement;
                if (!query || labelText.includes(query)) {
                  item.style.display = 'flex';
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

        dropdown.addEventListener('click', (e) => e.stopPropagation());

        // Apply filter action
        dropdown.querySelector('.filter-action-btn.apply').addEventListener('click', () => {
          const checkedCheckboxes = dropdown.querySelectorAll('.option-checkbox:checked');
          const allCheckboxes = dropdown.querySelectorAll('.option-checkbox');
          const currentActive = JSON.parse(table.dataset.activeFilters || '{}');

          if (checkedCheckboxes.length === allCheckboxes.length) {
            delete currentActive[colIdx];
            filterBtn.classList.remove('active');
            filterBtn.style.color = 'var(--text-muted)';
            filterBtn.innerHTML = '<i class="bi bi-funnel" style="font-size: 13px;"></i>';
          } else {
            const checkedVals = Array.from(checkedCheckboxes).map(cb => cb.value);
            currentActive[colIdx] = checkedVals;
            filterBtn.classList.add('active');
            filterBtn.style.color = 'var(--accent-cyan)';
            filterBtn.innerHTML = '<i class="bi bi-funnel-fill" style="font-size: 13px;"></i>';
          }

          table.dataset.activeFilters = JSON.stringify(currentActive);
          saveFilters(table, currentActive);
          applyAllFilters(table);
          dropdown.classList.remove('active');
        });

        // Clear filter action
        dropdown.querySelector('.filter-action-btn.clear').addEventListener('click', () => {
          const currentActive = JSON.parse(table.dataset.activeFilters || '{}');
          delete currentActive[colIdx];
          table.dataset.activeFilters = JSON.stringify(currentActive);
          saveFilters(table, currentActive);
          
          filterBtn.classList.remove('active');
          filterBtn.style.color = 'var(--text-muted)';
          filterBtn.innerHTML = '<i class="bi bi-funnel" style="font-size: 13px;"></i>';
          
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

      // Apply initial loaded filters
      applyAllFilters(table);
    });
  };

  // Helper to clear filters for a table explicitly
  window.clearTableFilters = function (tableId) {
    const table = document.getElementById(tableId);
    if (table) {
      table.dataset.activeFilters = JSON.stringify({});
      saveFilters(table, {});
      table.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.remove('active');
        btn.style.color = 'var(--text-muted)';
        btn.innerHTML = '<i class="bi bi-funnel" style="font-size: 13px;"></i>';
      });
      applyAllFilters(table);
    }
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
