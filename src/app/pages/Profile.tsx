import { useEffect, useState, type FormEvent } from 'react';
import { OfflineError } from '../api';
import { Notifications } from '../components/Notifications';
import { Link } from 'react-router';
import { api, type Profile } from '../api';
import { useSeason } from '../season';

/** Your name and phone number, and whether you're OK getting league texts. */
export function ProfilePage() {
  const { me, refreshMe } = useSeason();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (me?.user) api.profile().then(setProfile, (e: Error) => setMessage({ kind: 'error', text: e.message }));
  }, [me?.user]);

  const signOut = async () => {
    await api.logout();
    location.assign('/');
  };

  if (!me?.user) {
    return (
      <>
        <h1>Profile</h1>
        <p className="notice">You’re signed in with the admin password, which has no profile.</p>
        <button onClick={signOut}>Sign out</button>
      </>
    );
  }
  if (!profile) return <p className="empty">{message?.text ?? 'Loading…'}</p>;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const r = await api.saveProfile({ name: profile.name ?? '', phone: profile.phone || null, smsOk: profile.smsOk });
      setProfile({ ...profile, phone: r.phone });
      await refreshMe();
      setMessage({ kind: 'ok', text: 'Saved' });
    } catch (err) {
      setMessage({ kind: 'error', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1>Profile</h1>
      <form className="card stack-form profile-form" onSubmit={save}>
        <label className="field"><span>Name</span><input autoComplete="name" required value={profile.name ?? ''} onChange={(e) => setProfile({ ...profile, name: e.target.value })} /></label>
        <label className="field"><span>Email</span><input value={profile.email ?? ''} readOnly disabled /></label>
        <label className="field">
          <span>Mobile phone (optional)</span>
          <input type="tel" autoComplete="tel" placeholder="303-555-0100" value={profile.phone ?? ''} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} />
        </label>
        <label className="check">
          <input type="checkbox" checked={profile.smsOk} disabled={!profile.phone} onChange={(e) => setProfile({ ...profile, smsOk: e.target.checked })} />
          It’s OK for the league to text me about the league (schedule changes, rain-outs).
        </label>
        <p className="small muted">Your phone number and email are only shown to league admins.</p>
        {message && <p className={message.kind}>{message.text}</p>}
        <button className="primary big-button" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </form>
      <p><Link className="button" to="/leagues">Leagues</Link> <button onClick={signOut}>Sign out</button></p>
      <Notifications />
      <AccountData />
      <p className="small muted"><Link to="/privacy">Privacy</Link></p>
    </>
  );
}

/** Download a copy of your data, or delete your account. */
function AccountData() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const download = async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await api.myData();
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'my-golf-data.json';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!confirm('Delete your account and your data? This can’t be undone. Rounds other people started that included you keep your name but are unlinked.')) return;
    if (!confirm('Really delete your account? This is permanent.')) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteAccount();
      location.assign('/');
    } catch (e) {
      setError(e instanceof OfflineError ? 'No connection. Try again when you’re online.' : (e as Error).message);
      setBusy(false);
    }
  };
  return (
    <details className="card">
      <summary>Your data</summary>
      <p className="small muted">Download everything we hold about you, or delete your account for good.</p>
      <div className="toolbar">
        <button disabled={busy} onClick={download}>Download my data</button>
        <button className="danger" disabled={busy} onClick={remove}>Delete my account</button>
      </div>
      {error && <p className="error small">{error}</p>}
    </details>
  );
}
