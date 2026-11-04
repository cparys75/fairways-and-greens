/** Password hashing with PBKDF2-SHA256 (WebCrypto; Workers allow at most 100,000 iterations). */
import { base64url } from './auth';

const ITERATIONS = 100_000;
const enc = new TextEncoder();

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

function fromBase64url(s: string): Uint8Array {
  return Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITERATIONS}$${base64url(salt)}$${base64url(await derive(password, salt, ITERATIONS))}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  const [scheme, iter, salt, hash] = stored?.split('$') ?? [];
  if (scheme !== 'pbkdf2' || !salt || !hash) {
    // Same work for unknown accounts, so response time doesn't reveal which emails exist.
    await derive(password, new Uint8Array(16), ITERATIONS);
    return false;
  }
  const actual = await derive(password, fromBase64url(salt), Number(iter));
  const expected = fromBase64url(hash);
  let diff = actual.length ^ expected.length;
  for (let i = 0; i < Math.min(actual.length, expected.length); i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

/** A random token for a one-time link, and the SHA-256 we store instead of the token itself. */
export async function newToken(): Promise<{ token: string; hash: string }> {
  const token = base64url(crypto.getRandomValues(new Uint8Array(32)));
  return { token, hash: await sha256(token) };
}

export async function sha256(s: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s))));
}

/** At least 10 characters; that's the rule shown on the sign-up form. */
export function passwordProblem(password: unknown): string | null {
  if (typeof password !== 'string' || password.length < 10) return 'Use a password of at least 10 characters';
  if (password.length > 200) return 'That password is too long';
  return null;
}
