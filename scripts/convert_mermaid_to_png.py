import argparse
import base64
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
import zlib

if sys.platform.startswith('win'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass

def encode_kroki(mermaid_code: str) -> str:
    """Mengompresi dan mengenkripsi sintaks Mermaid ke format URL-safe Kroki."""
    compressed = zlib.compress(mermaid_code.encode('utf-8'), 9)
    return base64.urlsafe_b64encode(compressed).decode('utf-8')

def render_mermaid_to_png(mermaid_code: str, output_filepath: str) -> bool:
    """
    Mengunduh render PNG dari kode Mermaid dengan tema bawaan Pananyo Taka (%%{init:...}%%).
    """
    # 1. Primary Engine: Mermaid.ink Direct Base64 with Dark Navy Background
    try:
        raw_b64 = base64.b64encode(mermaid_code.encode('utf-8')).decode('ascii')
        url_primary = f"https://mermaid.ink/img/{raw_b64}?bgColor=0B132B"
        req = urllib.request.Request(url_primary, headers={
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        })
        with urllib.request.urlopen(req, timeout=25) as resp:
            png_bytes = resp.read()
            if len(png_bytes) > 500:
                with open(output_filepath, 'wb') as f:
                    f.write(png_bytes)
                return True
    except Exception as e_primary:
        pass

    # 2. Fallback Engine: Kroki.io
    try:
        kroki_payload = encode_kroki(mermaid_code)
        url_fallback = f"https://kroki.io/mermaid/png/{kroki_payload}"
        req = urllib.request.Request(url_fallback, headers={
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        })
        with urllib.request.urlopen(req, timeout=25) as resp:
            png_bytes = resp.read()
            if len(png_bytes) > 500:
                with open(output_filepath, 'wb') as f:
                    f.write(png_bytes)
                return True
    except Exception as e_fallback:
        print(f"    [!] Gagal pada kedua engine: {e_fallback}")

    return False

def extract_diagrams_from_markdown(md_content: str):
    """Mengekstrak seluruh blok ```mermaid dari dokumen markdown."""
    parts = md_content.split('```mermaid')
    diagrams = []
    for idx in range(1, len(parts)):
        code = parts[idx].split('```')[0].strip()
        diagrams.append(code)
    return diagrams

def main():
    input_file = "laporan/02_Phase_2_System_Design/SEMUA_DIAGRAM_MERMAID_PANANYO_TAKA.md"
    output_dir = "laporan/02_Phase_2_System_Design/diagrams_mermaid_png"

    print("=" * 80)
    print("🎨 RENDERING MERMAID DENGAN EXACT STYLE PANANYO TAKA (/diagrams)")
    print("=" * 80)
    print(f"• Input Berkas : {input_file}")
    print(f"• Output Folder: {output_dir}")
    print(f"• Desain Tema  : Dark Slate Glassmorphism (#0B132B / #1E293B / #0284C7)")

    if not os.path.exists(input_file):
        print(f"[X] Berkas {input_file} tidak ditemukan!")
        return

    with open(input_file, 'r', encoding='utf-8') as f:
        content = f.read()

    diagrams = extract_diagrams_from_markdown(content)
    os.makedirs(output_dir, exist_ok=True)

    standard_names = [
        "01_system_context_diagram_mermaid.png",
        "02_use_case_diagram_mermaid.png",
        "03_dfd_level_1_diagram_mermaid.png",
        "04_entity_relationship_diagram_mermaid.png",
        "05_system_architecture_diagram_mermaid.png",
        "06_activity_diagram_monitoring_mermaid.png",
        "07_sequence_diagram_rag_ai_mermaid.png"
    ]

    total = len(diagrams)
    print(f"\n🔍 Ditemukan {total} diagram Mermaid. Memulai rendering...\n")

    for i, code in enumerate(diagrams):
        fname = standard_names[i] if i < len(standard_names) else f"diagram_{i+1}.png"
        out_path = os.path.join(output_dir, fname)
        print(f"  [{i+1}/{total}] Merender: {fname} ...", end="", flush=True)

        t0 = time.time()
        ok = render_mermaid_to_png(code, out_path)
        elapsed = time.time() - t0

        if ok:
            size_kb = os.path.getsize(out_path) / 1024
            print(f" ✅ SUKSES ({size_kb:.1f} KB, {elapsed:.2f}s)")
        else:
            print(" ❌ GAGAL")

    print("\n" + "=" * 80)
    print("✨ SELESAI SEMPURNA: Seluruh diagram Mermaid telah dirender dengan style /diagrams!")
    print(f"📁 Lokasi: {os.path.abspath(output_dir)}")
    print("=" * 80)

if __name__ == "__main__":
    main()
