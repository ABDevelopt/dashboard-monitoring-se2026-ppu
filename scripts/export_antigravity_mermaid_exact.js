const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

async function exportAntigravityDiagrams() {
    console.log('='.repeat(80));
    console.log('🚀 EKSPOR DIAGRAM PERSIS TAMPILAN PREVIEW ANTIGRAVITY (MERMAID.JS ENGINE)');
    console.log('='.repeat(80));

    const htmlPath = path.resolve(__dirname, '../laporan/02_Phase_2_System_Design/EXPORT_DIAGRAM_ANTIGRAVITY_PREVIEW.html');
    const outputDir = path.resolve(__dirname, '../laporan/02_Phase_2_System_Design/diagrams_antigravity_export');

    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    console.log(`• Membaca HTML Render: ${htmlPath}`);
    console.log(`• Output Direktori    : ${outputDir}\n`);

    const chromePaths = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
    ];

    let executablePath = null;
    for (const p of chromePaths) {
        if (fs.existsSync(p)) {
            executablePath = p;
            break;
        }
    }

    console.log(`• Browser Engine     : ${executablePath || 'Bundled Chromium'}`);

    const browser = await puppeteer.launch({
        executablePath: executablePath || undefined,
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--window-size=2800,1800'
        ]
    });

    const names = [
        '01_system_context_diagram.png',
        '02_use_case_diagram.png',
        '03_dfd_level_1_diagram.png',
        '04_entity_relationship_diagram.png',
        '05_system_architecture_diagram.png',
        '06_activity_diagram_monitoring.png',
        '07_sequence_diagram_rag_ai.png'
    ];

    for (let i = 1; i <= 7; i++) {
        const outName = names[i - 1];
        const outPath = path.join(outputDir, outName);

        // Buka page baru per-diagram agar tidak ada state yang bocor
        const page = await browser.newPage();
        // Viewport besar untuk menampung semua diagram
        await page.setViewport({ width: 2800, height: 3600, deviceScaleFactor: 2 });

        process.stdout.write(`  [${i}/7] Render snapshot: ${outName} ... `);

        try {
            await page.goto('file://' + htmlPath, { waitUntil: 'domcontentloaded', timeout: 60000 });
            // Tunggu Mermaid.js selesai render
            await new Promise(r => setTimeout(r, 5000));

            // Gunakan JS untuk mendapatkan bounding rect dari container diagram
            const rect = await page.evaluate((diagId) => {
                const el = document.querySelector(diagId + ' .mermaid svg');
                if (!el) return null;
                const r = el.getBoundingClientRect();
                return {
                    x: Math.max(0, r.x - 10),
                    y: Math.max(0, r.y - 10),
                    width: r.width + 20,
                    height: r.height + 20
                };
            }, `#diag-${i}`);

            if (!rect) {
                console.log(`❌ Elemen #diag-${i} .mermaid svg tidak ditemukan`);
                await page.close();
                continue;
            }

            // Clip screenshot ke area diagram saja
            await page.screenshot({
                path: outPath,
                type: 'png',
                clip: {
                    x: rect.x,
                    y: rect.y,
                    width: Math.min(rect.width, 5600),
                    height: Math.min(rect.height, 7200)
                }
            });

            const stats = fs.statSync(outPath);
            console.log(`✅ SUKSES (${(stats.size / 1024).toFixed(1)} KB)`);
        } catch (err) {
            console.log(`❌ ERROR: ${err.message}`);
        } finally {
            await page.close();
        }
    }

    await browser.close();

    console.log('\n' + '='.repeat(80));
    console.log('✨ SELESAI: Seluruh 7 diagram telah diekspor persis sesuai render preview Google Antigravity!');
    console.log(`📁 Lokasi Berkas: ${outputDir}`);
    console.log('='.repeat(80));
}

exportAntigravityDiagrams().catch(err => {
    console.error('Fatal Error:', err);
    process.exit(1);
});
