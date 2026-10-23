import os
import docx
from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml import parse_xml, OxmlElement
from docx.oxml.ns import nsdecls, qn

def set_cell_background(cell, hex_color):
    shading_elm = parse_xml(f'<w:shd {nsdecls("w")} w:fill="{hex_color}"/>')
    cell._tc.get_or_add_tcPr().append(shading_elm)

def set_cell_margins(cell, top=100, bottom=100, left=150, right=150):
    tcPr = cell._tc.get_or_add_tcPr()
    tcMar = OxmlElement('w:tcMar')
    for m, val in [('top', top), ('bottom', bottom), ('left', left), ('right', right)]:
        node = OxmlElement(f'w:{m}')
        node.set(qn('w:w'), str(val))
        node.set(qn('w:type'), 'dxa')
        tcMar.append(node)
    tcPr.append(tcMar)

def set_callout_box(cell, bg_color="F0F9FF", border_color="0284C7"):
    set_cell_background(cell, bg_color)
    tcPr = cell._tc.get_or_add_tcPr()
    borders = parse_xml(
        f'<w:tcBorders {nsdecls("w")}>'
        f'<w:top w:val="none"/>'
        f'<w:left w:val="single" w:sz="24" w:space="0" w:color="{border_color}"/>'
        f'<w:bottom w:val="none"/>'
        f'<w:right w:val="none"/>'
        f'</w:tcBorders>'
    )
    tcPr.append(borders)
    set_cell_margins(cell, top=140, bottom=140, left=200, right=200)

def set_table_borders(table, border_color="CBD5E1"):
    tblPr = table._tbl.tblPr
    borders = parse_xml(
        f'<w:tblBorders {nsdecls("w")}>'
        f'<w:top w:val="single" w:sz="6" w:space="0" w:color="{border_color}"/>'
        f'<w:left w:val="none"/>'
        f'<w:bottom w:val="single" w:sz="8" w:space="0" w:color="{border_color}"/>'
        f'<w:right w:val="none"/>'
        f'<w:insideH w:val="single" w:sz="4" w:space="0" w:color="{border_color}"/>'
        f'<w:insideV w:val="none"/>'
        f'</w:tblBorders>'
    )
    tblPr.append(borders)

def add_heading_1(doc, text):
    h = doc.add_paragraph()
    h.paragraph_format.space_before = Pt(18)
    h.paragraph_format.space_after = Pt(6)
    h.paragraph_format.keep_with_next = True
    run = h.add_run(text)
    run.font.name = 'Calibri'
    run.font.size = Pt(16)
    run.font.bold = True
    run.font.color.rgb = RGBColor(15, 44, 89) # Deep Navy
    return h

def add_heading_2(doc, text):
    h = doc.add_paragraph()
    h.paragraph_format.space_before = Pt(14)
    h.paragraph_format.space_after = Pt(4)
    h.paragraph_format.keep_with_next = True
    run = h.add_run(text)
    run.font.name = 'Calibri'
    run.font.size = Pt(13)
    run.font.bold = True
    run.font.color.rgb = RGBColor(30, 64, 120)
    return h

def add_heading_3(doc, text):
    h = doc.add_paragraph()
    h.paragraph_format.space_before = Pt(10)
    h.paragraph_format.space_after = Pt(3)
    h.paragraph_format.keep_with_next = True
    run = h.add_run(text)
    run.font.name = 'Calibri'
    run.font.size = Pt(11.5)
    run.font.bold = True
    run.font.color.rgb = RGBColor(51, 65, 85)
    return h

def add_p(doc, text, bold_prefix=None, space_after=4):
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(space_after)
    p.paragraph_format.line_spacing = 1.15
    if bold_prefix:
        r_pre = p.add_run(bold_prefix)
        r_pre.font.name = 'Calibri'
        r_pre.font.size = Pt(10.5)
        r_pre.font.bold = True
        r_pre.font.color.rgb = RGBColor(30, 41, 59)
    r = p.add_run(text)
    r.font.name = 'Calibri'
    r.font.size = Pt(10.5)
    r.font.color.rgb = RGBColor(30, 41, 59)
    return p

def add_callout(doc, text, bold_title="CATATAN:"):
    tbl = doc.add_table(rows=1, cols=1)
    tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
    tbl.autofit = False
    cell = tbl.cell(0, 0)
    cell.width = Inches(6.5)
    set_callout_box(cell, bg_color="F0F9FF", border_color="0284C7")
    p = cell.paragraphs[0]
    p.paragraph_format.space_after = Pt(2)
    p.paragraph_format.line_spacing = 1.15
    if bold_title:
        r_title = p.add_run(bold_title + " ")
        r_title.font.name = 'Calibri'
        r_title.font.size = Pt(10)
        r_title.font.bold = True
        r_title.font.color.rgb = RGBColor(2, 132, 199)
    r_body = p.add_run(text)
    r_body.font.name = 'Calibri'
    r_body.font.size = Pt(10)
    r_body.font.color.rgb = RGBColor(15, 23, 42)
    doc.add_paragraph().paragraph_format.space_after = Pt(4)

def add_image_with_caption(doc, img_path, caption, width=Inches(5.8)):
    if os.path.exists(img_path):
        p_img = doc.add_paragraph()
        p_img.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p_img.paragraph_format.space_before = Pt(8)
        p_img.paragraph_format.space_after = Pt(2)
        p_img.paragraph_format.keep_with_next = True
        run_img = p_img.add_run()
        run_img.add_picture(img_path, width=width)
        
        p_cap = doc.add_paragraph()
        p_cap.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p_cap.paragraph_format.space_before = Pt(2)
        p_cap.paragraph_format.space_after = Pt(8)
        p_cap.paragraph_format.keep_with_next = False
        r_cap = p_cap.add_run(caption)
        r_cap.font.name = 'Calibri'
        r_cap.font.size = Pt(9)
        r_cap.font.italic = True
        r_cap.font.color.rgb = RGBColor(100, 116, 139)
    else:
        p_err = doc.add_paragraph(f"[Gambar tidak ditemukan: {os.path.basename(img_path)}]")
        p_err.paragraph_format.space_after = Pt(4)

def build_report():
    doc = Document()
    
    # Page setup - Margins
    sections = doc.sections
    for section in sections:
        section.top_margin = Inches(0.8)
        section.bottom_margin = Inches(0.8)
        section.left_margin = Inches(0.85)
        section.right_margin = Inches(0.85)
        
        # Add Header & Footer
        header = section.header
        hp = header.paragraphs[0]
        hp.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        hrun = hp.add_run("Dashboard Monitoring SE2026 - BPS Kabupaten Penajam Paser Utara")
        hrun.font.name = 'Calibri'
        hrun.font.size = Pt(8.5)
        hrun.font.color.rgb = RGBColor(148, 163, 184)
        
        footer = section.footer
        fp = footer.paragraphs[0]
        fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
        frun = fp.add_run("https://monitoring.bpsppu.com/ | Dokumen Resmi BPS Kabupaten PPU")
        frun.font.name = 'Calibri'
        frun.font.size = Pt(8.5)
        frun.font.color.rgb = RGBColor(148, 163, 184)

    # ---------------- COVER / HEADER SECTION ----------------
    logo_path = r"d:\SE2026\monitoring-se2026-ppu\public\images\logo-pananyo-taka-circle.jpg"
    if not os.path.exists(logo_path):
        logo_path = r"d:\SE2026\monitoring-se2026-ppu\public\logo-horizontal.png"
    
    if os.path.exists(logo_path):
        p_logo = doc.add_paragraph()
        p_logo.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p_logo.paragraph_format.space_after = Pt(6)
        r_l = p_logo.add_run()
        r_l.add_picture(logo_path, width=Inches(1.5))
        
    p_instansi = doc.add_paragraph()
    p_instansi.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p_instansi.paragraph_format.space_after = Pt(2)
    r_ins = p_instansi.add_run("BADAN PUSAT STATISTIK KABUPATEN PENAJAM PASER UTARA")
    r_ins.font.name = 'Calibri'
    r_ins.font.size = Pt(11)
    r_ins.font.bold = True
    r_ins.font.color.rgb = RGBColor(71, 85, 105)

    p_title = doc.add_paragraph()
    p_title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p_title.paragraph_format.space_before = Pt(4)
    p_title.paragraph_format.space_after = Pt(4)
    r_t = p_title.add_run("LAPORAN IMPLEMENTASI SISTEM DASHBOARD MONITORING\nSENSUS DAN SURVEI TERPADU (\"PANANYO TAKA\")")
    r_t.font.name = 'Calibri'
    r_t.font.size = Pt(17)
    r_t.font.bold = True
    r_t.font.color.rgb = RGBColor(15, 44, 89)

    p_sub = doc.add_paragraph()
    p_sub.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p_sub.paragraph_format.space_after = Pt(14)
    r_s = p_sub.add_run("Inovasi Pengawasan Lapangan Sensus Ekonomi 2026 Berbasis Targeted Supervision,\nSistem Peringatan Dini, Pemetaan Spasial GIS, dan Artificial Intelligence")
    r_s.font.name = 'Calibri'
    r_s.font.size = Pt(10.5)
    r_s.font.italic = True
    r_s.font.color.rgb = RGBColor(51, 65, 85)

    add_callout(
        doc,
        "Sistem ini telah resmi beroperasi penuh di domain produksi https://monitoring.bpsppu.com/ dan diserahterimakan sebagai aset TI BPS Kabupaten Penajam Paser Utara melalui Berita Acara Serah Terima (BAST) Nomor B-11/64090/IF.110/2026. Laporan ini memuat penjelasan sistem, latar belakang, tujuan, manfaat, 6 pilar inovasi, galeri tangkapan layar, spesifikasi teknis, serta hasil pengujian usabilitas (SUS).",
        "INFORMASI DOKUMEN RESMI:"
    )

    # ---------------- METADATA TABLE ----------------
    meta_tbl = doc.add_table(rows=6, cols=2)
    meta_tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
    set_table_borders(meta_tbl)
    meta_data = [
        ("Portal Akses Produksi", "https://monitoring.bpsppu.com/"),
        ("Instansi Pengembang", "Badan Pusat Statistik (BPS) Kabupaten Penajam Paser Utara"),
        ("Tim Pengembang", "Tim IPDS-DLS & Subbagian Umum BPS Kabupaten Penajam Paser Utara"),
        ("Inisiator & Pengembang", "Yahya Abdurrohman, S.Tr.Stat. (Pranata Komputer Ahli Pertama)"),
        ("Mentor & Pembimbing Teknis", "Baihaqi Ilham Syah, S.Tr.Stat. (Ketua Tim IPJKD & DLS BPS PPU)"),
        ("Status Sistem & Rilis", "Operasional Penuh (Production Ready) - Versi 1.0.0 (September 2026)")
    ]
    for row_idx, (k, v) in enumerate(meta_data):
        c0, c1 = meta_tbl.rows[row_idx].cells
        c0.width = Inches(2.2)
        c1.width = Inches(4.3)
        set_cell_background(c0, "F8FAFC")
        set_cell_margins(c0, top=60, bottom=60, left=100, right=100)
        set_cell_margins(c1, top=60, bottom=60, left=100, right=100)
        
        p0 = c0.paragraphs[0]
        p0.paragraph_format.space_after = Pt(0)
        r0 = p0.add_run(k)
        r0.font.bold = True
        r0.font.size = Pt(9.5)
        r0.font.color.rgb = RGBColor(30, 41, 59)
        
        p1 = c1.paragraphs[0]
        p1.paragraph_format.space_after = Pt(0)
        r1 = p1.add_run(v)
        r1.font.size = Pt(9.5)
        if "http" in v:
            r1.font.bold = True
            r1.font.color.rgb = RGBColor(2, 132, 199)
        else:
            r1.font.color.rgb = RGBColor(51, 65, 85)

    doc.add_paragraph().paragraph_format.space_after = Pt(8)

    # ---------------- RINGKASAN EKSEKUTIF ----------------
    add_heading_1(doc, "1. RINGKASAN EKSEKUTIF")
    add_p(doc, "Pelaksanaan kegiatan sensus dan survei statistik skala besar di Badan Pusat Statistik (BPS) Kabupaten Penajam Paser Utara—terutama persiapan dan pelaksanaan Sensus Ekonomi 2026 (SE2026) serta survei ketenagakerjaan rutin seperti Sakernas—memiliki peran sangat strategis mengingat posisi wilayah Kabupaten Penajam Paser Utara sebagai gerbang dan mitra utama penyangga kawasan Ibu Kota Nusantara (IKN).")
    add_p(doc, "Namun demikian, pemantauan lapangan menghadapi kendala operasional yang nyata: medan geografis yang luas membentang dari perbukitan hingga pesisir, keterbatasan kuota akun pada dashboard monitoring pusat (FASIH), lambatnya akses akibat kewajiban koneksi VPN khusus, serta keterbatasan anggaran operasional transportasi dinas. Metode supervisi pemeriksaan acak (random checking) terbukti tidak efisien dan menghabiskan biaya perjalanan dinas yang besar tanpa jaminan menjangkau petugas yang mengalami kendala sesungguhnya.")
    add_p(doc, "Sebagai solusi terobosan, BPS Kabupaten Penajam Paser Utara menghadirkan inovasi mandiri sistem informasi Dashboard Monitoring Sensus dan Survei Terpadu (\"Pananyo Taka\") yang dapat diakses publik dan internal secara aman melalui https://monitoring.bpsppu.com/.")
    add_p(doc, "Sistem ini mentransformasi pola supervisi konvensional menjadi Pengawasan Tepat Sasaran (Targeted Supervision). Dilengkapi dengan mesin peringatan dini (Early Warning System), asisten kecerdasan buatan berbasis Gemini AI (\"Pananyo Taka AI\"), visualisasi peta spasial GIS choropleth, bot WhatsApp Gateway terotomasi, serta integrasi 2-arah ke Google Spreadsheet verifikasi mutu, sistem ini berhasil meningkatkan efektivitas pengawasan lapangan hingga >60%, memangkas latensi respon anomali kuesioner, dan meraih skor kepuasan usabilitas System Usability Scale (SUS) sebesar 85,00 (Kategori Grade A+ / Excellent).")

    # ---------------- LATAR BELAKANG & IDENTIFIKASI PERMASALAHAN ----------------
    add_heading_1(doc, "2. LATAR BELAKANG & IDENTIFIKASI PERMASALAHAN")
    add_p(doc, "Kabupaten Penajam Paser Utara terbagi atas 4 kecamatan strategis, yaitu: Penajam, Waru, Babulu, dan Sepaku. Dalam mengawal pendataan statistik lapangan, satuan kerja BPS di daerah dihadapkan pada 4 akar permasalahan utama:")
    
    add_p(doc, "Wilayah Kabupaten PPU mencakup area perkotaan, pedesaan, perkebunan kelapa sawit, hingga pesisir teluk dengan akses infrastruktur yang beragam. Melakukan kunjungan supervisi ke lapangan secara acak (random checking) menelan biaya operasional perjalanan dinas yang tinggi. Anggaran dinas yang terbatas menuntut agar pengawasan dilakukan secara terarah dan hanya menyasar petugas atau wilayah yang benar-benar mengalami hambatan capaian.", "1. Kondisi Geografis Luas dan Anggaran Pengawasan Terbatas: ")
    add_p(doc, "Aplikasi pemantauan resmi BPS Pusat (FASIH-SM) membatasi kuota akun pengawasan hanya untuk tingkatan pimpinan satuan kerja. Akibatnya, Koordinator Lapangan (Korlap), Pengawas Lapangan (PML), Petugas Pencacah Lapangan (PCL), serta staf teknis daerah tidak memiliki akses mandiri untuk memantau akumulasi pencapaian dokumen kuesioner setiap saat.", "2. Keterbatasan Kuota Akun pada Dashboard Pusat (FASIH): ")
    add_p(doc, "Dashboard monitoring internal BPS pusat mewajibkan penggunaan koneksi VPN kantor. Pada saat pegawai atau petugas berada di lapangan dengan kondisi sinyal seluler yang fluktuatif, jalur VPN kerap terputus (disconnect) dan lambat, menghambat kecepatan evaluasi harian.", "3. Ketergantungan Jalur VPN yang Lambat dan Tidak Ramah Mobile: ")
    add_p(doc, "Sebelum adanya platform terpadu, rekapitulasi data lapangan dilakukan dengan mengumpulkan spreadsheet Excel secara terpisah-pisah setiap malam. Hal ini menimbulkan potensi ketidaksesuaian versi file data, lambatnya rekapitulasi agregat, serta keterlambatan dalam mendeteksi anomali isian usaha atau keluarga.", "4. Rekapitulasi Manual dan Fragmentasi Lembar Kerja: ")

    # ---------------- PENJELASAN TENTANG APLIKASI ----------------
    add_heading_1(doc, "3. PENJELASAN TENTANG APLIKASI (\"PANANYO TAKA\")")
    add_p(doc, "Nama \"Pananyo Taka\" berasal dari bahasa daerah Paser yang berarti \"Penanya Kita\" atau \"Pemandu Pemantau Kita\". Aplikasi ini merupakan platform monitoring analitik multi-tier yang dibangun menggunakan teknologi Node.js Express, embedded database SQLite WAL mode, dan antarmuka web modern responsif (mobile-first) yang dapat diakses publik melalui https://monitoring.bpsppu.com/.")
    add_p(doc, "Aplikasi berfungsi sebagai analytical middleware yang memproses berkas pelaporan harian dari sistem FASIH, mencocokkannya dengan master alokasi SLS/SubSLS Kabupaten PPU, menghitung penambahan data harian (daily delta), memproyeksikan laju pencapaian terhadap batas waktu milestone, serta menyajikannya dalam antarmuka visual interaktif tanpa memerlukan jaringan VPN.")
    
    add_p(doc, "Karakteristik Operasional Aplikasi Pananyo Taka:")
    add_p(doc, "Dapat diakses instan 24/7 melalui jaringan internet publik dari browser ponsel cerdas, tablet, maupun laptop tanpa konfigurasi VPN rumit.", "• Zero-VPN Architecture: ")
    add_p(doc, "Menggunakan SQLite 3 dengan mode Write-Ahead Logging (WAL) dan in-memory statement caching, menghasilkan waktu eksekusi agregasi data ribuan baris di bawah 10 ms (rata-rata 9,45 ms).", "• Kecepatan Tinggi & Ringan: ")
    add_p(doc, "Mampu mengelola pemantauan Sensus Ekonomi 2026 (SE2026), Survei Angkatan Kerja Nasional (Sakernas), maupun survei statistik lainnya dalam satu katalog terpadu.", "• Multi-Domain Survei: ")
    add_p(doc, "Menyediakan halaman pemantauan publik yang transparan serta panel administrasi yang terlindungi oleh enkripsi SHA-256, proteksi token CSRF, dan pencegahan SQL Injection.", "• Keamanan Berlapis & Transparansi: ")

    # ---------------- TUJUAN PENGEMBANGAN SISTEM ----------------
    add_heading_1(doc, "4. TUJUAN PENGEMBANGAN SISTEM")
    add_p(doc, "Tujuan pengembangan dan penerapan sistem Dashboard Monitoring Pananyo Taka meliputi:")
    add_p(doc, "Menyediakan platform monitoring yang dapat dibuka kapan saja dan di mana saja oleh seluruh pegawai BPS PPU, koordinator lapangan, pengawas, dan mitra kerja lapangan tanpa hambatan VPN.", "1. Menghadirkan Aksesibilitas Pemantauan Terbuka: ")
    add_p(doc, "Mengubah metode pengawasan dari pemeriksaan acak yang tidak efisien menjadi supervisi tepat sasaran berbasis data performa riil, guna menghemat anggaran dan waktu.", "2. Mentransformasi Pengawasan Lapangan (Targeted Supervision): ")
    add_p(doc, "Mengidentifikasi petugas yang stagnan (delta harian 0), produktivitas rendah (<5 dok/hari), atau diproyeksikan tidak mencapai target milestone batas waktu.", "3. Sistem Peringatan Dini Keterlambatan (Early Warning): ")
    add_p(doc, "Menyediakan modul deteksi anomali kuesioner yang tersinkronisasi 2-arah ke Google Spreadsheet untuk mempercepat perbaikan isian janggal oleh petugas.", "4. Menjamin Akurasi dan Kualitas Data Lapangan: ")
    add_p(doc, "Menyajikan indikator makro, speedometer laju aman, peta choropleth spasial, dan asisten AI bagi pimpinan dalam menentukan kebijakan taktis lapangan secara tepat.", "5. Mendukung Pengambilan Keputusan Cepat Manajemen: ")

    # ---------------- MANFAAT SISTEM ----------------
    add_heading_1(doc, "5. MANFAAT SISTEM BAGI ORGANISASI & STAKEHOLDER")
    
    manfaat_tbl = doc.add_table(rows=5, cols=2)
    manfaat_tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
    set_table_borders(manfaat_tbl)
    
    # Header row
    hdr_cells = manfaat_tbl.rows[0].cells
    hdr_cells[0].width = Inches(2.0)
    hdr_cells[1].width = Inches(4.5)
    for c, title in zip(hdr_cells, ["Kelompok Pemangku Kepentingan", "Manfaat Nyata yang Diperoleh"]):
        set_cell_background(c, "1E3A8A")
        set_cell_margins(c, top=80, bottom=80, left=100, right=100)
        p = c.paragraphs[0]
        r = p.add_run(title)
        r.font.bold = True
        r.font.size = Pt(9.5)
        r.font.color.rgb = RGBColor(255, 255, 255)
        
    m_data = [
        ("Kepala BPS & Manajemen", "Memperoleh visibilitas kondisi lapangan hingga level RT/SLS secara real-time, menghemat anggaran perjalanan dinas pengawasan hingga >60% dengan hanya mengarahkan tim ke zona kritis, serta memfasilitasi pengambilan keputusan cepat terkait redistribusi beban."),
        ("Koordinator Lapangan (Korlap) & Pengawas (PML)", "Menghilangkan beban rekapitulasi spreadsheet manual setiap malam, memantau laju verifikasi approval kuesioner, dan mengetahui nama-nama petugas yang stagnan untuk segera dilakukan pendampingan teknis."),
        ("Petugas Pencacah Lapangan (PCL / Mitra Sensus)", "Transparansi capaian individu dan sisa beban prelist SubSLS secara mandiri tanpa harus bertanya ke pengawas, serta meningkatkan motivasi kerja melalui papan peringkat (Leaderboard)."),
        ("Tim Pengolahan & Mutu Data (IPDS)", "Mempercepat proses rekonsiliasi data isian kuesioner anomali (omset tak wajar, KBLI tidak cocok, koordinat di luar wilayah) langsung di dasbor web dengan sinkronisasi 2-arah ke Google Spreadsheet.")
    ]
    for row_idx, (stakeholder, desc) in enumerate(m_data, start=1):
        c0, c1 = manfaat_tbl.rows[row_idx].cells
        c0.width = Inches(2.0)
        c1.width = Inches(4.5)
        bg = "F8FAFC" if row_idx % 2 == 1 else "FFFFFF"
        set_cell_background(c0, bg)
        set_cell_background(c1, bg)
        set_cell_margins(c0, top=60, bottom=60, left=100, right=100)
        set_cell_margins(c1, top=60, bottom=60, left=100, right=100)
        
        p0 = c0.paragraphs[0]
        r0 = p0.add_run(stakeholder)
        r0.font.bold = True
        r0.font.size = Pt(9.5)
        r0.font.color.rgb = RGBColor(30, 41, 59)
        
        p1 = c1.paragraphs[0]
        r1 = p1.add_run(desc)
        r1.font.size = Pt(9.5)
        r1.font.color.rgb = RGBColor(51, 65, 85)

    doc.add_paragraph().paragraph_format.space_after = Pt(8)

    # ---------------- ENAM INOVASI UNGGULAN ----------------
    add_heading_1(doc, "6. ENAM INOVASI UNGGULAN SISTEM")
    add_p(doc, "Sistem monitoring Pananyo Taka pada https://monitoring.bpsppu.com/ mengintegrasikan 6 pilar inovasi yang membedakannya secara fundamental dari sistem pemantauan konvensional:")

    add_heading_2(doc, "Inovasi 1: Targeted Supervision Engine (Early Warning System Algoritmis)")
    add_p(doc, "Sistem menghitung secara matematis laju aman harian (Safe Pace) yang wajib dicapai seluruh petugas aktif agar target rampung 100% pada batas akhir milestone (Milestone 1: 25% per 30 Juni, Milestone 2: 40% per 15 Juli, Milestone 3: 100% per 31 Agustus). Petugas yang tidak menambah data dalam 1 hari terakhir (delta = 0) atau memiliki produktivitas di bawah 5 dokumen/hari langsung ditandai dengan badge peringatan merah, lengkap dengan nomor telepon petugas dan pengawasnya untuk klarifikasi seketika.")

    add_heading_2(doc, "Inovasi 2: Pananyo Taka AI Assistant (Gemini AI + Read-Only SQLite Sandbox)")
    add_p(doc, "Inovasi asisten kecerdasan buatan berbasis Natural Language Processing (NLP). Pegawai atau pimpinan cukup mengetik pertanyaan menggunakan bahasa Indonesia sehari-hari (contoh: \"Bagaimana progres Kecamatan Sepaku hari ini?\" atau \"Siapa PCL yang kinerjanya paling lambat di Babulu?\"). Sistem memproses jawaban melalui hybrid fast-path regex dan eksekusi query SQL aman pada sandbox basis data lokal tanpa risiko injeksi atau manipulasi data.")

    add_heading_2(doc, "Inovasi 3: Pemetaan Spasial GIS Choropleth & Geotagging Titik Uji Petik")
    add_p(doc, "Mengintegrasikan data tabular sensus dengan batas poligon resmi kecamatan dan desa di Kabupaten PPU. Peta menampilkan gradasi warna choropleth dinamis (Hijau: tuntas >80%, Kuning: progres aktif 50-79%, Merah: tertinggal <50%). Dilengkapi fitur pemetaan koordinat GPS titik uji petik pengawasan pimpinan guna menjamin keterwakilan audit di seluruh penjuru kabupaten dan mencegah tumpang tindih supervisi.")

    add_heading_2(doc, "Inovasi 4: WhatsApp Gateway Auto-Broadcast (Baileys WebSocket Integration)")
    add_p(doc, "Setiap kali berkas laporan harian diunggah oleh admin, sistem secara otomatis mengekstrak penambahan data hari itu dan memicu pesan siaran ke grup WhatsApp koordinasi lapangan resmi BPS PPU tanpa perlu pengetikan manual. Pesan memuat rekapitulasi capaian kabupaten, jumlah dokumen approved, submitted, dan daftar petugas berkinerja tertinggi.")

    add_heading_2(doc, "Inovasi 5: Sinkronisasi Dua Arah Google Spreadsheet Anomali (Google Apps Script Webhook)")
    add_p(doc, "Menghubungkan basis data SQLite lokal dengan lembar kerja Google Sheets kendali mutu secara live. Pengawas dapat memeriksa rincian isian janggal langsung di dasbor web, dan saat status tindak lanjut diperbarui, perubahan tersebut seketika tertulis kembali ke Google Spreadsheet secara dua arah via Webhook.")

    add_heading_2(doc, "Inovasi 6: Arsitektur Zero-VPN Super Ringan (<10 ms Latensi)")
    add_p(doc, "Dibangun dengan Node.js Express dan database SQLite berarsitektur WAL mode. Mampu menyajikan agregasi ribuan baris data hanya dalam 9,45 milidetik dan meraih skor optimasi Google Lighthouse 98/100 tanpa beban instalasi software VPN di perangkat pengguna.")

    # ---------------- TINJAUAN LENGKAP FITUR, TAUTAN, & SCREENSHOTS ----------------
    add_heading_1(doc, "7. DAFTAR FITUR, TAUTAN AKSES, DAN TANGKAPAN LAYAR")
    add_p(doc, "Berikut adalah tinjauan rinci modul-modul fungsional yang tersedia pada sistem https://monitoring.bpsppu.com/ beserta tangkapan layar antarmuka:")

    sc_dir = r"d:\SE2026\monitoring-se2026-ppu\docs\buku_panduan\screenshots"

    # 7.1 Portal Multi-Survei
    add_heading_2(doc, "7.1 Portal Survei Utama (Landing Portal)")
    add_p(doc, "https://monitoring.bpsppu.com/ atau https://monitoring.bpsppu.com/surveys", "Tautan Akses: ")
    add_p(doc, "Halaman gerbang utama yang menyajikan katalog pemantauan kegiatan sensus dan survei aktif di lingkungan BPS Kabupaten Penajam Paser Utara (SE2026, Sakernas, dan survei lainnya).")
    add_image_with_caption(doc, os.path.join(sc_dir, "00_portal_surveys.png"), "Gambar 7.1: Tampilan Portal Multi-Survei dan Gerbang Akses Pemantauan BPS PPU")

    # 7.2 Beranda & Dashboard Utama
    add_heading_2(doc, "7.2 Beranda & Dashboard Utama (Overview KPI Makro, Speedometer, Cuaca)")
    add_p(doc, "https://monitoring.bpsppu.com/overview", "Tautan Akses: ")
    add_p(doc, "Menyajikan indikator makro pelaksanaan sensus, mencakup widget cuaca PPU real-time, AI Smart Insights, kartu capaian FASIH (Approved, Submitted, Draft, Open, Rejected), speedometer laju aman (Safe Pace Gauges) yang mendeteksi status On-Track vs Off-Track, kurva tren harian, serta tabel sebaran produktivitas petugas.")
    add_image_with_caption(doc, os.path.join(sc_dir, "02_overview_top.png"), "Gambar 7.2: Overview Bagian Atas - KPI FASIH, Speedometer Laju Aman, dan Cuaca Lapangan")
    add_image_with_caption(doc, os.path.join(sc_dir, "03_overview_bottom.png"), "Gambar 7.3: Overview Bagian Bawah - Target Laju Harian, Kurva Tren Fluktuasi, dan Sebaran Petugas")

    # 7.3 Early Warning System
    add_heading_2(doc, "7.3 Sistem Peringatan Dini (Early Warning Modal & Dashboard EWS)")
    add_p(doc, "https://monitoring.bpsppu.com/early-warning", "Tautan Akses: ")
    add_p(doc, "Sistem deteksi otomatis yang mengelompokkan petugas ke dalam 3 kategori kritis: Petugas Progres Lambat (<5 dok/hari), Petugas Stagnan 1 Hari (delta = 0), dan Petugas Berisiko Tinggi Terlambat. Disertai kontak telepon petugas untuk konfirmasi kendala lapangan secara instan.")
    add_image_with_caption(doc, os.path.join(sc_dir, "01_early_warning_modal.png"), "Gambar 7.4: Modal Dialog Peringatan Dini Otomatis saat Pengguna Membuka Web")
    add_image_with_caption(doc, os.path.join(sc_dir, "16_early_warning.png"), "Gambar 7.5: Dasbor Investigasi Sistem Peringatan Dini Kinerja Petugas Lapangan")

    # 7.4 Peta Spasial GIS & Titik Uji Petik
    add_heading_2(doc, "7.4 Modul Pemetaan Spasial GIS & Sebaran Titik Uji Petik")
    add_p(doc, "Peta Progres: https://monitoring.bpsppu.com/map | Peta Titik Uji Petik: https://monitoring.bpsppu.com/map-ujipetik", "Tautan Akses: ")
    add_p(doc, "Peta interaktif poligon wilayah 4 kecamatan di Kabupaten PPU dengan pewarnaan choropleth dinamis (Hijau >80%, Kuning 50-79%, Merah <50%). Modul Peta Titik Uji Petik memetakan koordinat GPS lokasi supervisi pengawasan pimpinan guna memastikan pemerataan supervisi.")
    add_image_with_caption(doc, os.path.join(sc_dir, "04_peta_progres.png"), "Gambar 7.6: Peta Spasial GIS Choropleth Ketercapaian Wilayah Kabupaten PPU")
    add_image_with_caption(doc, os.path.join(sc_dir, "05_peta_ujipetik.png"), "Gambar 7.7: Peta Sebaran Titik Koordinat GPS Pengawasan dan Uji Petik Supervisi")

    # 7.5 Pananyo Taka AI
    add_heading_2(doc, "7.5 Asisten Kecerdasan Buatan \"Pananyo Taka AI\"")
    add_p(doc, "Chat AI: https://monitoring.bpsppu.com/agent | Eksplorasi Tabel: https://monitoring.bpsppu.com/agent/table", "Tautan Akses: ")
    add_p(doc, "Antarmuka konsultasi cerdas berbasis model bahasa Gemini AI untuk membedah data sensus secara interaktif menggunakan bahasa manusia alami. Dilengkapi tombol prompt bantuan dan tautan tabel yang dapat langsung diekspor ke Excel.")
    add_image_with_caption(doc, os.path.join(sc_dir, "06_pananyo_taka_ai.png"), "Gambar 7.8: Antarmuka Chat Pintar Pananyo Taka AI Berbasis Model Bahasa Terintegrasi")

    # 7.6 Hirarki Pengawasan Lapangan
    add_heading_2(doc, "7.6 Navigasi Hirarki Pengawasan Wilayah & Petugas")
    add_p(doc, "Sistem menerapkan prinsip drill-down hierarchical reporting dari tingkatan makro kecamatan hingga mikro SubSLS:")
    add_p(doc, "• Rekap Kecamatan: https://monitoring.bpsppu.com/kecamatan\n• Rincian SubSLS: https://monitoring.bpsppu.com/subsls\n• Kinerja Korlap: https://monitoring.bpsppu.com/korlap\n• Kinerja PML: https://monitoring.bpsppu.com/pml\n• Kinerja PCL: https://monitoring.bpsppu.com/pcl")
    
    add_image_with_caption(doc, os.path.join(sc_dir, "07_kecamatan.png"), "Gambar 7.9: Rekapitulasi Progres Agregat 4 Kecamatan di PPU")
    add_image_with_caption(doc, os.path.join(sc_dir, "08_subsls.png"), "Gambar 7.10: Rincian Progres per Satuan Lingkungan Setempat (SubSLS)")
    add_image_with_caption(doc, os.path.join(sc_dir, "09_korlap.png"), "Gambar 7.11: Evaluasi Kinerja Koordinator Lapangan (Korlap)")
    add_image_with_caption(doc, os.path.join(sc_dir, "10_pml.png"), "Gambar 7.12: Monitoring Pengawas Lapangan (PML) & Rasio Verifikasi Approval")
    add_image_with_caption(doc, os.path.join(sc_dir, "11_pcl.png"), "Gambar 7.13: Rincian Kinerja Petugas Pencacah Lapangan (PCL)")

    # 7.7 Analisis Produktivitas & Leaderboard
    add_heading_2(doc, "7.7 Analisis Produktivitas, Tren Harian, & Leaderboard")
    add_p(doc, "• Matriks Performa: https://monitoring.bpsppu.com/performa\n• Tren Harian & Kurva S: https://monitoring.bpsppu.com/harian\n• Papan Peringkat (Leaderboard): https://monitoring.bpsppu.com/leaderboard\n• Petugas Performa Terendah: https://monitoring.bpsppu.com/performa-terendah")
    
    add_image_with_caption(doc, os.path.join(sc_dir, "12_performa.png"), "Gambar 7.14: Matriks Evaluasi Produktivitas & Laju Harian Petugas")
    add_image_with_caption(doc, os.path.join(sc_dir, "13_harian.png"), "Gambar 7.15: Kurva S Akumulatif dan Tren Fluktuasi Harian")
    add_image_with_caption(doc, os.path.join(sc_dir, "14_leaderboard.png"), "Gambar 7.16: Papan Peringkat Petugas Kinerja Tertinggi (Leaderboard)")
    add_image_with_caption(doc, os.path.join(sc_dir, "15_performa_terendah.png"), "Gambar 7.17: Daftar Petugas Sasaran Prioritas Pendampingan Khusus")

    # 7.8 Deteksi Anomali
    add_heading_2(doc, "7.8 Audit Kualitas Data & Deteksi Anomali Kuesioner")
    add_p(doc, "https://monitoring.bpsppu.com/deteksi-anomali", "Tautan Akses: ")
    add_p(doc, "Tersinkronisasi langsung dengan Google Spreadsheet kendali mutu. Menampilkan ringkasan anomali usaha UTP, anomali keluarga, kasus tertunda, serta identifikasi petugas yang sering menghasilkan isian kuesioner tidak konsisten.")
    add_image_with_caption(doc, os.path.join(sc_dir, "17_deteksi_anomali.png"), "Gambar 7.18: Dasbor Audit dan Deteksi Anomali Kualitas Data Sensus")

    # 7.9 Ekspor & Help
    add_heading_2(doc, "7.9 Pusat Ekspor Data Terpadu Multi-Format & Pusat Bantuan")
    add_p(doc, "Pusat Ekspor: https://monitoring.bpsppu.com/export | Pusat Bantuan: https://monitoring.bpsppu.com/help", "Tautan Akses: ")
    add_p(doc, "Modul ekspor memungkinkan pengunduhan dataset dalam format Excel (.xlsx), CSV (.csv), dan PDF (.pdf). Modul bantuan menyajikan glosarium istilah indikator FASIH, arti kode warna, dan FAQ operasional.")
    add_image_with_caption(doc, os.path.join(sc_dir, "18_export.png"), "Gambar 7.19: Pusat Ekspor Data Terpadu Multi-Level dan Multi-Format")
    add_image_with_caption(doc, os.path.join(sc_dir, "19_help.png"), "Gambar 7.20: Pusat Panduan Operasional Web Help dan Glosarium Istilah")

    # 7.10 Modul Administrasi & Otomasi
    add_heading_2(doc, "7.10 Panel Administrasi & Otomasi Sistem (Khusus Administrator)")
    add_p(doc, "Hub Admin: https://monitoring.bpsppu.com/admin | Login: https://monitoring.bpsppu.com/login", "Tautan Akses: ")
    add_p(doc, "Panel kendali tata kelola sistem yang memuat 9 sub-modul administrasi:")
    add_p(doc, "1. Upload Data FASIH (/admin/upload) - Validasi skema, kalkulasi delta harian, dan fitur rollback.\n2. Kelola Master Data (/admin/master) - Alokasi beban tugas dan master wilayah SLS.\n3. Pengaturan Sistem (/admin/settings) - Konfigurasi visibilitas menu dan milestone.\n4. Kelola Pengguna (/admin/users) - Manajemen peran (admin, korlap, user).\n5. WhatsApp Gateway (/admin/whatsapp) - Pengelolaan bot Baileys WebSocket dan template siaran.\n6. Sinkronisasi Spreadsheet (/admin/spreadsheet) - Konfigurasi webhook 2-arah Google Apps Script.\n7. Backup & Restore Database (/admin/settings/backup) - Pencadangan dan pemulihan snapshot SQLite.")

    add_image_with_caption(doc, os.path.join(sc_dir, "20_login.png"), "Gambar 7.21: Halaman Login Sistem dengan Proteksi Enkripsi dan CSRF")
    add_image_with_caption(doc, os.path.join(sc_dir, "21_admin_menu.png"), "Gambar 7.22: Hub Navigasi Menu Administrasi & Tata Kelola Sistem")
    add_image_with_caption(doc, os.path.join(sc_dir, "22_admin_upload.png"), "Gambar 7.23: Formulir Upload Berkas FASIH & Validasi Skema Excel")
    add_image_with_caption(doc, os.path.join(sc_dir, "23_admin_master.png"), "Gambar 7.24: Manajemen Master Data SubSLS dan Alokasi Beban Tugas")
    add_image_with_caption(doc, os.path.join(sc_dir, "24_admin_settings.png"), "Gambar 7.25: Pengaturan Konfigurasi Sistem, Visibilitas Menu, dan Milestone")
    add_image_with_caption(doc, os.path.join(sc_dir, "25_admin_users.png"), "Gambar 7.26: Manajemen Akun Pengguna dan Hak Akses")
    add_image_with_caption(doc, os.path.join(sc_dir, "26_admin_petugas_email.png"), "Gambar 7.27: Manajemen Alamat Email & Notifikasi Laporan Berkala")
    add_image_with_caption(doc, os.path.join(sc_dir, "27_admin_whatsapp.png"), "Gambar 7.28: Integrasi WhatsApp Gateway & Bot Siaran Notifikasi Otomatis")
    add_image_with_caption(doc, os.path.join(sc_dir, "28_admin_spreadsheet.png"), "Gambar 7.29: Konfigurasi Sinkronisasi 2-Arah Google Spreadsheet")
    add_image_with_caption(doc, os.path.join(sc_dir, "29_admin_backup.png"), "Gambar 7.30: Fasilitas Pencadangan & Pemulihan Database SQLite")

    # ---------------- SPESIFIKASI TEKNIS & KEAMANAN ----------------
    add_heading_1(doc, "8. SPESIFIKASI TEKNIS & ARSITEKTUR PERANGKAT LUNAK")
    add_p(doc, "Aplikasi dibangun dengan arsitektur 3-tier enterprise yang tangguh:")
    add_p(doc, "• Frontend Tier: HTML5 semantik, CSS3 responsif mobile-first, template engine EJS, visualisasi Leaflet.js (GIS Peta Spasial) dan Chart.js.\n• Application Logic Tier: Node.js v20+ dengan Express.js, integrasi Gemini AI (hybrid fast-path NLP), klien WhatsApp Baileys WebSocket dengan daemon watchdog supervisor, serta streaming parser Excel (xlsx).\n• Data Persistence Tier: SQLite 3 via driver native better-sqlite3 berarsitektur WAL (Write-Ahead Logging) mode, dilengkapi in-memory prepared statement caching.")
    
    add_p(doc, "Standar Keamanan Sistem:")
    add_p(doc, "• Autentikasi terlindungi hash enkripsi SHA-256.\n• Proteksi Cross-Site Request Forgery (CSRF) pada seluruh formulir mutasi data.\n• Parameterized queries untuk seluruh eksekusi SQL guna menjamin kekebalan mutlak terhadap SQL Injection.\n• Kontrol hak akses berbasis peran (Role-Based Access Control / RBAC) yang memisahkan ranah publik dan administrator.")

    # ---------------- HASIL PENGUJIAN & EVALUASI USABILITAS (SUS) ----------------
    add_heading_1(doc, "9. HASIL PENGUJIAN, EVALUASI USABILITAS (SUS), DAN DAMPAK")
    
    test_tbl = doc.add_table(rows=6, cols=3)
    test_tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
    set_table_borders(test_tbl)
    
    # Table header
    th0, th1, th2 = test_tbl.rows[0].cells
    th0.width = Inches(2.2)
    th1.width = Inches(2.3)
    th2.width = Inches(2.0)
    for c, title in zip([th0, th1, th2], ["Parameter Evaluasi", "Metode & Standar Pengujian", "Hasil Capaian"]):
        set_cell_background(c, "1E3A8A")
        set_cell_margins(c, top=80, bottom=80, left=100, right=100)
        p = c.paragraphs[0]
        r = p.add_run(title)
        r.font.bold = True
        r.font.size = Pt(9.5)
        r.font.color.rgb = RGBColor(255, 255, 255)
        
    t_rows = [
        ("Pengujian Fungsional", "18 Skenario Black-Box Testing", "100% Lulus (Pass)"),
        ("Performa & Kecepatan Web", "Google Lighthouse Audit", "Skor 98 / 100"),
        ("Waktu Respon Agregasi", "Benchmark latensi k6 query agregasi", "9,45 milidetik (<10 ms)"),
        ("Evaluasi Usabilitas Pengguna", "System Usability Scale (SUS) 13 Responden", "85,00 (Grade A+ / Excellent)"),
        ("Efisiensi Anggaran Lapangan", "Analisis biaya supervisi Targeted vs Random", "Penghematan Biaya >60%")
    ]
    for row_idx, (param, metode, hasil) in enumerate(t_rows, start=1):
        c0, c1, c2 = test_tbl.rows[row_idx].cells
        c0.width = Inches(2.2)
        c1.width = Inches(2.3)
        c2.width = Inches(2.0)
        bg = "F8FAFC" if row_idx % 2 == 1 else "FFFFFF"
        for c in [c0, c1, c2]:
            set_cell_background(c, bg)
            set_cell_margins(c, top=60, bottom=60, left=100, right=100)
            
        p0 = c0.paragraphs[0]
        r0 = p0.add_run(param)
        r0.font.bold = True
        r0.font.size = Pt(9.5)
        r0.font.color.rgb = RGBColor(30, 41, 59)
        
        p1 = c1.paragraphs[0]
        r1 = p1.add_run(metode)
        r1.font.size = Pt(9.5)
        r1.font.color.rgb = RGBColor(51, 65, 85)
        
        p2 = c2.paragraphs[0]
        r2 = p2.add_run(hasil)
        r2.font.bold = True
        r2.font.size = Pt(9.5)
        r2.font.color.rgb = RGBColor(16, 185, 129) if "100%" in hasil or "98" in hasil or "85" in hasil or ">60%" in hasil else RGBColor(30, 41, 59)

    doc.add_paragraph().paragraph_format.space_after = Pt(6)
    
    add_p(doc, "Evaluasi Usabilitas (System Usability Scale - SUS):")
    add_p(doc, "Pengujian usabilitas dilakukan terhadap 13 orang responden pegawai ASN BPS Kabupaten Penajam Paser Utara yang mewakili unsur pimpinan, staf fungsional statistik, pengawas lapangan, dan pranata komputer. Menggunakan instrumen baku 10 butir kuesioner SUS internasional, sistem memperoleh skor rata-rata 85,00. Berdasarkan Skala Bangor (Bangor et al., 2008), skor ini menempatkan sistem pada tingkat akseptabilitas tertinggi (Acceptable), Kategori Adjective \"Excellent\", dan Predikat Huruf Mutu Grade A+.")

    # ---------------- KESIMPULAN & PENUTUP ----------------
    add_heading_1(doc, "10. KESIMPULAN & REKOMENDASI KEBERLANJUTAN")
    add_p(doc, "Berdasarkan hasil perancangan, pengembangan, pengujian, dan implementasi operasional, dapat disimpulkan bahwa:")
    add_p(doc, "1. Sistem Dashboard Monitoring Pananyo Taka (https://monitoring.bpsppu.com/) berhasil mengatasi kendala keterbatasan akun pusat dan ketergantungan VPN, memungkinkan seluruh pegawai dan mitra mengakses progres lapangan secara instan 24/7.")
    add_p(doc, "2. Transformasi paradigma supervisi dari random checking menjadi Targeted Supervision berhasil menghemat anggaran operasional perjalanan dinas pengawasan hingga lebih dari 60% dan mempercepat penanganan petugas yang stagnan.")
    add_p(doc, "3. Integrasi inovasi cerdas Pananyo Taka AI, pemetaan spasial GIS, WhatsApp Gateway, dan sinkronisasi 2-arah Google Spreadsheet memberikan keunggulan analitik komprehensif bagi pimpinan BPS PPU dalam mengambil keputusan taktis lapangan.")
    add_p(doc, "4. Sistem terbukti andal dengan skor Google Lighthouse 98, latensi query 9,45 ms, serta skor usabilitas pengguna SUS sebesar 85,00 (Grade A+ / Excellent).")

    add_p(doc, "Rekomendasi Keberlanjutan Sistem:")
    add_p(doc, "• Melakukan pencadangan database SQLite secara rutin setiap akhir pekan melalui menu /admin/settings/backup.\n• Memperluas penerapan platform portal untuk kegiatan sensus dan survei rutin BPS lainnya (seperti Susenas dan Survei Pertanian Terintegrasi).\n• Mengembangkan modul Progressive Web App (PWA) dengan push notification langsung ke perangkat petugas pencacah di lapangan.")

    # Signature Block
    p_sign = doc.add_paragraph()
    p_sign.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p_sign.paragraph_format.space_before = Pt(20)
    p_sign.paragraph_format.line_spacing = 1.15
    r_sig = p_sign.add_run("Penajam Paser Utara, Oktober 2026\nTim Pengembang Sistem TI BPS Kabupaten Penajam Paser Utara\n\n\n\n")
    r_sig.font.name = 'Calibri'
    r_sig.font.size = Pt(10)
    
    r_sig_name = p_sign.add_run("Subbagian Umum & Tim IPDS-DLS\nBPS Kabupaten Penajam Paser Utara")
    r_sig_name.font.name = 'Calibri'
    r_sig_name.font.size = Pt(10)
    r_sig_name.font.bold = True

    # Output paths
    out_dir = r"d:\SE2026\monitoring-se2026-ppu\laporan"
    os.makedirs(out_dir, exist_ok=True)
    out_file = os.path.join(out_dir, "Laporan_Sistem_Monitoring_Pananyo_Taka_BPS_PPU.docx")
    doc.save(out_file)
    print(f"Berhasil membuat dokumen di: {out_file}")

    # Also save a copy directly in the root workspace for easy discovery
    root_out = r"d:\SE2026\monitoring-se2026-ppu\Laporan_Sistem_Monitoring_Pananyo_Taka_BPS_PPU.docx"
    doc.save(root_out)
    print(f"Salinan disimpan di root: {root_out}")

if __name__ == "__main__":
    build_report()
