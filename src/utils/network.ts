
import os from "node:os";

export function getLocalNetworkIP(): string {
    const interfaces = os.networkInterfaces();

    // Prefer Wi-Fi or Ethernet interfaces over virtual ones
    const candidates: string[] = [];

    for (const name of Object.keys(interfaces)) {
        const ifaces = interfaces[name];
        if (!ifaces) continue;

        for (const iface of ifaces) {
            if (iface.family === "IPv4" && !iface.internal) {
                const addr = iface.address;
                if (addr.startsWith("192.168.0.") || addr.startsWith("192.168.1.") || addr.startsWith("10.0.0.")) {
                    candidates.unshift(addr); // Top priority
                } else if (addr.startsWith("192.168.137.")) {
                    candidates.push(addr); // Low priority
                } else {
                    // Mid priority
                    candidates.splice(0, 0, addr);
                }
            }
        }
    }

    return candidates[0] || "localhost";
}
