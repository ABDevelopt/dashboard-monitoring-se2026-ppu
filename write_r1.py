# -*- coding: utf-8 -*-
import os
p = r"D:\SE2026\monitoring-se2026-ppu\laporan\02_Phase_2_System_Design\LAPORAN_AKHIR_FASE_2_PERANCANGAN_SISTEM.md"
lines = []
lines.append("""# LAPORAN AKHIR KEGIATAN 2
# PERANCANGAN SISTEM DAN PERANGKAT LUNAK
# *(SYSTEM & SOFTWARE DESIGN — SDLC PHASE 2)*

---

| **Nama Sistem** | Dashboard Pemantauan Lapangan Sensus Ekonomi 2026 (SE2026) & Multi-Survei BPS PPU (*Pananyo Taka*) |
| :--- | :--- |
| **Institusi** | Badan Pusat Statistik (BPS) Kabupaten Penajam Paser Utara |
| **Versi Sistem** | 2.3.0 |
| **Penyusun** | Yahya Abdurrohman, S.Tr.Stat. (NIP: 20020420 202410 1 002) |
| **Mentor / Pengesah** | Agus Dwi Winarno, S.ST. (Ketua Tim IPJKD & DLS BPS Kab. PPU) |
| **Tanggal Dokumen** | 15 Agustus 2026 |
| **Klasifikasi** | Laporan Teknis Resmi — Rekayasa Perangkat Lunak |

---

## LEMBAR PENGESAHAN

Laporan Akhir Kegiatan 2: Perancangan Sistem dan Perangkat Lunak (*System & Software Design — SDLC Phase 2*) ini telah disusun, ditelaah, dan disahkan sebagai dokumen teknis resmi dalam rangka Pelaksanaan Aktualisasi Pelatihan Dasar CPNS BPS Tahun 2026.

| Peran | Nama & Gelar | Jabatan / Unit Kerja | Persetujuan |
| :--- | :--- | :--- | :--- |
| **Penyusun** | Yahya Abdurrohman, S.Tr.Stat. | Pranata Komputer Ahli Pertama / Peserta Latsar CPNS Gol. III | *(Disahkan)* |
| **Mentor / Pengesah** | Agus Dwi Winarno, S.ST. | Ketua Tim IPJKD & DLS BPS Kab. Penajam Paser Utara | *(Disetujui)* |
| **Reviewer Teknis** | Tim Seksi Pengolahan Data | Seksi Pengolahan & TI BPS Kab. Penajam Paser Utara | *(Terverifikasi)* |

**Penajam, 15 Agustus 2026**

---

## DAFTAR ISI

1. [Ringkasan Eksekutif](#1-ringkasan-eksekutif)
2. [Tujuan & Ruang Lingkup Kegiatan 2](#2-tujuan--ruang-lingkup-kegiatan-2)
3. [Tahapan Kegiatan & Luaran](#3-tahapan-kegiatan--luaran)
   - 3.1. Tahapan 2.1 — Perancangan Skema Relasional Basis Data
   - 3.2. Tahapan 2.2 — Panduan Desain Sistem & UI/UX
   - 3.3. Tahapan 2.3 — Arsitektur Modul AI (RAG Pipeline)
   - 3.4. Tahapan 2.4 — Review Desain Teknis Bersama Tim IT
4. [Analisis Kebutuhan Sistem](#4-analisis-kebutuhan-sistem)
5. [Arsitektur Perangkat Lunak](#5-arsitektur-perangkat-lunak)
6. [Diagram Perancangan Sistem (7 Diagram Teknis)](#6-diagram-perancangan-sistem-7-diagram-teknis)
   - Gambar 6.1 — System Context Diagram (DFD Level 0)
   - Gambar 6.2 — Use Case Diagram
   - Gambar 6.3 — Data Flow Diagram (DFD) Level 1
   - Gambar 6.4 — Entity Relationship Diagram (ERD)
   - Gambar 6.5 — 3-Tier Layered Architecture Diagram
   - Gambar 6.6 — Activity Diagram
   - Gambar 6.7 — Sequence Diagram (AI RAG Pipeline)
7. [Perancangan Basis Data](#7-perancangan-basis-data)
8. [Perancangan Antarmuka Pengguna (UI/UX Design System)](#8-perancangan-antarmuka-pengguna-uiux-design-system)
9. [Arsitektur Modul Fungsional Utama](#9-arsitektur-modul-fungsional-utama)
10. [Aspek Keamanan, Keandalan & Kinerja](#10-aspek-keamanan-keandalan--kinerja)
11. [Rencana Implementasi (Fase 3)](#11-rencana-implementasi-fase-3)
12. [Kesimpulan](#12-kesimpulan)
13. [Lampiran — Daftar Dokumen Pendukung](#13-lampiran--daftar-dokumen-pendukung)

---

## 1. Ringkasan Eksekutif

Kegiatan 2 (Perancangan Sistem dan Perangkat Lunak) merupakan tahap kedua dari siklus pengembangan perangkat lunak (*Software Development Life Cycle* — SDLC) model Waterfall yang diterapkan dalam aktualisasi Pelatihan Dasar CPNS BPS Tahun 2026. Kegiatan ini berpedoman pada hasil Analisis Kebutuhan yang telah disahkan pada Kegiatan 1 (Fase 1).

Pada fase ini, seluruh cetak biru teknis (*technical blueprint*) sistem **Pananyo Taka** — Dashboard Pemantauan Lapangan Sensus Ekonomi 2026 (SE2026) dan Multi-Survei BPS Kabupaten Penajam Paser Utara — berhasil dirancang secara komprehensif, mencakup:

- **7 (tujuh) Diagram Perancangan Sistem** standar rekayasa perangkat lunak (System Context DFD Level 0, Use Case Diagram, DFD Level 1, ERD 19 Tabel, 3-Tier Architecture, Activity Diagram, dan Sequence Diagram AI RAG Pipeline).
- **Panduan Desain Sistem & UI/UX** (*Design System Guide*) dengan standar aksesibilitas WCAG 2.1 AA dan skala tipografi mobile.
- **Spesifikasi Skema Basis Data** relasional 19 tabel SQLite dengan mode Write-Ahead Logging (WAL).
- **Arsitektur Modul AI** berbasis Retrieval-Augmented Generation (RAG) dengan integrasi Google Gemini LLM.
- **Berita Acara Review Desain Teknis** bersama Tim IT Seksi Pengolahan Data BPS PPU.

Seluruh luaran Kegiatan 2 berfungsi sebagai acuan baku dan landasan formal bagi pelaksanaan Kegiatan 3 (Implementasi & Coding — SDLC Phase 3).

---

## 2. Tujuan & Ruang Lingkup Kegiatan 2

### 2.1. Tujuan
1. Merancang arsitektur teknis sistem **Pananyo Taka** secara utuh dan terstruktur menggunakan notasi desain perangkat lunak standar (UML, DFD, ERD).
2. Menetapkan spesifikasi skema basis data SQLite relasional yang siap diimplementasikan pada fase pengkodean.
3. Menyusun panduan desain antarmuka pengguna yang konsisten, aksesibel, dan responsif terhadap kebutuhan lapangan BPS PPU.
4. Merancang arsitektur modul kecerdasan buatan (*AI Module Architecture*) berbasis RAG untuk mendukung analitik bahasa alami.
5. Mendapatkan validasi teknis dan persetujuan formal dari pemangku kepentingan (Mentor dan Tim IT) atas seluruh rancangan sistem.

### 2.2. Ruang Lingkup
Perancangan sistem pada Kegiatan 2 mencakup:
- Sistem utama: Dashboard Pemantauan Lapangan SE2026 PPU
- Arsitektur multi-survei: Integrasi Sakernas Listing dan Sakernas CAPI
- Modul KIPP (Kelompok Informasi dan Performa Petugas): Asisten virtual berbasis AI
- Subsistem notifikasi otomatis: Gateway WhatsApp Baileys
- Subsistem pemetaan spasial: GIS Leaflet dengan data KML Batas Wilayah PPU

---

## 3. Tahapan Kegiatan & Luaran

### 3.1. Tahapan 2.1 — Perancangan Skema Relasional Basis Data

**Periode:** Minggu ke-2 Fase 2 (± 4 hari kerja)

**Uraian Kegiatan:**
Pada tahapan ini dilakukan perancangan skema basis data relasional SQLite secara komprehensif untuk menampung seluruh data operasional sistem monitoring SE2026 PPU. Perancangan mengikuti prinsip normalisasi Bentuk Normal Ketiga (3NF) untuk meminimalkan redundansi dan menjamin integritas data.

**Keputusan Desain Utama:**
- Penggunaan SQLite dengan mode **Write-Ahead Logging (WAL)** untuk mendukung pembacaan konkuren tanpa *lock* pada operasi baca-tulis simultan.
- Penerapan **foreign key constraint** dengan opsi `ON DELETE CASCADE` untuk menjaga integritas referensial.
- Pemisahan tabel `summary_cache` sebagai lapisan pra-kalkulasi agregat untuk menjamin respons API di bawah 5 milidetik.
- Isolasi basis data per kegiatan survei (`data/se2026.db`, `data/sakernas-pemutakhiran.db`) untuk mencegah kontaminasi data antar kegiatan.

**Luaran (Deliverable) Tahapan 2.1:**
| No. | Nama Dokumen | Berkas |
| :--- | :--- | :--- |
| 1 | Dokumen Spesifikasi Skema Basis Data 12 Tabel SQLite | `Dokumen_Spesifikasi_Skema_Basis_Data_12_Tabel_SQLite.docx` |
| 2 | Entity Relationship Diagram (PNG) | `04_entity_relationship_diagram.png` |

**Nilai BerAKHLAK yang Diterapkan:**
- **Kompeten:** Menerapkan pengetahuan normalisasi basis data dan desain skema relasional yang terstruktur.
- **Akuntabel:** Seluruh keputusan desain skema didokumentasikan secara transparan dan dapat diaudit.

---

### 3.2. Tahapan 2.2 — Panduan Desain Sistem & UI/UX

**Periode:** Minggu ke-2 Fase 2 (± 3 hari kerja)

**Uraian Kegiatan:**
Penyusunan panduan desain sistem antarmuka pengguna (*Design System Guide*) yang berfungsi sebagai dokumen standar baku (*single source of truth*) bagi pengembangan seluruh komponen antarmuka Pananyo Taka. Panduan ini menetapkan token warna, skala tipografi, geometri komponen, dan aturan aksesibilitas yang wajib dipatuhi di seluruh halaman sistem.

**Standar yang Diterapkan:**
- **Skala Tipografi Mobile:** Font size 12px–22px (sesuai *Mobile Typography Guidelines* BPS PPU)
- **Aksesibilitas WCAG 2.1 AA:** Rasio kontras warna teks = 4.5:1
- **Sistem Tema Multi-Survei:** Token CSS dinamis per kegiatan survei
- **Geometri Sudut Tegas (90°):** Konsistensi visual *enterprise* tanpa `border-radius`
- **Standar Teks Bracket:** Format `[ON-TRACK]`, `[ALERT STAGNAN]`, `[PRIORITAS 1]`

**Luaran (Deliverable) Tahapan 2.2:**
| No. | Nama Dokumen | Berkas |
| :--- | :--- | :--- |
| 1 | Dokumen Panduan Desain Sistem & UI/UX (Word) | `Dokumen_Panduan_Desain_UIUX_Pananyo_Taka.docx` |
| 2 | Dokumen Panduan Desain Sistem & UI/UX (Markdown) | `DOKUMEN_PANDUAN_DESAIN_UIUX_PANANYO_TAKA.md` |

**Nilai BerAKHLAK yang Diterapkan:**
- **Berorientasi Pelayanan:** Merancang antarmuka yang ramah pengguna dan dapat diakses oleh seluruh petugas di lapangan.
- **Harmonis:** Menetapkan standar visual yang konsisten dan inklusif bagi semua tingkatan pengguna.

---

### 3.3. Tahapan 2.3 — Arsitektur Modul AI (RAG Pipeline)

**Periode:** Minggu ke-3 Fase 2 (± 4 hari kerja)

**Uraian Kegiatan:**
Perancangan arsitektur teknis modul Asisten Virtual AI (KIPP — *Kelompok Informasi dan Performa Petugas*) menggunakan pendekatan **Retrieval-Augmented Generation (RAG)**. Modul ini dirancang untuk memungkinkan pengguna mengajukan pertanyaan dalam bahasa Indonesia alami (*natural language querying*) dan mendapatkan analisis data progres sensus secara instan.

**Komponen Arsitektur AI yang Dirancang:**
1. **System Prompt & Schema Injection Engine:** Injeksi konteks skema database dan domain BPS ke dalam *system prompt* model LLM.
2. **SQL Sandbox Tool (Read-Only):** Mekanisme *function calling* untuk mengeksekusi kueri SQL pada database SQLite dengan izin baca-saja (*read-only*) sebagai lapisan keamanan.
3. **Query Hints Engine (`queryHints.js`):** Kamus metadata skema dan istilah domain BPS (PCL, PML, Korlap, Muatan, SubSLS, FASIH) untuk meningkatkan akurasi generasi SQL.
4. **cURL Fallback Engine:** Mekanisme *self-healing* otomatis untuk menangani kendala SSL/TLS pada lingkungan hosting bersama (*shared hosting*).
5. **Google Gemini LLM Integration:** Pemanfaatan model Google Gemini 2.5 Flash/Pro melalui SDK `@google/generative-ai`.

**Luaran (Deliverable) Tahapan 2.3:**
| No. | Nama Dokumen | Berkas |
| :--- | :--- | :--- |
| 1 | Dokumen Rancangan Arsitektur Modul AI RAG Pipeline (Word) | `Dokumen_Rancangan_Arsitektur_Modul_AI_RAG_Pipeline.docx` |
| 2 | Sequence Diagram AI RAG Pipeline (PNG) | `07_sequence_diagram_rag_ai.png` |

**Nilai BerAKHLAK yang Diterapkan:**
- **Kompeten:** Merancang arsitektur AI mutakhir yang memanfaatkan teknologi RAG untuk meningkatkan kapabilitas analitik sistem.
- **Inovatif (Adaptif):** Mengintegrasikan teknologi LLM generatif ke dalam sistem monitoring pemerintahan untuk meningkatkan efektivitas pengawasan lapangan.

---

### 3.4. Tahapan 2.4 — Review Desain Teknis Bersama Tim IT

**Periode:** Akhir Minggu ke-3 Fase 2 (± 1 hari kerja)

**Uraian Kegiatan:**
Pelaksanaan sesi *Design Review* teknis formal bersama Tim IT Seksi Pengolahan Data BPS PPU. Pada sesi ini, seluruh rancangan sistem yang telah disusun (7 diagram, skema database, panduan UI/UX, dan arsitektur AI) dipresentasikan untuk mendapatkan umpan balik (*feedback*), koreksi, dan persetujuan teknis sebelum masuk ke fase implementasi.

**Agenda Review:**
1. Presentasi 7 Diagram Perancangan Sistem
2. Validasi Skema Relasional Basis Data 19 Tabel
3. Review Panduan Desain Sistem & UI/UX
4. Diskusi Arsitektur Modul AI dan Pertimbangan Keamanan
5. Penandatanganan Berita Acara Review Desain Teknis

**Luaran (Deliverable) Tahapan 2.4:**
| No. | Nama Dokumen | Berkas |
| :--- | :--- | :--- |
| 1 | Berita Acara Review Desain Teknis bersama Tim IT | `Berita_Acara_Review_Desain_Teknis_bersama_Tim_IT.docx` |

**Nilai BerAKHLAK yang Diterapkan:**
- **Kolaboratif:** Mengutamakan keterlibatan Tim IT sebagai pemangku kepentingan teknis dalam proses validasi desain.
- **Akuntabel:** Mendokumentasikan hasil review dalam Berita Acara resmi sebagai bentuk tanggung jawab terhadap kualitas rancangan.
""")
