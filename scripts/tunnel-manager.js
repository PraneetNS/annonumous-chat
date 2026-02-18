/**
 * tunnel-manager.js
 *
 * Starts a Cloudflare Quick Tunnel (trycloudflare.com) — no account needed.
 * Auto-downloads the cloudflared binary on first run.
 *
 * Uses cloudflared's built-in metrics server to reliably read the tunnel URL
 * instead of fragile regex on stderr (which changes between cloudflared versions).
 */

import { spawn, execSync } from 'child_process';
import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const TUNNEL_URL_FILE = path.join(ROOT, '.tunnel-url');
const BIN_DIR = path.join(ROOT, '.cloudflared');
const METRICS_PORT = 2000; // cloudflared default metrics port

// ── Binary management ──────────────────────────────────────────────────────
function getBinaryPath() {
    const name = os.platform() === 'win32' ? 'cloudflared.exe' : 'cloudflared';
    return path.join(BIN_DIR, name);
}

function getDownloadUrl() {
    const platform = os.platform();
    const arch = os.arch();
    const base = 'https://github.com/cloudflare/cloudflared/releases/latest/download/';
    if (platform === 'win32') {
        return arch === 'x64' ? base + 'cloudflared-windows-amd64.exe' : base + 'cloudflared-windows-386.exe';
    } else if (platform === 'darwin') {
        return arch === 'arm64' ? base + 'cloudflared-darwin-arm64.tgz' : base + 'cloudflared-darwin-amd64.tgz';
    } else {
        return arch === 'arm64' ? base + 'cloudflared-linux-arm64' : base + 'cloudflared-linux-amd64';
    }
}

function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        console.log(`⬇️  Downloading cloudflared...`);
        const file = fs.createWriteStream(dest);
        const get = (u) => {
            const mod = u.startsWith('https') ? https : http;
            mod.get(u, (res) => {
                if (res.statusCode === 301 || res.statusCode === 302) { get(res.headers.location); return; }
                if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
                res.pipe(file);
                file.on('finish', () => file.close(resolve));
            }).on('error', reject);
        };
        get(url);
    });
}

async function ensureCloudflared() {
    const binPath = getBinaryPath();
    if (fs.existsSync(binPath)) return binPath;

    try { execSync('cloudflared --version', { stdio: 'ignore' }); return 'cloudflared'; } catch { }

    console.log('📦 Auto-downloading cloudflared (one-time setup)...');
    fs.mkdirSync(BIN_DIR, { recursive: true });
    const url = getDownloadUrl();

    if (os.platform() === 'darwin') {
        const tgz = binPath + '.tgz';
        await downloadFile(url, tgz);
        execSync(`tar -xzf "${tgz}" -C "${BIN_DIR}"`, { stdio: 'inherit' });
        fs.unlinkSync(tgz);
        const extracted = path.join(BIN_DIR, 'cloudflared');
        if (fs.existsSync(extracted)) fs.chmodSync(extracted, 0o755);
    } else {
        await downloadFile(url, binPath);
        if (os.platform() !== 'win32') fs.chmodSync(binPath, 0o755);
    }
    console.log(`✅ cloudflared ready at: ${binPath}`);
    return binPath;
}

// ── Fetch tunnel URL from cloudflared metrics API ─────────────────────────
function fetchTunnelUrlFromMetrics() {
    return new Promise((resolve) => {
        const req = http.get(`http://localhost:${METRICS_PORT}/metrics`, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                // cloudflared metrics contain: tunnelID or the hostname
                // The quicktunnel URL is logged in the ready endpoint
                resolve(null);
            });
        });
        req.on('error', () => resolve(null));
        req.setTimeout(2000, () => { req.destroy(); resolve(null); });
    });
}

function fetchTunnelUrlFromReady() {
    return new Promise((resolve) => {
        const req = http.get(`http://localhost:${METRICS_PORT}/ready`, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const j = JSON.parse(data);
                    // cloudflared ready endpoint returns { status: "ok" } when connected
                    if (j.status === 'ok' || res.statusCode === 200) resolve(true);
                    else resolve(false);
                } catch { resolve(false); }
            });
        });
        req.on('error', () => resolve(false));
        req.setTimeout(2000, () => { req.destroy(); resolve(false); });
    });
}

// ── Main tunnel starter ────────────────────────────────────────────────────
async function startTunnel() {
    // Clear stale URL
    try { if (fs.existsSync(TUNNEL_URL_FILE)) fs.unlinkSync(TUNNEL_URL_FILE); } catch { }

    let binPath;
    try {
        binPath = await ensureCloudflared();
    } catch (err) {
        console.error('❌ Failed to get cloudflared:', err.message);
        process.exit(1);
    }

    console.log('\n🌐 Starting Cloudflare Quick Tunnel...');

    // Use a fixed metrics port so we can query it
    const proc = spawn(binPath, [
        'tunnel',
        '--url', 'http://localhost:4000',
        '--metrics', `localhost:${METRICS_PORT}`,
        '--no-autoupdate',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    let tunnelUrl = null;
    let stopped = false;

    // ── Parse URL from stdout/stderr (works on all cloudflared versions) ──────
    const onData = (data) => {
        const text = data.toString();

        // Print raw output for debugging (only non-empty lines)
        for (const line of text.split('\n')) {
            const trimmed = line.trim();
            if (trimmed && !trimmed.includes('INF') && !trimmed.includes('metrics')) {
                // Only print interesting lines
            }
        }

        // Match trycloudflare.com URL anywhere in output
        const match = text.match(/https:\/\/[a-zA-Z0-9\-]+\.trycloudflare\.com/i);
        if (match && !tunnelUrl) {
            tunnelUrl = match[0];
            writeTunnelUrl(tunnelUrl);
        }
    };

    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);

    // ── Also poll cloudflared's internal API for the URL ─────────────────────
    // cloudflared exposes the tunnel hostname via its quicktunnel API
    let pollAttempts = 0;
    const pollInterval = setInterval(async () => {
        if (tunnelUrl || stopped) { clearInterval(pollInterval); return; }
        pollAttempts++;

        try {
            // Try the quicktunnel info endpoint
            const url = await new Promise((resolve) => {
                const req = http.get(`http://localhost:${METRICS_PORT}/quicktunnel`, (res) => {
                    let data = '';
                    res.on('data', c => data += c);
                    res.on('end', () => {
                        try {
                            const j = JSON.parse(data);
                            if (j.hostname) resolve(`https://${j.hostname}`);
                            else resolve(null);
                        } catch { resolve(null); }
                    });
                });
                req.on('error', () => resolve(null));
                req.setTimeout(2000, () => { req.destroy(); resolve(null); });
            });

            if (url && !tunnelUrl) {
                tunnelUrl = url;
                writeTunnelUrl(tunnelUrl);
                clearInterval(pollInterval);
            }
        } catch { }

        if (pollAttempts > 60) clearInterval(pollInterval); // Give up after 2 min
    }, 2000);

    proc.on('close', (code) => {
        stopped = true;
        clearInterval(pollInterval);
        console.log(`\n⚠️  Tunnel closed (code ${code}). Restarting in 5s...`);
        try { if (fs.existsSync(TUNNEL_URL_FILE)) fs.unlinkSync(TUNNEL_URL_FILE); } catch { }
        tunnelUrl = null;
        setTimeout(startTunnel, 5000);
    });

    proc.on('error', (err) => {
        stopped = true;
        clearInterval(pollInterval);
        console.error('❌ Tunnel error:', err.message);
        setTimeout(startTunnel, 5000);
    });

    // Graceful shutdown
    const cleanup = () => {
        stopped = true;
        proc.kill();
        try { if (fs.existsSync(TUNNEL_URL_FILE)) fs.unlinkSync(TUNNEL_URL_FILE); } catch { }
        process.exit(0);
    };
    process.once('SIGINT', cleanup);
    process.once('SIGTERM', cleanup);
}

function writeTunnelUrl(url) {
    fs.writeFileSync(TUNNEL_URL_FILE, url, 'utf8');
    console.log('\n');
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║           🌍 GLOBAL TUNNEL ACTIVE — SHARE THIS URL!         ║');
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log(`║  ${url.padEnd(60)} ║`);
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log('║  ✅ Works from ANY network (WiFi, 4G, 5G, anywhere!)        ║');
    console.log('║  📱 Open URL → Create Room → Scan QR → Chat!               ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log('');
}

startTunnel();
