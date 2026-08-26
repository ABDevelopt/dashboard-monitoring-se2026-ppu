import os
import re
import sys
import shutil
import docx

if sys.platform.startswith('win'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_ALIGN_VERTICAL
from docx.oxml import parse_xml, OxmlElement
from docx.oxml.ns import nsdecls, qn

# Color definitions
COLOR_NAVY = RGBColor(11, 19, 43)        # #0B132B
COLOR_BLUE = RGBColor(30, 58, 138)       # #1E3A8A
COLOR_CYAN = RGBColor(6, 182, 212)       # #06B6D4
COLOR_DARK = RGBColor(30, 41, 59)        # #1E293B
COLOR_MUTED = RGBColor(100, 116, 139)    # #64748B
HEX_NAVY = "0B132B"
HEX_BLUE = "1E3A8A"
HEX_LIGHT_BG = "F8FAFC"
HEX_BORDER = "CBD5E1"
HEX_SUCCESS_BG = "DCFCE7"
HEX_HEADER_BG = "1E293B"

def set_cell_background(cell, hex_color):
    """Sets background color of a table cell."""
    shading = parse_xml(f'<w:shd {nsdecls("w")} w:fill="{hex_color}"/>')
    cell._tc.get_or_add_tcPr().append(shading)

def set_cell_margins(cell, top=100, bottom=100, left=150, right=150):
    """Sets inner padding for a cell."""
    tcPr = cell._tc.get_or_add_tcPr()
    tcMar = parse_xml(f'<w:tcMar {nsdecls("w")}><w:top w:w="{top}" w:type="dxa"/><w:bottom w:w="{bottom}" w:type="dxa"/><w:left w:w="{left}" w:type="dxa"/><w:right w:w="{right}" w:type="dxa"/></w:tcMar>')
    tcPr.append(tcMar)

def set_table_borders(table, color="CBD5E1", sz="4", val="single"):
    """Sets elegant subtle borders on a table."""
    tblPr = table._tbl.tblPr
    tblBorders = parse_xml(
        f'<w:tblBorders {nsdecls("w")}>'
        f'<w:top w:val="{val}" w:sz="{sz}" w:space="0" w:color="{color}"/>'
        f'<w:bottom w:val="{val}" w:sz="{sz}" w:space="0" w:color="{color}"/>'
        f'<w:left w:val="none"/>'
        f'<w:right w:val="none"/>'
        f'<w:insideH w:val="{val}" w:sz="{sz}" w:space="0" w:color="{color}"/>'
        f'<w:insideV w:val="none"/>'
        f'</w:tblBorders>'
    )
    tblPr.append(tblBorders)

def create_document():
    doc = docx.Document()
    # Set page margins to standard A4 (2.54 cm / 1 inch)
    for section in doc.sections:
        section.top_margin = Inches(1.0)
        section.bottom_margin = Inches(1.0)
        section.left_margin = Inches(1.0)
        section.right_margin = Inches(1.0)
        
        # Add Header & Footer
        header = section.header
        hp = header.paragraphs[0]
        hp.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        hrun = hp.add_run("BPS Kabupaten Penajam Paser Utara | Dashboard Monitoring SE2026")
        hrun.font.name = "Arial"
        hrun.font.size = Pt(8.5)
        hrun.font.color.rgb = COLOR_MUTED
        
        footer = section.footer
        fp = footer.paragraphs[0]
        fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
        frun = fp.add_run("Dokumen Laporan Pengujian dan Verifikasi Sistem (SDLC Phase 4) — Pananyo Taka v1.0.0")
        frun.font.name = "Arial"
        frun.font.size = Pt(8.5)
        frun.font.color.rgb = COLOR_MUTED

    return doc

def add_header_banner(doc, title, subtitle, subsubtitle=None):
    """Adds a formal government header banner."""
    # Top organization line
    p_org = doc.add_paragraph()
    p_org.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p_org.paragraph_format.space_before = Pt(0)
    p_org.paragraph_format.space_after = Pt(2)
    r_org = p_org.add_run("BADAN PUSAT STATISTIK KABUPATEN PENAJAM PASER UTARA")
    r_org.font.name = "Arial"
    r_org.font.size = Pt(11)
    r_org.font.bold = True
    r_org.font.color.rgb = COLOR_BLUE

    p_suborg = doc.add_paragraph()
    p_suborg.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p_suborg.paragraph_format.space_before = Pt(0)
    p_suborg.paragraph_format.space_after = Pt(12)
    r_suborg = p_suborg.add_run("PELATIHAN DASAR CPNS GOLONGAN III TAHUN 2026")
    r_suborg.font.name = "Arial"
    r_suborg.font.size = Pt(9.5)
    r_suborg.font.color.rgb = COLOR_MUTED

    # Title Box (Table with navy background)
    table = doc.add_table(rows=1, cols=1)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    table.columns[0].width = Inches(6.5)

    cell = table.cell(0, 0)
    set_cell_background(cell, HEX_NAVY)
    set_cell_margins(cell, top=180, bottom=180, left=200, right=200)

    p_t = cell.paragraphs[0]
    p_t.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p_t.paragraph_format.space_before = Pt(0)
    p_t.paragraph_format.space_after = Pt(4)
    r_t = p_t.add_run(title)
    r_t.font.name = "Arial"
    r_t.font.size = Pt(14)
    r_t.font.bold = True
    r_t.font.color.rgb = RGBColor(255, 255, 255)

    p_s = cell.add_paragraph()
    p_s.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p_s.paragraph_format.space_before = Pt(0)
    p_s.paragraph_format.space_after = Pt(2)
    r_s = p_s.add_run(subtitle)
    r_s.font.name = "Arial"
    r_s.font.size = Pt(11)
    r_s.font.bold = True
    r_s.font.color.rgb = COLOR_CYAN

    if subsubtitle:
        p_ss = cell.add_paragraph()
        p_ss.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p_ss.paragraph_format.space_before = Pt(0)
        p_ss.paragraph_format.space_after = Pt(0)
        r_ss = p_ss.add_run(subsubtitle)
        r_ss.font.name = "Arial"
        r_ss.font.size = Pt(9.5)
        r_ss.font.color.rgb = RGBColor(226, 232, 240)

    p_space = doc.add_paragraph()
    p_space.paragraph_format.space_before = Pt(10)
    p_space.paragraph_format.space_after = Pt(4)

def parse_markdown_to_docx(doc, md_content):
    lines = md_content.split('\n')
    i = 0
    in_table = False
    table_lines = []
    in_code_block = False
    code_lines = []

    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        # Skip main markdown top headers since banner covers it
        if i < 15 and (stripped.startswith('# ') or stripped.startswith('## ') or stripped.startswith('### ') or stripped.startswith('---')):
            i += 1
            continue

        # Code block handling
        if stripped.startswith('```'):
            if in_code_block:
                # End code block
                in_code_block = False
                code_text = '\n'.join(code_lines)
                table = doc.add_table(rows=1, cols=1)
                table.alignment = WD_TABLE_ALIGNMENT.CENTER
                table.columns[0].width = Inches(6.5)
                c = table.cell(0, 0)
                set_cell_background(c, "0F172A")
                set_cell_margins(c, top=120, bottom=120, left=150, right=150)
                cp = c.paragraphs[0]
                cp.paragraph_format.space_before = Pt(0)
                cp.paragraph_format.space_after = Pt(0)
                crun = cp.add_run(code_text)
                crun.font.name = "Consolas"
                crun.font.size = Pt(8.5)
                crun.font.color.rgb = RGBColor(56, 189, 248)
                doc.add_paragraph().paragraph_format.space_after = Pt(4)
                code_lines = []
            else:
                in_code_block = True
                code_lines = []
            i += 1
            continue

        if in_code_block:
            code_lines.append(line)
            i += 1
            continue

        # Table detection
        if '|' in stripped and ('|---|' in stripped or (i + 1 < len(lines) and '|---|' in lines[i+1])):
            in_table = True
            table_lines = [stripped]
            i += 1
            while i < len(lines) and '|' in lines[i].strip() and lines[i].strip():
                table_lines.append(lines[i].strip())
                i += 1
            
            # Process table lines
            parsed_rows = []
            for tl in table_lines:
                if re.match(r'^[\|\s\-:]+$', tl):
                    continue
                cols = [c.strip() for c in tl.strip('|').split('|')]
                parsed_rows.append(cols)

            if parsed_rows:
                num_cols = max(len(r) for r in parsed_rows)
                tbl = doc.add_table(rows=len(parsed_rows), cols=num_cols)
                tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
                set_table_borders(tbl)

                for r_idx, row_data in enumerate(parsed_rows):
                    is_header = (r_idx == 0)
                    for c_idx, cell_value in enumerate(row_data):
                        if c_idx < num_cols:
                            cell = tbl.cell(r_idx, c_idx)
                            cell.vertical_alignment = WD_ALIGN_VERTICAL.CENTER
                            set_cell_margins(cell, top=80, bottom=80, left=100, right=100)
                            
                            if is_header:
                                set_cell_background(cell, HEX_HEADER_BG)
                            elif r_idx % 2 == 1:
                                set_cell_background(cell, HEX_LIGHT_BG)

                            p = cell.paragraphs[0]
                            p.paragraph_format.space_before = Pt(0)
                            p.paragraph_format.space_after = Pt(0)
                            
                            # Clean markdown bold/italics
                            clean_text = cell_value.replace('**', '').replace('*', '').replace('`', '')
                            run = p.add_run(clean_text)
                            run.font.name = "Arial"
                            run.font.size = Pt(8.5 if is_header or len(clean_text) > 30 else 9.0)
                            
                            if is_header:
                                run.font.bold = True
                                run.font.color.rgb = RGBColor(255, 255, 255)
                            else:
                                run.font.color.rgb = COLOR_DARK
                                if "PASSED" in clean_text or "ACCEPT" in clean_text or "GOOD" in clean_text or "100%" in clean_text:
                                    run.font.bold = True
                                    run.font.color.rgb = RGBColor(16, 185, 129) # Green

                doc.add_paragraph().paragraph_format.space_after = Pt(6)
            in_table = False
            continue

        # Headings
        if stripped.startswith('# '):
            p = doc.add_paragraph()
            p.paragraph_format.space_before = Pt(14)
            p.paragraph_format.space_after = Pt(4)
            p.paragraph_format.keep_with_next = True
            run = p.add_run(stripped[2:].strip())
            run.font.name = "Arial"
            run.font.size = Pt(13)
            run.font.bold = True
            run.font.color.rgb = COLOR_NAVY
        elif stripped.startswith('## '):
            p = doc.add_paragraph()
            p.paragraph_format.space_before = Pt(12)
            p.paragraph_format.space_after = Pt(3)
            p.paragraph_format.keep_with_next = True
            run = p.add_run(stripped[3:].strip())
            run.font.name = "Arial"
            run.font.size = Pt(11.5)
            run.font.bold = True
            run.font.color.rgb = COLOR_BLUE
        elif stripped.startswith('### '):
            p = doc.add_paragraph()
            p.paragraph_format.space_before = Pt(10)
            p.paragraph_format.space_after = Pt(2)
            p.paragraph_format.keep_with_next = True
            run = p.add_run(stripped[4:].strip())
            run.font.name = "Arial"
            run.font.size = Pt(10.5)
            run.font.bold = True
            run.font.color.rgb = COLOR_DARK
        elif stripped.startswith('> '):
            # Callout box
            callout = stripped[2:].strip()
            table = doc.add_table(rows=1, cols=1)
            table.alignment = WD_TABLE_ALIGNMENT.CENTER
            table.columns[0].width = Inches(6.5)
            c = table.cell(0, 0)
            set_cell_background(c, "F1F5F9")
            set_cell_margins(c, top=100, bottom=100, left=140, right=140)
            
            # Add left border
            tcPr = c._tc.get_or_add_tcPr()
            tcBorders = parse_xml(f'<w:tcBorders {nsdecls("w")}><w:left w:val="single" w:sz="24" w:space="0" w:color="{HEX_BLUE}"/><w:top w:val="none"/><w:right w:val="none"/><w:bottom w:val="none"/></w:tcBorders>')
            tcPr.append(tcBorders)

            cp = c.paragraphs[0]
            cp.paragraph_format.space_before = Pt(0)
            cp.paragraph_format.space_after = Pt(0)
            clean_callout = callout.replace('**', '')
            crun = cp.add_run(clean_callout)
            crun.font.name = "Arial"
            crun.font.size = Pt(9.5)
            crun.font.italic = True
            crun.font.color.rgb = COLOR_DARK
            doc.add_paragraph().paragraph_format.space_after = Pt(4)
        elif stripped.startswith('- ') or stripped.startswith('* '):
            p = doc.add_paragraph(style='List Bullet')
            p.paragraph_format.space_before = Pt(1)
            p.paragraph_format.space_after = Pt(2)
            clean_bullet = stripped[2:].strip()
            # Simple bold parser
            parts = clean_bullet.split('**')
            for b_idx, part in enumerate(parts):
                run = p.add_run(part.replace('`', ''))
                run.font.name = "Arial"
                run.font.size = Pt(9.5)
                run.font.color.rgb = COLOR_DARK
                if b_idx % 2 == 1:
                    run.font.bold = True
        elif re.match(r'^\d+\.\s', stripped):
            p = doc.add_paragraph()
            p.paragraph_format.space_before = Pt(1)
            p.paragraph_format.space_after = Pt(2)
            match = re.match(r'^(\d+\.)\s*(.*)', stripped)
            if match:
                num_prefix, content = match.groups()
                r_num = p.add_run(num_prefix + " ")
                r_num.font.name = "Arial"
                r_num.font.size = Pt(9.5)
                r_num.font.bold = True
                r_num.font.color.rgb = COLOR_BLUE

                parts = content.split('**')
                for b_idx, part in enumerate(parts):
                    run = p.add_run(part.replace('`', ''))
                    run.font.name = "Arial"
                    run.font.size = Pt(9.5)
                    run.font.color.rgb = COLOR_DARK
                    if b_idx % 2 == 1:
                        run.font.bold = True
        elif stripped.startswith('<table') or stripped.startswith('<tr>') or stripped.startswith('<td>') or stripped.startswith('</table>'):
            # HTML table signature block
            pass
        elif stripped and not stripped.startswith('---'):
            p = doc.add_paragraph()
            p.paragraph_format.space_before = Pt(2)
            p.paragraph_format.space_after = Pt(4)
            parts = stripped.split('**')
            for b_idx, part in enumerate(parts):
                run = p.add_run(part.replace('`', ''))
                run.font.name = "Arial"
                run.font.size = Pt(9.5)
                run.font.color.rgb = COLOR_DARK
                if b_idx % 2 == 1:
                    run.font.bold = True

        i += 1

def add_signature_block(doc):
    """Adds a standard formal BPS dual-signature and approval section."""
    p_sp = doc.add_paragraph()
    p_sp.paragraph_format.space_before = Pt(16)
    p_sp.paragraph_format.space_after = Pt(4)

    # 2-column signature table
    tbl = doc.add_table(rows=1, cols=2)
    tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
    tbl.columns[0].width = Inches(3.2)
    tbl.columns[1].width = Inches(3.2)

    # Left cell: Mentor
    c_left = tbl.cell(0, 0)
    set_cell_margins(c_left, top=60, bottom=60, left=60, right=60)
    p_m = c_left.paragraphs[0]
    p_m.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p_m.paragraph_format.space_after = Pt(2)
    r = p_m.add_run("Menyetujui,\n")
    r.font.name = "Arial"; r.font.size = Pt(9.5); r.font.color.rgb = COLOR_DARK
    r = p_m.add_run("Mentor / Pembimbing Aktualisasi\nPranata Komputer Ahli Pertama\nBPS Kabupaten Penajam Paser Utara\n\n\n\n\n")
    r.font.name = "Arial"; r.font.size = Pt(9.0); r.font.color.rgb = COLOR_MUTED
    r = p_m.add_run("BAIHAQI ILHAM SYAH, S.Tr.Stat.\n")
    r.font.name = "Arial"; r.font.size = Pt(9.5); r.font.bold = True; r.font.underline = True; r.font.color.rgb = COLOR_NAVY
    r = p_m.add_run("NIP. 19990527 202202 1 001")
    r.font.name = "Arial"; r.font.size = Pt(9.0); r.font.color.rgb = COLOR_MUTED

    # Right cell: Penyusun
    c_right = tbl.cell(0, 1)
    set_cell_margins(c_right, top=60, bottom=60, left=60, right=60)
    p_p = c_right.paragraphs[0]
    p_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p_p.paragraph_format.space_after = Pt(2)
    r = p_p.add_run("Penajam Paser Utara, 25 Agustus 2026\n")
    r.font.name = "Arial"; r.font.size = Pt(9.5); r.font.color.rgb = COLOR_DARK
    r = p_p.add_run("Penyusun / Perekayasa Sistem\nPranata Komputer Ahli Pertama\nBPS Kabupaten Penajam Paser Utara\n\n\n\n\n")
    r.font.name = "Arial"; r.font.size = Pt(9.0); r.font.color.rgb = COLOR_MUTED
    r = p_p.add_run("YAHYA ABDURROHMAN\n")
    r.font.name = "Arial"; r.font.size = Pt(9.5); r.font.bold = True; r.font.underline = True; r.font.color.rgb = COLOR_NAVY
    r = p_p.add_run("NIP. 20020703 202505 1 001")
    r.font.name = "Arial"; r.font.size = Pt(9.0); r.font.color.rgb = COLOR_MUTED

    # Bottom cell: Kepala BPS
    p_sp2 = doc.add_paragraph()
    p_sp2.paragraph_format.space_before = Pt(12)
    p_sp2.paragraph_format.space_after = Pt(4)

    tbl_head = doc.add_table(rows=1, cols=1)
    tbl_head.alignment = WD_TABLE_ALIGNMENT.CENTER
    tbl_head.columns[0].width = Inches(6.4)
    c_head = tbl_head.cell(0, 0)
    set_cell_margins(c_head, top=60, bottom=60, left=60, right=60)
    p_k = c_head.paragraphs[0]
    p_k.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p_k.add_run("Mengesahkan,\n")
    r.font.name = "Arial"; r.font.size = Pt(9.5); r.font.color.rgb = COLOR_DARK
    r = p_k.add_run("Kepala BPS Kabupaten Penajam Paser Utara\n\n\n\n\n")
    r.font.name = "Arial"; r.font.size = Pt(9.0); r.font.color.rgb = COLOR_MUTED
    r = p_k.add_run("Ir. URIP WIJAYA, M.Si.\n")
    r.font.name = "Arial"; r.font.size = Pt(9.5); r.font.bold = True; r.font.underline = True; r.font.color.rgb = COLOR_NAVY
    r = p_k.add_run("NIP. 19680514 199403 1 003")
    r.font.name = "Arial"; r.font.size = Pt(9.0); r.font.color.rgb = COLOR_MUTED

def generate_all_docx():
    print("Memulai pembuatan seluruh dokumen DOCX Phase 4...")

    base_dir = os.path.join("laporan", "OUTPUT_TAHAPAN_KEGIATAN", "Kegiatan_4_System_Testing_and_Verification")
    
    docs_to_build = [
        {
            "md_path": os.path.join(base_dir, "Tahapan_4.1_Pengujian_Internal_BlackBox_dan_Sinkronisasi", "Catatan_Hasil_Uji_Coba_Performa_BlackBox_dan_Sinkronisasi.md"),
            "docx_path": os.path.join(base_dir, "Tahapan_4.1_Pengujian_Internal_BlackBox_dan_Sinkronisasi", "Catatan_Hasil_Uji_Coba_Performa_BlackBox_dan_Sinkronisasi.docx"),
            "title": "CATATAN HASIL UJI COBA PERFORMA & SINKRONISASI",
            "subtitle": "Pengujian Internal Sistem (Black-Box Testing & Data Synchronization Pipeline)",
            "subsubtitle": "Tahapan 4.1 — Aktualisasi Latsar CPNS BPS Kabupaten Penajam Paser Utara"
        },
        {
            "md_path": os.path.join(base_dir, "Tahapan_4.2_Pengujian_Performa_LoadSpeed_dan_Lighthouse", "Laporan_Hasil_Pengujian_Performa_Dasbor_LoadSpeed_dan_Lighthouse.md"),
            "docx_path": os.path.join(base_dir, "Tahapan_4.2_Pengujian_Performa_LoadSpeed_dan_Lighthouse", "Laporan_Hasil_Pengujian_Performa_Dasbor_LoadSpeed_dan_Lighthouse.docx"),
            "title": "LAPORAN PENGUJIAN PERFORMA DASBOR & LIGHTHOUSE AUDIT",
            "subtitle": "Load Speed, Concurrency Stress Testing & Core Web Vitals",
            "subsubtitle": "Tahapan 4.2 — Aktualisasi Latsar CPNS BPS Kabupaten Penajam Paser Utara"
        },
        {
            "md_path": os.path.join(base_dir, "Tahapan_4.3_Uji_Coba_Terbatas_UAT_dan_Bug_Fixing", "Berita_Acara_UAT_dan_Catatan_Perbaikan_Bug.md"),
            "docx_path": os.path.join(base_dir, "Tahapan_4.3_Uji_Coba_Terbatas_UAT_dan_Bug_Fixing", "Berita_Acara_UAT_dan_Catatan_Perbaikan_Bug.docx"),
            "title": "BERITA ACARA UAT & CATATAN PERBAIKAN BUG",
            "subtitle": "Pelaksanaan Uji Coba Terbatas (User Acceptance Testing) & Bug Fixing Log",
            "subsubtitle": "Tahapan 4.3 — Aktualisasi Latsar CPNS BPS Kabupaten Penajam Paser Utara"
        },
        {
            "md_path": os.path.join(base_dir, "Tahapan_4.4_Berita_Acara_Pengujian_dan_Lembar_Persetujuan", "Laporan_Akhir_Hasil_Pengujian_dan_Lembar_Persetujuan_Kelayakan.md"),
            "docx_path": os.path.join(base_dir, "Tahapan_4.4_Berita_Acara_Pengujian_dan_Lembar_Persetujuan", "Laporan_Akhir_Hasil_Pengujian_dan_Lembar_Persetujuan_Kelayakan.docx"),
            "title": "LAPORAN AKHIR PENGUJIAN & PERSETUJUAN KELAYAKAN SISTEM",
            "subtitle": "Berita Acara Validasi Kelayakan & Lembar Pengesahan Operasional",
            "subsubtitle": "Tahapan 4.4 — Aktualisasi Latsar CPNS BPS Kabupaten Penajam Paser Utara"
        },
        {
            "md_path": os.path.join(base_dir, "Master_Laporan_Phase_4", "Laporan_Pengujian_dan_Verifikasi_Sistem_SE2026_PPU_Phase4.md"),
            "docx_path": os.path.join(base_dir, "Master_Laporan_Phase_4", "Laporan_Pengujian_dan_Verifikasi_Sistem_SE2026_PPU_Phase4.docx"),
            "title": "LAPORAN FASE 4: PENGUJIAN DAN VERIFIKASI SISTEM",
            "subtitle": "Dashboard Monitoring Sensus Ekonomi 2026 'Pananyo Taka'",
            "subsubtitle": "SDLC Phase 4: System Testing & Verification (Pressman & Maxim, 2015)"
        }
    ]

    for item in docs_to_build:
        print(f"--> Memproses: {item['docx_path']}")
        doc = create_document()
        add_header_banner(doc, item['title'], item['subtitle'], item['subsubtitle'])
        
        with open(item['md_path'], 'r', encoding='utf-8') as f:
            content = f.read()
        
        parse_markdown_to_docx(doc, content)
        add_signature_block(doc)
        
        doc.save(item['docx_path'])
        print(f"    [OK] Berhasil dibuat: {item['docx_path']}")

    # Copy Master Laporan Phase 4 to root directory
    root_master = "Laporan_Pengujian_dan_Verifikasi_Sistem_SE2026_PPU_Phase4.docx"
    source_master = os.path.join(base_dir, "Master_Laporan_Phase_4", "Laporan_Pengujian_dan_Verifikasi_Sistem_SE2026_PPU_Phase4.docx")
    shutil.copyfile(source_master, root_master)
    print(f"[OK] Master DOCX berhasil disalin ke root: {root_master}")
    print("\nSeluruh 5 dokumen DOCX Phase 4 berhasil dibuat dengan sukses!")

if __name__ == "__main__":
    generate_all_docx()
