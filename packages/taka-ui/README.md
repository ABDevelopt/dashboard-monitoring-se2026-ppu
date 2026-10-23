# 🚀 Taka UI — Modern High-Contrast Dashboard & Monitoring CSS Framework

**Taka UI** adalah framework CSS mandiri (*standalone UI framework*) yang diekstrak langsung dari sistem desain aplikasi pemantauan data **Pananyo Taka (Monitoring SE2026 BPS Kabupaten Penajam Paser Utara)**. 

Framework ini dirancang khusus untuk membangun antarmuka web pemantauan data (*monitoring dashboards*), pusat kendali (*command centers*), aplikasi operasional (*gov-tech & enterprise systems*), serta portal analitik yang membutuhkan penyajian data yang padat, elegan, responsif, dan ramah aksesibilitas.

---

## ✨ Fitur & Keunggulan Utama

* 🖤 **Dark-First High-Contrast Architecture**: Latar belakang obsidian gelap modern (`#0f0f12` & `#1b1b24`) yang nyaman di mata, tidak menyilaukan, dan hemat energi.
* 📜 **Warm Parchment Light Mode**: Mode terang bergaya kertas ivory hangat (`#f5efe6` & `#fdfcfb`) dengan tingkat keterbacaan 100% (WCAG AA compliant, rasio kontras > 4.5:1).
* 🎨 **Multi-Theme Accent Packs**: Ganti aksen warna keseluruhan modul/aplikasi dalam 1 baris class:
  * `theme-orange`: Radiant Orange & Amber (Sensus Ekonomi 2026)
  * `theme-cyan`: Electric Cyan & Oceanic Teal (Sakernas / Listing / Lapangan)
  * `theme-purple`: Royal Violet & Indigo (CAPI / Pendataan Sampel)
  * `theme-emerald`: Emerald Prosperity & Gold (Pertanian / Keuangan / Lingkungan)
  * `theme-blue`: Sapphire Enterprise & Sky Blue (Layanan Umum / Korporat)
* 📱 **Mobile Dual-Navigation**: 
  * Desktop: Sidebar tetap 260px yang dapat diciutkan (*collapsible*).
  * Mobile: Laci menu geser (*off-canvas*) + *Frosted-Glass Bottom Dock Navigation* (`backdrop-filter: blur(28px)`).
* 📊 **Signature Stat Cards**: Kartu metrik dengan garis aksen atas gradien 3px dan watermark icon semi-transparan.
* 📋 **High-Density Data Tables**: Tabel pemantauan padat data dengan scrolling sentuh horizontal yang halus (*touch-momentum friendly*).
* ⚡ **Tactile Micro-Interactions**: Seluruh tombol dan navigasi memiliki efek tekan instan `scale(0.975)` untuk sensasi sentuhan yang responsif.
* 📦 **Zero External Dependency**: Murni CSS murni tanpa ketergantungan JavaScript wajib (hanya butuh font icon seperti Bootstrap Icons).

---

## 📁 Struktur Direktori Paket

```
packages/taka-ui/
├── dist/
│   ├── taka-ui.css             # Bundle CSS lengkap belum terkompresi (47.8 KB)
│   ├── taka-ui.min.css         # Bundle CSS siap produksi terkompresi (35.4 KB)
│   ├── taka-ui-tokens.css      # Token variabel CSS & tema saja
│   ├── taka-charts.js          # Library Chart.js adapter (11.1 KB)
│   └── taka-charts.min.js      # Library Chart.js adapter minified (5.4 KB)
├── src/
│   ├── index.css               # Main entry point (@import all modules)
│   ├── tokens.css              # Variabel dasar (Dark, Light, Font, Spacing)
│   ├── themes.css              # Paket tema aksen multi-survei
│   ├── base.css                # Reset, scrollbar, dan tipografi dasar
│   ├── layout.css              # Shell layout (Sidebar, Topbar, Bottom Nav, Page)
│   ├── grid.css                # Grid auto-fit dashboard (minmax) & flex
│   ├── taka-charts.js          # Helper visualisasi Chart.js
│   ├── utilities.css           # Kelas utilitas AG-UI
│   └── components/
│       ├── cards.css           # Kartu standar & empty states
│       ├── stat-cards.css      # Kartu metrik bergaris aksen
│       ├── buttons.css         # Tombol & tactile press
│       ├── tables.css          # Tabel pemantauan data padat
│       ├── badges.css          # Capsule pill status badges
│       ├── progress.css        # Capsule progress bars
│       ├── forms.css           # Filter bar, input, & select
│       ├── alerts.css          # Toast glassmorphic
│       ├── modals.css          # Dialog pop-up
│       ├── charts.css          # Container styling untuk grafik
│       └── overview.css        # Layout overview (telemetry, milestone, hero KPI)
├── examples/
│   ├── index.html              # Interactive Kitchen Sink & Showcase lengkap
│   ├── overview-template.html  # Template Overview lengkap dengan grafik Chart.js
│   └── dashboard-template.html # Template kosong siap pakai untuk project baru
├── test/
│   └── test-reusability.js     # Test suite reusabilitas & WCAG AA (61 checks)
├── build.js                    # Skrip build otomatis menggunakan Clean-CSS & UglifyJS
├── package.json
└── README.md
```

---

## 🚀 Cara Pemasangan & Penggunaan di Project Lain

### Cara 1: Menyalin Berkas CSS Langsung (HTML Tradisional / Vanilla Web)
1. Salin berkas `packages/taka-ui/dist/taka-ui.min.css` ke direktori aset proyek baru Anda (misal `public/css/taka-ui.min.css`).
2. Masukkan ke dalam tag `<head>` HTML Anda:

```html
<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Dashboard Monitoring Baru</title>

  <!-- 1. Google Font Inter -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">

  <!-- 2. Bootstrap Icons (Opsional, untuk ikon) -->
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css">

  <!-- 3. Taka UI Framework -->
  <link rel="stylesheet" href="/css/taka-ui.min.css">
</head>
<body class="theme-orange">
  <!-- Konten aplikasi Anda di sini -->
</body>
</html>
```

---

### Cara 2: Di Proyek Modern (Vite, Next.js, Nuxt, Svelte, React, Vue)
Di proyek berbasis NPM / Yarn / PNPM, Anda dapat mengimpor berkas CSS pada root layout / main entry:

```javascript
// Di main.js, _app.tsx, atau layout.jsx:
import 'bootstrap-icons/font/bootstrap-icons.css';
import './assets/taka-ui.min.css';
```

---

### Cara 3: Menggunakan Token Saja untuk Tailwind CSS
Jika Anda menggunakan Tailwind CSS di proyek lain dan ingin warna serta nuansa yang sama persis, cukup impor `taka-ui-tokens.css` dan integrasikan ke `tailwind.config.js`:

```javascript
// tailwind.config.js
module.exports = {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        'taka-bg': 'var(--bg-primary)',
        'taka-surface': 'var(--bg-secondary)',
        'taka-card': 'var(--bg-card)',
        'taka-border': 'var(--border)',
        'taka-accent': 'var(--accent-primary)',
      }
    }
  }
}
```

---

## 🧩 Contoh Penggunaan Komponen

### 1. Stat Card (Kartu Indikator Metrik)
```html
<div class="stats-grid">
  <!-- Card Aksen Standar -->
  <div class="stat-card">
    <span class="stat-label">Total Volume Data</span>
    <span class="stat-value">12.840</span>
    <span class="stat-sub">Dokumen Masuk</span>
    <i class="bi bi-folder-fill stat-icon"></i>
  </div>

  <!-- Card Hijau (Selesai/Aman) -->
  <div class="stat-card green">
    <span class="stat-label">Realisasi Selesai</span>
    <span class="stat-value text-success">9.420</span>
    <span class="stat-sub">73.4% dari Target</span>
    <i class="bi bi-check-circle-fill stat-icon"></i>
  </div>

  <!-- Card Kuning (Dalam Proses) -->
  <div class="stat-card yellow">
    <span class="stat-label">Sedang Diverifikasi</span>
    <span class="stat-value text-warning">2.110</span>
    <span class="stat-sub">Dalam Antrean</span>
    <i class="bi bi-hourglass-split stat-icon"></i>
  </div>

  <!-- Card Merah (Tertunda/Kritis) -->
  <div class="stat-card red">
    <span class="stat-label">Tanpa Progres</span>
    <span class="stat-value text-danger">1.310</span>
    <span class="stat-sub">Perlu Evaluasi</span>
    <i class="bi bi-exclamation-triangle-fill stat-icon"></i>
  </div>
</div>
```

---

### 2. High-Density Data Table
```html
<div class="card">
  <div class="card-header">
    <div class="card-title">Tabel Rekapitulasi Progres</div>
  </div>

  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>No</th>
          <th>Nama Wilayah</th>
          <th class="td-number">Target</th>
          <th class="td-number">Capaian</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>1</td>
          <td>
            <span class="td-primary">Kecamatan Penajam</span>
            <div class="td-code">KODE: 64.09.010</div>
          </td>
          <td class="td-number">5.000</td>
          <td class="td-number td-primary">4.850</td>
          <td><span class="badge badge-green badge-dot">Selesai</span></td>
        </tr>
      </tbody>
    </table>
  </div>
</div>
```

---

### 3. Filter Toolbar & Form
```html
<div class="filter-bar">
  <div class="search-input-wrap">
    <i class="bi bi-search search-icon"></i>
    <input type="search" placeholder="Cari data...">
  </div>
  <select>
    <option value="">Semua Kategori</option>
  </select>
  <button class="btn btn-secondary">Terapkan</button>
</div>
```

---

### 4. Tombol dengan Efek Sentuhan (*Tactile*)
```html
<!-- Tombol Standar -->
<button class="btn btn-primary">Simpan Data</button>
<button class="btn btn-secondary">Batal</button>
<button class="btn btn-success">Setujui</button>
<button class="btn btn-danger">Tolak</button>

<!-- Tombol CTA Utama -->
<button class="btn-survey-cta">
  <span>Luncurkan Modul Pemantauan</span>
  <i class="bi bi-arrow-right"></i>
</button>
```

---

### 5. Layout Overview & Milestone Progress Tracker
```html
<!-- Grid Telemetry & AI Insight -->
<div class="overview-top-grid">
  <div class="telemetry-card">
    <div class="telemetry-header">
      <div class="telemetry-icon-circle"><i class="bi bi-cloud-sun-fill text-warning"></i></div>
      <div><strong>Penajam Paser Utara</strong> 29°C</div>
    </div>
  </div>
  <div class="ai-insights-card">
    <h4>AI Smart Insights</h4>
    <p>Realisasi lapangan berjalan optimal.</p>
  </div>
</div>

<!-- Milestone Progress Card -->
<div class="milestone-card">
  <div class="milestone-flex-wrap">
    <div class="milestone-left-panel">
      <!-- Progress Bar dengan Dashed Milestone Markers -->
      <div class="progress-timeline-container">
        <div class="bg-progress-timeline">
          <div class="progress-bar-premium" style="width: 73%;">73%</div>
        </div>
        <div class="target-marker" style="left: 25%;"><span class="target-marker-text top">M1: 25%</span></div>
        <div class="target-marker" style="left: 50%;"><span class="target-marker-text bottom">M2: 50%</span></div>
      </div>
    </div>
    <!-- Hero Speedometer Box -->
    <div class="milestone-right-panel">
      <div class="milestone-hero-card">
        <div class="milestone-hero-number">142</div>
        <div class="milestone-hero-label">Dokumen / Hari (On-Track)</div>
      </div>
    </div>
  </div>
</div>
```

---

### 6. Integrasi Visualisasi Grafik (TakaCharts)
Hubungkan Chart.js dan `taka-charts.min.js`:
```html
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<script src="dist/taka-charts.min.js"></script>

<div class="charts-grid">
  <div class="chart-card">
    <div class="chart-header">
      <div class="chart-title">Tren Kumulatif Harian</div>
    </div>
    <div class="chart-canvas-wrap">
      <canvas id="myTrendChart"></canvas>
    </div>
  </div>
</div>

<script>
  // Line Chart Tren vs Garis Target
  TakaCharts.createTrendChart('myTrendChart', {
    labels: ['01 Okt', '05 Okt', '10 Okt', '15 Okt'],
    realisasi: [1000, 2500, 5200, 7800],
    target: [1200, 3000, 6000, 8500],
    unit: 'Dokumen'
  });

  // Otomatis sinkron saat beralih Dark/Light mode atau ganti tema
  TakaCharts.watchTheme();
</script>
```

---

## 🎨 Mengganti Tema Aksen Survei & Mode Gelap/Terang

### Ganti Warna Aksen
Cukup tambahkan class tema pada tag `<body>`:
* `<body class="theme-orange">` (Default SE2026 Orange & Amber)
* `<body class="theme-cyan">` (Electric Cyan & Oceanic Teal)
* `<body class="theme-purple">` (Royal Purple & Indigo)
* `<body class="theme-emerald">` (Emerald Prosperity)
* `<body class="theme-blue">` (Sapphire Enterprise)

### Toggle Dark / Light Mode
Cukup lakukan toggle class `light-mode` pada tag `<body>`:
```javascript
// Mengaktifkan mode terang
document.body.classList.add('light-mode');

// Mengembalikan ke mode gelap
document.body.classList.remove('light-mode');
```

---

## 🔨 Melakukan Kompilasi Ulang (Build)
Jika Anda memodifikasi file pada folder `src/`, jalankan perintah build berikut:
```bash
node build.js
```
Skrip akan secara otomatis menggabungkan seluruh modul dan menghasilkan berkas `dist/taka-ui.css` serta `dist/taka-ui.min.css`.

---

## 📄 Lisensi
Framework ini dirilis di bawah lisensi **MIT License** dan bebas digunakan untuk kebutuhan proyek internal BPS maupun aplikasi publik lainnya.
