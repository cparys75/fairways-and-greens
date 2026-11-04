#!/usr/bin/env python3
"""Convert the legacy "Week N Results" workbook (Numbers, or exported to Excel) into a season JSON file.

The output has two parts:
  * the season data the app stores (settings, nines, teams, players, weeks,
    matches, scores) -- load it via the admin "Import" page or `npm run seed`;
  * `legacy` -- values the spreadsheet itself computed (handicaps, standings,
    hotshots, averages). The engine's golden test compares against these.

Usage:
    pip install numbers-parser   # for .numbers files
    pip install openpyxl         # for .xlsx files
    python3 tools/import_numbers.py "Week_18_Results.numbers" data/season-2025.json
    python3 tools/import_numbers.py "Week 18 Results.xlsx" season-2026.json "2026 Tuesday League"

The season name defaults to "<year of week 1> Tuesday League".
"""
import json
import re
import sys
from datetime import date, datetime


HOLE_COLS = range(7, 16)  # H..P on the week sheets
MAX_MATCHES = 8


class XlsxDocument:
    """The workbook exported to Excel, in the shape of numbers_parser's Document (one table per sheet)."""

    class Cell:
        def __init__(self, value, formula):
            self.value, self.formula = value, formula

    class Table:
        def __init__(self, values, formulas):
            self.values, self.formulas, self.num_rows = values, formulas, values.max_row

        def cell(self, row, col):  # 0-based, like numbers_parser
            raw = self.formulas.cell(row=row + 1, column=col + 1).value
            formula = raw if isinstance(raw, str) and raw.startswith("=") else None
            return XlsxDocument.Cell(self.values.cell(row=row + 1, column=col + 1).value, formula)

    class Sheet:
        def __init__(self, name, table):
            self.name, self.tables = name, [table]

    def __init__(self, path):
        import openpyxl

        values = openpyxl.load_workbook(path, data_only=True)  # results as last calculated
        formulas = openpyxl.load_workbook(path, data_only=False)  # to tell typed-over cells from formulas
        self.sheets = _Sheets([XlsxDocument.Sheet(n, XlsxDocument.Table(values[n], formulas[n])) for n in values.sheetnames])


class _Sheets(list):
    """Iterable like a list, indexable by sheet name like numbers_parser's sheets."""

    def __getitem__(self, key):
        if isinstance(key, str):
            return next(s for s in self if s.name == key)
        return super().__getitem__(key)


def open_document(path):
    if path.lower().endswith(".xlsx"):
        return XlsxDocument(path)
    from numbers_parser import Document

    return Document(path)


def table(doc, name):
    return doc.sheets[name].tables[0]


def val(t, r, c):
    """Cell value with 1-based row and 0-based column; '' for empty."""
    try:
        v = t.cell(r - 1, c).value
    except IndexError:
        return ""
    if v is None:
        return ""
    if isinstance(v, float) and v.is_integer():
        return int(v)
    if isinstance(v, (datetime, date)):
        return v.date().isoformat() if isinstance(v, datetime) else v.isoformat()
    return v.strip() if isinstance(v, str) else v


def num(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def team_number(name):
    m = re.match(r"Team\s*(\d+)$", str(name))
    return int(m.group(1)) if m else None


def read_settings(doc):
    t = table(doc, "Start")
    labels = {str(val(t, r, 0)): val(t, r, 1) for r in range(7, 15)}
    return {
        "menMaxHc": labels.get("Men's Max HC ->", 20),
        "womenMaxHc": labels.get("Women's Max HC ->", 24),
        "minHc": labels.get("Minimum Handicap ->", 0),
    }


def read_nines(doc):
    t = table(doc, "Template")
    nines = []
    for nine_id, label_row in (("blue", 5), ("gold", 10)):
        hole_row = label_row - 2
        nines.append({
            "id": nine_id,
            "name": val(t, label_row, 3),
            "par": [val(t, hole_row + 1, c) for c in HOLE_COLS],
            "menHcp": [val(t, hole_row + 2, c) for c in HOLE_COLS],
            "womenHcp": [val(t, hole_row + 3, c) for c in HOLE_COLS],
        })
    return nines


def read_roster(doc):
    roster = table(doc, "Schedule_Roster")
    running = table(doc, "RunningHCAP")
    starting = {}
    for r in range(3, running.num_rows + 1):
        name = val(running, r, 0)
        if name and num(val(running, r, 1)) is not None:
            starting[name] = val(running, r, 1)

    teams, players = [], []
    for r in range(3, 19):
        tnum = team_number(val(roster, r, 0))
        names = [(val(roster, r, 1), val(roster, r, 4)), (val(roster, r, 5), val(roster, r, 9))]
        if not tnum or not any(n for n, _ in names):
            continue
        teams.append({"id": tnum, "name": f"Team {tnum}"})
        for name, red in names:
            if not name:
                continue
            players.append({
                "id": len(players) + 1,
                "name": name,
                "teamId": tnum,
                "startingHc": starting.get(name, 0),
                "redTees": str(red).upper() == "Y",
            })
    return teams, players


def read_schedule(doc):
    """{week: {"date", "playoff", "slots": [(slot, tee, teamA, teamB)]}}"""
    t = table(doc, "Schedule_Roster")
    weeks = {}
    for header in (22, 32, 42):
        for k in range(6):
            col = 3 + 2 * k
            label = str(val(t, header, col))
            m = re.match(r"Wk(\d+)", label)
            if not m:
                continue
            wk = int(m.group(1))
            slots = []
            for r in range(header + 1, header + 9):
                a, b = val(t, r, col), val(t, r, col + 1)
                slots.append((val(t, r, 1), val(t, r, 2), team_number(a), team_number(b)))
            note = " ".join(str(val(t, r, c)) for r in range(header + 8, header + 10) for c in (col, col + 1))
            weeks[wk] = {
                "date": val(t, header, col + 1) or None,
                "playoff": "Playoff" in note,
                "slots": slots,
            }
    return weeks


def read_week(doc, wk, player_ids, team_ids_known, schedule):
    t = table(doc, f"Week{wk}")
    week = {
        "number": wk,
        "date": schedule.get(wk, {}).get("date"),
        "nineId": "blue" if str(val(t, 5, 4)).lower() == "x" else "gold",
        "playoff": schedule.get(wk, {}).get("playoff", False),
        "inclement": str(val(t, 16, 4)).upper() == "Y",
        "matches": [],
        "scores": [],
    }
    tee_times = {(a, b): (slot, tee) for slot, tee, a, b in schedule.get(wk, {}).get("slots", [])}
    for m in range(MAX_MATCHES):
        rows = (19 + 18 * m, 28 + 18 * m)
        team_ids = [team_number(val(t, r, 1)) for r in rows]
        if not all(t_id in team_ids_known for t_id in team_ids):
            continue  # empty template block (e.g. Team15 vs Team16)
        match = {"teamA": team_ids[0], "teamB": team_ids[1]}
        slot = tee_times.get(tuple(team_ids)) or tee_times.get(tuple(reversed(team_ids)))
        if slot:
            match["slot"], match["teeTime"] = slot
        # A Total Pts cell without a formula means the points were typed over (forfeit).
        totals = [t.cell(r + 6, 19) for r in rows]
        if any(not c.formula for c in totals):
            match["pointsOverride"] = [num(val(t, r + 7, 19)) or 0 for r in rows]
        week["matches"].append(match)

        for r0 in rows:
            for r in (r0, r0 + 3):
                name = val(t, r, 3)
                if not name or name not in player_ids:
                    continue
                holes = [num(val(t, r, c)) or 0 for c in HOLE_COLS]
                if not any(holes):
                    continue
                week["scores"].append({
                    "playerId": player_ids[name],
                    "holes": holes,
                    "hc": num(val(t, r, 4)),
                    "virtual": bool(val(t, r + 2, 3)),
                })
    return week


def read_legacy(doc, players, teams):
    """Results the spreadsheet computed, used only for verification."""
    legacy = {"handicapByWeek": {}, "currentHc": {}, "standings": [], "hotshots": {}, "averages": {}}

    running = table(doc, "RunningHCAP")
    for r in range(3, running.num_rows + 1):
        name = val(running, r, 0)
        if name:
            legacy["handicapByWeek"][name] = [num(val(running, r, c)) for c in range(5, 23)]
            legacy["currentHc"][name] = num(val(running, r, 2))

    st = table(doc, "Standings")
    for r in range(7, 23):
        tnum = team_number(val(st, r, 2))
        if not tnum:
            continue
        legacy["standings"].append({
            "rank": len(legacy["standings"]) + 1,
            "teamId": tnum,
            "w": val(st, r, 4), "l": val(st, r, 5), "t": val(st, r, 6),
            "points": val(st, r, 7),
            "weekly": [num(val(st, r, c)) for c in range(10, 28)],
        })
    for r in range(30, 62):
        name = val(st, r, 6)
        if name:
            legacy["hotshots"][name] = [num(val(st, r, c)) for c in range(10, 28)]

    av = table(doc, "Averages")
    for r in range(11, 39):
        name = val(av, r, 0)
        if name:
            legacy["averages"][name] = {
                "holes": [num(val(av, r, c)) for c in range(1, 19, 2)],
                "total": num(val(av, r, 19)),
            }
    return legacy


def main(src, dest, name=None):
    doc = open_document(src)
    settings = read_settings(doc)
    teams, players = read_roster(doc)
    player_ids = {p["name"]: p["id"] for p in players}
    schedule = read_schedule(doc)
    week_nums = sorted(int(s.name[4:]) for s in doc.sheets if re.match(r"Week\d+$", s.name))
    weeks = []
    for wk in week_nums:
        print(f"reading Week{wk}", file=sys.stderr, flush=True)
        weeks.append(read_week(doc, wk, player_ids, {t["id"] for t in teams}, schedule))
    # Future weeks on the schedule that have no sheet yet.
    for wk, sched in sorted(schedule.items()):
        if wk in week_nums:
            continue
        weeks.append({
            "number": wk, "date": sched["date"], "nineId": "blue", "playoff": sched["playoff"],
            "inclement": False, "scores": [],
            "matches": [{"slot": s, "teeTime": tee, "teamA": a, "teamB": b}
                        for s, tee, a, b in sched["slots"] if a and b and a <= len(teams)],
        })
    weeks.sort(key=lambda w: w["number"])

    out = {
        "format": "golf-league-season/v1",
        "season": {"name": name or f"{str(schedule.get(1, {}).get('date') or date.today())[:4]} Tuesday League"},
        "settings": settings,
        "nines": read_nines(doc),
        "teams": teams,
        "players": players,
        "weeks": weeks,
        "legacy": read_legacy(doc, players, teams),
    }
    with open(dest, "w") as f:
        json.dump(out, f, indent=1)
    print(f"wrote {dest}: {len(teams)} teams, {len(players)} players, {len(weeks)} weeks", file=sys.stderr)


if __name__ == "__main__":
    if len(sys.argv) not in (3, 4):
        sys.exit(__doc__)
    main(*sys.argv[1:])
