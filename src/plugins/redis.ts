import fp from "fastify-plugin";
import Redis from "ioredis";
import type { FastifyInstance } from "fastify";
import type { Config } from "../config.js";
import { getMetrics } from "../observability/metrics.js";

declare module "fastify" {
  interface FastifyInstance {
    redis: Redis;
    config: Config;
  }
}

export const redisPlugin = fp(async (fastify: FastifyInstance) => {
  const config = fastify.config;
  const metrics = getMetrics();

  const redis = new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: config.REDIS_MAX_RETRIES_PER_REQUEST,
    enableReadyCheck: config.REDIS_ENABLE_READY_CHECK,
    connectTimeout: config.REDIS_CONNECT_TIMEOUT,
    lazyConnect: false,
    retryStrategy(times) {
      // Exponential backoff with max 3 seconds
      const delay = Math.min(times * 100, 3000);
      fastify.log.warn({ attempt: times, delayMs: delay }, "Redis reconnecting");
      metrics.incrementCounter("redis_reconnect_attempts");
      return delay;
    }
  });

  redis.on("error", (err) => {
    fastify.log.error({ err }, "Redis error");
    metrics.incrementCounter("redis_errors", { type: "connection" });
  });

  redis.on("connect", () => {
    fastify.log.info("Redis connected");
    metrics.incrementCounter("redis_connects");
  });

  redis.on("ready", () => {
    fastify.log.info("Redis ready");
    metrics.setGauge("redis_ready", 1);
  });

  redis.on("close", () => {
    fastify.log.warn("Redis connection closed");
    metrics.setGauge("redis_ready", 0);
  });

  redis.on("reconnecting", () => {
    fastify.log.info("Redis reconnecting");
    metrics.incrementCounter("redis_reconnects");
  });

  // Initial connection check
  try {
    await redis.ping();
    fastify.log.info("Redis initial ping successful");
  } catch (err) {
    fastify.log.error({ err }, "Redis initial ping failed");
    throw new Error("Failed to connect to Redis");
  }

  fastify.decorate("redis", redis);

  fastify.addHook("onClose", async () => {
    fastify.log.info("Closing Redis connection");
    await redis.quit();
  });
});

