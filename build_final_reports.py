import os

r1_path = r'D:\SE2026\monitoring-se2026-ppu\laporan\02_Phase_2_System_Design\LAPORAN_AKHIR_FASE_2_PERANCANGAN_SISTEM.md'
r2_path = r'D:\SE2026\monitoring-se2026-ppu\laporan\03_Laporan_Mingguan_Latsar\M2_LAPORAN_MINGGUAN_LATSAR_AKTUALISASI_FINAL.md'

os.makedirs(os.path.dirname(r1_path), exist_ok=True)
os.makedirs(os.path.dirname(r2_path), exist_ok=True)

print('Directories ready')
