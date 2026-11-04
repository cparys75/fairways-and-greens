/**
 * Turn a season JSON file into SQL for `wrangler d1 execute` (used for first-time setup):
 *   npx tsx tools/seed-sql.ts data/season-2025.json > data/seed.sql
 */
import { readFileSync } from 'node:fs';
import { normalizeSeason } from '../src/engine';

const raw = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const data = normalizeSeason(raw);
const q = (v: unknown) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const b = (v: unknown) => (v ? 1 : 0);
const out: string[] = [];
const sid = `(SELECT id FROM seasons WHERE name = ${q(data.season.name)})`;

out.push(`UPDATE seasons SET is_current = 0;`);
out.push(`INSERT INTO seasons (name, settings, nines, is_current) VALUES (${q(data.season.name)}, ${q(JSON.stringify(data.settings))}, ${q(JSON.stringify(data.nines))}, 1);`);
for (const t of data.teams) out.push(`INSERT INTO teams (season_id, id, name) VALUES (${sid}, ${t.id}, ${q(t.name)});`);
for (const p of data.players) {
  out.push(`INSERT INTO players (season_id, id, name, team_id, starting_hc, red_tees, active) VALUES (${sid}, ${p.id}, ${q(p.name)}, ${q(p.teamId)}, ${p.startingHc}, ${b(p.redTees)}, ${b(p.active !== false)});`);
}
for (const w of data.weeks) {
  out.push(`INSERT INTO weeks (season_id, number, date, nine_id, playoff, inclement) VALUES (${sid}, ${w.number}, ${q(w.date)}, ${q(w.nineId)}, ${b(w.playoff)}, ${b(w.inclement)});`);
  w.matches.forEach((m, i) => {
    out.push(`INSERT INTO matches (season_id, week, idx, slot, tee_time, team_a, team_b, override_a, override_b) VALUES (${sid}, ${w.number}, ${i}, ${q(m.slot)}, ${q(m.teeTime)}, ${m.teamA}, ${m.teamB}, ${q(m.pointsOverride?.[0])}, ${q(m.pointsOverride?.[1])});`);
  });
  for (const s of w.scores) {
    // Handicaps are recalculated by the engine (verified identical to the spreadsheet), so they aren't stored.
    out.push(`INSERT INTO scores (season_id, week, player_id, holes, virtual) VALUES (${sid}, ${w.number}, ${s.playerId}, ${s.virtual ? 'NULL' : q(JSON.stringify(s.holes))}, ${b(s.virtual)});`);
  }
}
console.log(out.join('\n'));
