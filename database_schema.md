# Visualisasi Skema Database (Per-Survei)

Berikut adalah visualisasi hubungan antar tabel (Entity Relationship Diagram) yang ada di dalam setiap database survei yang terisolasi.

```mermaid
erDiagram
    users ||--o{ remember_tokens : "has"
    uploads ||--o{ progres : "contains"
    uploads ||--o{ summary_cache : "caches"
    subsls_master ||--o{ progres : "tracks"
    
    users {
        INTEGER id PK
        TEXT username
        TEXT password
        INTEGER is_admin
        DATETIME created_at
    }

    remember_tokens {
        INTEGER id PK
        INTEGER user_id FK
        TEXT token
        DATETIME expires_at
        DATETIME created_at
    }

    uploads {
        INTEGER id PK
        TEXT filename
        TEXT stored_filename
        DATE tanggal
        INTEGER total_subsls_terisi
        DATETIME created_at
        TEXT status_filename
        TEXT stored_status_filename
    }

    subsls_master {
        TEXT kode PK
        TEXT kode_kec
        TEXT kecamatan
        TEXT desa
        TEXT nama_sls
        TEXT korlap
        TEXT pml
        TEXT pcl
        INTEGER muatan
        INTEGER target_fasih
        INTEGER target_honor
        TEXT pcl_email
        TEXT pcl_sobat_id
        TEXT pml_email
        TEXT pml_sobat_id
        TEXT korlap_email
        TEXT korlap_sobat_id
    }

    progres {
        INTEGER id PK
        INTEGER upload_id FK
        TEXT kode FK
        INTEGER draft
        INTEGER submitted_by_pcl
        INTEGER approved
        INTEGER rejected
        INTEGER target_upload
        INTEGER open
        INTEGER usaha_ditemukan
        INTEGER usaha_baru
        INTEGER ditemukan
        INTEGER keluarga_baru
        INTEGER usaha_tidak_ditemukan
        INTEGER tidak_ditemukan
        INTEGER usaha_tutup
        INTEGER meninggal
        INTEGER usaha_ganda
        INTEGER rumah_tunggal
        INTEGER rumah_deret
        INTEGER rumah_susun
        INTEGER apartemen
        INTEGER lainnya
        TEXT pcl_email
        TEXT pcl_name
        TEXT pcl_sobat_id
    }

    summary_cache {
        INTEGER id PK
        INTEGER upload_id FK
        TEXT kecamatan
        TEXT desa
        TEXT korlap
        TEXT pml
        TEXT pcl
        INTEGER total_sls
        INTEGER selesai
        INTEGER total_muatan
        INTEGER muatan_selesai
        INTEGER usaha_total
        INTEGER keluarga_total
        INTEGER draft_total
        INTEGER open_total
        INTEGER submitted_total
        INTEGER approved_total
        INTEGER rejected_total
        INTEGER target_fasih_total
        INTEGER target_static_total
        INTEGER target_upload_total
        INTEGER target_honor_total
        INTEGER usaha_ditemukan
        INTEGER usaha_baru
        INTEGER ditemukan
        INTEGER keluarga_baru
        INTEGER usaha_tidak_ditemukan
        INTEGER tidak_ditemukan
        INTEGER usaha_tutup
        INTEGER meninggal
        INTEGER usaha_ganda
        INTEGER rumah_tunggal
        INTEGER rumah_deret
        INTEGER rumah_susun
        INTEGER apartemen
        INTEGER lainnya
    }

    settings {
        TEXT key PK
        TEXT value
    }

    weather_history {
        INTEGER id PK
        DATE tanggal
        TEXT cuaca
        REAL suhu
        INTEGER kelembaban
        REAL angin
        REAL hujan
    }

    visitor_logs {
        INTEGER id PK
        TEXT ip_address
        TEXT user_agent
        TEXT path
        DATETIME timestamp
    }

    petugas_email {
        INTEGER id PK
        TEXT email
        TEXT role
        TEXT nama
        TEXT sobat_id
    }
```

---

### Deskripsi Relasi & Isolasi
* **Relasi Unggahan (`uploads`)**: Setiap baris unggahan mengikat banyak detail perkembangan wilayah (`progres`) dan data komputasi agregat (`summary_cache`).
* **Relasi Wilayah (`subsls_master`)**: Kunci wilayah (`kode` SLS) terhubung dengan entri progres harian untuk validasi status dan nama petugas pencacah di lapangan.
* **Keamanan Akun (`users`)**: Mengelola data admin dan token sesi masuk (`remember_tokens`).
* **Isolasi Penuh**: Skema di atas di-deploy secara identik pada file `.db` terpisah, sehingga tidak ada kontaminasi ID unggahan atau riwayat log antara SE2026, Sakernas Pemutakhiran, dan Sakernas Pendataan.
