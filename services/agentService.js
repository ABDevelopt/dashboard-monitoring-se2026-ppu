const { getDb, getSettings } = require('../database');
const { dbSchemaDescription } = require('./dbSchema');

/**
 * Executes a SELECT query safely on the database.
 * Enforces read-only check and scanners.
 */
function executeQuery(sql) {
  const cleanSql = sql.trim();
  const isSelect = /^select\s/i.test(cleanSql);
  if (!isSelect) {
    throw new Error("Security Alert: Only SELECT queries are permitted.");
  }
  
  // Scan for forbidden write keywords to prevent SQL injection/abuse
  const forbidden = ['insert', 'update', 'delete', 'drop', 'alter', 'create', 'replace', 'truncate', 'grant', 'revoke', 'pragma', 'reindex'];
  const tokens = cleanSql.toLowerCase().split(/\s+/);
  for (const token of tokens) {
    const cleanToken = token.replace(/[^a-z_]/g, '');
    if (forbidden.includes(cleanToken)) {
      throw new Error(`Security Alert: Forbidden keyword "${token}" detected in query.`);
    }
  }

  const db = getDb();
  return db.prepare(cleanSql).all();
}

/**
 * Simulated/Fallback response logic using real database data.
 * Matches keywords and executes pre-defined SQL queries.
 */
function runSimulation(userMessage, chatHistory) {
  const lowerMsg = userMessage.toLowerCase();
  const db = getDb();
  
  // Get latest upload details
  const latestUpload = db.prepare('SELECT * FROM uploads ORDER BY id DESC LIMIT 1').get();
  if (!latestUpload) {
    return {
      role: 'model',
      content: `🤖 **Mode Simulasi (Preview)**\n\nBelum ada data upload di sistem. Silakan masuk ke menu **Upload Data** terlebih dahulu untuk mengunggah berkas progres harian.`,
      isSimulation: true
    };
  }
  
  const uploadId = latestUpload.id;

  try {
    if (lowerMsg.includes('terendah') || lowerMsg.includes('rendah') || lowerMsg.includes('buruk')) {
      let limit = 3;
      let filterKec = '';
      let kecLabel = 'Seluruh Wilayah';
      
      if (lowerMsg.includes('sepaku')) {
        filterKec = "AND m.kecamatan = 'SEPAKU'";
        kecLabel = 'Kecamatan Sepaku';
      } else if (lowerMsg.includes('penajam')) {
        filterKec = "AND m.kecamatan = 'PENAJAM'";
        kecLabel = 'Kecamatan Penajam';
      } else if (lowerMsg.includes('babulu')) {
        filterKec = "AND m.kecamatan = 'BABULU'";
        kecLabel = 'Kecamatan Babulu';
      } else if (lowerMsg.includes('waru')) {
        filterKec = "AND m.kecamatan = 'WARU'";
        kecLabel = 'Kecamatan Waru';
      }

      const query = `
        SELECT 
          m.pcl, 
          MAX(m.pml) AS pml, 
          MAX(m.kecamatan) AS kecamatan,
          SUM(m.muatan) AS total_muatan,
          SUM(COALESCE(p.usaha_ditemukan + p.usaha_baru, 0) + COALESCE(p.ditemukan + p.keluarga_baru, 0)) AS muatan_selesai
        FROM subsls_master m
        LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
        WHERE 1=1 ${filterKec}
        GROUP BY m.pcl
        ORDER BY muatan_selesai ASC, total_muatan DESC
        LIMIT ?
      `;
      
      const rows = db.prepare(query).all(uploadId, limit);
      
      let content = `🤖 **Mode Simulasi (Analisis Real-time)**\n\n`;
      content += `Berikut adalah daftar **${limit} petugas PCL dengan capaian terendah** di **${kecLabel}** (Berdasarkan upload tanggal *${latestUpload.tanggal}*):\n\n`;
      content += `| Nama PCL | PML Pengawas | Kecamatan | Realisasi Muatan | Progres (%) |\n`;
      content += `| :--- | :--- | :--- | :--- | :--- |\n`;
      
      rows.forEach(r => {
        const pct = r.total_muatan > 0 ? ((r.muatan_selesai / r.total_muatan) * 100).toFixed(2) : '0.00';
        content += `| ${r.pcl} | ${r.pml} | ${r.kecamatan} | ${r.muatan_selesai} / ${r.total_muatan} | **${pct}%** |\n`;
      });
      
      content += `\n**Rekomendasi Tindak Lanjut:**\n`;
      if (rows.length > 0) {
        content += `- PML pengawas disarankan untuk melakukan *monitoring* dan pendampingan lapangan langsung kepada **${rows[0].pcl}** karena memiliki capaian terendah.\n`;
      }
      content += `- Periksa kendala teknis pada aplikasi FASIH atau kendala akses geospasial di wilayah tugas mereka.\n\n`;
      content += `*Tip: Konfigurasikan Gemini API Key di Pengaturan Admin untuk bertanya hal detail secara bebas dengan bahasa alami!*`;

      return { role: 'model', content, isSimulation: true };
    }
    
    if (lowerMsg.includes('terbaik') || lowerMsg.includes('tinggi') || lowerMsg.includes('leaderboard')) {
      const query = `
        SELECT 
          m.pcl, 
          MAX(m.pml) AS pml, 
          MAX(m.kecamatan) AS kecamatan,
          SUM(m.muatan) AS total_muatan,
          SUM(COALESCE(p.usaha_ditemukan + p.usaha_baru, 0) + COALESCE(p.ditemukan + p.keluarga_baru, 0)) AS muatan_selesai
        FROM subsls_master m
        LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
        GROUP BY m.pcl
        ORDER BY muatan_selesai DESC
        LIMIT 5
      `;
      
      const rows = db.prepare(query).all(uploadId);
      
      let content = `🤖 **Mode Simulasi (Analisis Real-time)**\n\n`;
      content += `Berikut adalah **Top 5 Petugas PCL Teraktif** dengan realisasi muatan terbanyak di Kabupaten PPU:\n\n`;
      content += `| Peringkat | Nama PCL | PML Pengawas | Kecamatan | Realisasi Muatan | Progres (%) |\n`;
      content += `| :---: | :--- | :--- | :--- | :--- | :--- |\n`;
      
      rows.forEach((r, idx) => {
        const pct = r.total_muatan > 0 ? ((r.muatan_selesai / r.total_muatan) * 100).toFixed(2) : '0.00';
        content += `| #${idx + 1} | ${r.pcl} | ${r.pml} | ${r.kecamatan} | ${r.muatan_selesai} / ${r.total_muatan} | **${pct}%** |\n`;
      });
      
      content += `\nApresiasi yang tinggi kepada para petugas di atas atas kinerja luar biasa dalam pengumpulan data sensus!\n\n`;
      content += `*Tip: Konfigurasikan Gemini API Key di Pengaturan Admin untuk melakukan analisis kustom yang lebih mendalam.*`;

      return { role: 'model', content, isSimulation: true };
    }

    if (lowerMsg.includes('rerata') || lowerMsg.includes('rata-rata') || lowerMsg.includes('progres') || lowerMsg.includes('selesai') || lowerMsg.includes('capaian')) {
      // Get county statistics
      const totalSls = db.prepare('SELECT COUNT(*) as n FROM subsls_master').get().n;
      const totalCompletedSls = db.prepare(`
        SELECT COUNT(DISTINCT p.kode) as n 
        FROM progres p
        JOIN subsls_master m ON p.kode = m.kode
        WHERE p.upload_id = ? AND COALESCE(m.target_fasih, 0) > 0 AND (COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) >= m.target_fasih
      `).get(uploadId).n;
      
      const muatanTotal = db.prepare('SELECT SUM(muatan) as n FROM subsls_master').get().n || 0;
      const muatanSelesai = db.prepare(`
        SELECT SUM(COALESCE(p.usaha_ditemukan, 0) + COALESCE(p.usaha_baru, 0) + COALESCE(p.ditemukan, 0) + COALESCE(p.keluarga_baru, 0)) as n FROM progres p WHERE p.upload_id = ?
      `).get(uploadId).n || 0;

      const completionPct = totalSls > 0 ? ((totalCompletedSls / totalSls) * 100).toFixed(2) : '0.00';
      const muatanPct = muatanTotal > 0 ? ((muatanSelesai / muatanTotal) * 100).toFixed(2) : '0.00';

      let content = `🤖 **Mode Simulasi (Analisis Real-time)**\n\n`;
      content += `Berikut adalah ringkasan progres kumulatif Sensus Ekonomi 2026 Kabupaten Penajam Paser Utara:\n\n`;
      content += `- **Total SubSLS Terdaftar:** ${totalSls.toLocaleString('id-ID')} SLS\n`;
      content += `- **SubSLS Selesai Target FASIH:** ${totalCompletedSls.toLocaleString('id-ID')} SLS (**${completionPct}%**)\n`;
      content += `- **Kumulatif Muatan Terdata:** ${muatanSelesai.toLocaleString('id-ID')} dari beban ${muatanTotal.toLocaleString('id-ID')} usaha (**${muatanPct}%**)\n\n`;
      
      // Breakdown per kecamatan
      content += `### Capaian per Kecamatan:\n\n`;
      content += `| Kecamatan | Total SLS | SLS Selesai (%) | Total Target Muatan | Realisasi Muatan (%) |\n`;
      content += `| :--- | :---: | :---: | :---: | :---: |\n`;
      
      const kecs = db.prepare(`
        SELECT 
          m.kecamatan,
          COUNT(m.kode) AS total_subsls,
          SUM(CASE WHEN p.kode IS NOT NULL AND COALESCE(m.target_fasih, 0) > 0 AND (COALESCE(p.submitted_by_pcl, 0) + COALESCE(p.approved, 0) + COALESCE(p.rejected, 0)) >= m.target_fasih THEN 1 ELSE 0 END) AS selesai,
          SUM(m.muatan) AS total_muatan,
          SUM(COALESCE(p.usaha_ditemukan + p.usaha_baru, 0) + COALESCE(p.ditemukan + p.keluarga_baru, 0)) AS muatan_selesai
        FROM subsls_master m
        LEFT JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
        GROUP BY m.kecamatan
      `).all(uploadId);

      kecs.forEach(k => {
        const slsPct = k.total_subsls > 0 ? ((k.selesai / k.total_subsls) * 100).toFixed(2) : '0.00';
        const mPct = k.total_muatan > 0 ? ((k.muatan_selesai / k.total_muatan) * 100).toFixed(2) : '0.00';
        content += `| ${k.kecamatan} | ${k.total_subsls} | ${k.selesai} (${slsPct}%) | ${k.total_muatan} | ${k.muatan_selesai} (${mPct}%) |\n`;
      });
      
      content += `\n*Tip: Konfigurasikan Gemini API Key untuk melakukan tanya jawab kustom tanpa batasan keyword.*`;
      return { role: 'model', content, isSimulation: true };
    }

    if (lowerMsg.includes('anomali') || lowerMsg.includes('ganda') || lowerMsg.includes('kualitas')) {
      const gandaCount = db.prepare('SELECT SUM(usaha_ganda) as n FROM progres WHERE upload_id = ?').get(uploadId).n || 0;
      const noMeetCount = db.prepare('SELECT SUM(tidak_dapat_ditemui) as n FROM progres WHERE upload_id = ?').get(uploadId).n || 0;
      const rejectCount = db.prepare('SELECT SUM(rejected) as n FROM progres WHERE upload_id = ?').get(uploadId).n || 0;

      let content = `🤖 **Mode Simulasi (Analisis Real-time)**\n\n`;
      content += `Ditemukan beberapa indikasi anomali data kualitas pengumpulan di lapangan:\n\n`;
      content += `1. **Indikasi Usaha Ganda (Double Input):** Terdeteksi sebanyak **${gandaCount} kasus** usaha ganda pada kuesioner.\n`;
      content += `2. **Responden Tidak Dapat Ditemui:** Terjadi pada **${noMeetCount} dokumen/keluarga**.\n`;
      content += `3. **Dokumen Ditolak (Rejected by PML):** Terhitung **${rejectCount} dokumen** dikembalikan ke PCL untuk perbaikan.\n\n`;
      
      // Top PCL with anomalies
      const topAnomalyPcl = db.prepare(`
        SELECT 
          m.pcl,
          m.pml,
          SUM(COALESCE(p.usaha_ganda, 0)) AS ganda,
          SUM(COALESCE(p.rejected, 0)) AS reject
        FROM subsls_master m
        JOIN progres p ON m.kode = p.kode AND p.upload_id = ?
        GROUP BY m.pcl
        HAVING ganda > 0 OR reject > 0
        ORDER BY (ganda + reject) DESC
        LIMIT 3
      `).all(uploadId);

      if (topAnomalyPcl.length > 0) {
        content += `### Petugas dengan Kasus Terbanyak:\n\n`;
        content += `| Nama PCL | PML Pengawas | Kasus Ganda | Dokumen Rejected |\n`;
        content += `| :--- | :--- | :---: | :---: |\n`;
        topAnomalyPcl.forEach(r => {
          content += `| ${r.pcl} | ${r.pml} | ${r.ganda} | ${r.reject} |\n`;
        });
        content += `\n`;
      }

      content += `**Rekomendasi Tindak Lanjut:**\n`;
      content += `- PML disarankan untuk mengonfirmasi ulang status kuesioner ganda bersama PCL terkait.\n`;
      content += `- Evaluasi proses verifikasi data agar penolakan dokumen tidak terulang.\n\n`;
      content += `*Tip: Hubungkan dengan Gemini API Key untuk melakukan query silang dan kustomisasi laporan anomali.*`;
      return { role: 'model', content, isSimulation: true };
    }

    // Default Simulation Reply
    let content = `🤖 **Mode Simulasi (Preview)**\n\n`;
    content += `Halo! Saya adalah **Asisten AI Chat** untuk Dashboard SE2026 PPU.\n\n`;
    content += `Saat ini fitur AI Agent berjalan dalam **Mode Simulasi** karena Google Gemini API Key belum dikonfigurasikan di menu **Pengaturan Tampilan**.\n\n`;
    content += `Meskipun dalam mode simulasi, saya tetap dapat menganalisis data riil di database Anda untuk kategori berikut. Cobalah ketik salah satu kata kunci berikut:\n`;
    content += `- **"progres"** atau **"rerata"**: Untuk melihat progres kumulatif kabupaten & per kecamatan.\n`;
    content += `- **"terendah"**: Untuk mencari petugas PCL dengan capaian terendah.\n`;
    content += `- **"terbaik"** atau **"leaderboard"**: Untuk menampilkan peringkat 5 petugas PCL teratas.\n`;
    content += `- **"anomali"** atau **"ganda"**: Untuk memeriksa kualitas kuesioner dan tingkat penolakan dokumen.\n\n`;
    content += `*Untuk mengaktifkan asisten AI pintar yang fleksibel menggunakan natural language secara penuh, silakan masukkan **Gemini API Key** Anda di halaman [Pengaturan Tampilan](/admin/settings).*`;
    return { role: 'model', content, isSimulation: true };
  } catch (err) {
    return {
      role: 'model',
      content: `🤖 **Mode Simulasi (Error)**\n\nGagal membaca data dari database SQLite: ${err.message}`,
      isSimulation: true
    };
  }
}

/**
 * Sends a chat message to Gemini AI Agent (with SQLite Function Calling tool)
 * Or falls back to simulation mode if API key is not set.
 */
async function sendMessageToAgent(userMessage, chatHistory = []) {
  const settings = getSettings();
  const apiKey = settings.gemini_api_key;

  if (!apiKey || apiKey.trim() === '') {
    return runSimulation(userMessage, chatHistory);
  }

  try {
    const { GoogleGenerativeAI } = require("@google/generative-ai");
    const genAI = new GoogleGenerativeAI(apiKey);

    // Initializing Gemini Model
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      systemInstruction: dbSchemaDescription + "\n\nSelalu berikan respons dalam Bahasa Indonesia yang profesional, ramah, dan solutif. Gunakan tabel markdown jika menyajikan data numerik agar rapi dan mudah dibaca.",
      tools: [{
        functionDeclarations: [{
          name: "run_read_only_query",
          description: "Execute a read-only SELECT SQL query on the SQLite database to fetch data about SE2026 monitoring.",
          parameters: {
            type: "OBJECT",
            properties: {
              query: {
                type: "STRING",
                description: "The SQLite query starting with SELECT. e.g. 'SELECT * FROM progres JOIN subsls_master ON ... LIMIT 5'"
              }
            },
            required: ["query"]
          }
        }]
      }]
    });

    // Translate chat history format to Gemini format
    const formattedHistory = [];
    
    // We only keep the last 10 messages to avoid context bloat
    const limitedHistory = chatHistory.slice(-10);
    limitedHistory.forEach(msg => {
      // Gemini roles must be 'user' or 'model'
      formattedHistory.push({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.content }]
      });
    });

    const chat = model.startChat({
      history: formattedHistory
    });

    let response = await chat.sendMessage(userMessage);
    let functionCalls = response.response.functionCalls;

    let loopCount = 0;
    // Execute function calling loops if the model requested database queries
    while (functionCalls && functionCalls.length > 0 && loopCount < 3) {
      loopCount++;
      const functionCall = functionCalls[0];
      if (functionCall.name === "run_read_only_query") {
        const query = functionCall.args.query;
        let queryResult;
        try {
          const data = executeQuery(query);
          queryResult = { status: "success", data: data };
        } catch (err) {
          queryResult = { status: "error", message: err.message };
        }

        // Send function result back to model
        response = await chat.sendMessage([{
          functionResponse: {
            name: "run_read_only_query",
            response: queryResult
          }
        }]);
        functionCalls = response.response.functionCalls;
      } else {
        break;
      }
    }

    return {
      role: 'model',
      content: response.response.text(),
      isSimulation: false
    };
  } catch (error) {
    console.error("Gemini AI API Error:", error);
    // Fallback to Simulation Mode if API Key is invalid or rate limit exceeded
    const simulated = runSimulation(userMessage, chatHistory);
    simulated.content = `⚠️ **Gemini API Error:** ${error.message}\n\n*Beralih sementara ke Mode Simulasi:*\n\n` + simulated.content;
    return simulated;
  }
}

module.exports = {
  sendMessageToAgent
};
