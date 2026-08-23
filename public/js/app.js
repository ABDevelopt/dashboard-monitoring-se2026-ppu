// Swal Polyfill using native glassmorphic modal
window.Swal = {
  // Toast notifications
  toast: function(title, type = 'success') {
    let container = document.querySelector('.custom-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'custom-toast-container';
      document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = `custom-toast custom-toast-${type}`;
    let iconClass = 'bi-check-circle-fill';
    if (type === 'error') iconClass = 'bi-exclamation-triangle-fill';
    if (type === 'info') iconClass = 'bi-info-circle-fill';
    
    toast.innerHTML = `
      <i class="bi ${iconClass} custom-toast-icon"></i>
      <span style="font-weight:600; font-size:12px; line-height:1.4;">${title}</span>
    `;
    container.appendChild(toast);
    
    // trigger entry animation
    requestAnimationFrame(() => {
      toast.classList.add('active');
    });
    
    // remove after 3s
    setTimeout(() => {
      toast.classList.remove('active');
      setTimeout(() => {
        toast.remove();
      }, 300);
    }, 3000);
  },

  // Main dialog
  fire: function(options) {
    if (typeof options === 'string') {
      options = { title: options };
    }
    // If it's a simple toast request
    if (options.toast) {
      const title = options.title || '';
      const type = options.icon || 'success';
      this.toast(title, type);
      return Promise.resolve({ isConfirmed: true });
    }

    // Otherwise, it's a full modal
    return new Promise((resolve) => {
      // Remove any existing modals
      const existing = document.getElementById('custom-swal-modal');
      if (existing) existing.remove();

      const backdrop = document.createElement('div');
      backdrop.id = 'custom-swal-modal';
      backdrop.className = 'custom-dialog-backdrop';

      let headerHtml = '';
      if (options.title) {
        headerHtml = `<div class="custom-dialog-header">${options.title}</div>`;
      }

      let bodyHtml = '';
      if (options.html) {
        bodyHtml = `<div class="custom-dialog-body">${options.html}</div>`;
      } else if (options.text) {
        bodyHtml = `<div class="custom-dialog-body" style="font-size:13px; line-height:1.5; color:var(--text-secondary);">${options.text}</div>`;
      }

      // Check if showLoading was called
      let isLoader = false;
      if (options.didOpen && options.showConfirmButton === false) {
        // This is a loading popup
        isLoader = true;
        bodyHtml += `<div class="custom-dialog-spinner"></div>`;
      }

      let footerHtml = '';
      if (!isLoader && (options.showConfirmButton !== false || options.showCancelButton)) {
        footerHtml = `<div class="custom-dialog-footer">`;
        if (options.showCancelButton) {
          const cancelText = options.cancelButtonText || 'Batal';
          footerHtml += `<button type="button" class="custom-dialog-btn custom-dialog-btn-cancel">${cancelText}</button>`;
        }
        if (options.showConfirmButton !== false) {
          const confirmText = options.confirmButtonText || 'OK';
          footerHtml += `<button type="button" class="custom-dialog-btn custom-dialog-btn-confirm">${confirmText}</button>`;
        }
        footerHtml += `</div>`;
      }

      backdrop.innerHTML = `
        <div class="custom-dialog-card">
          ${headerHtml}
          ${bodyHtml}
          ${footerHtml}
        </div>
      `;

      document.body.appendChild(backdrop);

      // Trigger animation
      requestAnimationFrame(() => {
        backdrop.classList.add('active');
      });

      // Bind button events
      const confirmBtn = backdrop.querySelector('.custom-dialog-btn-confirm');
      const cancelBtn = backdrop.querySelector('.custom-dialog-btn-cancel');

      const closeModal = (confirmed, val = null) => {
        backdrop.classList.remove('active');
        setTimeout(() => {
          backdrop.remove();
          resolve({ isConfirmed: confirmed, value: val });
        }, 250);
      };

      if (confirmBtn) {
        confirmBtn.addEventListener('click', () => {
          // If preConfirm option is provided
          if (options.preConfirm) {
            const val = options.preConfirm();
            if (val === false) return; // validation failed
            closeModal(true, val);
          } else {
            closeModal(true, true);
          }
        });
      }

      if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
          closeModal(false);
        });
      }

      // If didOpen is provided (like for starting loading or custom init)
      if (options.didOpen) {
        options.didOpen(backdrop);
      }
    });
  },

  showLoading: function() {
    // If modal already open, we can just insert spinner
    const card = document.querySelector('#custom-swal-modal .custom-dialog-card');
    if (card) {
      let spinner = card.querySelector('.custom-dialog-spinner');
      if (!spinner) {
        spinner = document.createElement('div');
        spinner.className = 'custom-dialog-spinner';
        card.appendChild(spinner);
      }
      const footer = card.querySelector('.custom-dialog-footer');
      if (footer) footer.style.display = 'none';
    } else {
      this.fire({
        title: 'Mohon Tunggu...',
        html: 'Sedang memproses data, harap tunggu.',
        showConfirmButton: false
      });
    }
  },

  close: function() {
    const backdrop = document.getElementById('custom-swal-modal');
    if (backdrop) {
      backdrop.classList.remove('active');
      setTimeout(() => {
        backdrop.remove();
      }, 250);
    }
  },

  showValidationMessage: function(msg) {
    const card = document.querySelector('#custom-swal-modal .custom-dialog-card');
    if (card) {
      let errMsg = card.querySelector('.custom-dialog-validation-error');
      if (!errMsg) {
        errMsg = document.createElement('div');
        errMsg.className = 'custom-dialog-validation-error';
        errMsg.style.color = 'var(--accent-red)';
        errMsg.style.fontSize = '11px';
        errMsg.style.marginTop = '8px';
        errMsg.style.fontWeight = '600';
        const body = card.querySelector('.custom-dialog-body');
        if (body) body.appendChild(errMsg);
      }
      errMsg.textContent = msg;
    }
  }
};

// Make sure global helpers use this system
window.showAlert = function(options) {
  return window.Swal.fire(options);
};

window.showToast = function(title, type = 'success') {
  window.Swal.toast(title, type);
};

window.showLoading = function(title, text) {
  window.Swal.fire({
    title: title || 'Memuat...',
    text: text || 'Harap tunggu.',
    showConfirmButton: false,
    didOpen: () => {
      window.Swal.showLoading();
    }
  });
};

window.closeLoading = function() {
  window.Swal.close();
};

function updateTime() {
  const optionsDate = { timeZone: 'Asia/Makassar', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
  const now = new Date();
  const dateStr = now.toLocaleDateString('id-ID', optionsDate);
  const timeStr = now.toLocaleTimeString('id-ID', { timeZone: 'Asia/Makassar', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) + ' WITA';
    
    // Topbar elements
    const liveTimeEl = document.getElementById('liveTime');
    const liveDateEl = document.getElementById('liveDate');
    if (liveTimeEl) liveTimeEl.textContent = timeStr;
    if (liveDateEl) liveDateEl.textContent = dateStr;

    // Overview widgets if present
    const overviewTimeEl = document.getElementById('overviewTime');
    const overviewDateEl = document.getElementById('overviewDate');
    if (overviewTimeEl) overviewTimeEl.textContent = timeStr;
    if (overviewDateEl) overviewDateEl.textContent = dateStr;
  }

  // ===== BREADCRUMB NAVIGATION =====
  // Builds breadcrumb trail based on current URL path and query parameters.
  // Called on initial load and after every PJAX navigation.
  function updateBreadcrumbs(targetUrl) {
    document.body.classList.remove('has-breadcrumb');
    const bar  = document.getElementById('breadcrumb-bar');
    const list = document.getElementById('breadcrumb-list');
    if (!bar || !list) return;

    const url    = new URL(targetUrl || window.location.href, window.location.origin);
    const path   = url.pathname.replace(/\/$/, '') || '/';
    const params = url.searchParams;

    const prefix = window.navPrefix || '';
    const normalizedPath = (prefix && path.startsWith(prefix)) 
      ? (path.slice(prefix.length).replace(/\/$/, '') || '/') 
      : path;

    // Map URL paths → { label, icon, href }
    const PAGE_MAP = {
      '/':                  { label: 'Overview',          icon: 'bi-house-door-fill' },
      '/map':               { label: 'Peta Progres',      icon: 'bi-map-fill' },
      '/agent':             { label: 'Pananyo Taka',      icon: 'bi-sparkles' },
      '/kecamatan':         { label: 'Kecamatan',         icon: 'bi-geo-alt-fill' },
      '/korlap':            { label: 'Korlap',            icon: 'bi-person-lines-fill' },
      '/pml':               { label: 'PML',               icon: 'bi-person-badge-fill' },
      '/pcl':               { label: 'PCL',               icon: 'bi-person-gear' },
      '/subsls':            { label: 'Subsls',            icon: 'bi-grid-3x3-gap-fill' },
      '/kipp':              { label: 'KIPP IKN',          icon: 'bi-building-check' },
      '/leaderboard':       { label: 'Leaderboard',       icon: 'bi-trophy-fill' },
      '/performa':          { label: 'Top Performers',    icon: 'bi-graph-up-arrow' },
      '/performa-terendah': { label: 'Performa Terendah', icon: 'bi-graph-down-arrow' },
      '/harian':            { label: 'Tren Harian',       icon: 'bi-bar-chart-line-fill' },
      '/early-warning':     { label: 'Early Warning',     icon: 'bi-exclamation-triangle-fill' },
      '/earlywarning':      { label: 'Early Warning',     icon: 'bi-exclamation-triangle-fill' },
      '/deteksi-anomali':   { label: 'Anomali',           icon: 'bi-shield-exclamation' },
      '/pbi':               { label: 'Power BI',          icon: 'bi-bar-chart-fill' },
      '/master':            { label: 'Data Master',       icon: 'bi-table' },
      '/admin':             { label: 'Menu Admin',        icon: 'bi-grid-fill' },
      '/admin/upload':      { label: 'Upload Data',       icon: 'bi-upload' },
      '/admin/master':      { label: 'Kelola Master Data', icon: 'bi-database-fill-gear' },
      '/admin/users':       { label: 'Kelola Pengguna',   icon: 'bi-people-fill' },
      '/admin/settings':    { label: 'Pengaturan Tampilan', icon: 'bi-sliders' },
      '/admin/settings/chatbot': { label: 'Pengaturan Chatbot AI', icon: 'bi-chat-left-dots-fill' },
      '/admin/whatsapp':    { label: 'Integrasi WhatsApp', icon: 'bi-whatsapp' },
      '/settings':          { label: 'Pengaturan',        icon: 'bi-gear-fill' },
      '/help':              { label: 'Panduan & Bantuan', icon: 'bi-life-preserver' },
    };

    // On root Overview page and AI agent page, hide breadcrumb (not needed)
    if (normalizedPath === '/' || normalizedPath === '/agent') {
      bar.classList.add('hidden');
      list.innerHTML = '';
      document.body.classList.remove('has-breadcrumb');
      return;
    }

    // Build crumbs array
    const crumbs = [];

    // Always start with Home
    crumbs.push({ label: 'Home', icon: 'bi-house-door', href: prefix + '/' });

    // Resolve the current page info
    const pageInfo = PAGE_MAP[normalizedPath] || { label: decodeURIComponent(normalizedPath.replace(/^\//, '').replace(/-/g, ' ')).replace(/\b\w/g, c => c.toUpperCase()), icon: 'bi-file-earmark' };
    const pageHref = prefix + (normalizedPath === '/' ? '' : normalizedPath);

    // Check for drill-down filter params that indicate sub-level navigation
    const filterKec    = params.get('kec');
    const filterKorlap = params.get('korlap');
    const filterPml    = params.get('pml');
    const filterPcl    = params.get('pcl');
    const filterDesa   = params.get('desa');

    // If no filters at all → just show Home > PageName
    const hasFilter = filterKec || filterKorlap || filterPml || filterPcl || filterDesa;

    if (!hasFilter) {
      // Simple page, no drill-down
      crumbs.push({ label: pageInfo.label, icon: pageInfo.icon, href: null }); // null = current (active)
    } else {
      // Drill-down: show page as clickable, then filters as trail
      crumbs.push({ label: pageInfo.label, icon: pageInfo.icon, href: pageHref });

      // Build hierarchical context from filters
      // Kecamatan level
      if (filterKec && !filterKorlap && !filterPml && !filterPcl) {
        crumbs.push({ label: filterKec, icon: 'bi-geo-alt', href: null });
      }
      // Korlap level
      if (filterKorlap) {
        if (filterKec) {
          crumbs.push({ label: filterKec, icon: 'bi-geo-alt', href: `${pageHref}?kec=${encodeURIComponent(filterKec)}` });
        }
        if (!filterPml && !filterPcl) {
          crumbs.push({ label: filterKorlap, icon: 'bi-person-lines-fill', href: null });
        } else {
          crumbs.push({ label: filterKorlap, icon: 'bi-person-lines-fill', href: `${pageHref}?korlap=${encodeURIComponent(filterKorlap)}${filterKec ? '&kec=' + encodeURIComponent(filterKec) : ''}` });
        }
      }
      // PML level
      if (filterPml) {
        if (!filterPcl) {
          crumbs.push({ label: filterPml, icon: 'bi-person-badge-fill', href: null });
        } else {
          crumbs.push({ label: filterPml, icon: 'bi-person-badge-fill', href: `${pageHref}?pml=${encodeURIComponent(filterPml)}${filterKorlap ? '&korlap=' + encodeURIComponent(filterKorlap) : ''}${filterKec ? '&kec=' + encodeURIComponent(filterKec) : ''}` });
        }
      }
      // PCL level (leaf)
      if (filterPcl) {
        crumbs.push({ label: filterPcl, icon: 'bi-person-gear', href: null });
      }
      // Desa/SLS level (subsls page)
      if (filterDesa && !filterPcl) {
        if (filterKec) {
          crumbs.push({ label: filterKec, icon: 'bi-geo-alt', href: `${pageHref}?kec=${encodeURIComponent(filterKec)}` });
        }
        crumbs.push({ label: filterDesa, icon: 'bi-house-door', href: null });
      }
    }

    // Render crumbs
    list.innerHTML = '';
    crumbs.forEach((crumb, idx) => {
      const isLast = idx === crumbs.length - 1;

      // Separator (except before first item)
      if (idx > 0) {
        const sep = document.createElement('li');
        sep.className = 'breadcrumb-separator';
        sep.setAttribute('aria-hidden', 'true');
        sep.innerHTML = '<i class="bi bi-chevron-right"></i>';
        list.appendChild(sep);
      }

      const li = document.createElement('li');
      li.className = 'breadcrumb-item' + (isLast ? ' active' : '');
      // Stagger animation delay
      li.style.animationDelay = (idx * 40) + 'ms';

      if (isLast || !crumb.href) {
        // Active (non-clickable) crumb
        li.setAttribute('aria-current', 'page');
        li.innerHTML = `<i class="bi ${crumb.icon}" style="font-size:11px; opacity:0.7; margin-right:4px;"></i>${crumb.label}`;
      } else {
        // Clickable crumb
        li.innerHTML = `<a href="${crumb.href}"><i class="bi ${crumb.icon}"></i>${crumb.label}</a>`;
      }

      list.appendChild(li);
    });

    // Show the bar and signal to CSS that content offset needs adjustment
    bar.classList.remove('hidden');
    document.body.classList.add('has-breadcrumb');
  }

  function updateWeather() {
    const cachedWeather = localStorage.getItem('ppu_weather');
    const cachedTime = localStorage.getItem('ppu_weather_time');
    const now = Date.now();
    
    // Check cache (15 minutes = 900,000 ms)
    if (cachedWeather && cachedTime && (now - parseInt(cachedTime)) < 900000) {
      try {
        renderWeather(JSON.parse(cachedWeather));
        return;
      } catch (e) {
        // Parse error, refetch
      }
    }
    
    // Fetch new weather data for Penajam Paser Utara (Latitude: -1.2650, Longitude: 116.8286)
    fetch('https://api.open-meteo.com/v1/forecast?latitude=-1.2650&longitude=116.8286&current=temperature_2m,relative_humidity_2m,weather_code')
      .then(response => response.json())
      .then(data => {
        if (data && data.current) {
          const weatherObj = {
            temp: data.current.temperature_2m,
            code: data.current.weather_code,
            humidity: data.current.relative_humidity_2m
          };
          localStorage.setItem('ppu_weather', JSON.stringify(weatherObj));
          localStorage.setItem('ppu_weather_time', now.toString());
          renderWeather(weatherObj);

          // Get date string in PPU timezone (WITA, UTC+8)
          const ppuDate = new Date(new Date().getTime() + (8 * 60 - new Date().getTimezoneOffset()) * 60000);
          const yyyy = ppuDate.getFullYear();
          const mm = String(ppuDate.getMonth() + 1).padStart(2, '0');
          const dd = String(ppuDate.getDate()).padStart(2, '0');
          const tanggalStr = `${yyyy}-${mm}-${dd}`;

          // Save weather to DB
          fetch('/api/weather', {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || ''
            },
            body: JSON.stringify({
              tanggal: tanggalStr,
              temp: weatherObj.temp,
              code: weatherObj.code,
              humidity: weatherObj.humidity
            })
          }).catch(err => console.error('Error logging daily weather:', err));
        }
      })
      .catch(err => {
        console.error('Weather fetch error:', err);
        if (cachedWeather) {
          try {
            renderWeather(JSON.parse(cachedWeather));
          } catch (e) {}
        } else {
          // Static fallback: Penajam is usually warm and partly cloudy
          renderWeather({ temp: 31, code: 2, humidity: 80 });
        }
      });
  }

  function renderWeather(w) {
    let iconHTML = '';
    let desc = '';
    
    switch (w.code) {
      case 0:
        iconHTML = '<i class="bi bi-sun-fill" style="color: #fbbf24;"></i>';
        desc = 'Cerah';
        break;
      case 1:
      case 2:
        iconHTML = '<i class="bi bi-cloud-sun-fill" style="color: #f59e0b;"></i>';
        desc = 'Cerah Berawan';
        break;
      case 3:
        iconHTML = '<i class="bi bi-cloud-fill" style="color: #94a3b8;"></i>';
        desc = 'Berawan';
        break;
      case 45:
      case 48:
        iconHTML = '<i class="bi bi-cloud-fog2-fill" style="color: #cbd5e1;"></i>';
        desc = 'Kabut';
        break;
      case 51:
      case 53:
      case 55:
      case 56:
      case 57:
        iconHTML = '<i class="bi bi-cloud-drizzle-fill" style="color: #60a5fa;"></i>';
        desc = 'Gerimis';
        break;
      case 61:
      case 63:
        iconHTML = '<i class="bi bi-cloud-rain-fill" style="color: #3b82f6;"></i>';
        desc = 'Hujan Ringan';
        break;
      case 65:
      case 80:
      case 81:
      case 82:
        iconHTML = '<i class="bi bi-cloud-rain-heavy-fill" style="color: #2563eb;"></i>';
        desc = 'Hujan';
        break;
      case 95:
      case 96:
      case 99:
        iconHTML = '<i class="bi bi-cloud-lightning-rain-fill" style="color: #ef4444;"></i>';
        desc = 'Hujan Badai';
        break;
      default:
        iconHTML = '<i class="bi bi-cloud-sun-fill" style="color: #f59e0b;"></i>';
        desc = 'Cerah Berawan';
    }
    
    // Topbar elements
    const topIcon = document.getElementById('weatherIcon');
    const topTemp = document.getElementById('weatherTemp');
    const topInfo = document.getElementById('weatherInfo');
    if (topIcon) topIcon.innerHTML = iconHTML;
    if (topTemp) topTemp.textContent = Math.round(w.temp) + '°C';
    if (topInfo) topInfo.textContent = `(${desc})`;

    // Overview elements if present
    const ovIcon = document.getElementById('overviewWeatherIcon');
    const ovTemp = document.getElementById('overviewWeatherTemp');
    const ovDesc = document.getElementById('overviewWeatherDesc');
    if (ovIcon) ovIcon.innerHTML = iconHTML;
    if (ovTemp) ovTemp.textContent = Math.round(w.temp) + '°C';
    if (ovDesc) ovDesc.textContent = `${desc} · Kelembapan: ${w.humidity}%`;
  }

  function renderWeatherFromCache() {
    const cachedWeather = localStorage.getItem('ppu_weather');
    if (cachedWeather) {
      try {
        renderWeather(JSON.parse(cachedWeather));
      } catch (e) {}
    }
  }

  // Weather History UI helpers
  window.toggleWeatherHistory = function(event) {
    if (event) event.preventDefault();
    const container = document.getElementById('weatherHistoryContainer');
    if (!container) return;
    
    if (container.style.display === 'none') {
      container.style.display = 'block';
      fetchWeatherHistory();
    } else {
      container.style.display = 'none';
    }
  };

  function fetchWeatherHistory() {
    const listEl = document.getElementById('weatherHistoryList');
    if (!listEl) return;
    
    fetch('/api/weather/history')
      .then(res => res.json())
      .then(data => {
        if (!data || data.length === 0) {
          listEl.innerHTML = '<div style="font-size: 11px; color: var(--text-muted); text-align: center; padding: 10px 0;">Belum ada riwayat tercatat.</div>';
          return;
        }
        
        let html = '';
        data.forEach(item => {
          const dateParts = item.tanggal.split('-');
          let formattedDate = item.tanggal;
          if (dateParts.length === 3) {
            const dateObj = new Date(dateParts[0], dateParts[1] - 1, dateParts[2]);
            formattedDate = dateObj.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' });
          }
          
          let iconHTML = '';
          let desc = '';
          switch (item.code) {
            case 0:
              iconHTML = '<i class="bi bi-sun-fill" style="color: #fbbf24;"></i>';
              desc = 'Cerah';
              break;
            case 1:
            case 2:
              iconHTML = '<i class="bi bi-cloud-sun-fill" style="color: #f59e0b;"></i>';
              desc = 'Cerah Berawan';
              break;
            case 3:
              iconHTML = '<i class="bi bi-cloud-fill" style="color: #94a3b8;"></i>';
              desc = 'Berawan';
              break;
            case 45:
            case 48:
              iconHTML = '<i class="bi bi-cloud-fog2-fill" style="color: #cbd5e1;"></i>';
              desc = 'Kabut';
              break;
            case 51:
            case 53:
            case 55:
            case 56:
            case 57:
              iconHTML = '<i class="bi bi-cloud-drizzle-fill" style="color: #60a5fa;"></i>';
              desc = 'Gerimis';
              break;
            case 61:
            case 63:
              iconHTML = '<i class="bi bi-cloud-rain-fill" style="color: #3b82f6;"></i>';
              desc = 'Hujan Ringan';
              break;
            case 65:
            case 80:
            case 81:
            case 82:
              iconHTML = '<i class="bi bi-cloud-rain-heavy-fill" style="color: #2563eb;"></i>';
              desc = 'Hujan';
              break;
            case 95:
            case 96:
            case 99:
              iconHTML = '<i class="bi bi-cloud-lightning-rain-fill" style="color: #ef4444;"></i>';
              desc = 'Hujan Badai';
              break;
            default:
              iconHTML = '<i class="bi bi-cloud-sun-fill" style="color: #f59e0b;"></i>';
              desc = 'Cerah Berawan';
          }
          
          html += `
            <div style="display: flex; align-items: center; justify-content: space-between; font-size: 11px; padding: 6px 10px; background: var(--bg-subtle); border: 1px solid var(--border); border-radius: 8px; margin-bottom: 4px; box-shadow: 0 1px 2px rgba(0,0,0,0.02);">
              <span style="font-weight: 600; color: var(--text-primary); min-width: 90px; text-transform: capitalize;">${formattedDate}</span>
              <span style="display: flex; align-items: center; gap: 6px; color: var(--text-secondary); flex: 1;">
                ${iconHTML} <span>${desc}</span>
              </span>
              <span style="font-weight: 700; color: var(--accent-cyan); min-width: 40px; text-align: right;">${Math.round(item.temp)}°C</span>
              <span style="color: var(--text-muted); font-size: 9px; min-width: 45px; text-align: right; font-weight: 500;">RH: ${item.humidity}%</span>
            </div>
          `;
        });
        listEl.innerHTML = html;
      })
      .catch(err => {
        console.error('Error fetching weather history:', err);
        listEl.innerHTML = '<div style="font-size: 11px; color: var(--text-muted); text-align: center; padding: 10px 0;">Gagal memuat riwayat.</div>';
      });
  }

  // Dynamic script loader for performance optimization with SRI support
  window._scriptPromises = {};
  function loadScript(url, integrity) {
    if (window._scriptPromises[url]) {
      return window._scriptPromises[url];
    }
    window._scriptPromises[url] = new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${url}"]`);
      if (existing) {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = url;
      script.defer = true;
      if (integrity) {
        script.setAttribute('integrity', integrity);
        script.setAttribute('crossorigin', 'anonymous');
      }
      script.onload = resolve;
      script.onerror = (err) => {
        window._scriptPromises[url] = null; // allow retry
        reject(err);
      };
      document.head.appendChild(script);
    });
    return window._scriptPromises[url];
  }
  window.loadScript = loadScript;

  // ===== BOOKMARKS / FAVORIT SAYA =====
  window.getPinnedItems = function() {
    try {
      const items = localStorage.getItem('ppu_bookmarks');
      return items ? JSON.parse(items) : [];
    } catch (e) {
      console.error('Error reading bookmarks:', e);
      return [];
    }
  };

  window.savePinnedItems = function(items) {
    try {
      localStorage.setItem('ppu_bookmarks', JSON.stringify(items));
    } catch (e) {
      console.error('Error saving bookmarks:', e);
    }
  };

  window.updatePinnedSidebar = function() {
    const section = document.getElementById('sidebarPinnedSection');
    const list = document.getElementById('sidebarPinnedList');
    if (!section || !list) return;

    const items = window.getPinnedItems();
    if (items.length === 0) {
      section.style.display = 'none';
      list.innerHTML = '';
      return;
    }

    section.style.display = 'block';
    const currentPath = window.location.pathname + window.location.search;
    
    list.innerHTML = items.map(item => {
      const isCurrentActive = currentPath === item.href;
      const icon = item.type === 'pcl' ? 'bi-person-badge-fill' : 'bi-geo-alt-fill';
      const colorStyle = item.type === 'pcl' ? 'color: var(--accent-blue);' : 'color: var(--accent-green);';
      
      return `
        <a href="${item.href}" class="nav-item ${isCurrentActive ? 'active' : ''}">
          <span class="nav-icon"><i class="bi ${icon}" style="${colorStyle}"></i></span>
          <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;">${item.name}</span>
          <button class="unpin-sidebar-btn" data-type="${item.type}" data-name="${item.name}" data-href="${item.href}" title="Hapus dari Favorit">
            <i class="bi bi-x"></i>
          </button>
        </a>
      `;
    }).join('');
  };

  window.togglePin = function(type, name, href) {
    let items = window.getPinnedItems();
    const exists = items.some(item => item.type === type && item.name === name);

    if (exists) {
      items = items.filter(item => !(item.type === type && item.name === name));
      if (typeof Swal !== 'undefined') {
        Swal.fire({
          toast: true,
          position: 'top-end',
          icon: 'success',
          title: `Dihapus dari Favorit`,
          showConfirmButton: false,
          timer: 1500,
          background: 'var(--bg-card)',
          color: 'var(--text-primary)'
        });
      }
    } else {
      items.push({ type, name, href });
      if (typeof Swal !== 'undefined') {
        Swal.fire({
          toast: true,
          position: 'top-end',
          icon: 'success',
          title: `Ditambahkan ke Favorit`,
          showConfirmButton: false,
          timer: 1500,
          background: 'var(--bg-card)',
          color: 'var(--text-primary)'
        });
      }
    }

    window.savePinnedItems(items);
    window.updatePinnedSidebar();
    window.syncPinButtons();
  };

  window.syncPinButtons = function() {
    const items = window.getPinnedItems();
    document.querySelectorAll('.pin-btn').forEach(btn => {
      const type = btn.getAttribute('data-type');
      const name = btn.getAttribute('data-name');
      const isPinned = items.some(item => item.type === type && item.name === name);
      if (isPinned) {
        btn.classList.add('pinned');
        btn.setAttribute('title', 'Hapus dari Favorit');
      } else {
        btn.classList.remove('pinned');
        btn.setAttribute('title', 'Sematkan ke Favorit');
      }
    });
  };

  // ===== GLOBAL FUZZY SEARCH (Ctrl+K) =====
  let currentSearchFocusIndex = -1;
  let searchDebounceTimeout = null;

  window.toggleGlobalSearchModal = function(show) {
    const modal = document.getElementById('globalSearchModal');
    const input = document.getElementById('globalSearchInput');
    const results = document.getElementById('globalSearchResults');
    
    if (!modal) return;
    
    if (show) {
      modal.classList.remove('hidden');
      modal.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
      setTimeout(() => {
        if (input) {
          input.value = '';
          input.focus();
        }
      }, 50);
      currentSearchFocusIndex = -1;
      if (results) {
        results.innerHTML = `
          <div class="search-welcome-state">
            <i class="bi bi-search" style="font-size: 24px; opacity: 0.5; margin-bottom: 8px;"></i>
            <p style="margin: 0; font-size: 13px; color: var(--text-secondary);">Ketik minimal 2 karakter untuk memulai pencarian global...</p>
          </div>
        `;
      }
    } else {
      modal.classList.add('hidden');
      modal.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
      if (input) input.blur();
    }
  };

  window.performGlobalSearch = function(query) {
    const resultsContainer = document.getElementById('globalSearchResults');
    if (!resultsContainer) return;

    if (!query || query.trim().length < 2) {
      resultsContainer.innerHTML = `
        <div class="search-welcome-state">
          <i class="bi bi-search" style="font-size: 24px; opacity: 0.5; margin-bottom: 8px;"></i>
          <p style="margin: 0; font-size: 13px; color: var(--text-secondary);">Ketik minimal 2 karakter untuk memulai pencarian global...</p>
        </div>
      `;
      currentSearchFocusIndex = -1;
      return;
    }

    resultsContainer.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: center; padding: 40px 20px; color: var(--text-muted); gap: 8px; font-size: 13px;">
        <span class="spinner-border spinner-border-sm" role="status" aria-hidden="true" style="width: 1rem; height: 1rem; border-width: 0.15em; border-color: var(--accent-blue) transparent transparent transparent;"></span>
        Mencari data...
      </div>
    `;

    const activeSurvey = window.activeSurveyId || '';
    fetch(`/api/search-global?q=${encodeURIComponent(query)}&survey=${encodeURIComponent(activeSurvey)}`)
      .then(res => res.json())
      .then(data => {
        let html = '';
        let totalItems = 0;

        const categories = [
          { key: 'pcl', label: 'Petugas PCL', icon: 'bi-person-badge-fill' },
          { key: 'pml', label: 'Pengawas PML', icon: 'bi-person-gear' },
          { key: 'korlap', label: 'Koordinator Lapangan', icon: 'bi-person-workspace' },
          { key: 'kecamatan', label: 'Kecamatan', icon: 'bi-geo-alt-fill' },
          { key: 'desa', label: 'Desa/Kelurahan', icon: 'bi-geo-fill' },
          { key: 'sls', label: 'Satuan Lingkungan Setempat (SLS)', icon: 'bi-grid-3x3-gap-fill' }
        ];

        categories.forEach(cat => {
          const items = data[cat.key] || [];
          if (items.length > 0) {
            html += `
              <div class="search-group">
                <div class="search-group-title">${cat.label}</div>
            `;
            items.forEach(item => {
              html += `
                <a href="${item.href}" class="search-result-item" data-index="${totalItems}">
                  <div class="search-result-item-icon"><i class="bi ${cat.icon}"></i></div>
                  <div class="search-result-item-content">
                    <div class="search-result-item-title">${item.label}</div>
                    <div class="search-result-item-sub">${item.sublabel}</div>
                  </div>
                </a>
              `;
              totalItems++;
            });
            html += `</div>`;
          }
        });

        if (totalItems === 0) {
          resultsContainer.innerHTML = `
            <div class="search-welcome-state">
              <i class="bi bi-exclamation-circle" style="font-size: 24px; opacity: 0.5; margin-bottom: 8px; color: var(--accent-red);"></i>
              <p style="margin: 0; font-size: 13px; color: var(--text-secondary);">Tidak ada hasil ditemukan untuk <strong>"${query}"</strong></p>
            </div>
          `;
          currentSearchFocusIndex = -1;
        } else {
          resultsContainer.innerHTML = html;
          currentSearchFocusIndex = 0;
          highlightSearchItem(0);

          document.querySelectorAll('.search-result-item').forEach(el => {
            el.addEventListener('click', () => {
              window.toggleGlobalSearchModal(false);
            });
          });
        }
      })
      .catch(err => {
        console.error('Error in global search API:', err);
        resultsContainer.innerHTML = `
          <div class="search-welcome-state">
            <i class="bi bi-x-circle" style="font-size: 24px; opacity: 0.5; margin-bottom: 8px; color: var(--accent-red);"></i>
            <p style="margin: 0; font-size: 13px; color: var(--text-secondary);">Terjadi kesalahan koneksi saat mencari.</p>
          </div>
        `;
        currentSearchFocusIndex = -1;
      });
  };

  function highlightSearchItem(index) {
    const items = document.querySelectorAll('.search-result-item');
    items.forEach(item => item.classList.remove('selected'));
    
    const target = document.querySelector(`.search-result-item[data-index="${index}"]`);
    if (target) {
      target.classList.add('selected');
      target.scrollIntoView({ block: 'nearest' });
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    // Initialize Bookmarks
    window.updatePinnedSidebar();
    window.syncPinButtons();

    // Dynamic CSRF Token Injection for all POST forms
    document.addEventListener('submit', (e) => {
      const form = e.target;
      if (form.method && form.method.toUpperCase() === 'POST') {
        const csrfTokenMeta = document.querySelector('meta[name="csrf-token"]');
        if (csrfTokenMeta && !form.querySelector('input[name="_csrf"]')) {
          const input = document.createElement('input');
          input.type = 'hidden';
          input.name = '_csrf';
          input.value = csrfTokenMeta.getAttribute('content');
          form.appendChild(input);
        }
      }
    });

    // Event Delegation for Pin (.pin-btn) and Unpin (.unpin-sidebar-btn) Buttons
    document.addEventListener('click', (e) => {
      const pinBtn = e.target.closest('.pin-btn');
      if (pinBtn) {
        e.preventDefault();
        e.stopPropagation();
        const type = pinBtn.getAttribute('data-type');
        const name = pinBtn.getAttribute('data-name');
        const href = pinBtn.getAttribute('data-href');
        window.togglePin(type, name, href);
        return;
      }

      const unpinBtn = e.target.closest('.unpin-sidebar-btn');
      if (unpinBtn) {
        e.preventDefault();
        e.stopPropagation();
        const type = unpinBtn.getAttribute('data-type');
        const name = unpinBtn.getAttribute('data-name');
        const href = unpinBtn.getAttribute('data-href') || unpinBtn.closest('a')?.getAttribute('href') || '';
        window.togglePin(type, name, href);
        return;
      }
    });

    // Global Search trigger button
    const globalSearchBtn = document.getElementById('globalSearchBtn');
    if (globalSearchBtn) {
      globalSearchBtn.addEventListener('click', () => {
        window.toggleGlobalSearchModal(true);
      });
    }

    // Close search modal button
    const closeSearchModalBtn = document.getElementById('closeSearchModalBtn');
    if (closeSearchModalBtn) {
      closeSearchModalBtn.addEventListener('click', () => {
        window.toggleGlobalSearchModal(false);
      });
    }

    // Click backdrop to close search modal
    const globalSearchModal = document.getElementById('globalSearchModal');
    if (globalSearchModal) {
      globalSearchModal.addEventListener('click', (e) => {
        if (e.target === globalSearchModal) {
          window.toggleGlobalSearchModal(false);
        }
      });
    }

    // Input debounce search
    const globalSearchInput = document.getElementById('globalSearchInput');
    if (globalSearchInput) {
      globalSearchInput.addEventListener('input', (e) => {
        clearTimeout(searchDebounceTimeout);
        const val = e.target.value;
        searchDebounceTimeout = setTimeout(() => {
          window.performGlobalSearch(val);
        }, 250);
      });

      // Key navigation inside input
      globalSearchInput.addEventListener('keydown', (e) => {
        const items = document.querySelectorAll('.search-result-item');
        const max = items.length;

        if (e.key === 'ArrowDown') {
          e.preventDefault();
          if (max === 0) return;
          currentSearchFocusIndex = (currentSearchFocusIndex + 1) % max;
          highlightSearchItem(currentSearchFocusIndex);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          if (max === 0) return;
          currentSearchFocusIndex = (currentSearchFocusIndex - 1 + max) % max;
          highlightSearchItem(currentSearchFocusIndex);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          const target = document.querySelector(`.search-result-item[data-index="${currentSearchFocusIndex}"]`);
          if (target) {
            target.click();
          }
        }
      });
    }

    // Keyboard Shortcuts: Ctrl+K / Cmd+K and Escape
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        const modal = document.getElementById('globalSearchModal');
        if (modal) {
          const isHidden = modal.classList.contains('hidden');
          window.toggleGlobalSearchModal(isHidden);
        }
      }
      
      if (e.key === 'Escape') {
        const modal = document.getElementById('globalSearchModal');
        if (modal && !modal.classList.contains('hidden')) {
          e.preventDefault();
          window.toggleGlobalSearchModal(false);
        }
      }
    });

    // Start weather and live clock updates
    updateTime();
    setInterval(updateTime, 1000);
    renderWeatherFromCache();
    updateWeather();
    // Refresh weather every 10 minutes (600,000 ms)
    setInterval(updateWeather, 600000);

    // Initialize breadcrumb for the current page on first load
    updateBreadcrumbs(window.location.href);

    const sidebar = document.getElementById('sidebar');
    const toggleBtn = document.getElementById('sidebarToggle');
    const closeBtn = document.getElementById('sidebarClose');
    const overlay = document.getElementById('sidebarOverlay');

    // ⚡ Safety reset: ensure overlay is always hidden on page load (never persists across navigations)
    if (overlay) {
      overlay.classList.remove('active');
    }
    if (sidebar) {
      sidebar.classList.remove('active');
    }

    // Sync collapsed state ARIA attribute on startup (desktop only)
    if (window.innerWidth > 768) {
      if (document.body.classList.contains('sidebar-collapsed')) {
        if (toggleBtn) toggleBtn.setAttribute('aria-expanded', 'true');
      }
    }

    // Modernized Native Side-Drawer Helper Functions
    function openSidebarDrawer(sectionName = null) {
      const sidebar = document.getElementById('sidebar');
      const overlay = document.getElementById('sidebarOverlay');
      const mainToggleBtn = document.getElementById('sidebarToggle');
      if (sidebar && overlay) {
        if (navigator.vibrate) {
          try { navigator.vibrate(10); } catch (e) {}
        }
        sidebar.classList.add('active');
        overlay.classList.add('active');
        if (window.innerWidth <= 768) {
          document.body.style.overflow = 'hidden';
        }
        if (mainToggleBtn) mainToggleBtn.setAttribute('aria-expanded', 'true');

        if (sectionName) {
          setTimeout(() => {
            const targetSection = sidebar.querySelector(`.nav-section-wrapper[data-section="${sectionName}"]`);
            if (targetSection) {
              targetSection.classList.remove('is-collapsed');
              targetSection.classList.add('is-open');
              targetSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
          }, 120);
        }
      }
    }

    function closeSidebarDrawer() {
      const sidebar = document.getElementById('sidebar');
      const overlay = document.getElementById('sidebarOverlay');
      const mainToggleBtn = document.getElementById('sidebarToggle');
      if (sidebar) {
        sidebar.classList.remove('active');
        sidebar.style.transform = '';
      }
      if (overlay) overlay.classList.remove('active');
      if (mainToggleBtn) mainToggleBtn.setAttribute('aria-expanded', 'false');
      document.body.style.overflow = '';
    }

    window.openSidebarDrawer = openSidebarDrawer;
    window.closeSidebarDrawer = closeSidebarDrawer;

    // Swipe-to-Close Drag Handler for Side-Drawer
    (function setupSidebarDragToClose() {
      let startX = 0;
      let currentX = 0;
      let isDragging = false;

      document.addEventListener('touchstart', (e) => {
        const sidebar = e.target.closest('.sidebar.active');
        if (!sidebar || window.innerWidth > 768) return;
        startX = e.touches[0].clientX;
        currentX = startX;
        isDragging = true;
      }, { passive: true });

      document.addEventListener('touchmove', (e) => {
        if (!isDragging) return;
        currentX = e.touches[0].clientX;
        const diffX = currentX - startX;
        if (diffX < 0) { // dragging left
          const sidebar = document.getElementById('sidebar');
          if (sidebar) {
            sidebar.style.transition = 'none';
            sidebar.style.transform = `translateX(${diffX}px)`;
          }
        }
      }, { passive: true });

      const handleTouchEnd = () => {
        if (!isDragging) return;
        const diffX = currentX - startX;
        const sidebar = document.getElementById('sidebar');
        if (sidebar) {
          sidebar.style.transition = 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)';
          if (diffX < -65) {
            closeSidebarDrawer();
          } else {
            sidebar.style.transform = '';
          }
          setTimeout(() => {
            if (sidebar) sidebar.style.transition = '';
          }, 300);
        }
        isDragging = false;
      };

      document.addEventListener('touchend', handleTouchEnd, { passive: true });
      document.addEventListener('touchcancel', handleTouchEnd, { passive: true });
    })();

    window.addEventListener('pjax:start', closeSidebarDrawer);
    window.addEventListener('popstate', closeSidebarDrawer);

    // Collapsible Accordion in Sidebar
    document.addEventListener('click', (e) => {
      const sectionHeader = e.target.closest('.nav-section-header');
      if (sectionHeader && window.innerWidth <= 768) {
        const wrapper = sectionHeader.closest('.nav-section-wrapper');
        if (wrapper) {
          wrapper.classList.toggle('is-collapsed');
          wrapper.classList.toggle('is-open');
        }
      }
    });

    // Event delegation on document for sidebar toggling and theme toggling
    // This ensures buttons remain clickable even after PJAX page swaps them
    document.addEventListener('click', (e) => {
      // 0. Mobile Bottom Nav & Sidebar Toggle Clicks
      const petugasBtn = e.target.closest('#bottomNavPetugasBtn');
      const bottomNavMenuBtn = e.target.closest('#bottomNavMenuBtn');
      const toggleBtn = e.target.closest('#sidebarToggle');

      if (petugasBtn) {
        e.preventDefault();
        openSidebarDrawer('petugas');
        return;
      }
      if (bottomNavMenuBtn) {
        e.preventDefault();
        openSidebarDrawer();
        return;
      }
      if (toggleBtn) {
        e.preventDefault();
        if (window.innerWidth > 768) {
          // Desktop collapse logic
          document.body.classList.toggle('sidebar-collapsed');
          const isCollapsed = document.body.classList.contains('sidebar-collapsed');
          localStorage.setItem('sidebar-collapsed', isCollapsed);
          toggleBtn.setAttribute('aria-expanded', isCollapsed ? 'true' : 'false');
        } else {
          // Mobile open modernized side-drawer
          openSidebarDrawer();
        }
        return;
      }

      // 2. Sidebar Close / Overlay Click
      const closeBtn = e.target.closest('#sidebarClose');
      const sidebarOverlay = e.target.closest('#sidebarOverlay');
      if (closeBtn || sidebarOverlay) {
        closeSidebarDrawer();
        return;
      }

      // 3. Theme Toggle Button Click
      const themeToggleBtn = e.target.closest('#themeToggle, #themeToggleAgent, .theme-toggle-btn');
      if (themeToggleBtn) {
        e.preventDefault();
        e.stopPropagation();
        document.body.classList.toggle('light-mode');
        const isLight = document.body.classList.contains('light-mode');
        localStorage.setItem('theme', isLight ? 'light' : 'dark');
        
        document.querySelectorAll('#themeIcon, .theme-icon').forEach(themeIcon => {
          if (isLight) {
            themeIcon.classList.remove('bi-moon-fill');
            themeIcon.classList.add('bi-sun-fill');
          } else {
            themeIcon.classList.remove('bi-sun-fill');
            themeIcon.classList.add('bi-moon-fill');
          }
        });
        
        window.dispatchEvent(new Event('themechange'));
        return;
      }

      // 4. Target Mode Selector Button Click
      const targetBtn = e.target.closest('#targetSelectorBtn');
      if (targetBtn) {
        e.preventDefault();
        e.stopPropagation();
        const dropdown = document.getElementById('targetSelectorDropdown');
        if (dropdown) {
          const isOpen = dropdown.classList.contains('is-open');
          document.querySelectorAll('.topbar-dropdown').forEach(d => {
            if (d !== dropdown) d.classList.remove('is-open');
          });
          dropdown.classList.toggle('is-open', !isOpen);
        }
        return;
      }

      // 5. Notification Bell Button Click
      const bellBtn = e.target.closest('#notificationBellBtn, #notificationBellBtnAgent, .notification-bell-btn');
      if (bellBtn) {
        e.preventDefault();
        e.stopPropagation();
        const wrapper = bellBtn.closest('.topbar-dropdown-wrapper');
        const dropdown = wrapper ? wrapper.querySelector('.topbar-dropdown') : document.getElementById('notificationBellDropdown');
        if (dropdown) {
          const isOpen = dropdown.classList.contains('is-open');
          document.querySelectorAll('.topbar-dropdown').forEach(d => {
            if (d !== dropdown) d.classList.remove('is-open');
          });
          if (!isOpen) {
            if (typeof window.updateBellState === 'function') window.updateBellState();
            dropdown.classList.add('is-open');
          }
        }
        return;
      }

      // 6. Global Search Button Click (Event Delegation)
      const globalSearchBtn = e.target.closest('#globalSearchBtn');
      if (globalSearchBtn) {
        e.preventDefault();
        window.toggleGlobalSearchModal(true);
        return;
      }

      // 7. Outside Click: Close topbar dropdowns
      const openDropdowns = document.querySelectorAll('.topbar-dropdown.is-open');
      if (openDropdowns.length > 0) {
        openDropdowns.forEach(dropdown => {
          const wrapper = dropdown.closest('.topbar-dropdown-wrapper');
          if (wrapper && !wrapper.contains(e.target)) {
            dropdown.classList.remove('is-open');
          }
        });
      }
    });

    const wrappers = document.querySelectorAll('.nav-section-wrapper');

    // ====== SIDEBAR MENU FILTER/SEARCH ======
    const searchInput = document.getElementById('sidebarMenuSearch');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        
        wrappers.forEach(wrapper => {
          const items = wrapper.querySelectorAll('.nav-item');
          let hasMatch = false;
          
          items.forEach(item => {
            const text = item.textContent.trim();
            if (fuzzyMatch(text, query, 0.5)) {
              item.style.display = 'flex';
              hasMatch = true;
            } else {
              item.style.display = 'none';
            }
          });
          
          if (query.length > 0) {
            if (hasMatch) {
              wrapper.style.display = 'block';
            } else {
              wrapper.style.display = 'none';
            }
          } else {
            wrapper.style.display = 'block';
            items.forEach(item => item.style.display = 'flex');
          }
        });
      });
    }

    // Theme Toggle Logic
    const themeToggleBtn = document.getElementById('themeToggle');
    const themeIcon = document.getElementById('themeIcon');
    
    // Set initial icon based on applied theme
    if (document.body.classList.contains('light-mode')) {
      if (themeIcon) {
        themeIcon.classList.remove('bi-moon-fill');
        themeIcon.classList.add('bi-sun-fill');
      }
    }

    // Toggle Collapsible Filter Cards on Mobile
    document.addEventListener('click', (e) => {
      if (window.innerWidth > 768) return; // Desktop is expanded by default
      const header = e.target.closest('.card:has(#filterForm) .card-header');
      if (!header) return;
      
      // Prevent resetting when clicking reset link inside header
      if (e.target.closest('a')) return;

      const card = header.closest('.card');
      if (card) {
        card.classList.toggle('filter-expanded');
      }
    });


    // Dynamic Expand Table Feature
    const toggleCardExpand = (card, btn) => {
      if (!card) return;
      const isExpanded = card.classList.contains('card-expanded');

      if (isExpanded) {
        // ---- COLLAPSING ----
        card.classList.remove('card-expanded');
        document.body.classList.remove('has-expanded-card');
        if (btn) {
          btn.innerHTML = '<i class="bi bi-arrows-angle-expand"></i> <span class="btn-text-desktop">Expand</span>';
          btn.classList.remove('btn-danger');
          btn.classList.add('btn-secondary');
        }
        
        // Restore pagination controls if hidden
        card.querySelectorAll('.pagination, .pagination-controls, .table-pagination-bar').forEach(p => {
          p.style.display = '';
        });

        window.lastExpandedTableId = null;
      } else {
        // ---- EXPANDING (INFINITE SCROLL & ALL DATA DISPLAY) ----
        card.classList.add('card-expanded');
        document.body.classList.add('has-expanded-card');
        if (btn) {
          btn.innerHTML = '<i class="bi bi-fullscreen-exit"></i> <span class="btn-text-desktop">Collapse</span>';
          btn.classList.remove('btn-secondary');
          btn.classList.add('btn-danger');
        }

        // Hide pagination controls and display ALL table rows for infinite scroll
        card.querySelectorAll('.pagination, .pagination-controls, .table-pagination-bar').forEach(p => {
          p.style.display = 'none';
        });

        card.querySelectorAll('tbody tr').forEach(tr => {
          tr.style.display = '';
        });

        // Special handling for server-paginated pages (subsls & deteksi-anomali) to load ALL data when expanded
        if (window.location.pathname.includes('/subsls')) {
          const urlParams = new URLSearchParams(window.location.search);
          if (urlParams.get('limit') !== 'all') {
            urlParams.set('limit', 'all');
            if (typeof loadPage === 'function') {
              loadPage('/subsls?' + urlParams.toString());
            }
          }
        } else if (window.location.pathname.includes('/deteksi-anomali') && window.loadAnomalyPartial) {
          const urlParams = new URLSearchParams(window.location.search);
          if (urlParams.get('limit') !== 'all') {
            urlParams.set('limit', 'all');
            window.loadAnomalyPartial('/deteksi-anomali?' + urlParams.toString());
          }
        }

        const table = card.querySelector('table');
        if (table) {
          window.lastExpandedTableId = table.id;
        }

        // Fix sticky header offset after expanding
        requestAnimationFrame(() => fixStickyHeaderOffset(card));
      }
      window.dispatchEvent(new Event('resize'));

      // Attach or show spreadsheet editor overlay
      if (!isExpanded && card.classList.contains('card-expanded')) {
        setTimeout(() => {
          if (window.attachSpreadsheetEditor) window.attachSpreadsheetEditor(card);
          // Re-fix sticky offset after spreadsheet editor attaches (may alter header height)
          requestAnimationFrame(() => fixStickyHeaderOffset(card));
        }, 80);
      }
    };

    /**
     * Dynamically calculates the height of the first header row in expanded
     * tables and sets the --sticky-row1-h CSS custom property so the second
     * header row sticks at the correct offset. This prevents misalignment
     * caused by lazy-loaded fonts (Bootstrap Icons), dynamically-injected
     * filter buttons, or variable padding.
     */
    function fixStickyHeaderOffset(container) {
      const card = container?.closest?.('.card-expanded') || container;
      if (!card || !card.classList.contains('card-expanded')) return;

      const table = card.querySelector('table');
      if (!table) return;

      // Find the desktop thead (with 2 rows), skip mobile-only theads
      const theads = table.querySelectorAll('thead');
      let targetThead = null;
      for (const th of theads) {
        if (th.querySelectorAll('tr').length >= 2 && !th.classList.contains('show-sm-table-header')) {
          targetThead = th;
          break;
        }
      }
      if (!targetThead) return;

      const firstRow = targetThead.querySelector('tr:first-child');
      if (!firstRow) return;

      const rowHeight = firstRow.getBoundingClientRect().height;
      if (rowHeight > 0) {
        const tableWrap = table.closest('.table-wrap') || table.parentElement;
        if (tableWrap) {
          tableWrap.style.setProperty('--sticky-row1-h', rowHeight + 'px');
        }
      }
    }
    window.fixStickyHeaderOffset = fixStickyHeaderOffset;

    // Re-fix sticky offset when fonts finish loading (Bootstrap Icons are lazy-loaded)
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => {
        const expandedCard = document.querySelector('.card.card-expanded');
        if (expandedCard) fixStickyHeaderOffset(expandedCard);
      });
    }

    // Re-fix sticky offset on window resize
    window.addEventListener('resize', () => {
      const expandedCard = document.querySelector('.card.card-expanded');
      if (expandedCard) fixStickyHeaderOffset(expandedCard);
    });

    window.isElementHidden = (el) => {
      let current = el;
      while (current && current.tagName !== 'BODY') {
        const style = window.getComputedStyle(current);
        if (style && (style.display === 'none' || style.visibility === 'hidden')) {
          return true;
        }
        current = current.parentElement;
      }
      return false;
    };

    window.getCleanTableClone = (tableId) => {
      const original = document.getElementById(tableId);
      if (!original) return null;

      const clone = original.cloneNode(true);
      const origRows = original.querySelectorAll('tr');
      const cloneRows = clone.querySelectorAll('tr');

      for (let r = 0; r < origRows.length; r++) {
        const origRow = origRows[r];
        const cloneRow = cloneRows[r];

        if (window.isElementHidden(origRow)) {
          cloneRow.remove();
          continue;
        }

        const origCells = origRow.querySelectorAll('th, td');
        const cloneCells = cloneRow.querySelectorAll('th, td');

        for (let c = 0; c < origCells.length; c++) {
          const origCell = origCells[c];
          const cloneCell = cloneCells[c];
          
          if (!cloneCell) continue;

          if (window.isElementHidden(origCell)) {
            cloneCell.remove();
          } else {
            // Remove export action buttons if any got cloned
            const exportActions = cloneCell.querySelector('.table-export-buttons');
            if (exportActions) exportActions.remove();

            let text = origCell.innerText || origCell.textContent || '';
            text = text.trim().replace(/\n+/g, ' ').replace(/\s+/g, ' ');
            cloneCell.textContent = text;
          }
        }
      }
      return clone;
    };

    window.exportTableToXLSX = async (tableId, title) => {
      Swal.fire({
        title: 'Menyiapkan Export...',
        text: 'Sedang memproses file Excel, harap tunggu.',
        allowOutsideClick: false,
        showConfirmButton: false,
        didOpen: () => {
          Swal.showLoading();
        }
      });
      try {
        await loadScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');
        const cleanTable = window.getCleanTableClone(tableId);
        if (!cleanTable) {
          Swal.close();
          return;
        }

        const wb = XLSX.utils.table_to_book(cleanTable, { raw: true });
        const filename = title.replace(/[^a-z0-9]/gi, '_').replace(/_+/g, '_').toLowerCase();
        XLSX.writeFile(wb, `${filename}.xlsx`);
        Swal.close();
      } catch (err) {
        console.error(err);
        Swal.fire({
          icon: 'error',
          title: 'Gagal Export',
          text: 'Gagal memuat pustaka XLSX.',
          confirmButtonText: 'Tutup'
        });
      }
    };

    window.exportTableToPDF = async (tableId, title) => {
      Swal.fire({
        title: 'Menyiapkan Export...',
        text: 'Sedang memproses dokumen PDF, harap tunggu.',
        allowOutsideClick: false,
        showConfirmButton: false,
        didOpen: () => {
          Swal.showLoading();
        }
      });
      try {
        // Load sequentially to prevent prototype registration race conditions
        await loadScript('/js/jspdf.umd.min.js?v=<%= appVersion %>');
        await loadScript('/js/jspdf.plugin.autotable.min.js?v=<%= appVersion %>');
        const cleanTable = window.getCleanTableClone(tableId);
        if (!cleanTable) {
          Swal.close();
          return;
        }

        const { jsPDF } = window.jspdf;
        const colCount = cleanTable.querySelector('tr') ? cleanTable.querySelector('tr').querySelectorAll('th, td').length : 0;
        const orientation = colCount > 6 ? 'l' : 'p';
        
        const doc = new jsPDF(orientation, 'pt', 'a4');
        
        doc.setFontSize(14);
        doc.text(title, 20, 30);

        doc.autoTable({
          html: cleanTable,
          startY: 45,
          theme: 'striped',
          styles: {
            fontSize: 8,
            cellPadding: 4,
          },
          headStyles: {
            fillColor: [59, 130, 246],
            textColor: 255,
            fontStyle: 'bold'
          },
          margin: { top: 40, bottom: 40, left: 20, right: 20 }
        });

        const filename = title.replace(/[^a-z0-9]/gi, '_').replace(/_+/g, '_').toLowerCase();
        doc.save(`${filename}.pdf`);
        Swal.close();
      } catch (err) {
        console.error(err);
        Swal.fire({
          icon: 'error',
          title: 'Gagal Export',
          text: 'Gagal memuat pustaka PDF.',
          confirmButtonText: 'Tutup'
        });
      }
    };

    window.showExportDialog = function(e) {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      window.location.href = '/export';
    };

    window.initTableExport = (container = document) => {
      const tables = container.querySelectorAll('table');
      tables.forEach(table => {
        const tableWrap = table.closest('.table-wrap');
        const card = table.closest('.card');
        if (!tableWrap && !card) return;

        if (table.dataset.exportInit === 'true') return;
        table.dataset.exportInit = 'true';

        if (!table.id) {
          table.id = 'table_' + Math.random().toString(36).substr(2, 9);
        }

        let title = 'data_export';
        if (card) {
          const cardTitleEl = card.querySelector('.card-title');
          if (cardTitleEl) {
            title = cardTitleEl.textContent.trim();
          }
        } else {
          const modal = table.closest('#globalDetailModal');
          if (modal) {
            const modalTitle = document.getElementById('globalDetailModalTitle');
            if (modalTitle) {
              title = modalTitle.textContent.trim();
            }
          }
        }

        // Consolidated single Export Dropdown Button to remove redundancy
        const exportDropdown = document.createElement('div');
        exportDropdown.className = 'topbar-dropdown-wrapper table-export-dropdown';
        exportDropdown.style.position = 'relative';
        exportDropdown.style.display = 'inline-block';

        exportDropdown.innerHTML = `
          <button class="btn btn-secondary btn-xs dropdown-toggle" type="button" title="Export Data Tabel" style="padding: 4px 10px; font-size: 11px; font-weight: 600;">
            <i class="bi bi-download"></i><span class="btn-text-desktop"> Export</span> <i class="bi bi-chevron-down" style="font-size: 9px; margin-left: 2px;"></i>
          </button>
          <div class="topbar-dropdown-menu export-menu-dropdown" style="display: none; position: absolute; right: 0; top: calc(100% + 4px); z-index: 1000; min-width: 150px; background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; box-shadow: 0 10px 25px rgba(0,0,0,0.25); padding: 4px;">
            <button type="button" class="export-opt-xlsx" style="display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 10px; font-size: 11px; font-weight: 500; border: none; background: transparent; color: var(--text-primary); cursor: pointer; border-radius: 6px; text-align: left;">
              <i class="bi bi-file-earmark-excel text-green" style="font-size: 13px;"></i> Excel (.xlsx)
            </button>
            <button type="button" class="export-opt-pdf" style="display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 10px; font-size: 11px; font-weight: 500; border: none; background: transparent; color: var(--text-primary); cursor: pointer; border-radius: 6px; text-align: left;">
              <i class="bi bi-file-pdf text-red" style="font-size: 13px;"></i> PDF (.pdf)
            </button>
          </div>
        `;

        const toggleBtn = exportDropdown.querySelector('.dropdown-toggle');
        const menu = exportDropdown.querySelector('.export-menu-dropdown');

        toggleBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const isVisible = menu.style.display === 'block';
          document.querySelectorAll('.export-menu-dropdown').forEach(m => m.style.display = 'none');
          menu.style.display = isVisible ? 'none' : 'block';
        });

        exportDropdown.querySelector('.export-opt-xlsx').addEventListener('click', (e) => {
          e.preventDefault();
          menu.style.display = 'none';
          window.exportTableToXLSX(table.id, title);
        });

        exportDropdown.querySelector('.export-opt-pdf').addEventListener('click', (e) => {
          e.preventDefault();
          menu.style.display = 'none';
          window.exportTableToPDF(table.id, title);
        });

        document.addEventListener('click', () => {
          menu.style.display = 'none';
        });

        if (card) {
          const header = card.querySelector('.card-header');
          if (header) {
            let actionsWrap = header.querySelector('.card-actions');
            if (!actionsWrap) {
              actionsWrap = document.createElement('div');
              actionsWrap.className = 'card-actions';
              actionsWrap.style.display = 'flex';
              actionsWrap.style.gap = '8px';
              actionsWrap.style.alignItems = 'center';
              actionsWrap.style.marginLeft = 'auto';

              const children = Array.from(header.children);
              if (children.length > 1) {
                for (let i = 1; i < children.length; i++) {
                  actionsWrap.appendChild(children[i]);
                }
              }
              header.appendChild(actionsWrap);
            }
            actionsWrap.insertBefore(exportDropdown, actionsWrap.firstChild);
          } else {
            const target = tableWrap || table;
            const wrap = document.createElement('div');
            wrap.style.display = 'flex';
            wrap.style.justifyContent = 'flex-end';
            wrap.style.marginBottom = '8px';
            wrap.appendChild(exportDropdown);
            target.parentNode.insertBefore(wrap, target);
          }
        } else {
          const target = tableWrap || table;
          const wrap = document.createElement('div');
          wrap.style.display = 'flex';
          wrap.style.justifyContent = 'flex-end';
          wrap.style.marginBottom = '8px';
          wrap.appendChild(btnGroup);
          target.parentNode.insertBefore(wrap, target);
        }
      });
    };

    window.initExpandButtons = (container = document) => {
      container.querySelectorAll('.card').forEach(card => {
        const tableWrap = card.querySelector('.table-wrap');
        if (!tableWrap) return;
        if (card.querySelector('#kecOverviewTable')) return;

        const header = card.querySelector('.card-header');
        if (header) {
          if (header.querySelector('.btn-expand-table')) return;

          let actionsWrap = header.querySelector('.card-actions');
          if (!actionsWrap) {
            actionsWrap = document.createElement('div');
            actionsWrap.className = 'card-actions';
            actionsWrap.style.display = 'flex';
            actionsWrap.style.gap = '8px';
            actionsWrap.style.alignItems = 'center';
            actionsWrap.style.marginLeft = 'auto';

            const children = Array.from(header.children);
            if (children.length > 1) {
              for (let i = 1; i < children.length; i++) {
                actionsWrap.appendChild(children[i]);
              }
            }
            header.appendChild(actionsWrap);
          }

          const expandBtn = document.createElement('button');
          expandBtn.type = 'button';
          expandBtn.className = 'btn btn-secondary btn-xs btn-expand-table';
          expandBtn.setAttribute('title', 'Perluas / Fullscreen Tabel');
          expandBtn.style.padding = '4px 8px';
          expandBtn.style.fontSize = '11px';
          expandBtn.style.display = 'inline-flex';
          expandBtn.style.alignItems = 'center';
          expandBtn.style.gap = '4px';
          expandBtn.innerHTML = '<i class="bi bi-arrows-angle-expand"></i> <span class="btn-text-desktop">Expand</span>';

          const toggleHandler = (e) => {
            e.preventDefault();
            toggleCardExpand(card, expandBtn);
          };

          expandBtn.addEventListener('click', toggleHandler);

          actionsWrap.appendChild(expandBtn);

          const table = card.querySelector('table');
          if (table && document.body.classList.contains('has-expanded-card') && window.lastExpandedTableId === table.id) {
            setTimeout(() => {
              toggleCardExpand(card, expandBtn);
            }, 50);
          }
        }
      });

      if (window.initTableExport) {
        window.initTableExport(container);
      }
    };

    window.initExpandButtons(document);




    // Close expanded table on ESC key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const expandedCard = document.querySelector('.card.card-expanded');
        if (expandedCard) {
          const btn = expandedCard.querySelector('.btn-expand-table');
          if (btn) {
            toggleCardExpand(expandedCard, btn);
          }
        }
      }
    }, true);

    window.shareElementAsImage = async (elementId, event) => {
      const element = document.getElementById(elementId);
      if (!element) return;

      const btn = event ? event.currentTarget : null;
      const originalHtml = btn ? btn.innerHTML : '';
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true" style="width: 11px; height: 11px; border-width: 1.5px; margin-right: 4px;"></span> Membagikan...';
      }

      const resetBtn = (status, btnClass) => {
        if (btn) {
          btn.innerHTML = status;
          btn.classList.remove('btn-secondary');
          btn.classList.add(btnClass);
          setTimeout(() => {
            btn.innerHTML = originalHtml;
            btn.classList.remove(btnClass);
            btn.classList.add('btn-secondary');
            btn.disabled = false;
          }, 2500);
        }
      };

      try {
        await loadScript('https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js');
        const canvas = await html2canvas(element, {
          backgroundColor: window.getComputedStyle(document.body).getPropertyValue('--bg-card') || '#ffffff',
          scale: 1.3,
          useCORS: true,
          logging: false,
          allowTaint: true,
          removeContainer: true,
          onclone: (clonedDoc) => {
            const clonedEl = clonedDoc.getElementById(elementId);
            if (clonedEl) {
              const elementsToHide = clonedEl.querySelectorAll(
                '.table-export-buttons, .btn-secondary, .btn-expand-table, .search-wrap, input, button, .btn'
              );
              elementsToHide.forEach(el => el.style.display = 'none');

              const scrollContainers = clonedEl.querySelectorAll(
                '#detailSubslsList, #detailPclList, #detailPmlList'
              );
              scrollContainers.forEach(container => {
                container.style.maxHeight = 'none';
                container.style.overflowY = 'visible';
                container.style.overflow = 'visible';
                container.style.height = 'auto';
              });
            }
          }
        });

        canvas.toBlob(async (blob) => {
          if (!blob) {
            resetBtn('<i class="bi bi-exclamation-triangle"></i> Gagal', 'btn-danger');
            return;
          }

          const file = new File([blob], `${elementId}.jpg`, { type: 'image/jpeg' });

          try {
            if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
              await navigator.share({
                files: [file],
                title: 'Kinerja Petugas SE2026 PPU',
                text: 'Berikut laporan progres kinerja petugas SE2026 PPU.'
              });
              resetBtn('<i class="bi bi-share"></i> Dibagikan!', 'btn-success');
            } else {
              const link = document.createElement('a');
              link.download = `${elementId}.jpg`;
              link.href = canvas.toDataURL('image/jpeg', 0.85);
              link.click();
              resetBtn('<i class="bi bi-download"></i> Diunduh!', 'btn-warning');
            }
          } catch (err) {
            console.error('Share failed or canceled:', err);
            if (err.name === 'AbortError') {
              if (btn) {
                btn.innerHTML = originalHtml;
                btn.disabled = false;
              }
            } else {
              const link = document.createElement('a');
              link.download = `${elementId}.jpg`;
              link.href = canvas.toDataURL('image/jpeg', 0.85);
              link.click();
              resetBtn('<i class="bi bi-download"></i> Diunduh!', 'btn-warning');
            }
          }
        }, 'image/jpeg', 0.85);
      } catch (error) {
        console.error('Error sharing element as image:', error);
        resetBtn('<i class="bi bi-exclamation-triangle"></i> Gagal', 'btn-danger');
      }
    };

    window.copyElementAsImage = async (elementId, event) => {
      const element = document.getElementById(elementId);
      if (!element) return;

      const btn = event ? event.currentTarget : null;
      const originalHtml = btn ? btn.innerHTML : '';
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true" style="width: 11px; height: 11px; border-width: 1.5px; margin-right: 4px;"></span> Menyalin...';
      }

      const resetBtn = (status, btnClass) => {
        if (btn) {
          btn.innerHTML = status;
          btn.classList.remove('btn-secondary');
          btn.classList.add(btnClass);
          setTimeout(() => {
            btn.innerHTML = originalHtml;
            btn.classList.remove(btnClass);
            btn.classList.add('btn-secondary');
            btn.disabled = false;
          }, 2500);
        }
      };

      try {
        await loadScript('https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js');
        const canvas = await html2canvas(element, {
          backgroundColor: window.getComputedStyle(document.body).getPropertyValue('--bg-card') || '#ffffff',
          scale: 1.3,
          useCORS: true,
          logging: false,
          allowTaint: true,
          removeContainer: true,
          onclone: (clonedDoc) => {
            const clonedEl = clonedDoc.getElementById(elementId);
            if (clonedEl) {
              const elementsToHide = clonedEl.querySelectorAll(
                '.table-export-buttons, .btn-secondary, .btn-expand-table, .search-wrap, input, button, .btn'
              );
              elementsToHide.forEach(el => el.style.display = 'none');

              const scrollContainers = clonedEl.querySelectorAll(
                '#detailSubslsList, #detailPclList, #detailPmlList'
              );
              scrollContainers.forEach(container => {
                container.style.maxHeight = 'none';
                container.style.overflowY = 'visible';
                container.style.overflow = 'visible';
                container.style.height = 'auto';
              });
            }
          }
        });

        canvas.toBlob(async (blob) => {
          if (!blob) {
            resetBtn('<i class="bi bi-exclamation-triangle"></i> Gagal', 'btn-danger');
            return;
          }

          try {
            const item = new ClipboardItem({ 'image/png': blob });
            await navigator.clipboard.write([item]);
            resetBtn('<i class="bi bi-check-lg"></i> Disalin!', 'btn-success');
          } catch (err) {
            console.error('Clipboard copy failed, downloading instead:', err);
            const link = document.createElement('a');
            link.download = `${elementId}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();
            resetBtn('<i class="bi bi-download"></i> Diunduh!', 'btn-warning');
          }
        }, 'image/png');
      } catch (error) {
        console.error('Error copying element as image:', error);
        resetBtn('<i class="bi bi-exclamation-triangle"></i> Gagal', 'btn-danger');
      }
    };

    function getSkeletonHTML(url) {
      let path = '';
      try {
        path = new URL(url, window.location.origin).pathname;
      } catch (e) {
        path = url;
      }

      const isMobile = window.innerWidth <= 768;

      // Title & Breadcrumb skeleton (Adaptive)
      const titleSkeleton = `
        <div style="display: flex; flex-direction: column; gap: 6px; margin-bottom: 20px;">
          <div class="skeleton-block" style="height: 12px; width: ${isMobile ? '80px' : '120px'}; border-radius: 4px;"></div>
          <div class="skeleton-block" style="height: 28px; width: ${isMobile ? '180px' : '280px'}; border-radius: 6px;"></div>
        </div>
      `;

      // Helper for stat row (Adaptive)
      const getStatRow = (count) => {
        const gridTemplate = isMobile ? 'repeat(2, 1fr)' : `repeat(${count}, 1fr)`;
        const cardHeight = isMobile ? '88px' : '90px';
        const cardCount = isMobile ? Math.min(count, 4) : count;
        return `
          <div class="skeleton-stat-row" style="display: grid; grid-template-columns: ${gridTemplate}; gap: ${isMobile ? '10px' : '16px'}; margin-bottom: 20px;">
            ${Array(cardCount).fill().map(() => `<div class="skeleton-stat-card skeleton-block" style="height: ${cardHeight}; border-radius: 12px; border: 1px solid var(--border);"></div>`).join('')}
          </div>
        `;
      };

      // Helper for table (Adaptive: fewer columns on mobile)
      const getTableSkeleton = (rows = 5, cols = 5) => {
        const displayCols = isMobile ? Math.min(cols, 3) : cols;
        const colTemplate = `40px repeat(${displayCols - 1}, 1fr)`;
        return `
          <div class="skeleton-table-wrap" style="border: 1px solid var(--border); border-radius: 12px; padding: 16px; margin-bottom: 20px; background: var(--bg-card);">
            <div class="skeleton-table-header skeleton-block" style="height: 16px; width: 150px; margin-bottom: 20px;"></div>
            ${Array(rows).fill().map(() => `
              <div class="skeleton-table-row" style="display: grid; grid-template-columns: ${colTemplate}; gap: 12px; margin-bottom: 12px; border-bottom: 1px solid var(--border-subtle); padding-bottom: 8px;">
                ${Array(displayCols).fill().map((_, i) => `<div class="skeleton-block" style="height: 14px; border-radius: 4px; ${i === 0 ? 'width: 24px;' : ''}"></div>`).join('')}
              </div>
            `).join('')}
          </div>
        `;
      };

      // 1. MAP PAGE (Adaptive)
      if (path === '/map') {
        return `
          <div class="skeleton-page">
            ${titleSkeleton}
            <div style="display: flex; gap: 16px; height: ${isMobile ? 'auto' : '500px'}; flex-direction: ${isMobile ? 'column' : 'row'}; flex-wrap: wrap;">
              <div class="skeleton-block" style="width: ${isMobile ? '100%' : '280px'}; height: ${isMobile ? '200px' : '100%'}; min-width: 240px; border-radius: 12px; border: 1px solid var(--border);"></div>
              <div class="skeleton-block" style="flex: 1; min-width: 300px; height: ${isMobile ? '350px' : '100%'}; border-radius: 12px; border: 1px solid var(--border);"></div>
            </div>
          </div>
        `;
      }

      // 2. HELP PAGE
      if (path === '/help') {
        return `
          <div class="skeleton-page" style="max-width: 800px; margin: 0 auto;">
            ${titleSkeleton}
            <div class="skeleton-block" style="height: 48px; margin-bottom: 24px; border-radius: 10px;"></div>
            <div style="display: flex; flex-direction: column; gap: 12px;">
              ${Array(isMobile ? 3 : 4).fill().map(() => `
                <div class="skeleton-block" style="height: 54px; border-radius: 8px;"></div>
              `).join('')}
            </div>
          </div>
        `;
      }

      // 3. PCL / PML / KORLAP / KECAMATAN (Adaptive)
      if (path === '/pcl' || path === '/pml' || path === '/korlap' || path === '/kecamatan') {
        return `
          <div class="skeleton-page">
            ${titleSkeleton}
            <!-- Filter Bar -->
            <div class="skeleton-block" style="height: 60px; border-radius: 12px; margin-bottom: 20px;"></div>
            
            <!-- Main Content Area -->
            <div style="display: grid; grid-template-columns: ${isMobile ? '1fr' : '2fr 1.2fr'}; gap: 16px;">
              <!-- Left/Top: Table -->
              ${getTableSkeleton(isMobile ? 6 : 8, 6)}
              <!-- Right/Bottom: Detail panel -->
              <div class="skeleton-block" style="height: 380px; border-radius: 12px; border: 1px solid var(--border); ${isMobile ? '' : 'position: sticky; top: 80px;'}"></div>
            </div>
          </div>
        `;
      }

      // 4. DETAIL SUB-SLS (Adaptive)
      if (path === '/subsls') {
        return `
          <div class="skeleton-page">
            ${titleSkeleton}
            <!-- Large Filter Card -->
            <div class="skeleton-block" style="height: ${isMobile ? '160px' : '120px'}; border-radius: 12px; margin-bottom: 20px;"></div>
            
            <div style="display: grid; grid-template-columns: ${isMobile ? '1fr' : '2fr 1.2fr'}; gap: 16px;">
              <!-- Left/Top: Table -->
              ${getTableSkeleton(isMobile ? 6 : 10, 6)}
              <!-- Right/Bottom: Detail Panel -->
              <div style="display: flex; flex-direction: column; gap: 16px;">
                <div class="skeleton-block" style="height: 280px; border-radius: 12px; border: 1px solid var(--border);"></div>
                <div class="skeleton-block" style="height: 180px; border-radius: 12px; border: 1px solid var(--border);"></div>
              </div>
            </div>
          </div>
        `;
      }

      // 5. KIPP & PBI
      if (path === '/kipp' || path === '/pbi') {
        return `
          <div class="skeleton-page">
            ${titleSkeleton}
            ${getStatRow(4)}
            ${getTableSkeleton(isMobile ? 6 : 10, 6)}
          </div>
        `;
      }

      // 6. DETEKSI ANOMALI
      if (path === '/deteksianomali') {
        return `
          <div class="skeleton-page">
            ${titleSkeleton}
            <div class="skeleton-block" style="height: 60px; border-radius: 12px; margin-bottom: 20px;"></div>
            ${getTableSkeleton(isMobile ? 6 : 8, 6)}
          </div>
        `;
      }

      // 7. UPLOAD ADMIN (Adaptive)
      if (path === '/admin/upload') {
        const uploadCols = isMobile ? '1fr' : 'repeat(auto-fit, minmax(220px, 1fr))';
        return `
          <div class="skeleton-page">
            ${titleSkeleton}
            <!-- 3 Upload Zones -->
            <div style="display: grid; grid-template-columns: ${uploadCols}; gap: 16px; margin-bottom: 20px;">
              <div class="skeleton-block" style="height: 180px; border-radius: 12px;"></div>
              <div class="skeleton-block" style="height: 180px; border-radius: 12px;"></div>
              <div class="skeleton-block" style="height: 180px; border-radius: 12px;"></div>
            </div>
            <!-- Target Honor Card -->
            <div class="skeleton-block" style="height: 120px; border-radius: 12px; margin-bottom: 20px;"></div>
            <!-- History Table -->
            ${getTableSkeleton(6, 6)}
          </div>
        `;
      }

      // 8. SETTINGS ADMIN (Adaptive)
      if (path === '/admin/settings') {
        const settingsCols = isMobile ? '1fr' : 'repeat(auto-fit, minmax(300px, 1fr))';
        return `
          <div class="skeleton-page">
            ${titleSkeleton}
            <div style="display: grid; grid-template-columns: ${settingsCols}; gap: 16px;">
              <div class="skeleton-block" style="height: 250px; border-radius: 12px;"></div>
              <div class="skeleton-block" style="height: 250px; border-radius: 12px;"></div>
            </div>
          </div>
        `;
      }

      // 8.5. ADMIN MENU CARDS (Adaptive)
      if (path === '/admin') {
        const menuCols = isMobile ? '1fr' : 'repeat(auto-fill, minmax(300px, 1fr))';
        return `
          <div class="skeleton-page">
            ${titleSkeleton}
            <div style="display: grid; grid-template-columns: ${menuCols}; gap: 20px;">
              ${Array(isMobile ? 4 : 6).fill().map(() => `<div class="skeleton-block" style="height: 180px; border-radius: 16px;"></div>`).join('')}
            </div>
          </div>
        `;
      }

      // 9. OVERVIEW / DEFAULT (Adaptive)
      const isEarlyWarning = path === '/early-warning';
      const cardCount = isEarlyWarning ? 5 : 4;
      const mainRowCols = isMobile ? '1fr' : '2fr 1.2fr';
      return `
        <div class="skeleton-page">
          ${titleSkeleton}
          ${getStatRow(cardCount)}
          <div class="skeleton-main-row" style="display: grid; grid-template-columns: ${mainRowCols}; gap: 16px; margin-bottom: 20px;">
            <div class="skeleton-chart skeleton-block" style="height: 300px; border-radius: 12px;"></div>
            <div class="skeleton-list" style="height: 300px; border-radius: 12px; border: 1px solid var(--border); padding: 16px; ${isMobile ? 'display: none;' : ''}">
              <div class="skeleton-block" style="height: 18px; width: 140px; margin-bottom: 12px; border-radius: 4px;"></div>
              ${Array(6).fill().map(() => `<div class="skeleton-block" style="height: 18px; border-radius: 6px;"></div>`).join('')}
            </div>
          </div>
          ${getTableSkeleton(6, 6)}
        </div>
      `;
    }

    // PJAX router for seamless AJAX page transitions without reloading the sidebar
    async function loadPage(url, pushState = true) {
      // Clean up any expanded cards & spreadsheet overlays before navigating away
      const expandedCards = document.querySelectorAll('.card.card-expanded');
      expandedCards.forEach(card => {
        card.classList.remove('card-expanded');
        card.classList.remove('has-sheet-overlay');
        card.classList.remove('sheet-edit-mode');
      });
      document.body.classList.remove('has-expanded-card');
      window.lastExpandedTableId = null;

      // Dispatch pjax:start event so spreadsheet-editor & other modules clean up
      window.dispatchEvent(new CustomEvent('pjax:start'));

      // Clean up active spreadsheet editors & lingering overlay DOM nodes
      if (window._sheetEditors) {
        Object.values(window._sheetEditors).forEach(ed => {
          try { ed.destroy(); } catch (_) {}
        });
        window._sheetEditors = {};
      }
      document.querySelectorAll('.sheet-overlay, .sheet-toolbar, .sheet-formula-bar, .sheet-col-panel, .sheet-dialog, .sheet-ctx-menu, .sheet-backdrop').forEach(el => {
        try { el.remove(); } catch (_) {}
      });

      const oldContent = document.getElementById('pjax-container');

      const loader = document.getElementById('topLoadingBar');
      if (loader) {
        loader.classList.remove('finished');
        loader.classList.remove('loading');
        void loader.offsetWidth;
        loader.classList.add('loading');
      }

      // ⏳ Skeleton Threshold Timer (250ms Threshold)
      // Halaman yang merespon secara instan (< 250ms) tidak akan memicu skeleton loader
      let skeletonTimer = null;
      if (oldContent) {
        skeletonTimer = setTimeout(() => {
          if (oldContent && document.getElementById('pjax-container') === oldContent) {
            oldContent.innerHTML = getSkeletonHTML(url);
            const overlay = document.getElementById('pjax-loading-overlay');
            if (overlay) overlay.classList.add('active');
          }
        }, 250);
      }

      try {
      // Fetch target page
      const response = await fetch(url);
      if (response.status === 401 || response.redirected || (response.url && response.url.includes('/login'))) {
        window.location.href = '/login';
        return;
      }
      if (!response.ok) {
        window.location.href = url;
        return;
      }

      const htmlText = await response.text();
      const parser = new DOMParser();
      const targetDoc = parser.parseFromString(htmlText, 'text/html');

      if (!oldContent) {
        window.location.href = url;
        return;
      }

      if (targetDoc) {
        const newContent = targetDoc.getElementById('pjax-container');
        if (newContent) {
          if (window._pjaxCleanups && window._pjaxCleanups.length) {
            window._pjaxCleanups.forEach(item => {
              window.removeEventListener(item.type, item.listener, item.options);
            });
            window._pjaxCleanups = [];
          }

          // Swap content immediately and trigger smooth layout entrance animation
          oldContent.innerHTML = newContent.innerHTML;
          oldContent.classList.remove('pjax-animate-enter');
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              oldContent.classList.add('pjax-animate-enter');
            });
          });
          setTimeout(() => {
            oldContent.classList.remove('pjax-animate-enter');
          }, 400);
        } else {
          window.location.href = url;
          return;
        }
      } else {
        window.location.href = url;
        return;
      }

      if (targetDoc) {
        // Sync page-specific body layout classes (page-agent, page-map, page-login)
        const pageClasses = ['page-agent', 'page-map', 'page-login'];
        pageClasses.forEach(cls => {
          if (targetDoc.body.classList.contains(cls)) {
            document.body.classList.add(cls);
          } else {
            document.body.classList.remove(cls);
          }
        });

        // Update document title
        document.title = targetDoc.title || document.title;

        // Update Topbar Title
        const newTopbarTitle = targetDoc.querySelector('.topbar-title');
        const oldTopbarTitle = document.querySelector('.topbar-title');
        if (newTopbarTitle && oldTopbarTitle) {
          oldTopbarTitle.innerHTML = newTopbarTitle.innerHTML;
        }

        // Update Topbar Subtitle
        const newTopbarSubtitle = targetDoc.querySelector('.topbar-subtitle');
        const oldTopbarSubtitle = document.querySelector('.topbar-subtitle');
        if (newTopbarSubtitle && oldTopbarSubtitle) {
          oldTopbarSubtitle.innerHTML = newTopbarSubtitle.innerHTML;
        }

        // Update Topbar Actions (e.g. Upload Data button visibility)
        const newTopbarActions = targetDoc.querySelector('.topbar-actions');
        const oldTopbarActions = document.querySelector('.topbar-actions');
        if (newTopbarActions && oldTopbarActions) {
          oldTopbarActions.innerHTML = newTopbarActions.innerHTML;
          // Re-initialize notification bell after swapping topbar actions
          if (typeof window.initNotificationBell === 'function') {
            window.initNotificationBell();
          }
        }

        // Sync theme toggle icon after PJAX page swap
        const themeIcon = document.getElementById('themeIcon');
        if (themeIcon) {
          const isLight = document.body.classList.contains('light-mode');
          if (isLight) {
            themeIcon.classList.remove('bi-moon-fill');
            themeIcon.classList.add('bi-sun-fill');
          } else {
            themeIcon.classList.remove('bi-sun-fill');
            themeIcon.classList.add('bi-moon-fill');
          }
        }

        // Update Sidebar/Bottomnav Active Classes
        const targetPath = new URL(url, window.location.origin).pathname;
        
        // Sidebar items
        document.querySelectorAll('.sidebar .nav-item').forEach(item => {
          const itemHref = item.getAttribute('href');
          if (itemHref) {
            const itemPath = new URL(itemHref, window.location.origin).pathname;
            if (itemPath === targetPath || (targetPath === '/' && itemPath === '/')) {
              item.classList.add('active');
            } else {
              item.classList.remove('active');
            }
          }
        });

        // Bottom nav items
        updateBottomNavActiveState(targetPath);

        // Update browser URL
        if (pushState) {
          history.pushState({ url }, '', url);
        }

        // Close sidebar drawer overlay on mobile after clicking
        const sidebarEl = document.getElementById('sidebar');
        const sidebarOverlayEl = document.getElementById('sidebarOverlay');
        const mainToggleBtn = document.getElementById('sidebarToggle');
        if (sidebarEl) sidebarEl.classList.remove('active');
        if (sidebarOverlayEl) sidebarOverlayEl.classList.remove('active');
        if (mainToggleBtn) mainToggleBtn.setAttribute('aria-expanded', 'false');

        // Execute script elements inside the new content sequentially
        if (oldContent) {
          const scripts = Array.from(oldContent.querySelectorAll('script'));
          
          // Temporary proxy for document.addEventListener during PJAX script execution
          const originalDocAddEventListener = document.addEventListener;
          document.addEventListener = function(type, listener, options) {
            if (type === 'DOMContentLoaded') {
              try {
                listener();
              } catch (err) {
                console.error('Error executing DOMContentLoaded listener immediately:', err);
              }
              return;
            }
            return originalDocAddEventListener.call(this, type, listener, options);
          };

          async function executeScriptsSequentially(index) {
            if (index >= scripts.length) return;
            const script = scripts[index];
            const newScript = document.createElement('script');
            
            // Copy attributes
            for (let attr of script.attributes) {
              newScript.setAttribute(attr.name, attr.value);
            }
            newScript.textContent = script.textContent;

            const promise = new Promise((resolve) => {
              if (newScript.src) {
                newScript.onload = () => resolve();
                newScript.onerror = () => resolve(); // continue on error
              } else {
                resolve();
              }
            });

            script.parentNode.insertBefore(newScript, script.nextSibling);
            script.remove();

            await promise;
            await executeScriptsSequentially(index + 1);
          }

          try {
            await executeScriptsSequentially(0);
          } finally {
            // Always restore original addEventListener
            document.addEventListener = originalDocAddEventListener;
          }
        }

        // Complete loading bar progress
        if (loader) {
          loader.classList.remove('loading');
          loader.classList.add('finished');
        }

        // Re-initialize progress bars for the newly swapped page content
        if (typeof window.initProgressBars === 'function') {
          window.initProgressBars();
        }

        // Re-initialize Excel-like column filters for the newly swapped table
        if (typeof window.initExcelFilters === 'function') {
          window.initExcelFilters();
        }

        // Re-initialize expand buttons and table export buttons for the new page content
        if (typeof window.initExpandButtons === 'function') {
          window.initExpandButtons(document.getElementById('pjax-container'));
        }

        // Fix sticky header offset after expand/filter re-initialization
        // Delayed to allow auto-restore expand (50ms setTimeout) + spreadsheet editor attach (80ms)
        setTimeout(() => {
          const expandedCard = document.querySelector('.card.card-expanded');
          if (expandedCard && typeof window.fixStickyHeaderOffset === 'function') {
            window.fixStickyHeaderOffset(expandedCard);
          }
        }, 200);

        // Update breadcrumb navigation for the new page
        if (typeof updateBreadcrumbs === 'function') {
          updateBreadcrumbs(url);
        }

        // Sync bookmark pins state on the newly loaded page
        if (typeof window.syncPinButtons === 'function') {
          window.syncPinButtons();
        }
        if (typeof window.updatePinnedSidebar === 'function') {
          window.updatePinnedSidebar();
        }

        // Re-initialize date and weather rendering for the newly swapped page container
        if (typeof updateTime === 'function') {
          updateTime();
        }
        if (typeof renderWeatherFromCache === 'function') {
          renderWeatherFromCache();
        }
        if (typeof window.updateAiWidgetVisibility === 'function') {
          window.updateAiWidgetVisibility();
        }

        // Trigger window resize event so Leaflet maps, canvas charts, etc. recalculate container dimensions
        window.dispatchEvent(new Event('resize'));
      }

      } catch (err) {
        console.error('AJAX page navigation error:', err);
        window.location.href = url;
      } finally {
        if (skeletonTimer) {
          clearTimeout(skeletonTimer);
        }
        const overlayEl = document.getElementById('pjax-loading-overlay');
        if (overlayEl) {
          overlayEl.classList.remove('active');
        }
        // Hapus status loading secara global setelah navigasi selesai
        document.querySelectorAll('.btn-loading').forEach(btn => {
          btn.classList.remove('btn-loading');
        });
        document.querySelectorAll('.sidebar .nav-item, .bottom-nav .bottom-nav-item').forEach(item => {
          item.classList.remove('nav-item-loading');
        });
      }
    }
    window.loadPage = loadPage;

    // Intercept clicks on internal links
    document.addEventListener('click', (e) => {
      if (e.defaultPrevented) return;
      const a = e.target.closest('a');
      if (!a) return;

      // Skip hashes, JS calls, blank target, external targets, downloads, export, or portal page separation
      if (!href || href.startsWith('#') || href.startsWith('javascript:') || a.getAttribute('target') === '_blank' || a.hasAttribute('download') || href.includes('/export') || href.includes('/download') || href === '/surveys' || href.startsWith('/surveys') || window.location.pathname === '/surveys') {
        return;
      }
      
      // Ignore click handlers that open modals or are custom triggers
      if (a.getAttribute('onclick') || a.dataset.bsToggle || a.dataset.toggle) {
        return;
      }

      // Check if it is an internal page
      const isInternal = href.startsWith('/') || href.startsWith(window.location.origin);
      if (!isInternal) return;

      // Skip logout link
      if (href === '/logout' || href.endsWith('/logout')) {
        return;
      }

      e.preventDefault();
      
      // ⚡ INSTANT FEEDBACK (0ms): Langsung ubah warna menu yang diklik menjadi active tanpa menunggu load halaman!
      if (typeof window.setInstantMenuActive === 'function') {
        window.setInstantMenuActive(href);
      }
      
      const sidebarItem = a.closest('.sidebar .nav-item, .bottom-nav .bottom-nav-item');
      if (sidebarItem) {
        sidebarItem.classList.add('nav-item-loading');
      }
      
      loadPage(href);
    });

    function updateBottomNavActiveState(targetPath) {
      if (!targetPath) return;
      const prefix = window.navPrefix || '';
      const normalizedPath = (prefix && targetPath.startsWith(prefix)) 
        ? (targetPath.slice(prefix.length).replace(/\/$/, '') || '/') 
        : targetPath;

      const homeBtn = document.querySelector('.bottom-nav-item[href="' + (prefix || '') + '/"]') || document.querySelector('.bottom-nav-item[href="/"]');
      const wilayahBtn = document.getElementById('bottomNavWilayahBtn');
      const petugasBtn = document.getElementById('bottomNavPetugasBtn');
      const agentBtn = document.querySelector('.bottom-nav-item[href*="/agent"]');

      const wilayahPaths = ['/kecamatan', '/subsls', '/map', '/kipp', '/pbi'];
      const petugasPaths = ['/pcl', '/pml', '/korlap', '/performa', '/leaderboard', '/performa-terendah'];

      if (homeBtn) {
        if (normalizedPath === '/' || normalizedPath === '') homeBtn.classList.add('active');
        else homeBtn.classList.remove('active');
      }

      if (agentBtn) {
        if (normalizedPath === '/agent') agentBtn.classList.add('active');
        else agentBtn.classList.remove('active');
      }

      if (wilayahBtn) {
        if (wilayahPaths.includes(normalizedPath)) wilayahBtn.classList.add('active');
        else wilayahBtn.classList.remove('active');
      }

      if (petugasBtn) {
        if (petugasPaths.includes(normalizedPath)) petugasBtn.classList.add('active');
        else petugasBtn.classList.remove('active');
      }

      // Sync active state for popover sheet items
      document.querySelectorAll('.bottom-sheet-item').forEach(item => {
        const itemHref = item.getAttribute('href');
        if (itemHref) {
          const itemPath = new URL(itemHref, window.location.origin).pathname;
          if (itemPath === targetPath || (targetPath === '/' && itemPath === '/') || (normalizedPath === '/' && (itemPath === '/' || itemPath === (prefix + '/')))) {
            item.classList.add('active');
          } else {
            item.classList.remove('active');
          }
        }
      });
    }

    window.setInstantMenuActive = function(targetUrl) {
      if (!targetUrl) return;
      try {
        const targetPath = new URL(targetUrl, window.location.origin).pathname;
        if (targetPath === '/agent') {
          document.body.classList.add('page-agent');
          document.body.classList.remove('page-map');
        } else if (targetPath === '/map') {
          document.body.classList.add('page-map');
          document.body.classList.remove('page-agent');
        } else {
          document.body.classList.remove('page-agent');
          document.body.classList.remove('page-map');
        }

        document.querySelectorAll('.sidebar .nav-item').forEach(item => {
          const itemHref = item.getAttribute('href');
          if (itemHref) {
            const itemPath = new URL(itemHref, window.location.origin).pathname;
            if (itemPath === targetPath || (targetPath === '/' && itemPath === '/')) {
              item.classList.add('active');
            } else {
              item.classList.remove('active');
            }
          }
        });

        updateBottomNavActiveState(targetPath);
      } catch (_) {}
    };

    // Handle browser back/forward buttons
    window.addEventListener('popstate', (e) => {
      const url = (e.state && e.state.url) ? e.state.url : window.location.pathname + window.location.search;
      loadPage(url, false);
    });

    // Haptic Feedback API helper
    function triggerHaptic(duration = 15) {
      if (navigator.vibrate) {
        navigator.vibrate(duration);
      }
    }

    // Direct delegation for haptic feedback
    document.addEventListener('click', (e) => {
      const target = e.target.closest('.nav-item, .bottom-nav-item, .pin-btn, #themeToggle, #globalSearchBtn, .btn-close-sidebar, .card-pin-btn, .btn');
      if (target) {
        triggerHaptic(15);
      }
    });



    // Swipe-to-Close Gestures for Bottom Sheet on mobile
    let sheetStartY = 0;
    let sheetCurrentY = 0;
    let sheetDragging = false;
    const sheetCloseThreshold = 90;

    if (sidebar) {
      sidebar.addEventListener('touchstart', (e) => {
        if (window.innerWidth > 768) return; // only run on mobile bottom sheet
        
        const isHeader = e.target.closest('.sidebar-logo') || e.target.closest('.btn-close-sidebar') || e.target === sidebar || e.target.classList.contains('sidebar');
        const nav = sidebar.querySelector('.sidebar-nav');
        const isNavAtTop = nav ? nav.scrollTop === 0 : true;

        if (e.touches.length === 1 && (isHeader || isNavAtTop)) {
          sheetStartY = e.touches[0].pageY;
          sheetCurrentY = sheetStartY;
          sheetDragging = true;
          sidebar.style.transition = 'none'; // disable transition during active dragging
        }
      }, { passive: true });

      sidebar.addEventListener('touchmove', (e) => {
        if (!sheetDragging) return;
        sheetCurrentY = e.touches[0].pageY;
        const diff = sheetCurrentY - sheetStartY;
        
        if (diff > 0) {
          sidebar.style.transform = `translate3d(0, ${diff}px, 0)`;
        }
      }, { passive: true });

      sidebar.addEventListener('touchend', () => {
        if (!sheetDragging) return;
        sheetDragging = false;
        sidebar.style.transition = ''; // restore original transition
        
        const diff = sheetCurrentY - sheetStartY;
        if (diff > sheetCloseThreshold) {
          // Trigger close
          const closeBtn = document.getElementById('sidebarClose');
          if (closeBtn) {
            closeBtn.click();
          } else {
            sidebar.classList.remove('active');
            if (overlay) overlay.classList.remove('active');
          }
          triggerHaptic(15);
        } else {
          // Snap back
          sidebar.style.transform = '';
        }
      });
    }

    // Register Service Worker for PWA support
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
          .then((reg) => console.log('Service Worker registered successfully:', reg.scope))
          .catch((err) => console.error('Service Worker registration failed:', err));
      });
    }


    const updateTargetMode = async (payload) => {
      if (typeof Swal !== 'undefined') {
        Swal.fire({
          title: 'Memperbarui Target...',
          text: 'Mohon tunggu sejenak, data sedang disesuaikan.',
          allowOutsideClick: false,
          didOpen: () => {
            Swal.showLoading();
          }
        });
      }

      try {
        const response = await fetch('/api/settings/target-mode', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || ''
          },
          body: JSON.stringify({ ...payload, surveyId: window.activeSurveyId || undefined })
        });
        const result = await response.json();
        if (result.success) {
          window.location.reload();
        } else {
          if (typeof Swal !== 'undefined') {
            Swal.fire('Gagal', result.error || 'Terjadi kesalahan saat memperbarui target.', 'error');
          } else {
            alert(result.error || 'Terjadi kesalahan saat memperbarui target.');
          }
        }
      } catch (err) {
        if (typeof Swal !== 'undefined') {
          Swal.fire('Gagal', 'Koneksi server terputus.', 'error');
        } else {
          alert('Koneksi server terputus.');
        }
      }
    };

    document.addEventListener('change', (e) => {
      if (e.target.id === 'publicTargetFasihMode') {
        updateTargetMode({ target_fasih_mode: e.target.value });
      } else if (e.target.id === 'publicTargetMuatanMode') {
        updateTargetMode({ target_muatan_mode: e.target.value });
      }
    });

    // 1. Interceptor Form Submit Global untuk feedback instan & cegah double-submit
    document.addEventListener('submit', (e) => {
      // Cari tombol submit utama dalam form
      const submitBtn = e.target.querySelector('button[type="submit"], input[type="submit"]');
      if (submitBtn) {
        submitBtn.classList.add('btn-loading');
        
        // Revert kembali jika form default ditolak oleh JS validation di tengah jalan
        setTimeout(() => {
          if (e.defaultPrevented) {
            submitBtn.classList.remove('btn-loading');
          }
        }, 50);
      }
    });

    // 2. Interceptor klik tombol aksi/AJAX non-form
    document.addEventListener('click', (e) => {
      const actionBtn = e.target.closest('#viewEwModal, #sendTestBtn, .btn-action-trigger, button[data-action="loading"]');
      if (actionBtn && !actionBtn.classList.contains('btn-loading')) {
        actionBtn.classList.add('btn-loading');
      }
    });
  });
