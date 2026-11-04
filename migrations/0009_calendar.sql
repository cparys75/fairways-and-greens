-- A secret per-member link to subscribe to their league schedule from a phone, computer or
-- wall calendar. The token is the only secret in the URL; resetting it makes a new link.
ALTER TABLE users ADD COLUMN calendar_token TEXT;
CREATE UNIQUE INDEX users_calendar_token ON users (calendar_token) WHERE calendar_token IS NOT NULL;
