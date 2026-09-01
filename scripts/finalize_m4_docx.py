"""
Rename M4_NEW.docx -> M4.docx setelah Microsoft Word ditutup.
Jalankan: python scripts/finalize_m4_docx.py
"""
import os
import sys
import shutil
import time

base = os.path.join('laporan', '03_Laporan_Mingguan_Latsar')
final = os.path.join(base, 'M4 - Laporan Mingguan Pelaksanaan Aktualisasi Pelatihan Dasar CPNS BPS Tahun 2026.docx')
tmp   = os.path.join(base, 'M4 - Laporan Mingguan Pelaksanaan Aktualisasi Pelatihan Dasar CPNS BPS Tahun 2026_NEW.docx')

if not os.path.exists(tmp):
    print('[ERR] File _NEW.docx tidak ditemukan. Jalankan generate_m4_weekly_report_docx.py terlebih dahulu.')
    sys.exit(1)

print('Mencoba mengganti file M4 lama dengan versi baru...')
for attempt in range(10):
    try:
        if os.path.exists(final):
            os.remove(final)
        shutil.move(tmp, final)
        print(f'[OK] Berhasil! File tersimpan: {final}')
        sys.exit(0)
    except PermissionError:
        print(f'  Masih terkunci Word ({attempt+1}/10). Pastikan Word sudah ditutup lalu tekan Enter untuk mencoba lagi...')
        input()

print('[ERR] Gagal mengganti file setelah 10 percobaan.')
