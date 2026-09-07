'use strict';
// ─────────────────────────────────────────────────────────────────────────────
//  contextBuilder.js
//  Membangun blok konteks data LIVE dari SQLite untuk diinjeksikan ke
//  System Prompt AI Agent setiap request.
//
//  Tujuan: AI dapat menjawab pertanyaan ringkasan TANPA perlu memanggil tool,
//  sehingga menghemat 1 API round-trip (~50% quota) untuk pertanyaan umum.
// ─────────────────────────────────────────────────────────────────────────────

const { getDb, getSettings, getLatestUpload, getOverviewSummary, getKecamatanStats, getAnomalyStats, getEarlyWarning } = require('../../database');
const _logger = require('../logger');

/**
 * Format angka dengan pemisah ribuan.
 * @param {number|null} n
 */
function fmt(n) {
  if (n == null || isNaN(n)) return '-';
  return Number(n).toLocaleString('id-ID');
}

/**
 * Format persentase menjadi string "XX.XX%".
 * @param {number|null} pct
 */
function fmtPct(pct) {
  if (pct == null || isNaN(pct)) return '-';
  return `${Number(pct).toFixed(2)}%`;
}

/**
 * Membangun blok teks markdown berisi konteks data terkini dari SQLite.
 * Dipanggil sekali per request dari streamMessageToAgent/sendMessageToAgent.
 *
 * @param {string} [surveyId='se2026']
 * @returns {string} Blok markdown konteks siap diinjeksikan ke system prompt
 */
function buildLiveContext(surveyId = 'se2026') {
  try {
    const upload = getLatestUpload(surveyId);
    if (!upload) {
      return `\n## Konteks Data Terkini\n_Belum ada data upload dalam sistem. Informasikan kepada user bahwa data belum tersedia._\n`;
    }

    const settings = getSettings(surveyId);
    const summary = getOverviewSummary(upload.id, settings, surveyId);
    if (!summary) {
      return `\n## Konteks Data Terkini\n_Data upload tersedia (ID: ${upload.id}) namun ringkasan belum bisa dihitung._\n`;
    }

    // Kecamatan stats: ambil top 2 dan bottom 2 berdasarkan % FASIH
    let topKec = [], botKec = [];
    try {
      const kecStats = getKecamatanStats(upload.id, settings, surveyId);
      if (Array.isArray(kecStats) && kecStats.length > 0) {
        const sorted = [...kecStats].sort((a, b) => (b.pct || 0) - (a.pct || 0));
        topKec = sorted.slice(0, 2);
        botKec = sorted.slice(-2).reverse();
      }
    } catch (_) {}

    // Anomali: hitung total anomali aktif
    let anomaliCount = 0;
    try {
      const anomali = getAnomalyStats(upload.id, {}, surveyId);
      if (Array.isArray(anomali)) anomaliCount = anomali.length;
    } catch (_) {}

    // Early warning: hitung total item
    let ewCount = 0;
    try {
      const ew = getEarlyWarning(upload.id, {}, settings, surveyId);
      if (Array.isArray(ew)) ewCount = ew.length;
      else if (ew && typeof ew === 'object') {
        ewCount = Object.values(ew).filter(v => Array.isArray(v)).reduce((acc, arr) => acc + arr.length, 0);
      }
    } catch (_) {}

    const { getSurveyConfigById } = require('../surveyRegistry');
    const surveyConfig = getSurveyConfigById(surveyId);
    const officerRole = (surveyConfig && surveyConfig.officerRole) || 'PCL';
    const unitName = (surveyConfig && surveyConfig.unitName) || 'dokumen';
    const surveyName = (surveyConfig && surveyConfig.name) || 'Sensus/Survei PPU';
    const isCensus = surveyConfig && surveyConfig.category === 'sensus';

    // Build context block
    const pctFasih   = fmtPct(summary.fasih_pct != null ? summary.fasih_pct : summary.pct);
    const pctMuatan  = fmtPct(summary.muatan_pct != null ? summary.muatan_pct : summary.pct_muatan);
    const selesai    = fmt(summary.selesai);
    const total      = fmt(summary.total);
    const muatanSel  = fmt(summary.muatan_selesai);
    const muatanTot  = fmt(summary.total_muatan);
    const targetFasih = fmt(summary.target_fasih_total || summary.target_static_total);
    const realFasih  = fmt((summary.submitted_total || 0) + (summary.approved_total || 0) + (summary.rejected_total || 0));
    const approved   = fmt(summary.approved_total);
    const submitted  = fmt(summary.submitted_total);
    const rejected   = fmt(summary.rejected_total);
    const draft      = fmt(summary.draft_total);
    const totalPcl   = fmt(summary.total_pcl);
    const activePcl  = fmt(summary.active_pcl);
    const totalPml   = fmt(summary.total_pml);

    let kecTableText = '';
    try {
      const allKec = getKecamatanStats(upload.id, settings, surveyId);
      if (Array.isArray(allKec) && allKec.length > 0) {
        kecTableText = `\n### Capaian Seluruh Kecamatan di Kabupaten PPU\n| Kecamatan | Target ${unitName} | Realisasi | % Capaian | Approved | Selesai |\n|:---|:---:|:---:|:---:|:---:|:---:|\n`;
        allKec.forEach(k => {
          const kPct = fmtPct(k.fasih_pct != null ? k.fasih_pct : k.pct);
          const kTarget = fmt(k.target_fasih_total || k.target_static_total || k.total_muatan);
          const kReal = fmt(k.fasih_real_total != null ? k.fasih_real_total : k.muatan_selesai);
          const kApp = fmt(k.approved_total);
          const kDone = `${k.selesai} / ${k.total_subsls}`;
          kecTableText += `| **${k.kecamatan}** | ${kTarget} | ${kReal} | **${kPct}** | ${kApp} | ${kDone} |\n`;
        });
      }
    } catch (_) {}

    return `
## Konteks Data Ringkasan Terkini (Live Context)

> Data di bawah ini adalah snapshot ringkasan database saat ini untuk kegiatan **${surveyName}**.
> Karakteristik Kegiatan: ${surveyConfig ? `${surveyConfig.categoryLabel || 'Survei'} | Satuan: ${unitName} | Petugas: ${officerRole}` : 'Pemantauan BPS'}
> **PANDUAN PENTING**: Jika pertanyaan pengguna berkaitan dengan ringkasan progres umum kegiatan/kabupaten (misalnya: "Bagaimana ringkasan progres survei Sakernas CAPI di Kabupaten PPU saat ini?"), GUNAKAN LANGSUNG DATA DI BAWAH INI untuk menyusun jawaban naratif yang kaya, lengkap, dan analitis. JANGAN memanggil tool hanya untuk mengulang data agregat yang sudah tercantum di sini!

### Upload Terakhir
- **Tanggal**: ${upload.tanggal}
- **File**: ${upload.filename || 'N/A'}
- **Upload ID**: ${upload.id}

### Ringkasan Progres Kabupaten PPU (${surveyName})
| Indikator | Nilai |
|:---|---:|
| ${isCensus ? 'SLS Selesai / Total' : 'Blok Sensus Selesai / Total Sampel'} | ${selesai} / ${total} |
| % Capaian Utama (${unitName}) | **${pctFasih}** |
${isCensus ? `| % Progres Muatan / Listing | **${pctMuatan}** |\n` : ''}| Target ${unitName} | ${targetFasih} |
| Realisasi ${unitName} Terdata | ${realFasih} |
| Dokumen Approved (Disetujui PML) | ${approved} |
| Dokumen Submitted (Menunggu Review PML) | ${submitted} |
| Dokumen Rejected (Perlu Perbaikan PPL) | ${rejected} |
| Dokumen Draft | ${draft} |
${isCensus ? `| Muatan Selesai / Target | ${muatanSel} / ${muatanTot} |\n` : ''}| ${officerRole} Aktif / Total ${officerRole} | ${activePcl} / ${totalPcl} |
| Total PML Pengawas | ${totalPml} |
| ${officerRole} dengan Anomali / Perhatian | ${anomaliCount} |
| Item Early Warning | ${ewCount} |
${kecTableText}
`;
  } catch (err) {
    // Jangan crash jika context gagal dibangun — cukup kembalikan string kosong
    _logger.error(`[contextBuilder] Gagal membangun live context: ${err.message}`);
    return '';
  }
}

module.exports = { buildLiveContext };
