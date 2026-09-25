"""What a machine can move, and what stops it.

Pure arithmetic, in its own module so it can be checked against the workbook it
replaces without standing a server up. Everything here takes numbers and
returns numbers; nothing reads the database.

THE MODEL, IN FULL

    capacity per scoop = bucket x fill factor x swell
    cycle seconds      = dig + lift + swing + lower + tilt + wait + unload
                       + return
    cycles per hour    = 3600 / cycle seconds
    excavator Cum/hr   = cycles per hour x capacity per scoop
    excavator Cum/day  = Cum/hr x hours worked at that face

    tipper trips/hour  = 60 / (loading + travel)
    tipper Cum/day     = trips/hour x operating hours x effective capacity
    face tipper Cum/day = that x number of tippers

    EFFECTIVE at a face = MIN(excavator Cum/day, face tipper Cum/day)

The last line is the whole point. A face is limited by whichever of the two is
smaller, and which one it is decides what to do about it: a face short of
trucks needs trucks moved to it, a face short of digging does not.

WHAT THIS DELIBERATELY DOES NOT COPY FROM THE WORKBOOK

The sheet reports a fleet-wide "tipper shortage" from an empty cell, and so
announces a surplus equal to the fleet count. It also totals excavator capacity
against tipper capacity across the whole mine, which hides the thing that is
actually true: total tipper capacity already exceeds total excavator capacity,
and the losses are at particular faces. `summarise` reports the per-face
picture and names the faces, because the aggregate answers a question nobody
has.
"""
from __future__ import annotations

from dataclasses import dataclass, field

# Three tonnes to the cubic metre. The workbook multiplies by 3 in six places
# and names it nowhere; when the assumption row carries a different figure,
# that one wins.
DEFAULT_ORE_T_PER_CUM = 3.0


@dataclass(frozen=True)
class Cycle:
    """One excavator cycle, broken into parts a supervisor can observe."""
    dig_sec: int = 50
    lift_sec: int = 5
    swing_sec: int = 10
    lower_sec: int = 3
    tilt_sec: int = 4
    wait_sec: int = 20
    unload_sec: int = 3
    return_sec: int = 5

    @property
    def total_sec(self) -> int:
        return (self.dig_sec + self.lift_sec + self.swing_sec + self.lower_sec
                + self.tilt_sec + self.wait_sec + self.unload_sec + self.return_sec)

    @property
    def per_hour(self) -> float:
        """Cycles in an hour. Zero rather than a division error: a cycle of no
        seconds is bad data, and bad data should show as no capacity, not stop
        the page."""
        return 3600.0 / self.total_sec if self.total_sec > 0 else 0.0


def scoop_cum(bucket_cum: float, fill_factor: float, swell_factor: float) -> float:
    """What actually comes up in the bucket."""
    return bucket_cum * fill_factor * swell_factor


def excavator_cum_per_hour(bucket_cum: float, fill_factor: float,
                           swell_factor: float, cycle: Cycle) -> float:
    return cycle.per_hour * scoop_cum(bucket_cum, fill_factor, swell_factor)


def tipper_cum_per_day(effective_cum: float, loading_min: float,
                       travel_min: float, operating_hours: float) -> float:
    """One tipper, for a whole day."""
    cycle_min = loading_min + travel_min
    if cycle_min <= 0:
        return 0.0
    trips_per_hour = 60.0 / cycle_min
    return trips_per_hour * operating_hours * effective_cum


@dataclass
class Face:
    """One excavator at one place, digging one thing, for so many hours."""
    face_plan_id: int | None
    asset_id: int
    fleet_code: str
    plan_name: str | None
    location: str
    material: str
    running_hours: float
    tippers: int
    tipper_class: str | None

    bucket_cum: float
    bucket_is_fitted: bool          # True when it differs from the standard one
    cycle: Cycle
    fill_factor: float
    swell_factor: float
    cycle_is_overridden: bool

    per_tipper_cum_day: float       # one truck of this class, for a day

    # Worked out, not given.
    cum_per_hour: float = 0.0
    excavator_cum_day: float = 0.0
    tipper_cum_day: float = 0.0
    effective_cum_day: float = 0.0
    limited_by: str = "NEITHER"     # EXCAVATOR / TIPPERS / NEITHER
    lost_cum_day: float = 0.0

    def compute(self) -> "Face":
        self.cum_per_hour = excavator_cum_per_hour(
            self.bucket_cum, self.fill_factor, self.swell_factor, self.cycle)
        self.excavator_cum_day = self.cum_per_hour * self.running_hours
        self.tipper_cum_day = self.per_tipper_cum_day * self.tippers

        # A face with no trucks moves nothing, whatever the excavator can dig.
        # The workbook leaves these rows blank and silently drops them out of
        # its MIN(), which flatters the total.
        self.effective_cum_day = min(self.excavator_cum_day, self.tipper_cum_day)

        gap = self.excavator_cum_day - self.tipper_cum_day
        if abs(gap) < 0.005:
            self.limited_by = "NEITHER"
        elif gap > 0:
            self.limited_by = "TIPPERS"
        else:
            self.limited_by = "EXCAVATOR"

        # What this face is not producing because the two sides do not match.
        self.lost_cum_day = max(0.0, self.excavator_cum_day - self.effective_cum_day)
        return self


@dataclass
class Summary:
    excavator_cum_day: float = 0.0
    tipper_cum_day: float = 0.0
    effective_cum_day: float = 0.0
    lost_cum_day: float = 0.0
    tippers_deployed: int = 0

    # Where the loss is, which is the part the workbook's aggregate hides.
    faces_short_of_tippers: list[dict] = field(default_factory=list)
    faces_short_of_digging: list[dict] = field(default_factory=list)

    # Trucks that would close every short face, and trucks standing at faces
    # that cannot use them. These are different numbers and the difference is
    # usually the answer.
    tippers_needed: int = 0
    tippers_spare: int = 0

    by_material: dict[str, float] = field(default_factory=dict)
    ore_mt: float = 0.0


def summarise(faces: list[Face], per_tipper_default: float,
              ore_t_per_cum: float = DEFAULT_ORE_T_PER_CUM) -> Summary:
    """The fleet picture, and the faces that make it what it is."""
    s = Summary()
    for f in faces:
        s.excavator_cum_day += f.excavator_cum_day
        s.tipper_cum_day += f.tipper_cum_day
        s.effective_cum_day += f.effective_cum_day
        s.lost_cum_day += f.lost_cum_day
        s.tippers_deployed += f.tippers

        s.by_material[f.material] = (s.by_material.get(f.material, 0.0)
                                     + f.effective_cum_day)

        where = {"fleet_code": f.fleet_code, "location": f.location,
                 "material": f.material, "gap_cum_day": round(abs(
                     f.excavator_cum_day - f.tipper_cum_day), 2)}
        if f.limited_by == "TIPPERS":
            per = f.per_tipper_cum_day or per_tipper_default
            short = (f.excavator_cum_day - f.tipper_cum_day) / per if per > 0 else 0
            where["tippers_short"] = int(-(-short // 1))     # round up
            s.tippers_needed += where["tippers_short"]
            s.faces_short_of_tippers.append(where)
        elif f.limited_by == "EXCAVATOR":
            per = f.per_tipper_cum_day or per_tipper_default
            spare = (f.tipper_cum_day - f.excavator_cum_day) / per if per > 0 else 0
            where["tippers_spare"] = int(spare)              # round down
            s.tippers_spare += where["tippers_spare"]
            s.faces_short_of_digging.append(where)

    # Ore is planned in tonnes and dug in cubic metres.
    s.ore_mt = sum(v for k, v in s.by_material.items()
                   if "ore" in k.lower()) * ore_t_per_cum

    for lst in (s.faces_short_of_tippers, s.faces_short_of_digging):
        lst.sort(key=lambda w: -w["gap_cum_day"])
    return s
