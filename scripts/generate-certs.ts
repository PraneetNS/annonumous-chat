
import fs from "fs";
import path from "path";
// @ts-ignore
import { generate } from "selfsigned";

console.log("Generating SSL certificates...");

const attrs = [
    { name: 'commonName', value: 'localhost' },
    { name: 'commonName', value: '192.168.0.167' }
];

const opts = {
    days: 365,
    algorithm: 'sha256',
    extensions: [
        { name: 'basicConstraints', cA: true },
        { name: 'keyUsage', keyCertSign: true, digitalSignature: true, nonRepudiation: true, keyEncipherment: true, dataEncipherment: true },
        { name: 'extKeyUsage', serverAuth: true, clientAuth: true, codeSigning: true, emailProtection: true, timeStamping: true },
        {
            name: 'subjectAltName', altNames: [
                { type: 2, value: 'localhost' },
                { type: 7, ip: '127.0.0.1' },
                { type: 7, ip: '192.168.0.167' }
            ]
        }
    ]
};

try {
    // Check if async or sync, try both
    let pems: any = generate(attrs, opts);
    if (pems instanceof Promise) {
        pems = await pems;
    }

    console.log("Keys available:", Object.keys(pems));

    const certDir = path.join(process.cwd(), "server", "certs");
    if (!fs.existsSync(certDir)) {
        fs.mkdirSync(certDir, { recursive: true });
    }

    // Check structure
    const key = pems.private || pems.privateKey; // some versions use different names
    const cert = pems.cert || pems.certificate;

    if (!key || !cert) throw new Error("Missing keys in output: " + JSON.stringify(Object.keys(pems)));

    fs.writeFileSync(path.join(certDir, "key.pem"), String(key));
    fs.writeFileSync(path.join(certDir, "cert.pem"), String(cert));

    console.log("Certificate generated at server/certs/cert.pem");
} catch (e) {
    console.error("Error generating certs:", e);
    process.exit(1);
}
