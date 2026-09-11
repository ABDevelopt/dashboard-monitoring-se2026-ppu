const assert = require('assert');

console.log('======================================================================');
console.log('MENJALANKAN PENGUJIAN VERIFIKASI MANDIRI GEMINI 3.8 FLASH & FALLBACK');
console.log('======================================================================\n');

// 1. LLM Gateway Constants & Model Resolution
console.log('Suite 1: LLM Gateway Constants & Model Resolution');
const llmGateway = require('../services/ai/llmGateway');

assert.strictEqual(llmGateway.GEMINI_DEFAULT_MODEL, 'gemini-3.8-flash', 'Default model harus gemini-3.8-flash');
// task #8: gemini-2.5-flash dipromosi dari legacy ke aktif
assert.ok(!llmGateway.LEGACY_GEMINI_MODELS.has('gemini-2.5-flash'), 'gemini-2.5-flash TIDAK BOLEH lagi dianggap legacy (task #8)');
assert.ok(llmGateway.LEGACY_GEMINI_MODELS.has('gemini-2.5-pro'), 'gemini-2.5-pro harus legacy');
assert.ok(llmGateway.LEGACY_GEMINI_MODELS.has('gemini-3.1-flash-lite'), 'gemini-3.1-flash-lite harus legacy');
assert.ok(llmGateway.LEGACY_GEMINI_MODELS.has('gemini-3.5-flash-lite'), 'gemini-3.5-flash-lite harus legacy');
assert.ok(!llmGateway.LEGACY_GEMINI_MODELS.has('gemini-3.5-flash'), 'gemini-3.5-flash TIDAK boleh dianggap legacy');
assert.ok(!llmGateway.LEGACY_GEMINI_MODELS.has('gemini-3.8-flash'), 'gemini-3.8-flash bukan legacy');

const allowed = llmGateway.getAllowedModels('gemini', {});
assert.deepStrictEqual(allowed, ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash'], 'Default allowed models harus [3.8, 3.7, 3.6, 3.5]');

// Resolve Agent Selection tests
const resDefault = llmGateway.resolveAgentSelection({});
assert.strictEqual(resDefault.model, 'gemini-3.8-flash', 'Default fallback resolve harus 3.8');

// task #8: gemini-2.5-flash bukan lagi legacy — tetapi karena tidak ada di allowedModels default, fallback ke 3.8
const resLegacy = llmGateway.resolveAgentSelection({}, { model: 'gemini-2.5-flash' });
assert.strictEqual(resLegacy.model, 'gemini-3.8-flash', 'gemini-2.5-flash tidak ada di allowedModels default → fallback ke 3.8 (bukan karena legacy, tapi karena not in list)');

const resExplicit35 = llmGateway.resolveAgentSelection({}, { model: 'gemini-3.5-flash' });
assert.strictEqual(resExplicit35.model, 'gemini-3.5-flash', 'Model 3.5 flash yang valid harus diterima');
console.log('   ✔ PASS Suite 1 Lulus Semua Assertions\n');

// 2. Downward Fallback Chain Logic & Edge Cases
console.log('Suite 2: Strict Downward Fallback Chain Logic');
const orchestrator = require('../services/ai/orchestrator');
const { getDownwardFallbackChain, isModelNotFoundError } = orchestrator;

// task #8: gemini-2.5-flash ditambahkan ke STANDARD_DOWNWARD_CHAIN sebagai tail fallback
const chain38 = getDownwardFallbackChain('gemini-3.8-flash');
assert.deepStrictEqual(chain38, ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-2.5-flash']);

const chain37 = getDownwardFallbackChain('gemini-3.7-flash');
assert.deepStrictEqual(chain37, ['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-2.5-flash']);

const chain36 = getDownwardFallbackChain('gemini-3.6-flash');
assert.deepStrictEqual(chain36, ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-2.5-flash']);

const chain35 = getDownwardFallbackChain('gemini-3.5-flash');
assert.deepStrictEqual(chain35, ['gemini-3.5-flash', 'gemini-2.5-flash']);

// task #8: gemini-2.5-flash bukan lagi legacy — dimulai dari posisinya di chain (indeks 4)
const chainLegacy = getDownwardFallbackChain('gemini-2.5-flash');
assert.deepStrictEqual(chainLegacy, ['gemini-2.5-flash'], 'gemini-2.5-flash sekarang memulai chain dari posisinya (task #8)');

const chainLegacyList = getDownwardFallbackChain('gemini-3.8-flash', 'gemini-2.5-flash, gemini-3.6-flash');
// task #8: gemini-2.5-flash bukan legacy lagi, jadi tidak disaring; hanya 3.8 (target) + 3.6 + 2.5 yang lolos
assert.deepStrictEqual(chainLegacyList, ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-2.5-flash'], 'Daftar pilihan: target+3.6+2.5 (task #8)');

const chainWhitespace = getDownwardFallbackChain('   ');
assert.deepStrictEqual(chainWhitespace, ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-2.5-flash'], 'Whitespace targetModel harus default ke 3.8');

const chainPreserve = getDownwardFallbackChain('gemini-3.7-flash', 'gemini-3.5-flash');
assert.deepStrictEqual(chainPreserve, ['gemini-3.7-flash', 'gemini-3.5-flash'], 'Target model terpilih harus tetap di posisi pertama');

const chainCustom = getDownwardFallbackChain('gemini-exp-1206');
assert.deepStrictEqual(chainCustom, ['gemini-exp-1206', 'gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-2.5-flash']);
console.log('   ✔ PASS Suite 2 Lulus Semua Assertions\n');

// 3. Fast-Skip 404 / Model Not Found Error Detection
console.log('Suite 3: 404 & Model Not Found Fast-Skip Error Detection');

assert.strictEqual(isModelNotFoundError('', 404), true, 'HTTP status 404 harus terdeteksi');
assert.strictEqual(isModelNotFoundError('Custom error without status keyword', 404), true, 'Status code 404 harus terdeteksi');
assert.strictEqual(isModelNotFoundError('models/gemini-3.8-flash is not found for API version v1beta'), true, 'Not found harus terdeteksi');
assert.strictEqual(isModelNotFoundError('Model is not supported for generateContent'), true, 'Not supported harus terdeteksi');
assert.strictEqual(isModelNotFoundError("The model 'gemini-3.8-flash' does not exist"), true, 'Does not exist harus terdeteksi');
assert.strictEqual(isModelNotFoundError('Unknown model gemini-3.8-flash'), true, 'Unknown model harus terdeteksi');
assert.strictEqual(isModelNotFoundError('Resource has been exhausted (e.g. check quota). 429 Too Many Requests'), false, '429 Rate limit BUKAN not found error');
assert.strictEqual(isModelNotFoundError('API key not valid. Please pass a valid API key. (403)'), false, '403 Invalid key BUKAN not found error');
assert.strictEqual(isModelNotFoundError('The service is temporarily unavailable (503)'), false, '503 BUKAN not found error');
console.log('   ✔ PASS Suite 3 Lulus Semua Assertions\n');

// 4. Database Migration & Idempotency
console.log('Suite 4: Database Migration, Preservation of gemini-3.5-flash & Custom Lists on Reboot');
const dbModule = require('../database');
const realDb = dbModule.getDb('se2026');

const settingsSe = dbModule.getSettings('se2026');
assert.strictEqual(settingsSe.gemini_model, 'gemini-3.8-flash', 'SE2026 gemini_model harus gemini-3.8-flash');
assert.ok(settingsSe.gemini_models_list.includes('gemini-3.8-flash'), 'SE2026 gemini_models_list harus mencakup gemini-3.8-flash');

// Uji preservasi pada saat restart jika user memilih gemini-3.5-flash DAN kustom list tanpa 3.8
realDb.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('gemini_v38_migrated', '1')").run();
realDb.prepare("UPDATE settings SET value = 'gemini-3.7-flash, gemini-3.5-flash' WHERE key = 'gemini_models_list'").run();
realDb.prepare("UPDATE settings SET value = 'gemini-3.5-flash' WHERE key = 'gemini_model'").run();

// Simulasikan reboot server
dbModule.reloadDbConnection('se2026');

const rebootSettings = dbModule.getSettings('se2026');
assert.strictEqual(rebootSettings.gemini_model, 'gemini-3.5-flash', 'Pilihan pengguna gemini-3.5-flash TIDAK boleh ditimpa saat reboot!');
assert.strictEqual(rebootSettings.gemini_models_list, 'gemini-3.7-flash, gemini-3.5-flash', 'Daftar custom tanpa gemini-3.8-flash TIDAK boleh ditimpa saat reboot!');

// Kembalikan ke default 3.8
const restoreDb = dbModule.getDb('se2026');
restoreDb.prepare("UPDATE settings SET value = 'gemini-3.8-flash, gemini-3.7-flash, gemini-3.6-flash, gemini-3.5-flash' WHERE key = 'gemini_models_list'").run();
restoreDb.prepare("UPDATE settings SET value = 'gemini-3.8-flash' WHERE key = 'gemini_model'").run();
console.log('   ✔ PASS Suite 4 Lulus Semua Assertions (Preservasi gemini-3.5-flash & custom list saat reboot terverifikasi)\n');

// 5. KeyPool & Diagnostics Fallback
console.log('Suite 5: KeyPool Default Model & Diagnostics');
const keyPool = require('../services/ai/keyPool');

keyPool.testAllGeminiKeys({}).then(res => {
  assert.strictEqual(res.modelUsed, 'gemini-3.8-flash', 'testAllGeminiKeys default model harus gemini-3.8-flash');
  console.log('   ✔ PASS Suite 5 Lulus Semua Assertions\n');
  console.log('======================================================================');
  console.log('🎉 SELURUH PENGUJIAN UNIT & INTEGRASI GEMINI 3.8 FLASH BERHASIL 100%');
  console.log('======================================================================');
}).catch(err => {
  console.error('GAGAL pada Suite 5:', err);
  process.exit(1);
});
