/** Transactional email via Resend (free tier). Used for sign-in codes. */
import { defaultEmailFrom } from './brand';

export interface EmailEnv {
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
}

export const emailConfigured = (env: EmailEnv) => !!env.RESEND_API_KEY;

export async function sendEmail(env: EmailEnv, to: string, subject: string, text: string, html?: string): Promise<void> {
  if (!env.RESEND_API_KEY) throw new Error('Email is not configured');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.EMAIL_FROM || defaultEmailFrom, to: [to], subject, text, ...(html ? { html } : {}) }),
  });
  if (!res.ok) throw new Error(`Email failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
}
