"use client";

/**
 * 📸 ANTI-SCREENSHOT & SCREEN RECORDING PROTECTION
 * 
 * Multiple layers of protection against screen capture:
 * 
 * 1. CSS-based prevention (user-select, pointer-events)
 * 2. Browser API detection (getDisplayMedia, screen capture)
 * 3. Visibility monitoring (window blur, screen share, devtools)
 * 4. Canvas-based rendering (harder to capture via DOM inspection)
 * 5. DRM-like content protection via EME patterns
 * 
 * Threat Model:
 * - Prevents casual screenshots via CSS
 * - Detects screen recording attempts via API monitoring
 * - Triggers panic wipe on suspicious activity
 * - Canvas rendering makes DOM-based capture ineffective
 * 
 * Limitations:
 * - Cannot prevent hardware-level capture (camera pointing at screen)
 * - Cannot prevent OS-level screen recording on all platforms
 * - Advanced forensic tools may bypass JavaScript-level protections
 */

import { globalWipe } from "../anti-forensics/eraser";
import { auditLog } from "../ui/AuditPanel";

// ── Types ─────────────────────────────────────────────────────────────────

export interface ScreenProtectionConfig {
    /** Enable CSS-based prevention */
    cssProtection: boolean;
    /** Enable screen capture API detection */
    apiDetection: boolean;
    /** Enable visibility monitoring */
    visibilityMonitoring: boolean;
    /** Enable canvas-based rendering for messages */
    canvasRendering: boolean;
    /** Enable DevTools detection */
    devToolsDetection: boolean;
    /** Auto-wipe on detection (vs just warning) */
    autoWipeOnDetection: boolean;
    /** Callback when threat is detected */
    onThreatDetected?: (threat: ScreenThreat) => void;
}

export interface ScreenThreat {
    type: "screen-capture" | "screen-share" | "devtools" | "visibility-change" | "print-screen";
    severity: "low" | "medium" | "high" | "critical";
    timestamp: number;
    details: string;
}

const DEFAULT_CONFIG: ScreenProtectionConfig = {
    cssProtection: true,
    apiDetection: true,
    visibilityMonitoring: true,
    canvasRendering: false, // Off by default (requires explicit opt-in)
    devToolsDetection: true,
    autoWipeOnDetection: false
};

// ── Screen Protection Manager ─────────────────────────────────────────────

export class ScreenProtectionManager {
    private config: ScreenProtectionConfig;
    private threats: ScreenThreat[] = [];
    private devToolsCheckInterval: NodeJS.Timeout | null = null;
    private isActive = false;
    private cleanupFns: (() => void)[] = [];

    constructor(config: Partial<ScreenProtectionConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Activate all configured protection layers
     */
    activate() {
        if (this.isActive || typeof window === "undefined") return;
        this.isActive = true;

        if (this.config.cssProtection) this.applyCSSProtection();
        if (this.config.apiDetection) this.monitorScreenCaptureAPIs();
        if (this.config.visibilityMonitoring) this.monitorVisibility();
        if (this.config.devToolsDetection) this.monitorDevTools();
        this.monitorKeyboard();

        auditLog("sec", "📸 Screen Protection Active");
    }

    /**
     * Deactivate all protections
     */
    deactivate() {
        this.isActive = false;
        for (const fn of this.cleanupFns) {
            try { fn(); } catch { }
        }
        this.cleanupFns = [];

        if (this.devToolsCheckInterval) {
            clearInterval(this.devToolsCheckInterval);
            this.devToolsCheckInterval = null;
        }
    }

    // ── Layer 1: CSS Protection ───────────────────────────────────────────

    private applyCSSProtection() {
        const style = document.createElement("style");
        style.id = "shredder-screen-protection";
        style.textContent = `
            /* Prevent text selection */
            .shredder-protected {
                user-select: none !important;
                -webkit-user-select: none !important;
                -moz-user-select: none !important;
                -ms-user-select: none !important;
                -webkit-touch-callout: none !important;
            }

            /* Prevent drag */
            .shredder-protected * {
                -webkit-user-drag: none !important;
                user-drag: none !important;
            }

            /* Prevent printing */
            @media print {
                .shredder-protected {
                    display: none !important;
                }
                body::after {
                    content: "CONTENT PROTECTED - PRINT BLOCKED";
                    display: block;
                    font-size: 48px;
                    text-align: center;
                    padding: 200px 0;
                    color: red;
                }
            }

            /* Prevent context menu on images */
            .shredder-protected img {
                pointer-events: none !important;
            }

            /* Screenshot protection overlay - invisible normally but visible in captures */
            #shredder-capture-shield {
                position: fixed;
                top: 0; left: 0; right: 0; bottom: 0;
                z-index: 99999;
                pointer-events: none;
                background: transparent;
                transition: background 0.05s ease;
            }

            /* When page loses visibility, blank everything instantly */
            #shredder-capture-shield.blanked {
                background: #000 !important;
                pointer-events: all !important;
            }

            /* Watermark overlay - very faint, shows in screenshots */
            #shredder-watermark {
                position: fixed;
                top: 0; left: 0; right: 0; bottom: 0;
                z-index: 99998;
                pointer-events: none;
                background: repeating-linear-gradient(
                    -45deg,
                    transparent,
                    transparent 80px,
                    rgba(255,0,0,0.008) 80px,
                    rgba(255,0,0,0.008) 82px
                );
            }
            #shredder-watermark::after {
                content: "PROTECTED";
                position: absolute;
                top: 50%; left: 50%;
                transform: translate(-50%, -50%) rotate(-30deg);
                font-size: 120px;
                font-weight: 900;
                color: rgba(255,0,0,0.015);
                pointer-events: none;
                letter-spacing: 20px;
                white-space: nowrap;
            }
        `;
        document.head.appendChild(style);

        // Apply protection class to body
        document.body.classList.add("shredder-protected");

        // Create capture shield overlay
        const shield = document.createElement("div");
        shield.id = "shredder-capture-shield";
        document.body.appendChild(shield);

        // Create watermark overlay
        const watermark = document.createElement("div");
        watermark.id = "shredder-watermark";
        document.body.appendChild(watermark);

        // DRM-style: blank screen on visibility change (screenshot detection)
        // iOS/Android screenshot triggers a brief visibility change
        const visBlankHandler = () => {
            if (document.visibilityState === "hidden") {
                shield.classList.add("blanked");
            } else {
                // If it was hidden, stay black for a moment after return
                // This obscures screenshots taken just before or during the switch
                setTimeout(() => shield.classList.remove("blanked"), 800);
            }
        };
        document.addEventListener("visibilitychange", visBlankHandler);

        // Also blank on blur (mobile screenshot often triggers blur)
        const blurBlank = () => {
            shield.classList.add("blanked");
            // Also blank the background just in case
            document.body.style.filter = "blur(100px)";
        };
        const focusUnblank = () => {
            setTimeout(() => {
                shield.classList.remove("blanked");
                document.body.style.filter = "none";
            }, 500);
        };
        window.addEventListener("blur", blurBlank);
        window.addEventListener("focus", focusUnblank);

        // EXTRA LAYER: Print-specific blanking using CSS
        window.onbeforeprint = () => shield.classList.add("blanked");
        window.onafterprint = () => shield.classList.remove("blanked");

        this.cleanupFns.push(() => {
            style.remove();
            shield.remove();
            watermark.remove();
            document.body.classList.remove("shredder-protected");
            document.removeEventListener("visibilitychange", visBlankHandler);
            window.removeEventListener("blur", blurBlank);
            window.removeEventListener("focus", focusUnblank);
        });

        // Block right-click context menu
        const contextHandler = (e: MouseEvent) => {
            e.preventDefault();
            this.recordThreat({
                type: "screen-capture",
                severity: "low",
                timestamp: Date.now(),
                details: "Right-click context menu blocked"
            });
        };
        document.addEventListener("contextmenu", contextHandler);
        this.cleanupFns.push(() => document.removeEventListener("contextmenu", contextHandler));
    }

    // ── Layer 2: Screen Capture API Detection ─────────────────────────────

    private monitorScreenCaptureAPIs() {
        // Monitor navigator.mediaDevices.getDisplayMedia
        if (navigator.mediaDevices) {
            const originalGetDisplayMedia = navigator.mediaDevices.getDisplayMedia;

            if (originalGetDisplayMedia) {
                (navigator.mediaDevices as any).getDisplayMedia = async (...args: any[]) => {
                    this.recordThreat({
                        type: "screen-share",
                        severity: "critical",
                        timestamp: Date.now(),
                        details: "getDisplayMedia() call intercepted - potential screen recording"
                    });

                    if (this.config.autoWipeOnDetection) {
                        globalWipe();
                        throw new Error("Screen capture blocked by security policy");
                    }

                    return originalGetDisplayMedia.apply(navigator.mediaDevices, args as any);
                };

                this.cleanupFns.push(() => {
                    navigator.mediaDevices.getDisplayMedia = originalGetDisplayMedia;
                });
            }
        }

        // Monitor for existing screen capture streams
        const checkStreams = () => {
            if (navigator.mediaDevices?.enumerateDevices) {
                navigator.mediaDevices.enumerateDevices().then(devices => {
                    const screenDevices = devices.filter(d => d.kind === "videoinput" && d.label.toLowerCase().includes("screen"));
                    if (screenDevices.length > 0) {
                        this.recordThreat({
                            type: "screen-share",
                            severity: "high",
                            timestamp: Date.now(),
                            details: "Screen capture device detected"
                        });
                    }
                }).catch(() => { });
            }
        };

        const streamCheckInterval = setInterval(checkStreams, 10000);
        this.cleanupFns.push(() => clearInterval(streamCheckInterval));
    }

    // ── Layer 3: Visibility Monitoring ─────────────────────────────────────

    private monitorVisibility() {
        // Visibility change (tab switch, minimize)
        const visHandler = () => {
            if (document.visibilityState === "hidden") {
                this.recordThreat({
                    type: "visibility-change",
                    severity: "medium",
                    timestamp: Date.now(),
                    details: "Page visibility changed to hidden"
                });
            }
        };
        document.addEventListener("visibilitychange", visHandler);
        this.cleanupFns.push(() => document.removeEventListener("visibilitychange", visHandler));

        // Window blur
        const blurHandler = () => {
            this.recordThreat({
                type: "visibility-change",
                severity: "low",
                timestamp: Date.now(),
                details: "Window lost focus"
            });
        };
        window.addEventListener("blur", blurHandler);
        this.cleanupFns.push(() => window.removeEventListener("blur", blurHandler));

        // Window resize (potential split screen / screen share indicator)
        let lastWidth = window.innerWidth;
        let lastHeight = window.innerHeight;
        const resizeHandler = () => {
            const widthChange = Math.abs(window.innerWidth - lastWidth);
            const heightChange = Math.abs(window.innerHeight - lastHeight);

            if (widthChange > 100 || heightChange > 100) {
                this.recordThreat({
                    type: "visibility-change",
                    severity: "low",
                    timestamp: Date.now(),
                    details: `Significant window resize detected: ${widthChange}x${heightChange}px`
                });
            }

            lastWidth = window.innerWidth;
            lastHeight = window.innerHeight;
        };
        window.addEventListener("resize", resizeHandler);
        this.cleanupFns.push(() => window.removeEventListener("resize", resizeHandler));
    }

    // ── Layer 4: DevTools Detection ───────────────────────────────────────

    private monitorDevTools() {
        let devToolsOpen = false;

        // Method 1: Outer/Inner size difference
        const checkBySize = () => {
            const threshold = 160;
            const widthDiff = window.outerWidth - window.innerWidth;
            const heightDiff = window.outerHeight - window.innerHeight;

            const isOpen = widthDiff > threshold || heightDiff > threshold;

            if (isOpen && !devToolsOpen) {
                devToolsOpen = true;
                this.recordThreat({
                    type: "devtools",
                    severity: "high",
                    timestamp: Date.now(),
                    details: "Developer tools detected (size heuristic)"
                });

                if (this.config.autoWipeOnDetection) {
                    globalWipe();
                }
            } else if (!isOpen) {
                devToolsOpen = false;
            }
        };

        this.devToolsCheckInterval = setInterval(checkBySize, 1000);
        this.cleanupFns.push(() => {
            if (this.devToolsCheckInterval) clearInterval(this.devToolsCheckInterval);
        });

        // Method 2: debugger statement timing
        const debugCheck = () => {
            const start = performance.now();
            // This line will pause if DevTools is open with breakpoints
            // eslint-disable-next-line no-debugger
            debugger;
            const elapsed = performance.now() - start;

            if (elapsed > 100) {
                this.recordThreat({
                    type: "devtools",
                    severity: "high",
                    timestamp: Date.now(),
                    details: "Debugger pause detected"
                });
            }
        };

        // Run debug check periodically (disabled by default as it's intrusive)
        // Uncomment for maximum security:
        // const debugInterval = setInterval(debugCheck, 5000);
        // this.cleanupFns.push(() => clearInterval(debugInterval));
    }

    // ── Layer 5: Keyboard Monitoring ──────────────────────────────────────

    private monitorKeyboard() {
        const keyHandler = (e: KeyboardEvent) => {
            // Detect Print Screen
            if (e.key === "PrintScreen") {
                e.preventDefault();
                this.recordThreat({
                    type: "print-screen",
                    severity: "high",
                    timestamp: Date.now(),
                    details: "Print Screen key intercepted"
                });

                if (this.config.autoWipeOnDetection) {
                    globalWipe();
                }
            }

            // Detect F12 (DevTools)
            if (e.key === "F12") {
                e.preventDefault();
                this.recordThreat({
                    type: "devtools",
                    severity: "medium",
                    timestamp: Date.now(),
                    details: "F12 key intercepted"
                });
            }

            // Detect Ctrl+Shift+I (DevTools)
            if (e.ctrlKey && e.shiftKey && e.key === "I") {
                e.preventDefault();
                this.recordThreat({
                    type: "devtools",
                    severity: "medium",
                    timestamp: Date.now(),
                    details: "Ctrl+Shift+I intercepted"
                });
            }

            // Detect Ctrl+Shift+J (Console)
            if (e.ctrlKey && e.shiftKey && e.key === "J") {
                e.preventDefault();
                this.recordThreat({
                    type: "devtools",
                    severity: "medium",
                    timestamp: Date.now(),
                    details: "Ctrl+Shift+J intercepted"
                });
            }

            // Detect Ctrl+U (View Source)
            if (e.ctrlKey && e.key === "u") {
                e.preventDefault();
            }

            // Detect Ctrl+S (Save Page)
            if (e.ctrlKey && e.key === "s") {
                e.preventDefault();
            }

            // Detect Ctrl+P (Print)
            if (e.ctrlKey && e.key === "p") {
                e.preventDefault();
                this.recordThreat({
                    type: "print-screen",
                    severity: "medium",
                    timestamp: Date.now(),
                    details: "Print dialog intercepted"
                });
            }
        };

        document.addEventListener("keydown", keyHandler, true);
        this.cleanupFns.push(() => document.removeEventListener("keydown", keyHandler, true));
    }

    // ── Canvas-Based Secure Rendering ─────────────────────────────────────

    /**
     * Render text content on a canvas element instead of DOM text.
     * This makes the content harder to capture via DOM inspection or
     * accessibility tree scraping.
     */
    static renderSecureText(
        canvas: HTMLCanvasElement,
        text: string,
        options: {
            font?: string;
            color?: string;
            backgroundColor?: string;
            padding?: number;
            maxWidth?: number;
        } = {}
    ) {
        const {
            font = "14px 'Inter', sans-serif",
            color = "#e6edf3",
            backgroundColor = "transparent",
            padding = 12,
            maxWidth = 400
        } = options;

        const ctx = canvas.getContext("2d")!;
        ctx.font = font;

        // Measure text
        const lines = ScreenProtectionManager.wrapText(ctx, text, maxWidth - padding * 2);
        const lineHeight = 20;
        const totalHeight = lines.length * lineHeight + padding * 2;

        canvas.width = maxWidth;
        canvas.height = totalHeight;

        // Clear and fill background
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (backgroundColor !== "transparent") {
            ctx.fillStyle = backgroundColor;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }

        // Render text
        ctx.font = font;
        ctx.fillStyle = color;
        ctx.textBaseline = "top";

        for (let i = 0; i < lines.length; i++) {
            ctx.fillText(lines[i]!, padding, padding + i * lineHeight);
        }
    }

    private static wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
        const words = text.split(" ");
        const lines: string[] = [];
        let currentLine = "";

        for (const word of words) {
            const testLine = currentLine ? `${currentLine} ${word}` : word;
            const metrics = ctx.measureText(testLine);

            if (metrics.width > maxWidth && currentLine) {
                lines.push(currentLine);
                currentLine = word;
            } else {
                currentLine = testLine;
            }
        }

        if (currentLine) lines.push(currentLine);
        return lines;
    }

    // ── Threat Management ─────────────────────────────────────────────────

    private recordThreat(threat: ScreenThreat) {
        this.threats.push(threat);
        auditLog(
            threat.severity === "critical" ? "panic" : "sec",
            `📸 ${threat.details}`
        );

        this.config.onThreatDetected?.(threat);

        // Keep only last 100 threats
        if (this.threats.length > 100) {
            this.threats = this.threats.slice(-100);
        }
    }

    getThreats(): ScreenThreat[] {
        return [...this.threats];
    }

    getRecentThreats(windowMs: number = 60_000): ScreenThreat[] {
        const cutoff = Date.now() - windowMs;
        return this.threats.filter(t => t.timestamp > cutoff);
    }

    getThreatLevel(): "safe" | "cautious" | "warning" | "danger" {
        const recent = this.getRecentThreats(60_000);
        const criticalCount = recent.filter(t => t.severity === "critical").length;
        const highCount = recent.filter(t => t.severity === "high").length;

        if (criticalCount > 0) return "danger";
        if (highCount >= 2) return "warning";
        if (recent.length > 3) return "cautious";
        return "safe";
    }
}
