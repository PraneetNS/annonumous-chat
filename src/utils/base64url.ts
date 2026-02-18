import { randomBytes, timingSafeEqual, createHmac } from "node:crypto";

export function b64urlEncode(buf: Uint8Array): string {
  return Buffer.from(buf)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export function b64urlDecode(s: string): Buffer {
  const padLen = (4 - (s.length % 4)) % 4;
  const padded = s.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat(padLen);
  return Buffer.from(padded, "base64");
}

export function randomIdB64Url(bytes: number): string {
  return b64urlEncode(randomBytes(bytes));
}

export function hmacSha256B64Url(secret: string, data: Uint8Array): string {
  const h = createHmac("sha256", secret);
  h.update(data);
  return b64urlEncode(h.digest());
}

export function timingSafeEqualB64Url(a: string, b: string): boolean {
  const ba = b64urlDecode(a);
  const bb = b64urlDecode(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

