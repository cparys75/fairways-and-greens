-- Message board, and phone numbers for league contact.

CREATE TABLE posts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id   INTEGER REFERENCES posts(id) ON DELETE CASCADE,  -- set on replies
  body        TEXT    NOT NULL,
  pinned      INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX posts_by_parent ON posts (parent_id, created_at);

-- A player's own number (My profile), and whether they're OK getting league texts.
ALTER TABLE users ADD COLUMN phone TEXT;
ALTER TABLE users ADD COLUMN sms_ok INTEGER NOT NULL DEFAULT 0;

-- A number the admin typed on the roster (for players without an account).
ALTER TABLE players ADD COLUMN phone TEXT;
