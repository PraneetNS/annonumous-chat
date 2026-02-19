import Fastify from "fastify";
import fs from "node:fs";
import path from "node:path";
import websocketPlugin from "@fastify/websocket";
import { loadConfig } from "./config.js";
import { redisPlugin } from "./plugins/redis.js";
import { registerWs } from "./ws/handlers.js";
import { registerSecurityHeaders, registerCORS, registerRequestId, registerHttpRateLimit } from "./middleware/security.js";
import { HealthChecker, registerHealthEndpoints } from "./observability/health.js";
import { getMetrics } from "./observability/metrics.js";
import { RoomStore } from "./rooms/roomStore.js";
import { randomIdB64Url } from "./utils/base64url.js";
import { mintJoinToken } from "./security/joinTokens.js";
import { getLocalNetworkIP } from "./utils/network.js";
import { registerSignaling } from "./shredder/signaling.js";

export async function buildServer() {
  const config = loadConfig();
  const metrics = getMetrics();

  const loggerConfig: any = {
    level: config.LOG_LEVEL,
    // Production-safe logging: never log sensitive payloads
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "req.body",
        "res.body"
      ],
      remove: true
    }
  };

  // Add format-specific configuration
  if (config.LOG_FORMAT === "json") {
    loggerConfig.serializers = {
      req(req: any) {
        return {
          method: req.method,
          url: req.url,
          hostname: req.hostname,
          remoteAddress: req.ip,
          requestId: req.id
        };
      },
      res(res: any) {
        return {
          statusCode: res.statusCode
        };
      }
    };
  } else {
    loggerConfig.transport = { target: "pino-pretty" };
  }

  const fastifyOpts: any = {
    logger: loggerConfig,
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 16 * 1024 * 1024,
    keepAliveTimeout: config.HTTP_KEEP_ALIVE_TIMEOUT_MS,
    requestIdHeader: "x-request-id",
    requestIdLogLabel: "requestId",
    disableRequestLogging: !config.LOG_REQUESTS
  };

  // Enable HTTPS if certificates are present (common for local dev)
  const certDir = path.join(process.cwd(), "server", "certs");
  if (fs.existsSync(path.join(certDir, "key.pem")) && fs.existsSync(path.join(certDir, "cert.pem"))) {
    fastifyOpts.https = {
      key: fs.readFileSync(path.join(certDir, "key.pem")),
      cert: fs.readFileSync(path.join(certDir, "cert.pem"))
    };
  }

  const fastify = Fastify(fastifyOpts);

  // Decorate with config
  fastify.decorate("config", config);

  // Register security middleware
  registerSecurityHeaders(fastify);
  registerCORS(fastify);
  registerRequestId(fastify);
  registerHttpRateLimit(fastify);

  // Register WebSocket plugin
  await fastify.register(websocketPlugin, {
    options: {
      maxPayload: config.MAX_WS_MSG_BYTES,
      clientTracking: true
    }
  });

  // Register Redis plugin
  await fastify.register(redisPlugin);

  // Initialize health checker
  const healthChecker = new HealthChecker(
    fastify.redis,
    {
      SERVICE_VERSION: config.SERVICE_VERSION,
      INSTANCE_ID: config.INSTANCE_ID,
      MAX_TOTAL_CONNECTIONS: config.MAX_TOTAL_CONNECTIONS,
      LOG_HEALTH_CHECK_FAILURES: config.LOG_HEALTH_CHECK_FAILURES
    },
    fastify.log
  );

  // Track connection count for health checks
  let connectionCount = 0;
  const getConnectionCount = () => connectionCount;

  // Register health & metrics endpoints
  registerHealthEndpoints(fastify, healthChecker, getConnectionCount);

  // Initialize roomStore for REST endpoints
  const roomStore = new RoomStore({
    redis: fastify.redis,
    ttlMs: config.ROOM_KEY_TTL_MS,
    maxParticipants: config.ROOM_MAX_PARTICIPANTS
  });

  /**
   * HTTP: Create a room and return a fingerprint.
   * Matches the simple server API for frontend compatibility.
   */
  fastify.post("/rooms", async () => {
    const roomId = randomIdB64Url(16);
    await roomStore.createRoomEmpty(roomId);
    return {
      roomId,
      fingerprint: roomStore.roomFingerprint(roomId),
      networkIp: getLocalNetworkIP()
    };
  });

  /**
   * HTTP: Get a join token for a room.
   * Matches the simple server API for frontend compatibility.
   */
  fastify.get<{ Params: { roomId: string } }>("/rooms/:roomId/token", async (req, reply) => {
    const roomId = req.params.roomId;
    if (!await roomStore.roomExists(roomId)) {
      return reply.code(404).send({ code: "ERR_NO_ROOM" });
    }
    const expUnixMs = Date.now() + 60_000; // 60s rotation
    const token = mintJoinToken(config.JOIN_TOKEN_SECRET, roomId, expUnixMs);
    return { roomId, token, expUnixMs };
  });

  // Legacy healthz endpoint (kept for backward compatibility)
  fastify.get("/healthz", async () => ({ ok: true }));

  // Register signaling for Shredder
  registerSignaling(fastify as any);

  // Register WebSocket handlers (pass connection tracking)
  registerWs(fastify as any, {
    onConnect: () => {
      connectionCount++;
      metrics.incrementGauge("active_connections");
      metrics.incrementCounter("total_connections");
    },
    onDisconnect: () => {
      connectionCount--;
      metrics.decrementGauge("active_connections");
    }
  });

  // Graceful shutdown handler
  if (config.FEATURE_GRACEFUL_SHUTDOWN) {
    const gracefulShutdown = async (signal: string) => {
      fastify.log.info({ signal }, "Received shutdown signal, starting graceful shutdown");

      const shutdownTimeout = setTimeout(() => {
        fastify.log.error("Graceful shutdown timeout, forcing exit");
        process.exit(1);
      }, config.GRACEFUL_SHUTDOWN_TIMEOUT_MS);

      try {
        await fastify.close();
        clearTimeout(shutdownTimeout);
        fastify.log.info("Graceful shutdown complete");
        process.exit(0);
      } catch (err) {
        fastify.log.error({ err }, "Error during graceful shutdown");
        clearTimeout(shutdownTimeout);
        process.exit(1);
      }
    };

    process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
    process.on("SIGINT", () => gracefulShutdown("SIGINT"));
  }

  // Global error handler
  fastify.setErrorHandler((error: any, request, reply) => {
    fastify.log.error({ err: error, requestId: (request as any).id }, "Unhandled error");
    metrics.incrementCounter("unhandled_errors", { path: request.url });

    const statusCode = error?.statusCode || 500;
    const response = config.FEATURE_DETAILED_ERRORS
      ? {
        error: error?.name || "Error",
        message: error?.message || "An error occurred",
        statusCode
      }
      : {
        error: "Internal Server Error",
        statusCode
      };

    return reply.code(statusCode).send(response);
  });

  // Log server configuration on startup
  fastify.log.info(
    {
      version: config.SERVICE_VERSION,
      instanceId: config.INSTANCE_ID,
      environment: config.DEPLOYMENT_ENV,
      nodeEnv: config.NODE_ENV
    },
    "Server configuration loaded"
  );

  return fastify;
}


