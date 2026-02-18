import type { FastifyInstance } from "fastify";
import type Redis from "ioredis";
import { getMetrics } from "./metrics.js";

export interface HealthCheckResult {
    status: "healthy" | "degraded" | "unhealthy";
    timestamp: number;
    uptime: number;
    checks: {
        redis: HealthStatus;
        memory: HealthStatus;
        connections: HealthStatus;
    };
    version: string;
    instanceId: string;
}

export interface HealthStatus {
    status: "pass" | "warn" | "fail";
    message?: string;
    observedValue?: number;
    observedUnit?: string;
}

export interface ReadinessCheckResult {
    ready: boolean;
    timestamp: number;
    checks: {
        redis: boolean;
        configLoaded: boolean;
    };
}

export class HealthChecker {
    private startTime = Date.now();

    constructor(
        private redis: Redis,
        private config: {
            SERVICE_VERSION: string;
            INSTANCE_ID: string;
            MAX_TOTAL_CONNECTIONS: number;
            LOG_HEALTH_CHECK_FAILURES: boolean;
        },
        private logger: any
    ) { }

    async checkHealth(currentConnections: number): Promise<HealthCheckResult> {
        const redisHealth = await this.checkRedis();
        const memoryHealth = this.checkMemory();
        const connectionsHealth = this.checkConnections(currentConnections);

        const allPassing = [redisHealth, memoryHealth, connectionsHealth].every(
            (check) => check.status === "pass"
        );
        const anyFailing = [redisHealth, memoryHealth, connectionsHealth].some(
            (check) => check.status === "fail"
        );

        const overallStatus = anyFailing ? "unhealthy" : allPassing ? "healthy" : "degraded";

        const result: HealthCheckResult = {
            status: overallStatus,
            timestamp: Date.now(),
            uptime: Math.floor((Date.now() - this.startTime) / 1000),
            checks: {
                redis: redisHealth,
                memory: memoryHealth,
                connections: connectionsHealth
            },
            version: this.config.SERVICE_VERSION,
            instanceId: this.config.INSTANCE_ID
        };

        if (this.config.LOG_HEALTH_CHECK_FAILURES && overallStatus !== "healthy") {
            this.logger.warn({ health: result }, "Health check failed");
        }

        return result;
    }

    async checkReadiness(): Promise<ReadinessCheckResult> {
        const redisReady = await this.isRedisReady();
        const configLoaded = true; // If we got here, config is loaded

        return {
            ready: redisReady && configLoaded,
            timestamp: Date.now(),
            checks: {
                redis: redisReady,
                configLoaded
            }
        };
    }

    private async checkRedis(): Promise<HealthStatus> {
        try {
            const start = Date.now();
            await this.redis.ping();
            const latency = Date.now() - start;

            if (latency > 1000) {
                return {
                    status: "warn",
                    message: "Redis latency high",
                    observedValue: latency,
                    observedUnit: "ms"
                };
            }

            return {
                status: "pass",
                observedValue: latency,
                observedUnit: "ms"
            };
        } catch (err) {
            return {
                status: "fail",
                message: err instanceof Error ? err.message : "Redis connection failed"
            };
        }
    }

    private async isRedisReady(): Promise<boolean> {
        try {
            await this.redis.ping();
            return true;
        } catch {
            return false;
        }
    }

    private checkMemory(): HealthStatus {
        const usage = process.memoryUsage();
        const heapUsedMB = Math.round(usage.heapUsed / 1024 / 1024);
        const heapTotalMB = Math.round(usage.heapTotal / 1024 / 1024);
        const heapUsagePercent = Math.round((usage.heapUsed / usage.heapTotal) * 100);

        // Warn if heap usage > 80%
        if (heapUsagePercent > 80) {
            return {
                status: "warn",
                message: `High memory usage: ${heapUsedMB}MB / ${heapTotalMB}MB (${heapUsagePercent}%)`,
                observedValue: heapUsagePercent,
                observedUnit: "percent"
            };
        }

        // Fail if heap usage > 95%
        if (heapUsagePercent > 95) {
            return {
                status: "fail",
                message: `Critical memory usage: ${heapUsedMB}MB / ${heapTotalMB}MB (${heapUsagePercent}%)`,
                observedValue: heapUsagePercent,
                observedUnit: "percent"
            };
        }

        return {
            status: "pass",
            observedValue: heapUsedMB,
            observedUnit: "MB"
        };
    }

    private checkConnections(current: number): HealthStatus {
        const percent = Math.round((current / this.config.MAX_TOTAL_CONNECTIONS) * 100);

        if (percent > 90) {
            return {
                status: "warn",
                message: `Connection capacity at ${percent}%`,
                observedValue: current,
                observedUnit: "connections"
            };
        }

        return {
            status: "pass",
            observedValue: current,
            observedUnit: "connections"
        };
    }
}

export function registerHealthEndpoints(fastify: any, healthChecker: HealthChecker, getCurrentConnectionCount: () => number) {
    const config = fastify.config;

    // Health check endpoint (detailed)
    if (config.FEATURE_HEALTH_ENDPOINT) {
        fastify.get("/health", async (req: any, reply: any) => {
            const health = await healthChecker.checkHealth(getCurrentConnectionCount());
            const statusCode = health.status === "healthy" ? 200 : health.status === "degraded" ? 200 : 503;
            return reply.code(statusCode).send(health);
        });
    }

    // Readiness probe (simple boolean)
    if (config.FEATURE_READINESS_ENDPOINT) {
        fastify.get("/ready", async (req: any, reply: any) => {
            const readiness = await healthChecker.checkReadiness();
            const statusCode = readiness.ready ? 200 : 503;
            return reply.code(statusCode).send(readiness);
        });
    }

    // Liveness probe (always returns 200 if process is running)
    fastify.get("/live", async () => {
        return { alive: true, timestamp: Date.now() };
    });

    // Metrics endpoint
    if (config.FEATURE_METRICS_ENDPOINT) {
        fastify.get("/metrics", async (req: any, reply: any) => {
            const metrics = getMetrics();

            // Support both Prometheus and JSON formats
            const acceptHeader = req.headers.accept || "";
            if (config.METRICS_EXPORT_PROMETHEUS && acceptHeader.includes("text/plain")) {
                return reply.type("text/plain; version=0.0.4").send(metrics.exportPrometheus());
            }

            return reply.send({
                timestamp: Date.now(),
                metrics: metrics.exportJSON()
            });
        });
    }
}
