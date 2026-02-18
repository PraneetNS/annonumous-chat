## Ephemeral encrypted chat WS server (Fastify + Redis)

This is a **relay-only** WebSocket server intended for end-to-end encrypted group chat.

- **No message persistence**: the server never stores messages; it only fanouts opaque ciphertext.
- **Rooms are ephemeral**: room state exists in **Redis with TTL** and is **deleted when the last participant disconnects**.
- **10-user hard cap** per room (enforced atomically in Redis).
- **Replay protection** for join tokens (Redis `SET NX PX` on token `jti`).
- **Flood protection**: per-IP connection cap, per-connection token buckets, and message size limits.
- **Never log message contents**: handlers do not log any payloads, and request bodies are redacted.
- **Production-hardened**: Security headers, CORS, rate limiting, health checks, and metrics.

---

## Quick Start (Development)

### Setup

1) Install dependencies:

```bash
npm install
```

2) Start Redis locally (example):

```bash
docker run --rm -p 6379:6379 redis:7
```

3) Set environment variables (copy from `env.example`):

```bash
cp env.example .env
```

Edit `.env` and set:
- `REDIS_URL`
- `JOIN_TOKEN_SECRET` (32+ bytes)

4) Run dev server:

```bash
npm run dev
```

### WebSocket endpoint

- Connect to `ws(s)://<host>:<port>/ws`
- Send JSON messages as described in `src/ws/types.ts`.

---

## Production Deployment

### Prerequisites

- Node.js 20.11+
- Redis 7+ (managed service recommended)
- Reverse proxy with TLS termination (Nginx, HAProxy, or cloud load balancer)
- (Optional) Docker & Docker Compose

### Deployment Options

#### Option 1: Docker (Recommended)

1. **Generate secrets**:
```bash
openssl rand -base64 48
```

2. **Configure environment**:
```bash
cp .env.production .env
# Edit .env and set JOIN_TOKEN_SECRET and other production values
```

3. **Build and deploy**:
```bash
docker-compose up -d
```

4. **Verify deployment**:
```bash
curl http://localhost:3001/health
curl http://localhost:3001/metrics
```

#### Option 2: PM2 (Node.js)

1. **Build application**:
```bash
npm ci --production
npm run build
```

2. **Configure environment**:
```bash
cp .env.production .env
# Edit .env with production values
```

3. **Start with PM2**:
```bash
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

4. **Monitor**:
```bash
pm2 status
pm2 logs
pm2 monit
```

### Production Configuration

See `.env.production` for all available configuration options.

**Critical settings**:
- `JOIN_TOKEN_SECRET`: Generate with `openssl rand -base64 48`
- `REDIS_URL`: Production Redis instance
- `CORS_ALLOWED_ORIGINS`: Comma-separated list of allowed origins (never use `*`)
- `FEATURE_DETAILED_ERRORS`: Set to `false` in production
- `LOG_LEVEL`: Set to `info` or `warn`

### Feature Toggles

Control production features via environment variables:

- `FEATURE_HEALTH_ENDPOINT`: Enable `/health` endpoint
- `FEATURE_METRICS_ENDPOINT`: Enable `/metrics` endpoint (Prometheus-compatible)
- `FEATURE_READINESS_ENDPOINT`: Enable `/ready` endpoint
- `FEATURE_GRACEFUL_SHUTDOWN`: Enable graceful shutdown on SIGTERM/SIGINT
- `FEATURE_CORS`: Enable CORS middleware
- `FEATURE_SECURITY_HEADERS`: Enable security headers (CSP, HSTS, etc.)
- `FEATURE_REQUEST_ID`: Enable request ID tracking

### Health & Metrics Endpoints

- **Health Check**: `GET /health` - Detailed health status (Redis, memory, connections)
- **Readiness Probe**: `GET /ready` - Simple ready/not-ready status
- **Liveness Probe**: `GET /live` - Always returns 200 if process is running
- **Metrics**: `GET /metrics` - Prometheus-compatible metrics (or JSON with `Accept: application/json`)

### Monitoring

**Key metrics** (Prometheus format at `/metrics`):
- `active_connections`: Current WebSocket connections
- `total_connections`: Total connections since start
- `ws_connection_rejected`: Rejected connections by reason
- `ws_messages_sent`: Messages sent by type
- `redis_ready`: Redis connection status
- `uptime_seconds`: Service uptime

**Recommended alerts**:
- Service down (health check fails)
- Redis unavailable
- High error rate (>1%)
- High memory usage (>80%)
- Connection capacity (>90%)

### Security

**Built-in security features**:
- ✅ Content Security Policy (CSP)
- ✅ HTTP Strict Transport Security (HSTS)
- ✅ CORS with configurable origins
- ✅ Rate limiting (per-IP and per-connection)
- ✅ Request ID tracking
- ✅ Security headers (X-Content-Type-Options, X-Frame-Options, etc.)
- ✅ Slow consumer protection
- ✅ Token replay protection

**Additional recommendations**:
- Use TLS/SSL (terminate at load balancer)
- Enable DDoS protection (Cloudflare, AWS Shield, etc.)
- Use managed Redis with authentication
- Implement additional rate limiting at WAF/load balancer
- Regular security audits and dependency updates

### Scaling

**Horizontal scaling**:
- Run multiple instances behind a load balancer
- Enable sticky sessions for WebSocket connections
- All instances share the same Redis

**Vertical scaling**:
- Increase container memory limit
- Adjust `MAX_TOTAL_CONNECTIONS` based on resources

**Load balancer configuration**:
- Enable WebSocket upgrade headers
- Set connection timeout: 60s
- Set idle timeout: 300s (5 minutes)
- Set WebSocket timeout: 3600s (1 hour)
- Enable connection draining for graceful shutdown

---

## Documentation

- **[Deployment Checklist](DEPLOYMENT.md)**: Complete production deployment guide
- **[Runbook](RUNBOOK.md)**: Operational procedures and troubleshooting
- **[Environment Configuration](.env.production)**: All configuration options

---

## Notes

- This server is **not** an MLS implementation. It is an ephemeral room + ciphertext relay suitable for MLS clients.
- For real deployments, enforce additional rate limits and connection limits at the load balancer / WAF.
- **E2EE guarantee**: The server NEVER decrypts, stores, or logs message contents. All cryptographic operations happen client-side.

---

## License

[Your license here]

