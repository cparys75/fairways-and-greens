-- Per-hole "did not play" (left early / arrived late). JSON array of 9 booleans, or NULL when the
-- player played every hole. A flagged hole is scored by the league's absent rule and keeps the round
-- out of handicaps, records and averages (like a whole-round virtual score).
ALTER TABLE scores ADD COLUMN dnf TEXT;
