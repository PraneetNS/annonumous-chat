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
                destination: "https://127.0.0.1:3001/:path*", // Proxy to Backend
            },
            {
                source: "/ws",
                destination: "https://127.0.0.1:3001/ws", // Proxy WebSocket
            },
        ];
    },
};

export default nextConfig;
