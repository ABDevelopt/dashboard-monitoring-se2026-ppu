# Dashboard Monitoring Sensus Ekonomi 2026 (SE2026) BPS Kabupaten Penajam Paser Utara

Repositori ini ditujukan untuk sistem **Dashboard Pemantauan Lapangan Sensus Ekonomi 2026** tingkat Kabupaten Penajam Paser Utara (PPU). Aplikasi ini dibangun menggunakan Node.js dan SQLite untuk mempermudah monitoring progres lapangan secara ringan, cepat, dan terarah.

---

## Latar Belakang & Masalah
Kegiatan lapangan Sensus Ekonomi 2026 memerlukan pengawasan pendataan yang ketat untuk menjamin kualitas data. Di Kabupaten Penajam Paser Utara (PPU), pengawasan lapangan menghadapi tantangan besar:
1. **Kondisi Geografis & Anggaran:** Wilayah PPU yang luas memerlukan waktu, biaya, dan tenaga pengawasan yang besar. Sementara itu, anggaran dinas lapangan dan transportasi pengawasan sangat terbatas. Pengawasan lapangan harus dilakukan secara **efektif, efisien, dan tepat sasaran**.
2. **Keterbatasan Akses Dashboard Pusat:** Dashboard monitoring resmi dari BPS Pusat memiliki akses terbatas (hanya akun pimpinan/tertentu).
3. **Keterbatasan Infrastruktur VPN:** Dashboard sistem *Fasih* memerlukan koneksi VPN, sering kali lambat, dan sulit diakses secara cepat oleh staf/pendamping lapangan di daerah (aksesibilitas rendah).

---

## Tujuan Dashboard
1. Menyediakan platform pemantauan progres pendataan SE2026 yang **ringan, cepat, dan mudah diakses** oleh seluruh pegawai BPS PPU dan pendamping lapangan tanpa memerlukan VPN rumit.
2. Mengubah metode pengawasan dari *random checking* menjadi **targeted supervision (pengawasan tepat sasaran)** berdasarkan data performa petugas di lapangan untuk menghemat anggaran perjalanan dinas.
3. Memberikan gambaran nyata kondisi lapangan secara akurat untuk mendukung pengambilan keputusan cepat oleh manajemen.

---

## Target Progres Pendataan
Sistem monitoring melacak persentase progres akumulasi terhadap target milestone nasional berikut:
* **Milestone 1:** Minimal **25%** pendataan selesai pada **30 Juni 2026**
* **Milestone 2:** Minimal **40%** pendataan selesai pada **15 Juli 2026**
* **Milestone 3:** Minimal **100%** pendataan selesai pada **31 Agustus 2026**

---

## Fitur Utama (Functional Requirements)
1. **Progress Tracker:** Visualisasi persentase progres kumulatif harian per petugas (PCL), PML, Korlap, SLS (Satuan Lingkungan Setempat), dan kecamatan dibandingkan dengan garis target (*milestone trend line*).
2. **Early Warning System (Peringatan Dini):**
   * 🔴 **Petugas Tanpa Progres:** Deteksi otomatis petugas yang tidak mengirimkan data dalam kurun waktu tertentu (misal: 3 hari berturut-turut).
   * ⚠️ **Petugas Berisiko (At-Risk):** Estimasi proyeksi laju pendataan petugas saat ini terhadap sisa waktu deadline. Sistem menandai petugas yang diproyeksikan tidak akan mencapai target milestone.
   * 🔍 **Deteksi Anomali Data Tinggi:** Menghitung jumlah eror/anomali data per kuesioner yang dikirimkan petugas agar pengawas dapat memprioritaskan pembinaan teknis pada petugas tersebut.
3. **Geographic Mapping (Peta Spasial):** Peta sebaran progres wilayah (kecamatan/kelurahan) berbasis spasial/KML untuk mempermudah pimpinan melihat wilayah mana saja yang masih tertinggal.
4. **Chatbot Monitoring AI / KIPP:** Integrasi chatbot cerdas untuk mempermudah pemantauan Kelompok Informasi dan Performa Petugas secara interaktif menggunakan AI.

---

## Arsitektur Teknis
Aplikasi ini diimplementasikan menggunakan arsitektur web modern yang ringan dan efisien untuk dijalankan pada server lokal/LAN kantor:
* **Runtime:** Node.js (Express.js)
* **Frontend:** EJS (Embedded JavaScript) & Custom CSS
* **Database:** SQLite (via `better-sqlite3` untuk kecepatan query tinggi dan portabilitas)
* **Data Parsing:** `xlsx` untuk pemrosesan berkas Excel (.xlsx / .xls) laporan progres mingguan/harian

---

## Panduan Pemasangan & Menjalankan Aplikasi

### Prasyarat
Pastikan Anda sudah menginstal **Node.js** di komputer Anda.

### Langkah-langkah
1. **Unduh & Ekstrak Proyek:**
   Download atau *clone* repositori ini ke komputer server lokal Anda.

2. **Instal Dependensi:**
   Buka terminal/Command Prompt di direktori proyek, lalu jalankan:
   ```bash
   npm install
   ```

3. **Konfigurasi Environment (Opsional):**
   Buat file `.env` di root direktori jika Anda ingin mengubah konfigurasi *default*. Contoh isi berkas `.env`:
   ```env
   PORT=3000
   SENTRY_DSN=your_sentry_dsn
   ```

4. **Jalankan:**
   Jalankan server Node.js dengan perintah:
   ```bash
   node server.js
   ```
   *(Sistem akan secara otomatis membuat berkas database SQLite di `data/se2026.db` dan mengimpor data master SubSLS awal dari file `kelompok_populasi_pml_pcl_korlap_muatan.json` jika belum ada).*

5. **Akses Dashboard:**
   Buka *browser* Anda dan akses alamat: [http://localhost:3000](http://localhost:3000)


---

## Panduan Unggah Data (Excel Upload)
* Unggah berkas Excel hasil ekspor dari portal pelaporan **FASIH** melalui menu **Upload Data** menggunakan akun Administrator.
* **Format Nama File:** Berkas Excel yang diunggah disarankan mencantumkan tanggal di nama filenya (misalnya: `rekap status assignmen 25 juni.xlsx` atau `2026-06-25_progres.xlsx`). Sistem akan secara otomatis mendeteksi tanggal tersebut untuk digunakan sebagai basis penentuan garis progres harian.

---
*Dikembangkan oleh:*  
**Subbagian Umum & Tim IPJKD-DLS BPS Kabupaten Penajam Paser Utara**
