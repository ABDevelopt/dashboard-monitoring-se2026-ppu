# Dashboard Monitoring Sensus Ekonomi 2026 (SE2026) BPS Kabupaten Penajam Paser Utara

Repositori ini ditujukan untuk pengembangan **Sistem Dashboard Pemantauan Lapangan Sensus Ekonomi 2026** tingkat Kabupaten Penajam Paser Utara. 

---

## 📌 Latar Belakang & Masalah
Kegiatan lapangan Sensus Ekonomi 2026 memerlukan pengawasan pendataan yang ketat untuk menjamin kualitas data. Namun, di Kabupaten Penajam Paser Utara (PPU), pengawasan lapangan menghadapi tantangan besar:
1. **Kondisi Geografis & Anggaran:** Wilayah PPU yang luas memerlukan waktu, biaya, dan tenaga pengawasan yang besar. Sementara itu, anggaran dinas lapangan dan transportasi pengawasan sangat terbatas. Pengawasan lapangan harus dilakukan secara **efektif, efisien, dan tepat sasaran**.
2. **Keterbatasan Akses Dashboard Pusat:** Dashboard monitoring yang disediakan oleh BPS Pusat memiliki akses terbatas (hanya akun pimpinan/tertentu).
3. **Keterbatasan Infrastruktur VPN:** Dashboard sistem *Fasih* memerlukan koneksi VPN, sering kali lambat, dan sulit diakses secara cepat oleh staf/pendamping lapangan di daerah (aksesibilitas rendah).

---

## 🎯 Tujuan Dashboard
1. Menyediakan platform pemantauan progres pendataan SE2026 yang **ringan, cepat, dan mudah diakses** oleh seluruh pegawai BPS PPU dan pendamping lapangan tanpa memerlukan VPN rumit.
2. Mengubah metode pengawasan dari *random checking* menjadi **targeted supervision (pengawasan tepat sasaran)** berdasarkan data performa petugas di lapangan untuk menghemat anggaran perjalanan dinas.
3. Memberikan gambaran nyata kondisi lapangan secara akurat dan presisi untuk mendukung pengambilan keputusan cepat oleh manajemen.

---

## 📅 Target Progres Pendataan
Sistem monitoring akan melacak persentase progres akumulasi terhadap target milestone nasional berikut:
*   **Milestone 1:** Minimal **25%** pendataan selesai pada **30 Juni 2026**
*   **Milestone 2:** Minimal **40%** pendataan selesai pada **15 Juli 2026**
*   **Milestone 3:** Minimal **100%** pendataan selesai pada **31 Agustus 2026**

---

## 🛠️ Fitur Utama (Functional Requirements)
1. **Progress Tracker (Real-time):** Visualisasi persentase progres kumulatif harian per petugas, per SLS (Satuan Lingkungan Setempat), dan per kecamatan dibandingkan dengan garis target (*milestone trend line*).
2. **Early Warning System (Peringatan Dini):**
   *   🔴 **Petugas Tanpa Progres:** Deteksi otomatis petugas yang tidak mengirimkan data dalam kurun waktu tertentu (misal: 3 hari berturut-turut).
   *   ⚠️ **Petugas Berisiko (At-Risk):** Estimasi proyeksi laju pendataan petugas saat ini terhadap sisa waktu deadline. Sistem akan menandai petugas yang diproyeksikan tidak akan mencapai target milestone.
   *   🔍 **Deteksi Anomali Data Tinggi:** Menghitung jumlah eror/anomali data per kuesioner yang dikirimkan petugas agar pengawas dapat memprioritaskan pembinaan teknis pada petugas tersebut.
3. **Geographic Mapping (Simple):** Peta sebaran progres wilayah (kecamatan/kelurahan) untuk mempermudah pimpinan melihat wilayah mana saja yang masih tertinggal.

---

## 💻 Rekomendasi Arsitektur Teknis
Untuk mewujudkan sistem yang ringan dan cepat dibangun lokal di daerah, berikut adalah opsi arsitekturnya:

### **Opsi A: Python (Pandas/Streamlit) & SQLite (Direkomendasikan)**
*   **Data Source:** Ekspor berkala log aktivitas entri/progres dari basis data lokal/pusat (format CSV/Excel).
*   **Backend:** Script Python untuk memproses data, menghitung anomali, dan melakukan proyeksi laju target.
*   **Frontend:** Visualisasi menggunakan **Streamlit** (sangat ringan, gratis, interaktif, dan mudah dideploy di server lokal/LAN kantor).

### **Opsi B: Google Sheets + Looker Studio (Sangat Cepat)**
*   **Data Source:** Google Sheets sebagai tempat input data log progres (diisi manual oleh pendamping atau ditarik otomatis via script).
*   **Visualisasi:** Looker Studio yang dikoneksikan ke Google Sheets. Akses sangat mudah dibagikan via link browser ke perangkat smartphone pengawas tanpa VPN.

---

*Dikembangkan oleh:*  
**Subbagian Umum & Tim IPJKD-DLS BPS Kabupaten Penajam Paser Utara**
