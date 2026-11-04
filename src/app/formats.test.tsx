/** Every league page renders for every format (server-side render: catches crashes, not looks). */
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { computeSeason, FORMATS, individualTeams, normalizeSeason, teamCardId, type Format, type Player, type SeasonData, type Team } from '../engine';
import { RosterPage } from './admin/Roster';
import { ScoreEntryPage } from './admin/ScoreEntry';
import { SettingsPage } from './admin/Settings';
import { PlayerPage } from './pages/Player';
import { HandicapsPage } from './pages/Handicaps';
import { ResultsPage } from './pages/Results';
import { RulesPage } from './pages/Rules';
import { SchedulePage } from './pages/Schedule';
import { StandingsPage } from './pages/Standings';
import { SeasonContext } from './season';

const nine = { id: 'n', name: 'Front', par: [4, 4, 3, 5, 4, 4, 3, 5, 4], menHcp: [1, 2, 3, 4, 5, 6, 7, 8, 9], womenHcp: [1, 2, 3, 4, 5, 6, 7, 8, 9] };
const holes = (n: number) => Array(9).fill(n);

function seasonFor(format: Format): SeasonData {
  const f = FORMATS.find((x) => x.id === format)!;
  let teams: Team[] = [1, 2].map((id) => ({ id, name: `Team ${id}` }));
  let players: Player[] = [1, 2, 3, 4].map((id) => ({ id, name: `Player ${id}`, teamId: id <= 2 ? 1 : 2, startingHc: id * 2, redTees: false }));
  if (f.individual) ({ teams, players } = individualTeams(players));
  const scoreIds = f.teamCard ? [teamCardId(1), teamCardId(2)] : players.map((p) => p.id);
  return normalizeSeason({
    season: { id: 1, name: 'Test' },
    settings: { format },
    nines: [nine],
    teams,
    players,
    weeks: [1, 2].map((number) => ({
      number,
      date: `2026-05-0${number}`,
      nineId: 'n',
      matches: f.field ? [] : f.individual ? [{ teamA: 1, teamB: 2 }, { teamA: 3, teamB: 4 }] : [{ teamA: 1, teamB: 2 }],
      scores: number === 1 ? scoreIds.map((playerId, i) => ({ playerId, holes: holes(4 + (i % 2)) })) : [],
    })),
  });
}

function render(data: SeasonData, path: string, route: string, element: React.ReactElement) {
  const value = {
    leagues: [{ id: 1, name: 'League', role: 'admin' as const }],
    league: { id: 1, name: 'League', role: 'admin' as const },
    leagueId: 1,
    setLeagueId: () => undefined,
    superAdmin: true,
    seasons: [{ id: 1, name: 'Test', isCurrent: true, updatedAt: '' }],
    seasonId: 1,
    setSeasonId: () => undefined,
    data,
    result: computeSeason(data),
    error: null,
    loading: false,
    reload: async () => undefined,
    admin: true,
    todo: null,
    refreshTodo: async () => undefined,
    me: null,
    refreshMe: async () => undefined,
  };
  return renderToString(
    <SeasonContext.Provider value={value}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={route} element={element} />
        </Routes>
      </MemoryRouter>
    </SeasonContext.Provider>,
  );
}

describe.each(FORMATS.map((f) => f.id))('%s', (format) => {
  const data = seasonFor(format);
  it.each([
    ['/standings', '/standings', <StandingsPage />],
    ['/results/1', '/results/:week', <ResultsPage />],
    ['/handicaps', '/handicaps', <HandicapsPage />],
    ['/schedule', '/schedule', <SchedulePage />],
    ['/rules', '/rules', <RulesPage />],
    ['/players/1', '/players/:id', <PlayerPage />],
    ['/admin/scores/1', '/admin/scores/:week', <ScoreEntryPage />],
    ['/admin/settings', '/admin/settings', <SettingsPage />],
    ['/admin/roster', '/admin/roster', <RosterPage />],
  ])('renders %s', (path, route, element) => {
    const html = render(data, path, route, element);
    expect(html.length).toBeGreaterThan(100);
  });

  it('shows the week’s scores', () => {
    const html = render(data, '/results/1', '/results/:week', <ResultsPage />);
    expect(html).toContain(FORMATS.find((f) => f.id === format)!.teamCard ? 'Team 1' : 'Player 1');
  });
});
