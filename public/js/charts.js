// Chart.js initialization & table sort utilities

// ===== THEME COLORS HELPER =====
function getThemeColors() {
  const isLight = document.body.classList.contains('light-mode');
  const style = typeof window !== 'undefined' ? getComputedStyle(document.documentElement) : null;
  const primary = (style && style.getPropertyValue('--accent-primary').trim()) || (isLight ? '#c2410c' : '#f97316');
  const rgb = (style && style.getPropertyValue('--accent-rgb').trim()) || (isLight ? '194, 65, 12' : '249, 115, 22');
  return {
    isLight,
    primary,
    rgb,
    text: isLight ? '#5a524e' : '#94a3b8',
    title: isLight ? '#2d2724' : '#f1f5f9',
    grid: isLight ? 'rgba(45, 39, 36, 0.05)' : 'rgba(255, 255, 255, 0.04)',
    bgCard: isLight ? '#ffffff' : '#1b1b24',
    border: isLight ? '#e6ded4' : '#292938'
  };
}

// ===== TABLE SORT =====
function cleanNumber(val) {
  if (!val || val === '-' || val.trim() === '') return NaN;
  let s = val.trim();
  if (s.endsWith('%')) {
    s = s.slice(0, -1).trim();
  }
  if (/[a-zA-Z]/g.test(s)) {
    return NaN;
  }
  if (s.replace(/[^0-9]/g, '').length >= 15) {
    return NaN;
  }
  let normalized = s;
  if (normalized.includes('.') && normalized.includes(',')) {
    if (normalized.indexOf('.') < normalized.indexOf(',')) {
      normalized = normalized.replace(/\./g, '').replace(/,/g, '.');
    } else {
      normalized = normalized.replace(/,/g, '');
    }
  } else if (normalized.includes(',')) {
    const parts = normalized.split(',');
    if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) {
      normalized = normalized.replace(/,/g, '');
    } else {
      normalized = normalized.replace(/,/g, '.');
    }
  } else if (normalized.includes('.')) {
    const parts = normalized.split('.');
    if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) {
      normalized = normalized.replace(/\./g, '');
    }
  }
  const parsed = parseFloat(normalized);
  return isNaN(parsed) ? NaN : parsed;
}

function makeTableSortable(tableId) {
  const table = document.getElementById(tableId);
  if (!table) return;
  const headers = Array.from(table.querySelectorAll('thead th'));
  let sortCol = -1, sortDir = 1;

  const headerToColumnIndex = new Map();
  
  table.querySelectorAll('thead').forEach((thead) => {
    const occupied = [];
    Array.from(thead.querySelectorAll('tr')).forEach((row, rowIndex) => {
      let colIndex = 0;
      Array.from(row.cells).forEach((cell) => {
        while (occupied[colIndex] && occupied[colIndex] > rowIndex) {
          colIndex += 1;
        }
        const colspan = parseInt(cell.getAttribute('colspan') || '1', 10);
        const rowspan = parseInt(cell.getAttribute('rowspan') || '1', 10);
        headerToColumnIndex.set(cell, colIndex);
        for (let offset = 0; offset < colspan; offset += 1) {
          if (rowspan > 1) {
            occupied[colIndex + offset] = rowIndex + rowspan;
          }
        }
        colIndex += colspan;
      });
    });
  });

  headers.forEach((th) => {
    const colSpan = th.getAttribute('colspan');
    if (colSpan && parseInt(colSpan, 10) > 1) {
      return;
    }

    th.classList.add('sortable');
    th.setAttribute('tabindex', '0');
    th.setAttribute('aria-sort', 'none');

    const customIdx = th.getAttribute('data-column-idx');
    const actualColIdx = customIdx ? parseInt(customIdx, 10) : headerToColumnIndex.get(th);
    const getCellValue = (row) => {
      const cell = row.cells[actualColIdx];
      return cell?.dataset.sort ?? cell?.textContent.trim() ?? '';
    };

    const performSort = () => {
      if (sortCol === actualColIdx) {
        sortDir *= -1;
      } else {
        sortDir = 1;
        sortCol = actualColIdx;
      }

      headers.forEach((h) => {
        h.classList.remove('sort-asc', 'sort-desc');
        if (h.classList.contains('sortable')) {
          h.setAttribute('aria-sort', 'none');
        }
      });
      th.classList.add(sortDir === 1 ? 'sort-asc' : 'sort-desc');
      th.setAttribute('aria-sort', sortDir === 1 ? 'ascending' : 'descending');

      table.querySelectorAll('tbody').forEach((tbody) => {
        const rows = Array.from(tbody.querySelectorAll('tr'));
        rows.sort((a, b) => {
          const aVal = getCellValue(a);
          const bVal = getCellValue(b);
          const aNum = cleanNumber(aVal);
          const bNum = cleanNumber(bVal);
          const aIsNum = !Number.isNaN(aNum);
          const bIsNum = !Number.isNaN(bNum);

          if (aIsNum && bIsNum) {
            return (aNum - bNum) * sortDir;
          }
          if (aIsNum) {
            return -1;
          }
          if (bIsNum) {
            return 1;
          }
          return aVal.localeCompare(bVal, 'id', { numeric: true, sensitivity: 'base' }) * sortDir;
        });
        rows.forEach((r) => tbody.appendChild(r));
      });
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
    const q = input.value.trim();
    table.querySelectorAll('tbody tr').forEach(row => {
      row.style.display = fuzzyMatch(row.textContent, q, 0.5) ? '' : 'none';
    });
  });
}

// ===== LIST SEARCH =====
function makeListSearchable(inputId, listContainerId, itemSelector) {
  const input = document.getElementById(inputId);
  const container = document.getElementById(listContainerId);
  if (!input || !container) return;
  input.addEventListener('input', () => {
    const q = input.value.trim();
    container.querySelectorAll(itemSelector).forEach(item => {
      item.style.display = fuzzyMatch(item.textContent, q, 0.5) ? '' : 'none';
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
function createDonutChart(canvasId, done, total, color = null) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  const theme = getThemeColors();
  const primaryColor = color || theme.primary;
  const remaining = total - done;
  const chart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      datasets: [{
        data: [done, remaining],
        backgroundColor: [primaryColor, theme.isLight ? 'rgba(45, 39, 36, 0.04)' : 'rgba(255, 255, 255, 0.05)'],
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
          backgroundColor: `rgba(${theme.rgb}, 0.85)`,
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

// ===== TOOLTIP WEATHER HELPERS =====
function getWeatherTooltipFooter(trenData, index) {
  const d = trenData[index];
  if (d && d.weather_temp !== undefined && d.weather_temp !== null) {
    let desc = '';
    switch (d.weather_code) {
      case 0: desc = 'Cerah'; break;
      case 1:
      case 2: desc = 'Cerah Berawan'; break;
      case 3: desc = 'Berawan'; break;
      case 45:
      case 48: desc = 'Kabut'; break;
      case 51:
      case 53:
      case 55:
      case 56:
      case 57: desc = 'Gerimis'; break;
      case 61:
      case 63: desc = 'Hujan Ringan'; break;
      case 65:
      case 80:
      case 81:
      case 82: desc = 'Hujan'; break;
      case 95:
      case 96:
      case 99: desc = 'Hujan Badai'; break;
      default: desc = 'Cerah Berawan';
    }
    return `Cuaca: ${desc} (${Math.round(d.weather_temp)}°C, RH: ${d.weather_humidity}%)`;
  }
  return '';
}

// ===== LINE CHART (Tren) =====
function createTrenChart(canvasId, trenData) {
  const ctx = document.getElementById(canvasId);
  if (!ctx || !trenData || !trenData.length) return;

  // Destroy existing chart instance to prevent canvas reuse issue
  if (typeof Chart !== 'undefined') {
    const existingChart = Chart.getChart(canvasId);
    if (existingChart) {
      existingChart.destroy();
    }
  }

  const theme = getThemeColors();
  const labels = trenData.map(d => d.tanggal);
  const dataUsaha = trenData.map(d => d.usaha_total);
  const dataKeluarga = trenData.map(d => d.keluarga_total || 0);

  const context = ctx.getContext('2d');
  const getGradient = (r, g, b) => {
    const gradient = context.createLinearGradient(0, 0, 0, 200);
    gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.22)`);
    gradient.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, 0.04)`);
    gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
    return gradient;
  };

  const chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Total Usaha',
          data: dataUsaha,
          borderColor: '#10b981',
          borderWidth: 2.5,
          pointBackgroundColor: '#ffffff',
          pointBorderColor: '#10b981',
          pointBorderWidth: 1.5,
          pointRadius: 3,
          pointHoverRadius: 5,
          tension: 0.4,
          fill: true,
          backgroundColor: getGradient(16, 185, 129)
        },
        {
          label: 'Total Keluarga',
          data: dataKeluarga,
          borderColor: '#7c3aed',
          borderWidth: 2.5,
          pointBackgroundColor: '#ffffff',
          pointBorderColor: '#7c3aed',
          pointBorderWidth: 1.5,
          pointRadius: 3,
          pointHoverRadius: 5,
          tension: 0.4,
          fill: true,
          backgroundColor: getGradient(124, 58, 237)
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: theme.text, font: { size: 11, family: 'Inter' } } },
        tooltip: {
          backgroundColor: theme.isLight ? '#0f172a' : '#1e293b',
          titleColor: '#ffffff',
          bodyColor: '#ffffff',
          borderColor: '#8b5cf6',
          borderWidth: 1.5,
          mode: 'index',
          intersect: false,
          callbacks: {
            footer: (tooltipItems) => {
              const index = tooltipItems[0].dataIndex;
              return getWeatherTooltipFooter(trenData, index);
            }
          }
        }
      },
      scales: {
        x: {
          grid: { display: false, drawBorder: false },
          ticks: { color: theme.text, font: { family: 'Inter, sans-serif', size: 9, weight: '500' } }
        },
        y: {
          grid: { color: theme.isLight ? 'rgba(0, 0, 0, 0.04)' : 'rgba(255, 255, 255, 0.05)', drawBorder: false },
          ticks: { color: theme.text, font: { family: 'Inter, sans-serif', size: 9 } },
          title: { display: true, text: 'Jumlah', color: theme.text, font: { size: 10 } }
        }
      }
    },
    plugins: [{
      id: "trenUsahaKeluargaShadowPlugin",
      beforeDraw(chartInstance) {
        let ctx = chartInstance.ctx;
        let stroke = ctx.stroke;
        ctx.stroke = function() {
          ctx.save();
          if (this.strokeStyle === "#10b981") {
            ctx.shadowColor = "rgba(16, 185, 129, 0.35)";
            ctx.shadowBlur = 8;
            ctx.shadowOffsetY = 2;
          } else if (this.strokeStyle === "#7c3aed") {
            ctx.shadowColor = "rgba(124, 58, 237, 0.35)";
            ctx.shadowBlur = 8;
            ctx.shadowOffsetY = 2;
          }
          stroke.apply(this, arguments);
          ctx.restore();
        }
      },
      afterDraw(chartInstance) {
        chartInstance.ctx.restore();
      }
    }]
  });
  window.activeCharts = window.activeCharts || [];
  window.activeCharts.push(chart);
  return chart;
}


// ===== LINE CHART (Fasih Tren) =====
function createFasihTrenChart(canvasId, trenData) {
  const ctx = document.getElementById(canvasId);
  if (!ctx || !trenData || !trenData.length) return;

  // Destroy existing chart instance to prevent canvas reuse issue
  if (typeof Chart !== 'undefined') {
    const existingChart = Chart.getChart(canvasId);
    if (existingChart) {
      existingChart.destroy();
    }
  }

  const theme = getThemeColors();
  const labels = trenData.map(d => d.tanggal);
  const dataOpen = trenData.map(d => d.open_total !== undefined ? d.open_total : Math.max(0, (d.target_fasih_total || 0) - ((d.draft_total || 0) + (d.submitted_total || 0) + (d.approved_total || 0) + (d.rejected_total || 0))));
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
          label: 'Open',
          data: dataOpen,
          borderColor: '#94a3b8',
          backgroundColor: 'rgba(148, 163, 184, 0.04)',
          tension: 0.4,
          pointRadius: 3.5,
          pointHoverRadius: 5.5,
          pointBackgroundColor: '#94a3b8'
        },
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
          callbacks: {
            footer: (tooltipItems) => {
              const index = tooltipItems[0].dataIndex;
              return getWeatherTooltipFooter(trenData, index);
            }
          }
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


// ===== PROGRESS BAR ANIMATION =====
window.initProgressBars = function(container = document) {
  container.querySelectorAll('.progress-bar[data-width]').forEach(bar => {
    const targetWidth = Math.min(100, parseFloat(bar.dataset.width) || 0);
    setTimeout(() => { bar.style.width = targetWidth + '%'; }, 100);
  });
};

// ===== KECAMATAN FASIH BAR CHART =====
function createKecFasihBarChart(canvasId, labels, dataSelesai, dataTotal, title = '') {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  const theme = getThemeColors();
  const chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Selesai FASIH',
          data: dataSelesai,
          backgroundColor: 'rgba(124, 58, 237, 0.8)',
          borderRadius: 6,
          borderSkipped: false,
        },
        {
          label: 'Belum',
          data: dataTotal.map((t, i) => Math.max(0, t - dataSelesai[i])),
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

// ===== DAILY INCREMENT BAR CHART =====
function createDailyBarChart(canvasId, labels, data, title = '', color = '#7c3aed') {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  const theme = getThemeColors();
  const chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Penambahan Dokumen',
          data: data,
          backgroundColor: color,
          borderRadius: 6,
          borderSkipped: false,
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        title: { display: !!title, text: title, color: theme.title, font: { size: 13, weight: '700' } },
        tooltip: {
          backgroundColor: theme.bgCard,
          borderColor: theme.border,
          borderWidth: 1,
          titleColor: theme.title,
          bodyColor: theme.text,
          callbacks: {
            label: ctx => ` Penambahan: ${ctx.parsed.y.toLocaleString('id-ID')} dokumen`
          }
        }
      },
      scales: {
        x: {
          ticks: { color: theme.text, font: { size: 11 } },
          grid: { color: theme.grid }
        },
        y: {
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

// ===== DAILY INCREMENT BAR CHART =====
function createDailyIncrementBarChart(canvasId, labels, data, targetNormalVal, targetAktualVal, rawTrenData = []) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  const theme = getThemeColors();
  const chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Penambahan Riil',
          data: data,
          backgroundColor: 'rgba(16, 185, 129, 0.8)',
          borderColor: '#10b981',
          borderWidth: 1,
          borderRadius: 4
        },
        {
          type: 'line',
          label: 'Target Normal',
          data: Array(labels.length).fill(targetNormalVal),
          borderColor: '#60a5fa',
          borderWidth: 1.5,
          borderDash: [5, 5],
          pointRadius: 0,
          fill: false,
          tension: 0
        },
        {
          type: 'line',
          label: 'Target Aktual',
          data: Array(labels.length).fill(targetAktualVal),
          borderColor: '#8b5cf6',
          borderWidth: 1.5,
          borderDash: [5, 5],
          pointRadius: 0,
          fill: false,
          tension: 0
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: { color: theme.text, font: { size: 10, family: 'Inter' } }
        },
        tooltip: {
          backgroundColor: theme.bgCard,
          borderColor: theme.border,
          borderWidth: 1,
          titleColor: theme.title,
          bodyColor: theme.text,
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${Math.round(ctx.parsed.y).toLocaleString('id-ID')} dok/hari`,
            footer: (tooltipItems) => {
              if (!rawTrenData || !rawTrenData.length) return '';
              const index = tooltipItems[0].dataIndex;
              return getWeatherTooltipFooter(rawTrenData, index);
            }
          }
        }
      },
      scales: {
        x: {
          ticks: { color: theme.text, font: { size: 10 } },
          grid: { color: theme.grid }
        },
        y: {
          ticks: { color: theme.text, font: { size: 10 } },
          grid: { color: theme.grid }
        }
      }
    }
  });
  window.activeCharts = window.activeCharts || [];
  window.activeCharts.push(chart);
  return chart;
}

// ===== DAILY INCREMENT STATUS BAR CHART =====
function createDailyFasihStatusChart(canvasId, labels, datasetsData, title = '', rawTrenData = []) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  const theme = getThemeColors();
  const datasets = [];
  if (datasetsData.open && datasetsData.open.length) {
    datasets.push({
      label: 'Open',
      data: datasetsData.open,
      backgroundColor: '#94a3b8',
      borderRadius: 4,
    });
  }
  datasets.push(
    {
      label: 'Draft',
      data: datasetsData.draft,
      backgroundColor: '#eab308',
      borderRadius: 4,
    },
    {
      label: 'Submitted',
      data: datasetsData.submitted,
      backgroundColor: '#3b82f6',
      borderRadius: 4,
    },
    {
      label: 'Approved',
      data: datasetsData.approved,
      backgroundColor: '#10b981',
      borderRadius: 4,
    },
    {
      label: 'Rejected',
      data: datasetsData.rejected,
      backgroundColor: '#ef4444',
      borderRadius: 4,
    }
  );

  const chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: { color: theme.text, font: { size: 11, family: 'Inter' } }
        },
        title: { display: !!title, text: title, color: theme.title, font: { size: 13, weight: '700' } },
        tooltip: {
          backgroundColor: theme.isLight ? '#0f172a' : '#1e293b',
          borderColor: theme.border,
          borderWidth: 1.5,
          titleColor: '#ffffff',
          bodyColor: '#ffffff',
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: +${ctx.parsed.y.toLocaleString('id-ID')} dokumen`,
            footer: (tooltipItems) => {
              if (!rawTrenData || !rawTrenData.length) return '';
              const index = tooltipItems[0].dataIndex;
              return getWeatherTooltipFooter(rawTrenData, index);
            }
          }
        }
      },
      scales: {
        x: {
          stacked: true,
          grid: { display: false, drawBorder: false },
          ticks: { color: theme.text, font: { family: 'Inter, sans-serif', size: 9, weight: '500' } }
        },
        y: {
          stacked: true,
          grid: { color: theme.isLight ? 'rgba(0, 0, 0, 0.04)' : 'rgba(255, 255, 255, 0.05)', drawBorder: false },
          ticks: { color: theme.text, font: { family: 'Inter, sans-serif', size: 9 } }
        }
      }
    }
  });
  window.activeCharts = window.activeCharts || [];
  window.activeCharts.push(chart);
  return chart;
}

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
    if (chart.config.type === 'doughnut' && (!chart.canvas || !chart.canvas.id.includes('speedometer'))) {
      const remainingColor = theme.isLight ? 'rgba(45, 39, 36, 0.04)' : 'rgba(255, 255, 255, 0.05)';
      if (chart.data.datasets[0] && Array.isArray(chart.data.datasets[0].backgroundColor) && chart.data.datasets[0].backgroundColor.length === 2) {
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

// ===== LINE CHART (PCL History) =====
function createPclHistoryChart(canvasId, historyData) {
  const ctx = document.getElementById(canvasId);
  if (!ctx || !historyData || !historyData.length) return null;

  const theme = getThemeColors();
  const labels = historyData.map(d => d.tanggal);
  const dataOpen = historyData.map(d => d.open_total !== undefined ? d.open_total : Math.max(0, (d.target_fasih_total || 0) - ((d.draft_total || 0) + (d.submitted_total || 0) + (d.approved_total || 0) + (d.rejected_total || 0))));
  const dataDraft = historyData.map(d => d.draft_total || 0);
  const dataSubmitted = historyData.map(d => d.submitted_total || 0);
  const dataApproved = historyData.map(d => d.approved_total || 0);
  const dataRejected = historyData.map(d => d.rejected_total || 0);
  const dataProgres = historyData.map(d => d.selesai_total || 0);
  const dataTarget = historyData.map(d => d.target_fasih_total || 0);

  const chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Progres (Sub+App+Rej)',
          data: dataProgres,
          borderColor: '#06b6d4',
          backgroundColor: 'rgba(6, 182, 212, 0.08)',
          fill: true,
          tension: 0.3,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor: '#06b6d4'
        },
        {
          label: 'Approved',
          data: dataApproved,
          borderColor: '#10b981',
          backgroundColor: 'rgba(16, 185, 129, 0.04)',
          tension: 0.3,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor: '#10b981'
        },
        {
          label: 'Submitted',
          data: dataSubmitted,
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59, 130, 246, 0.04)',
          tension: 0.3,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor: '#3b82f6'
        },
        {
          label: 'Rejected',
          data: dataRejected,
          borderColor: '#ef4444',
          backgroundColor: 'rgba(239, 68, 68, 0.04)',
          tension: 0.3,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor: '#ef4444'
        },
        {
          label: 'Draft',
          data: dataDraft,
          borderColor: '#eab308',
          backgroundColor: 'rgba(234, 179, 8, 0.04)',
          tension: 0.3,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor: '#eab308'
        },
        {
          label: 'Open',
          data: dataOpen,
          borderColor: '#94a3b8',
          backgroundColor: 'rgba(148, 163, 184, 0.04)',
          tension: 0.3,
          pointRadius: 3.5,
          pointHoverRadius: 5.5,
          pointBackgroundColor: '#94a3b8'
        },
        // {
        //   label: 'Target FASIH',
        //   data: dataTarget,
        //   borderColor: '#a855f7',
        //   borderDash: [5, 5],
        //   pointRadius: 0,
        //   fill: false,
        //   tension: 0
        // }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: theme.text, font: { size: 10, family: 'Inter' } } },
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
        x: { ticks: { color: theme.text, font: { size: 9 } }, grid: { color: theme.grid } },
        y: {
          ticks: { color: theme.text, font: { size: 9 } },
          grid: { color: theme.grid },
          title: { display: true, text: 'Dokumen', color: theme.text, font: { size: 9 } }
        }
      }
    }
  });
  window.activeCharts = window.activeCharts || [];
  window.activeCharts.push(chart);
  return chart;
}

// ===== TABLE PAGINATION & SEARCH & SORT CONTROLLER =====
function makeTablePaginated(tableId, inputId, pageSize = 50) {
  const table = document.getElementById(tableId);
  const input = document.getElementById(inputId);
  if (!table) return;

  const tbody = table.querySelector('tbody');
  if (!tbody) return;

  let currentPage = 1;
  let searchQuery = '';

  // Create pagination controls container
  let controlsId = tableId + '-pagination-controls';
  let controls = document.getElementById(controlsId);
  if (!controls) {
    controls = document.createElement('div');
    controls.id = controlsId;
    controls.className = 'pagination-controls';
    controls.style.cssText = 'display: flex; align-items: center; justify-content: space-between; margin-top: 16px; font-size: 13px; color: var(--text-secondary); padding: 8px 12px; background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 8px;';
    const tableWrap = table.closest('.table-wrap') || table;
    tableWrap.after(controls);
  }

  function update() {
    const allRows = Array.from(tbody.querySelectorAll('tr'));
    
    // 1. Filter rows by search query
    const filteredRows = allRows.filter(row => {
      const match = searchQuery ? fuzzyMatch(row.textContent, searchQuery, 0.5) : true;
      if (!match) {
        row.style.display = 'none';
      }
      return match;
    });

    const totalRows = filteredRows.length;
    const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));

    if (currentPage > totalPages) {
      currentPage = totalPages;
    }

    const isExpanded = card && card.classList.contains('card-expanded');
    const startIndex = (currentPage - 1) * pageSize;
    const endIndex = Math.min(startIndex + pageSize, totalRows);

    // 2. Hide/Show rows based on page bounds or Expanded Infinite Scroll Mode
    if (isExpanded) {
      filteredRows.forEach(row => {
        row.style.display = '';
      });
      if (controls) controls.style.display = 'none';
      return;
    }

    if (controls) controls.style.display = 'flex';

    filteredRows.forEach((row, idx) => {
      if (idx >= startIndex && idx < endIndex) {
        row.style.display = '';
      } else {
        row.style.display = 'none';
      }
    });

    // 3. Render pagination controls
    controls.innerHTML = `
      <div>
        Menampilkan <strong>${totalRows > 0 ? startIndex + 1 : 0}</strong> - <strong>${endIndex}</strong> dari <strong>${totalRows}</strong> baris
      </div>
      <div style="display: flex; gap: 8px;">
        <button class="btn btn-secondary btn-xs" id="${tableId}-prev-btn" ${currentPage === 1 ? 'disabled style="opacity: 0.5; cursor: not-allowed;"' : ''}><i class="bi bi-chevron-left"></i> Prev</button>
        <button class="btn btn-secondary btn-xs" id="${tableId}-next-btn" ${currentPage === totalPages ? 'disabled style="opacity: 0.5; cursor: not-allowed;"' : ''}>Next <i class="bi bi-chevron-right"></i></button>
      </div>
    `;

    // 4. Attach event listeners to pagination buttons
    const prevBtn = document.getElementById(`${tableId}-prev-btn`);
    const nextBtn = document.getElementById(`${tableId}-next-btn`);

    if (prevBtn && currentPage > 1) {
      prevBtn.addEventListener('click', () => {
        currentPage -= 1;
        update();
      });
    }
    if (nextBtn && currentPage < totalPages) {
      nextBtn.addEventListener('click', () => {
        currentPage += 1;
        update();
      });
    }
  }

  // Bind search input (cloning to clean any old listeners)
  if (input) {
    const newInput = input.cloneNode(true);
    input.parentNode.replaceChild(newInput, input);
    
    newInput.addEventListener('input', () => {
      searchQuery = newInput.value.trim();
      currentPage = 1;
      update();
    });
    
    // Auto-focus search input back
    newInput.focus();
  }

  // Intercept sorting to update pagination after sort
  const headers = Array.from(table.querySelectorAll('thead th'));
  headers.forEach(th => {
    th.addEventListener('click', () => {
      setTimeout(() => {
        currentPage = 1;
        update();
      }, 10);
    });
    th.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        setTimeout(() => {
          currentPage = 1;
          update();
        }, 10);
      }
    });
  });

  // Initial update
  update();
}

// ===== INTRADAY LINE CHART (TREN PENAMBAHAN INTRA-DAY SESI UPLOAD) =====
function createIntradayLineChart(canvasId, intradayData) {
  const ctx = document.getElementById(canvasId);
  if (!ctx || !intradayData || !intradayData.sessions || !intradayData.sessions.length) return null;

  const theme = getThemeColors();
  const labels = intradayData.sessions.map(s => `${s.time} WIB (#${s.upload_id})`);
  const dataDelta = intradayData.sessions.map(s => s.delta);
  const dataTotal = intradayData.sessions.map(s => s.selesai_total);

  if (typeof Chart !== 'undefined') {
    const existing = Chart.getChart(canvasId);
    if (existing) existing.destroy();
  }

  const chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Penambahan Dokumen (Delta Sesi)',
          data: dataDelta,
          borderColor: '#06b6d4',
          backgroundColor: 'rgba(6, 182, 212, 0.12)',
          fill: true,
          tension: 0.35,
          pointRadius: 5,
          pointHoverRadius: 7,
          pointBackgroundColor: '#06b6d4',
          pointBorderColor: '#ffffff',
          pointBorderWidth: 2,
          yAxisID: 'yDelta'
        },
        {
          label: 'Total Akumulasi Terdata',
          data: dataTotal,
          borderColor: '#10b981',
          backgroundColor: 'rgba(16, 185, 129, 0.05)',
          fill: false,
          borderDash: [4, 4],
          tension: 0.35,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor: '#10b981',
          yAxisID: 'yTotal'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: theme.text, font: { size: 11, family: 'Inter' } } },
        title: {
          display: true,
          text: `Tren Penambahan Intra-Day (${intradayData.session_count} Sesi Upload) - Tanggal ${intradayData.tanggal}`,
          color: theme.title,
          font: { size: 13, weight: '700' }
        },
        tooltip: {
          backgroundColor: theme.bgCard,
          borderColor: theme.border,
          borderWidth: 1,
          titleColor: theme.title,
          bodyColor: theme.text,
          callbacks: {
            label: (ctxItem) => {
              const s = intradayData.sessions[ctxItem.dataIndex];
              if (!s) return null;
              if (ctxItem.datasetIndex === 0) {
                return ` ➕ Penambahan Sesi: +${s.delta.toLocaleString('id-ID')} dokumen`;
              } else {
                return ` 📊 Total Akumulasi: ${s.selesai_total.toLocaleString('id-ID')} dokumen`;
              }
            },
            footer: (tooltipItems) => {
              const idx = tooltipItems[0].dataIndex;
              const s = intradayData.sessions[idx];
              return `Submit: ${s.submitted_total.toLocaleString('id-ID')} | Approve: ${s.approved_total.toLocaleString('id-ID')} | Reject: ${s.rejected_total.toLocaleString('id-ID')} | Draft: ${s.draft_total.toLocaleString('id-ID')}`;
            }
          }
        }
      },
      scales: {
        x: { ticks: { color: theme.text, font: { size: 10 } }, grid: { color: theme.grid } },
        yDelta: {
          type: 'linear',
          position: 'left',
          ticks: { color: theme.text, font: { size: 10 } },
          grid: { color: theme.grid },
          title: { display: true, text: 'Penambahan (Delta)', color: theme.text, font: { size: 9 } }
        },
        yTotal: {
          type: 'linear',
          position: 'right',
          ticks: { color: theme.text, font: { size: 10 } },
          grid: { display: false },
          title: { display: true, text: 'Total Akumulasi', color: theme.text, font: { size: 9 } }
        }
      }
    }
  });

  window.activeCharts = window.activeCharts || [];
  window.activeCharts.push(chart);
  return chart;
}

function createIntradayCandlestickChart(canvasId, intradayData) {
  return createIntradayLineChart(canvasId, intradayData);
}

// ===== SPEEDOMETER GAUGE CHART (PREMIUM DESIGN) =====
// ===== SPEEDOMETER GAUGE CHART (PREMIUM DESIGN) =====
function createSpeedometerChart(canvasId, currentSpeedPerPcl, targetSpeedPerPcl = null, currentSpeedTotal = null, targetSpeedTotal = null) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;

  const existingChart = Chart.getChart(ctx);
  if (existingChart) {
    existingChart.destroy();
  }

  const isSurvey = (typeof window !== 'undefined' && window.activeSurveyId && window.activeSurveyId !== 'se2026');
  const defaultTarget = isSurvey ? 2 : 13;
  const baseMax = isSurvey ? 10 : 20;

  const val = Math.max(0, parseFloat(currentSpeedPerPcl) || 0);
  const targetVal = (targetSpeedPerPcl !== null && targetSpeedPerPcl !== undefined && !isNaN(parseFloat(targetSpeedPerPcl))) 
    ? Math.max(0.01, parseFloat(targetSpeedPerPcl)) 
    : defaultTarget;
  
  // Batas atas grafik: 10 untuk survei (Sakernas, dll.), 20 untuk sensus (SE2026)
  const maxVal = Math.max(baseMax, Math.ceil(targetVal * 1.25), Math.ceil(val * 1.2));

  const z1End = targetVal * 0.6;
  const z2End = targetVal;

  const z1Val = z1End;
  const z2Val = Math.max(0, z2End - z1End);
  const z3Val = Math.max(0, maxVal - z2End);

  // Helper format desimal angka target yang rapi (tanpa trailing .0)
  const formatTargetNum = (num) => {
    if (!Number.isFinite(num)) return '0';
    if (num % 1 === 0) return num.toFixed(0);
    if (num < 1) return parseFloat(num.toFixed(2)).toString();
    return parseFloat(num.toFixed(1)).toString();
  };

  const targetFormatted = formatTargetNum(targetVal);
  const z1EndFormatted = formatTargetNum(z1End);
  const z2EndFormatted = formatTargetNum(z2End);
  const officerUnit = (typeof window !== 'undefined' && window.activeSurveyId && window.activeSurveyId.startsWith('sakernas')) ? 'PPL' : 'PCL';

  const theme = getThemeColors();

  // Create smooth gradients for gauge arcs
  const c2d = ctx.getContext('2d');
  
  const gradRed = c2d.createLinearGradient(0, 0, 160, 0);
  gradRed.addColorStop(0, '#dc2626');
  gradRed.addColorStop(1, '#ef4444');

  const gradYellow = c2d.createLinearGradient(0, 0, 260, 0);
  gradYellow.addColorStop(0, '#f59e0b');
  gradYellow.addColorStop(1, '#fbbf24');

  const gradGreen = c2d.createLinearGradient(0, 0, 360, 0);
  gradGreen.addColorStop(0, '#10b981');
  gradGreen.addColorStop(1, '#34d399');

  const speedometerPlugin = {
    id: `speedometerNeedlePlugin_${canvasId}`,
    afterDatasetDraw(chart) {
      const { ctx: chartCtx } = chart;
      const meta = chart.getDatasetMeta(0);
      if (!meta || !meta.data || !meta.data[0]) return;
      const arc0 = meta.data[0];
      const cx = arc0.x;
      const cy = arc0.y;
      const outerRadius = Math.max(0, parseFloat(arc0.outerRadius) || 0);
      const innerRadius = Math.max(0, parseFloat(arc0.innerRadius) || 0);

      if (!Number.isFinite(cx) || !Number.isFinite(cy) || outerRadius <= 0 || innerRadius <= 0) return;

      const curTheme = getThemeColors();

      // Dynamic scale factors based on gauge radius for perfect crispness on mobile & desktop
      const valFontSize = Math.max(13, Math.min(22, Math.round(outerRadius * 0.26)));
      const unitFontSize = Math.max(9, Math.min(12, Math.round(outerRadius * 0.13)));
      const tagFontSize = Math.max(8, Math.min(11, Math.round(outerRadius * 0.12)));
      const tickFontSize = Math.max(8, Math.min(10, Math.round(outerRadius * 0.11)));
      const pivotRadius = Math.max(4, Math.min(8, Math.round(outerRadius * 0.08)));
      const needleWidth = Math.max(2, Math.min(4, Math.round(outerRadius * 0.04)));

      chartCtx.save();

      // 0. Instrument Track Ring lines
      const trackOuterRadius = Math.max(0, outerRadius + 2);
      const trackInnerRadius = Math.max(0, innerRadius - 2);

      if (trackOuterRadius > 0) {
        chartCtx.beginPath();
        chartCtx.arc(cx, cy, trackOuterRadius, Math.PI, 2 * Math.PI);
        chartCtx.lineWidth = 1.5;
        chartCtx.strokeStyle = curTheme.isLight ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.1)';
        chartCtx.stroke();
      }

      if (trackInnerRadius > 0) {
        chartCtx.beginPath();
        chartCtx.arc(cx, cy, trackInnerRadius, Math.PI, 2 * Math.PI);
        chartCtx.lineWidth = 1.5;
        chartCtx.strokeStyle = curTheme.isLight ? 'rgba(0, 0, 0, 0.05)' : 'rgba(255, 255, 255, 0.06)';
        chartCtx.stroke();
      }

      // 1. Target Line & Pin at targetVal with glow effect
      const targetPct = Math.min(Math.max(targetVal / maxVal, 0), 1.0);
      const targetAngle = Math.PI + targetPct * Math.PI;

      const targetInnerRadius = Math.max(0, innerRadius - 3);
      const tInnerX = cx + targetInnerRadius * Math.cos(targetAngle);
      const tInnerY = cy + targetInnerRadius * Math.sin(targetAngle);
      const tOuterX = cx + (outerRadius + 8) * Math.cos(targetAngle);
      const tOuterY = cy + (outerRadius + 8) * Math.sin(targetAngle);

      chartCtx.save();
      chartCtx.shadowColor = 'rgba(139, 92, 246, 0.6)';
      chartCtx.shadowBlur = 6;

      chartCtx.beginPath();
      chartCtx.moveTo(tInnerX, tInnerY);
      chartCtx.lineTo(tOuterX, tOuterY);
      chartCtx.lineWidth = Math.max(2, needleWidth);
      chartCtx.strokeStyle = '#8b5cf6';
      chartCtx.stroke();

      // Target pin dot
      chartCtx.fillStyle = '#8b5cf6';
      chartCtx.beginPath();
      chartCtx.arc(tOuterX, tOuterY, Math.max(3, pivotRadius * 0.6), 0, 2 * Math.PI);
      chartCtx.fill();
      chartCtx.restore();

      // Target label badge flag
      const tagX = cx + (outerRadius + Math.max(16, outerRadius * 0.22)) * Math.cos(targetAngle);
      const tagY = cy + (outerRadius + Math.max(16, outerRadius * 0.20)) * Math.sin(targetAngle);
      
      chartCtx.save();
      chartCtx.textAlign = 'center';
      chartCtx.textBaseline = 'middle';
      chartCtx.font = `bold ${tagFontSize}px Inter, sans-serif`;
      chartCtx.fillStyle = '#8b5cf6';
      chartCtx.fillText(`Target: ${targetFormatted}`, tagX, tagY);
      chartCtx.restore();

      // 2. Needle Pointer with drop shadow
      const valPct = Math.min(Math.max(val, 0) / maxVal, 1.0);
      const needleAngle = Math.PI + valPct * Math.PI;
      const needleLen = innerRadius * 0.82;

      const nx = cx + needleLen * Math.cos(needleAngle);
      const ny = cy + needleLen * Math.sin(needleAngle);

      chartCtx.save();
      chartCtx.shadowColor = curTheme.isLight ? 'rgba(0, 0, 0, 0.25)' : 'rgba(0, 0, 0, 0.6)';
      chartCtx.shadowBlur = 5;
      chartCtx.shadowOffsetY = 2;

      // Needle stroke
      chartCtx.beginPath();
      chartCtx.moveTo(cx, cy);
      chartCtx.lineTo(nx, ny);
      chartCtx.lineWidth = needleWidth;
      chartCtx.strokeStyle = curTheme.isLight ? '#0f172a' : '#f8fafc';
      chartCtx.lineCap = 'round';
      chartCtx.stroke();

      // Pivot outer circle
      chartCtx.beginPath();
      chartCtx.arc(cx, cy, pivotRadius, 0, 2 * Math.PI);
      chartCtx.fillStyle = curTheme.isLight ? '#0f172a' : '#ffffff';
      chartCtx.fill();
      chartCtx.lineWidth = 2;
      chartCtx.strokeStyle = '#8b5cf6';
      chartCtx.stroke();

      // Pivot inner dot
      chartCtx.beginPath();
      chartCtx.arc(cx, cy, Math.max(2, pivotRadius * 0.4), 0, 2 * Math.PI);
      chartCtx.fillStyle = '#8b5cf6';
      chartCtx.fill();
      chartCtx.restore();

      // 3. Scale Ticks (0, Target / Intermediate, Max)
      const ticks = [
        { v: 0, label: '0' },
        { v: targetVal, label: targetFormatted },
        { v: maxVal, label: `${maxVal}` }
      ];
      ticks.forEach(tk => {
        const pct = Math.min(1.0, Math.max(0, tk.v / maxVal));
        const ang = Math.PI + pct * Math.PI;
        const tx = cx + (outerRadius + Math.max(10, outerRadius * 0.13)) * Math.cos(ang);
        const ty = cy + (outerRadius + Math.max(10, outerRadius * 0.13)) * Math.sin(ang);
        chartCtx.fillStyle = curTheme.text;
        chartCtx.font = `600 ${tickFontSize}px Inter, sans-serif`;
        chartCtx.textAlign = 'center';
        chartCtx.textBaseline = 'middle';
        chartCtx.fillText(tk.label, tx, ty);
      });

      // 4. Center Digital Speed Display (Scaled gracefully)
      chartCtx.save();
      chartCtx.textAlign = 'center';
      chartCtx.textBaseline = 'top';

      // Value text
      chartCtx.fillStyle = curTheme.title;
      chartCtx.font = `800 ${valFontSize}px Inter, sans-serif`;
      const valY = cy + Math.max(4, Math.round(outerRadius * 0.08));
      chartCtx.fillText(val.toFixed(2), cx, valY);

      // Unit label
      chartCtx.fillStyle = curTheme.text;
      chartCtx.font = `600 ${unitFontSize}px Inter, sans-serif`;
      chartCtx.fillText(`dok / ${officerUnit} / hari`, cx, valY + valFontSize + 2);

      chartCtx.restore();
    }
  };

  const chart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: [
        `Lambat (< ${z1EndFormatted} dok/hari)`,
        `Perlu Akselerasi (${z1EndFormatted}-${z2EndFormatted} dok/hari)`,
        `Optimal (≥ ${z2EndFormatted} dok/hari)`
      ],
      datasets: [{
        data: [z1Val, z2Val, z3Val],
        backgroundColor: [
          gradRed,
          gradYellow,
          gradGreen
        ],
        borderWidth: 0,
        borderRadius: [
          { outerStart: 8, innerStart: 8, outerEnd: 0, innerEnd: 0 },
          0,
          { outerStart: 0, innerStart: 0, outerEnd: 8, innerEnd: 8 }
        ],
        spacing: 0,
        hoverOffset: 4
      }]
    },
    options: {
      rotation: -90,
      circumference: 180,
      cutout: '74%',
      responsive: true,
      maintainAspectRatio: false,
      layout: {
        padding: {
          top: 32,
          bottom: 50,
          left: 20,
          right: 20
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: theme.bgCard,
          borderColor: theme.border,
          borderWidth: 1,
          titleColor: theme.title,
          bodyColor: theme.text,
          callbacks: {
            label: function(context) {
              const label = context.label || '';
              return ` ${label}`;
            }
          }
        }
      },
      animation: {
        animateRotate: true,
        duration: 1000
      }
    },
    plugins: [speedometerPlugin]
  });

  window.activeCharts = window.activeCharts || [];
  window.activeCharts.push(chart);
  return chart;
}

// ===== SPORTS VEHICLE STYLE DAILY RATE LINE CHART =====
function createSportsDailyRateLineChart(canvasId, labels, data, targetVal = 13) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;

  const existingChart = Chart.getChart(ctx);
  if (existingChart) {
    existingChart.destroy();
  }

  const theme = getThemeColors();
  const c2d = ctx.getContext('2d');
  
  const officerUnit = (typeof window !== 'undefined' && window.activeSurveyId && window.activeSurveyId.startsWith('sakernas')) ? 'PPL' : 'PCL';
  const targetLabel = (targetVal % 1 === 0) ? targetVal.toFixed(0) : parseFloat(targetVal.toFixed(1)).toString();

  // Neon gradient for line fill (sports dashboard acceleration vibe)
  const gradFill = c2d.createLinearGradient(0, 0, 0, 140);
  gradFill.addColorStop(0, 'rgba(239, 68, 68, 0.35)'); // neon red
  gradFill.addColorStop(0.5, 'rgba(249, 115, 22, 0.15)'); // neon orange
  gradFill.addColorStop(1, 'rgba(249, 115, 22, 0)');

  const chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: `Laju Harian (dok/${officerUnit}/hari)`,
          data: data,
          borderColor: '#ff3344', // Tachometer redline neon red
          borderWidth: 2.5,
          pointBackgroundColor: '#ffffff',
          pointBorderColor: '#ff3344',
          pointBorderWidth: 1.5,
          pointRadius: 3,
          pointHoverRadius: 5,
          tension: 0.4, // aerodynamic curved line
          fill: true,
          backgroundColor: gradFill,
          shadowColor: 'rgba(255, 51, 68, 0.45)', // glowing sports car dash light
          shadowBlur: 8
        },
        {
          label: `Target Standar (${targetLabel} dok/${officerUnit}/hari)`,
          data: Array(labels.length).fill(targetVal),
          borderColor: '#10b981', // Neon green zone
          borderWidth: 1.5,
          borderDash: [4, 4],
          pointRadius: 0,
          fill: false,
          tension: 0
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          backgroundColor: theme.isLight ? '#0f172a' : '#1e293b',
          titleColor: '#ffffff',
          bodyColor: '#ffffff',
          borderColor: '#ff3344',
          borderWidth: 1.5,
          displayColors: false,
          callbacks: {
            label: function(context) {
              return ` ${context.parsed.y.toFixed(2)} dok/PCL/hari`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: {
            display: false,
            drawBorder: false
          },
          ticks: {
            color: theme.text,
            font: {
              family: 'Inter, sans-serif',
              size: 9,
              weight: '500'
            },
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 7
          }
        },
        y: {
          grid: {
            color: theme.isLight ? 'rgba(0, 0, 0, 0.04)' : 'rgba(255, 255, 255, 0.05)',
            drawBorder: false
          },
          ticks: {
            color: theme.text,
            font: {
              family: 'Inter, sans-serif',
              size: 9
            },
            stepSize: 5
          },
          min: 0
        }
      }
    },
    plugins: [{
      id: 'sportsShadowPlugin',
      beforeDraw(chart) {
        const { ctx } = chart;
        ctx.save();
        const originalStroke = ctx.stroke;
        ctx.stroke = function () {
          ctx.save();
          if (this.strokeStyle === '#ff3344') {
            ctx.shadowColor = 'rgba(255, 51, 68, 0.45)';
            ctx.shadowBlur = 8;
            ctx.shadowOffsetY = 2;
          }
          originalStroke.apply(this, arguments);
          ctx.restore();
        };
      },
      afterDraw(chart) {
        const { ctx } = chart;
        ctx.restore();
      }
    }]
  });

  window.activeCharts = window.activeCharts || [];
  window.activeCharts.push(chart);
  return chart;
}

