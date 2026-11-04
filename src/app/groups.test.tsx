/** The group setup renders every game's rules and options (server-side render: catches crashes). */
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GAMES } from '../engine';
import { GamePicker, GroupSetup } from './components/GroupSetup';

const names = ['You', 'Sam', 'Bob', 'Al'];

describe('group setup', () => {
  it.each(GAMES.map((g) => g.id))('explains %s and its options', (id) => {
    const html = renderToString(<GamePicker game={{ id, handicaps: 'full', stakes: 'money', unit: 2 }} names={names} onChange={() => undefined} />);
    expect(html).toContain('How to play');
    expect(html).toContain('Dollars per point');
  });

  it('lists the players with their handicaps', () => {
    const html = renderToString(
      <GroupSetup
        me="Chris"
        value={{ handicap: 12, players: [{ idx: 1, name: 'Sam', userId: 5, handicap: 4 }, { idx: 2, name: 'Bob', userId: null, handicap: null }], game: null }}
        onChange={() => undefined}
      />,
    );
    expect(html).toContain('Chris');
    expect(html).toContain('Has an account');
    expect(html).toContain('Guest');
    expect(html).toContain('Just keep score');
  });
});
