// Menjalankan diagnosis proxy di Dewaweb.
// Salin ke Dewaweb, lalu jalankan: node diagnose_proxy.js

console.log("=== DIAGNOSIS PROXY DI SERVER ===");
console.log("HTTP_PROXY:", process.env.HTTP_PROXY || process.env.http_proxy || "KOSONG");
console.log("HTTPS_PROXY:", process.env.HTTPS_PROXY || process.env.https_proxy || "KOSONG");

const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;

if (proxyUrl) {
  console.log(`\nMenemukan proxy: ${proxyUrl}. Mencoba melakukan fetch melewati proxy...`);
  
  // Menggunakan library https-proxy-agent jika terpasang, atau undici ProxyAgent
  try {
    const { ProxyAgent } = require('undici');
    const agent = new ProxyAgent(proxyUrl);
    
    fetch('https://generativelanguage.googleapis.com/v1beta/models', { dispatcher: agent })
      .then(res => {
        console.log("✅ Sukses fetch lewat undici ProxyAgent! HTTP Status:", res.status);
      })
      .catch(err => {
        console.error("❌ Gagal fetch lewat undici ProxyAgent:", err.message);
      });
  } catch (e) {
    console.log("undici ProxyAgent tidak tersedia atau gagal dibuat:", e.message);
  }
} else {
  console.log("\nTidak ada proxy sistem (http_proxy/https_proxy) yang terdeteksi di Node.js process.env.");
  console.log("Jika Anda menggunakan proxy di terminal, kemungkinan ia didefinisikan secara khusus di ~/.bashrc atau ~/.bash_profile sebagai alias atau hanya berlaku untuk curl.");
}
