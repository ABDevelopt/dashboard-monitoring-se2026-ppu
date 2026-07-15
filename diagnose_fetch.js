// Menjalankan tes fetch sederhana untuk menganalisis error di Dewaweb.
// Salin file ini ke server Dewaweb Anda, lalu jalankan: node diagnose_fetch.js

console.log("=== DIAGNOSIS NATIVE FETCH DI NODE.JS ===");
console.log("Node.js Version:", process.version);

// 1. Tes fetch standard
fetch('https://generativelanguage.googleapis.com/v1beta/models')
  .then(res => {
    console.log("✅ Fetch standar sukses! HTTP Status:", res.status);
  })
  .catch(err => {
    console.error("❌ Fetch standar GAGAL!");
    console.error(err);
    
    // Analisis tipe error
    if (err.cause) {
      console.error("\nError Cause:", err.cause);
    }
  });

// 2. Tes fetch dengan IPv4-first DNS resolution
const dns = require('dns');
if (typeof dns.setDefaultResultOrder === 'function') {
  dns.setDefaultResultOrder('ipv4first');
  fetch('https://generativelanguage.googleapis.com/v1beta/models')
    .then(res => {
      console.log("✅ Fetch (IPv4 First) sukses! HTTP Status:", res.status);
    })
    .catch(err => {
      console.error("❌ Fetch (IPv4 First) GAGAL!");
      console.error(err);
    });
} else {
  console.log("\nsetDefaultResultOrder tidak didukung pada versi Node.js ini.");
}
