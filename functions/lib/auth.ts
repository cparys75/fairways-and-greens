/**
 * Sign-in sessions as signed, HttpOnly cookies (no session table to clean up):
 * - player accounts (Google sign-in), expiring after 8 hours without activity;
 * - the shared admin password, kept as an emergency fallback, also limited to 8 hours.
 */
const ADMIN_COOKIE = 'league_admin';
const USER_COOKIE = 'league_session';
export const SESSION_SECONDS = 8 * 60 * 60;
/** Re-issue the sliding session cookie at most this often. */
const REFRESH_AFTER = 5 * 60;

export interface AuthEnv {
  ADMIN_PASSWORD?: string;
  SESSION_SECRET?: string;
}

const enc = new TextEncoder();

export async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return base64url(new Uint8Array(sig));
}

export function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, (c) => ({ '+': '-', '/': '_', '=': '' })[c]!);
}

/** Compare without leaking timing, by comparing HMACs of both values. */
export async function safeEqual(a: string, b: string, secret: string): Promise<boolean> {
  return (await hmac(secret, a)) === (await hmac(secret, b));
}

export function configured(env: AuthEnv): boolean {
  return !!env.SESSION_SECRET;
}

export function passwordConfigured(env: AuthEnv): boolean {
  return !!env.ADMIN_PASSWORD && !!env.SESSION_SECRET;
}

export async function checkPassword(env: AuthEnv, password: string): Promise<boolean> {
  if (!passwordConfigured(env)) return false;
  return safeEqual(password, env.ADMIN_PASSWORD!, env.SESSION_SECRET!);
}

export function readCookie(header: string | null | undefined, name: string): string | undefined {
  return header
    ?.split(/;\s*/)
    .find((c) => c.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

export function cookie(name: string, value: string, maxAge: number, secure: boolean, sameSite = 'Strict', path = '/'): string {
  return `${name}=${value}; Path=${path}; HttpOnly; SameSite=${sameSite}; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

/** `<subject>.<expiry>.<signature>`, signed for one purpose so cookies can't be swapped. */
async function signedValue(secret: string, purpose: string, subject: string, exp: number): Promise<string> {
  return `${subject}.${exp}.${await hmac(secret, `${purpose}.${subject}.${exp}`)}`;
}

async function verifyValue(secret: string, purpose: string, value: string | undefined, now: number): Promise<{ subject: string; exp: number } | null> {
  const [subject, expRaw, sig] = value?.split('.') ?? [];
  const exp = Number(expRaw);
  if (!subject || !sig || !Number.isFinite(exp) || exp < now) return null;
  const expected = await hmac(secret, `${purpose}.${subject}.${exp}`);
  return (await safeEqual(sig, expected, secret)) ? { subject, exp } : null;
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

// ---------- shared admin password ----------

export async function adminCookie(env: AuthEnv, secure: boolean): Promise<string> {
  const exp = nowSeconds() + SESSION_SECONDS;
  return cookie(ADMIN_COOKIE, await signedValue(env.SESSION_SECRET!, 'admin', 'admin', exp), SESSION_SECONDS, secure);
}

export async function isPasswordAdmin(env: AuthEnv, cookieHeader: string | null | undefined): Promise<boolean> {
  if (!passwordConfigured(env)) return false;
  return !!(await verifyValue(env.SESSION_SECRET!, 'admin', readCookie(cookieHeader, ADMIN_COOKIE), nowSeconds()));
}

// ---------- player accounts ----------

export async function userCookie(env: AuthEnv, userId: number, secure: boolean, now = nowSeconds()): Promise<string> {
  return cookie(USER_COOKIE, await signedValue(env.SESSION_SECRET!, 'user', String(userId), now + SESSION_SECONDS), SESSION_SECONDS, secure);
}

/** The signed-in user id, and whether the cookie is old enough to re-issue (sliding 8-hour expiry). */
export async function sessionUser(
  env: AuthEnv,
  cookieHeader: string | null | undefined,
  now = nowSeconds(),
): Promise<{ userId: number; refresh: boolean } | null> {
  if (!configured(env)) return null;
  const v = await verifyValue(env.SESSION_SECRET!, 'user', readCookie(cookieHeader, USER_COOKIE), now);
  const userId = Number(v?.subject);
  if (!v || !Number.isInteger(userId)) return null;
  return { userId, refresh: v.exp - now < SESSION_SECONDS - REFRESH_AFTER };
}

export function signOutCookies(): string[] {
  return [cookie(ADMIN_COOKIE, '', 0, false), cookie(USER_COOKIE, '', 0, false)];
}
