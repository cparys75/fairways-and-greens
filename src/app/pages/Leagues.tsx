import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api } from '../api';
import { useSeason } from '../season';
import { saveJoinCode } from '../join';
import { SignInPage } from './SignIn';

/** An invite code from a pasted link or the bare code. */
const codeFrom = (text: string) => text.trim().replace(/^.*\/join\//, '').replace(/[/?#].*$/, '');

/** Your leagues: switch between them, join one from an invite, or start one if you're allowed to. */
export function LeaguesPage() {
  const { me, leagues, league, setLeagueId, refreshMe } = useSeason();
  const navigate = useNavigate();
  const [invite, setInvite] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  if (!me) return null;

  const run = async (e: FormEvent, fn: () => Promise<void>) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await fn();
    } catch (err) {
      setMessage({ kind: 'error', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const open = (id: number) => {
    setLeagueId(id);
    navigate('/');
  };

  return (
    <>
      <h1>Leagues</h1>
      {leagues.length > 0 ? (
        <ul className="list-cards">
          {leagues.map((l) => (
            <li key={l.id}>
              <button className="list-card" onClick={() => open(l.id)}>
                <span>
                  <strong>{l.name}</strong>
                  <span className="small muted block">{l.role === 'admin' ? 'You run this league' : 'Member'}</span>
                </span>
                {l.id === league?.id ? <span className="badge ok">Showing</span> : <span aria-hidden>›</span>}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="notice">You’re not in a league yet.</p>
      )}
      {me.requested.length > 0 && (
        <p className="small muted">Waiting for approval: {me.requested.map((l) => l.name).join(', ')}.</p>
      )}

      {me.user && (
        <section className="card">
          <h3>Join a league</h3>
          <p className="small muted">Paste the invite link a league admin sent you.</p>
          <form
            className="toolbar"
            onSubmit={(e) =>
              run(e, async () => {
                const r = await api.joinLeague(codeFrom(invite));
                await refreshMe();
                setInvite('');
                setMessage({ kind: 'ok', text: r.status === 'member' ? `You’re already in ${r.name}.` : `Asked to join ${r.name}. You’ll see it here once its admin approves you.` });
              })
            }
          >
            <input aria-label="Invite link" placeholder="https://…/join/…" value={invite} onChange={(e) => setInvite(e.target.value)} />
            <button type="submit" disabled={busy || !codeFrom(invite)}>Ask to join</button>
          </form>
        </section>
      )}

      {me.canCreateLeagues && (
        <section className="card">
          <h3>Start a league</h3>
          <p className="small muted">You’ll be its admin. Next you’ll set up its first season: teams, course, rules and schedule.</p>
          <form
            className="toolbar"
            onSubmit={(e) =>
              run(e, async () => {
                const { id } = await api.createLeague(name.trim());
                await refreshMe();
                setLeagueId(id);
                navigate('/admin/new-season');
              })
            }
          >
            <input aria-label="League name" placeholder="League name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
            <button className="primary" type="submit" disabled={busy || !name.trim()}>Start league</button>
          </form>
        </section>
      )}
      {message && <p className={message.kind}>{message.text}</p>}
      {leagues.length > 0 && <CalendarCard />}
    </>
  );
}

/** Subscribe your phone, computer or a wall calendar to your league schedule. */
function CalendarCard() {
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.calendar().then((r) => setUrl(r.url), () => undefined);
  }, []);
  if (!url) return null;
  const webcal = url.replace(/^https?:/, 'webcal:');
  const copy = async () => {
    await navigator.clipboard?.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  const reset = async () => {
    if (!confirm('Make a new calendar link? The old one stops updating.')) return;
    setBusy(true);
    try {
      setUrl((await api.resetCalendar()).url);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card">
      <h3>Golf on your calendar</h3>
      <p className="small muted">
        Add your match nights to your phone, computer, or a wall calendar. It updates on its own when the schedule changes. Keep the link
        private — anyone with it can see your schedule.
      </p>
      <div className="toolbar">
        <a className="button primary" href={webcal}>Add to calendar</a>
        <button onClick={copy}>{copied ? 'Copied ✓' : 'Copy link'}</button>
      </div>
      <div className="copy-row">
        <input readOnly value={url} onFocus={(e) => e.target.select()} aria-label="Calendar link" />
      </div>
      <details className="small">
        <summary>How to add it</summary>
        <ul>
          <li><strong>iPhone / iPad:</strong> tap “Add to calendar”, then “Subscribe”.</li>
          <li><strong>Google Calendar:</strong> on a computer, Other calendars → “+” → “From URL”, and paste the link.</li>
          <li><strong>Wall calendar (ARZOPA, Skylight, Cozyla, etc.):</strong> in its calendar settings, choose add by URL / iCal and paste the link.</li>
        </ul>
        <button className="link small danger" disabled={busy} onClick={reset}>Make a new link</button>
      </details>
    </section>
  );
}

/** Opened from a league's invite link: sign in or sign up, then ask to join. */
export function JoinPage() {
  const { code = '' } = useParams();
  const { me, refreshMe, setLeagueId } = useSeason();
  const [league, setLeague] = useState<string | null>(null);
  const [result, setResult] = useState<{ kind: 'ok' | 'error'; text: string; id?: number } | null>(null);
  const asked = useRef(false);

  useEffect(() => {
    saveJoinCode(code);
    api.joinInfo(code).then(
      (l) => setLeague(l.name),
      (e: Error) => setResult({ kind: 'error', text: e.message }),
    );
  }, [code]);

  // Signed in (or back from Google): ask to join once.
  useEffect(() => {
    if (!me?.user || !league || asked.current) return;
    asked.current = true;
    api.joinLeague(code).then(
      async (r) => {
        saveJoinCode(null);
        await refreshMe();
        if (r.status === 'member') setLeagueId(r.id);
        setResult({
          kind: 'ok',
          id: r.id,
          text: r.status === 'member' ? `You’re in ${r.name}.` : `Thanks! You’ve asked to join ${r.name}. You’ll see the league once its admin approves you.`,
        });
      },
      (e: Error) => setResult({ kind: 'error', text: e.message }),
    );
  }, [me?.user, league, code, refreshMe, setLeagueId]);

  if (!me) return <div className="splash">Loading…</div>;
  if (!me.user) {
    if (result?.kind === 'error') return <SignInPage />;
    return <SignInPage invite={league} />;
  }
  return (
    <>
      <h1>{league ? `Join ${league}` : 'Join a league'}</h1>
      {result ? <p className={result.kind}>{result.text}</p> : <p className="empty">Asking to join…</p>}
      <p><Link to="/">Home ›</Link></p>
    </>
  );
}
