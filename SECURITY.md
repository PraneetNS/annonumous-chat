# Security Configuration Guide
## E2EE Ephemeral Chat WebSocket Server

---

## Table of Contents
1. [Security Architecture](#security-architecture)
2. [Cryptographic Configuration](#cryptographic-configuration)
3. [Network Security](#network-security)
4. [Application Security](#application-security)
5. [Rate Limiting & Abuse Prevention](#rate-limiting--abuse-prevention)
6. [Monitoring & Incident Response](#monitoring--incident-response)
7. [Compliance & Auditing](#compliance--auditing)

---

## Security Architecture

### End-to-End Encryption (E2EE) Guarantee

**The server NEVER**:
- ❌ Decrypts message contents
- ❌ Stores messages (even encrypted)
- ❌ Logs message payloads
- ❌ Has access to encryption keys

**The server ONLY**:
- ✅ Relays opaque ciphertext between clients
- ✅ Manages ephemeral room state (in Redis with TTL)
- ✅ Enforces rate limits and connection caps
- ✅ Validates join tokens (capability-based auth)

### Threat Model

**In Scope**:
- Network-level attacks (DDoS, connection flooding)
- Application-level attacks (rate limit bypass, token replay)
- Infrastructure compromise (server, Redis)
- Insider threats (server operator)

**Out of Scope**:
- Client-side attacks (malware, key theft)
- MLS protocol vulnerabilities (client responsibility)
- Physical attacks on client devices

**Key Principle**: Even if the server is fully compromised, message contents remain confidential (E2EE guarantee).

---

## Cryptographic Configuration

### Join Token Secret

**Purpose**: HMAC secret for signing join tokens (capability-based room access)

**Requirements**:
- Minimum 32 bytes (256 bits)
- Cryptographically random
- Unique per deployment

**Generation**:
```bash
# Generate strong secret
openssl rand -base64 48

# Or use Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

**Storage**:
- ✅ Store in secrets manager (AWS Secrets Manager, HashiCorp Vault, etc.)
- ✅ Load via environment variable at runtime
- ❌ Never commit to version control
- ❌ Never log or expose in errors

**Rotation**:
- Rotate every 90 days (recommended)
- Rotation invalidates all existing join tokens
- Plan rotation during low-traffic periods

### Token Replay Protection

**Mechanism**: Redis-based `SET NX PX` ensures each join token is used only once

**Configuration**:
```env
FEATURE_TOKEN_REPLAY_PROTECTION=true
```

**How it works**:
1. Client presents join token with unique `jti` (JWT ID)
2. Server checks if `jti` exists in Redis
3. If not exists, mark as used with TTL matching token expiry
4. If exists, reject as replay attack

**Security properties**:
- Prevents token reuse (even if intercepted)
- Automatic cleanup via TTL
- Atomic check-and-set (no race conditions)

---

## Network Security

### TLS/SSL Configuration

**Requirement**: TLS 1.2+ for all production traffic

**Recommended Setup**:
- Terminate TLS at load balancer (Nginx, HAProxy, AWS ALB, etc.)
- Use strong cipher suites (disable weak ciphers)
- Enable HSTS (configured in application)
- Obtain certificate from trusted CA (Let's Encrypt, AWS ACM, etc.)

**Nginx Example**:
```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.com;

    # SSL configuration
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers 'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384';
    ssl_prefer_server_ciphers on;

    # HSTS (redundant with app-level, but good practice)
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;

    # WebSocket upgrade
    location /ws {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 3600s;
        proxy_read_timeout 3600s;
    }

    # Health/metrics endpoints
    location ~ ^/(health|ready|live|metrics) {
        proxy_pass http://localhost:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

### Firewall Configuration

**Inbound Rules**:
- Allow TCP 443 (HTTPS/WSS) from internet
- Allow TCP 22 (SSH) from specific IPs only
- Allow TCP 3001 (app) from load balancer only
- Allow TCP 6379 (Redis) from app servers only
- Deny all other inbound traffic

**Outbound Rules**:
- Allow all (or restrict to specific services if needed)

**Example (ufw)**:
```bash
# Default policies
sudo ufw default deny incoming
sudo ufw default allow outgoing

# SSH (restrict to your IP)
sudo ufw allow from YOUR_IP to any port 22

# HTTPS (if load balancer is on same host)
sudo ufw allow 443/tcp

# Application port (from load balancer only)
sudo ufw allow from LOAD_BALANCER_IP to any port 3001

# Enable firewall
sudo ufw enable
```

---

## Application Security

### Security Headers

**Configuration**:
```env
FEATURE_SECURITY_HEADERS=true
CSP_DIRECTIVES=default-src 'none'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'
HSTS_MAX_AGE=31536000
HSTS_INCLUDE_SUBDOMAINS=true
HSTS_PRELOAD=true
```

**Headers Applied**:
- `Content-Security-Policy`: Prevents XSS and injection attacks
- `Strict-Transport-Security`: Forces HTTPS
- `X-Content-Type-Options: nosniff`: Prevents MIME sniffing
- `X-Frame-Options: DENY`: Prevents clickjacking
- `Permissions-Policy`: Disables unnecessary browser features
- `Referrer-Policy`: Prevents referrer leakage

### CORS Configuration

**Development**:
```env
CORS_ALLOWED_ORIGINS=*
CORS_ALLOW_CREDENTIALS=false
```

**Production**:
```env
CORS_ALLOWED_ORIGINS=https://app.yourdomain.com,https://yourdomain.com
CORS_ALLOW_CREDENTIALS=true
```

**Security Notes**:
- Never use `*` in production
- List all legitimate origins explicitly
- Use HTTPS origins only
- Review regularly as clients are added/removed

### Error Handling

**Development**:
```env
FEATURE_DETAILED_ERRORS=true
```

**Production**:
```env
FEATURE_DETAILED_ERRORS=false
```

**Security Rationale**:
- Detailed errors can leak sensitive information
- Production should return generic error messages
- Detailed errors logged server-side for debugging

---

## Rate Limiting & Abuse Prevention

### Connection Limits

**Per-IP Connection Limit**:
```env
MAX_CONNS_PER_IP=50
```

**Protects against**: Single-source connection flooding

**Tuning**:
- Increase for legitimate high-traffic sources (e.g., corporate NAT)
- Decrease if under attack
- Monitor `ws_connection_rejected{reason="ip_limit"}` metric

**Global Connection Limit**:
```env
MAX_TOTAL_CONNECTIONS=10000
```

**Protects against**: Resource exhaustion

**Tuning**:
- Set based on available memory (each connection ~10KB)
- Monitor `active_connections` gauge
- Alert when >90% capacity

### Message Rate Limits

**Per-Connection Message Rate**:
```env
MAX_MSGS_PER_10S=200
MAX_BYTES_PER_10S=1048576
```

**Protects against**: Message flooding, bandwidth exhaustion

**Tuning**:
- Adjust based on expected message volume
- Monitor disconnections due to rate limiting
- Consider separate limits for different message types

### Room Creation Rate Limit

```env
MAX_ROOM_CREATES_PER_IP_PER_MIN=10
```

**Protects against**: Room creation spam

**Tuning**:
- Adjust based on legitimate use cases
- Monitor room creation patterns
- Consider CAPTCHA for high-frequency creators

### Slow Consumer Protection

```env
FEATURE_SLOW_CONSUMER_PROTECTION=true
SLOW_CONSUMER_BUFFER_THRESHOLD=524288
```

**Protects against**: Memory exhaustion from slow clients

**How it works**:
- Monitors WebSocket send buffer size
- Disconnects clients with excessive buffering
- Prevents one slow client from affecting others

### Additional Recommendations

**Load Balancer Rate Limiting**:
- Implement additional rate limiting at load balancer/WAF
- Use tools like Nginx `limit_req`, AWS WAF, Cloudflare, etc.
- Provides defense-in-depth

**DDoS Protection**:
- Use cloud-based DDoS protection (Cloudflare, AWS Shield, etc.)
- Configure SYN flood protection
- Monitor for volumetric attacks

---

## Monitoring & Incident Response

### Security Monitoring

**Metrics to Monitor**:
- `ws_connection_rejected`: Spike indicates attack or misconfiguration
- `unhandled_errors`: Increase may indicate exploitation attempt
- `redis_errors`: Could indicate infrastructure attack
- `active_connections`: Sudden spike indicates potential attack

**Log Monitoring**:
- Failed authentication attempts (invalid tokens)
- Rate limit violations
- Abnormal disconnection patterns
- Redis connection failures

**Alerting Thresholds**:
- Connection rejection rate >10% for >5 minutes
- Error rate >1% for >5 minutes
- Redis unavailable for >1 minute
- Memory usage >80% for >5 minutes

### Incident Response

**Security Incident Procedure**:

1. **Detect**: Alert triggered or suspicious activity reported
2. **Assess**: Determine severity and scope
3. **Contain**: 
   - Block malicious IPs at firewall/load balancer
   - Adjust rate limits if under attack
   - Scale resources if needed
4. **Investigate**: 
   - Review logs for attack patterns
   - Identify attack vector
   - Assess damage
5. **Remediate**:
   - Patch vulnerabilities
   - Update configurations
   - Rotate secrets if compromised
6. **Document**: Write post-mortem
7. **Improve**: Update security controls

**Emergency Contacts**:
- Security Team: [Contact]
- On-Call Engineer: [Contact]
- Infrastructure Provider: [Support contact]

---

## Compliance & Auditing

### Data Retention

**Messages**: ZERO retention (never stored)
**Room State**: Ephemeral (Redis TTL, typically 10 minutes)
**Logs**: Configurable (recommend 30-90 days)

**Compliance Notes**:
- GDPR: No personal data stored (E2EE)
- HIPAA: Suitable for healthcare (with proper client-side encryption)
- SOC 2: Audit logs available for compliance

### Security Auditing

**Regular Tasks**:
- **Weekly**: Review security logs
- **Monthly**: Dependency vulnerability scan (`npm audit`)
- **Quarterly**: Penetration testing
- **Annually**: Full security audit

**Audit Checklist**:
- [ ] Review access logs for anomalies
- [ ] Check for outdated dependencies
- [ ] Verify secrets are not exposed
- [ ] Test rate limiting effectiveness
- [ ] Verify TLS configuration
- [ ] Review CORS policy
- [ ] Test disaster recovery procedures

### Vulnerability Management

**Process**:
1. Monitor security advisories (GitHub, npm, etc.)
2. Assess impact on application
3. Test patches in staging
4. Deploy to production
5. Verify fix

**Tools**:
- `npm audit`: Dependency vulnerability scanning
- Snyk, Dependabot: Automated vulnerability detection
- OWASP ZAP: Web application security testing

---

## Security Checklist

### Pre-Deployment
- [ ] Strong `JOIN_TOKEN_SECRET` generated and stored securely
- [ ] `FEATURE_DETAILED_ERRORS=false` in production
- [ ] CORS configured with specific origins (no `*`)
- [ ] TLS/SSL certificate obtained and configured
- [ ] Firewall rules configured
- [ ] Rate limits tuned based on load testing
- [ ] Security headers enabled
- [ ] Monitoring and alerting configured

### Post-Deployment
- [ ] Verify TLS configuration (SSL Labs test)
- [ ] Test rate limiting effectiveness
- [ ] Verify CORS policy enforcement
- [ ] Check security headers (securityheaders.com)
- [ ] Review logs for errors
- [ ] Test incident response procedures

### Ongoing
- [ ] Weekly log review
- [ ] Monthly dependency updates
- [ ] Quarterly penetration testing
- [ ] Annual security audit
- [ ] Secret rotation (every 90 days)

---

## Contact

**Security Issues**: Report to [security@yourdomain.com]  
**Security Team**: [Team contact]  
**Bug Bounty**: [Program URL if applicable]

---

**Last Updated**: [Date]  
**Maintained By**: [Security team]
