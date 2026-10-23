/**
 * Taka UI — Charts Helper Library (Chart.js Integration)
 * Standalone visualization helper adapting to Taka UI Dark/Light modes & multi-theme accents.
 */

(function (global, factory) {
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    module.exports = factory();
  } else if (typeof define === 'function' && define.amd) {
    define(factory);
  } else {
    global.TakaCharts = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TakaCharts = {
    instances: new Map(),

    /**
     * Get computed theme colors from CSS variables
     */
    getThemeColors: function () {
      if (typeof window === 'undefined') {
        return {
          isLight: false,
          primary: '#f97316',
          rgb: '249, 115, 22',
          text: '#94a3b8',
          title: '#f1f5f9',
          grid: 'rgba(255, 255, 255, 0.05)',
          bgCard: '#1b1b24',
          border: '#292938'
        };
      }

      const isLight = document.body.classList.contains('light-mode');
      const style = getComputedStyle(document.documentElement);

      const primary = style.getPropertyValue('--accent-primary').trim() || (isLight ? '#c2410c' : '#f97316');
      const rgb = style.getPropertyValue('--accent-rgb').trim() || (isLight ? '194, 65, 12' : '249, 115, 22');

      return {
        isLight: isLight,
        primary: primary,
        rgb: rgb,
        text: isLight ? '#475569' : '#94a3b8',
        title: isLight ? '#0f172a' : '#f1f5f9',
        grid: isLight ? 'rgba(60, 51, 46, 0.06)' : 'rgba(255, 255, 255, 0.05)',
        bgCard: isLight ? '#fdfcfb' : '#1b1b24',
        border: isLight ? '#dfd5c6' : '#292938',
        green: isLight ? '#047857' : '#34d399',
        yellow: isLight ? '#b45309' : '#fbbf24',
        red: isLight ? '#b91c1c' : '#f87171',
        blue: isLight ? '#0284c7' : '#38bdf8',
        purple: isLight ? '#6d28d9' : '#a78bfa'
      };
    },

    /**
     * 1. Trend Line Chart (Progres Kumulatif Harian vs Garis Target)
     */
    createTrendChart: function (canvasId, options) {
      if (typeof Chart === 'undefined') {
        console.warn('[TakaCharts] Chart.js is required to render charts.');
        return null;
      }

      const ctx = typeof canvasId === 'string' ? document.getElementById(canvasId) : canvasId;
      if (!ctx) return null;

      if (this.instances.has(canvasId)) {
        this.instances.get(canvasId).destroy();
      }

      const theme = this.getThemeColors();
      const labels = options.labels || [];
      const dataRealisasi = options.realisasi || [];
      const dataTarget = options.target || [];
      const unit = options.unit || 'Dokumen';

      const datasets = [
        {
          label: 'Realisasi Kumulatif',
          data: dataRealisasi,
          borderColor: theme.primary,
          backgroundColor: `rgba(${theme.rgb}, 0.12)`,
          fill: true,
          tension: 0.35,
          borderWidth: 2.5,
          pointRadius: 3.5,
          pointHoverRadius: 6,
          pointBackgroundColor: theme.primary
        }
      ];

      if (dataTarget.length > 0) {
        datasets.push({
          label: 'Garis Target',
          data: dataTarget,
          borderColor: theme.yellow,
          borderDash: [5, 5],
          borderWidth: 2,
          fill: false,
          tension: 0,
          pointRadius: 0
        });
      }

      const chart = new Chart(ctx, {
        type: 'line',
        data: { labels: labels, datasets: datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              labels: { color: theme.text, font: { size: 11, family: 'Inter' } }
            },
            tooltip: {
              backgroundColor: theme.bgCard,
              borderColor: theme.border,
              borderWidth: 1,
              titleColor: theme.title,
              bodyColor: theme.text,
              mode: 'index',
              intersect: false,
              callbacks: {
                label: function (item) {
                  return ` ${item.dataset.label}: ${item.parsed.y.toLocaleString('id-ID')} ${unit}`;
                }
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
              grid: { color: theme.grid },
              title: { display: !!unit, text: unit, color: theme.text, font: { size: 10 } }
            }
          }
        }
      });

      this.instances.set(canvasId, chart);
      return chart;
    },

    /**
     * 2. Bar Chart (Perbandingan Wilayah / Entitas)
     */
    createBarChart: function (canvasId, options) {
      if (typeof Chart === 'undefined') return null;

      const ctx = typeof canvasId === 'string' ? document.getElementById(canvasId) : canvasId;
      if (!ctx) return null;

      if (this.instances.has(canvasId)) {
        this.instances.get(canvasId).destroy();
      }

      const theme = this.getThemeColors();
      const labels = options.labels || [];
      const dataSelesai = options.selesai || [];
      const dataTotal = options.total || [];
      const isHorizontal = options.horizontal || false;

      const datasets = [
        {
          label: 'Selesai',
          data: dataSelesai,
          backgroundColor: theme.primary,
          borderRadius: 6,
          borderSkipped: false
        }
      ];

      if (dataTotal.length > 0) {
        datasets.push({
          label: 'Sisa Beban',
          data: dataTotal.map((tot, idx) => Math.max(0, tot - (dataSelesai[idx] || 0))),
          backgroundColor: theme.isLight ? 'rgba(60, 51, 46, 0.08)' : 'rgba(255, 255, 255, 0.06)',
          borderRadius: 6,
          borderSkipped: false
        });
      }

      const chart = new Chart(ctx, {
        type: 'bar',
        data: { labels: labels, datasets: datasets },
        options: {
          indexAxis: isHorizontal ? 'y' : 'x',
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              labels: { color: theme.text, font: { size: 11, family: 'Inter' } }
            },
            tooltip: {
              backgroundColor: theme.bgCard,
              borderColor: theme.border,
              borderWidth: 1,
              titleColor: theme.title,
              bodyColor: theme.text
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

      this.instances.set(canvasId, chart);
      return chart;
    },

    /**
     * 3. Speedometer / Semi-Donut Gauge Chart
     */
    createGaugeChart: function (canvasId, options) {
      if (typeof Chart === 'undefined') return null;

      const ctx = typeof canvasId === 'string' ? document.getElementById(canvasId) : canvasId;
      if (!ctx) return null;

      if (this.instances.has(canvasId)) {
        this.instances.get(canvasId).destroy();
      }

      const theme = this.getThemeColors();
      const value = Math.max(0, options.value || 0);
      const max = Math.max(value, options.max || 100);
      const remaining = Math.max(0, max - value);
      const color = options.color || theme.primary;

      const chart = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: ['Capaian', 'Sisa'],
          datasets: [
            {
              data: [value, remaining],
              backgroundColor: [color, theme.isLight ? 'rgba(60, 51, 46, 0.08)' : 'rgba(255, 255, 255, 0.06)'],
              borderWidth: 0,
              circumference: 180,
              rotation: 270
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '76%',
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: theme.bgCard,
              borderColor: theme.border,
              borderWidth: 1,
              titleColor: theme.title,
              bodyColor: theme.text
            }
          }
        }
      });

      this.instances.set(canvasId, chart);
      return chart;
    },

    /**
     * 4. Donut Status Distribution Chart
     */
    createDonutChart: function (canvasId, options) {
      if (typeof Chart === 'undefined') return null;

      const ctx = typeof canvasId === 'string' ? document.getElementById(canvasId) : canvasId;
      if (!ctx) return null;

      if (this.instances.has(canvasId)) {
        this.instances.get(canvasId).destroy();
      }

      const theme = this.getThemeColors();
      const labels = options.labels || ['Approved', 'Submitted', 'Draft', 'Open', 'Rejected'];
      const data = options.data || [45, 25, 15, 10, 5];
      const colors = options.colors || [theme.green, theme.blue, theme.yellow, theme.primary, theme.red];

      const chart = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: labels,
          datasets: [
            {
              data: data,
              backgroundColor: colors,
              borderWidth: 2,
              borderColor: theme.bgCard
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '65%',
          plugins: {
            legend: {
              position: 'bottom',
              labels: { color: theme.text, font: { size: 11, family: 'Inter' }, padding: 12 }
            },
            tooltip: {
              backgroundColor: theme.bgCard,
              borderColor: theme.border,
              borderWidth: 1,
              titleColor: theme.title,
              bodyColor: theme.text
            }
          }
        }
      });

      this.instances.set(canvasId, chart);
      return chart;
    },

    /**
     * Automatically observe theme toggle on <body> and update all chart instances
     */
    watchTheme: function () {
      if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return;

      const observer = new MutationObserver(() => {
        const theme = this.getThemeColors();
        this.instances.forEach((chart) => {
          if (chart && chart.options && chart.options.scales) {
            if (chart.options.scales.x) {
              chart.options.scales.x.ticks.color = theme.text;
              chart.options.scales.x.grid.color = theme.grid;
            }
            if (chart.options.scales.y) {
              chart.options.scales.y.ticks.color = theme.text;
              chart.options.scales.y.grid.color = theme.grid;
            }
          }
          if (chart && chart.options && chart.options.plugins && chart.options.plugins.legend) {
            chart.options.plugins.legend.labels.color = theme.text;
          }
          chart.update();
        });
      });

      observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    }
  };

  return TakaCharts;
});
