# Quick Reference Card
## E2EE Chat WebSocket Server - Production Operations

---

## 🚀 Quick Start

### Docker
```bash
# Start
docker-compose up -d

# Stop
docker-compose down

# Restart
docker-compose restart chat-server

# Logs
docker-compose logs -f chat-server
```

### PM2
```bash
# Start
pm2 start ecosystem.config.js

# Stop
pm2 stop e2ee-chat-server

# Restart
pm2 reload e2ee-chat-server

# Logs
pm2 logs e2ee-chat-server
```

---

## 🏥 Health Checks

```bash
# Detailed health
curl https://your-domain.com/health | jq

# Readiness
curl https://your-domain.com/ready | jq

# Liveness
curl https://your-domain.com/live | jq

# Metrics (Prometheus)
curl https://your-domain.com/metrics

# Metrics (JSON)
curl -H "Accept: application/json" https://your-domain.com/metrics | jq
```

---

## 📊 Key Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `active_connections` | gauge | Current WebSocket connections |
| `total_connections` | counter | Total connections since start |
| `ws_connection_rejected` | counter | Rejected connections (by reason) |
| `ws_disconnections` | counter | Total disconnections |
| `redis_ready` | gauge | Redis status (1=ready, 0=down) |
| `unhandled_errors` | counter | Application errors |
| `uptime_seconds` | gauge | Service uptime |

---

## 🔧 Configuration

### Critical Environment Variables

```env
# Secrets (REQUIRED)
JOIN_TOKEN_SECRET=<generate with: openssl rand -base64 48>

# Redis
REDIS_URL=redis://your-redis:6379

# CORS (Production)
CORS_ALLOWED_ORIGINS=https://app.yourdomain.com,https://yourdomain.com

# Security
FEATURE_DETAILED_ERRORS=false
LOG_LEVEL=info
```

### Feature Toggles

```env
FEATURE_HEALTH_ENDPOINT=true
FEATURE_METRICS_ENDPOINT=true
FEATURE_READINESS_ENDPOINT=true
FEATURE_GRACEFUL_SHUTDOWN=true
FEATURE_CORS=true
FEATURE_SECURITY_HEADERS=true
FEATURE_REQUEST_ID=true
```

---

## 🚨 Troubleshooting

### High Connection Rejections
```bash
# Check rejection reasons
curl https://your-domain.com/metrics | grep ws_connection_rejected

# Check logs
docker-compose logs chat-server | grep "too many connections"

# Solution: Adjust MAX_CONNS_PER_IP or investigate DDoS
```

### Redis Connection Failures
```bash
# Check Redis health
docker-compose exec redis redis-cli ping

# Check Redis logs
docker-compose logs redis

# Solution: Restart Redis or check network
docker-compose restart redis
```

### High Memory Usage
```bash
# Check health endpoint
curl https://your-domain.com/health | jq '.checks.memory'

# Check container stats
docker stats chat-server

# Solution: Restart service or increase memory limit
```

### WebSocket Connection Drops
```bash
# Check disconnection rate
curl https://your-domain.com/metrics | grep ws_disconnections

# Check for rate limit violations
docker-compose logs chat-server | grep "rate limit"

# Solution: Review rate limits or check network stability
```

---

## 🔒 Security

### Generate Secrets
```bash
# JOIN_TOKEN_SECRET
openssl rand -base64 48
```

### Security Headers (Auto-Applied)
- ✅ Content-Security-Policy
- ✅ Strict-Transport-Security (HSTS)
- ✅ X-Content-Type-Options: nosniff
- ✅ X-Frame-Options: DENY
- ✅ Permissions-Policy
- ✅ Referrer-Policy

### Rate Limits (Default)
- Per-IP connections: 50
- Global connections: 10,000
- Messages per 10s: 200
- Bytes per 10s: 1 MB
- Room creates per minute: 10

---

## 📈 Scaling

### Docker (Horizontal)
```bash
# Scale to 3 instances
docker-compose up -d --scale chat-server=3

# Verify
docker-compose ps
```

### PM2 (Cluster)
```bash
# Scale to 4 instances
pm2 scale e2ee-chat-server 4

# Auto-scale to CPU count
pm2 scale e2ee-chat-server max

# Check status
pm2 list
```

---

## 🔄 Deployment

### Deploy New Version (Docker)
```bash
# Build new image
docker build -t e2ee-chat-server:v0.2.0 .

# Update docker-compose.yml with new tag

# Deploy
docker-compose up -d

# Verify
curl https://your-domain.com/health
```

### Deploy New Version (PM2)
```bash
# Pull latest code
git pull

# Build
npm run build

# Reload (zero-downtime)
pm2 reload e2ee-chat-server

# Verify
pm2 status
curl https://your-domain.com/health
```

---

## 🆘 Emergency Procedures

### Emergency Rollback (Docker)
```bash
docker-compose down
# Edit docker-compose.yml to use previous image tag
docker-compose up -d
```

### Emergency Rollback (PM2)
```bash
git checkout <previous-commit>
npm run build
pm2 reload e2ee-chat-server
```

### Emergency Shutdown
```bash
# Docker
docker-compose down

# PM2
pm2 stop e2ee-chat-server
```

---

## 📞 Contacts

- **On-Call**: [Your contact]
- **DevOps**: [Team contact]
- **Security**: [Security contact]

---

## 📚 Documentation

- **[DEPLOYMENT.md](DEPLOYMENT.md)**: Full deployment checklist
- **[RUNBOOK.md](RUNBOOK.md)**: Operational procedures
- **[SECURITY.md](SECURITY.md)**: Security configuration
- **[PRODUCTION_SUMMARY.md](PRODUCTION_SUMMARY.md)**: Feature overview

---

**Quick Tip**: Bookmark this page for fast reference during incidents!
