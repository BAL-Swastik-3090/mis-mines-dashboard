"""A pretend weighbridge indicator, for testing without a bridge.

Rewrites the file the way a real digitizer does — in place, several times a
second — so the agent, the API and the screen can all be exercised before
anyone drives a truck onto the deck.

    python fake_indicator.py                      one truck, then stop
    python fake_indicator.py --loop               trucks all day
    python fake_indicator.py --path C:\\WB3\\wbdata.txt

The format written here is the Essae/Avery one the `toledo` parser reads:

    ST,GS,+   44800kg      settled, gross
    US,GS,+   21000kg      unstable — still rolling

That is a guess at what the real WB3 indicator writes, and it is only a guess.
Run the agent's --sniff against the real file before trusting any of this: if
the real format differs, the agent needs a parser for it, and this simulator
should be changed to match rather than the other way round.
"""
from __future__ import annotations

import argparse
import random
import sys
import time
from pathlib import Path


def write(path: Path, weight: float, stable: bool) -> None:
    path.write_text(f"{'ST' if stable else 'US'},GS,+{int(weight):>8}kg\r\n",
                    encoding="ascii")


def hold(path: Path, weight: float, stable: bool, seconds: float,
         jitter: float = 0.0) -> None:
    end = time.time() + seconds
    while time.time() < end:
        w = weight + (random.uniform(-jitter, jitter) if jitter else 0)
        write(path, max(0, w), stable)
        time.sleep(0.1)


def one_truck(path: Path, tare: int, net: int) -> None:
    gross = tare + net
    print(f"  empty deck")
    hold(path, 0, True, 1.5)
    print(f"  truck rolling on…")
    for step in (gross * 0.2, gross * 0.55, gross * 0.85):
        hold(path, step, False, 0.4, jitter=400)
    print(f"  gross  {gross:>7,} kg   (settling)")
    hold(path, gross, True, 3.0, jitter=6)
    print(f"  rolling off, going to tip")
    hold(path, gross * 0.4, False, 0.6, jitter=500)
    hold(path, 0, True, 2.0)
    print(f"  back on empty")
    hold(path, tare * 0.6, False, 0.5, jitter=300)
    print(f"  tare   {tare:>7,} kg   (settling)")
    hold(path, tare, True, 3.0, jitter=5)
    print(f"  net    {net:>7,} kg")
    hold(path, 0, True, 1.5)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--path", default=r"C:\WB3\wbdata.txt")
    ap.add_argument("--loop", action="store_true", help="keep sending trucks")
    args = ap.parse_args()

    path = Path(args.path)
    path.parent.mkdir(parents=True, exist_ok=True)
    print(f"Pretending to be the WB3 indicator, writing {path}")
    print("Ctrl-C to stop.\n")

    try:
        while True:
            tare = random.choice([15800, 16200, 16500, 17100])
            net = random.choice([26400, 28900, 31200, 33800, 44800 - 16200])
            print(f"— truck —")
            one_truck(path, tare, net)
            print()
            if not args.loop:
                break
    except KeyboardInterrupt:
        write(path, 0, True)
        print("\nstopped; deck left empty")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
