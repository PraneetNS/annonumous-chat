import { b64urlDecode, b64urlEncode, hmacSha256B64Url, randomIdB64Url, timingSafeEqualB64Url } from "../utils/base64url.js";

export type JoinTokenPayload = {
  v: 1;
  rid: string;
  exp: number; // unix ms
  jti: string; // random
};

export function mintJoinToken(secret: string, rid: string, expUnixMs: number): string {
  const payload: JoinTokenPayload = {
    v: 1,
    rid,
    exp: expUnixMs,
    jti: randomIdB64Url(16) // 128-bit
  };
  const payloadBytes = Buffer.from(JSON.stringify(payload), "utf8");
  const payloadB64Url = b64urlEncode(payloadBytes);
  const macB64Url = hmacSha256B64Url(secret, payloadBytes);
  return `${payloadB64Url}.${macB64Url}`;
}

export function verifyJoinToken(secret: string, token: string): { ok: true; payload: JoinTokenPayload } | { ok: false; code: string } {
  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false, code: "ERR_TOKEN_FORMAT" };
  const [payloadB64Url, macB64Url] = parts;
  if (!payloadB64Url || !macB64Url) return { ok: false, code: "ERR_TOKEN_FORMAT" };

  let payloadBytes: Buffer;
  try {
    payloadBytes = b64urlDecode(payloadB64Url);
  } catch {
    return { ok: false, code: "ERR_TOKEN_FORMAT" };
  }

  const expectedMac = hmacSha256B64Url(secret, payloadBytes);
  if (!timingSafeEqualB64Url(macB64Url, expectedMac)) return { ok: false, code: "ERR_TOKEN_MAC" };

  let payload: unknown;
  try {
    payload = JSON.parse(payloadBytes.toString("utf8"));
  } catch {
    return { ok: false, code: "ERR_TOKEN_FORMAT" };
  }

  if (
    typeof payload !== "object" ||
    payload === null ||
    (payload as any).v !== 1 ||
    typeof (payload as any).rid !== "string" ||
    typeof (payload as any).exp !== "number" ||
    typeof (payload as any).jti !== "string"
  ) {
    return { ok: false, code: "ERR_TOKEN_FORMAT" };
  }

  return { ok: true, payload: payload as JoinTokenPayload };
}

