/**
 * Server-side branding for this deployment. To run your own instance, change these values (and the
 * matching client copy in src/brand.ts). Secrets (API keys, OAuth) are never here — they live in
 * environment variables. EMAIL_FROM and VAPID_SUBJECT can still be overridden per-environment.
 */
export const BRAND = {
  /** Shown in emails, notifications and the calendar feed. */
  name: 'Fairways and Greens',
  /** The site's primary domain, used for default email/VAPID addresses and calendar UIDs. */
  domain: 'example.com',
  /** An old host to permanently redirect to `domain` (so saved links follow a move); '' to disable. */
  legacyHost: '',
};

/** Default transactional-email sender, overridable with the EMAIL_FROM environment variable. */
export const defaultEmailFrom = `${BRAND.name} <noreply@${BRAND.domain}>`;
/** Default Web Push contact, overridable with the VAPID_SUBJECT environment variable. */
export const defaultVapidSubject = `mailto:admin@${BRAND.domain}`;
