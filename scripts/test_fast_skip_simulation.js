const assert = require('assert');
const llmGateway = require('../services/ai/llmGateway');
const orchestrator = require('../services/ai/orchestrator');

console.log('======================================================================');
console.log('🧪 PENGUJIAN FAST-SKIP 404 END-TO-END PADA ORCHESTRATOR');
console.log('======================================================================\n');

async function testFastSkip() {
  const originalSend = llmGateway.sendMessageToGemini;
  const originalStream = llmGateway.streamMessageToGemini;

  const attemptedCalls = [];

  // Mock sendMessageToGemini:
  // Jika model gemini-3.8-flash -> lempar 404 (model not found)
  // Jika model gemini-3.7-flash -> sukses
  llmGateway.sendMessageToGemini = async (msg, history, settings, model, signal, apiKey, instruction, ctx) => {
    attemptedCalls.push({ type: 'send', model, apiKey: apiKey ? apiKey.slice(-4) : 'none' });
    if (model === 'gemini-3.8-flash') {
      throw new Error('models/gemini-3.8-flash is not found for API version v1beta');
    }
    return {
      role: 'model',
      content: `Sukses menjawab menggunakan ${model}`,
      isSimulation: false
    };
  };

  // Jalankan sendMessageToAgent dengan options model default 3.8
  console.log('1. Menguji Fast-Skip pada sendMessageToAgent...');
  attemptedCalls.length = 0;
  const result = await orchestrator.sendMessageToAgent(
    'Berapa progres sensus?',
    [],
    { surveyId: 'se2026' }
  );

  console.log('   Panggilan yang terjadi:', JSON.stringify(attemptedCalls));
  console.log('   Hasil konten:', result.content);

  // Verifikasi: model 3.8 HANYA dipanggil 1 kali (fast-skip langsung mengabaikan key ke-2)
  const callsTo38 = attemptedCalls.filter(c => c.model === 'gemini-3.8-flash');
  assert.strictEqual(callsTo38.length, 1, 'Model 3.8 harus langsung di-skip setelah 1 kali 404 (tidak mencoba key berikutnya)');
  
  // Verifikasi: model berikutnya yang dicoba adalah 3.7
  const callsTo37 = attemptedCalls.filter(c => c.model === 'gemini-3.7-flash');
  assert.ok(callsTo37.length >= 1, 'Model 3.7 harus dicoba setelah 3.8 di-fast-skip');
  assert.ok(result.content.includes('gemini-3.7-flash'), 'Hasil akhir harus berasal dari gemini-3.7-flash');
  assert.strictEqual(result.model, 'gemini-3.7-flash', 'Properti result.model harus gemini-3.7-flash');
  console.log('   ✔ PASS Fast-skip sendMessageToAgent terverifikasi!\n');

  // 2. Menguji streamMessageToAgent
  console.log('2. Menguji Fast-Skip pada streamMessageToAgent...');
  const streamAttempts = [];
  llmGateway.streamMessageToGemini = async (msg, history, settings, model, signal, apiKey, onEvent, instruction, ctx) => {
    streamAttempts.push({ type: 'stream', model, apiKey: apiKey ? apiKey.slice(-4) : 'none' });
    if (model === 'gemini-3.8-flash') {
      throw new Error("The model 'gemini-3.8-flash' does not exist");
    }
    onEvent('chunk', { text: `Sukses streaming ${model}` });
    return {
      role: 'model',
      content: `Sukses streaming ${model}`,
      isSimulation: false
    };
  };

  const streamEvents = [];
  const streamResult = await orchestrator.streamMessageToAgent(
    'Bagaimana progres sensus?',
    [],
    { surveyId: 'se2026' },
    (event, data) => streamEvents.push({ event, data })
  );

  console.log('   Panggilan stream yang terjadi:', JSON.stringify(streamAttempts));
  console.log('   Event status:', streamEvents.filter(e => e.event === 'status').map(e => e.data.text));

  const streamCallsTo38 = streamAttempts.filter(c => c.model === 'gemini-3.8-flash');
  assert.strictEqual(streamCallsTo38.length, 1, 'Stream model 3.8 harus langsung di-fast-skip');
  const streamCallsTo37 = streamAttempts.filter(c => c.model === 'gemini-3.7-flash');
  assert.ok(streamCallsTo37.length >= 1, 'Stream harus berhasil beralih ke 3.7');
  assert.ok(streamResult.content.includes('gemini-3.7-flash'), 'Hasil stream akhir harus dari gemini-3.7-flash');
  assert.strictEqual(streamResult.model, 'gemini-3.7-flash', 'Properti streamResult.model harus gemini-3.7-flash');
  console.log('   ✔ PASS Fast-skip streamMessageToAgent terverifikasi!\n');

  // Restore originals
  llmGateway.sendMessageToGemini = originalSend;
  llmGateway.streamMessageToGemini = originalStream;

  // 3. Menguji callGeminiDirect (AI Insights)
  console.log('3. Menguji Fast-Skip pada callGeminiDirect (AI Insights)...');
  const apiRouter = require('../routes/api');
  const originalFetch = global.fetch;
  const insightsAttempts = [];

  global.fetch = async (url, opts) => {
    insightsAttempts.push(url);
    if (url.includes('gemini-3.8-flash')) {
      return {
        ok: false,
        status: 404,
        text: async () => JSON.stringify({ error: { message: 'models/gemini-3.8-flash is not found for API version v1beta' } })
      };
    }
    if (url.includes('gemini-3.7-flash')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: 'Sukses analisis AI Insights via 3.7' }] } }]
        })
      };
    }
    throw new Error('Unexpected URL: ' + url);
  };

  try {
    const insightText = await apiRouter.callGeminiDirect('Analisis data ringkas', {
      gemini_api_key: 'AIzaSyKeyUtama',
      gemini_backup_api_keys: JSON.stringify(['AIzaSyKeyCadangan']),
      gemini_model: 'gemini-3.8-flash'
    });

    console.log('   Panggilan AI Insights URL:', insightsAttempts);
    console.log('   Hasil insight:', insightText);

    const insightCallsTo38 = insightsAttempts.filter(u => u.includes('gemini-3.8-flash'));
    assert.strictEqual(insightCallsTo38.length, 1, 'AI Insights model 3.8 harus di-fast-skip setelah 1 kali 404');
    const insightCallsTo37 = insightsAttempts.filter(u => u.includes('gemini-3.7-flash'));
    assert.strictEqual(insightCallsTo37.length, 1, 'AI Insights harus berhasil beralih ke 3.7');
    assert.strictEqual(insightText, 'Sukses analisis AI Insights via 3.7');
    console.log('   ✔ PASS Fast-skip callGeminiDirect terverifikasi!\n');
  } finally {
    global.fetch = originalFetch;
  }

  // 4. Menguji Custom Model Fallback Chain turun hingga gemini-3.5-flash (5 level)
  console.log('4. Menguji Downward Fallback Chain dari custom model hingga mencapai gemini-3.5-flash...');
  const deepAttempts = [];
  llmGateway.sendMessageToGemini = async (msg, history, settings, model, signal, apiKey, instruction, ctx) => {
    deepAttempts.push(model);
    if (model !== 'gemini-3.5-flash') {
      const err = new Error('Model unavailable');
      err.status = 404; // Menguji status code 404 pada objek Error
      throw err;
    }
    return {
      role: 'model',
      content: `Sukses dari ${model}`,
      isSimulation: false
    };
  };

  const realDb = require('../database').getDb('se2026');
  realDb.prepare("UPDATE settings SET value = 'gemini-exp-custom, gemini-3.8-flash, gemini-3.7-flash, gemini-3.6-flash, gemini-3.5-flash' WHERE key = 'gemini_models_list'").run();
  realDb.prepare("UPDATE settings SET value = 'gemini-exp-custom' WHERE key = 'gemini_model'").run();

  try {
    const deepResult = await orchestrator.sendMessageToAgent(
      'Uji rantai dalam sampai 3.5',
      [],
      { surveyId: 'se2026', model: 'gemini-exp-custom' }
    );
    console.log('   Model yang dicoba secara berurutan:', deepAttempts);
    console.log('   Hasil akhir model:', deepResult.model);
    assert.strictEqual(deepResult.model, 'gemini-3.5-flash', 'Rantai harus mencapai gemini-3.5-flash!');
    assert.deepStrictEqual(deepAttempts, [
      'gemini-exp-custom',
      'gemini-3.8-flash',
      'gemini-3.7-flash',
      'gemini-3.6-flash',
      'gemini-3.5-flash'
    ], 'Harus mencoba custom -> 3.8 -> 3.7 -> 3.6 -> 3.5 secara berurutan');
    console.log('   ✔ PASS Penjangkauan gemini-3.5-flash pada rantai 5 tingkat terverifikasi!\n');
  } finally {
    realDb.prepare("UPDATE settings SET value = 'gemini-3.8-flash, gemini-3.7-flash, gemini-3.6-flash, gemini-3.5-flash' WHERE key = 'gemini_models_list'").run();
    realDb.prepare("UPDATE settings SET value = 'gemini-3.8-flash' WHERE key = 'gemini_model'").run();
    llmGateway.sendMessageToGemini = originalSend;
  }

  console.log('======================================================================');
  console.log('🎉 SELURUH PENGUJIAN FAST-SKIP 404 BERHASIL 100%');
  console.log('======================================================================');
}

testFastSkip().catch(err => {
  console.error('❌ Error pengujian:', err);
  process.exit(1);
});
