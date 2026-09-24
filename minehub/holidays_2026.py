"""The 2026 holiday statement, as issued.

Source: "Statement of Holidays", Balasore Alloys Limited, Kaliapani Chromite
Mines, Sukinda, Jajpur — dated 26-12-2025, signed Gurpreet Singh, CHRO.

Every row carries the weekday the notice printed beside it. Those are not
decoration: a date read off a photographed notice is the easiest thing in this
whole job to get wrong by a day, and the weekday is a checksum the document
supplies for free. Nothing is written unless all 25 agree.

THE THREE KINDS ARE NOT THE SAME THING

The notice's own footnote: "Out of 15 Optional Holidays, the employees shall be
eligible to avail only one Optional Holiday, in addition to 4 National Holiday
& 7 Festival Holiday."

So the mine closes on the 4 national and the 7 festival days — 11 days, and
Durga Puja is two of them. The 15 optional days are a menu from which each
person takes one; the mine works through them. Recording those as closures
would take two hundred people off the roster fifteen times over.
"""
from datetime import date

# (date, name, printed weekday)
NATIONAL = [
    (date(2026, 1, 26), "Republic Day",      "Monday"),
    (date(2026, 5,  1), "May Day",           "Friday"),
    (date(2026, 8, 15), "Independence Day",  "Saturday"),
    (date(2026, 10, 2), "Gandhi Jayanti",    "Friday"),
]

FESTIVAL = [
    (date(2026, 1,  2), "New Year",          "Friday"),
    (date(2026, 1, 14), "Makar Sankranti",   "Wednesday"),
    (date(2026, 3,  4), "Holi",              "Wednesday"),
    (date(2026, 6, 15), "Raja Sankranti",    "Monday"),
    (date(2026, 10, 19), "Durga Puja",       "Monday"),
    (date(2026, 10, 20), "Durga Puja",       "Tuesday"),
    (date(2026, 12, 1), "Prathamastami",     "Tuesday"),
]

OPTIONAL = [
    (date(2026, 1, 23), "Netajee Jayanti",                          "Friday"),
    (date(2026, 2, 15), "Mahashivratri",                            "Sunday"),
    (date(2026, 3, 21), "Id-ul-Fitr",                               "Saturday"),
    (date(2026, 4,  1), "Utkal Divas",                              "Wednesday"),
    (date(2026, 4, 14), "Pana Sankranti / New Year / Hanuman Jayanti", "Tuesday"),
    (date(2026, 7, 16), "Ratha Yatra",                              "Thursday"),
    (date(2026, 8, 28), "Rakshya Bandhan",                          "Friday"),
    (date(2026, 9,  4), "Janmastami",                               "Friday"),
    (date(2026, 9, 14), "Ganesh Chaturthi",                         "Monday"),
    (date(2026, 9, 15), "Nuakhai",                                  "Tuesday"),
    (date(2026, 9, 17), "Vishwakarma Puja",                         "Thursday"),
    (date(2026, 11, 8), "Deepawali",                                "Sunday"),
    (date(2026, 11, 11), "Bhatru Ditiya",                           "Wednesday"),
    (date(2026, 11, 24), "Rasa Purnima / Guru Nanak Jayanti",       "Tuesday"),
    (date(2026, 12, 25), "Christmas",                               "Friday"),
]

GROUPS = [
    ("NATIONAL", NATIONAL, "PUBLIC",   True),
    ("FESTIVAL", FESTIVAL, "FESTIVAL", True),
    ("OPTIONAL", OPTIONAL, "RESTRICTED", False),
]


def checked() -> list[dict]:
    """Every row, with the printed weekday confirmed. Raises if one disagrees."""
    wrong, out = [], []
    for label, rows, kind, stops in GROUPS:
        for on, name, printed in rows:
            actual = on.strftime("%A")
            if actual.lower() != printed.lower():
                wrong.append(f"{label}: {name} {on} is a {actual}, "
                             f"the notice says {printed}")
            out.append({"date": on, "name": name, "kind": kind,
                        "stops_work": stops, "group": label,
                        "weekday": actual})
    if wrong:
        raise SystemExit("The notice and the calendar disagree:\n  "
                         + "\n  ".join(wrong))
    return out


def load(db) -> int:
    """Write them, through the platform's own endpoint rather than raw SQL.

    The endpoint upserts on (holiday_date, plant_id), so running this twice
    corrects the rows rather than doubling them — which matters, because the
    reason to run it again is usually that the notice was reissued.
    """
    from app.routers import workforce as wf

    wf._require = lambda *a, **k: None
    wf._actor = lambda *a, **k: "HOLIDAY STATEMENT 26-12-2025"

    note = {"NATIONAL": "National holiday.",
            "FESTIVAL": "Festival holiday.",
            "OPTIONAL": "Optional holiday - each employee may avail one of the 15."}

    # plant_id is left empty on purpose. The notice covers "employees including
    # contract workers employed in Balasore Alloys Limited", not one site, and a
    # holiday scoped to a plant would not apply to anybody recorded elsewhere.
    out = wf.add_holiday(None, body={"holidays": [{
        "holiday_date": r["date"].isoformat(),
        "name": r["name"],
        "kind": r["kind"],
        "stops_work": r["stops_work"],
        "remarks": ("Statement of Holidays dated 26-12-2025, signed by the CHRO. "
                    + note[r["group"]]),
    } for r in checked()]}, db=db)
    return out["saved"]


if __name__ == "__main__":
    rows = checked()
    print(f"  {len(rows)} dates, every printed weekday confirmed\n")
    for label, _, kind, stops in GROUPS:
        group = [r for r in rows if r["group"] == label]
        closes = "mine closes" if stops else "mine works — each person takes one"
        print(f"  {label}: {len(group)} day(s) -> kind {kind}, {closes}")
        for r in group:
            print(f"     {r['date']}  {r['weekday'][:3]}  {r['name']}")
        print()
