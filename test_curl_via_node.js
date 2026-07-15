const { exec } = require('child_process');

console.log("=== MENCOBA EXEC CURL LEWAT NODE.JS ===");

exec('curl -i -s https://generativelanguage.googleapis.com/v1beta/models', (err, stdout, stderr) => {
  if (err) {
    console.error("❌ Exec curl GAGAL:", err.message);
    console.error(stderr);
    return;
  }
  
  console.log("✅ Exec curl SUKSES!");
  console.log("Output Header (10 baris pertama):");
  console.log(stdout.split('\n').slice(0, 10).join('\n'));
});
