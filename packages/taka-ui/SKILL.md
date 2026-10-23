---
name: taka-ui
description: >-
  Panduan perancangan dan implementasi antarmuka dashboard monitoring menggunakan
  Taka UI CSS Framework. Gunakan skill ini saat mendesain, membuat halaman baru,
  komponen stat card, tabel pemantauan data padat (high-density data tables),
  dual-navigation (sidebar desktop & mobile bottom nav dock), multi-theme survei
  (Orange SE2026, Cyan Sakernas, Purple Pendataan, Emerald, Sapphire), serta
  pengaturan tema Dark Mode (obsidian default) dan Light Mode (warm parchment).
---

# Taka UI — Modern Dashboard & Monitoring Design System Skill

Panduan operasional dan referensi arsitektur teknis perancangan antarmuka (*UI/UX design system manual*) untuk membangun dashboard pemantauan (*monitoring dashboard*), pusat kendali (*command center*), aplikasi operasional lapangan BPS / Gov-Tech, dan portal data analitik berbasis **Taka UI Framework**.

---

## 1. Filosofi & Prinsip Utama Desain

1. **Dark-First Command Center**:
   - Skema warna default menggunakan latar gelap obsidian (`#0f0f12`) dan kontainer kartu gelap bertekstur (`#1b1b24`).
   - Nyaman dipandang berjam-jam oleh operator dan pimpinan tanpa kelelahan mata (*eye-strain reduction*).
   - Selalu berlatar belakang ambient glow lembut di bagian atas layar:
     `radial-gradient(circle at 50% -20%, rgba(var(--accent-rgb), 0.08), transparent 70%)`.

2. **Warm Parchment Light Mode Alternative**:
   - Jika pengguna beralih ke mode terang (`body.light-mode`), antarmuka **TIDAK** menggunakan warna putih silau mentah (`#ffffff`).
   - Menggunakan warna kertas gading / perkamen hangat (*warm ivory / parchment* `#f5efe6` dan `#fdfcfb`) dengan teks charcoal legibel (`#0f172a`).

3. **Pure Multi-Theme Accent Isolation**:
   - Seluruh aksen tombol, badge, garis atas kartu statistik, dan grafik dapat berubah seketika hanya dengan memasang satu nama class tema pada tag `<body>`:
     * `theme-orange`: Radiant Orange & Amber (Sensus Ekonomi 2026).
     * `theme-cyan`: Electric Cyan & Oceanic Teal (Sakernas Listing).
     * `theme-purple`: Royal Violet & Indigo (Sakernas Pendataan CAPI).
     * `theme-emerald`: Emerald Prosperity & Gold (Pertanian / Keuangan).
     * `theme-blue`: Sapphire Enterprise & Sky Blue (Layanan Umum / Korporat).

4. **Mobile Dual-Navigation (Responsive Layout Architecture)**:
   - **Desktop (Layar > 992px)**: Sidebar tetap di sisi kiri selebar `260px` yang dapat diciutkan (*collapsible* ke 0).
   - **Mobile (Layar <= 992px)**: Sidebar beralih menjadi laci geser (*off-canvas drawer*), dan bagian bawah layar memunculkan *Frosted-Glass Bottom Nav Dock* (`backdrop-filter: blur(28px)`).

5. **High-Density Data Presentation (Data-Dense)**:
   - Informasi disajikan padat dan terstruktur tanpa membuang-buang ruang layar.
   - Tabel pemantauan wajib dibungkus dalam `.table-wrap` yang mendukung pergeseran sentuh horizontal halus (*touch-momentum scrolling*).
   - Nilai metrik angka disajikan dalam huruf tabular tebal (font-weight 800) dengan kode wilayah menggunakan font monospace.

6. **Tactile Micro-Interactions**:
   - Semua elemen interaktif (tombol, link navigasi, kartu klik) memiliki efek tekan instan:
     ```css
     :active {
       transform: scale(0.975) !important;
       transition: transform 0.08s ease-out !important;
     }
     ```

---

## 2. Token Desain & Skema Warna Resmi (CSS Variables)

Setiap kode yang dihasilkan harus menggunakan atau berpatokan pada variabel CSS ini:

```css
:root {
  /* Surface Dark Mode (Default) */
  --bg-primary: #0f0f12;
  --bg-secondary: #15151b;
  --bg-card: #1b1b24;
  --bg-card-hover: #23232f;
  --border: #292938;
  --border-light: #353549;
  --text-primary: #ffffff;
  --text-secondary: #f1f5f9;
  --text-muted: #94a3b8;

  /* Default Aksen (Orange SE2026) */
  --accent-primary: #f97316;
  --accent-primary-hover: #ea580c;
  --accent-secondary: #fbbf24;
  --accent-rgb: 249, 115, 22;
  --accent-gradient: linear-gradient(135deg, #f97316 0%, #ea580c 50%, #fbbf24 100%);
  --accent-glow: 0 16px 36px -8px rgba(249, 115, 22, 0.35);

  /* Semantik Status */
  --accent-green: #34d399;
  --accent-yellow: #fbbf24;
  --accent-red: #f87171;
  --accent-purple: #a78bfa;

  /* Elevasi & Geometri */
  --radius-sm: 8px;
  --radius: 12px;
  --radius-lg: 16px;
  --radius-pill: 999px;
  --shadow: 0 4px 24px rgba(0, 0, 0, 0.4);
  --header-height: 64px;
  --sidebar-width: 260px;
}

/* Light Mode (Warm Parchment) */
body.light-mode {
  --bg-primary: #f5efe6;
  --bg-secondary: #fdfcfb;
  --bg-card: #fdfcfb;
  --bg-card-hover: #ebe4d8;
  --border: #dfd5c6;
  --border-light: #d3c9b8;
  --text-primary: #0f172a;
  --text-secondary: #334155;
  --text-muted: #64748b;
  --accent-primary: #c2410c;
  --accent-green: #047857;
  --accent-yellow: #b45309;
  --accent-red: #b91c1c;
  --shadow: 0 4px 20px rgba(60, 51, 46, 0.05);
}
```

---

## 3. Skala Tipografi Standar (WCAG AA Compliant)

Model AI wajib mematuhi skala ukuran teks berikut saat merancang komponen:
* **Hero / Nilai Statistik Utama**: `24px` – `32px` (Weight: 800)
* **Header H1 / App Bar Title**: `20px` – `22px` (Weight: 700)
* **Sub-Header / Card Title**: `15px` – `18px` (Weight: 600 - 700)
* **Body Text (Konten Normal)**: `14px` – `16px` (Weight: 400 - 500)
* **Helper / Header Kolom Tabel / Input**: `12px` – `13px` (Weight: 600)
* **Badge / Caption / Kode SLS**: `10px` – `11px` (Weight: 700, `text-transform: uppercase`, `letter-spacing: 0.05em`)
* **Font Monospace**: `'Courier New', monospace` digunakan untuk kode SLS, NIK, ID petugas, atau koordinat spasial.

---

## 4. Blueprint Komponen UI Standar

Saat diminta membuat halaman atau komponen, selalu gunakan struktur HTML di bawah ini:

### A. Shell Layout (Topbar + Sidebar + Page Content + Bottom Nav)
```html
<body class="theme-orange">
  <!-- Mobile Backdrop Overlay -->
  <div class="sidebar-overlay" onclick="toggleSidebar()"></div>

  <!-- Sidebar -->
  <aside class="sidebar">
    <div class="sidebar-logo">
      <div class="logo-icon"><i class="bi bi-speedometer2"></i></div>
      <div class="sidebar-logo-text">
        <h1>Nama Dashboard</h1>
        <p>BPS Kabupaten PPU</p>
      </div>
    </div>
    <nav class="sidebar-nav">
      <div class="nav-section">Monitoring</div>
      <a href="#" class="nav-item active">
        <i class="bi bi-grid-fill nav-icon"></i>
        <span>Overview</span>
      </a>
      <a href="#" class="nav-item">
        <i class="bi bi-table nav-icon"></i>
        <span>Data Rekap</span>
      </a>
    </nav>
  </aside>

  <!-- Main Wrapper -->
  <div class="main-wrapper">
    <header class="topbar">
      <button class="topbar-action-btn" onclick="toggleSidebar()"><i class="bi bi-list"></i></button>
      <div class="topbar-title">Ringkasan Kegiatan Lapangan</div>
      <div class="topbar-actions">
        <button class="topbar-action-btn" onclick="toggleTheme()"><i class="bi bi-sun-fill"></i></button>
      </div>
    </header>

    <main class="page-content">
      <!-- Konten dinamis di sini -->
    </main>
  </div>

  <!-- Mobile Bottom Dock Nav -->
  <nav class="bottom-nav">
    <a href="#" class="bottom-nav-item active"><i class="bi bi-grid-fill"></i><span>Home</span></a>
    <a href="#" class="bottom-nav-item"><i class="bi bi-table"></i><span>Data</span></a>
    <button class="bottom-nav-item" onclick="toggleSidebar()"><i class="bi bi-list"></i><span>Menu</span></button>
  </nav>
</body>
```

### B. Signature Stat Card (Metric Box)
```html
<div class="stats-grid">
  <!-- Card Aksen Default -->
  <div class="stat-card">
    <span class="stat-label">Total Beban</span>
    <span class="stat-value">12.840</span>
    <span class="stat-sub">Dokumen Terdaftar</span>
    <i class="bi bi-folder-fill stat-icon"></i>
  </div>

  <!-- Card Hijau (Selesai/Aman) -->
  <div class="stat-card green">
    <span class="stat-label">Realisasi Selesai</span>
    <span class="stat-value text-success">9.420</span>
    <span class="stat-sub">73.4% dari Target</span>
    <i class="bi bi-check-circle-fill stat-icon"></i>
  </div>

  <!-- Card Kuning (Sedang Proses/At-Risk) -->
  <div class="stat-card yellow">
    <span class="stat-label">Dalam Proses</span>
    <span class="stat-value text-warning">2.110</span>
    <span class="stat-sub">Pemeriksaan Pengawas</span>
    <i class="bi bi-hourglass-split stat-icon"></i>
  </div>

  <!-- Card Merah (Tertunda/Kritis) -->
  <div class="stat-card red">
    <span class="stat-label">Tanpa Progres</span>
    <span class="stat-value text-danger">1.310</span>
    <span class="stat-sub">Perlu Atensi Lapangan</span>
    <i class="bi bi-exclamation-triangle-fill stat-icon"></i>
  </div>
</div>
```

### C. Data Table Padat (High-Density Monitoring Table)
> **Penting**: Card header (`.card-header`) dirancang bersih minimalis tanpa badge status di pojok kanan. Badge hanya digunakan di dalam baris sel tabel atau badan konten, bukan di pojok kanan header card.

```html
<div class="card">
  <div class="card-header">
    <div class="card-title">
      <i class="bi bi-table text-accent"></i>
      Rekapitulasi Progres Petugas
    </div>
  </div>

  <!-- Filter Toolbar -->
  <div class="filter-bar">
    <div class="search-input-wrap">
      <i class="bi bi-search search-icon"></i>
      <input type="search" placeholder="Cari nama / SLS...">
    </div>
    <select>
      <option value="">Semua Kecamatan</option>
    </select>
    <button class="btn btn-secondary">Terapkan</button>
  </div>

  <!-- Table Toolbar & Search -->
  <div class="table-toolbar">
    <div class="table-search">
      <i class="bi bi-search table-search-icon"></i>
      <input type="search" placeholder="Cari nama wilayah / SLS / petugas...">
    </div>
    <div class="d-flex items-center gap-2">
      <select style="min-width: 140px;">
        <option value="">Semua Status</option>
        <option>Selesai 100%</option>
        <option>On-Track</option>
        <option>Kritis (< 40%)</option>
      </select>
      <button class="btn btn-secondary"><i class="bi bi-download"></i> Ekspor CSV</button>
    </div>
  </div>

  <!-- Tabel Padat Responsif dengan Sticky Header & Sticky Kolom Pertama -->
  <div class="table-wrap table-sticky-header table-sticky-col">
    <table>
      <thead>
        <tr>
          <th rowspan="2" class="sortable sort-asc" style="width: 50px; text-align: center;">No</th>
          <th rowspan="2" class="sortable" style="min-width: 170px;">Nama Wilayah</th>
          <th rowspan="2" class="td-number bg-purple-soft" style="min-width: 150px;">Progres Lapangan</th>
          <th rowspan="2" class="td-number" style="min-width: 90px;">Target</th>
          <th colspan="3" class="text-center bg-cyan-soft" style="border-bottom: 1px solid var(--border);">Rincian Dokumen</th>
          <th rowspan="2" class="td-number" style="min-width: 90px;">Delta Harian</th>
          <th rowspan="2" class="text-center" style="width: 80px;">Status</th>
        </tr>
        <tr>
          <th class="td-number bg-cyan-soft status-draft-text" style="min-width: 70px;">Draft</th>
          <th class="td-number bg-cyan-soft status-submit-text" style="min-width: 75px;">Submit</th>
          <th class="td-number bg-cyan-soft status-approve-text" style="min-width: 80px;">Approved</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="text-center" style="font-weight: 700;">1</td>
          <td>
            <span class="td-primary">Kecamatan Penajam</span>
            <div class="td-code">KODE: 64.09.010</div>
          </td>
          <td class="bg-purple-soft">
            <div class="table-progress">
              <div class="table-progress-meta">
                <span class="table-progress-pct success">97.0%</span>
                <span class="table-progress-ratio">4.850 / 5.000</span>
              </div>
              <div class="table-progress-track">
                <div class="progress-bar green" style="width: 97%;"></div>
              </div>
            </div>
          </td>
          <td class="td-number">5.000</td>
          <td class="td-number bg-cyan-soft status-draft-text">120</td>
          <td class="td-number bg-cyan-soft status-submit-text">230</td>
          <td class="td-number bg-cyan-soft status-approve-text" style="font-weight: 700;">4.500</td>
          <td class="td-number td-delta-pos">+42 <span class="td-delta-sub">(dok)</span></td>
          <td class="text-center"><span class="badge badge-green badge-dot">Selesai</span></td>
        </tr>
      </tbody>
      <tfoot>
        <tr>
          <td colspan="2" class="tfoot-label">TOTAL AGREGAT</td>
          <td class="bg-purple-soft">
            <div class="table-progress">
              <div class="table-progress-meta">
                <span class="table-progress-pct" style="color: var(--accent-primary); font-weight: 800;">70.1%</span>
                <span class="table-progress-ratio">9.010 / 12.840</span>
              </div>
              <div class="table-progress-track">
                <div class="progress-bar" style="width: 70.1%;"></div>
              </div>
            </div>
          </td>
          <td class="td-number tfoot-total">12.840</td>
          <td class="td-number bg-cyan-soft status-draft-text" style="font-weight: 700;">735</td>
          <td class="td-number bg-cyan-soft status-submit-text" style="font-weight: 700;">1.190</td>
          <td class="td-number bg-cyan-soft status-approve-text" style="font-weight: 800;">7.085</td>
          <td class="td-number td-delta-pos" style="font-weight: 800;">+72</td>
          <td class="text-center"><span class="badge badge-blue">Kolektif</span></td>
        </tr>
      </tfoot>
    </table>
  </div>

  <!-- Pagination Bar -->
  <div class="table-pagination">
    <div>Menampilkan <strong>1-10</strong> dari <strong>54</strong> SLS</div>
    <div class="table-pagination-btns">
      <button class="page-btn disabled"><i class="bi bi-chevron-left"></i></button>
      <button class="page-btn active">1</button>
      <button class="page-btn">2</button>
      <button class="page-btn"><i class="bi bi-chevron-right"></i></button>
    </div>
  </div>
</div>
```

### D. Arsitektur Progres Bar & Milestone Tracker
```html
<!-- 1. Capsule Progress Bar Standar -->
<div class="progress-bar-wrap">
  <div class="progress-bar green" style="width: 85%;"></div>
</div>
<!-- Variasi warna: .green, .yellow, .red, .blue, .purple, .orange, .cyan -->

<!-- 2. Hero Milestone Timeline dengan Target Kumulatif (25% & 40%) -->
<div class="progress-timeline-container" style="height: 32px; margin-top: 18px; margin-bottom: 24px;">
  <div class="bg-progress-timeline" style="height: 18px;">
    <div class="progress-bar progress-bar-premium" style="width: 70.1%;">
      <span class="progress-bar-label">70.1%</span>
    </div>
  </div>
  <!-- Marker Target 25% (30 Juni) -->
  <div class="target-marker" style="left: 25%;">
    <span class="target-marker-text" style="top: -14px;">30 Jun: 25%</span>
  </div>
  <!-- Marker Target 40% (15 Juli - Aktif) -->
  <div class="target-marker active" style="left: 40%;">
    <span class="target-marker-text" style="bottom: -14px;">15 Jul: 40%</span>
  </div>
</div>

<!-- 3. Multi-Segment Stacked Bar (Distribusi Status Alur Kerja) -->
<div class="progress-stacked" style="height: 10px;">
  <div class="progress-bar yellow" style="width: 15%;" title="Draft: 15%"></div>
  <div class="progress-bar blue" style="width: 25%;" title="Submitted: 25%"></div>
  <div class="progress-bar green" style="width: 50%;" title="Approved: 50%"></div>
  <div class="progress-bar red" style="width: 10%;" title="Rejected: 10%"></div>
</div>

<!-- 4. Striped & Animated Loading Bar -->
<div class="progress-bar-wrap">
  <div class="progress-bar progress-bar-striped progress-bar-animated" style="width: 65%;"></div>
</div>
<!-- Indeterminate Loader (Animasi berulang tanpa nilai tetap) -->
<div class="progress-bar-wrap progress-indeterminate"></div>

<!-- 5. Circular Progress Ring KPI -->
<div class="progress-ring-wrap" style="width: 72px; height: 72px;">
  <svg width="72" height="72">
    <circle cx="36" cy="36" r="30" stroke="var(--bg-progress-wrap)" stroke-width="6" fill="transparent" />
    <circle cx="36" cy="36" r="30" stroke="var(--accent-primary)" stroke-width="6" stroke-dasharray="188.4" stroke-dashoffset="56.5" stroke-linecap="round" fill="transparent" class="progress-ring-circle" />
  </svg>
  <div class="progress-ring-text">
    <span class="progress-ring-pct" style="font-size: 16px;">70%</span>
  </div>
</div>
```

### E. Tombol & Badges Status Capsule
Semua tombol menggunakan estetika **Flat Crisp** bebas dari efek glow (`box-shadow: none !important`), dengan umpan balik taktil mikro `:active { transform: scale(0.975); }`.

```html
<!-- Tombol (Bebas Efek Glow) -->
<button class="btn btn-primary">Simpan Data</button>
<button class="btn btn-secondary">Batal</button>
<button class="btn btn-success">Setujui</button>
<button class="btn btn-danger">Hapus</button>

<!-- CTA Besar -->
<button class="btn-survey-cta">
  <span>Buka Dasbor Lengkap</span>
  <i class="bi bi-arrow-right"></i>
</button>

<!-- Badges Status Capsule (WCAG AA Compliant) -->
<span class="badge badge-green badge-dot">Aman / Selesai</span>
<span class="badge badge-yellow badge-dot">At-Risk / Warning</span>
<span class="badge badge-red badge-dot">Kritis / Tertunda</span>
<span class="badge badge-blue badge-dot">Aktif</span>
<span class="badge badge-purple badge-dot">Anomali</span>
<span class="badge badge-gray">Muted</span>
```

### F. Tampilan Code Program & Syntax Highlighting
Gunakan komponen ini untuk menampilkan blok kode teknis, query SQL, skrip automasi, atau format inline:

```html
<!-- Windowed Code Block dengan Header, Language Badge, & Copy Button -->
<div class="code-block">
  <div class="code-header">
    <div class="d-flex items-center gap-2">
      <div class="code-dots">
        <span class="code-dot red"></span>
        <span class="code-dot yellow"></span>
        <span class="code-dot green"></span>
      </div>
      <span class="code-title"><i class="bi bi-file-earmark-code"></i> monitor-sync.js</span>
    </div>
    <div class="d-flex items-center gap-2">
      <span class="code-lang-badge">JAVASCRIPT</span>
      <button class="code-copy-btn" onclick="copyCodeSnippet(this)">
        <i class="bi bi-clipboard"></i> Salin
      </button>
    </div>
  </div>
  <pre class="code-body"><code><span class="tok-comment">// Inisialisasi sinkronisasi data progres survei</span>
<span class="tok-keyword">import</span> { <span class="tok-type">TakaCharts</span>, <span class="tok-function">watchTheme</span> } <span class="tok-keyword">from</span> <span class="tok-string">'@bps/taka-ui'</span>;

<span class="tok-keyword">async function</span> <span class="tok-function">fetchSurveyProgress</span>(<span class="tok-var">surveyId</span> = <span class="tok-string">'SE2026'</span>) {
  <span class="tok-keyword">const</span> <span class="tok-var">endpoint</span> = <span class="tok-string">`/api/progress/${surveyId}`</span>;
  <span class="tok-keyword">const</span> <span class="tok-var">res</span> = <span class="tok-keyword">await</span> <span class="tok-function">fetch</span>(<span class="tok-var">endpoint</span>);
  <span class="tok-keyword">const</span> <span class="tok-var">data</span> = <span class="tok-keyword">await</span> <span class="tok-var">res</span>.<span class="tok-function">json</span>();
  <span class="tok-keyword">return</span> <span class="tok-var">data</span>;
}</code></pre>
</div>

<!-- Inline Code -->
<p>Konfigurasi tema dapat diatur melalui variabel <code>--accent-primary</code> dan class <code>.theme-orange</code>.</p>
```

### G. Overview Page Layout (Top Telemetry, Milestone Tracker, & Hero KPI)
Gunakan tata letak ini saat membangun halaman Overview Command Center:
```html
<!-- 1. Top Telemetry & AI Insight Grid -->
<div class="overview-top-grid">
  <!-- Telemetry Card (Weather / Clock) -->
  <div class="telemetry-card">
    <div class="telemetry-header">
      <div class="d-flex items-center gap-3">
        <div class="telemetry-icon-circle"><i class="bi bi-cloud-sun-fill" style="color: var(--accent-yellow);"></i></div>
        <div>
          <div style="font-size: 13px; font-weight: 700; color: var(--text-primary);">Penajam Paser Utara <span style="font-weight: 800; color: var(--accent-primary);">29°C</span></div>
          <div style="font-size: 11px; color: var(--text-secondary);">Kondisi Lapangan Cerah Berawan</div>
        </div>
      </div>
    </div>
  </div>

  <!-- AI Insight Card -->
  <div class="ai-insights-card">
    <i class="bi bi-robot ai-insights-watermark"></i>
    <h4 style="font-size: 14px; font-weight: 800; color: var(--text-primary); margin-bottom: 2px;">AI Smart Insights</h4>
    <p style="font-size: 11px; color: var(--text-secondary); margin: 0;">Analisis otomatis progres lapangan real-time.</p>
  </div>
</div>

<!-- 2. Milestone Target Tracker & Speedometer KPI -->
<div class="milestone-card">
  <div class="milestone-flex-wrap">
    <!-- Left: Timeline Progress & Status Breakdown -->
    <div class="milestone-left-panel">
      <div class="d-flex justify-between items-center mb-2">
        <h3 style="font-size: 15px; font-weight: 800; color: var(--text-primary); margin: 0;">Realisasi Kegiatan</h3>
        <div style="font-size: 24px; font-weight: 900; color: var(--accent-primary);">73.4%</div>
      </div>

      <!-- Timeline with Target Dashed Markers -->
      <div class="progress-timeline-container">
        <div class="bg-progress-timeline">
          <div class="progress-bar-premium" style="width: 73.4%;">
            <span style="font-size: 10px; font-weight: 800; color: #ffffff;">73.4%</span>
          </div>
        </div>
        <div class="target-marker" style="left: 25%;"><span class="target-marker-text top">M1: 25%</span></div>
        <div class="target-marker" style="left: 50%;"><span class="target-marker-text bottom">M2: 50%</span></div>
        <div class="target-marker active" style="left: 100%;"><span class="target-marker-text top" style="color: var(--accent-primary);">100%</span></div>
      </div>

      <!-- Status Breakdown Capsules -->
      <div class="status-breakdown-grid">
        <div class="status-card-capsule status-capsule-open">
          <div class="d-flex justify-between items-center"><span class="fs-caption fw-bold text-muted">OPEN</span><span style="font-weight: 800;">1.420</span></div>
        </div>
        <div class="status-card-capsule status-capsule-draft">
          <div class="d-flex justify-between items-center"><span class="fs-caption fw-bold text-muted">DRAFT</span><span style="font-weight: 800;">1.100</span></div>
        </div>
        <div class="status-card-capsule status-capsule-submit">
          <div class="d-flex justify-between items-center"><span class="fs-caption fw-bold text-muted">SUBMITTED</span><span style="font-weight: 800;">2.150</span></div>
        </div>
        <div class="status-card-capsule status-capsule-approve">
          <div class="d-flex justify-between items-center"><span class="fs-caption fw-bold text-muted">APPROVED</span><span style="font-weight: 800; color: var(--accent-green);">7.270</span></div>
        </div>
      </div>
    </div>

    <!-- Right: Hero Speedometer KPI -->
    <div class="milestone-right-panel">
      <div class="milestone-hero-card">
        <div style="width: 100%; height: 110px; position: relative;"><canvas id="gaugeSpeedCanvas"></canvas></div>
        <div class="milestone-hero-number mt-2">142</div>
        <div class="fs-sm fw-bold text-primary">Dokumen / Hari</div>
        <span class="badge badge-green badge-dot mt-2">On-Track</span>
      </div>
    </div>
  </div>
</div>
```

### F. Visualisasi Grafik (Chart.js & TakaCharts Integration)
Gunakan library `taka-charts.min.js` (atau konfigurasi Chart.js adaptif Taka UI) untuk grafik interaktif:
```html
<div class="charts-grid">
  <!-- Chart Card 1: Line Trend -->
  <div class="chart-card">
    <div class="chart-header">
      <div class="chart-title"><i class="bi bi-graph-up text-accent"></i> Tren Kumulatif Harian</div>
    </div>
    <div class="chart-canvas-wrap">
      <canvas id="trendChartCanvas"></canvas>
    </div>
  </div>

  <!-- Chart Card 2: Bar Regional -->
  <div class="chart-card">
    <div class="chart-header">
      <div class="chart-title"><i class="bi bi-bar-chart-fill text-accent"></i> Realisasi per Wilayah</div>
    </div>
    <div class="chart-canvas-wrap">
      <canvas id="regionalBarChartCanvas"></canvas>
    </div>
  </div>
</div>

<script>
  // Inisialisasi TakaCharts adaptif dark/light mode & tema
  TakaCharts.createTrendChart('trendChartCanvas', {
    labels: ['01 Okt', '05 Okt', '10 Okt', '15 Okt'],
    realisasi: [1200, 3400, 6800, 9420],
    target: [1500, 4000, 7500, 10000],
    unit: 'Dokumen'
  });

  TakaCharts.createBarChart('regionalBarChartCanvas', {
    labels: ['Penajam', 'Waru', 'Babulu', 'Sepaku'],
    selesai: [4850, 1620, 1800, 1150],
    total: [5420, 2180, 3240, 2000]
  });

  TakaCharts.createGaugeChart('gaugeSpeedCanvas', {
    value: 142,
    max: 180
  });

  // Otomatis update chart saat ganti tema atau dark/light mode
  TakaCharts.watchTheme();
</script>
```

### G. Liquid Glass (Ultra-Premium Glassmorphism)
Gunakan komponen Liquid Glass untuk panel mengambang (*floating command bar*), popup Leaflet/peta, dialog, filter kapsul, dan tombol aksi mengambang dengan efek specular highlight ganda (*dual-rim highlight*) ala Apple/iPhone:
```html
<!-- 1. Liquid Glass Card / Floating Panel -->
<div class="liquid-glass liquid-glass-card" style="max-width: 420px;">
  <!-- Drag Handle Indicator (Handle ala iOS) -->
  <div class="drag-pill-indicator"></div>
  <h4 style="font-size: 14px; font-weight: 800; margin-bottom: 6px;">Panel Kendali Mengambang</h4>
  <p style="font-size: 12px; color: var(--text-secondary); margin-bottom: 12px;">Liquid glass dengan blur 32px, saturasi 220%, dan specular highlight ganda.</p>
  
  <!-- Pill Filter Mengambang -->
  <div class="d-flex gap-2">
    <div class="liquid-glass liquid-glass-pill liquid-glass-active">Aktif</div>
    <div class="liquid-glass liquid-glass-pill">Semua</div>
  </div>
</div>

<!-- 2. Liquid Glass Circular Floating Button -->
<button class="liquid-glass-btn" title="GPS / Fullscreen">
  <i class="bi bi-geo-alt-fill"></i>
</button>
```

### H. Arsitektur Shell Lengkap (Sidebar, Topbar, Breadcrumbs & Bottom Sheet)
```html
<!-- Body dengan Tema dan Dukungan Breadcrumb -->
<body class="theme-orange has-breadcrumb">
  <!-- Mobile Backdrop Overlay -->
  <div class="sidebar-overlay" onclick="toggleSidebar()"></div>

  <!-- Sidebar Desktop & Mobile Off-Canvas Drawer -->
  <aside class="sidebar" id="sidebar">
    <div class="sidebar-logo">
      <div class="logo-icon"><i class="bi bi-speedometer2"></i></div>
      <div class="sidebar-logo-text">
        <h1>Pananyo Taka</h1>
        <p>Sistem Pemantauan Terpadu</p>
      </div>
      <button class="btn-close-sidebar" onclick="toggleSidebar()"><i class="bi bi-x-lg"></i></button>
    </div>

    <!-- Telemetry / Sync Widget -->
    <div class="sidebar-upload-info">
      <strong><i class="bi bi-cloud-check-fill"></i> Data Terkini</strong>
      <span>Sinkronisasi otomatis aktif</span>
    </div>

    <!-- Nav List dengan Accordion Sections -->
    <nav class="sidebar-nav">
      <div class="nav-section-wrapper">
        <div class="nav-section-header"><span>Menu Utama</span></div>
        <div class="nav-section-content">
          <a href="#" class="nav-item active">
            <span class="nav-icon icon-blue"><i class="bi bi-grid-fill"></i></span>
            <span class="nav-label">Overview</span>
            <span class="nav-badge">Live</span>
          </a>
          <a href="#" class="nav-item">
            <span class="nav-icon icon-emerald"><i class="bi bi-table"></i></span>
            <span class="nav-label">Data Rekapitulasi</span>
          </a>
        </div>
      </div>
    </nav>

    <!-- Sidebar Footer -->
    <div class="sidebar-footer">
      <div>
        <span style="font-weight: 700; color: var(--text-primary);">Taka UI v1.0</span><br>
        <span style="color: var(--text-muted); font-size: 10px;">© BPS PPU</span>
      </div>
      <span class="live-status-pill"><span class="live-pulse-dot"></span> Online</span>
    </div>
  </aside>

  <!-- Main Shell Wrapper -->
  <div class="main-wrapper">
    <!-- Topbar / Navbar -->
    <header class="topbar">
      <div class="topbar-left">
        <button class="topbar-action-btn" id="sidebarToggle" onclick="toggleSidebar()">
          <i class="bi bi-layout-sidebar-inset"></i>
        </button>
        <div class="topbar-title-container">
          <div class="topbar-title">Dashboard Pemantauan</div>
          <div class="topbar-subtitle">Penajam Paser Utara · SE2026</div>
        </div>
      </div>

      <!-- Center Search Command Bar -->
      <div class="topbar-search-wrapper">
        <div class="topbar-search-bar" onclick="toggleSearchModal(true)">
          <i class="bi bi-search topbar-search-icon"></i>
          <span class="topbar-search-placeholder">Pencarian cepat (Ctrl+K)...</span>
          <span class="topbar-search-shortcut"><kbd>Ctrl</kbd><kbd>K</kbd></span>
        </div>
      </div>

      <!-- Right Actions -->
      <div class="topbar-actions">
        <!-- Notification Bell dengan Radar Pulse -->
        <button class="topbar-action-btn" style="position: relative;">
          <i class="bi bi-bell-fill"></i>
          <span class="topbar-badge"></span>
        </button>
        <!-- Theme Toggle -->
        <button class="topbar-action-btn" onclick="toggleTheme()">
          <i id="themeIcon" class="bi bi-sun-fill"></i>
        </button>
      </div>
    </header>

    <!-- Breadcrumb Navigation Bar -->
    <nav class="breadcrumb-bar" id="breadcrumb-bar">
      <ul class="breadcrumb-list">
        <li class="breadcrumb-item"><a href="#"><i class="bi bi-house-door"></i> Beranda</a></li>
        <li class="breadcrumb-separator"><i class="bi bi-chevron-right"></i></li>
        <li class="breadcrumb-item active">Ringkasan Kegiatan</li>
      </ul>
    </nav>

    <main class="page-content">
      <!-- Konten halaman di sini -->
    </main>
  </div>

  <!-- Mobile Floating Bottom Nav Dock -->
  <nav class="bottom-nav">
    <a href="#" class="bottom-nav-item active"><i class="bi bi-grid-fill"></i><span>Home</span></a>
    <a href="#" class="bottom-nav-item"><i class="bi bi-table"></i><span>Data</span></a>
    <button class="bottom-nav-item" onclick="toggleBottomNavSheet(true)"><i class="bi bi-grid"></i><span>Menu</span></button>
  </nav>

  <!-- Mobile Expandable Bottom Sheet Modal -->
  <div class="bottom-nav-overlay" id="bottomNavOverlay" onclick="toggleBottomNavSheet(false)"></div>
  <div class="bottom-nav-sheet" id="bottomNavSheet">
    <div class="bottom-nav-sheet-header">
      <div class="bottom-nav-sheet-handle"></div>
      <div class="bottom-nav-sheet-title"><i class="bi bi-grid-3x3-gap-fill text-accent"></i> Menu Lengkap</div>
      <button class="bottom-nav-sheet-close" onclick="toggleBottomNavSheet(false)"><i class="bi bi-x-lg"></i></button>
    </div>
    <div class="bottom-nav-sheet-content">
      <div class="sheet-section-title">Aksi Cepat</div>
      <div class="sheet-quick-actions-bar">
        <button class="sheet-quick-action-pill" onclick="toggleTheme()"><i class="bi bi-circle-half"></i> Tema</button>
        <button class="sheet-quick-action-pill" onclick="toggleSearchModal(true)"><i class="bi bi-search"></i> Cari</button>
      </div>
      <div class="sheet-section-title">Petugas Lapangan</div>
      <div class="sheet-quick-grid">
        <a href="#" class="sheet-grid-card"><div class="sheet-grid-icon icon-purple"><i class="bi bi-person-workspace"></i></div><span class="sheet-grid-name">Korlap</span></a>
        <a href="#" class="sheet-grid-card"><div class="sheet-grid-icon icon-blue"><i class="bi bi-clipboard2-data"></i></div><span class="sheet-grid-name">PML</span></a>
        <a href="#" class="sheet-grid-card active"><div class="sheet-grid-icon icon-cyan"><i class="bi bi-people-fill"></i></div><span class="sheet-grid-name">PCL</span></a>
      </div>
    </div>
  </div>
</body>
```

### I. Common Elements (Tooltips, Pagination, Telemetry & Spotlight Search)
```html
<!-- 1. Adaptive Tooltips -->
<div class="help-tooltip-container">
  <i class="bi bi-question-circle help-tooltip-icon"></i>
  <div class="help-tooltip-box">
    <strong>Penjelasan Metrik:</strong> Indikator ini mencerminkan persentase kelulusan pemeriksaan data SLS.
  </div>
</div>

<!-- 2. Telemetry Live Pulse & Status Pill -->
<span class="live-status-pill">
  <span class="live-pulse-dot"></span> Sinkronisasi Aktif
</span>

<!-- 3. High-Density Table Pagination -->
<div class="pagination">
  <div class="pagination-info">Menampilkan 1-10 dari 124 data</div>
  <div class="pagination-pages">
    <button class="page-btn disabled" disabled><i class="bi bi-chevron-left"></i></button>
    <button class="page-btn active">1</button>
    <button class="page-btn">2</button>
    <button class="page-btn">3</button>
    <button class="page-btn"><i class="bi bi-chevron-right"></i></button>
  </div>
</div>

<!-- 4. Ultra-Premium Spotlight Search Modal (Ctrl+K) -->
<div class="search-modal-backdrop hidden" id="searchModal">
  <div class="search-modal-card">
    <div class="search-modal-header">
      <i class="bi bi-search search-modal-icon"></i>
      <input type="text" placeholder="Ketik kata kunci untuk mencari...">
      <button class="search-modal-close" onclick="toggleSearchModal(false)"><i class="bi bi-x-lg"></i></button>
    </div>
    <div class="search-modal-body">
      <!-- Hasil pencarian / menu navigasi -->
    </div>
    <div class="search-modal-footer">
      <span>Tekan <kbd>Ctrl+K</kbd> untuk membuka</span>
      <span>Taka UI Command</span>
    </div>
  </div>
</div>

<!-- 5. Empty State Container -->
<div class="empty-state">
  <i class="bi bi-inbox empty-state-icon"></i>
  <div class="empty-state-title">Belum Ada Data Tersedia</div>
  <div class="empty-state-desc">Silakan lakukan sinkronisasi data atau sesuaikan filter pencarian Anda.</div>
</div>
```

---

## 5. Panduan Verifikasi Kualitas untuk AI Model

Sebelum menyajikan kode ke pengguna, pastikan selalu memeriksa:
1. [ ] Apakah tabel dibungkus dalam `.table-wrap`? (Wajib untuk touch-scroll mobile).
2. [ ] Apakah kartu indikator metrik menggunakan kelas `.stat-card` dengan label kapital 11px dan angka 28px tebal?
3. [ ] Apakah angka kolom tabel diberi kelas `.td-number`?
4. [ ] Apakah kode wilayah atau ID menggunakan font monospace `.td-code`?
5. [ ] Apakah tag `<body>` sudah memiliki class tema (misal `class="theme-orange"`)?
6. [ ] Apakah navigasi desktop & mobile mengikuti arsitektur `.sidebar` + `.topbar` + `.bottom-nav` + `.bottom-nav-sheet`?
7. [ ] Apakah breadcrumbs menggunakan `.breadcrumb-bar` dan body memiliki kelas `has-breadcrumb`?
8. [ ] Apakah elemen informasi memiliki tooltip adaptif `.help-tooltip-container` dan `.help-tooltip-box`?
9. [ ] Apakah status live menggunakan `.live-pulse-dot` dan `.live-status-pill`?
10. [ ] Apakah tabel memiliki pagination `.pagination` dan `.page-btn`?
11. [ ] Apakah tombol memiliki micro-interaction bawaan Taka UI tanpa menambahkan inline style aneh?
12. [ ] Apakah tidak ada style glow pada tombol dan tidak ada badge di pojok kanan kartu (`.card-header .badge`)?

