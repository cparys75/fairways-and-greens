/**
 * An iCalendar (.ics) feed of a member's league schedule, for subscribing from a phone, computer or
 * a wall calendar display. One all-day event per scheduled week, in each league the person belongs
 * to, with their own matchup when they have one. A secret token in the URL stands in for signing in.
 */
import { getUser, playerFor, type User } from './accounts';
import { BRAND } from './brand';
import { currentSeasonId, loadSeason } from './db';
import { leaguesFor } from './leagues';
import { newToken } from './passwords';

/** The member's calendar token, made the first time it's asked for. */
export async function calendarToken(db: D1Database, userId: number): Promise<string> {
  const row = await db.prepare('SELECT calendar_token FROM users WHERE id = ?').bind(userId).first<{ calendar_token: string | null }>();
  return row?.calendar_token ?? (await resetCalendarToken(db, userId));
}

/** A fresh token; the old link stops working. */
export async function resetCalendarToken(db: D1Database, userId: number): Promise<string> {
  const token = (await newToken()).token;
  await db.prepare('UPDATE users SET calendar_token = ? WHERE id = ?').bind(token, userId).run();
  return token;
}

export async function userByCalendarToken(db: D1Database, token: string): Promise<User | null> {
  const r = await db.prepare("SELECT id FROM users WHERE calendar_token = ? AND status = 'active'").bind(token).first<{ id: number }>();
  return r ? getUser(db, r.id) : null;
}

const pad = (n: number) => String(n).padStart(2, '0');
const toDate = (iso: string) => iso.replace(/-/g, ''); // 2026-05-06 -> 20260506
function nextDay(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}
const stamp = (d = new Date()) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;

/** Escape a text value for iCalendar. */
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Fold long lines to 75 octets, as the spec recommends, so strict readers (Google) are happy. */
function fold(line: string): string {
  if (line.length <= 73) return line;
  const out = [line.slice(0, 73)];
  for (let i = 73; i < line.length; i += 72) out.push(' ' + line.slice(i, i + 72));
  return out.join('\r\n');
}

/** The whole feed for one member: every league they're in, this season. */
export async function calendarFeed(db: D1Database, user: User): Promise<string> {
  // A personal feed shows the leagues the member actually belongs to, not every league a super admin can see.
  const leagues = await leaguesFor(db, user, false);
  const now = stamp();
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${BRAND.name}//Schedule//EN`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Golf schedule',
    'NAME:Golf schedule',
    'X-WR-CALDESC:Your league schedule',
    // Ask subscribers to refresh twice a day.
    'REFRESH-INTERVAL;VALUE=DURATION:PT12H',
    'X-PUBLISHED-TTL:PT12H',
  ];

  for (const league of leagues) {
    const seasonId = await currentSeasonId(db, league.id);
    if (!seasonId) continue;
    const data = await loadSeason(db, seasonId);
    if (!data) continue;
    const playerId = await playerFor(db, seasonId, user);
    const teamId = data.players.find((p) => p.id === playerId)?.teamId ?? null;
    const teamName = (id: number) => data.teams.find((t) => t.id === id)?.name ?? `Team ${id}`;

    for (const week of data.weeks) {
      if (!week.date) continue;
      const nine = data.nines.find((n) => n.id === week.nineId);
      const match = teamId == null ? undefined : week.matches.find((m) => m.teamA === teamId || m.teamB === teamId);
      const opponent = match ? (match.teamA === teamId ? match.teamB : match.teamA) : null;
      const title = [
        `${league.name}: Week ${week.number}`,
        opponent != null ? ` vs ${teamName(opponent)}` : '',
        week.playoff ? ' (Playoffs)' : '',
      ].join('');
      const where = nine?.course || nine?.name || '';
      const detail = [
        match?.teeTime ? `Tee time ${match.teeTime}` : '',
        nine ? `${nine.name}${nine.tee ? ` (${nine.tee} tees)` : ''}` : '',
        week.inclement ? 'Marked inclement weather' : '',
      ].filter(Boolean).join('\\n');
      lines.push(
        'BEGIN:VEVENT',
        `UID:s${seasonId}-w${week.number}-u${user.id}@${BRAND.domain}`,
        `DTSTAMP:${now}`,
        `DTSTART;VALUE=DATE:${toDate(week.date)}`,
        `DTEND;VALUE=DATE:${nextDay(week.date)}`,
        fold(`SUMMARY:${esc(title)}`),
        ...(where ? [fold(`LOCATION:${esc(where)}`)] : []),
        ...(detail ? [fold(`DESCRIPTION:${esc(detail)}`)] : []),
        'TRANSP:TRANSPARENT',
        'END:VEVENT',
      );
    }
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
