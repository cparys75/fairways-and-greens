-- Email + password accounts, approved by an admin. Google accounts are active straight away.
ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active';  -- active | pending | disabled
ALTER TABLE users ADD COLUMN password_hash TEXT;                     -- pbkdf2$<iterations>$<salt>$<hash>
ALTER TABLE users ADD COLUMN failed_logins INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN locked_until TEXT;                      -- too many wrong passwords: try again after this
ALTER TABLE users ADD COLUMN reset_hash TEXT;                        -- SHA-256 of an admin-issued reset link token
ALTER TABLE users ADD COLUMN reset_expires TEXT;
