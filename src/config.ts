import { z } from "zod";
import { randomBytes } from "crypto";

// Helper to parse boolean env vars
const booleanString = z
  .string()
  .default("false")
  .transform((val) => val.toLowerCase() === "true");

const envSchema = z.object({
  // Server configuration
  NODE_ENV: z.enum(["development", "production", "test"]).default("production"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(3001),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  LOG_FORMAT: z.enum(["json", "pretty"]).default("json"),
  LOG_REQUESTS: booleanString,
  TRUST_PROXY: booleanString,

  // Redis configuration
  REDIS_URL: z.string().min(1),
  REDIS_MAX_RETRIES_PER_REQUEST: z.coerce.number().int().min(0).default(3),
  REDIS_ENABLE_READY_CHECK: booleanString,
  REDIS_CONNECT_TIMEOUT: z.coerce.number().int().min(1000).default(10_000),

  // Cryptographic secrets
  JOIN_TOKEN_SECRET: z.string().min(32),

  // Room configuration
  ROOM_MAX_PARTICIPANTS: z.coerce.number().int().min(1).max(50).default(10),
  ROOM_KEY_TTL_MS: z.coerce.number().int().min(60_000).default(600_000),
  QR_ROTATION_MS: z.coerce.number().int().min(10_000).default(60_000),

  // Message size limits
  MAX_WS_MSG_BYTES: z.coerce.number().int().min(1024).default(262_144),
  MAX_APP_CIPHERTEXT_BYTES: z.coerce.number().int().min(1024).default(65_536),

  // Rate limiting & flood protection
  MAX_MSGS_PER_10S: z.coerce.number().int().min(1).default(200),
  MAX_BYTES_PER_10S: z.coerce.number().int().min(1024).default(1_048_576),
  MAX_CONNS_PER_IP: z.coerce.number().int().min(1).default(50),
  MAX_TOTAL_CONNECTIONS: z.coerce.number().int().min(1).default(10_000),
  MAX_ROOM_CREATES_PER_IP_PER_MIN: z.coerce.number().int().min(1).default(10),

  // Feature toggles
  FEATURE_HEALTH_ENDPOINT: booleanString,
  FEATURE_METRICS_ENDPOINT: booleanString,
  FEATURE_READINESS_ENDPOINT: booleanString,
  FEATURE_GRACEFUL_SHUTDOWN: booleanString,
  GRACEFUL_SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30_000),
  FEATURE_DETAILED_ERRORS: booleanString,
  FEATURE_CORS: booleanString,
  FEATURE_SECURITY_HEADERS: booleanString,
  FEATURE_REQUEST_ID: booleanString,

  // CORS configuration
  CORS_ALLOWED_ORIGINS: z.string().default("*"),
  CORS_ALLOW_CREDENTIALS: booleanString,

  // Security headers
  CSP_DIRECTIVES: z.string().default("default-src 'none'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"),
  HSTS_MAX_AGE: z.coerce.number().int().min(0).default(31_536_000),
  HSTS_INCLUDE_SUBDOMAINS: booleanString,
  HSTS_PRELOAD: booleanString,

  // Observability
  METRICS_EXPORT_PROMETHEUS: booleanString,
  METRICS_COLLECTION_INTERVAL_MS: z.coerce.number().int().min(1000).default(15_000),

  // Abuse prevention
  FEATURE_IP_TRACKING: booleanString,
  FEATURE_TOKEN_REPLAY_PROTECTION: booleanString,
  FEATURE_SLOW_CONSUMER_PROTECTION: booleanString,
  SLOW_CONSUMER_BUFFER_THRESHOLD: z.coerce.number().int().min(1024).default(524_288),
  FEATURE_AUTO_ROOM_CLEANUP: booleanString,

  // Performance tuning
  WS_PING_INTERVAL_MS: z.coerce.number().int().min(1000).default(30_000),
  WS_PING_TIMEOUT_MS: z.coerce.number().int().min(1000).default(5_000),
  HTTP_KEEP_ALIVE_TIMEOUT_MS: z.coerce.number().int().min(1000).default(65_000),

  // Monitoring & alerting
  LOG_HEALTH_CHECK_FAILURES: booleanString,
  FEATURE_ERROR_ALERTING: booleanString,
  ERROR_ALERT_WEBHOOK_URL: z.string().optional(),

  // Deployment metadata
  SERVICE_VERSION: z.string().default("0.1.0"),
  DEPLOYMENT_ENV: z.string().default("production"),
  INSTANCE_ID: z.string().default(() => randomBytes(8).toString("hex"))
});

export type Config = z.infer<typeof envSchema>;

let cachedConfig: Config | null = null;

export function loadConfig(): Config {
  if (cachedConfig) return cachedConfig;

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    // Intentionally do not log user-provided message contents; this is config-only.
    // eslint-disable-next-line no-console
    console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
    throw new Error("Invalid environment configuration");
  }

  cachedConfig = parsed.data;
  return cachedConfig;
}

export function resetConfig(): void {
  cachedConfig = null;
}

