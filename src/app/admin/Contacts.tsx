import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { api, type Contact } from '../api';
import { useSeason } from '../season';
import { BRAND } from '../../brand';

const SUBJECT = BRAND.name;

/** Everyone's email and phone, with a pick-who-to-email tool through the admin's own email. */
export function ContactsPage() {
  const { seasonId, data } = useSeason();
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [copied, setCopied] = useState(false);
  const [activeOnly, setActiveOnly] = useState(true);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (seasonId) api.contacts(seasonId).then(setContacts, () => setContacts([]));
  }, [seasonId]);

  // Start with everyone who has an email selected (the old "email everyone" default).
  useEffect(() => {
    if (contacts) setSelected(new Set(contacts.filter((c) => c.email).map((c) => c.playerId)));
  }, [contacts]);

  const shown = useMemo(() => (contacts ?? []).filter((c) => !activeOnly || c.active), [contacts, activeOnly]);
  if (!contacts) return <p className="empty">Loading…</p>;

  const team = (id: number | null) => data?.teams.find((t) => t.id === id)?.name ?? '';
  const emailable = shown.filter((c) => c.email);
  const chosen = emailable.filter((c) => selected.has(c.playerId));
  const emails = [...new Set(chosen.map((c) => c.email as string))];
  const bcc = emails.join(',');
  const allChosen = emailable.length > 0 && chosen.length === emailable.length;

  const toggle = (playerId: number) =>
    setSelected((s) => {
      const next = new Set(s);
      next.has(playerId) ? next.delete(playerId) : next.add(playerId);
      return next;
    });
  const setAll = (on: boolean) => setSelected(on ? new Set(emailable.map((c) => c.playerId)) : new Set());
  const copy = async () => {
    await navigator.clipboard?.writeText(emails.join(', '));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      <h1>Contacts</h1>
      <section className="card">
        <h3>Email players</h3>
        <p className="small muted">
          Tick the players you want, then open a message from your own email with them in BCC, so nobody sees the others’ addresses and replies
          come to you.
        </p>
        <div className="toolbar">
          <a
            className={`button primary ${emails.length ? '' : 'disabled'}`}
            aria-disabled={!emails.length}
            href={emails.length ? `mailto:?bcc=${encodeURIComponent(bcc)}&subject=${encodeURIComponent(SUBJECT)}` : undefined}
          >
            ✉ Email {emails.length} selected
          </a>
          <a
            className={`button ${emails.length ? '' : 'disabled'}`}
            aria-disabled={!emails.length}
            target="_blank"
            rel="noreferrer"
            href={emails.length ? `https://mail.google.com/mail/?view=cm&fs=1&bcc=${encodeURIComponent(bcc)}&su=${encodeURIComponent(SUBJECT)}` : undefined}
          >
            Open in Gmail
          </a>
          <button disabled={!emails.length} onClick={copy}>{copied ? 'Copied ✓' : 'Copy addresses'}</button>
          <span className="spacer" />
          <button onClick={() => setAll(true)}>Select all</button>
          <button onClick={() => setAll(false)}>Clear</button>
          <label className="check small"><input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} /> Active players only</label>
        </div>
      </section>

      <div className="card table-card scroll">
        <table>
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  aria-label="Select all"
                  checked={allChosen}
                  ref={(el) => {
                    if (el) el.indeterminate = chosen.length > 0 && !allChosen;
                  }}
                  onChange={(e) => setAll(e.target.checked)}
                />
              </th>
              <th className="left">Player</th>
              <th className="left">Team</th>
              <th className="left">Email</th>
              <th className="left">Phone</th>
              <th>Texts OK</th>
              <th>Account</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((c) => (
              <tr key={c.playerId} className={`${c.active ? '' : 'is-virtual'} ${c.email && selected.has(c.playerId) ? 'row-selected' : ''}`}>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Email ${c.name}`}
                    disabled={!c.email}
                    checked={!!c.email && selected.has(c.playerId)}
                    onChange={() => toggle(c.playerId)}
                  />
                </td>
                <td className="left">{c.name}</td>
                <td className="left small">{team(c.teamId)}</td>
                <td className="left small">{c.email ? <a href={`mailto:${c.email}`}>{c.email}</a> : <span className="muted">—</span>}</td>
                <td className="left small">{c.phone ? <a href={`tel:${c.phone}`}>{formatPhone(c.phone)}</a> : <span className="muted">—</span>}</td>
                <td>{c.smsOk ? '✓' : ''}</td>
                <td className="small">{c.hasAccount ? '✓' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        Players without an email can’t be selected — add one on <Link to="/admin/roster">Teams &amp; players</Link>. Phone numbers come from each
        player’s Profile or Teams &amp; players; “Texts OK” means they agreed to league texts on their Profile.
      </p>
    </>
  );
}

/** +13035550101 → (303) 555-0101 for US numbers. */
export function formatPhone(p: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(p);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : p;
}
