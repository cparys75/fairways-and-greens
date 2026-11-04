-- Personal rounds with other players: friends' scores, handicaps typed in for the round, a side game,
-- and links for guests who don't have an account. The round's owner is still rounds.user_id / holes.

ALTER TABLE rounds ADD COLUMN handicap INTEGER;          -- the owner's handicap for this round's games
ALTER TABLE rounds ADD COLUMN game TEXT;                 -- JSON GameSetup, see src/engine/games.ts
ALTER TABLE rounds ADD COLUMN live INTEGER NOT NULL DEFAULT 0;  -- still being played: holes may be 0

-- The other players (idx 1, 2, …; the owner is idx 0).
CREATE TABLE round_players (
  round_id       INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  idx            INTEGER NOT NULL,
  name           TEXT    NOT NULL,
  user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,  -- a registered player sees the round in My rounds
  handicap       INTEGER,
  holes          TEXT    NOT NULL,  -- JSON array of gross scores, 0 = not played yet
  guest_hash     TEXT,              -- SHA-256 of the guest's link token
  guest_expires  TEXT,
  PRIMARY KEY (round_id, idx)
);
CREATE INDEX round_players_by_user ON round_players (user_id);
CREATE INDEX round_players_by_guest ON round_players (guest_hash);
