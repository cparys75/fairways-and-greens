-- Optional per-hole stats for personal rounds: fairways hit, greens in regulation and putts.
ALTER TABLE rounds ADD COLUMN stats TEXT;  -- JSON RoundStats, see src/engine/roundstats.ts
