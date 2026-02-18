# Production Runbook
## E2EE Ephemeral Chat WebSocket Server

---

## Table of Contents
1. [Service Overview](#service-overview)
2. [Architecture](#architecture)
3. [Monitoring & Alerts](#monitoring--alerts)
4. [Common Operations](#common-operations)
5. [Troubleshooting](#troubleshooting)
6. [Incident Response](#incident-response)
7. [Performance Tuning](#performance-tuning)

---

## Service Overview

### Purpose
Relay-only WebSocket server for end-to-end encrypted group chat. The server NEVER stores messages or decrypts content.

### Key Characteristics
- **Stateless**: No message persistence
- **Ephemeral**: Rooms auto-delete when empty
- **E2EE-Safe**: Only relays opaque ciphertext
- **Redis-backed**: Room state in Redis with TTL
- **Rate-limited**: Per-IP and per-connection limits

### Service Endpoints
- **WebSocket**: `wss://your-domain.com/ws`
- **Health**: `https://your-domain.com/health`
- **Readiness**: `https://your-domain.com/ready`
- **Liveness**: `https://your-domain.com/live`
- **Metrics**: `https://your-domain.com/metrics`

---

## Architecture

### Components
1. **WebSocket Server** (Fastify + @fastify/websocket)
2. **Redis** (ephemeral state store)
3. **Load Balancer** (TLS termination, sticky sessions)

### Data Flow
```
Client → Load Balancer (TLS) → WebSocket Server → Redis (room state)
                                      ↓
                                 Broadcast to room participants
```

### No Data Persistence
- Messages are NEVER stored
- Room state exists only in Redis with TTL
- All keys auto-expire after inactivity

---

## Monitoring & Alerts

### Key Metrics

#### Connection Metrics
- `active_connections` (gauge): Current WebSocket connections
- `total_connections` (counter): Total connections since start
- `ws_connection_rejected` (counter): Rejected connections by reason
- `ws_disconnections` (counter): Total disconnections

#### Message Metrics
- `ws_messages_sent` (counter): Messages sent by type
- `ws_messages_received` (counter): Messages received by type

#### Error Metrics
- `unhandled_errors` (counter): Application errors by path
- `redis_errors` (counter): Redis connection errors

#### Redis Metrics
- `redis_ready` (gauge): Redis connection status (1=ready, 0=not ready)
- `redis_reconnect_attempts` (counter): Reconnection attempts
- `redis_connects` (counter): Successful connections

#### System Metrics
- `uptime_seconds` (gauge): Service uptime
- Memory usage (from health endpoint)
- CPU usage (from system monitoring)

### Alert Thresholds

#### Critical Alerts (Page On-Call)
- **Service Down**: Health check fails for >2 minutes
- **Redis Unavailable**: Redis connection fails for >1 minute
- **High Error Rate**: Error rate >5% for >5 minutes
- **Memory Critical**: Heap usage >95% for >2 minutes

#### Warning Alerts (Notify Team)
- **High Connection Count**: >90% of `MAX_TOTAL_CONNECTIONS`
- **High Memory**: Heap usage >80% for >5 minutes
- **Redis Latency**: Redis ping >100ms for >5 minutes
- **Elevated Error Rate**: Error rate >1% for >10 minutes

### Monitoring Dashboards

#### Grafana Dashboard Panels
1. **Connection Overview**
   - Active connections (time series)
   - Connection rate (connections/sec)
   - Rejection rate by reason

2. **Message Throughput**
   - Messages sent/received per second
   - Message types distribution

3. **Error Tracking**
   - Error rate (%)
   - Error count by type
   - Top error paths

4. **Redis Health**
   - Connection status
   - Latency (p50, p95, p99)
   - Reconnection events

5. **System Resources**
   - Memory usage (heap used/total)
   - CPU usage
   - Network I/O

---

## Common Operations

### Viewing Logs

#### Docker
```bash
# Follow logs
docker-compose logs -f chat-server

# Last 100 lines
docker-compose logs --tail=100 chat-server

# Filter by level (JSON logs)
docker-compose logs chat-server | jq 'select(.level == "error")'
```

#### PM2
```bash
# Follow logs
pm2 logs e2ee-chat-server

# Error logs only
pm2 logs e2ee-chat-server --err

# Last 100 lines
pm2 logs e2ee-chat-server --lines 100
```

### Checking Service Health

```bash
# Health check (detailed)
curl https://your-domain.com/health | jq

# Readiness probe
curl https://your-domain.com/ready | jq

# Liveness probe
curl https://your-domain.com/live | jq

# Metrics (Prometheus format)
curl https://your-domain.com/metrics

# Metrics (JSON format)
curl -H "Accept: application/json" https://your-domain.com/metrics | jq
```

### Restarting Service

#### Docker
```bash
# Graceful restart
docker-compose restart chat-server

# Force restart (if graceful fails)
docker-compose stop chat-server
docker-compose up -d chat-server
```

#### PM2
```bash
# Graceful restart (zero-downtime)
pm2 reload e2ee-chat-server

# Hard restart
pm2 restart e2ee-chat-server

# Restart all instances
pm2 restart all
```

### Scaling

#### Docker (Manual)
```bash
# Scale to 3 instances
docker-compose up -d --scale chat-server=3

# Verify
docker-compose ps
```

#### PM2 (Cluster Mode)
```bash
# Scale to 4 instances
pm2 scale e2ee-chat-server 4

# Auto-scale to CPU count
pm2 scale e2ee-chat-server max
```

### Updating Configuration

#### Docker
```bash
# 1. Edit docker-compose.yml or .env
# 2. Recreate containers
docker-compose up -d --force-recreate chat-server
```

#### PM2
```bash
# 1. Edit .env file
# 2. Reload application
pm2 reload e2ee-chat-server --update-env
```

---

## Troubleshooting

### Issue: High Connection Rejections

**Symptoms**: `ws_connection_rejected` counter increasing

**Diagnosis**:
```bash
# Check rejection reasons in metrics
curl https://your-domain.com/metrics | grep ws_connection_rejected

# Check IP-based rejections in logs
docker-compose logs chat-server | grep "too many connections"
```

**Resolution**:
1. Review `MAX_CONNS_PER_IP` setting
2. Check for DDoS attack (abnormal traffic patterns)
3. Consider increasing limit if legitimate traffic
4. Implement additional rate limiting at load balancer

### Issue: Redis Connection Failures

**Symptoms**: `redis_ready` gauge = 0, `redis_errors` counter increasing

**Diagnosis**:
```bash
# Check Redis health
docker-compose exec redis redis-cli ping

# Check Redis logs
docker-compose logs redis

# Check network connectivity
docker-compose exec chat-server ping redis
```

**Resolution**:
1. Verify Redis is running: `docker-compose ps redis`
2. Check Redis memory usage: `docker-compose exec redis redis-cli INFO memory`
3. Restart Redis if needed: `docker-compose restart redis`
4. Check Redis configuration (maxmemory, eviction policy)

### Issue: High Memory Usage

**Symptoms**: Memory usage >80%, potential OOM errors

**Diagnosis**:
```bash
# Check health endpoint
curl https://your-domain.com/health | jq '.checks.memory'

# Check process memory (Docker)
docker stats chat-server

# Check process memory (PM2)
pm2 show e2ee-chat-server
```

**Resolution**:
1. Check for memory leaks (increasing over time)
2. Review active connection count
3. Check for slow consumers (buffered messages)
4. Restart service if memory leak suspected
5. Increase container memory limit if needed

### Issue: WebSocket Connection Drops

**Symptoms**: Clients frequently disconnecting

**Diagnosis**:
```bash
# Check disconnection rate
curl https://your-domain.com/metrics | grep ws_disconnections

# Check for rate limit violations
docker-compose logs chat-server | grep "rate limit"

# Check for slow consumer disconnections
docker-compose logs chat-server | grep "slow consumer"
```

**Resolution**:
1. Review client-side connection handling
2. Check network stability between client and server
3. Verify load balancer WebSocket timeout settings
4. Review `WS_PING_INTERVAL_MS` and `WS_PING_TIMEOUT_MS`
5. Check for rate limit violations (adjust if needed)

### Issue: Slow Performance

**Symptoms**: High latency, slow message delivery

**Diagnosis**:
```bash
# Check Redis latency
curl https://your-domain.com/health | jq '.checks.redis'

# Check CPU usage
docker stats chat-server

# Check active connections
curl https://your-domain.com/metrics | grep active_connections
```

**Resolution**:
1. Check Redis latency (should be <10ms)
2. Scale horizontally (add more instances)
3. Review rate limiting settings
4. Check for CPU saturation
5. Optimize Redis configuration

---

## Incident Response

### Severity Levels

#### SEV1 - Critical
- Service completely down
- Data breach or security incident
- **Response Time**: Immediate
- **Escalation**: Page on-call + notify management

#### SEV2 - High
- Partial service degradation
- High error rate (>5%)
- **Response Time**: 15 minutes
- **Escalation**: Notify on-call

#### SEV3 - Medium
- Minor degradation
- Elevated error rate (1-5%)
- **Response Time**: 1 hour
- **Escalation**: Create ticket

#### SEV4 - Low
- No user impact
- Monitoring alert
- **Response Time**: Next business day
- **Escalation**: Create ticket

### Incident Response Steps

1. **Acknowledge**: Acknowledge alert in monitoring system
2. **Assess**: Determine severity and impact
3. **Communicate**: Notify stakeholders (status page, Slack, etc.)
4. **Investigate**: Gather logs, metrics, and diagnostic data
5. **Mitigate**: Implement temporary fix (rollback, scale, etc.)
6. **Resolve**: Deploy permanent fix
7. **Verify**: Confirm resolution and monitor
8. **Document**: Write post-mortem (for SEV1/SEV2)

### Emergency Rollback

```bash
# Docker: Revert to previous image
docker-compose down
# Edit docker-compose.yml to use previous image tag
docker-compose up -d

# PM2: Revert to previous code
git checkout <previous-commit>
npm run build
pm2 reload e2ee-chat-server
```

### Emergency Shutdown

```bash
# Docker: Stop all services
docker-compose down

# PM2: Stop application
pm2 stop e2ee-chat-server

# Verify no connections
netstat -an | grep :3001
```

---

## Performance Tuning

### Connection Limits

Adjust based on load testing results:

```env
# Per-IP connection limit
MAX_CONNS_PER_IP=50

# Global connection limit
MAX_TOTAL_CONNECTIONS=10000

# Room creation rate limit
MAX_ROOM_CREATES_PER_IP_PER_MIN=10
```

### Message Rate Limits

Adjust based on expected message volume:

```env
# Messages per connection per 10 seconds
MAX_MSGS_PER_10S=200

# Bytes per connection per 10 seconds
MAX_BYTES_PER_10S=1048576
```

### Redis Optimization

```bash
# Redis maxmemory (adjust based on expected room count)
redis-cli CONFIG SET maxmemory 256mb

# Eviction policy (LRU for ephemeral data)
redis-cli CONFIG SET maxmemory-policy allkeys-lru
```

### Node.js Tuning

```bash
# Increase max old space size (if needed)
NODE_OPTIONS="--max-old-space-size=512" pm2 restart e2ee-chat-server
```

---

## Contact Information

- **On-Call Engineer**: [Your contact]
- **DevOps Team**: [Team contact]
- **Security Team**: [Security contact]
- **Escalation**: [Manager contact]

---

## Additional Resources

- **Deployment Checklist**: `DEPLOYMENT.md`
- **Architecture Docs**: `docs/architecture.md`
- **API Documentation**: `docs/api.md`
- **Security Policy**: `SECURITY.md`

---

**Last Updated**: [Date]  
**Maintained By**: [Team name]
