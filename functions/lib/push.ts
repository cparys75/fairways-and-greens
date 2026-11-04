/**
 * Free Web Push with VAPID, no third-party service. We send "content-less" pushes: the push just
 * wakes the device's service worker, which then fetches the notification text from /api/push/pending.
 * That avoids payload encryption while still showing real content, and keeps everything on Cloudflare.
 *
 * Set up: generate a VAPID key pair once and store the private JWK as the secret VAPID_JWK.
 */
import { defaultVapidSubject } from './brand';

export interface PushEnv {
  VAPID_JWK?: string;
  VAPID_SUBJECT?: string;
}

interface Jwk {
  kty: string;
  crv: string;
  x: string;
  y: string;
  d?: string;
}

const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function fromB64url(s: string): Uint8Array {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  return Uint8Array.from(atob(pad), (c) => c.charCodeAt(0));
}

/** The uncompressed public key (0x04 ‖ x ‖ y), used as the applicationServerKey. */
function publicKeyBytes(jwk: Jwk): Uint8Array {
  const x = fromB64url(jwk.x);
  const y = fromB64url(jwk.y);
  const out = new Uint8Array(65);
  out[0] = 4;
  out.set(x, 1);
  out.set(y, 33);
  return out;
}

export function vapidPublicKey(env: PushEnv): string | null {
  if (!env.VAPID_JWK) return null;
  try {
    return b64url(publicKeyBytes(JSON.parse(env.VAPID_JWK)));
  } catch {
    return null;
  }
}

async function vapidJwt(aud: string, jwk: Jwk, subject: string): Promise<string> {
  const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const data = `${enc({ typ: 'JWT', alg: 'ES256' })}.${enc({ aud, exp: Math.floor(Date.now() / 1000) + 43200, sub: subject })}`;
  const key = await crypto.subtle.importKey('jwk', jwk as JsonWebKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(data));
  return `${data}.${b64url(new Uint8Array(sig))}`;
}

/** Send a content-less push to one subscription. Returns the push service's HTTP status (0 on network error). */
export async function sendPush(env: PushEnv, endpoint: string): Promise<number> {
  if (!env.VAPID_JWK) return 0;
  const jwk = JSON.parse(env.VAPID_JWK) as Jwk;
  const jwt = await vapidJwt(new URL(endpoint).origin, jwk, env.VAPID_SUBJECT || defaultVapidSubject);
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `vapid t=${jwt}, k=${b64url(publicKeyBytes(jwk))}`, TTL: '86400', 'Content-Length': '0', Urgency: 'normal' },
    });
    return res.status;
  } catch {
    return 0;
  }
}
