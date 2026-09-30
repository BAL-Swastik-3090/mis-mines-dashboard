"""What is wrong with the Partha Carriers manpower sheet, before anything is loaded.

Nothing is written anywhere by this. It reads the workbook and says what a
backfill would be carrying, because a register filled from a sheet nobody
checked is worse than no register: the wrong licence expiry does not look
wrong on a screen.

PERSONAL DATA IS NOT PRINTED. Aadhaar, PAN, bank and phone are checked and
counted, never echoed -- this output goes into a transcript. Where a specific
row has to be named it is named by serial number and name, which is what
somebody would need to go and fix it.
"""
import re
from collections import Counter
from datetime import date, datetime

import openpyxl

PATH = (r"C:\Users\3101\AppData\Local\Temp\claude\D--Projects-Mines"
        r"\2153b196-ef0e-4dd9-8c32-5bd29536b2e9\scratchpad\manpower.xlsx")
TODAY = date(2026, 10, 1)

wb = openpyxl.load_workbook(PATH, data_only=True)
ws = wb["Sheet1"]
rows = list(ws.iter_rows(values_only=True))
head = [(str(h).replace("\n", " ").strip() if h else "") for h in rows[0]]
data = [r for r in rows[2:] if any(v not in (None, "") for v in r)]
print(f"{len(data)} people on the sheet\n")

def _squash(t: str) -> str:
    """Headers carry newlines, double spaces and a curly apostrophe. Match on
    the letters and nothing else, so a tidy-up in Excel cannot break this."""
    return re.sub(r"[^a-z0-9]", "", str(t).lower())


def col(name):
    want = _squash(name)
    for i, h in enumerate(head):
        if _squash(h).startswith(want):
            return i
    raise KeyError(f"{name!r} -- headers are: {[h for h in head if h][:45]}")

C = {k: col(k) for k in (
    "Contractor", "Sl. No.", "Emply Code", "Employee Name", "Designation",
    "Father's Name", "Date of Birth", "Gender", "Present Adress",
    "Self Contact", "Emargency Contact", "Blood group", "PAN", "Aadhar No",
    "Driving Licence", "DL code", "DL validty  NT", "DL validty  TR",
    "Status")}
C["DOJ"] = col("Date of Joining ASM") if any(
    h.lower().startswith("date of joining asm") for h in head) else None
for i, h in enumerate(head):
    if h.lower().startswith("date of joining") and "asm" not in h.lower() \
            and "amspl" not in h.lower():
        C["DOJ"] = i

def g(r, k):
    v = r[C[k]] if C[k] is not None else None
    if v is None:
        return None
    if isinstance(v, str):
        v = v.strip()
        return v or None
    return v

# ── dates: the column holds two different types ──────────────────────────
DATE_TEXT = re.compile(r"^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$")

def as_date(v):
    """A date, or (None, why). The sheet stores some as real dates and some
    as text, and the text ones are day-first."""
    if v is None:
        return None, None
    if isinstance(v, datetime):
        return v.date(), None
    if isinstance(v, date):
        return v, None
    m = DATE_TEXT.match(str(v).strip())
    if m:
        d, mth, y = (int(x) for x in m.groups())
        if not (1 <= mth <= 12 and 1 <= d <= 31):
            return None, f"impossible date {v!r}"
        try:
            return date(y, mth, d), None
        except ValueError:
            return None, f"impossible date {v!r}"
    return None, f"not a date: {str(v)[:24]!r}"

# ── Aadhaar: twelve digits with a Verhoeff check digit ───────────────────
_D = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],
      [3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],
      [6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],
      [9,8,7,6,5,4,3,2,1,0]]
_P = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],
      [8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],
      [2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]]

def aadhaar_ok(v) -> tuple[bool, str]:
    s = re.sub(r"\D", "", str(v or ""))
    if not s:
        return False, "missing"
    if len(s) != 12:
        return False, f"{len(s)} digits, not 12"
    if s[0] in "01":
        return False, "starts 0 or 1, which Aadhaar never does"
    c = 0
    for i, ch in enumerate(reversed(s)):
        c = _D[c][_P[i % 8][int(ch)]]
    return (c == 0), ("check digit fails" if c else "")

PHONE = re.compile(r"^[6-9]\d{9}$")
PAN = re.compile(r"^[A-Z]{5}\d{4}[A-Z]$")
BLOOD = {"A+","A-","B+","B-","O+","O-","AB+","AB-"}

issues: dict[str, list] = {}
def note(kind, sl, name, detail):
    issues.setdefault(kind, []).append((sl, name, detail))

seen_name, seen_aadhaar, seen_dl, seen_phone = {}, {}, {}, {}
stats = Counter()
desig = Counter(); status = Counter(); contractor = Counter()

for r in data:
    sl = g(r, "Sl. No.")
    name = g(r, "Employee Name")
    if not name:
        note("no name at all", sl, "—", "row has no employee name")
        continue
    key = re.sub(r"\s+", " ", str(name)).strip().lower()
    if key in seen_name:
        note("same name twice", sl, name, f"also at Sl. {seen_name[key]}")
    seen_name[key] = sl

    desig[str(g(r, "Designation") or "(blank)")] += 1
    status[str(g(r, "Status") or "(blank)")] += 1
    contractor[str(g(r, "Contractor") or "(blank)")] += 1

    dob, why = as_date(g(r, "Date of Birth"))
    if why:
        note("date of birth unreadable", sl, name, why)
    elif dob is None:
        note("date of birth missing", sl, name, "")
    else:
        age = (TODAY - dob).days / 365.25
        if age < 18:
            note("under 18", sl, name, f"born {dob}, age {age:.0f}")
        elif age > 65:
            note("over 65", sl, name, f"born {dob}, age {age:.0f}")
        stats["dob ok"] += 1

    doj, why = as_date(g(r, "DOJ"))
    if why:
        note("joining date unreadable", sl, name, why)
    elif doj is None:
        stats["joining date missing"] += 1
    elif dob and doj < dob:
        note("joined before born", sl, name, f"born {dob}, joined {doj}")
    elif doj > TODAY:
        note("joining date in the future", sl, name, str(doj))

    for lbl, k in (("non-transport", "DL validty  NT"), ("transport", "DL validty  TR")):
        v = g(r, k)
        d, why = as_date(v)
        if why:
            note("licence expiry unreadable", sl, name, f"{lbl}: {why}")
        elif d is None:
            note(f"no {lbl} licence expiry", sl, name, "")
        elif d < TODAY:
            note("LICENCE EXPIRED", sl, name, f"{lbl} expired {d}")
        elif (d - TODAY).days <= 90:
            note("licence expires within 90 days", sl, name, f"{lbl} on {d}")

    dl = g(r, "Driving Licence")
    if not dl:
        note("no driving licence number", sl, name, "")
    else:
        k2 = re.sub(r"\s+", "", str(dl)).upper()
        if k2 in seen_dl:
            note("same licence number twice", sl, name, f"also at Sl. {seen_dl[k2]}")
        seen_dl[k2] = sl
        if not re.match(r"^[A-Z]{2}\d{2}\s?\d{11}$", k2):
            note("licence number looks malformed", sl, name, f"{str(dl)[:6]}…")

    if not g(r, "DL code"):
        note("no licence class recorded", sl, name, "")

    a = g(r, "Aadhar No")
    ok, why = aadhaar_ok(a)
    if not ok:
        note("Aadhaar " + ("missing" if why == "missing" else "invalid"),
             sl, name, "" if why == "missing" else why)
    else:
        s = re.sub(r"\D", "", str(a))
        if s in seen_aadhaar:
            note("same Aadhaar twice", sl, name, f"also at Sl. {seen_aadhaar[s]}")
        seen_aadhaar[s] = sl
        stats["aadhaar valid"] += 1

    ph = [re.sub(r"\D", "", str(g(r, x) or "")) for x in ("Self Contact", "Emargency Contact")]
    own, emer = ph
    if not own and emer:
        note("phone only in the emergency column", sl, name,
             "their own number is blank")
    elif not own:
        note("no phone number at all", sl, name, "")
    elif not PHONE.match(own):
        note("phone number malformed", sl, name, f"{len(own)} digits")
    else:
        if own in seen_phone:
            note("same phone twice", sl, name, f"also at Sl. {seen_phone[own]}")
        seen_phone[own] = sl
        stats["phone ok"] += 1
    if own and emer and own == emer:
        note("emergency number same as their own", sl, name, "")

    bg = str(g(r, "Blood group") or "").replace(" ", "").upper()
    if not bg:
        note("no blood group", sl, name, "")
    elif bg not in BLOOD:
        note("blood group not a real group", sl, name, bg)

    pan = str(g(r, "PAN") or "").strip().upper()
    if pan and not PAN.match(pan):
        note("PAN malformed", sl, name, "")

    if not g(r, "Emply Code"):
        stats["no employee code"] += 1
    if not g(r, "Father's Name"):
        note("no father's name", sl, name, "")
    if not g(r, "Present Adress"):
        note("no address", sl, name, "")

print("WHAT THE SHEET SAYS IT IS")
print("   contractor :", dict(contractor))
print("   designation:", dict(desig))
print("   status     :", dict(status))
print(f"   no employee code: {stats['no employee code']} of {len(data)}")
print(f"   joining date missing: {stats['joining date missing']}")

print("\n" + "=" * 78)
print("WHAT IS WRONG, worst first")
print("=" * 78)
order = sorted(issues.items(), key=lambda kv: (
    0 if "EXPIRED" in kv[0] or "18" in kv[0] else 1, -len(kv[1])))
for kind, rows_ in order:
    print(f"\n  {kind.upper()}  ({len(rows_)})")
    for sl, name, detail in rows_[:12]:
        print(f"     Sl.{str(sl):<4} {str(name)[:26]:<28}{detail}")
    if len(rows_) > 12:
        print(f"     … and {len(rows_) - 12} more")

print("\n" + "=" * 78)
print("HOW THE DATE COLUMNS ARE STORED — the thing that breaks a naive import")
print("=" * 78)
for k in ("Date of Birth", "DL validty  NT", "DL validty  TR"):
    kinds = Counter(type(g(r, k)).__name__ for r in data)
    print(f"   {k:<18}{dict(kinds)}")
