-- Scorecard details for personal rounds, copied from the course data when the round is entered.
ALTER TABLE rounds ADD COLUMN yardage TEXT;  -- JSON array, same length as par
ALTER TABLE rounds ADD COLUMN hcp TEXT;      -- JSON array of hole handicaps (stroke index 1-18)
