# -*- coding: utf-8 -*-
import os

md_path = r'D:\SE2026\monitoring-se2026-ppu\laporan\03_Laporan_Mingguan_Latsar\M2_LAPORAN_MINGGUAN_LATSAR_AKTUALISASI_FINAL.md'

with open(md_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Let's inspect where Tahapan 2.1 - 2.4 BerAKHLAK sections are in the markdown file
print("Read M2 Markdown content length:", len(content))

new_kegiatan_narrative = """### Kegiatan 2: Perancangan Sistem dan Perangkat Lunak
#### *(SDLC Phase 2 — System & Software Design)*

**Ringkasan Capaian:**
Kegiatan kedua yaitu perancangan arsitektur basis data lokal dan desain antarmuka pengguna dasbor pemantauan. Untuk menyelesaikan kegiatan tersebut, dilaksanakan empat tahapan kegiatan, yakni:

---

### Tahapan 2.1 — Perancangan Skema Relasional Basis Data

**Hari/Tanggal Pelaksanaan:** Awal Minggu ke-2 (± 4 hari kerja)

**Uraian Kegiatan:**
2.1. Perancangan struktur basis data lokal (Database Schema & Entity Relationship) yang efisien untuk penampungan progres harian. Pada tahapan ini, merancang skema basis data relasional SQLite 19 tabel dalam 4 zona relasional (3NF, WAL mode, ON DELETE CASCADE) guna mendukung operasional penampungan data progres harian.

**Output / Luaran:**
- [x] Rancangan Skema Basis Data Lokal (Database Schema & Entity Relationship) 19 Tabel SQLite (.docx)
- [x] Entity Relationship Diagram resolusi tinggi (PNG)

**Nilai BerAKHLAK:**
- **Nilai BerAKHLAK:** Berorientasi Pelayanan, Akuntabel, Kompeten, Harmonis, Adaptif, Kolaboratif
- **Penerapan Narrative BerAKHLAK:**
  Pada tahap ini, penulis mengimplementasikan nilai **Berorientasi Pelayanan** dengan merancang struktur basis data yang mendukung kecepatan akses dan penyajian data progres harian SE 2026 kepada pengguna dasbor. Nilai **Akuntabel** diterapkan melalui perancangan skema tabel database secara presisi, teratur, dan terdokumentasi dengan baik agar mudah dipelihara. Nilai **Kompeten** diwujudkan dengan menerapkan prinsip normalisasi dan desain basis data yang efisien. Nilai **Harmonis** diimplementasikan dengan berkoordinasi secara kooperatif bersama tim TI Seksi Pengolahan Data dalam merancang struktur data yang disepakati bersama. Nilai **Adaptif** diterapkan dengan merancang skema yang fleksibel dan mudah dikembangkan sesuai perubahan kebutuhan. Adapun nilai **Kolaboratif** diwujudkan melalui diskusi dan sinergi bersama rekan kerja tim TI dalam mengoptimalkan rancangan basis data.

---

### Tahapan 2.2 — Pembuatan Perancangan Antarmuka Pengguna (UI/UX Design)

**Hari/Tanggal Pelaksanaan:** Pertengahan Minggu ke-2 (± 3 hari kerja)

**Uraian Kegiatan:**
2.2. Pembuatan perancangan antarmuka pengguna (UI/UX Design Interface: Visualisasi Peta Progress, Grafik Tren Progres, dan Milestone Target). Menyusun panduan desain antarmuka pengguna (Design System Guide) sebagai acuan baku (single source of truth) bagi seluruh komponen tampilan Pananyo Taka, mencakup token warna, tipografi, geometri 90°, dan standar WCAG 2.1 AA.

**Output / Luaran:**
- [x] Dokumentasi Desain Antarmuka Dasbor (UI/UX Design Mockup & Design System Guide .docx)
- [x] Dokumen Panduan Desain Sistem & UI/UX (.md)

**Nilai BerAKHLAK:**
- **Nilai BerAKHLAK:** Berorientasi Pelayanan, Akuntabel, Kompeten, Harmonis, Adaptif, Kolaboratif
- **Penerapan Narrative BerAKHLAK:**
  Pada tahap ini, penulis mengimplementasikan nilai **Berorientasi Pelayanan** dengan merancang tata letak informasi berbasis kenyamanan dan kemudahan pengguna agar dasbor dapat dioperasikan oleh seluruh jajaran petugas lapangan. Nilai **Akuntabel** diterapkan melalui pendokumentasian setiap keputusan desain antarmuka secara sistematis. Nilai **Kompeten** diwujudkan dengan menerapkan prinsip-prinsip UI/UX design yang baik untuk menghasilkan tampilan yang informatif dan estetis. Nilai **Harmonis** diimplementasikan dengan mempertimbangkan masukan dari seluruh pemangku kepentingan dalam proses perancangan. Nilai **Adaptif** diterapkan dengan mengakomodasi berbagai skenario penggunaan dalam desain yang responsif. Adapun nilai **Kolaboratif** diwujudkan melalui koordinasi dengan rekan kerja tim TI dalam menyempurnakan rancangan antarmuka pengguna.

---

### Tahapan 2.3 — Penyusunan Rancangan Arsitektur Fitur AI

**Hari/Tanggal Pelaksanaan:** Awal Minggu ke-3 (± 4 hari kerja)

**Uraian Kegiatan:**
2.3. Penyusunan rancangan arsitektur fitur AI. Merancang arsitektur teknis modul Asisten Virtual AI KIPP (Kelompok Informasi dan Performa Petugas) menggunakan alur Retrieval-Augmented Generation (RAG Pipeline), SQL Sandbox Read-Only, System Prompt Hints Engine, dan cURL Fallback.

**Output / Luaran:**
- [x] Rancangan Arsitektur modul AI RAG Pipeline (.docx)
- [x] Sequence Diagram AI RAG Pipeline (PNG)

**Nilai BerAKHLAK:**
- **Nilai BerAKHLAK:** Kompeten, Harmonis, Loyal, Adaptif, Kolaboratif
- **Penerapan Narrative BerAKHLAK:**
  Pada tahap ini, penulis mengimplementasikan nilai **Kompeten** dengan menyusun alur arsitektur integrasi kecerdasan buatan secara sistematis dan sesuai dengan standar rekayasa perangkat lunak modern. Nilai **Harmonis** diwujudkan dengan berkoordinasi secara kondusif bersama rekan tim TI dalam mendiskusikan pendekatan teknis fitur AI yang akan diintegrasikan. Nilai **Loyal** ditunjukkan melalui komitmen untuk menghadirkan fitur AI yang memberikan nilai tambah nyata bagi pengguna dasbor pemantauan SE 2026. Nilai **Adaptif** diimplementasikan dengan mengikuti perkembangan teknologi AI terkini dan menyesuaikan arsitektur dengan kemampuan infrastruktur yang tersedia. Adapun nilai **Kolaboratif** diwujudkan melalui diskusi teknis intensif bersama mentor dan rekan kerja dalam merancang fitur kecerdasan buatan yang tepat guna.

---

### Tahapan 2.4 — Review Rancangan Teknis Bersama Tim IT BPS PPU

**Hari/Tanggal Pelaksanaan:** Akhir Minggu ke-3 (± 1 hari kerja)

**Uraian Kegiatan:**
2.4. Review rancangan teknis basis data dan mockup antarmuka bersama Tim IT Seksi Pengolahan Badan Pusat Statistik Kabupaten Penajam Paser Utara guna memastikan kelayakan arsitektur sistem. Pelaksanaan sesi Design Review teknis formal 7 diagram bersama Tim IT Seksi Pengolahan Data BPS PPU.

**Output / Luaran:**
- [x] Berita Acara Review Desain Teknis (Design Review Checklist) bersama Tim IT (.docx)

**Nilai BerAKHLAK:**
- **Nilai BerAKHLAK:** Akuntabel, Kompeten, Harmonis, Loyal, Kolaboratif
- **Penerapan Narrative BerAKHLAK:**
  Pada tahap ini, penulis mengimplementasikan nilai **Akuntabel** dengan mencatat dan menindaklanjuti seluruh catatan hasil review secara tertib, objektif, dan dapat dipertanggungjawabkan. Nilai **Kompeten** diwujudkan dengan melakukan review desain teknis menggunakan standar tinggi guna menghasilkan rancangan sistem yang andal dan terverifikasi. Nilai **Harmonis** diterapkan dengan menghargai setiap masukan dan saran teknis yang diberikan oleh Tim TI selama proses review berlangsung. Nilai **Loyal** ditunjukkan melalui komitmen untuk menyempurnakan rancangan berdasarkan hasil review demi kualitas sistem yang optimal. Adapun nilai **Kolaboratif** diwujudkan melalui kerja sama aktif bersama Tim IT Seksi Pengolahan dalam melakukan validasi teknis atas rancangan yang telah disusun.
"""

print("Defined updated markdown section")
