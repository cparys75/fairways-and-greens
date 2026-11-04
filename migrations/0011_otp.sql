-- Passwordless sign-in for non-Google users: a fresh 6-digit code emailed each time.
-- Replaces email+password. Codes are short-lived and single-use; only the hash is stored.
CREATE TABLE otp_codes (
  email      TEXT PRIMARY KEY,
  code_hash  TEXT NOT NULL,
  expires    TEXT NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  sent_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
