# Katalog Diagram Perancangan Sistem (SDLC Phase 2: System & Software Design)

Direktori ini memuat seluruh diagram teknis arsitektur perangkat lunak untuk sistem **Pananyo Taka (Dasbor Pemantauan Sensus & Survei BPS Kabupaten Penajam Paser Utara)**:

---

## 📁 Berkas Master Multi-Tab Draw.io:
- **[diagrams_perancangan_sistem_pananyo_taka.drawio](file:///d:/SE2026/monitoring-se2026-ppu/laporan/02_Phase_2_System_Design/diagrams/diagrams_perancangan_sistem_pananyo_taka.drawio)** *(Native Draw.io Master 7 Tab Diagram)*
- **[diagrams_perancangan_sistem_pananyo_taka.xml](file:///d:/SE2026/monitoring-se2026-ppu/laporan/02_Phase_2_System_Design/diagrams/diagrams_perancangan_sistem_pananyo_taka.xml)** *(XML Vector Interchange Format)*

---

## 🖼️ 7 Diagram Utama & Berkas Gambar Render:

### 1. System Context Diagram (Data Flow Diagram Level 0)
- **File:** `01_system_context_diagram.png`
- **Deskripsi:** Memodelkan interaksi antara sistem Pananyo Taka dengan 8 entitas eksternal (Admin TI BPS, Korlap, PML, PCL, Pimpinan BPS/Publik, Sistem FASIH BPS, Google Spreadsheet Audit, LLM Cloud Providers, dan Open-Meteo API).

### 2. Use Case Diagram Sistem
- **File:** `02_use_case_diagram.png`
- **Deskripsi:** Memodelkan 8 use case fungsional utama (UC-01 s.d UC-08) dan interaksi dengan 4 aktor pengguna (Publik, Petugas Sensus, Admin TI, dan External LLM).

### 3. Data Flow Diagram (DFD) Level 1
- **File:** `03_dfd_level_1_diagram.png`
- **Deskripsi:** Memodelkan 6 proses komputasi internal (1.0 Auth RBAC, 2.0 Import Excel, 3.0 Agregasi & Cache, 4.0 Visualisasi GIS, 5.0 RAG AI Engine, 6.0 Audit Data) serta aliran data ke 5 data store (`subsls_master`, `progres`, `uploads`, `summary_cache`, `users & settings`).

### 4. Entity Relationship Diagram (ERD Relasional)
- **File:** `04_entity_relationship_diagram.png`
- **Deskripsi:** Memodelkan skema relasional 12 tabel basis data lokal SQLite terindeks B-Tree (`uploads`, `subsls_master`, `progres`, `summary_cache`, `users`, `remember_tokens`, `survey_subsls`, `settings`, dll) dengan integritas referensial *ON DELETE CASCADE*.

### 5. 3-Tier Layered System Architecture Diagram
- **File:** `05_system_architecture_diagram.png`
- **Deskripsi:** Memodelkan arsitektur 3 lapisan sistem (*Presentation Layer*, *Application & Logic Layer*, dan *Data & Persistence Layer*).

### 6. Activity Diagram Monitoring & Quality Control
- **File:** `06_activity_diagram_monitoring.png`
- **Deskripsi:** Memodelkan alur kerja pengawasan kualitas lapangan (*swimlanes*: PCL -> PML -> Korlap/Admin TI -> Sistem Pananyo Taka).

### 7. Sequence Diagram Retrieval-Augmented Generation (AI RAG)
- **File:** `07_sequence_diagram_rag_ai.png`
- **Deskripsi:** Memodelkan urutan interaksi penarikan konteks data real-time, injeksi prompt, eksekusi multi-provider LLM, dan cURL network fallback engine.
