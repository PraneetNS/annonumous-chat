import WebSocket from 'ws';
import https from 'https';

// Trust self-signed certs
const agent = new https.Agent({
    rejectUnauthorized: false
});

const wsUrl = "wss://localhost:3001/ws";

console.log(`Connecting to ${wsUrl}...`);
const ws = new WebSocket(wsUrl, {
    agent
});

ws.on('open', () => {
    console.log('✅ Connected!');
    ws.send(JSON.stringify({ t: "TEST_MSG", v: 1 }));
});

ws.on('message', (data) => {
    console.log('📩 Received:', data.toString());
});

ws.on('close', (code, reason) => {
    console.log(`❌ Closed: ${code} ${reason.toString()}`);
});

ws.on('error', (err) => {
    console.error('🔥 Error:', err);
});
