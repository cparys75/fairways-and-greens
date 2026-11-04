import { useEffect, useState } from 'react';
import { api } from '../api';

/** base64url VAPID key → the Uint8Array the Push API wants. */
function keyBytes(base64: string): Uint8Array<ArrayBuffer> {
  const raw = atob(base64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (base64.length % 4)) % 4));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

const supported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/** Turn match/league push notifications on or off, and send yourself a test. */
export function Notifications() {
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!supported()) return;
    (async () => {
      const reg = await navigator.serviceWorker.ready.catch(() => null);
      setOn(!!(await reg?.pushManager.getSubscription()));
      api.pushKey().then((k) => setConfigured(k.configured), () => undefined);
    })();
  }, []);

  if (!supported()) {
    return (
      <details className="card">
        <summary>Notifications</summary>
        <p className="small muted">This browser can’t show notifications. On iPhone, add the app to your Home Screen first, then open it from there.</p>
      </details>
    );
  }

  const enable = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        setMessage('Notifications are blocked. Allow them for this site in your browser settings.');
        return;
      }
      const { key, configured } = await api.pushKey();
      if (!configured || !key) {
        setMessage('Notifications aren’t set up on the server yet.');
        setConfigured(false);
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
      const j = sub.toJSON();
      await api.pushSubscribe(sub.endpoint, { p256dh: j.keys!.p256dh, auth: j.keys!.auth });
      setOn(true);
      setMessage('Notifications are on.');
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await api.pushUnsubscribe(sub.endpoint).catch(() => undefined);
        await sub.unsubscribe();
      }
      setOn(false);
      setMessage('Notifications are off.');
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setMessage(null);
    const r = await api.pushTest().catch((e: Error) => ({ ok: false, configured: true, error: e.message }) as any);
    setMessage(r.ok ? 'Sent — it should appear shortly.' : r.error ?? 'Could not send.');
  };

  return (
    <details className="card">
      <summary>Notifications {on && <span className="badge ok">On</span>}</summary>
      <p className="small muted">Get alerts for new messages, score reminders, schedule changes and match days. On iPhone, add the app to your Home Screen and open it from there first.</p>
      {!configured && <p className="small notice">Not set up on the server yet.</p>}
      <div className="toolbar">
        {on ? (
          <>
            <button disabled={busy} onClick={disable}>Turn off</button>
            <button disabled={busy} onClick={test}>Send a test</button>
          </>
        ) : (
          <button className="primary" disabled={busy} onClick={enable}>Turn on notifications</button>
        )}
      </div>
      {message && <p className="small">{message}</p>}
    </details>
  );
}
