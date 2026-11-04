import { useEffect, useState } from 'react';
import { api, type SiteUsage } from '../api';
import { formatDate } from '../format';

const FREE_DB_BYTES = 5 * 1024 ** 3; // D1 free plan

/** How the whole site is being used, and where to look for more (site admins). */
export function SitePage() {
  const [site, setSite] = useState<SiteUsage | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.site().then(setSite, (e: Error) => setError(e.message));
  }, []);
  if (error) return <p className="error">{error}</p>;
  if (!site) return <p className="empty">Loading…</p>;
  const mb = site.databaseBytes == null ? null : site.databaseBytes / 1024 ** 2;

  return (
    <>
      <h1>Site</h1>
      <p className="muted small">Everything on the site, across all leagues. Only site admins see this page.</p>
      <div className="stat-row">
        <Stat label="Accounts" value={site.accounts.active} note={`${site.accounts.newMonth} new in 30 days`} />
        <Stat label="Signed in, 7 days" value={site.accounts.signedInWeek} note={`${site.accounts.signedInMonth} in 30 days`} />
        <Stat label="Waiting for approval" value={site.accounts.pending} />
        <Stat label="League scores, 30 days" value={site.activity.leagueScoresMonth} />
        <Stat label="Personal rounds, 30 days" value={site.rounds.month} note={`${site.rounds.total} in all`} />
        <Stat label="Playing now" value={site.rounds.live} note={`${site.rounds.guestLinks} guest links open`} />
        <Stat label="Board posts, 30 days" value={site.activity.postsMonth} />
        <Stat label="Database" value={mb == null ? '–' : `${mb.toFixed(1)} MB`} note={mb == null ? '' : `${((site.databaseBytes! / FREE_DB_BYTES) * 100).toFixed(2)}% of the free 5 GB`} />
      </div>

      <h2>Leagues</h2>
      <div className="card table-card scroll">
        <table>
          <thead>
            <tr><th className="left">League</th><th className="left">Current season</th><th>Players</th><th>Admins</th><th>Asking to join</th><th className="left">Last activity (UTC)</th></tr>
          </thead>
          <tbody>
            {site.leagues.map((l) => (
              <tr key={l.id}>
                <td className="left"><strong>{l.name}</strong><div className="small muted">since {formatDate(l.created_at.slice(0, 10))}</div></td>
                <td className="left">{l.current_season ?? <span className="muted">none yet</span>}</td>
                <td>{l.players}</td>
                <td>{l.admins}</td>
                <td>{l.requests || ''}</td>
                <td className="left small">{l.last_activity ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Recent changes</h2>
      <div className="card table-card scroll">
        <table>
          <tbody>
            {site.recent.map((a, i) => (
              <tr key={i}>
                <td className="left small muted">{a.at}</td>
                <td className="left">{a.action}</td>
                <td className="left small">{a.league ?? ''}</td>
                <td className="left small muted wrap-ok">{a.detail ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="card">
        <h3>Keeping an eye on it</h3>
        <ul className="small">
          <li><strong>Up or down:</strong> an uptime monitor checks <code>{location.origin}/api/health</code> every few minutes and emails you if it stops answering.</li>
          <li><strong>Traffic and errors:</strong> Cloudflare dashboard → Workers &amp; Pages → golf-league → Metrics. Free plan: 100,000 requests a day.</li>
          <li><strong>Database use:</strong> Cloudflare → Storage &amp; Databases → D1 → golf-league → Metrics. Free plan: 5 million reads and 100,000 writes a day.</li>
          <li><strong>Backups:</strong> GitHub → Actions → Backup: a full copy every Monday, kept 90 days. Cloudflare Time Travel can also restore the last 7 days.</li>
          <li><strong>Updates:</strong> Dependabot opens pull requests for package updates each Monday; tests run on each.</li>
        </ul>
      </section>
    </>
  );
}

function Stat({ label, value, note }: { label: string; value: number | string; note?: string }) {
  return (
    <div className="card stat">
      <div className="small muted">{label}</div>
      <div className="stat-value">{value}</div>
      {note && <div className="small muted">{note}</div>}
    </div>
  );
}
