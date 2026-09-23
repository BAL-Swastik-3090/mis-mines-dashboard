# MineHub Weighbridge Agent

Reads the weight the indicator writes to a file on the weighbridge PC, and
sends it to MineHub.

It is the same file SAP GUI asks permission to read on every capture —
`C:\WB3\wbdata.txt` on this site. The agent only ever reads it, and never takes
a lock, so the digitizer keeps writing and SAP keeps working exactly as before.

## Installing on the weighbridge PC

**1. Find out what the file holds.** Before anything else — the format decides
the parser, and guessing at a weight is how a load goes out wrong.

```
MineHubWeighbridge.exe --sniff --path C:\WB3\wbdata.txt
```

It watches the file for six seconds and prints the raw lines, whether the file
grows or is rewritten in place, and which parser understood it. If it says none
of them did, send those lines to IT — a parser is a few lines of code, and one
written for the real format is worth more than three written for guesses.

**2. Register the PC** in the portal: Weighbridge → Bridges & agents → Register
a PC. It issues a token, shown once.

**3. Put the token in `wbagent.ini`**, beside the executable. Running the agent
once creates the file with everything else filled in.

```ini
[agent]
server  = https://mines.balasorealloys.in
token   = <the token from the portal>
bridge  = WB3
path    = C:\WB3\wbdata.txt
parser  = auto
poll_ms = 400
```

The token identifies this machine. Keep the file where only the weighbridge
operator's account can read it.

**4. Run it.** A window shows the live weight, whether the load has settled, and
whether the server is reachable. Put a shortcut in Startup so it comes back
after a power cut — a weighbridge PC loses power more often than anything else
on site.

## Building the executable

```
pip install requests pyinstaller
pyinstaller --onefile --noconsole --name MineHubWeighbridge wbagent.py
```

`dist\MineHubWeighbridge.exe` is self-contained; the PC needs no Python.

## What it does when things go wrong

| | |
|---|---|
| Network down | Readings queue in `spool.jsonl` and replay in order when the server returns. Nothing is lost, so the trace around a capture has no holes. |
| File missing or unreadable | Says so on screen, sends nothing. It never falls back to a last-known or a zero. |
| Line it cannot parse | Same — reported, not guessed at. |
| Truck still rolling | The weight is sent but marked unstable, and the portal refuses to capture it. |

## Testing it without a bridge

```
python test_agent.py
```

Simulates an indicator through a full cycle — empty deck, truck rolls on, gross,
tips, tare, leaves — with the network dropping in the middle, and checks that
each weight is reported exactly once, that rolling weights are never reported as
settled, and that nothing is lost while offline.
