import { useState, type FormEvent } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { api } from '../api';
import { savedJoinCode } from '../join';
import { useSeason } from '../season';
import { BRAND } from '../../brand';

/** Google's "G" mark, as required by Google's sign-in branding guidelines. */
export function GoogleG() {
  return (
    <svg className="google-g" viewBox="0 0 48 48" aria-hidden="true" width="20" height="20">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

/** The whole site sits behind this page until someone signs in. `invite`: the league whose invite link was opened. */
export function SignInPage({ invite }: { invite?: string | null }) {
  const { me, refreshMe } = useSeason();
  const [params] = useSearchParams();
  const location = useLocation();
  const returnTo = location.pathname.startsWith('/signin') ? (params.get('returnTo') ?? '/') : location.pathname;
  if (!me) return <div className="splash">Loading…</div>;

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <img src={BRAND.logoFull} alt={BRAND.logoFullAlt} width={BRAND.logoFullSize.width} height={BRAND.logoFullSize.height} />
          <p className="muted small">{BRAND.tagline}</p>
        </div>
        {invite && (
          <p className="notice center">
            You’re invited to join <strong>{invite}</strong>. Sign in, and the league’s admin will let you in.
          </p>
        )}
        {params.get('error') && <p className="error">{params.get('error')}</p>}

        {me.providers.includes('google') && (
          <>
            <a className="google-button" href={`/api/auth/google/start?returnTo=${encodeURIComponent(returnTo)}`}>
              <GoogleG />
              <span>Sign in with Google</span>
            </a>
            {me.emailLogin && <div className="divider"><span>or use your email</span></div>}
          </>
        )}

        {me.emailLogin ? (
          <EmailCodeSignIn onDone={refreshMe} />
        ) : (
          !me.providers.includes('google') && <p className="notice center">Sign-in isn’t set up yet. Ask a league admin.</p>
        )}

        {me.devLogin && <DevLogin onDone={refreshMe} />}
        {me.adminPassword && (
          <p className="small muted center">
            League admin? <Link to="/admin/password">Use the admin password</Link>
          </p>
        )}
      </div>
    </div>
  );
}

/** Enter your email, get a 6-digit code by email, type it in. No password to set or remember. */
function EmailCodeSignIn({ onDone }: { onDone: () => Promise<void> }) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<'email' | 'code'>('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const request = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.requestCode(email.trim(), savedJoinCode());
      setStage('code');
      setNote(r.devCode ? `Dev code: ${r.devCode}` : `We emailed a 6-digit code to ${email.trim()}. It expires in 10 minutes.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.verifyCode(email.trim(), code.trim(), savedJoinCode());
      await onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (stage === 'email') {
    return (
      <form className="stack-form" onSubmit={request}>
        <label className="field"><span>Email</span><input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" /></label>
        {error && <p className="error">{error}</p>}
        <button className="primary big-button" type="submit" disabled={busy || !email.trim()}>{busy ? 'Sending…' : 'Email me a code'}</button>
        <p className="small muted center">No password needed — we’ll email you a fresh code each time you sign in.</p>
      </form>
    );
  }
  return (
    <form className="stack-form" onSubmit={verify}>
      {note && <p className="ok small">{note}</p>}
      <label className="field">
        <span>6-digit code</span>
        <input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus placeholder="123456" />
      </label>
      {error && <p className="error">{error}</p>}
      <button className="primary big-button" type="submit" disabled={busy || code.length < 6}>{busy ? 'Checking…' : 'Sign in'}</button>
      <p className="small muted center">
        <button type="button" className="link" onClick={() => { setStage('email'); setCode(''); setError(null); }}>Use a different email</button>
        {' · '}
        <button type="button" className="link" disabled={busy} onClick={(e) => request(e as unknown as FormEvent)}>Resend code</button>
      </p>
    </form>
  );
}

/** Local development only (DEV_LOGIN=true on localhost). */
function DevLogin({ onDone }: { onDone: () => Promise<void> }) {
  const [email, setEmail] = useState('');
  const [admin, setAdmin] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await api.devLogin(email, admin);
    await onDone();
  };
  return (
    <form className="toolbar" onSubmit={submit}>
      <input type="email" placeholder="dev: any email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <label className="check"><input type="checkbox" checked={admin} onChange={(e) => setAdmin(e.target.checked)} /> admin</label>
      <button type="submit" disabled={!email}>Dev sign-in</button>
    </form>
  );
}
