import os
import subprocess
import time

# Create a local HTML page that renders all 7 Mermaid diagrams with Mermaid.js
with open('laporan/02_Phase_2_System_Design/SEMUA_DIAGRAM_MERMAID_PANANYO_TAKA.md', 'r', encoding='utf-8') as f:
    md_content = f.read()

parts = md_content.split('```mermaid')
diagrams = []
for i in range(1, len(parts)):
    code = parts[i].split('```')[0].strip()
    diagrams.append(code)

html_template = """<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Preview & Export Diagram Antigravity — Pananyo Taka</title>
    <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
    <style>
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }
        body {
            background-color: #0B132B;
            color: #F8FAFC;
            font-family: 'Inter', system-ui, -apple-system, sans-serif;
            padding: 40px 20px;
            display: flex;
            flex-direction: column;
            align-items: center;
        }
        .header {
            text-align: center;
            max-width: 1000px;
            margin-bottom: 40px;
            background: linear-gradient(135deg, #1E293B 0%, #111C38 100%);
            padding: 30px;
            border-radius: 16px;
            border: 2px solid #0284C7;
            box-shadow: 0 10px 30px rgba(2, 132, 199, 0.2);
            width: 100%;
        }
        h1 {
            font-size: 24px;
            font-weight: 800;
            color: #38BDF8;
            margin-bottom: 8px;
            letter-spacing: -0.5px;
        }
        .subtitle {
            font-size: 14px;
            color: #94A3B8;
            margin-bottom: 20px;
        }
        .btn-group {
            display: flex;
            justify-content: center;
            gap: 12px;
            flex-wrap: wrap;
        }
        .btn {
            background-color: #0284C7;
            color: #FFFFFF;
            border: none;
            padding: 10px 20px;
            font-size: 13px;
            font-weight: 600;
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.2s ease;
            display: inline-flex;
            align-items: center;
            gap: 8px;
        }
        .btn:hover {
            background-color: #0369A1;
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(2, 132, 199, 0.4);
        }
        .btn-success {
            background-color: #10B981;
        }
        .btn-success:hover {
            background-color: #059669;
            box-shadow: 0 4px 12px rgba(16, 185, 129, 0.4);
        }
        .diagram-card {
            background: #111C38;
            border: 1.5px solid #1E293B;
            border-radius: 14px;
            padding: 30px;
            margin-bottom: 40px;
            width: 100%;
            max-width: 1400px;
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
            display: flex;
            flex-direction: column;
            align-items: center;
        }
        .diagram-header {
            width: 100%;
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 24px;
            padding-bottom: 16px;
            border-bottom: 1px solid #1E293B;
        }
        .diagram-title {
            font-size: 18px;
            font-weight: 700;
            color: #38BDF8;
        }
        .diagram-container {
            width: 100%;
            display: flex;
            justify-content: center;
            overflow-x: auto;
            padding: 20px 0;
            background: #0B132B;
            border-radius: 10px;
            border: 1px solid #1E293B;
        }
        .mermaid {
            width: 100%;
            display: flex;
            justify-content: center;
        }
        .mermaid svg {
            max-width: 100%;
            height: auto;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>📊 EKSPOR DIAGRAM RESMI — PREVIEW GOOGLE ANTIGRAVITY</h1>
        <p class="subtitle">Sistem Dasbor Pemantauan Sensus dan Multi-Survei (Pananyo Taka) • BPS Kabupaten Penajam Paser Utara</p>
        <div class="btn-group">
            <button class="btn btn-success" onclick="exportAllPNG()">📥 Download Semua Diagram (PNG HD)</button>
            <button class="btn" onclick="exportAllSVG()">🎨 Download Semua Diagram (SVG Vektor)</button>
        </div>
    </div>

    <!-- DIAGRAMS PLACEHOLDER -->
    __DIAGRAMS_HTML__

    <script>
        mermaid.initialize({
            startOnLoad: true,
            theme: 'dark',
            securityLevel: 'loose',
            fontFamily: 'Inter, system-ui, sans-serif',
            themeVariables: {
                darkMode: true,
                background: '#0B132B',
                primaryColor: '#1E293B',
                primaryTextColor: '#F8FAFC',
                primaryBorderColor: '#0284C7',
                lineColor: '#38BDF8',
                secondaryColor: '#8B5CF6',
                secondaryTextColor: '#FFFFFF',
                secondaryBorderColor: '#7C3AED',
                tertiaryColor: '#111C38',
                tertiaryTextColor: '#CBD5E1',
                tertiaryBorderColor: '#334155',
                clusterBkg: '#111C38',
                clusterBorder: '#0284C7',
                titleColor: '#38BDF8',
                edgeLabelBackground: '#1E293B',
                actorBkg: '#1E293B',
                actorBorder: '#38BDF8',
                actorTextColor: '#FFFFFF',
                actorLineColor: '#38BDF8',
                signalColor: '#38BDF8',
                signalTextColor: '#F8FAFC',
                labelBoxBkgColor: '#1E293B',
                labelBoxBorderColor: '#0284C7',
                labelTextColor: '#F8FAFC',
                loopTextColor: '#F59E0B',
                activationBorderColor: '#0284C7',
                activationBkgColor: '#1E293B',
                entityBkg: '#1E293B',
                entityBorder: '#334155',
                attributeBackgroundColorOdd: '#1E293B',
                attributeBackgroundColorEven: '#111C38'
            }
        });

        function downloadSVG(diagId, filename) {
            const container = document.getElementById(diagId);
            const svg = container.querySelector('svg');
            if (!svg) return alert('SVG belum siap!');
            const serializer = new XMLSerializer();
            let source = serializer.serializeToString(svg);
            source = '<?xml version="1.0" standalone="no"?>\\r\\n' + source;
            const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(source);
            const a = document.createElement("a");
            a.download = filename + ".svg";
            a.href = url;
            a.click();
        }

        function downloadPNG(diagId, filename) {
            const container = document.getElementById(diagId);
            const svg = container.querySelector('svg');
            if (!svg) return alert('SVG belum siap!');

            const svgRect = svg.getBoundingClientRect();
            const width = (svgRect.width || 1200) * 2.5; // Scale 2.5x HD
            const height = (svgRect.height || 800) * 2.5;

            const serializer = new XMLSerializer();
            const svgString = serializer.serializeToString(svg);
            const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
            const URL = window.URL || window.webkitURL || window;
            const blobURL = URL.createObjectURL(svgBlob);

            const image = new Image();
            image.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const context = canvas.getContext('2d');
                context.fillStyle = '#0B132B';
                context.fillRect(0, 0, width, height);
                context.drawImage(image, 0, 0, width, height);

                const pngURL = canvas.toDataURL('image/png');
                const downloadLink = document.createElement('a');
                downloadLink.href = pngURL;
                downloadLink.download = filename + ".png";
                document.body.appendChild(downloadLink);
                downloadLink.click();
                document.body.removeChild(downloadLink);
            };
            image.src = blobURL;
        }

        async function exportAllPNG() {
            const names = [
                "01_system_context_diagram_antigravity",
                "02_use_case_diagram_antigravity",
                "03_dfd_level_1_diagram_antigravity",
                "04_entity_relationship_diagram_antigravity",
                "05_system_architecture_diagram_antigravity",
                "06_activity_diagram_monitoring_antigravity",
                "07_sequence_diagram_rag_ai_antigravity"
            ];
            for (let i = 1; i <= 7; i++) {
                downloadPNG('diag-' + i, names[i-1]);
                await new Promise(r => setTimeout(r, 600));
            }
        }

        async function exportAllSVG() {
            const names = [
                "01_system_context_diagram_antigravity",
                "02_use_case_diagram_antigravity",
                "03_dfd_level_1_diagram_antigravity",
                "04_entity_relationship_diagram_antigravity",
                "05_system_architecture_diagram_antigravity",
                "06_activity_diagram_monitoring_antigravity",
                "07_sequence_diagram_rag_ai_antigravity"
            ];
            for (let i = 1; i <= 7; i++) {
                downloadSVG('diag-' + i, names[i-1]);
                await new Promise(r => setTimeout(r, 400));
            }
        }
    </script>
</body>
</html>
"""

diagram_titles = [
    "Gambar 7.1: System Context Diagram (Data Flow Diagram Level 0)",
    "Gambar 7.2: Use Case Diagram Sistem Pemantauan",
    "Gambar 7.3: Data Flow Diagram (DFD) Level 1",
    "Gambar 7.4: Entity Relationship Diagram (ERD Relasional 19 Tabel)",
    "Gambar 7.5: 3-Tier Layered System Architecture Diagram",
    "Gambar 7.6: Activity Diagram Alur Pengumpulan, Verifikasi FASIH & Pananyo Taka",
    "Gambar 7.7: Sequence Diagram Retrieval-Augmented Generation (AI RAG Pipeline)"
]

file_slugs = [
    "01_system_context_diagram_antigravity",
    "02_use_case_diagram_antigravity",
    "03_dfd_level_1_diagram_antigravity",
    "04_entity_relationship_diagram_antigravity",
    "05_system_architecture_diagram_antigravity",
    "06_activity_diagram_monitoring_antigravity",
    "07_sequence_diagram_rag_ai_antigravity"
]

cards_html = ""
for idx, code in enumerate(diagrams, 1):
    title = diagram_titles[idx - 1] if idx <= len(diagram_titles) else f"Diagram {idx}"
    slug = file_slugs[idx - 1] if idx <= len(file_slugs) else f"diagram_{idx}"
    cards_html += f"""
    <div class="diagram-card">
        <div class="diagram-header">
            <div class="diagram-title">{title}</div>
            <div class="btn-group">
                <button class="btn btn-success" onclick="downloadPNG('diag-{idx}', '{slug}')">📥 Download PNG HD</button>
                <button class="btn" onclick="downloadSVG('diag-{idx}', '{slug}')">🎨 Download SVG</button>
            </div>
        </div>
        <div class="diagram-container" id="diag-{idx}">
            <div class="mermaid">
{code}
            </div>
        </div>
    </div>
    """

full_html = html_template.replace("__DIAGRAMS_HTML__", cards_html)

output_html_path = 'laporan/02_Phase_2_System_Design/EXPORT_DIAGRAM_ANTIGRAVITY_PREVIEW.html'
with open(output_html_path, 'w', encoding='utf-8') as f:
    f.write(full_html)

print(f"Generated standalone export dashboard at: {output_html_path}")
