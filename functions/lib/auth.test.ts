import { describe, expect, it } from 'vitest';
import { SESSION_SECONDS, sessionUser, userCookie } from './auth';
import { finishSignIn, profileFromClaims, safeReturnTo, startSignIn, type Claims } from './oauth';

const env = {
  SESSION_SECRET: 'test-secret',
  GOOGLE_CLIENT_ID: 'google-client',
  GOOGLE_CLIENT_SECRET: 'google-secret',
};
const valueOf = (setCookie: string) => setCookie.split(';')[0];

describe('user sessions', () => {
  it('lasts 8 hours from the last refresh, then expires', async () => {
    const t0 = 1_800_000_000;
    const c = valueOf(await userCookie(env, 42, true, t0));
    expect(await sessionUser(env, c, t0 + 60)).toEqual({ userId: 42, refresh: false });
    expect(await sessionUser(env, c, t0 + 10 * 60)).toEqual({ userId: 42, refresh: true });
    expect(await sessionUser(env, c, t0 + SESSION_SECONDS + 1)).toBeNull();
  });

  it('rejects tampered or foreign cookies', async () => {
    const c = valueOf(await userCookie(env, 42, true));
    expect(await sessionUser(env, c.replace('=42.', '=43.'))).toBeNull();
    expect(await sessionUser({ SESSION_SECRET: 'other' }, c)).toBeNull();
  });
});

describe('profileFromClaims', () => {
  const now = 1_800_000_000;
  const google: Claims = { iss: 'https://accounts.google.com', aud: 'google-client', exp: now + 300, nonce: 'n', sub: 'g1', email: 'Pat@Example.com', email_verified: true, name: 'Pat' };

  it('accepts a valid Google token and lowercases the email', () => {
    expect(profileFromClaims('google', google, 'google-client', 'n', now)).toEqual({ provider: 'google', subject: 'g1', email: 'pat@example.com', emailVerified: true, name: 'Pat' });
  });

  it.each([
    ['wrong audience', { aud: 'someone-else' }],
    ['wrong issuer', { iss: 'https://evil.example' }],
    ['expired', { exp: now - 3600 }],
    ['wrong nonce', { nonce: 'x' }],
  ])('rejects a token with %s', (_, patch) => {
    expect(() => profileFromClaims('google', { ...google, ...patch }, 'google-client', 'n', now)).toThrow();
  });

  it('does not trust unverified Google emails', () => {
    expect(profileFromClaims('google', { ...google, email_verified: false }, 'google-client', 'n', now).emailVerified).toBe(false);
  });

});

describe('sign-in round trip', () => {
  it('checks state and exchanges the code with the PKCE verifier', async () => {
    const start = await startSignIn(env, 'google', 'https://league.example', '/me/rounds');
    const url = new URL(start.url);
    expect(url.searchParams.get('redirect_uri')).toBe('https://league.example/api/auth/google/callback');
    expect(start.cookie).toContain('SameSite=Lax');
    const cookieHeader = valueOf(start.cookie);
    const state = url.searchParams.get('state')!;
    const nonce = url.searchParams.get('nonce')!;

    let body: URLSearchParams | null = null;
    const payload = btoa(JSON.stringify({ iss: 'https://accounts.google.com', aud: 'google-client', exp: Date.now() / 1000 + 300, nonce, sub: 'g1', email: 'pat@example.com', email_verified: true }));
    const fetcher = (async (_: unknown, init?: RequestInit) => {
      body = init!.body as URLSearchParams;
      return new Response(JSON.stringify({ id_token: `x.${payload}.y` }));
    }) as typeof fetch;

    const done = await finishSignIn(env, 'google', 'https://league.example', new URLSearchParams({ code: 'abc', state }), cookieHeader, fetcher);
    expect(done).toMatchObject({ returnTo: '/me/rounds', profile: { subject: 'g1', emailVerified: true } });
    expect(body!.get('code_verifier')).toBeTruthy();

    await expect(finishSignIn(env, 'google', 'https://league.example', new URLSearchParams({ code: 'abc', state: 'forged' }), cookieHeader, fetcher)).rejects.toThrow();
  });

  it('only returns to same-site paths', () => {
    expect(safeReturnTo('/rounds')).toBe('/rounds');
    expect(safeReturnTo('//evil.example')).toBe('/');
    expect(safeReturnTo('https://evil.example')).toBe('/');
    expect(safeReturnTo('/\\evil.example')).toBe('/');
  });
});
