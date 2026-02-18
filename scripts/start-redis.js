import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('🚀 Starting Redis server...\n');

// Start Redis server from node_modules
const redisServer = spawn('node', [
    join(__dirname, '..', 'node_modules', 'redis-server', 'bin', 'redis-server'),
    '--port', '6379',
    '--bind', '127.0.0.1'
], {
    stdio: 'inherit'
});

redisServer.on('error', (err) => {
    console.error('❌ Failed to start Redis:', err.message);
    process.exit(1);
});

redisServer.on('exit', (code) => {
    console.log(`\n⚠️  Redis server exited with code ${code}`);
    process.exit(code);
});

console.log('✅ Redis server started on port 6379');
console.log('📝 Press Ctrl+C to stop\n');

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n\n🛑 Stopping Redis server...');
    redisServer.kill('SIGTERM');
    setTimeout(() => process.exit(0), 1000);
});
