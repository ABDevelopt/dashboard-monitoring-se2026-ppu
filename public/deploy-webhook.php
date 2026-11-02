<?php
/**
 * Standalone Auto-Deploy Webhook Handler (PHP Fallback)
 * Dirancang khusus untuk cPanel Dewaweb / CloudLinux / LiteSpeed
 * Mendukung GitHub Webhook Signature (HMAC SHA-256) & Direct Secret Token
 */

header('Content-Type: application/json; charset=UTF-8');

// Konfigurasi rahasia (dapat diset via env cPanel atau fallback)
$secret = getenv('DEPLOY_WEBHOOK_SECRET') ?: 'dewaweb_auto_deploy_secret_2026';

// 1. Ambil payload mentah
$rawPayload = file_get_contents('php://input');
$headers = getallheaders();

// 2. Verifikasi Autentikasi
$hubSignature = $headers['X-Hub-Signature-256'] ?? $headers['x-hub-signature-256'] ?? '';
$authHeader = $headers['Authorization'] ?? $headers['authorization'] ?? '';
$queryToken = $_GET['secret'] ?? $_GET['token'] ?? '';

$isAuthenticated = false;

// Cek GitHub HMAC Signature
if (!empty($hubSignature) && !empty($secret)) {
    $expectedSignature = 'sha256=' . hash_hmac('sha256', $rawPayload, $secret);
    if (hash_equals($expectedSignature, $hubSignature)) {
        $isAuthenticated = true;
    }
}

// Cek Token via Query string atau Header
if (!$isAuthenticated && (!empty($queryToken) || !empty($authHeader))) {
    $cleanToken = !empty($queryToken) ? $queryToken : trim(preg_replace('/^Bearer\s+/i', '', $authHeader));
    if (hash_equals($secret, $cleanToken)) {
        $isAuthenticated = true;
    }
}

if (!$isAuthenticated) {
    http_response_code(403);
    echo json_encode([
        'success' => false,
        'error' => 'Akses ditolak. Signature GitHub atau token rahasia tidak valid.'
    ]);
    exit;
}

// 3. Tangani GitHub ping event
$githubEvent = $headers['X-GitHub-Event'] ?? $headers['x-github-event'] ?? '';
if ($githubEvent === 'ping') {
    echo json_encode([
        'success' => true,
        'message' => 'Pong! Webhook PHP berhasil terhubung ke server Dewaweb.'
    ]);
    exit;
}

// 4. Direktori Aplikasi
$appDir = dirname(__DIR__); // Satu tingkat di atas folder public
chdir($appDir);

// 5. Eksekusi Perintah Deployment
$commands = [
    'git fetch origin master 2>&1',
    'git reset --hard origin/master 2>&1',
    'npm install --omit=dev --no-audit --prefer-offline 2>&1',
    'mkdir -p tmp 2>&1',
    'touch tmp/restart.txt 2>&1'
];

$output = [];
foreach ($commands as $cmd) {
    exec($cmd, $cmdOutput, $returnCode);
    $output[] = [
        'command' => $cmd,
        'return_code' => $returnCode,
        'output' => implode("\n", $cmdOutput)
    ];
    $cmdOutput = [];
}

// Ambil commit aktif
$lastCommit = exec('git log -1 --oneline');

echo json_encode([
    'success' => true,
    'message' => 'Auto-deployment PHP berhasil dieksekusi.',
    'commit' => $lastCommit,
    'timestamp' => date('Y-m-d H:i:s'),
    'details' => $output
]);
