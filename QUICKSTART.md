# 🚀 Quick Start Guide - Running the E2EE Chat Server

## You Need Redis First!

The server requires Redis to manage ephemeral room state. Here are **3 easy options**:

---

## ⚡ **Option 1: Cloud Redis (Easiest - No Installation!)**

### Using Upstash (Free Tier)

1. **Go to**: https://upstash.com/
2. **Sign up** for free account
3. **Create a Redis database**:
   - Click "Create Database"
   - Choose a region close to you
   - Select "Free" tier
4. **Copy the connection URL**:
   - It looks like: `rediss://default:xxxxx@us1-xxxxx.upstash.io:6379`
5. **Update your `.env` file**:
   ```env
   REDIS_URL=rediss://default:YOUR_PASSWORD@YOUR_ENDPOINT.upstash.io:6379
   ```
6. **Start the server**:
   ```powershell
   npm run dev
   ```

**✅ Pros**: No installation, works immediately, free tier available  
**❌ Cons**: Requires internet connection

---

## 🐳 **Option 2: Docker Desktop (Recommended for Local Dev)**

### Install Docker Desktop

1. **Download**: https://www.docker.com/products/docker-desktop/
2. **Install** Docker Desktop for Windows
3. **Start** Docker Desktop
4. **Run the full stack**:
   ```powershell
   docker-compose up -d
   ```
5. **Check health**:
   ```powershell
   curl http://localhost:3001/health
   ```

**✅ Pros**: Complete local environment, production-like setup  
**❌ Cons**: Requires Docker Desktop installation (~500MB)

---

## 🐧 **Option 3: WSL + Redis (For Linux Fans)**

### Using Windows Subsystem for Linux

1. **Open PowerShell as Administrator** and run:
   ```powershell
   wsl --install
   ```
   (If WSL is already installed, skip this)

2. **Open WSL terminal** and install Redis:
   ```bash
   sudo apt update
   sudo apt install redis-server -y
   ```

3. **Start Redis**:
   ```bash
   sudo service redis-server start
   ```

4. **Verify Redis is running**:
   ```bash
   redis-cli ping
   # Should return: PONG
   ```

5. **In Windows PowerShell**, start the server:
   ```powershell
   npm run dev
   ```

**✅ Pros**: Full control, no external dependencies  
**❌ Cons**: Requires WSL setup and sudo password

---

## 🎯 **After Redis is Running**

### Test the Endpoints

```powershell
# Health check (detailed)
curl http://localhost:3001/health

# Readiness probe
curl http://localhost:3001/ready

# Liveness probe
curl http://localhost:3001/live

# Metrics (Prometheus format)
curl http://localhost:3001/metrics

# Metrics (JSON format)
curl -H "Accept: application/json" http://localhost:3001/metrics
```

### Test WebSocket Connection

Open your browser console and run:

```javascript
const ws = new WebSocket('ws://localhost:3001/ws');

ws.onopen = () => {
  console.log('✅ Connected to server!');
};

ws.onmessage = (event) => {
  console.log('📨 Received:', JSON.parse(event.data));
};

ws.onerror = (error) => {
  console.error('❌ Error:', error);
};
```

You should see a `HELLO` message from the server!

---

## 📊 **What You'll See**

### Health Endpoint Response
```json
{
  "status": "healthy",
  "timestamp": 1707567890123,
  "uptime": 42,
  "checks": {
    "redis": {
      "status": "pass",
      "observedValue": 2,
      "observedUnit": "ms"
    },
    "memory": {
      "status": "pass",
      "observedValue": 128,
      "observedUnit": "MB"
    },
    "connections": {
      "status": "pass",
      "observedValue": 0,
      "observedUnit": "connections"
    }
  },
  "version": "0.1.0"
}
```

### Metrics Endpoint Response (Prometheus)
```
# TYPE active_connections gauge
active_connections 0 1707567890123
# TYPE total_connections counter
total_connections 5 1707567890123
# TYPE redis_ready gauge
redis_ready 1 1707567890123
# TYPE uptime_seconds gauge
uptime_seconds 42 1707567890123
```

---

## 🎉 **Success Indicators**

You'll know everything is working when:

✅ Server starts without errors  
✅ `/health` endpoint returns `"status": "healthy"`  
✅ `/ready` endpoint returns `"ready": true`  
✅ Redis check shows `"status": "pass"`  
✅ WebSocket connection receives `HELLO` message  

---

## 🆘 **Troubleshooting**

### "Redis connection failed"
- ✅ Check Redis is running: `redis-cli ping` (WSL) or check Docker
- ✅ Verify `REDIS_URL` in `.env` file
- ✅ Check firewall isn't blocking port 6379

### "Port 3001 already in use"
- ✅ Change `PORT` in `.env` file
- ✅ Or kill the process: `Get-Process -Id (Get-NetTCPConnection -LocalPort 3001).OwningProcess | Stop-Process`

### "Module not found"
- ✅ Run: `npm install`

---

## 📚 **Next Steps**

Once the server is running:

1. **Read the docs**: `DEPLOYMENT.md`, `RUNBOOK.md`, `SECURITY.md`
2. **Test the features**: Try creating rooms, sending messages
3. **Monitor metrics**: Set up Grafana dashboard
4. **Deploy to production**: Follow `DEPLOYMENT.md` checklist

---

## 💡 **My Recommendation**

**For quick testing**: Use **Option 1 (Upstash Cloud Redis)** - it's free and works in 2 minutes!

**For serious development**: Use **Option 2 (Docker Desktop)** - it's the most production-like setup.

**For learning**: Use **Option 3 (WSL + Redis)** - you'll understand the full stack.

---

**Need help?** Check `QUICK_REFERENCE.md` for common commands!
