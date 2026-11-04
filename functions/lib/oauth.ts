/**
 * "Sign in with Google" using OpenID Connect (authorization code + PKCE).
 *
 * The ID token comes straight from the provider's token endpoint over TLS, authenticated with our
 * client secret, so its claims are trusted without checking the signature (OpenID Connect Core
 * 3.1.3.7). We still check the issuer, audience, expiry and nonce.
 */
import { base64url, cookie, hmac, readCookie, safeEqual, type AuthEnv } from './auth';

export type Provider = 'google';

export interface OAuthEnv extends AuthEnv {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
}

const PROVIDERS = {
  google: {
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    id: (env: OAuthEnv) => env.GOOGLE_CLIENT_ID,
    secret: (env: OAuthEnv) => env.GOOGLE_CLIENT_SECRET,
  },
} as const;

export function isProvider(p: string): p is Provider {
  return p === 'google';
}

export function enabledProviders(env: OAuthEnv): Provider[] {
  if (!env.SESSION_SECRET) return [];
  return (Object.keys(PROVIDERS) as Provider[]).filter((p) => PROVIDERS[p].id(env) && PROVIDERS[p].secret(env));
}

export class OAuthError extends Error {}

export interface Profile {
  provider: Provider;
  subject: string;
  email: string | null;
  /** Only verified emails link to roster players or merge accounts. */
  emailVerified: boolean;
  name: string | null;
}

// ---------- the short-lived cookie that carries state between start and callback ----------

const TX_COOKIE = 'league_oauth';
const TX_SECONDS = 10 * 60;

interface Tx {
  p: Provider;
  state: string;
  verifier: string;
  nonce: string;
  returnTo: string;
  exp: number;
}

const random = (bytes = 32) => base64url(crypto.getRandomValues(new Uint8Array(bytes)));

async function sealTx(env: OAuthEnv, tx: Tx): Promise<string> {
  const body = base64url(new TextEncoder().encode(JSON.stringify(tx)));
  return `${body}.${await hmac(env.SESSION_SECRET!, `oauth.${body}`)}`;
}

async function openTx(env: OAuthEnv, value: string | undefined): Promise<Tx | null> {
  const [body, sig] = value?.split('.') ?? [];
  if (!body || !sig || !(await safeEqual(sig, await hmac(env.SESSION_SECRET!, `oauth.${body}`), env.SESSION_SECRET!))) return null;
  const tx = JSON.parse(new TextDecoder().decode(fromBase64url(body))) as Tx;
  return tx.exp > Date.now() / 1000 ? tx : null;
}

function fromBase64url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

/** Only same-site paths, so the sign-in flow can't be used to bounce people to another site. */
export function safeReturnTo(v: string | undefined): string {
  return v && /^\/(?![/\\])/.test(v) ? v : '/';
}

export const redirectUri = (origin: string, p: Provider) => `${origin}/api/auth/${p}/callback`;

/** Where to send the browser to sign in, plus the cookie that remembers this attempt. */
export async function startSignIn(env: OAuthEnv, p: Provider, origin: string, returnTo: string): Promise<{ url: string; cookie: string }> {
  const cfg = PROVIDERS[p];
  const tx: Tx = { p, state: random(), verifier: random(48), nonce: random(), returnTo: safeReturnTo(returnTo), exp: Math.floor(Date.now() / 1000) + TX_SECONDS };
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(tx.verifier))));
  const url = new URL(cfg.authorize);
  url.search = new URLSearchParams({
    client_id: cfg.id(env)!,
    redirect_uri: redirectUri(origin, p),
    response_type: 'code',
    scope: 'openid email profile',
    state: tx.state,
    nonce: tx.nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString();
  // Lax, not Strict: the provider sends the browser back with a cross-site top-level redirect.
  return { url: url.toString(), cookie: cookie(TX_COOKIE, await sealTx(env, tx), TX_SECONDS, origin.startsWith('https:'), 'Lax', '/api/auth') };
}

export const clearTxCookie = () => cookie(TX_COOKIE, '', 0, false, 'Lax', '/api/auth');

/** Finish sign-in: check state, exchange the code, and return the verified profile. */
export async function finishSignIn(
  env: OAuthEnv,
  p: Provider,
  origin: string,
  params: URLSearchParams,
  cookieHeader: string | null | undefined,
  fetcher: typeof fetch = fetch,
): Promise<{ profile: Profile; returnTo: string }> {
  const tx = await openTx(env, readCookie(cookieHeader, TX_COOKIE));
  if (!tx || tx.p !== p) throw new OAuthError('Your sign-in attempt expired. Please try again.');
  if (params.get('error')) throw new OAuthError(params.get('error') === 'access_denied' ? 'Sign-in was cancelled.' : 'The sign-in provider returned an error.');
  if (!params.get('state') || params.get('state') !== tx.state) throw new OAuthError('Sign-in could not be verified. Please try again.');
  const code = params.get('code');
  if (!code) throw new OAuthError('Sign-in could not be completed. Please try again.');

  const cfg = PROVIDERS[p];
  const res = await fetcher(cfg.token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(origin, p),
      client_id: cfg.id(env)!,
      client_secret: cfg.secret(env)!,
      code_verifier: tx.verifier,
    }),
  });
  const json = (await res.json().catch(() => ({}))) as { id_token?: string };
  if (!res.ok || !json.id_token) throw new OAuthError('Sign-in could not be completed. Please try again.');
  const claims = JSON.parse(new TextDecoder().decode(fromBase64url(json.id_token.split('.')[1] ?? ''))) as Claims;
  return { profile: profileFromClaims(p, claims, cfg.id(env)!, tx.nonce), returnTo: tx.returnTo };
}

export interface Claims {
  iss?: string;
  aud?: string | string[];
  exp?: number;
  nonce?: string;
  sub?: string;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
}

export function profileFromClaims(p: Provider, c: Claims, clientId: string, nonce: string, now = Date.now() / 1000): Profile {
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
  const issOk = c.iss === 'https://accounts.google.com' || c.iss === 'accounts.google.com';
  if (!issOk || !aud.includes(clientId) || !c.exp || c.exp < now - 60 || c.nonce !== nonce || !c.sub) {
    throw new OAuthError('Sign-in could not be verified. Please try again.');
  }
  const email = c.email?.trim().toLowerCase() || null;
  // Only addresses Google has verified link to roster players.
  const emailVerified = !!email && (c.email_verified === true || c.email_verified === 'true');
  return { provider: p, subject: c.sub, email, emailVerified, name: c.name?.trim() || null };
}
