import { DEFAULT_SETTINGS, type SeasonData } from './types';

/** Fill in defaults so older/partial season files (e.g. from the Numbers importer) are complete. */
export function normalizeSeason(raw: Omit<Partial<SeasonData>, 'settings'> & { settings?: Partial<SeasonData['settings']> }): SeasonData {
  return {
    season: raw.season ?? { name: 'Season' },
    settings: { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) },
    nines: raw.nines ?? [],
    teams: raw.teams ?? [],
    players: (raw.players ?? []).map((p) => ({ active: true, ...p })),
    weeks: (raw.weeks ?? []).map((w) => ({
      ...w,
      playoff: !!w.playoff,
      inclement: !!w.inclement,
      matches: w.matches ?? [],
      scores: w.scores ?? [],
    })),
  };
}
