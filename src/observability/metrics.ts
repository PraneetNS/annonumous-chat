/**
 * E2EE-Safe Metrics Collection
 * 
 * This module collects ONLY aggregate, non-sensitive metrics that do not
 * violate end-to-end encryption guarantees. We NEVER collect:
 * - Message contents
 * - User identifiers
 * - Room-specific metadata
 * - IP addresses in metrics
 * 
 * Safe to collect:
 * - Connection counts
 * - Message throughput (counts, not contents)
 * - Error rates
 * - Resource utilization
 */

export type MetricType = "counter" | "gauge" | "histogram";

export interface Metric {
    name: string;
    type: MetricType;
    value: number;
    labels?: Record<string, string>;
    timestamp: number;
}

export class MetricsCollector {
    private counters = new Map<string, number>();
    private gauges = new Map<string, number>();
    private histograms = new Map<string, number[]>();
    private startTime = Date.now();

    // Counters (monotonically increasing)
    incrementCounter(name: string, labels?: Record<string, string>, delta = 1): void {
        const key = this.makeKey(name, labels);
        this.counters.set(key, (this.counters.get(key) ?? 0) + delta);
    }

    // Gauges (current value)
    setGauge(name: string, value: number, labels?: Record<string, string>): void {
        const key = this.makeKey(name, labels);
        this.gauges.set(key, value);
    }

    incrementGauge(name: string, labels?: Record<string, string>, delta = 1): void {
        const key = this.makeKey(name, labels);
        this.gauges.set(key, (this.gauges.get(key) ?? 0) + delta);
    }

    decrementGauge(name: string, labels?: Record<string, string>, delta = 1): void {
        const key = this.makeKey(name, labels);
        this.gauges.set(key, Math.max(0, (this.gauges.get(key) ?? 0) - delta));
    }

    // Histograms (distribution of values)
    recordHistogram(name: string, value: number, labels?: Record<string, string>): void {
        const key = this.makeKey(name, labels);
        const values = this.histograms.get(key) ?? [];
        values.push(value);
        // Keep only last 1000 values to prevent memory growth
        if (values.length > 1000) values.shift();
        this.histograms.set(key, values);
    }

    // Get all metrics
    getMetrics(): Metric[] {
        const metrics: Metric[] = [];
        const now = Date.now();

        // Counters
        for (const [key, value] of this.counters.entries()) {
            const { name, labels } = this.parseKey(key);
            metrics.push({ name, type: "counter", value, labels, timestamp: now });
        }

        // Gauges
        for (const [key, value] of this.gauges.entries()) {
            const { name, labels } = this.parseKey(key);
            metrics.push({ name, type: "gauge", value, labels, timestamp: now });
        }

        // Histograms (compute percentiles)
        for (const [key, values] of this.histograms.entries()) {
            const { name, labels } = this.parseKey(key);
            if (values.length === 0) continue;

            const sorted = [...values].sort((a, b) => a - b);
            const p50 = sorted[Math.floor(sorted.length * 0.5)];
            const p95 = sorted[Math.floor(sorted.length * 0.95)];
            const p99 = sorted[Math.floor(sorted.length * 0.99)];

            metrics.push({
                name: `${name}_p50`,
                type: "gauge",
                value: p50,
                labels,
                timestamp: now
            });
            metrics.push({
                name: `${name}_p95`,
                type: "gauge",
                value: p95,
                labels,
                timestamp: now
            });
            metrics.push({
                name: `${name}_p99`,
                type: "gauge",
                value: p99,
                labels,
                timestamp: now
            });
        }

        // Add uptime
        metrics.push({
            name: "uptime_seconds",
            type: "gauge",
            value: Math.floor((now - this.startTime) / 1000),
            timestamp: now
        });

        return metrics;
    }

    // Export in Prometheus format
    exportPrometheus(): string {
        const metrics = this.getMetrics();
        const lines: string[] = [];

        for (const metric of metrics) {
            const labelStr = metric.labels
                ? `{${Object.entries(metric.labels)
                    .map(([k, v]) => `${k}="${v}"`)
                    .join(",")}}`
                : "";

            lines.push(`# TYPE ${metric.name} ${metric.type}`);
            lines.push(`${metric.name}${labelStr} ${metric.value} ${metric.timestamp}`);
        }

        return lines.join("\n") + "\n";
    }

    // Export as JSON
    exportJSON(): Record<string, unknown> {
        const metrics = this.getMetrics();
        const result: Record<string, unknown> = {};

        for (const metric of metrics) {
            const key = metric.labels
                ? `${metric.name}{${Object.entries(metric.labels)
                    .map(([k, v]) => `${k}="${v}"`)
                    .join(",")}}`
                : metric.name;

            result[key] = {
                type: metric.type,
                value: metric.value,
                timestamp: metric.timestamp
            };
        }

        return result;
    }

    reset(): void {
        this.counters.clear();
        this.gauges.clear();
        this.histograms.clear();
    }

    private makeKey(name: string, labels?: Record<string, string>): string {
        if (!labels || Object.keys(labels).length === 0) return name;
        const labelStr = Object.entries(labels)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => `${k}="${v}"`)
            .join(",");
        return `${name}{${labelStr}}`;
    }

    private parseKey(key: string): { name: string; labels?: Record<string, string> } {
        const match = key.match(/^([^{]+)(?:\{(.+)\})?$/);
        if (!match) return { name: key };

        const name = match[1];
        const labelStr = match[2];

        if (!labelStr) return { name };

        const labels: Record<string, string> = {};
        for (const pair of labelStr.split(",")) {
            const [k, v] = pair.split("=");
            if (k && v) labels[k] = v.replace(/^"|"$/g, "");
        }

        return { name, labels };
    }
}

// Global singleton
let globalMetrics: MetricsCollector | null = null;

export function getMetrics(): MetricsCollector {
    if (!globalMetrics) globalMetrics = new MetricsCollector();
    return globalMetrics;
}

export function resetMetrics(): void {
    globalMetrics = null;
}
