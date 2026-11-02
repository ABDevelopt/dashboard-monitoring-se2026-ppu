'use strict';
// ─────────────────────────────────────────────────────────────────────────────
//  routes/deployWebhook.js
//  GitHub Auto-Deploy Webhook Handler untuk Server Dewaweb (cPanel/Node.js)
// ─────────────────────────────────────────────────────────────────────────────

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const logger = require('../services/logger');

let isDeploying = false;
let lastDeployTime = null;
let lastDeployResult = null;

// Helper: Verifikasi Signature GitHub Webhook (HMAC-SHA256)
function verifyGitHubSignature(req, secret) {
  const signature = req.headers['x-hub-signature-256'];
  if (!signature || !secret) return false;

  try {
    const rawBody = typeof req.body === 'string' 
      ? req.body 
      : (req.rawBody || JSON.stringify(req.body));
    const hmac = crypto.createHmac('sha256', secret);
    const digest = 'sha256=' + hmac.update(rawBody).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest));
  } catch (err) {
    logger.warn(`[DEPLOY-WEBHOOK] Gagal memverifikasi signature: ${err.message}`);
    return false;
  }
}

// GET /api/deploy-webhook/status — Cek status deploy terakhir
router.get('/status', (req, res) => {
  return res.json({
    success: true,
    isDeploying,
    lastDeployTime,
    lastDeployResult: lastDeployResult ? {
      timestamp: lastDeployResult.timestamp,
      success: lastDeployResult.success,
      commit: lastDeployResult.commit,
      output: lastDeployResult.output
    } : null
  });
});

// POST /api/deploy-webhook — Endpoint penampung Webhook GitHub
router.post('/', (req, res) => {
  const webhookSecret = process.env.DEPLOY_WEBHOOK_SECRET || process.env.DEPLOY_SECRET || 'dewaweb_auto_deploy_secret_2026';
  const tokenHeader = req.headers['x-deploy-token'] || req.headers['authorization'];
  const tokenQuery = req.query.secret || req.query.token;

  // Autentikasi: via GitHub HMAC signature ATAU Token Secret
  const isSigValid = verifyGitHubSignature(req, webhookSecret);
  const isTokenValid = (tokenQuery === webhookSecret) || 
                       (tokenHeader && tokenHeader.replace(/^Bearer\s+/i, '').trim() === webhookSecret);

  if (!isSigValid && !isTokenValid) {
    logger.warn(`[DEPLOY-WEBHOOK] Upaya deploy ditolak: kredensial tidak valid (IP: ${req.ip})`);
    return res.status(403).json({
      success: false,
      error: 'Akses ditolak. Signature GitHub atau token otorisasi tidak valid.'
    });
  }

  // Cek apakah event GitHub adalah push (jika header x-github-event ada)
  const githubEvent = req.headers['x-github-event'];
  if (githubEvent && githubEvent !== 'push' && githubEvent !== 'ping') {
    logger.info(`[DEPLOY-WEBHOOK] Mengabaikan event non-push: ${githubEvent}`);
    return res.json({ success: true, message: `Event [${githubEvent}] diabaikan (hanya memproses event push).` });
  }

  if (githubEvent === 'ping') {
    logger.info('[DEPLOY-WEBHOOK] Menerima ping test dari GitHub.');
    return res.json({ success: true, message: 'Pong! Webhook terhubung dengan sukses ke server Dewaweb.' });
  }

  // Cegah eksekusi tumpuk jika sedang berjalan
  if (isDeploying) {
    return res.status(429).json({
      success: false,
      error: 'Proses auto-deployment lain sedang berlangsung. Silakan tunggu beberapa detik.'
    });
  }

  isDeploying = true;
  const projectRoot = path.join(__dirname, '..');
  logger.info(`[DEPLOY-WEBHOOK] 🚀 Memulai eksekusi git pull di: ${projectRoot}`);

  // Eksekusi asinkron: git pull origin master && touch tmp/restart.txt
  const command = process.platform === 'win32'
    ? 'git pull origin master'
    : 'git pull origin master && (npm install --omit=dev --no-audit --prefer-offline 2>&1 || true) && mkdir -p tmp && touch tmp/restart.txt';

  exec(command, { cwd: projectRoot, timeout: 60000 }, (error, stdout, stderr) => {
    isDeploying = false;
    lastDeployTime = new Date().toISOString();

    const outputLog = (stdout || '') + (stderr || '');
    const isSuccess = !error;

    // Ambil info commit terbaru
    exec('git log -1 --oneline', { cwd: projectRoot }, (_, gitLogOut) => {
      const activeCommit = (gitLogOut || '').trim();

      lastDeployResult = {
        timestamp: lastDeployTime,
        success: isSuccess,
        commit: activeCommit,
        output: outputLog.slice(0, 1000)
      };

      if (isSuccess) {
        logger.info(`[DEPLOY-WEBHOOK] ✅ Auto-deploy berhasil! Commit aktif: ${activeCommit}`);
      } else {
        logger.error(`[DEPLOY-WEBHOOK] ❌ Auto-deploy gagal: ${error.message}\nOutput: ${outputLog}`);
      }
    });
  });

  // Segera kembalikan respons 200 OK ke GitHub agar webhook tidak timeout
  return res.status(202).json({
    success: true,
    message: 'Auto-deployment berhasil diterima dan sedang diproses di background server.',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
