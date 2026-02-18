import selfsigned from 'selfsigned';
import fs from 'fs';
import path from 'path';
import os from 'os';

const getLocalIp = () => {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]!) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return null;
};

const localIp = getLocalIp();
// SANs: localhost, 127.0.0.1, <local-ip>, <hostname>
const altNames = [
    { type: 7, ip: '127.0.0.1' },
    { type: 2, value: 'localhost' },
    { type: 2, value: os.hostname() }
];

if (localIp) {
    altNames.push({ type: 7, ip: localIp });
    console.log(`Adding SAN for local IP: ${localIp}`);
}

const attrs = [{ name: 'commonName', value: 'localhost' }];
(async () => {
    const pems = await (selfsigned.generate as any)(attrs, {
        keySize: 2048,
        days: 365,
        algorithm: 'sha256',
        extensions: [{
            name: 'subjectAltName',
            altNames: [
                { type: 2, value: 'localhost' } as any,
                { type: 7, ip: '127.0.0.1' } as any,
                ...(localIp ? [{ type: 7, ip: localIp } as any] : [])
            ]
        }]
    } as any);

    const certDir = path.join(process.cwd(), 'server', 'certs');
    if (!fs.existsSync(certDir)) fs.mkdirSync(certDir, { recursive: true });

    fs.writeFileSync(path.join(certDir, 'key.pem'), pems.private);
    fs.writeFileSync(path.join(certDir, 'cert.pem'), pems.cert);

    console.log('✅ New robust certificates generated in server/certs/');
})();
