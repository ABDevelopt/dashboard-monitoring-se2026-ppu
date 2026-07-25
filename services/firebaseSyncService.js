const { getFirestore, isFirebaseActive } = require('./firebaseService');
const {
  getOverviewSummary,
  getKecamatanStats,
  getPclStats,
  getPmlStats,
  getKorlapStats,
  getAnomalyStats,
  getEarlyWarning,
  getLatestUpload,
  getSettings
} = require('../database');
const logger = require('./logger');

/**
 * Sync all SQLite summary data to Firebase Firestore
 */
async function syncAllToFirestore() {
  const db = getFirestore();
  if (!db) {
    logger.warn('[FIREBASE_SYNC] Firestore is not active. Skipping sync.');
    return false;
  }

  logger.info('[FIREBASE_SYNC] 🔄 Starting full sync from SQLite to Firestore...');
  const startTime = Date.now();

  try {
    const upload = getLatestUpload();
    const uploadId = upload ? upload.id : null;
    const settings = getSettings();

    // 1. Sync Overview Summary
    const overview = getOverviewSummary(uploadId);
    if (overview) {
      await db.collection('overview_summary').doc('current').set({
        ...overview,
        updated_at: new Date().toISOString(),
        latest_file: upload ? upload.filename : null,
        latest_date: upload ? upload.fasih_date : null
      });
    }

    // 2. Sync Kecamatan Stats
    const kecStats = getKecamatanStats(uploadId);
    if (Array.isArray(kecStats)) {
      const batch = db.batch();
      kecStats.forEach(kec => {
        const docId = (kec.kecamatan || 'unknown').toLowerCase().replace(/\s+/g, '_');
        const ref = db.collection('kecamatan_summary').doc(docId);
        batch.set(ref, {
          ...kec,
          updated_at: new Date().toISOString()
        });
      });
      await batch.commit();
    }

    // 3. Sync PCL Stats
    const pclStats = getPclStats(uploadId);
    if (Array.isArray(pclStats)) {
      // Chunk batch operations (Firestore limit: 500 per batch)
      let batch = db.batch();
      let count = 0;
      for (const pcl of pclStats) {
        const docId = (pcl.nama_pcl || 'unknown').toLowerCase().replace(/[^a-z0-9]/g, '_');
        const ref = db.collection('pcl_summary').doc(docId);
        batch.set(ref, {
          ...pcl,
          updated_at: new Date().toISOString()
        });
        count++;
        if (count % 400 === 0) {
          await batch.commit();
          batch = db.batch();
        }
      }
      if (count % 400 !== 0) {
        await batch.commit();
      }
    }

    // 4. Sync PML Stats
    const pmlStats = getPmlStats(uploadId);
    if (Array.isArray(pmlStats)) {
      let batch = db.batch();
      let count = 0;
      for (const pml of pmlStats) {
        const docId = (pml.nama_pml || 'unknown').toLowerCase().replace(/[^a-z0-9]/g, '_');
        const ref = db.collection('pml_summary').doc(docId);
        batch.set(ref, {
          ...pml,
          updated_at: new Date().toISOString()
        });
        count++;
        if (count % 400 === 0) {
          await batch.commit();
          batch = db.batch();
        }
      }
      if (count % 400 !== 0) {
        await batch.commit();
      }
    }

    // 5. Sync Early Warning
    const earlyWarning = getEarlyWarning(uploadId);
    if (earlyWarning) {
      await db.collection('early_warning').doc('current').set({
        ...earlyWarning,
        updated_at: new Date().toISOString()
      });
    }

    // 6. Sync Anomaly Stats
    const anomaly = getAnomalyStats(uploadId);
    if (anomaly) {
      await db.collection('deteksi_anomali').doc('current').set({
        ...anomaly,
        updated_at: new Date().toISOString()
      });
    }

    // 7. Sync Settings
    if (settings) {
      // Exclude sensitive keys before pushing to Firestore
      const safeSettings = { ...settings };
      delete safeSettings.gemini_api_key;
      delete safeSettings.openai_api_key;
      delete safeSettings.openrouter_api_key;
      await db.collection('system_settings').doc('current').set({
        ...safeSettings,
        updated_at: new Date().toISOString()
      });
    }

    const duration = Date.now() - startTime;
    logger.info(`[FIREBASE_SYNC] ✅ SQLite to Firestore summary sync completed in ${duration}ms`);
    return true;

  } catch (err) {
    logger.error(`[FIREBASE_SYNC] ❌ Sync error: ${err.message}`);
    return false;
  }
}

/**
 * Perform a FULL clone of all SQLite tables (subsls_master, uploads, summary_cache)
 * into Cloud Firestore collections.
 */
async function cloneFullDatabaseToFirestore() {
  const db = getFirestore();
  if (!db) {
    logger.warn('[FIREBASE_SYNC] Firestore is not active. Skipping full database clone.');
    return false;
  }

  logger.info('[FIREBASE_SYNC] 🚀 Starting FULL database clone from SQLite to Firestore...');
  const startTime = Date.now();

  try {
    const sqliteDb = require('../database').getDb();

    // 1. Sync Summary Cards & Aggregates first
    await syncAllToFirestore();

    // 2. Clone Full Master SubSLS (1042+ records)
    const masterRows = sqliteDb.prepare('SELECT * FROM subsls_master').all();
    logger.info(`[FIREBASE_SYNC] 📦 Cloning ${masterRows.length} subsls_master records...`);
    let batch = db.batch();
    let count = 0;
    for (const row of masterRows) {
      const docId = String(row.kode || `subsls_${count}`);
      const ref = db.collection('subsls_master').doc(docId);
      batch.set(ref, {
        ...row,
        updated_at: new Date().toISOString()
      });
      count++;
      if (count % 400 === 0) {
        await batch.commit();
        batch = db.batch();
      }
    }
    if (count % 400 !== 0) {
      await batch.commit();
    }

    // 3. Clone Uploads History
    const uploadRows = sqliteDb.prepare('SELECT * FROM uploads').all();
    if (uploadRows.length > 0) {
      batch = db.batch();
      uploadRows.forEach(row => {
        const ref = db.collection('uploads').doc(String(row.id));
        batch.set(ref, {
          ...row,
          updated_at: new Date().toISOString()
        });
      });
      await batch.commit();
    }

    // 4. Clone Summary Cache (per SubSLS per upload)
    const cacheRows = sqliteDb.prepare('SELECT * FROM summary_cache').all();
    logger.info(`[FIREBASE_SYNC] 📦 Cloning ${cacheRows.length} summary_cache records...`);
    count = 0;
    batch = db.batch();
    for (const row of cacheRows) {
      const docId = `${row.upload_id}_${row.kode}`;
      const ref = db.collection('summary_cache').doc(docId);
      batch.set(ref, {
        ...row,
        updated_at: new Date().toISOString()
      });
      count++;
      if (count % 400 === 0) {
        await batch.commit();
        batch = db.batch();
      }
    }
    if (count % 400 !== 0) {
      await batch.commit();
    }

    const duration = Date.now() - startTime;
    logger.info(`[FIREBASE_SYNC] 🎉 FULL database clone completed successfully in ${duration}ms!`);
    return true;

  } catch (err) {
    logger.error(`[FIREBASE_SYNC] ❌ Full clone error: ${err.message}`);
    return false;
  }
}

/**
 * Trigger non-blocking async sync to Firestore (Full or Summary)
 */
function triggerAsyncSync(fullClone = false) {
  setImmediate(async () => {
    try {
      if (fullClone) {
        await cloneFullDatabaseToFirestore();
      } else {
        await syncAllToFirestore();
      }
    } catch (e) {
      logger.error('[FIREBASE_SYNC] Async trigger error:', e.message);
    }
  });
}

module.exports = {
  syncAllToFirestore,
  cloneFullDatabaseToFirestore,
  triggerAsyncSync
};
