import { describe, expect, it } from 'vitest';
import { individualTeams, scrambleHandicap, stablefordPoints, teamCardId } from './formats';
import { computeSeason } from './season';
import { normalizeSeason } from './normalize';
import { DEFAULT_SETTINGS, type Format, type Nine, type Player, type SeasonData } from './types';

// Par 36, hole handicaps 1-9 in order.
const nine: Nine = { id: 'n', name: 'Nine', par: [4, 4, 4, 4, 4, 4, 4, 4, 4], menHcp: [1, 2, 3, 4, 5, 6, 7, 8, 9], womenHcp: [1, 2, 3, 4, 5, 6, 7, 8, 9] };
const player = (id: number, teamId: number, hc = 0): Player => ({ id, name: `P${id}`, teamId, startingHc: hc, redTees: false });
const fives = Array(9).fill(5);
const fours = Array(9).fill(4);

function season(format: Format, players: Player[], teams: number[], scores: { playerId: number; holes: number[] }[], matches = [] as { teamA: number; teamB: number }[]): SeasonData {
  return {
    season: { name: 'Test' },
    settings: { ...DEFAULT_SETTINGS, format },
    nines: [nine],
    teams: teams.map((id) => ({ id, name: `T${id}` })),
    players,
    weeks: [{ number: 1, nineId: 'n', matches, scores }],
  };
}

describe('Stableford', () => {
  it('scores each hole from the net score against par', () => {
    const t = DEFAULT_SETTINGS.stableford;
    expect([7, 6, 5, 4, 3, 2, 1].map((net) => stablefordPoints(net, 4, t))).toEqual([0, 0, 1, 2, 3, 4, 5]);
  });

  it('adds up points for the season and ranks the most points first', () => {
    const { teams, players } = individualTeams([player(1, 0), player(2, 0, 9)]);
    // P1 (scratch) pars every hole: 18. P2 gets a stroke a hole, so bogeys are net pars too: 18; one net birdie makes 19.
    const data = season('stableford', players, teams.map((t) => t.id), [
      { playerId: 1, holes: fours },
      { playerId: 2, holes: [4, ...fives.slice(1)] },
    ]);
    data.teams = teams;
    const r = computeSeason(data);
    expect(r.weeks[0].field!.map((e) => [e.entrantId, e.value, e.rank, e.points])).toEqual([[2, 19, 1, 19], [1, 18, 2, 18]]);
    expect(r.standings.map((s) => [s.team.name, s.standingPoints, s.w])).toEqual([['P2', 19, 1], ['P1', 18, 0]]);
  });
});

describe('stroke play', () => {
  it('gives points by finishing place, sharing them on ties', () => {
    const base = [player(1, 0), player(2, 0), player(3, 0), player(4, 0)];
    const { teams, players } = individualTeams(base);
    const data = season('stroke', players, [], [
      { playerId: 1, holes: fours }, // 36
      { playerId: 2, holes: fours }, // 36
      { playerId: 3, holes: fives }, // 45
    ]);
    data.teams = teams;
    const r = computeSeason(data);
    // 3 scores: places 1 and 2 share 3 + 2; third gets 1; P4 hasn't played.
    expect(r.weeks[0].field!.map((e) => [e.entrantId, e.rank, e.points])).toEqual([[1, 1, 2.5], [2, 1, 2.5], [3, 3, 1], [4, null, 0]]);
    expect(r.weeks[0].complete).toBe(false);
    expect(r.standings.map((s) => [s.team.id, s.standingPoints, s.rounds, s.avgValue])).toEqual([[1, 2.5, 1, 36], [2, 2.5, 1, 36], [3, 1, 1, 45], [4, 0, 0, null]]);
  });
});

describe('scramble', () => {
  it('uses one card per team with a team handicap from the players’ handicaps', () => {
    expect(scrambleHandicap([20, 6], [35, 15])).toBe(5); // 6 × 35% + 20 × 15% = 5.1
    const data = season('scramble', [player(1, 1, 6), player(2, 1, 20), player(3, 2, 0), player(4, 2, 0)], [1, 2], [
      { playerId: teamCardId(1), holes: fours }, // 36 − 5 = 31
      { playerId: teamCardId(2), holes: fours }, // 36 − 0 = 36
    ]);
    const r = computeSeason(data);
    expect(r.weeks[0].field!.map((e) => [e.teamId, e.card!.hc, e.value, e.points])).toEqual([[1, 5, 31, 2], [2, 0, 36, 1]]);
    expect(r.weeks[0].complete).toBe(true);
    // Team cards don't touch the players' handicaps or records.
    expect(r.handicaps.get(1)!.differentials).toEqual([]);
    expect(r.lowGross).toBeNull();
  });
});

describe('best ball', () => {
  it('counts the better partner’s net on each hole', () => {
    const data = season(
      'bestBall',
      [player(1, 1), player(2, 1), player(3, 2), player(4, 2)],
      [1, 2],
      [
        { playerId: 1, holes: fours },
        { playerId: 2, holes: [3, ...fives.slice(1)] },
        { playerId: 3, holes: fours },
        { playerId: 4, holes: fours },
      ],
      [{ teamA: 1, teamB: 2 }],
    );
    const m = computeSeason(data).weeks[0].matches[0];
    // Team 1's best ball: 3 on hole 1, then 4s; team 2: all 4s.
    expect(m.sides[0].teamNet).toEqual([3, 4, 4, 4, 4, 4, 4, 4, 4]);
    expect(m.sides[0].teamNetTotal).toBe(35);
    expect([m.sides[0].total, m.sides[1].total]).toEqual([2 + 8 + 4, 8]);
  });
});

describe('individual match play', () => {
  it('is match play between one-player teams', () => {
    const { teams, players } = individualTeams([player(1, 0), player(2, 0)]);
    const data = season('individualMatch', players, [], [{ playerId: 1, holes: fours }, { playerId: 2, holes: fives }], [{ teamA: 1, teamB: 2 }]);
    data.teams = teams;
    const r = computeSeason(data);
    expect(r.weeks[0].matches[0].sides.map((s) => s.outcome)).toEqual(['W', 'L']);
    expect(r.standings.map((s) => [s.team.name, s.w])).toEqual([['P1', 1], ['P2', 0]]);
  });
});

describe('absent player: 2 vs 1 best ball', () => {
  // Par 36 nine, scratch players so net = gross.
  const nine = { id: 'n', name: 'Nine', par: [4, 4, 4, 4, 4, 4, 4, 4, 4], menHcp: [1, 2, 3, 4, 5, 6, 7, 8, 9], womenHcp: [1, 2, 3, 4, 5, 6, 7, 8, 9] };
  const P = (id: number, teamId: number) => ({ id, name: `P${id}`, teamId, startingHc: 0, redTees: false });
  const fours = Array(9).fill(4);
  function season(absentRule: 'virtual' | 'bestBall') {
    return normalizeSeason({
      season: { name: 'T' }, settings: { format: 'teamMatch', absentRule },
      nines: [nine], teams: [1, 2].map((id) => ({ id, name: `T${id}` })),
      players: [P(1, 1), P(2, 1), P(3, 2), P(4, 2)],
      weeks: [{ number: 1, nineId: 'n', matches: [{ teamA: 1, teamB: 2 }], scores: [
        // Team 1: P1 all 4s, P2 absent. Team 2: P3 all 5s, P4 all 4s.
        { playerId: 1, holes: fours },
        { playerId: 2, holes: null, virtual: true },
        { playerId: 3, holes: Array(9).fill(5) },
        { playerId: 4, holes: fours },
      ] }],
    } as any);
  }
  it('plays the full team’s best ball against the lone player', () => {
    const r = computeSeason(season('bestBall')).weeks[0].matches[0];
    expect(r.twoVsOne).toBe(true);
    // Team 1 present player P1 = 4s (36). Team 2 best of P3(5)/P4(4) = 4s (36). Tie each hole.
    expect(r.sides[0].teamNet).toEqual(fours);
    expect(r.sides[1].teamNet).toEqual(fours);
    expect(r.sides[0].total).toBe(r.sides[1].total);
  });
  it('still uses a virtual score when the rule is the classic one', () => {
    const r = computeSeason(season('virtual')).weeks[0].matches[0];
    expect(r.twoVsOne).toBeFalsy();
    // Team 1 = P1(4) + virtual net-39 player; Team 2 = sum of both. Team 1's absent inflates its net.
    expect(r.sides[0].teamNetTotal).toBeGreaterThan(36);
  });
});

describe('did-not-finish holes (left early / arrived late)', () => {
  // Par 36 nine, hole handicaps 1..9; scratch players so net = gross.
  const nine = { id: 'n', name: 'Nine', par: Array(9).fill(4), menHcp: [1, 2, 3, 4, 5, 6, 7, 8, 9], womenHcp: [1, 2, 3, 4, 5, 6, 7, 8, 9] };
  const P = (id: number, teamId: number) => ({ id, name: `P${id}`, teamId, startingHc: 0, redTees: false });
  const fours = Array(9).fill(4);
  // true on holes 1-3 (the player skipped them).
  const skipEarly = [true, true, true, false, false, false, false, false, false];

  function season(absentRule: 'virtual' | 'bestBall', p2Holes: number[], dnf: boolean[]) {
    return normalizeSeason({
      season: { name: 'T' }, settings: { format: 'teamMatch', absentRule },
      nines: [nine], teams: [1, 2].map((id) => ({ id, name: `T${id}` })),
      players: [P(1, 1), P(2, 1), P(3, 2), P(4, 2)],
      weeks: [{ number: 1, nineId: 'n', matches: [{ teamA: 1, teamB: 2 }], scores: [
        { playerId: 1, holes: fours },
        { playerId: 2, holes: p2Holes, dnf },
        { playerId: 3, holes: fours },
        { playerId: 4, holes: Array(9).fill(5) },
      ] }],
    } as any);
  }

  it('virtual rule: a skipped hole gets a virtual (net-39) score that counts for the team', () => {
    // virtualOverPar 3 adds a stroke on hole-handicaps 1-3, so a scratch player's fill there is par+1 = 5.
    const r = computeSeason(season('virtual', [0, 0, 0, 4, 4, 4, 4, 4, 4], skipEarly));
    const card = r.weeks[0].cards.get(2)!;
    expect(card.incomplete).toBe(true);
    expect(card.virtual).toBe(false);
    expect(card.dnf).toEqual(skipEarly);
    expect(card.gross.slice(0, 3)).toEqual([5, 5, 5]); // virtual fill on the skipped holes
    expect(card.grossTotal).toBe(39); // the classic virtual net 39
    const m = r.weeks[0].matches[0];
    expect(m.twoVsOne).toBeFalsy();
    expect(m.sides[0].teamNet.slice(0, 3)).toEqual([9, 9, 9]); // P1 4 + P2 fill 5, summed
    // An incomplete round never counts toward the handicap.
    expect(r.handicaps.get(2)!.differentials).toEqual([]);
    expect(r.handicaps.get(1)!.differentials.length).toBe(1);
  });

  it('best-ball rule: a skipped hole plays 2 vs 1, the rest plays full best ball', () => {
    // P2 birdies (3) the holes played, skips holes 7-9.
    const skipLate = [false, false, false, false, false, false, true, true, true];
    const r = computeSeason(season('bestBall', [3, 3, 3, 3, 3, 3, 0, 0, 0], skipLate));
    const m = r.weeks[0].matches[0];
    expect(m.twoVsOne).toBe(true);
    // Holes 1-6: best of P1(4)/P2(3) = 3. Holes 7-9: only P1 present = 4.
    expect(m.sides[0].teamNet).toEqual([3, 3, 3, 3, 3, 3, 4, 4, 4]);
    // Team 2 best of P3(4)/P4(5) every hole = 4.
    expect(m.sides[1].teamNet).toEqual(Array(9).fill(4));
    expect(r.handicaps.get(2)!.differentials).toEqual([]);
  });
});

describe('a whole team absent forfeits automatically', () => {
  const nine = { id: 'n', name: 'Nine', par: Array(9).fill(4), menHcp: [1, 2, 3, 4, 5, 6, 7, 8, 9], womenHcp: [1, 2, 3, 4, 5, 6, 7, 8, 9] };
  const fours = Array(9).fill(4);

  function season(scores: any[], override?: [number, number]) {
    return normalizeSeason({
      season: { name: 'T' }, settings: { format: 'teamMatch' },
      nines: [nine], teams: [1, 2].map((id) => ({ id, name: `T${id}` })),
      players: [1, 2, 3, 4].map((id) => ({ id, name: `P${id}`, teamId: id <= 2 ? 1 : 2, startingHc: 0, redTees: false })),
      weeks: [{ number: 1, nineId: 'n', matches: [{ teamA: 1, teamB: 2, pointsOverride: override ?? null }], scores }],
    } as any);
  }

  it('forfeits when both players on a team are marked absent, and ignores the winner’s scores for handicaps', () => {
    const r = computeSeason(season([
      { playerId: 1, holes: null, virtual: true },  // T1 both absent
      { playerId: 2, holes: null, virtual: true },
      { playerId: 3, holes: fours },                // T2 played
      { playerId: 4, holes: fours },
    ]));
    const m = r.weeks[0].matches[0];
    expect(m.status).toBe('forfeit');
    // Default forfeit points: loser 4, winner 18. Team 1 (absent) loses.
    expect([m.sides[0].total, m.sides[1].total]).toEqual([4, 18]);
    expect([m.sides[0].outcome, m.sides[1].outcome]).toEqual(['L', 'W']);
    // The winning team's real round is a forfeit win, so it doesn't move their handicaps.
    expect(r.handicaps.get(3)!.differentials).toEqual([]);
    expect(r.handicaps.get(4)!.differentials).toEqual([]);
    expect(r.weeks[0].complete).toBe(true);
    // But the forfeit points DO count in the season standings (18 for the win, 4 for the loss).
    const t1 = r.standings.find((s) => s.team.id === 1)!;
    const t2 = r.standings.find((s) => s.team.id === 2)!;
    expect([t2.w, t2.l, t2.standingPoints, t2.totalPoints]).toEqual([1, 0, 2, 18]);
    expect([t1.w, t1.l, t1.standingPoints, t1.totalPoints]).toEqual([0, 1, 0, 4]);
    // And the winner's real scorecard still counts toward low-gross/low-net records.
    expect(r.lowGross!.value).toBe(36);
    expect(r.lowGross!.entries.map((e) => e.player.id).sort()).toEqual([3, 4]);
  });

  it('does not forfeit when only one player on a team is absent (2 vs 1 territory)', () => {
    const r = computeSeason(season([
      { playerId: 1, holes: fours },
      { playerId: 2, holes: null, virtual: true },
      { playerId: 3, holes: fours },
      { playerId: 4, holes: fours },
    ]));
    expect(r.weeks[0].matches[0].status).not.toBe('forfeit');
  });

  it('keeps an admin’s manual forfeit and still ignores the winner’s scores for handicaps', () => {
    // Both teams posted real scores, but the admin recorded a forfeit (team 2 wins).
    const r = computeSeason(season([
      { playerId: 1, holes: fours },
      { playerId: 2, holes: fours },
      { playerId: 3, holes: fours },
      { playerId: 4, holes: fours },
    ], [4, 18]));
    expect(r.weeks[0].matches[0].status).toBe('forfeit');
    expect(r.handicaps.get(3)!.differentials).toEqual([]);
    expect(r.handicaps.get(1)!.differentials).toEqual([]);
  });
});

describe('absent on both teams becomes 1 vs 1', () => {
  const nine = { id: 'n', name: 'Nine', par: Array(9).fill(4), menHcp: [1, 2, 3, 4, 5, 6, 7, 8, 9], womenHcp: [1, 2, 3, 4, 5, 6, 7, 8, 9] };
  it('scores the two present players head to head', () => {
    const data = normalizeSeason({
      season: { name: 'T' }, settings: { format: 'teamMatch', absentRule: 'bestBall' },
      nines: [nine], teams: [1, 2].map((id) => ({ id, name: `T${id}` })),
      players: [1, 2, 3, 4].map((id) => ({ id, name: `P${id}`, teamId: id <= 2 ? 1 : 2, startingHc: 0, redTees: false })),
      weeks: [{ number: 1, nineId: 'n', matches: [{ teamA: 1, teamB: 2 }], scores: [
        { playerId: 1, holes: Array(9).fill(4) },         // T1 present
        { playerId: 2, holes: null, virtual: true },      // T1 absent
        { playerId: 3, holes: null, virtual: true },      // T2 absent
        { playerId: 4, holes: Array(9).fill(5) },         // T2 present
      ] }],
    } as any);
    const r = computeSeason(data).weeks[0].matches[0];
    expect(r.twoVsOne).toBe(true);
    expect(r.sides[0].teamNet).toEqual(Array(9).fill(4)); // just P1
    expect(r.sides[1].teamNet).toEqual(Array(9).fill(5)); // just P4
    expect(r.sides[0].outcome).toBe('W');
  });
});
