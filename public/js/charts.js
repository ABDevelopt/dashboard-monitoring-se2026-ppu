// Chart.js initialization & table sort utilities

// ===== THEME COLORS HELPER =====
function getThemeColors() {
  const isLight = document.body.classList.contains('light-mode');
  return {
    isLight,
    text: isLight ? '#5a524e' : '#94a3b8',
    title: isLight ? '#2d2724' : '#f1f5f9',
    grid: isLight ? 'rgba(45, 39, 36, 0.05)' : 'rgba(255, 255, 255, 0.04)',
    bgCard: isLight ? '#ffffff' : '#1b1b24',
    border: isLight ? '#e6ded4' : '#292938'
  };
}

// ===== TABLE SORT =====
function makeTableSortable(tableId) {
  const table = document.getElementById(tableId);
  if (!table) return;
  const headers = table.querySelectorAll('thead th');
  let sortCol = -1, sortDir = 1;

  headers.forEach((th, colIdx) => {
    // Skip super headers with colspan > 1
    const colSpan = th.getAttribute('colspan');
    if (colSpan && parseInt(colSpan) > 1) {
      return;
    }
    
    // Add sortable class to show icon cues
    th.classList.add('sortable');
    th.setAttribute('tabindex', '0');
    th.setAttribute('aria-sort', 'none');
    
    const performSort = () => {
      if (sortCol === colIdx) sortDir *= -1;
      else { sortDir = 1; sortCol = colIdx; }

      headers.forEach(h => {
        h.classList.remove('sort-asc', 'sort-desc');
        if (h.classList.contains('sortable')) {
          h.setAttribute('aria-sort', 'none');
        }
      });
      th.classList.add(sortDir === 1 ? 'sort-asc' : 'sort-desc');
      th.setAttribute('aria-sort', sortDir === 1 ? 'ascending' : 'descending');

      const tbody = table.querySelector('tbody');
      const rows = Array.from(tbody.querySelectorAll('tr'));
      rows.sort((a, b) => {
        const aVal = a.cells[colIdx]?.dataset.sort || a.cells[colIdx]?.textContent.trim() || '';
        const bVal = b.cells[colIdx]?.dataset.sort || b.cells[colIdx]?.textContent.trim() || '';
        const aNum = parseFloat(aVal.replace(/[^0-9.-]/g, ''));
        const bNum = parseFloat(bVal.replace(/[^0-9.-]/g, ''));
        if (!isNaN(aNum) && !isNaN(bNum)) return (aNum - bNum) * sortDir;
        return aVal.localeCompare(bVal, 'id') * sortDir;
      });
      rows.forEach(r => tbody.appendChild(r));
    };

    th.addEventListener('click', performSort);
    th.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        performSort();
      }
    });
  });
}

// ===== TABLE SEARCH =====
function makeTableSearchable(inputId, tableId) {
  const input = document.getElementById(inputId);
  const table = document.getElementById(tableId);
  if (!input || !table) return;
  input.addEventListener('input', () => {
    const q = input.value.toLowerCase();
    table.querySelectorAll('tbody tr').forEach(row => {
      row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
  });
}

// ===== LIST SEARCH =====
function makeListSearchable(inputId, listContainerId, itemSelector) {
  const input = document.getElementById(inputId);
  const container = document.getElementById(listContainerId);
  if (!input || !container) return;
  input.addEventListener('input', () => {
    const q = input.value.toLowerCase();
    container.querySelectorAll(itemSelector).forEach(item => {
      item.style.display = item.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
  });
}

// ===== FORMAT NUMBERS =====
function fmt(n) {
  if (n === null || n === undefined) return '-';
  return Number(n).toLocaleString('id-ID');
}

function pct(done, total) {
  if (!total) return 0;
  return ((done / total) * 100).toFixed(1);
}

// ===== DONUT CHART =====
function createDonutChart(canvasId, done, total, color = '#c2410c') {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  const theme = getThemeColors();
  const remaining = total - done;
  const chart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      datasets: [{
        data: [done, remaining],
        backgroundColor: [color, theme.isLight ? 'rgba(45, 39, 36, 0.04)' : 'rgba(255, 255, 255, 0.05)'],
        borderWidth: 0,
        hoverOffset: 4
      }]
    },
    options: {
      cutout: '80%',
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      animation: { animateRotate: true, duration: 1000 }
    }
  });
  window.activeCharts = window.activeCharts || [];
  window.activeCharts.push(chart);
  return chart;
}

// ===== BAR CHART =====
function createBarChart(canvasId, labels, dataSelesai, dataTotal, title = '') {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  const theme = getThemeColors();
  const chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Selesai',
          data: dataSelesai,
          backgroundColor: 'rgba(194, 65, 12, 0.8)',
          borderRadius: 6,
          borderSkipped: false,
        },
        {
          label: 'Belum',
          data: dataTotal.map((t, i) => t - dataSelesai[i]),
          backgroundColor: theme.isLight ? 'rgba(45, 39, 36, 0.05)' : 'rgba(255, 255, 255, 0.06)',
          borderRadius: 6,
          borderSkipped: false,
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: theme.text, font: { size: 11, family: 'Inter' } } },
        title: { display: !!title, text: title, color: theme.title, font: { size: 13, weight: '700' } },
        tooltip: {
          backgroundColor: theme.bgCard,
          borderColor: theme.border,
          borderWidth: 1,
          titleColor: theme.title,
          bodyColor: theme.text,
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y.toLocaleString('id-ID')}`
          }
        }
      },
      scales: {
        x: {
          stacked: true,
          ticks: { color: theme.text, font: { size: 11 } },
          grid: { color: theme.grid }
        },
        y: {
          stacked: true,
          ticks: { color: theme.text, font: { size: 11 } },
          grid: { color: theme.grid }
        }
      }
    }
  });
  window.activeCharts = window.activeCharts || [];
  window.activeCharts.push(chart);
  return chart;
}

// ===== LINE CHART (Tren) =====
function createTrenChart(canvasId, trenData) {
  const ctx = document.getElementById(canvasId);
  if (!ctx || !trenData || !trenData.length) return;

  const theme = getThemeColors();
  const labels = trenData.map(d => d.tanggal);
  const dataUsaha = trenData.map(d => d.usaha_total);
  const dataKeluarga = trenData.map(d => d.keluarga_total || 0);

  const chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Total Usaha',
          data: dataUsaha,
          borderColor: '#10b981',
          backgroundColor: 'rgba(16, 185, 129, 0.08)',
          fill: true,
          tension: 0.4,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor: '#10b981'
        },
        {
          label: 'Total Keluarga',
          data: dataKeluarga,
          borderColor: '#7c3aed',
          backgroundColor: 'rgba(124, 58, 237, 0.08)',
          fill: true,
          tension: 0.4,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor: '#7c3aed'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: theme.text, font: { size: 11, family: 'Inter' } } },
        tooltip: {
          backgroundColor: theme.bgCard,
          borderColor: theme.border,
          borderWidth: 1,
          titleColor: theme.title,
          bodyColor: theme.text,
          mode: 'index',
          intersect: false,
        }
      },
      scales: {
        x: { ticks: { color: theme.text, font: { size: 11 } }, grid: { color: theme.grid } },
        y: {
          ticks: { color: theme.text, font: { size: 11 } },
          grid: { color: theme.grid },
          title: { display: true, text: 'Jumlah', color: theme.text, font: { size: 10 } }
        }
      }
    }
  });
  window.activeCharts = window.activeCharts || [];
  window.activeCharts.push(chart);
  return chart;
}

// ===== LINE CHART (Fasih Tren) =====
function createFasihTrenChart(canvasId, trenData) {
  const ctx = document.getElementById(canvasId);
  if (!ctx || !trenData || !trenData.length) return;

  const theme = getThemeColors();
  const labels = trenData.map(d => d.tanggal);
  const dataDraft = trenData.map(d => d.draft_total || 0);
  const dataSubmitted = trenData.map(d => d.submitted_total || 0);
  const dataApproved = trenData.map(d => d.approved_total || 0);
  const dataRejected = trenData.map(d => d.rejected_total || 0);

  const chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Draft',
          data: dataDraft,
          borderColor: '#eab308',
          backgroundColor: 'rgba(234, 179, 8, 0.04)',
          tension: 0.4,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor: '#eab308'
        },
        {
          label: 'Submitted',
          data: dataSubmitted,
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59, 130, 246, 0.04)',
          tension: 0.4,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor: '#3b82f6'
        },
        {
          label: 'Approved',
          data: dataApproved,
          borderColor: '#10b981',
          backgroundColor: 'rgba(16, 185, 129, 0.04)',
          tension: 0.4,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor: '#10b981'
        },
        {
          label: 'Rejected',
          data: dataRejected,
          borderColor: '#ef4444',
          backgroundColor: 'rgba(239, 68, 68, 0.04)',
          tension: 0.4,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor: '#ef4444'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: theme.text, font: { size: 11, family: 'Inter' } } },
        tooltip: {
          backgroundColor: theme.bgCard,
          borderColor: theme.border,
          borderWidth: 1,
          titleColor: theme.title,
          bodyColor: theme.text,
          mode: 'index',
          intersect: false,
        }
      },
      scales: {
        x: { ticks: { color: theme.text, font: { size: 11 } }, grid: { color: theme.grid } },
        y: {
          ticks: { color: theme.text, font: { size: 11 } },
          grid: { color: theme.grid },
          title: { display: true, text: 'Jumlah Dokumen', color: theme.text, font: { size: 10 } }
        }
      }
    }
  });
  window.activeCharts = window.activeCharts || [];
  window.activeCharts.push(chart);
  return chart;
}

// ===== UPLOAD DRAG & DROP =====
function initUploadZone(zoneId, inputId) {
  const zone = document.getElementById(zoneId);
  const input = document.getElementById(inputId);
  if (!zone || !input) return;

  zone.setAttribute('role', 'button');
  zone.setAttribute('tabindex', '0');

  zone.addEventListener('click', () => input.click());
  zone.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      input.click();
    }
  });
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const files = e.dataTransfer.files;
    if (files[0]) {
      input.files = files;
      zone.querySelector('.upload-zone-sub').textContent = `${files[0].name} (${(files[0].size/1024/1024).toFixed(1)} MB)`;
    }
  });
  input.addEventListener('change', () => {
    if (input.files[0]) {
      zone.querySelector('.upload-zone-sub').textContent = `${input.files[0].name}`;
    }
  });
}

// ===== PROGRESS BAR ANIMATION =====
window.initProgressBars = function(container = document) {
  container.querySelectorAll('.progress-bar[data-width]').forEach(bar => {
    const targetWidth = Math.min(100, parseFloat(bar.dataset.width) || 0);
    setTimeout(() => { bar.style.width = targetWidth + '%'; }, 100);
  });
};

document.addEventListener('DOMContentLoaded', () => {
  window.initProgressBars();
});


// ===== THEME CHANGE EVENT LISTENER =====
window.activeCharts = window.activeCharts || [];
window.addEventListener('themechange', () => {
  const theme = getThemeColors();
  window.activeCharts.forEach(chart => {
    if (!chart || !chart.options) return;

    // Update generic options
    if (chart.options.plugins) {
      if (chart.options.plugins.legend && chart.options.plugins.legend.labels) {
        chart.options.plugins.legend.labels.color = theme.text;
      }
      if (chart.options.plugins.title) {
        chart.options.plugins.title.color = theme.title;
      }
      if (chart.options.plugins.tooltip) {
        chart.options.plugins.tooltip.backgroundColor = theme.bgCard;
        chart.options.plugins.tooltip.borderColor = theme.border;
        chart.options.plugins.tooltip.titleColor = theme.title;
        chart.options.plugins.tooltip.bodyColor = theme.text;
      }
    }

    // Update dataset styles based on type
    if (chart.config.type === 'doughnut') {
      const remainingColor = theme.isLight ? 'rgba(45, 39, 36, 0.04)' : 'rgba(255, 255, 255, 0.05)';
      if (chart.data.datasets[0] && chart.data.datasets[0].backgroundColor) {
        chart.data.datasets[0].backgroundColor[1] = remainingColor;
      }
    } else if (chart.config.type === 'bar') {
      const pendingColor = theme.isLight ? 'rgba(45, 39, 36, 0.05)' : 'rgba(255, 255, 255, 0.06)';
      if (chart.data.datasets[1]) {
        chart.data.datasets[1].backgroundColor = pendingColor;
      }
    }

    // Update scales
    if (chart.options.scales) {
      Object.keys(chart.options.scales).forEach(key => {
        const scale = chart.options.scales[key];
        if (scale.ticks) scale.ticks.color = theme.text;
        if (scale.grid) scale.grid.color = theme.grid;
        if (scale.title) scale.title.color = theme.text;
      });
    }

    chart.update();
  });
});
