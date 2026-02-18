import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

console.log('🚀 Starting Chat App with Public Tunnel...\n');

// Start the main application
console.log('📡 Starting backend and frontend servers...');
const app = spawn('npm', ['run', 'dev:all'], {
    cwd: rootDir,
    shell: true,
    stdio: 'inherit'
});

// Wait for servers to be ready
console.log('⏳ Waiting for servers to start...');
await new Promise(resolve => setTimeout(resolve, 8000));

// The dev:all already includes localtunnel, so we just need to inform the user
console.log('\n✅ ========================================');
console.log('✅ PUBLIC TUNNEL ACTIVE!');
console.log('✅ ========================================');
console.log('\n🌍 Your app is now accessible from ANYWHERE!');
console.log('\n📋 INSTRUCTIONS:');
console.log('   1. Look for the "your url is:" message above');
console.log('   2. Copy that URL (it looks like: https://xxx.loca.lt)');
console.log('   3. Open that URL in your browser');
console.log('   4. Create a room and share the QR code!');
console.log('\n📱 Mobile users can now:');
console.log('   - Scan the QR code from ANY network');
console.log('   - Join the chat room instantly');
console.log('   - Chat in real-time from anywhere!\n');
console.log('⚠️  This tunnel will stay active as long as this script runs.');
console.log('⚠️  Press Ctrl+C to stop all services.\n');

// Handle cleanup
process.on('SIGINT', () => {
    console.log('\n\n🛑 Shutting down...');
    app.kill();
    process.exit(0);
});

process.on('SIGTERM', () => {
    app.kill();
    process.exit(0);
});
