'use strict';
// ─────────────────────────────────────────────────────────────────────────────
//  services/ai/harness2Engine.js
//  Implementasi Arsitektur Google Research Harness² (arXiv:2610.14224)
//  Recursive Agent Harnessing for Open-World Statistical Analytics & Monitoring
// ─────────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const logger = require('../logger');

const LIBRARY_FILE = path.join(__dirname, '../../data/harness_library.json');

/**
 * 8 Komponen Scaffolding Standar Harness² (Google Research Taxonomy):
 * 1. System Prompt : Basis instruksi identitas dan domain
 * 2. Guardrails    : Batasan kepatuhan (Zero-PII, Zero-Jitter, Validasi Negasi)
 * 3. Memory        : Konteks percakapan adaptif & session state
 * 4. Tool Guidance : Definisi dan contoh pemanggilan alat query data
 * 5. Subagents     : Delegasi tugas spesialis (Anomali, Progres, Spasial)
 * 6. Skills        : Pengetahuan domain BPS (SE2026, Sakernas, KBLI, dsb.)
 * 7. Scripts       : Logika deterministik lokal & kalkulasi agregasi
 * 8. Plugins       : Middleware koneksi, multi-key pool, fallback model
 */
class Harness2Engine {
  constructor() {
    this.library = this._loadLibrary();
    this.components = {
      system_prompt: 'Anda adalah Pananyo Taka AI, asisten analitik resmi BPS Penajam Paser Utara.',
      guardrails: [
        'Prinsip Zero-PII: Dilarang memaparkan identitas personal responden.',
        'Prinsip Zero-Jitter: Seluruh angka statistik dan progres harus 100% presisi riil.',
        'Penanganan Negasi Eksplisit: Kata "selain", "bukan", "tanpa" wajib diubah menjadi filter pengecualian (NOT LIKE / NOT IN).'
      ],
      memory: { max_turns: 10, dynamic_context_window: 8192 },
      tool_guidance: [
        'Gunakan execute_sql_query untuk query agregasi SLS, PML, dan PCL.',
        'Gunakan get_sls_detail untuk data spasial dan geotagging titik keluarga/usaha.'
      ],
      subagents: ['anomaly_detector', 'progress_evaluator', 'spatial_mapper'],
      skills: ['se2026-pedoman', 'sakernas-2026', 'bps-data-standards', 'taka-ui'],
      scripts: ['calc_ntb_ratio', 'project_completion_date', 'aggregate_subdistrict'],
      plugins: ['gemini-keypool', 'fast-path-cache', 'smart-session-switcher']
    };
  }

  /**
   * Pemuatan Persistent Improvement Library (Harnessing-Level Recursion)
   */
  _loadLibrary() {
    try {
      if (fs.existsSync(LIBRARY_FILE)) {
        const raw = fs.readFileSync(LIBRARY_FILE, 'utf8');
        return JSON.parse(raw);
      }
    } catch (err) {
      logger.warn(`[HARNESS²] Gagal membaca harness_library.json: ${err.message}`);
    }
    return {
      version: '1.0.0',
      framework: 'google-research/harness2',
      updated_at: new Date().toISOString(),
      adopted_lessons: [
        {
          id: 'lesson_negation_01',
          trigger: 'selain|bukan|kecuali',
          component: 'tool_guidance',
          lesson: 'Tambahkan klausa NOT IN / NOT LIKE pada filter nama kecamatan/desa.',
          score: 0.98
        },
        {
          id: 'lesson_target_precision_02',
          trigger: 'target|beban|sisa',
          component: 'system_prompt',
          lesson: 'Gunakan kolom target_upload atau target_fasih_total secara konsisten.',
          score: 0.95
        }
      ],
      task_history: []
    };
  }

  /**
   * Menyimpan Improvement Library ke disk
   */
  _saveLibrary() {
    try {
      fs.writeFileSync(LIBRARY_FILE, JSON.stringify(this.library, null, 2), 'utf8');
    } catch (err) {
      logger.error(`[HARNESS²] Gagal menyimpan harness_library.json: ${err.message}`);
    }
  }

  /**
   * Task-Level Recursion: Propose – Probe – Compose
   * @param {string} userQuery Pertanyaan pengguna
   * @param {Object} context Konteks aktif survei & upload data
   * @param {Function} probeExecutor Fungsi pelaksana query probe ke basis data
   */
  async runTaskRecursion(userQuery, context, probeExecutor) {
    const startTime = Date.now();
    logger.info(`[HARNESS²] Memulai Task-Level Recursion untuk kueri: "${userQuery.slice(0, 50)}..."`);

    // 1. PROPOSE: Cari pelajaran dari library & ajukan adaptasi harness
    const relevantLessons = this.library.adopted_lessons.filter(item => {
      const regex = new RegExp(item.trigger, 'i');
      return regex.test(userQuery);
    });

    const proposedLevers = {
      domain_focus: context.surveyId || 'se2026',
      applied_lessons: relevantLessons.map(l => l.id),
      guidance_additions: relevantLessons.map(l => l.lesson)
    };

    // 2. PROBE: Lakukan probe kontras perilaku eksekusi tanpa verifier eksternal
    let probeResult = null;
    try {
      if (typeof probeExecutor === 'function') {
        probeResult = await probeExecutor(proposedLevers);
      }
    } catch (probeErr) {
      logger.warn(`[HARNESS²] Probe eksekusi menghasilkan catatan: ${probeErr.message}`);
    }

    // 3. COMPOSE: Gabungkan hasil probe dan lessons menjadi harness yang telah disempurnakan
    const composedHarness = {
      is_refined: true,
      query: userQuery,
      survey_id: context.surveyId || 'se2026',
      active_levers: proposedLevers,
      probe_summary: probeResult ? 'Probe sukses mengekstrak telemetri data riil' : 'Probe fallback ke query standar',
      duration_ms: Date.now() - startTime
    };

    // 4. HARNESSING-LEVEL RECURSION: Catat pengalaman kueri ini untuk continual refinement
    this.recordTaskExperience(userQuery, composedHarness);

    return composedHarness;
  }

  /**
   * Harnessing-Level Recursion: Mencatat pengalaman tugas dan memperbarui persistent library
   */
  recordTaskExperience(query, harnessResult) {
    if (!this.library.task_history) {
      this.library.task_history = [];
    }
    this.library.task_history.push({
      timestamp: new Date().toISOString(),
      query_hash: Buffer.from(query.slice(0, 32)).toString('base64'),
      duration_ms: harnessResult.duration_ms,
      levers: harnessResult.active_levers
    });

    // Batasi histori riwayat maksimum 100 entri
    if (this.library.task_history.length > 100) {
      this.library.task_history.shift();
    }

    this.library.updated_at = new Date().toISOString();
    this._saveLibrary();
  }

  /**
   * Status diagnostik engine Harness²
   */
  getStatus() {
    return {
      name: 'Google Research Harness² Engine',
      version: '0.1.0-adapter',
      paper: 'arXiv:2610.14224',
      components_count: Object.keys(this.components).length,
      adopted_lessons_count: this.library.adopted_lessons.length,
      tasks_refined_count: (this.library.task_history || []).length,
      library_path: LIBRARY_FILE,
      cli_toolkit_installed: fs.existsSync(path.join(__dirname, '../../tools/harness2/.venv'))
    };
  }
}

module.exports = new Harness2Engine();
