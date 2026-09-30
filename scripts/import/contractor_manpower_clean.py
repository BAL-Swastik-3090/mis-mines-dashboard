"""Turn the sheet into 33 clean records, and say what had to be repaired.

Writes nothing to any database. It produces a JSON file the backfill would
read, so the cleaning can be argued with before it is applied rather than
after.

THE REPAIRS, each one a place a naive import goes quietly wrong:

  Dates are stored as two different types in the same column -- 30 real dates
  and 3 text strings for date of birth, 20 and 9 for one licence expiry, 20
  and 10 for the other. The text ones are day-first Indian format. Read with
  a library that guesses, "05-06-1984" becomes the 6th of May.

  The contractor is named once, on the first row, and implied for the other
  32. Spelled "Patra Carruirs"; the register calls it PATRA CARRIER, which is
  the spelling that already owns eleven machines.

  Names arrive in three cases -- "Babula Patra", "ALOK PATRA", "Badal
  Mohanta" with a double space. Stored as given but matched on a squashed
  form, because the register already holds one of these people and creating
  him twice is the failure that matters here.
"""
import json
import re
from datetime import date, datetime

import openpyxl

SRC = (r"C:\Users\3101\AppData\Local\Temp\claude\D--Projects-Mines"
       r"\2153b196-ef0e-4dd9-8c32-5bd29536b2e9\scratchpad\manpower.xlsx")
OUT = (r"C:\Users\3101\AppData\Local\Temp\claude\D--Projects-Mines"
       r"\2153b196-ef0e-4dd9-8c32-5bd29536b2e9\scratchpad\manpower_clean.json")

wb = openpyxl.load_workbook(SRC, data_only=True)
ws = wb["Sheet1"]
rows = list(ws.iter_rows(values_only=True))
head = [(str(h).replace("\n", " ").strip() if h else "") for h in rows[0]]


def squash(t) -> str:
    return re.sub(r"[^a-z0-9]", "", str(t or "").lower())


def col(name):
    want = squash(name)
    for i, h in enumerate(head):
        if squash(h).startswith(want):
            return i
    raise KeyError(name)


IDX = {k: col(k) for k in (
    "Sl. No.", "Employee Name", "Designation", "Father's Name",
    "Date of Birth", "Gender", "Present Adress", "Permanent Address",
    "Self Contact", "Emargency Contact", "Blood group", "PAN", "Aadhar No",
    "Driving Licence", "DL code", "DL validty  NT", "DL validty  TR",
    "Status")}
for i, h in enumerate(head):
    if squash(h).startswith("dateofjoining") and "asm" not in squash(h) \
            and "amspl" not in squash(h):
        IDX["DOJ"] = i

DATE_TEXT = re.compile(r"^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$")
repairs: list[str] = []


def val(r, k):
    v = r[IDX[k]] if k in IDX else None
    if isinstance(v, str):
        v = v.strip()
        return v or None
    return v


def as_date(r, k, sl, name):
    """Day-first, always. A library left to guess turns 05-06-1984 into May."""
    v = val(r, k)
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.date().isoformat()
    if isinstance(v, date):
        return v.isoformat()
    m = DATE_TEXT.match(str(v))
    if not m:
        repairs.append(f"Sl.{sl} {name}: {k} left empty — {str(v)[:20]!r} is not a date")
        return None
    d, mth, y = (int(x) for x in m.groups())
    try:
        out = date(y, mth, d)
    except ValueError:
        repairs.append(f"Sl.{sl} {name}: {k} left empty — {v!r} is not a real day")
        return None
    repairs.append(f"Sl.{sl} {name}: {k} {v!r} read day-first as {out}")
    return out.isoformat()


def phone(v):
    s = re.sub(r"\D", "", str(v or ""))
    if len(s) == 12 and s.startswith("91"):
        s = s[2:]
    return s if re.match(r"^[6-9]\d{9}$", s) else None


def title(n: str) -> str:
    """ALOK PATRA and Babula Patra should read the same way on a screen."""
    return re.sub(r"\s+", " ", str(n)).strip().title()


out = []
for r in rows[2:]:
    if not any(v not in (None, "") for v in r):
        continue
    name = val(r, "Employee Name")
    if not name:
        continue
    sl = val(r, "Sl. No.")
    raw_name = re.sub(r"\s+", " ", str(name)).strip()
    if raw_name != str(name).strip():
        repairs.append(f"Sl.{sl} {raw_name}: double space in the name removed")

    own = phone(val(r, "Self Contact"))
    emer_raw = val(r, "Emargency Contact")
    emer = phone(emer_raw)
    if not own and emer:
        repairs.append(f"Sl.{sl} {raw_name}: only number is in the emergency "
                       f"column — kept there, NOT promoted to their own")

    bg = str(val(r, "Blood group") or "").replace(" ", "").upper() or None
    pan = str(val(r, "PAN") or "").strip().upper() or None
    aadhaar = re.sub(r"\D", "", str(val(r, "Aadhar No") or "")) or None
    dl = re.sub(r"\s+", " ", str(val(r, "Driving Licence") or "")).strip() or None

    out.append({
        "sl": sl,
        "name": title(raw_name),
        "name_as_given": raw_name,
        "match_key": squash(raw_name),
        "designation": (str(val(r, "Designation") or "").strip().title() or None),
        "father_name": title(val(r, "Father's Name")) if val(r, "Father's Name") else None,
        "date_of_birth": as_date(r, "Date of Birth", sl, raw_name),
        "gender": (str(val(r, "Gender") or "").strip().upper() or None),
        "current_address": val(r, "Present Adress"),
        "permanent_address": val(r, "Permanent Address"),
        "phone": own,
        "emergency_phone": emer,
        "blood_group": bg,
        "pan": pan,
        "aadhaar_last4": aadhaar[-4:] if aadhaar and len(aadhaar) == 12 else None,
        "has_aadhaar": bool(aadhaar and len(aadhaar) == 12),
        "licence_no": dl,
        "licence_class": (str(val(r, "DL code") or "").replace(",", " ").split()
                          or None),
        "licence_valid_nt": as_date(r, "DL validty  NT", sl, raw_name),
        "licence_valid_tr": as_date(r, "DL validty  TR", sl, raw_name),
        "joined_on": as_date(r, "DOJ", sl, raw_name) if "DOJ" in IDX else None,
        "status": val(r, "Status"),
    })

with open(OUT, "w", encoding="utf-8") as f:
    json.dump(out, f, indent=1, ensure_ascii=False)

print(f"{len(out)} records cleaned -> manpower_clean.json\n")
print(f"REPAIRS MADE ({len(repairs)}):")
for line in repairs:
    print("   " + line)

filled = {k: sum(1 for o in out if o.get(k)) for k in
          ("date_of_birth", "phone", "licence_no", "licence_valid_tr",
           "blood_group", "father_name", "joined_on", "pan")}
print("\nHOW COMPLETE THE 33 ARE:")
for k, v in sorted(filled.items(), key=lambda kv: -kv[1]):
    print(f"   {k:<20}{v:>3} of {len(out)}")
print(f"   {'aadhaar (12-digit)':<20}{sum(1 for o in out if o['has_aadhaar']):>3} of {len(out)}")
