/**
 * Client-side branding for this deployment. To run your own instance, change these values (and the
 * matching server copy in functions/lib/brand.ts), and drop your own logo into public/ (see
 * `logoFull` / `logoMark` below). No secrets live here.
 */
export const BRAND = {
  /** App name, shown as the fallback title before a league is chosen and on sign-in/privacy pages. */
  name: 'Fairways and Greens',
  /** One-line description under the logo on the sign-in screen. */
  tagline: 'Scores, standings and your own rounds',
  /** Full logo on the sign-in screen (served from public/). */
  logoFull: '/logo.svg',
  logoFullAlt: 'Fairways and Greens',
  logoFullSize: { width: 200, height: 200 },
  /** Small mark in the header (served from public/). */
  logoMark: '/logo.svg',
};
