-- Player accounts (Google sign-in), player-entered match cards and personal rounds.

CREATE TABLE users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  email          TEXT,                       -- lowercased
  email_verified INTEGER NOT NULL DEFAULT 0, -- only verified emails link to roster players
  name           TEXT,
  is_admin       INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  last_login_at  TEXT
);
CREATE UNIQUE INDEX users_verified_email ON users (email) WHERE email_verified = 1;

-- One row per sign-in identity (provider + its stable user id).
CREATE TABLE user_identities (
  provider  TEXT    NOT NULL,
  subject   TEXT    NOT NULL,
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (provider, subject)
);

-- Admin-entered email: signing in with this (verified) email links the account to the player.
ALTER TABLE players ADD COLUMN email TEXT;

-- Links made by hand on the Accounts screen (for accounts whose email doesn't match the roster).
CREATE TABLE player_accounts (
  season_id  INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  player_id  INTEGER NOT NULL,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (season_id, player_id)
);

-- A match card entered by a player. Matches are keyed by their teams so schedule edits don't
-- orphan submissions. When both teams have submitted identical cards, they become the scores.
CREATE TABLE submissions (
  season_id   INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  week        INTEGER NOT NULL,
  team_a      INTEGER NOT NULL,
  team_b      INTEGER NOT NULL,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  player_id   INTEGER NOT NULL,
  team_id     INTEGER NOT NULL,
  cards       TEXT    NOT NULL,  -- JSON array of CardEntry, see src/engine/submissions.ts
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (season_id, week, team_a, team_b, user_id)
);

-- Personal rounds, not part of the league.
CREATE TABLE rounds (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  played_on   TEXT    NOT NULL,
  course_id   TEXT,             -- course-data provider id, when picked from the lookup
  course_name TEXT    NOT NULL,
  tee         TEXT,
  first_hole  INTEGER NOT NULL DEFAULT 1,
  par         TEXT    NOT NULL,  -- JSON array, 9 or 18 holes
  holes       TEXT    NOT NULL,  -- JSON array of gross scores, same length as par
  notes       TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX rounds_by_user ON rounds (user_id, played_on);
