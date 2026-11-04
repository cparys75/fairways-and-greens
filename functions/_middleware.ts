/**
 * US-only access. Cloudflare Pages serves the custom domain from its own runtime, where zone WAF
 * custom rules don't reliably apply — so we enforce the country here, on every request, using the
 * CF-IPCountry header Cloudflare sets. Set US_ONLY="false" to turn it off without a code change.
 *
 * Exemptions: the uptime health check and the calendar feed (fetched by Google/Apple servers, which
 * may be outside the US), so monitoring and subscriptions keep working.
 */
import { BRAND } from './lib/brand';

interface Env {
  US_ONLY?: string;
}

const exempt = (path: string) => path === '/api/health' || path.startsWith('/api/calendar/');

export const onRequest: PagesFunction<Env> = async (context) => {
  if (context.env.US_ONLY !== 'false') {
    const country = context.request.headers.get('CF-IPCountry') ?? '';
    // '' / 'XX' mean Cloudflare couldn't determine the country — allow those rather than risk a false block.
    const blocked = country && country !== 'US' && country !== 'XX' && !exempt(new URL(context.request.url).pathname);
    if (blocked) {
      return new Response(`${BRAND.name} is only available in the United States.`, {
        status: 403,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }
  }
  return context.next();
};
