process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import http from 'http';
import https from 'https';
import httpProxy from 'http-proxy';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');

// ── SSL certs ─────────────────────────────────────────────────────────────────
const certDir = path.join(__dirname, '..', 'server', 'certs');
const sslOptions = {
    key: fs.readFileSync(path.join(certDir, 'key.pem')),
    cert: fs.readFileSync(path.join(certDir, 'cert.pem'))
};

// ── Proxy ─────────────────────────────────────────────────────────────────────
const proxy = httpProxy.createProxyServer({
    secure: false,
    ws: true,
    changeOrigin: true,
    // Timeout upstream requests after 30s to prevent hanging connections
    proxyTimeout: 30_000,
    timeout: 30_000,
});

proxy.on('error', (err, req, res) => {
    // Don't crash on proxy errors — just return 502
    if (res && !res.headersSent && res.writeHead) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ code: 'ERR_PROXY', error: 'Bad Gateway', message: err.message }));
    }
});

// ── Tunnel URL ────────────────────────────────────────────────────────────────
function getTunnelUrl() {
    const file = path.join(ROOT, '.tunnel-url');
    try {
        if (fs.existsSync(file)) {
            const url = fs.readFileSync(file, 'utf8').trim();
            if (url.startsWith('https://')) return url;
        }
    } catch { }
    return null;
}

// ── Per-IP rate limiting (proxy level) ───────────────────────────────────────
// Simple sliding window — protects against HTTP floods before they hit the backend
const ipWindows = new Map(); // ip → { count, resetAt }
const MAX_REQ_PER_MIN = 300;
const WINDOW_MS = 60_000;

function checkIpRateLimit(ip) {
    const now = Date.now();
    const entry = ipWindows.get(ip);
    if (!entry || now > entry.resetAt) {
        ipWindows.set(ip, { count: 1, resetAt: now + WINDOW_MS });
        return true;
    }
    if (entry.count >= MAX_REQ_PER_MIN) return false;
    entry.count++;
    return true;
}

// Cleanup stale IP entries every 2 minutes
setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of ipWindows) {
        if (now > entry.resetAt) ipWindows.delete(ip);
    }
}, WINDOW_MS * 2).unref();

// ── Global concurrent request counter ────────────────────────────────────────
let activeRequests = 0;
const MAX_CONCURRENT_REQUESTS = 1000;

// ── Request handler ───────────────────────────────────────────────────────────
const requestHandler = (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    // Global concurrency cap — shed load before it hits the backend
    if (activeRequests >= MAX_CONCURRENT_REQUESTS) {
        res.writeHead(503, { 'Content-Type': 'application/json', 'Retry-After': '2' });
        res.end(JSON.stringify({ error: 'Server busy', retryAfter: 2 }));
        return;
    }

    // Per-IP rate limit
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
    if (!checkIpRateLimit(ip)) {
        res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '60' });
        res.end(JSON.stringify({ error: 'Too Many Requests', retryAfter: 60 }));
        return;
    }

    activeRequests++;
    res.on('finish', () => { if (activeRequests > 0) activeRequests--; });
    res.on('close', () => { if (activeRequests > 0) activeRequests--; });

    // ── Tunnel URL endpoint ───────────────────────────────────────────────────
    if (req.url === '/api/tunnel-url' || req.url === '/tunnel-url') {
        const tunnelUrl = getTunnelUrl();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ tunnelUrl }));
        return;
    }

    // ── Route: API + WS + Signaling → backend (3001), everything else → frontend (3000) ──
    if (req.url.startsWith('/api') || req.url.startsWith('/ws') || req.url.startsWith('/signaling')) {
        if (req.url.startsWith('/api/')) req.url = req.url.substring(4);
        proxy.web(req, res, { target: 'https://127.0.0.1:3001' });
    } else {
        // Frontend is terminated via local-ssl-proxy on port 3010 to avoid clashing
        // with other apps that might be using 3000/3005 on this machine.
        proxy.web(req, res, { target: 'https://127.0.0.1:3010' });
    }
};

// ── WebSocket upgrade handler ─────────────────────────────────────────────────
const upgradeHandler = (req, socket, head) => {
    // Set socket timeout to detect dead WS connections at the proxy level
    socket.setTimeout(120_000, () => socket.destroy());

    if (req.url.startsWith('/ws') || req.url.startsWith('/signaling')) {
        proxy.ws(req, socket, head, { target: 'wss://127.0.0.1:3001' });
    } else {
        proxy.ws(req, socket, head, { target: 'wss://127.0.0.1:3010' });
    }
};

// ── Servers ───────────────────────────────────────────────────────────────────
const PORT_HTTP = 4000;
const PORT_HTTPS = 4001;

// Use keep-alive agents for upstream connections to avoid TCP handshake overhead
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 256, timeout: 30_000 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 256, rejectUnauthorized: false, timeout: 30_000 });

const serverOpts = {
    // Keep connections alive for 95s (above Cloudflare's 90s idle timeout)
    keepAliveTimeout: 95_000,
    headersTimeout: 10_000,
};

const httpServer = http.createServer(serverOpts, requestHandler);
const httpsServer = https.createServer({ ...sslOptions, ...serverOpts }, requestHandler);

// Increase max listeners to avoid Node.js warnings under load
httpServer.setMaxListeners(0);
httpsServer.setMaxListeners(0);

httpServer.on('upgrade', upgradeHandler);
httpsServer.on('upgrade', upgradeHandler);

// Handle server errors gracefully — don't crash on ECONNRESET etc.
httpServer.on('error', (err) => console.error('HTTP server error:', err.message));
httpsServer.on('error', (err) => console.error('HTTPS server error:', err.message));

httpServer.listen(PORT_HTTP, '0.0.0.0', () => {
    console.log(`🚀 Unified Proxy  http://0.0.0.0:${PORT_HTTP}`);
    console.log(`🔒 Unified Proxy  https://0.0.0.0:${PORT_HTTPS}`);
    console.log(`   /api + /ws → Backend :3001`);
    console.log(`   /api/tunnel-url → Live Cloudflare tunnel URL`);
    console.log(`   * → Frontend :3000`);
    console.log(`   Rate limit: ${MAX_REQ_PER_MIN} req/min per IP, ${MAX_CONCURRENT_REQUESTS} concurrent max`);
});

httpsServer.listen(PORT_HTTPS, '0.0.0.0', () => {
    console.log(`✅ Both HTTP and HTTPS proxies ready`);
});
