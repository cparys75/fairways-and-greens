-- Only raw inputs are stored. Strokes, net scores, points, handicaps, standings, hotshots
-- and averages are always computed by src/engine, so there is nothing to "recalculate".

CREATE TABLE seasons (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  settings    TEXT    NOT NULL DEFAULT '{}',  -- JSON, see Settings in src/engine/types.ts
  nines       TEXT    NOT NULL DEFAULT '[]',  -- JSON array of Nine
  is_current  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE teams (
  season_id  INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  id         INTEGER NOT NULL,
  name       TEXT    NOT NULL,
  PRIMARY KEY (season_id, id)
);

CREATE TABLE players (
  season_id    INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  id           INTEGER NOT NULL,
  name         TEXT    NOT NULL,
  team_id      INTEGER,
  starting_hc  INTEGER NOT NULL DEFAULT 0,
  red_tees     INTEGER NOT NULL DEFAULT 0,
  active       INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (season_id, id)
);

CREATE TABLE weeks (
  season_id  INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  number     INTEGER NOT NULL,
  date       TEXT,
  nine_id    TEXT    NOT NULL,
  playoff    INTEGER NOT NULL DEFAULT 0,
  inclement  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (season_id, number)
);

CREATE TABLE matches (
  season_id   INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  week        INTEGER NOT NULL,
  idx         INTEGER NOT NULL,
  slot        TEXT,
  tee_time    TEXT,
  team_a      INTEGER NOT NULL,
  team_b      INTEGER NOT NULL,
  override_a  INTEGER,  -- total points typed over the calculation (forfeits)
  override_b  INTEGER,
  PRIMARY KEY (season_id, week, idx)
);

CREATE TABLE scores (
  season_id  INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  week       INTEGER NOT NULL,
  player_id  INTEGER NOT NULL,
  holes      TEXT,                       -- JSON array of 9 gross scores
  virtual    INTEGER NOT NULL DEFAULT 0, -- absent: generated net-39 score
  hc         INTEGER,                    -- playing handicap override (normally computed)
  updated_at TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (season_id, week, player_id)
);

CREATE TABLE audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         TEXT    NOT NULL DEFAULT (datetime('now')),
  season_id  INTEGER,
  action     TEXT    NOT NULL,
  detail     TEXT
);
