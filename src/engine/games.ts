/**
 * Side games for a group round: stroke play, match play, Nassau, skins, Stableford, wolf and Vegas.
 * Everything is worked out from the hole scores (0 = not played yet), the players' handicaps as typed
 * in for the round, and a few choices made per hole (who the wolf picked).
 */
import { stablefordPoints } from './formats';

export type GameId = 'stroke' | 'match' | 'nassau' | 'skins' | 'stableford' | 'wolf' | 'vegas';

export interface GameSetup {
  id: GameId;
  /** Use the players' handicaps: full strokes, or strokes off the lowest handicap in the group. */
  handicaps: 'off' | 'full' | 'offLow';
  /** Settle in points, or dollars at `unit` per point. */
  stakes: 'points' | 'money';
  unit: number;
  /** Two-on-two games (match play with four, Vegas): the players on side A, by index. The rest are side B. */
  teamA?: number[];
  /** Skins: a tied hole's skin carries over to the next hole. */
  carryover?: boolean;
  /** Vegas: a birdie flips the other side's number, high digit first. */
  birdieFlip?: boolean;
  /** Wolf: per hole, the wolf's partner (player index), 'lone', or null if not chosen yet. */
  wolf?: (number | 'lone' | null)[];
}

export interface GameInfo {
  id: GameId;
  name: string;
  players: string;
  /** Who can play: the number of players it needs. */
  fits: (n: number) => boolean;
  summary: string;
  /** How to play, a few short points. */
  howTo: string[];
}

export const GAMES: GameInfo[] = [
  {
    id: 'stroke',
    name: 'Stroke play',
    players: '2 or more',
    fits: (n) => n >= 2,
    summary: 'Lowest total score wins.',
    howTo: [
      'Everyone counts every stroke; lowest total for the round wins.',
      'With handicaps, your net total (gross minus your strokes) counts.',
      'Settling: each player pays the winner 1 point. Tied winners split it.',
    ],
  },
  {
    id: 'match',
    name: 'Match play',
    players: '2, or 4 as two teams',
    fits: (n) => n === 2 || n === 4,
    summary: 'Win holes, not strokes. The side that wins more holes wins the match.',
    howTo: [
      'Each hole is won by the lower score (net with handicaps); a tie halves the hole.',
      'The match is “2 up” when you’ve won two more holes than the other side; it’s over when one side is up by more holes than are left (e.g. “3 & 2”).',
      'With four players it’s two against two, best ball: each team’s better score on the hole counts.',
      'Settling: the match is worth 1 point.',
    ],
  },
  {
    id: 'nassau',
    name: 'Nassau',
    players: '2, or 4 as two teams',
    fits: (n) => n === 2 || n === 4,
    summary: 'Three match-play bets in one: the front nine, the back nine and the whole 18.',
    howTo: [
      'Played like match play, hole by hole (best ball with two teams).',
      'Three separate bets of 1 point each: front 9, back 9 and overall 18. On a 9-hole round there is just the one.',
      'You can lose the front and still win the back and the overall.',
    ],
  },
  {
    id: 'skins',
    name: 'Skins',
    players: '2 or more',
    fits: (n) => n >= 2,
    summary: 'Every hole is worth a skin. Win the hole outright to take it.',
    howTo: [
      'The lowest score on a hole (net with handicaps) wins that hole’s skin, but only if nobody ties it.',
      'With carry-over on, a tied hole’s skin rolls to the next hole, so one hole can be worth several skins.',
      'Settling: each skin is worth 1 point from every other player.',
    ],
  },
  {
    id: 'stableford',
    name: 'Stableford',
    players: '1 or more',
    fits: (n) => n >= 1,
    summary: 'Points for each hole’s score; the most points wins. A blow-up hole costs you less.',
    howTo: [
      'Points on each hole (net with handicaps): double bogey or worse 0, bogey 1, par 2, birdie 3, eagle 4, albatross 5.',
      'Highest total wins.',
      'Settling: pairs settle the difference in Stableford points (beat someone by 3 points and they owe you 3).',
    ],
  },
  {
    id: 'wolf',
    name: 'Wolf',
    players: '4',
    fits: (n) => n === 4,
    summary: 'A rotating “wolf” picks a partner after the drives, or goes it alone for double.',
    howTo: [
      'Players take turns being the wolf: player 1 on the first hole, player 2 on the second, and so on.',
      'The wolf watches the others tee off and picks a partner right after that player’s drive, before the next one hits. Pass on everyone and the wolf is a “lone wolf”.',
      'Two on two: each team’s best score on the hole counts. Winners each get 1 point from a loser.',
      'Lone wolf against three: win and each of the three pays the wolf 2 points; lose and the wolf pays each of them 2. Ties are a push.',
      'Pick the wolf’s choice on each hole in the app before the scores.',
    ],
  },
  {
    id: 'vegas',
    name: 'Las Vegas',
    players: '4 as two teams',
    fits: (n) => n === 4,
    summary: 'Two-person teams put their scores together into a two-digit number. Lower number wins the difference.',
    howTo: [
      'Each team makes a number from its two scores, lower score first: a 4 and a 5 make 45. A score of 10 or more goes first: 4 and 10 make 104.',
      'The lower number wins the difference in points: 45 against 56 wins 11 points.',
      'Birdie flip (optional): if a team makes a birdie, the other team’s number flips, higher score first (56 becomes 65).',
      'Points add up over the round. It swings fast, so play for small stakes per point.',
    ],
  },
];

export const gameInfo = (id: GameId) => GAMES.find((g) => g.id === id)!;

export interface GamePlayer {
  name: string;
  /** Handicap for 18 holes as typed in for the round, or null. */
  handicap: number | null;
  /** Gross score per hole; 0 = not played yet. */
  holes: number[];
}

export interface GameResult {
  /** Points won (+) or owed (−) per player, in player order. Sums to zero for betting games. */
  units: number[];
  /** Short standing per player, e.g. "2 skins", "34 pts", "+3". */
  standing: string[];
  /** One line on how it stands, e.g. "Chris & Sam 2 UP thru 7". */
  status: string;
  /** Per hole: what happened, e.g. "Sam wins skin (2)". Empty when not played. */
  holes: string[];
  /** Strokes received per player per hole. */
  strokes: number[][];
}

/** Strokes on each hole for a handicap: one per hole for every round's worth, then the hardest holes first. */
export function strokesPerHole(handicap: number, hcp: (number | null)[] | null, holes: number): number[] {
  if (handicap <= 0) return Array(holes).fill(0);
  // Handicaps are for 18 holes; a nine gets half.
  const hc = holes < 18 ? Math.round((handicap * holes) / 18) : handicap;
  // Rank this round's holes by difficulty (stroke index); without one, hole order.
  const order = Array.from({ length: holes }, (_, h) => h).sort((a, b) => (hcp?.[a] ?? a + 1) - (hcp?.[b] ?? b + 1));
  const rank = new Map(order.map((h, i) => [h, i + 1]));
  return Array.from({ length: holes }, (_, h) => Math.floor(hc / holes) + (rank.get(h)! <= hc % holes ? 1 : 0));
}

export function playGame(game: GameSetup, par: number[], hcp: (number | null)[] | null, players: GamePlayer[]): GameResult {
  const n = players.length;
  const H = par.length;
  const low = Math.min(...players.map((p) => p.handicap ?? 0));
  const strokes = players.map((p) =>
    game.handicaps === 'off' ? Array(H).fill(0) : strokesPerHole((p.handicap ?? 0) - (game.handicaps === 'offLow' ? low : 0), hcp, H),
  );
  const played = (h: number) => players.every((p) => p.holes[h] > 0);
  const net = (i: number, h: number) => players[i].holes[h] - strokes[i][h];
  const out: GameResult = { units: Array(n).fill(0), standing: Array(n).fill(''), status: '', holes: Array(H).fill(''), strokes };
  const name = (i: number) => players[i].name;
  const names = (is: number[]) => is.map(name).join(' & ');
  const teams = (): [number[], number[]] => {
    if (n === 2) return [[0], [1]];
    const a = game.teamA?.length === 2 ? game.teamA : [0, 1];
    return [a, players.map((_, i) => i).filter((i) => !a.includes(i))];
  };
  const best = (side: number[], h: number) => Math.min(...side.map((i) => net(i, h)));

  switch (game.id) {
    case 'stroke': {
      const totals = players.map((_, i) => sumOver(H, (h) => (players[i].holes[h] > 0 ? net(i, h) : 0)));
      const thru = countPlayed(H, played);
      players.forEach((_, i) => (out.standing[i] = `${totals[i]}${thru < H ? ` thru ${thru}` : ''}`));
      if (thru === H) {
        const min = Math.min(...totals);
        const winners = totals.flatMap((t, i) => (t === min ? [i] : []));
        if (winners.length < n) {
          // Everyone else pays 1, split among tied winners.
          const pot = n - winners.length;
          players.forEach((_, i) => (out.units[i] = winners.includes(i) ? pot / winners.length : -1));
        }
        out.status = winners.length === n ? 'All square' : `${names(winners)} win${winners.length === 1 ? 's' : ''} with ${min}`;
      } else {
        const min = Math.min(...totals);
        out.status = thru ? `Leader: ${names(totals.flatMap((t, i) => (t === min ? [i] : [])))} (${min} thru ${thru})` : 'Not started';
      }
      break;
    }
    case 'match':
    case 'nassau': {
      const [a, b] = teams();
      const holeWinner = (h: number) => (!played(h) ? null : Math.sign(best(b, h) - best(a, h))); // 1: A wins, −1: B wins, 0: halved
      const segment = (from: number, to: number) => {
        let up = 0;
        let thru = 0;
        let decided: string | null = null;
        for (let h = from; h < to; h++) {
          const w = holeWinner(h);
          if (w == null) break;
          up += w;
          thru = h - from + 1;
          const left = to - from - thru;
          if (!decided && Math.abs(up) > left) decided = left ? `${Math.abs(up)} & ${left}` : `${Math.abs(up)} up`;
        }
        const done = thru === to - from || decided != null;
        return { up, thru, done, decided };
      };
      for (let h = 0; h < H; h++) {
        const w = holeWinner(h);
        if (w != null) out.holes[h] = w === 0 ? 'Halved' : `${names(w > 0 ? a : b)} win${(w > 0 ? a : b).length === 1 ? 's' : ''}`;
      }
      const describe = (label: string, s: ReturnType<typeof segment>) => {
        if (!s.thru) return `${label}not started`;
        const leader = s.up > 0 ? names(a) : names(b);
        if (s.done) return s.up === 0 ? `${label}halved` : `${label}${leader} won ${s.decided ?? `${Math.abs(s.up)} up`}`;
        return s.up === 0 ? `${label}all square thru ${s.thru}` : `${label}${leader} ${Math.abs(s.up)} UP thru ${s.thru}`;
      };
      const bets = game.id === 'nassau' && H === 18 ? [['Front: ', 0, 9], ['Back: ', 9, 18], ['Overall: ', 0, 18]] as const : [['', 0, H]] as const;
      const lines: string[] = [];
      for (const [label, from, to] of bets) {
        const s = segment(from, to);
        lines.push(describe(label, s));
        if (s.done && s.up !== 0) settle(out.units, s.up > 0 ? a : b, s.up > 0 ? b : a, 1);
      }
      out.status = lines.join(' · ');
      const whole = segment(0, H);
      players.forEach((_, i) => (out.standing[i] = whole.up === 0 ? 'AS' : (a.includes(i) ? whole.up > 0 : whole.up < 0) ? `${Math.abs(whole.up)} UP` : `${Math.abs(whole.up)} DN`));
      break;
    }
    case 'skins': {
      const won = Array(n).fill(0);
      let carry = 0;
      for (let h = 0; h < H; h++) {
        if (!played(h)) break;
        const nets = players.map((_, i) => net(i, h));
        const min = Math.min(...nets);
        const at = nets.flatMap((x, i) => (x === min ? [i] : []));
        const value = 1 + carry;
        if (at.length === 1) {
          won[at[0]] += value;
          settle(out.units, [at[0]], players.map((_, i) => i).filter((i) => i !== at[0]), value);
          out.holes[h] = `${name(at[0])} wins ${value > 1 ? `${value} skins` : 'the skin'}`;
          carry = 0;
        } else {
          carry = game.carryover === false ? 0 : value;
          out.holes[h] = game.carryover === false ? 'Tied: no skin' : `Tied: ${value} carr${value === 1 ? 'ies' : 'y'} over`;
        }
      }
      players.forEach((_, i) => (out.standing[i] = `${won[i]} skin${won[i] === 1 ? '' : 's'}`));
      out.status = carry ? `${carry} skin${carry === 1 ? '' : 's'} carrying over` : '';
      break;
    }
    case 'stableford': {
      const table = [0, 1, 2, 3, 4, 5];
      const pts = players.map((p, i) => sumOver(H, (h) => (p.holes[h] > 0 ? stablefordPoints(net(i, h), par[h], table) : 0)));
      players.forEach((_, i) => (out.standing[i] = `${pts[i]} pts`));
      // Every pair settles the difference in points.
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i !== j) out.units[i] += pts[i] - pts[j];
      const max = Math.max(...pts);
      out.status = n > 1 && pts.some((p) => p) ? `Leader: ${names(pts.flatMap((p, i) => (p === max ? [i] : [])))} (${max} pts)` : '';
      break;
    }
    case 'wolf': {
      for (let h = 0; h < H; h++) {
        const wolf = h % n;
        const pick = game.wolf?.[h] ?? null;
        if (!played(h)) continue;
        if (pick == null) {
          out.holes[h] = `${name(wolf)} is the wolf: pick a partner or lone wolf`;
          continue;
        }
        const wolves = pick === 'lone' ? [wolf] : [wolf, pick];
        const others = players.map((_, i) => i).filter((i) => !wolves.includes(i));
        const diff = best(others, h) - best(wolves, h);
        if (diff === 0) out.holes[h] = 'Push';
        else if (pick === 'lone') {
          // The lone wolf wins or pays 2 from / to each of the others.
          if (diff > 0) settle(out.units, wolves, others, 2);
          else others.forEach((o) => ((out.units[o] += 2), (out.units[wolf] -= 2)));
          out.holes[h] = diff > 0 ? `Lone wolf ${name(wolf)} wins` : `Lone wolf ${name(wolf)} loses`;
        } else {
          // Each winner gets 1 from one loser.
          const [win, lose] = diff > 0 ? [wolves, others] : [others, wolves];
          settle(out.units, win, lose, 1);
          out.holes[h] = `${names(win)} win`;
        }
      }
      const next = Array.from({ length: H }, (_, h) => h).find((h) => !played(h));
      out.status = next == null ? '' : `Hole ${next + 1}: ${name(next % n)} is the wolf`;
      players.forEach((_, i) => (out.standing[i] = signedPts(out.units[i])));
      break;
    }
    case 'vegas': {
      const [a, b] = teams();
      let total = 0; // + means side A is ahead
      for (let h = 0; h < H; h++) {
        if (!played(h)) break;
        const birdie = (side: number[]) => side.some((i) => net(i, h) < par[h]);
        let na = vegasNumber(a.map((i) => net(i, h)), false);
        let nb = vegasNumber(b.map((i) => net(i, h)), false);
        if (game.birdieFlip !== false) {
          if (birdie(a) && !birdie(b)) nb = vegasNumber(b.map((i) => net(i, h)), true);
          if (birdie(b) && !birdie(a)) na = vegasNumber(a.map((i) => net(i, h)), true);
        }
        total += nb - na;
        out.holes[h] = na === nb ? `${na} – ${nb}: push` : `${na} – ${nb}: ${names(na < nb ? a : b)} +${Math.abs(nb - na)}`;
      }
      if (total) settle(out.units, total > 0 ? a : b, total > 0 ? b : a, Math.abs(total));
      out.status = total === 0 ? 'All square' : `${names(total > 0 ? a : b)} up ${Math.abs(total)}`;
      players.forEach((_, i) => (out.standing[i] = signedPts(out.units[i])));
      break;
    }
  }
  return out;
}

/** Each loser pays `amount`, shared among the winners (two on two: each winner gets `amount`). */
function settle(units: number[], winners: number[], losers: number[], amount: number) {
  losers.forEach((l) => (units[l] -= amount));
  winners.forEach((w) => (units[w] += (amount * losers.length) / winners.length));
}

/** Two scores as a Vegas number: low first (or high first when flipped); a 10+ always goes first. */
export function vegasNumber(scores: number[], flipped: boolean): number {
  const [lo, hi] = [...scores].sort((x, y) => x - y);
  if (hi >= 10) return Number(`${hi}${lo}`);
  return flipped ? hi * 10 + lo : lo * 10 + hi;
}

const sumOver = (n: number, f: (h: number) => number) => Array.from({ length: n }, (_, h) => f(h)).reduce((a, b) => a + b, 0);
const countPlayed = (n: number, played: (h: number) => boolean) => {
  let c = 0;
  while (c < n && played(c)) c++;
  return c;
};
const signedPts = (u: number) => (u > 0 ? `+${round2(u)}` : u < 0 ? `−${round2(-u)}` : 'even');
const round2 = (x: number) => Math.round(x * 100) / 100;

/** "+$12.00" / "−3 pts" for a player's result. */
export function formatUnits(units: number, game: Pick<GameSetup, 'stakes' | 'unit'>): string {
  if (Math.abs(units) < 1e-9) return 'even';
  const sign = units > 0 ? '+' : '−';
  if (game.stakes === 'money') return `${sign}$${(Math.abs(units) * game.unit).toFixed(2)}`;
  return `${sign}${round2(Math.abs(units))} pt${Math.abs(units) === 1 ? '' : 's'}`;
}
