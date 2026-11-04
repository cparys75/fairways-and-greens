# Admin guide

Sign in from the **Sign in** link at the top right of any page with Google. Your account
needs the admin role (see **Accounts** below). The shared league admin password still works as a
fallback from the sign-in page. Sign-ins last 8 hours without activity.

## Player accounts

Players sign in the same way. If the email on their player (**Teams & players → Email**) matches the
account, they're linked automatically and can enter scores for their own matches under **My golf**.

**Accounts** lists everyone who has signed in:
- **Player:** which roster player the account is this season. Link by hand when the emails differ.
- **Admin:** tick to give someone admin access. The first time, sign in with the league password
  and tick your own account.

## Scores entered by players

Any player in a match can enter the whole card (every player, every hole, or **Absent**). The
scores go into the standings by themselves once **a player from each team has entered a card and all
the cards match exactly**. If cards differ, everyone in the match sees which holes disagree, and the
match stays out of the standings until someone corrects their card.

On **Enter scores**, each match shows the players' status: *Players agreed*, *Waiting for* a team,
or *Player cards differ*. To settle a disagreement yourself, press **Load …'s card**, fix anything
that's wrong and **Save week**. What you save is final.

## Every week (about 5 minutes)

1. **Admin → Enter scores.** It opens on the next week that still needs scores.
2. Type each player's gross score hole by hole. The cursor moves to the next hole by itself. (After
   typing a `1`, it waits for a second digit in case the score is 10 or more.)
3. If a player was absent, tick **Absent**. They get a virtual score that nets 39. It doesn't count
   toward their handicap and can't be a hotshot.
4. If a team forfeited, choose "Team X forfeits" in the match header. The winner gets 18 points and
   the forfeiting team gets 4.
5. Press **Save week**.

That's it. Standings, handicaps for next week, hotshots, records and averages update immediately.
Totals, points and hotshots also update live while you type, so you can check a match against the
paper card before saving.

> Mistake from an earlier week? Open that week, fix it and save. Everything after it, including
> handicaps, is recalculated automatically.

### Handicap overrides

The **HC** box shows the calculated playing handicap in grey. Type a number only if you need to
overrule it for that one week (for example, a ruling by the board). Clear the box to go back to the
calculated value.

## Before the season

1. **+ New season** (top right of the admin menu). On one screen: name the season, copy teams,
   players and rules from last season (each player's current handicap becomes their starting
   handicap), choose the course, and generate the schedule (first date, number of weeks, playoff
   weeks, which nines to rotate and the tee times). You can change the course later under Rules &
   course.
2. **Teams & players.** Add, rename or move players. Tick **Red tees** for players who use the
   women's hole handicaps and the 24 max handicap. A player who leaves mid-season should be marked
   inactive, not deleted, so their past rounds stay.
3. **Schedule.** If you changed the teams, use **Generate the whole schedule** again (available until
   the first scores are entered). Or add the weeks by hand (each new week defaults to 7 days after the previous one) with the
   date, nine, and whether it's a playoff week. **Generate round-robin for empty weeks** fills the
   matchups automatically, with rotating tee times. The **Schedule balance** table shows how often
   each pair of teams meets and how often each team gets each tee time, like the old Distribution
   tab.

## Playoffs

Mark playoff weeks with **Playoff week** on the Schedule screen. They don't count toward the
standings, but scores still count for handicaps, hotshots and averages, as in the spreadsheet. Enter
each round's matchups on that week once the previous round is decided. Seeds come from the
Standings page.

## Choosing the course

The course is picked on **+ New season**. You can correct or replace it at any time under
**Rules & course**. If the season already has scores, saving a changed scorecard recalculates
every score, handicap and standing that uses those holes:

1. **Admin → Rules & course → Find a course.** Type part of the course or club name and press
   Search.
2. Pick the course. Choose the **men's tees** (par, yardage and hole handicaps come from these) and
   the **red tees** (only their hole handicaps are used). Tick the front nine, back nine or both.
3. Check the preview against the real scorecard, press **Add these nines**, then **Save rules &
   course**.
4. On **Schedule**, choose the nine for each week, or regenerate the schedule.

If a course isn't found, or its data is incomplete, use **+ Add nine** and type it from the
scorecard. Fill in the Course field so it's grouped with that course's other nines.

## Rules & course

Every number the spreadsheet had baked into formulas can be changed here:
- points per hole and net bonus
- forfeit points
- max handicaps
- the best-3-of-last-5 window
- the max-score-per-hole table
- the hotshot threshold
- whether inclement-weather weeks count for handicaps
- pars and hole handicaps for each nine

Changes apply to the whole season at once.

## Backups

**Seasons & data → Download backup** saves the whole season as one JSON file. Do this at the end of
the season. To restore, use **Import** on the same page, which adds it as a new season. Cloudflare
also keeps 30 days of database history.

The **Recent changes** list shows what was saved and when.
