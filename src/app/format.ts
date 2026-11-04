import type { Player, SeasonData, Team } from '../engine';

export const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

export const formatDate = (iso?: string | null) =>
  iso ? new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';

export const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

export const fixed = (n: number, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : '');

export function lookups(data: SeasonData) {
  const players = new Map(data.players.map((p) => [p.id, p]));
  const teams = new Map(data.teams.map((t) => [t.id, t]));
  const teamPlayers = (teamId: number) => data.players.filter((p) => p.teamId === teamId && p.active !== false);
  const teamLabel = (teamId: number) => {
    const t = teams.get(teamId);
    const names = teamPlayers(teamId).map((p) => lastName(p));
    return names.length ? names.join(' / ') : (t?.name ?? `Team ${teamId}`);
  };
  return { players, teams, teamPlayers, teamLabel };
}

export const lastName = (p: Player) => p.name.split(' ').slice(-1)[0];
export const teamName = (t: Team | undefined) => t?.name ?? '';
