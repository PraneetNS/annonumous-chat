# Production Deployment Checklist
## E2EE Ephemeral Chat WebSocket Server

---

## Pre-Deployment Security Audit

### 1. Cryptographic Secrets ✓
- [ ] Generate strong `JOIN_TOKEN_SECRET` (minimum 32 bytes)
  ```bash
  openssl rand -base64 48
  ```
- [ ] Store secrets in secure vault (AWS Secrets Manager, HashiCorp Vault, etc.)
- [ ] Never commit secrets to version control
- [ ] Rotate secrets regularly (recommended: every 90 days)

### 2. Environment Configuration ✓
- [ ] Copy `.env.production` to `.env` and customize
- [ ] Set `NODE_ENV=production`
- [ ] Configure `REDIS_URL` for production Redis instance
- [ ] Set appropriate `CORS_ALLOWED_ORIGINS` (never use `*` in production)
- [ ] Review and adjust rate limits based on expected load
- [ ] Set `FEATURE_DETAILED_ERRORS=false` to prevent information leakage
- [ ] Configure `LOG_LEVEL=info` or `warn` (avoid `debug` in production)

### 3. Redis Configuration ✓
- [ ] Use managed Redis service (AWS ElastiCache, Redis Cloud, etc.) or self-hosted with persistence disabled
- [ ] Enable Redis authentication (`requirepass`)
- [ ] Configure Redis maxmemory policy: `allkeys-lru`
- [ ] Set appropriate maxmemory limit
- [ ] Enable TLS for Redis connections (if supported)
- [ ] Verify Redis is NOT configured for persistence (RDB/AOF disabled)

---

## Infrastructure Setup

### 4. Network & Firewall ✓
- [ ] Configure firewall to allow only necessary ports:
  - WebSocket server: 3001 (or your configured PORT)
  - Redis: 6379 (internal only, not exposed to internet)
- [ ] Set up reverse proxy (Nginx, HAProxy, or cloud load balancer)
- [ ] Enable TLS/SSL termination at load balancer
- [ ] Configure WebSocket upgrade headers in reverse proxy
- [ ] Set up DDoS protection (Cloudflare, AWS Shield, etc.)

### 5. Load Balancer Configuration ✓
- [ ] Enable sticky sessions (for WebSocket connections)
- [ ] Configure health check endpoint: `/health`
- [ ] Set health check interval: 30s
- [ ] Configure connection draining for graceful shutdown
- [ ] Set appropriate timeouts:
  - Connection timeout: 60s
  - Idle timeout: 300s (5 minutes)
  - WebSocket timeout: 3600s (1 hour)

### 6. DNS & SSL ✓
- [ ] Configure DNS A/AAAA records
- [ ] Obtain SSL/TLS certificate (Let's Encrypt, AWS ACM, etc.)
- [ ] Enable HSTS (configured in app, verify at load balancer)
- [ ] Test SSL configuration: https://www.ssllabs.com/ssltest/

---

## Docker Deployment

### 7. Build & Test ✓
- [ ] Build Docker image:
  ```bash
  docker build -t e2ee-chat-server:latest .
  ```
- [ ] Run security scan on image:
  ```bash
  docker scan e2ee-chat-server:latest
  ```
- [ ] Test locally with docker-compose:
  ```bash
  docker-compose up -d
  docker-compose logs -f chat-server
  ```
- [ ] Verify health endpoints:
  ```bash
  curl http://localhost:3001/health
  curl http://localhost:3001/ready
  curl http://localhost:3001/metrics
  ```

### 8. Container Registry ✓
- [ ] Tag image with version:
  ```bash
  docker tag e2ee-chat-server:latest your-registry.com/e2ee-chat-server:0.1.0
  ```
- [ ] Push to container registry:
  ```bash
  docker push your-registry.com/e2ee-chat-server:0.1.0
  ```
- [ ] Verify image is accessible from production environment

---

## Node.js Deployment (Non-Docker)

### 9. Server Setup ✓
- [ ] Install Node.js 20.11+ on production server
- [ ] Create dedicated user for application:
  ```bash
  sudo useradd -r -s /bin/false chatapp
  ```
- [ ] Clone repository to `/opt/chat-app` or similar
- [ ] Set proper file permissions:
  ```bash
  sudo chown -R chatapp:chatapp /opt/chat-app
  ```

### 10. Application Build ✓
- [ ] Install dependencies:
  ```bash
  npm ci --production
  ```
- [ ] Build TypeScript:
  ```bash
  npm run build
  ```
- [ ] Verify build output in `dist/` directory

### 11. Process Manager (PM2) ✓
- [ ] Install PM2 globally:
  ```bash
  npm install -g pm2
  ```
- [ ] Create PM2 ecosystem file (`ecosystem.config.js`):
  ```javascript
  module.exports = {
    apps: [{
      name: 'e2ee-chat-server',
      script: './dist/server/index.js',
      instances: 'max',
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production'
      },
      max_memory_restart: '512M',
      error_file: './logs/err.log',
      out_file: './logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
    }]
  };
  ```
- [ ] Start application:
  ```bash
  pm2 start ecosystem.config.js
  ```
- [ ] Save PM2 process list:
  ```bash
  pm2 save
  ```
- [ ] Configure PM2 to start on boot:
  ```bash
  pm2 startup
  ```

---

## Monitoring & Observability

### 12. Metrics Collection ✓
- [ ] Set up Prometheus to scrape `/metrics` endpoint
- [ ] Configure Prometheus scrape interval: 15s
- [ ] Create Grafana dashboards for:
  - Active WebSocket connections
  - Message throughput
  - Error rates
  - Redis latency
  - Memory usage
  - CPU usage

### 13. Logging ✓
- [ ] Configure log aggregation (ELK Stack, Datadog, CloudWatch, etc.)
- [ ] Set up log rotation (if using file-based logging)
- [ ] Create alerts for:
  - Error rate > 1% of requests
  - Redis connection failures
  - Memory usage > 80%
  - Connection count approaching limit

### 14. Alerting ✓
- [ ] Configure PagerDuty, Opsgenie, or similar for critical alerts
- [ ] Set up alerts for:
  - Service down (health check failures)
  - High error rate
  - Redis unavailable
  - Memory/CPU saturation
- [ ] Test alert delivery

---

## Security Hardening

### 15. Application Security ✓
- [ ] Verify `FEATURE_SECURITY_HEADERS=true`
- [ ] Verify `FEATURE_DETAILED_ERRORS=false`
- [ ] Review CSP directives in `CSP_DIRECTIVES`
- [ ] Enable HSTS with preload
- [ ] Configure CORS with specific origins (no wildcards)

### 16. Rate Limiting ✓
- [ ] Review and adjust rate limits based on load testing:
  - `MAX_CONNS_PER_IP`
  - `MAX_MSGS_PER_10S`
  - `MAX_BYTES_PER_10S`
  - `MAX_ROOM_CREATES_PER_IP_PER_MIN`
- [ ] Consider additional rate limiting at load balancer/WAF

### 17. Network Security ✓
- [ ] Enable firewall (ufw, iptables, security groups)
- [ ] Restrict SSH access to specific IPs
- [ ] Disable password authentication (use SSH keys only)
- [ ] Keep OS and dependencies updated
- [ ] Run security audit:
  ```bash
  npm audit
  ```

---

## Testing & Validation

### 18. Functional Testing ✓
- [ ] Test WebSocket connection establishment
- [ ] Test room creation and joining
- [ ] Test message relay (E2EE ciphertext)
- [ ] Test QR code rotation
- [ ] Test graceful disconnection
- [ ] Test rate limiting (should reject excess connections/messages)

### 19. Load Testing ✓
- [ ] Run load tests with expected peak traffic
- [ ] Tools: `artillery`, `k6`, or `websocket-bench`
- [ ] Monitor metrics during load test
- [ ] Verify no memory leaks
- [ ] Verify graceful degradation under load

### 20. Security Testing ✓
- [ ] Run OWASP ZAP or similar security scanner
- [ ] Test for common WebSocket vulnerabilities
- [ ] Verify CORS policy enforcement
- [ ] Test rate limiting effectiveness
- [ ] Verify secrets are not exposed in logs/errors

---

## Deployment Execution

### 21. Pre-Deployment ✓
- [ ] Schedule maintenance window (if applicable)
- [ ] Notify users of planned deployment
- [ ] Create database backup (if applicable)
- [ ] Document rollback procedure

### 22. Deployment ✓
- [ ] Deploy new version (Docker or PM2)
- [ ] Monitor logs for errors
- [ ] Verify health check passes
- [ ] Test WebSocket connectivity
- [ ] Monitor metrics for anomalies

### 23. Post-Deployment ✓
- [ ] Verify all health endpoints return 200 OK
- [ ] Check application logs for errors
- [ ] Monitor metrics for 30 minutes
- [ ] Test end-to-end functionality
- [ ] Notify users deployment is complete

---

## Rollback Procedure

### 24. Rollback (If Needed) ✓
- [ ] **Docker**: Revert to previous image tag
  ```bash
  docker-compose down
  # Edit docker-compose.yml to use previous image version
  docker-compose up -d
  ```
- [ ] **PM2**: Revert to previous code version
  ```bash
  git checkout <previous-commit>
  npm run build
  pm2 restart all
  ```
- [ ] Verify rollback successful
- [ ] Investigate root cause of failure

---

## Ongoing Maintenance

### 25. Regular Tasks ✓
- [ ] **Daily**: Review error logs and metrics
- [ ] **Weekly**: Review security advisories and update dependencies
- [ ] **Monthly**: Review and rotate secrets
- [ ] **Quarterly**: Conduct security audit and penetration testing
- [ ] **Annually**: Review and update disaster recovery plan

### 26. Capacity Planning ✓
- [ ] Monitor connection growth trends
- [ ] Plan for horizontal scaling (add more instances)
- [ ] Review and adjust resource limits
- [ ] Test auto-scaling policies (if using cloud infrastructure)

---

## Emergency Contacts

- **On-Call Engineer**: [Your contact]
- **DevOps Lead**: [Your contact]
- **Security Team**: [Your contact]
- **Infrastructure Provider Support**: [Provider support contact]

---

## Additional Resources

- **Application Repository**: [GitHub/GitLab URL]
- **Runbook**: See `RUNBOOK.md`
- **Architecture Diagram**: See `docs/architecture.md`
- **Incident Response Plan**: See `docs/incident-response.md`

---

**Deployment Date**: _______________  
**Deployed By**: _______________  
**Version**: _______________  
**Sign-off**: _______________
