#!/usr/bin/env bash
# ==============================================================================
#  scripts/deploy_pull.sh
#  Skrip Auto-Deploy / Manual Deploy untuk Server Dewaweb (cPanel / CloudLinux)
# ==============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"

echo "=================================================="
echo "🚀 Memulai Deployment di Server Dewaweb"
echo "📁 Lokasi Aplikasi: $APP_DIR"
echo "⏰ Waktu: $(date)"
echo "=================================================="

cd "$APP_DIR"

# 1. Tarik commit terbaru dari GitHub
echo "📥 Menjalankan git fetch & reset..."
git fetch origin master
git reset --hard origin/master

# 2. Instal dependensi produksi (jika ada perubahan pada package.json)
if [ -f "package.json" ]; then
  echo "📦 Memeriksa dependensi npm..."
  npm install --omit=dev --no-audit --prefer-offline || true
fi

# 3. Trigger restart Phusion Passenger di cPanel Dewaweb
echo "🔄 Memicu restart Node.js Passenger (touch tmp/restart.txt)..."
mkdir -p tmp
touch tmp/restart.txt

echo "=================================================="
echo "✅ Deployment Sukses! Commit aktif:"
git log -1 --oneline
echo "=================================================="
