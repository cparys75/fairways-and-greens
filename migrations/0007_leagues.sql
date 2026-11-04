-- Several leagues on one site. Each season belongs to a league; people see only their own leagues.
-- users.is_admin now means super admin (every league). League admins are league_members with role 'admin'.

CREATE TABLE leagues (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  join_code   TEXT    NOT NULL,  -- secret part of the league's invite link
  created_by  INTEGER,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX leagues_join_code ON leagues (join_code);

-- Everything so far is the original league.
INSERT INTO leagues (id, name, join_code) VALUES (1, 'Fairways and Greens', lower(hex(randomblob(6))));

ALTER TABLE seasons ADD COLUMN league_id INTEGER NOT NULL DEFAULT 1;
CREATE INDEX seasons_by_league ON seasons (league_id);
ALTER TABLE posts ADD COLUMN league_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE audit_log ADD COLUMN league_id INTEGER;
UPDATE audit_log SET league_id = 1;

-- Approved by a super admin to start new leagues.
ALTER TABLE users ADD COLUMN can_create_leagues INTEGER NOT NULL DEFAULT 0;

-- People in a league beyond its rosters: admins, members who aren't on a roster, and people
-- who asked to join through the invite link. Roster players linked to an account (or whose
-- verified email is on a roster) are members without a row here.
CREATE TABLE league_members (
  league_id   INTEGER NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT    NOT NULL DEFAULT 'member',  -- requested | member | admin
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (league_id, user_id)
);
CREATE INDEX league_members_by_user ON league_members (user_id);
