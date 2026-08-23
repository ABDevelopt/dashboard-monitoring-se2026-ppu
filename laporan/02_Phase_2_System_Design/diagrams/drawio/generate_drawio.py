import os

def create_table(id_prefix, x, y, name, rows):
    xml = []
    width = 300
    if len(rows) > 10:
        width = 350
    
    xml.append(f'''<mxCell id="{id_prefix}" value="" style="shape=table;startSize=30;container=1;collapsible=0;childLayout=tableLayout;fixedRows=1;rowLines=0;fontStyle=1;align=center;" vertex="1" parent="1">
          <mxGeometry x="{x}" y="{y}" width="{width}" height="{30 + len(rows)*30}" as="geometry" />
        </mxCell>
        <mxCell id="{id_prefix}_header" value="{name}" style="shape=tableRow;horizontal=0;startSize=0;swimlaneHead=0;swimlaneBody=0;fillColor=#0284C7;strokeColor=#38BDF8;align=center;fontStyle=1;fontColor=#FFFFFF;fontSize=10;" vertex="1" parent="{id_prefix}">
          <mxGeometry width="{width}" height="30" as="geometry" />
        </mxCell>
        <mxCell id="{id_prefix}_header_col" value="" style="shape=partialRectangle;html=1;whiteSpace=wrap;connectable=0;fillColor=none;top=0;left=0;bottom=0;right=0;overflow=hidden;pointerEvents=1;" vertex="1" parent="{id_prefix}_header">
          <mxGeometry width="{width}" height="30" as="geometry">
            <mxRectangle width="{width}" height="30" as="alternateBounds" />
          </mxGeometry>
        </mxCell>''')

    for i, row in enumerate(rows):
        row_id = f"{id_prefix}_r{i}"
        xml.append(f'''<mxCell id="{row_id}" value="" style="shape=tableRow;horizontal=0;startSize=0;swimlaneHead=0;swimlaneBody=0;fillColor=#1E293B;strokeColor=#38BDF8;align=left;fontColor=#F8FAFC;fontSize=9;" vertex="1" parent="{id_prefix}">
          <mxGeometry y="{30 + i*30}" width="{width}" height="30" as="geometry" />
        </mxCell>
        <mxCell id="{row_id}_col" value="{row}" style="shape=partialRectangle;html=1;whiteSpace=wrap;connectable=0;fillColor=none;top=0;left=0;bottom=0;right=0;overflow=hidden;" vertex="1" parent="{row_id}">
          <mxGeometry width="{width}" height="30" as="geometry">
            <mxRectangle width="{width}" height="30" as="alternateBounds" />
          </mxGeometry>
        </mxCell>''')
    
    return '\n'.join(xml)

def create_edge(id, src, dst, label=""):
    return f'''<mxCell id="{id}" value="{label}" style="edgeStyle=orthogonalEdgeStyle;strokeColor=#38BDF8;fontColor=#38BDF8;fontSize=8;endArrow=ERmany;" edge="1" parent="1" source="{src}" target="{dst}">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>'''

erd = '''<mxfile version="22.1.2" type="device">
  <diagram id="erd" name="ERD">
    <mxGraphModel dx="3200" dy="2400" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="3200" pageHeight="2400" background="#0B132B" math="0" shadow="0">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
        
        <mxCell id="z1" value="ZONA 1 — Master Wilayah" style="fillColor=none;dashed=1;strokeColor=#0284C7;verticalAlign=top;fontColor=#0284C7;fontSize=14;fontStyle=1" vertex="1" parent="1">
          <mxGeometry x="40" y="40" width="1200" height="900" as="geometry" />
        </mxCell>
        <mxCell id="z2" value="ZONA 2 — Transaksi Progres" style="fillColor=none;dashed=1;strokeColor=#F59E0B;verticalAlign=top;fontColor=#F59E0B;fontSize=14;fontStyle=1" vertex="1" parent="1">
          <mxGeometry x="1280" y="40" width="900" height="900" as="geometry" />
        </mxCell>
        <mxCell id="z3" value="ZONA 3 — Multi-Survei Dinamis" style="fillColor=none;dashed=1;strokeColor=#8B5CF6;verticalAlign=top;fontColor=#8B5CF6;fontSize=14;fontStyle=1" vertex="1" parent="1">
          <mxGeometry x="40" y="980" width="1100" height="700" as="geometry" />
        </mxCell>
        <mxCell id="z4" value="ZONA 4 — Auth, Sesi &amp;amp; Logging" style="fillColor=none;dashed=1;strokeColor=#EF4444;verticalAlign=top;fontColor=#EF4444;fontSize=14;fontStyle=1" vertex="1" parent="1">
          <mxGeometry x="1280" y="980" width="1880" height="700" as="geometry" />
        </mxCell>
'''

erd += create_table('ref_kecamatan', 60, 100, 'ref_kecamatan', ['kode_kec PK TEXT', 'nama_kecamatan TEXT']) + '\n'
erd += create_table('ref_desa', 60, 300, 'ref_desa', ['kode_desa PK TEXT', 'kode_kec FK TEXT', 'nama_desa TEXT']) + '\n'
erd += create_table('ref_petugas', 60, 540, 'ref_petugas', ['id PK INT', 'sobat_id UK TEXT', 'nama_lengkap TEXT', 'email UK TEXT', 'jenis_kelamin TEXT', 'kode_kab INT', 'created_at DATETIME']) + '\n'
erd += create_table('subsls_master', 520, 100, 'subsls_master', ['kode PK TEXT 16-digit', 'kode_kec FK TEXT', 'kecamatan TEXT', 'desa TEXT', 'nama_sls TEXT', 'korlap TEXT', 'pml TEXT', 'pcl TEXT', 'muatan INT', 'target_fasih INT', 'target_honor INT', 'korlap_id FK INT', 'pml_id FK INT', 'pcl_id FK INT', 'pcl_email TEXT', 'pml_email TEXT', 'korlap_email TEXT']) + '\n'

erd += create_table('uploads', 1300, 100, 'uploads', ['id PK INT', 'filename TEXT', 'stored_filename TEXT', 'tanggal DATE', 'total_subsls_terisi INT', 'status_filename TEXT', 'stored_status_filename TEXT', 'survey_id TEXT', 'created_at DATETIME']) + '\n'
erd += create_table('progres', 1300, 520, 'progres', ['id PK INT', 'upload_id FK→uploads', 'kode FK→subsls_master', 'draft INT', 'submitted_by_pcl INT', 'approved INT', 'rejected INT', 'open INT', 'target_upload INT', 'usaha_ditemukan INT', 'usaha_baru INT', 'ditemukan INT', 'keluarga_baru INT', 'pcl_email TEXT', 'pcl_name TEXT', 'pcl_sobat_id TEXT']) + '\n'
erd += create_table('summary_cache', 1680, 100, 'summary_cache', ['upload_id PK FK→uploads', 'desa PK TEXT', 'pcl PK TEXT', 'kecamatan TEXT', 'korlap TEXT', 'pml TEXT', 'total_sls INT', 'selesai INT', 'total_muatan INT', 'muatan_selesai INT', 'approved_total INT', 'rejected_total INT', 'submitted_total INT', 'draft_total INT', 'open_total INT', 'target_fasih_total INT', 'updated_at DATETIME']) + '\n'

erd += create_table('surveys_registry', 60, 1020, 'surveys_registry', ['id PK TEXT slug', 'slug TEXT', 'name TEXT', 'short_name TEXT', 'category TEXT', 'is_active INT', 'sort_order INT', 'created_at DATETIME', 'updated_at DATETIME']) + '\n'
erd += create_table('survey_themes', 60, 1360, 'survey_themes', ['survey_id PK FK TEXT', 'theme_name TEXT', 'theme_color TEXT', 'theme_secondary TEXT', 'theme_rgb TEXT', 'theme_gradient TEXT', 'theme_icon TEXT']) + '\n'
erd += create_table('survey_collection_config', 480, 1020, 'survey_collection_config', ['survey_id PK FK TEXT', 'unit_name TEXT', 'route_prefix TEXT', 'show_usaha_columns INT', 'enabled_pages TEXT']) + '\n'
erd += create_table('survey_subsls', 480, 1360, 'survey_subsls', ['id PK INT', 'survey_id FK TEXT', 'kode TEXT', 'kecamatan TEXT', 'desa TEXT', 'pcl TEXT', 'target_fasih INT']) + '\n'

erd += create_table('users', 1300, 1020, 'users', ['id PK INT', 'username UK TEXT', 'password TEXT SHA-256', 'role TEXT admin/user', 'created_at DATETIME']) + '\n'
erd += create_table('remember_tokens', 1300, 1360, 'remember_tokens', ['id PK INT', 'user_id FK→users INT', 'token TEXT', 'expires_at DATETIME', 'created_at DATETIME']) + '\n'
erd += create_table('visitor_logs', 1700, 1020, 'visitor_logs', ['id PK INT', 'username TEXT', 'role TEXT', 'ip TEXT', 'user_agent TEXT', 'path TEXT', 'created_at DATETIME']) + '\n'
erd += create_table('settings', 1700, 1360, 'settings', ['key PK TEXT', 'value TEXT']) + '\n'
erd += create_table('weather_history', 2100, 1020, 'weather_history', ['tanggal PK TEXT', 'temp REAL', 'code INT', 'humidity INT', 'updated_at DATETIME']) + '\n'
erd += create_table('schema_migrations', 2100, 1360, 'schema_migrations', ['id PK INT', 'version TEXT', 'applied_at DATETIME']) + '\n'

erd += create_edge('e1', 'ref_kecamatan', 'ref_desa') + '\n'
erd += create_edge('e2', 'ref_kecamatan', 'subsls_master') + '\n'
erd += create_edge('e3', 'ref_desa', 'subsls_master') + '\n'
erd += create_edge('e4', 'ref_petugas', 'subsls_master') + '\n'
erd += create_edge('e5', 'uploads', 'progres') + '\n'
erd += create_edge('e6', 'uploads', 'summary_cache') + '\n'
erd += create_edge('e7', 'subsls_master', 'progres') + '\n'
erd += create_edge('e8', 'users', 'remember_tokens') + '\n'
erd += create_edge('e9', 'surveys_registry', 'survey_themes') + '\n'
erd += create_edge('e10', 'surveys_registry', 'survey_collection_config') + '\n'
erd += create_edge('e11', 'surveys_registry', 'survey_subsls') + '\n'

erd += '''
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
'''

with open('D:/SE2026/monitoring-se2026-ppu/laporan/02_Phase_2_System_Design/diagrams/drawio/04_entity_relationship_diagram.drawio', 'w', encoding='utf-8') as f:
    f.write(erd)

arch = '''<mxfile version="22.1.2" type="device">
  <diagram id="arch" name="Architecture">
    <mxGraphModel dx="2200" dy="1600" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="2200" pageHeight="1600" background="#0B132B" math="0" shadow="0">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
        
        <mxCell id="tier1" value="TIER 1 — PRESENTATION &amp;amp; USER INTERFACE LAYER  (EJS SSR + Vanilla JS Client)" style="fillColor=#0E3A5C;strokeColor=#0284C7;fontColor=#38BDF8;fontSize=12;fontStyle=1;verticalAlign=top;" vertex="1" parent="1">
          <mxGeometry x="40" y="40" width="2120" height="440" as="geometry" />
        </mxCell>
        
        <mxCell id="b1" value="&#x1F4F1; Mobile Responsive Layout&amp;#xa;─────────────────&amp;#xa;• Bottom Nav Bar 64px Fixed&amp;#xa;• Smartphone Vertical Stack&amp;#xa;• Tap Targets ≥ 44×44px&amp;#xa;• Progressive Enhancement" style="fillColor=#1E293B;strokeColor=#0284C7;fontColor=#F8FAFC;fontSize=10;rounded=0;align=left;spacingLeft=10" vertex="1" parent="1">
          <mxGeometry x="80" y="80" width="460" height="320" as="geometry" />
        </mxCell>
        <mxCell id="b2" value="&#x1F4CA; Analytics &amp;amp; Visualizer&amp;#xa;─────────────────&amp;#xa;• Speedometer Milestone KPI&amp;#xa;• Chart.js Dual-Line Tren Harian&amp;#xa;• Leaderboard &amp;amp; Heatmap&amp;#xa;• Burn-down Date Proyeksi" style="fillColor=#1E293B;strokeColor=#0284C7;fontColor=#F8FAFC;fontSize=10;rounded=0;align=left;spacingLeft=10" vertex="1" parent="1">
          <mxGeometry x="580" y="80" width="460" height="320" as="geometry" />
        </mxCell>
        <mxCell id="b3" value="&#x1F5FA;️ Interactive GIS Leaflet&amp;#xa;─────────────────&amp;#xa;• KML 54 Desa/Kel. Polygons&amp;#xa;• Choropleth Thematic Layer&amp;#xa;• Dynamic SLS Popup Detail&amp;#xa;• Koordinat GPS Petugas" style="fillColor=#1E293B;strokeColor=#0284C7;fontColor=#F8FAFC;fontSize=10;rounded=0;align=left;spacingLeft=10" vertex="1" parent="1">
          <mxGeometry x="1080" y="80" width="460" height="320" as="geometry" />
        </mxCell>
        <mxCell id="b4" value="&#x1F3A8; UI Theme &amp;amp; AI Modal&amp;#xa;─────────────────&amp;#xa;• Dark Slate CSS Token System&amp;#xa;• Multi-Survey Theme Dynamic&amp;#xa;• KIPP Chatbot Sandbox&amp;#xa;• Status Bracket [ON-TRACK]" style="fillColor=#1E293B;strokeColor=#0284C7;fontColor=#F8FAFC;fontSize=10;rounded=0;align=left;spacingLeft=10" vertex="1" parent="1">
          <mxGeometry x="1580" y="80" width="460" height="320" as="geometry" />
        </mxCell>

        <mxCell id="tier2" value="TIER 2 — APPLICATION &amp;amp; BUSINESS LOGIC LAYER  (Node.js Runtime + Express.js 5.x)" style="fillColor=#1E0B3F;strokeColor=#8B5CF6;fontColor=#C4B5FD;fontSize=12;fontStyle=1;verticalAlign=top;" vertex="1" parent="1">
          <mxGeometry x="40" y="520" width="2120" height="440" as="geometry" />
        </mxCell>
        
        <mxCell id="b5" value="⚙️ Routing &amp;amp; Security&amp;#xa;─────────────────&amp;#xa;• Express v5 REST &amp;amp; SSR Router&amp;#xa;• Session Auth &amp;amp; CSRF 32-byte&amp;#xa;• RBAC: Admin vs Pegawai&amp;#xa;• Helmet.js Security Headers" style="fillColor=#1E293B;strokeColor=#8B5CF6;fontColor=#F8FAFC;fontSize=10;rounded=0;align=left;spacingLeft=10" vertex="1" parent="1">
          <mxGeometry x="80" y="560" width="460" height="320" as="geometry" />
        </mxCell>
        <mxCell id="b6" value="&#x1F4E5; ETL Excel Pipeline&amp;#xa;─────────────────&amp;#xa;• Multi-Version FASIH Parser&amp;#xa;• 5 Status Mapper Engine&amp;#xa;• Transactional Batch Ingest&amp;#xa;• Sub-SLS 16-digit Validator" style="fillColor=#1E293B;strokeColor=#8B5CF6;fontColor=#F8FAFC;fontSize=10;rounded=0;align=left;spacingLeft=10" vertex="1" parent="1">
          <mxGeometry x="580" y="560" width="460" height="320" as="geometry" />
        </mxCell>
        <mxCell id="b7" value="&#x1F9E0; AI RAG &amp;amp; SQL Sandbox&amp;#xa;─────────────────&amp;#xa;• System Prompt Injector&amp;#xa;• Read-Only SQL Tool Call&amp;#xa;• Google Gemini 2.5 Flash/Pro&amp;#xa;• cURL Fallback Engine" style="fillColor=#1E293B;strokeColor=#8B5CF6;fontColor=#F8FAFC;fontSize=10;rounded=0;align=left;spacingLeft=10" vertex="1" parent="1">
          <mxGeometry x="1080" y="560" width="460" height="320" as="geometry" />
        </mxCell>
        <mxCell id="b8" value="&#x1F310; Multi-Survey &amp;amp; EWS&amp;#xa;─────────────────&amp;#xa;• AsyncLocalStorage Isolation&amp;#xa;• Zero-Progress EWS Detector&amp;#xa;• WhatsApp Baileys Gateway&amp;#xa;• Google Sheets Anomaly Sync" style="fillColor=#1E293B;strokeColor=#8B5CF6;fontColor=#F8FAFC;fontSize=10;rounded=0;align=left;spacingLeft=10" vertex="1" parent="1">
          <mxGeometry x="1580" y="560" width="460" height="320" as="geometry" />
        </mxCell>

        <mxCell id="tier3" value="TIER 3 — DATA &amp;amp; PERSISTENCE LAYER  (SQLite WAL + External Cloud APIs)" style="fillColor=#0A2A1E;strokeColor=#10B981;fontColor=#6EE7B7;fontSize=12;fontStyle=1;verticalAlign=top;" vertex="1" parent="1">
          <mxGeometry x="40" y="1000" width="2120" height="440" as="geometry" />
        </mxCell>
        
        <mxCell id="b9" value="&#x1F5C4;️ In-Process SQLite Engine&amp;#xa;─────────────────────────&amp;#xa;• WAL Mode Non-Blocking Reads&amp;#xa;• Memory-Mapped I/O (&amp;lt;5ms)&amp;#xa;• 19 Relational 3NF Tables&amp;#xa;• summary_cache Pre-calculated&amp;#xa;• better-sqlite3 C++ Binding" style="fillColor=#1E293B;strokeColor=#10B981;fontColor=#F8FAFC;fontSize=10;rounded=0;align=left;spacingLeft=10" vertex="1" parent="1">
          <mxGeometry x="80" y="1040" width="620" height="320" as="geometry" />
        </mxCell>
        <mxCell id="b10" value="&#x1F4C1; Isolated Survey Databases&amp;#xa;─────────────────────────&amp;#xa;• data/se2026.db (Primer)&amp;#xa;• data/sakernas-pemutakhiran.db&amp;#xa;• data/sakernas-pendataan.db&amp;#xa;• data/sessions.db (Sesi)&amp;#xa;• Isolasi Fisik Per-Kegiatan" style="fillColor=#1E293B;strokeColor=#10B981;fontColor=#F8FAFC;fontSize=10;rounded=0;align=left;spacingLeft=10" vertex="1" parent="1">
          <mxGeometry x="760" y="1040" width="620" height="320" as="geometry" />
        </mxCell>
        <mxCell id="b11" value="☁️ External Cloud APIs&amp;#xa;─────────────────────────&amp;#xa;• Google Gemini LLM API&amp;#xa;• Open-Meteo Weather API PPU&amp;#xa;• Google Spreadsheets API Sync&amp;#xa;• WhatsApp Baileys WA Gateway&amp;#xa;• Sentry Error Tracking" style="fillColor=#1E293B;strokeColor=#10B981;fontColor=#F8FAFC;fontSize=10;rounded=0;align=left;spacingLeft=10" vertex="1" parent="1">
          <mxGeometry x="1440" y="1040" width="620" height="320" as="geometry" />
        </mxCell>

        <mxCell id="a1" value="HTTP/HTTPS Client Requests" style="edgeStyle=orthogonalEdgeStyle;strokeColor=#94A3B8;endArrow=block;endFill=1;fontSize=9;fontColor=#94A3B8;" edge="1" parent="1" source="b1" target="b5">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
        <mxCell id="a2" value="AJAX / Aggregates Fetch" style="edgeStyle=orthogonalEdgeStyle;strokeColor=#94A3B8;endArrow=block;endFill=1;fontSize=9;fontColor=#94A3B8;" edge="1" parent="1" source="b2" target="b6">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
        <mxCell id="a3" value="GeoJSON Data Fetch" style="edgeStyle=orthogonalEdgeStyle;strokeColor=#94A3B8;endArrow=block;endFill=1;fontSize=9;fontColor=#94A3B8;" edge="1" parent="1" source="b3" target="b8">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
        <mxCell id="a4" value="POST /api/agent/chat" style="edgeStyle=orthogonalEdgeStyle;strokeColor=#94A3B8;endArrow=block;endFill=1;fontSize=9;fontColor=#94A3B8;" edge="1" parent="1" source="b4" target="b7">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>

        <mxCell id="a5" value="Session &amp;amp; Auth Query" style="edgeStyle=orthogonalEdgeStyle;strokeColor=#94A3B8;endArrow=block;endFill=1;fontSize=9;fontColor=#94A3B8;" edge="1" parent="1" source="b5" target="b9">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
        <mxCell id="a6" value="In-Process C++ Binding (&amp;lt;5ms)" style="edgeStyle=orthogonalEdgeStyle;strokeColor=#94A3B8;endArrow=block;endFill=1;fontSize=9;fontColor=#94A3B8;" edge="1" parent="1" source="b6" target="b9">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
        <mxCell id="a7" value="Batch Ingest Transaksi" style="edgeStyle=orthogonalEdgeStyle;strokeColor=#94A3B8;endArrow=block;endFill=1;fontSize=9;fontColor=#94A3B8;" edge="1" parent="1" source="b6" target="b10">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
        <mxCell id="a8" value="Read-Only SQL Sandbox" style="edgeStyle=orthogonalEdgeStyle;strokeColor=#94A3B8;endArrow=block;endFill=1;fontSize=9;fontColor=#94A3B8;" edge="1" parent="1" source="b7" target="b10">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
        <mxCell id="a9" value="Prompt &amp;amp; Function Calling" style="edgeStyle=orthogonalEdgeStyle;strokeColor=#94A3B8;endArrow=block;endFill=1;fontSize=9;fontColor=#94A3B8;startArrow=block;startFill=1" edge="1" parent="1" source="b7" target="b11">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
        <mxCell id="a10" value="Fetch Weather &amp;amp; WA Send" style="edgeStyle=orthogonalEdgeStyle;strokeColor=#94A3B8;endArrow=block;endFill=1;fontSize=9;fontColor=#94A3B8;startArrow=block;startFill=1" edge="1" parent="1" source="b8" target="b11">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>

      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
'''

with open('D:/SE2026/monitoring-se2026-ppu/laporan/02_Phase_2_System_Design/diagrams/drawio/05_system_architecture_diagram.drawio', 'w', encoding='utf-8') as f:
    f.write(arch)
