import { describe, expect, it } from 'vitest';
import { onRequest } from '../_middleware';

/** Minimal Pages context: next() returns a sentinel 200 so we can tell "allowed" from "blocked". */
function ctx(country: string | null, path = '/', env: { US_ONLY?: string } = {}) {
  const headers = new Headers();
  if (country !== null) headers.set('CF-IPCountry', country);
  return {
    request: new Request(`https://example.com${path}`, { headers }),
    env,
    next: async () => new Response('ok', { status: 200 }),
  } as unknown as Parameters<typeof onRequest>[0];
}
const run = (c: string | null, path = '/', env = {}) => onRequest(ctx(c, path, env));

describe('US-only middleware', () => {
  it('allows the US and blocks everywhere else', async () => {
    expect((await run('US')).status).toBe(200);
    expect((await run('GB')).status).toBe(403);
    expect((await run('RU')).status).toBe(403);
  });
  it('allows unknown/absent country (no false blocks)', async () => {
    expect((await run('XX')).status).toBe(200);
    expect((await run(null)).status).toBe(200);
  });
  it('exempts the health check and calendar feed from any country', async () => {
    expect((await run('DE', '/api/health')).status).toBe(200);
    expect((await run('DE', '/api/calendar/abc.ics')).status).toBe(200);
    expect((await run('DE', '/api/me')).status).toBe(403);
  });
  it('can be turned off with US_ONLY=false', async () => {
    expect((await run('RU', '/', { US_ONLY: 'false' })).status).toBe(200);
  });
});
