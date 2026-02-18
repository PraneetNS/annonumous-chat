import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { Config } from "../config.js";
import { HttpRateLimiter } from "../security/rateLimit.js";

/**
 * Security headers middleware
 * Implements defense-in-depth security headers for production deployment
 */
export function registerSecurityHeaders(fastify: any) {
    const config: Config = fastify.config;

    if (!config.FEATURE_SECURITY_HEADERS) return;

    fastify.addHook("onSend", async (req: FastifyRequest, reply: FastifyReply) => {
        // Content Security Policy
        reply.header("Content-Security-Policy", config.CSP_DIRECTIVES);

        // HTTP Strict Transport Security (HSTS)
        if (config.NODE_ENV === "production") {
            let hstsValue = `max-age=${config.HSTS_MAX_AGE}`;
            if (config.HSTS_INCLUDE_SUBDOMAINS) hstsValue += "; includeSubDomains";
            if (config.HSTS_PRELOAD) hstsValue += "; preload";
            reply.header("Strict-Transport-Security", hstsValue);
        }

        // Prevent MIME type sniffing
        reply.header("X-Content-Type-Options", "nosniff");

        // Prevent clickjacking
        reply.header("X-Frame-Options", "DENY");

        // Disable browser features that could leak information
        reply.header("Permissions-Policy", "geolocation=(), microphone=(), camera=()");

        // Referrer policy (don't leak referrer to external sites)
        reply.header("Referrer-Policy", "strict-origin-when-cross-origin");

        // Remove server identification
        reply.removeHeader("X-Powered-By");
        reply.removeHeader("Server");
    });
}

/**
 * CORS middleware
 * Configurable cross-origin resource sharing
 */
export function registerCORS(fastify: any) {
    const config: Config = fastify.config;

    if (!config.FEATURE_CORS) return;

    const allowedOrigins = config.CORS_ALLOWED_ORIGINS.split(",").map((o) => o.trim());

    fastify.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
        const origin = req.headers.origin;

        // Check if origin is allowed
        const isAllowed =
            allowedOrigins.includes("*") ||
            (origin && allowedOrigins.includes(origin));

        if (isAllowed) {
            reply.header("Access-Control-Allow-Origin", origin || "*");

            if (config.CORS_ALLOW_CREDENTIALS) {
                reply.header("Access-Control-Allow-Credentials", "true");
            }

            reply.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
            reply.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
            reply.header("Access-Control-Max-Age", "86400"); // 24 hours
        }

        // Handle preflight requests
        if (req.method === "OPTIONS") {
            return reply.code(204).send();
        }
    });
}

/**
 * Request ID middleware
 * Adds unique request ID for distributed tracing
 */
export function registerRequestId(fastify: any) {
    const config: Config = fastify.config;

    if (!config.FEATURE_REQUEST_ID) return;

    fastify.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
        // Use existing request ID from header, or generate new one
        const requestId =
            (req.headers["x-request-id"] as string) ||
            `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

        // Attach to request for logging
        (req as any).id = requestId;

        // Echo back in response
        reply.header("X-Request-Id", requestId);
    });
}

/**
 * Rate limiting for HTTP endpoints (not WebSocket)
 * Prevents abuse of health/metrics endpoints
 */
export function registerHttpRateLimit(fastify: any) {
    // 200 requests per minute per IP — generous for normal use, blocks scrapers/bots
    const limiter = new HttpRateLimiter(200, 60_000);

    // Global concurrent request cap — prevents request pile-up under load
    let activeRequests = 0;
    const MAX_CONCURRENT = 500;

    fastify.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
        // Skip rate limiting for WebSocket upgrade requests
        if (req.headers.upgrade === "websocket") return;

        // Global concurrency cap
        if (activeRequests >= MAX_CONCURRENT) {
            return reply.code(503).send({
                error: "Service Unavailable",
                message: "Server is busy. Please retry shortly.",
                retryAfter: 2
            });
        }
        activeRequests++;

        const ip = req.ip;
        if (!limiter.check(ip)) {
            activeRequests--;
            return reply.code(429).send({
                error: "Too Many Requests",
                message: "Rate limit exceeded. Please try again later.",
                retryAfter: 60
            });
        }
    });

    fastify.addHook("onResponse", async () => {
        if (activeRequests > 0) activeRequests--;
    });

    fastify.addHook("onError", async () => {
        if (activeRequests > 0) activeRequests--;
    });
}
