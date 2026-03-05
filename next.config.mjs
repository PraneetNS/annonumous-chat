/** @type {import('next').NextConfig} */
if (process.env.NODE_ENV !== 'production') {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}
const nextConfig = {
    reactStrictMode: false, // Disable strict mode to avoid double-connect issues in dev
    async rewrites() {
        return [
            {
                source: "/api/:path*",
                destination: "http://127.0.0.1:3001/:path*", // Proxy to Backend
            },
            {
                source: "/ws",
                destination: "http://127.0.0.1:3001/ws", // Proxy WebSocket
            },
            {
                source: "/signaling",
                destination: "http://127.0.0.1:3001/signaling", // Proxy Signaling
            },
        ];
    },
};

export default nextConfig;
