"use client";

export type MlsClient = {
  // TODO(MLS): integrate an MLS 1.0 library (RFC 9420) here.
  // This MVP uses a symmetric room key for real WebCrypto E2EE.
};

const NONCE_BYTES = 12;
const te = new TextEncoder();
const td = new TextDecoder();

/**
 * Returns the WebCrypto SubtleCrypto instance, compatible with:
 *  - Browser secure contexts (HTTPS or localhost)
 *  - Node.js >= 15 (via globalThis.crypto.subtle or webcrypto)
 * Throws a clear error if called in an insecure browser context (plain HTTP
 * on a non-localhost origin), where browsers deliberately hide crypto.subtle.
 */
function getSubtle(): SubtleCrypto {
  // Browser path
  if (typeof window !== "undefined") {
    const subtle = (globalThis.crypto as Crypto | undefined)?.subtle;
    if (subtle) return subtle;
    // crypto.subtle is undefined on plain HTTP (non-localhost) pages.
    throw new Error(
      "WebCrypto (crypto.subtle) is not available. " +
      "This app requires a secure context: open it via HTTPS or localhost. " +
      "Try https://localhost:4001 instead of http://."
    );
  }
  // Node.js path (SSR / server components)
  const nodeCrypto = globalThis.crypto as any;
  if (nodeCrypto?.subtle) return nodeCrypto.subtle;
  // Node < 19 exposes it under webcrypto
  if ((nodeCrypto as any)?.webcrypto?.subtle) return (nodeCrypto as any).webcrypto.subtle;
  throw new Error("WebCrypto is not available in this Node.js environment.");
}

export function b64urlEncode(buf: ArrayBufferLike): string {
  const b = Buffer.from(buf as ArrayBuffer);
  return b
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function b64urlDecode(s: string): Uint8Array {
  const padLen = (4 - (s.length % 4)) % 4;
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(padLen);
  return new Uint8Array(Buffer.from(padded, "base64"));
}

export function randomBytes(len: number): Uint8Array {
  const b = new Uint8Array(len);
  globalThis.crypto.getRandomValues(b);
  return b;
}

export function wipeBytes(b: Uint8Array | null | undefined) {
  if (!b) return;
  b.fill(0);
}

export async function importRoomKeyFromSecret(secret32: Uint8Array): Promise<CryptoKey> {
  if (secret32.byteLength !== 32) throw new Error("secret must be 32 bytes");
  // Ensure we hand WebCrypto a Uint8Array backed by an ArrayBuffer (not SharedArrayBuffer types).
  const s = new Uint8Array(secret32);
  return getSubtle().importKey("raw", s, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptJson(key: CryptoKey, payload: unknown, aad: string): Promise<string> {
  const nonce = new Uint8Array(NONCE_BYTES);
  globalThis.crypto.getRandomValues(nonce);
  const iv = new Uint8Array(nonce);
  const pt = new Uint8Array(te.encode(JSON.stringify(payload)));
  const additionalData = new Uint8Array(te.encode(aad));
  const ct = await getSubtle().encrypt(
    { name: "AES-GCM", iv, additionalData },
    key,
    pt
  );
  const ctb = new Uint8Array(ct);
  const out = new Uint8Array(nonce.byteLength + ctb.byteLength);
  out.set(nonce, 0);
  out.set(ctb, nonce.byteLength);
  return b64urlEncode(out.buffer);
}

export async function decryptJson<T>(key: CryptoKey, ciphertextB64Url: string, aad: string): Promise<T | null> {
  try {
    const buf = b64urlDecode(ciphertextB64Url);
    if (buf.byteLength <= NONCE_BYTES) return null;
    const nonce = buf.slice(0, NONCE_BYTES);
    const iv = new Uint8Array(nonce);
    const ct = buf.slice(NONCE_BYTES);
    const pt = await getSubtle().decrypt(
      { name: "AES-GCM", iv, additionalData: new Uint8Array(te.encode(aad)) },
      key,
      ct
    );
    return JSON.parse(td.decode(pt)) as T;
  } catch {
    return null;
  }
}

export type EncryptedMedia = {
  mime: string;
  size: number;
  chunkSize: number;
  chunks: string[]; // base64url(nonce||ciphertext)
};

export async function encryptMediaFile(key: CryptoKey, file: File, chunkSize = 256 * 1024): Promise<EncryptedMedia> {
  const chunks: string[] = [];
  let offset = 0;
  let idx = 0;
  while (offset < file.size) {
    const slice = file.slice(offset, offset + chunkSize);
    const pt = new Uint8Array(await slice.arrayBuffer());
    const nonce = new Uint8Array(NONCE_BYTES);
    globalThis.crypto.getRandomValues(nonce);
    const ct = await getSubtle().encrypt(
      { name: "AES-GCM", iv: new Uint8Array(nonce), additionalData: new Uint8Array(te.encode(`media:v1|${idx}|${pt.byteLength}`)) },
      key,
      pt
    );
    const ctb = new Uint8Array(ct);
    const out = new Uint8Array(nonce.byteLength + ctb.byteLength);
    out.set(nonce, 0);
    out.set(ctb, nonce.byteLength);
    chunks.push(b64urlEncode(out.buffer));
    offset += chunkSize;
    idx += 1;
  }
  return { mime: file.type || "application/octet-stream", size: file.size, chunkSize, chunks };
}

