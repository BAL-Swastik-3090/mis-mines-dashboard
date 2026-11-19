# HOTO tablet — gap analysis, 16 November 2026

Things the app cannot do that people using it will need, found by walking
every screen on the tablet (DEV-004) and reading the code behind it. Numbered
G1… so we can pick items off. **Built** = asked for on 16 Nov and in the
app now; everything else waits for your decision.

## Unfinished handovers

| # | Gap | Plan |
|---|---|---|
| **G1** | **No way to discard an unfinished handover** — a wrong machine picked, started by mistake, a duplicate. It sits on the home screen for ever. | **Built.** "Discard" on each unfinished card and at the bottom of the confirm screen; asks for a reason (wrong machine / by mistake / duplicate / other), asks once more, removes the draft and its photos. Only drafts — nothing confirmed can be discarded. Logged on the tablet. |
| G2 | No way to change the machine or the kind of handover once started. | With G1: discard and start again. No separate feature needed. |
| G3 | An old draft (yesterday's) gives no hint it should be discarded. | Card already says "still needed?"; G1 gives the button. |

## People

| # | Gap | Plan |
|---|---|---|
| **G4** | **A supervisor doing many handovers picks their own name every time.** | **Built.** The tablet remembers who filled the last one in. If it was a supervisor within the last 12 hours, the next handover starts with them already selected — shown clearly, with **"The operator is filling it in"** one tap away. If the last one was done by the operator themself, nothing is pre-selected. Says "Same as the last handover on this tablet" under the name, so a name the tablet chose is never mistaken for one somebody picked. |
| G5 | **Nobody's identity is checked.** Anyone can pick any name; the tablet holds operator PINs (`cached_credential`) and never asks for one. | Decision needed: ask for the operator's PIN (or badge) on the people screen? Adds a step; makes the name on the record mean something. |
| G6 | No quick pick of recent operators — every operator is searched by number or name. | Proposed: "Recent on this tablet" chips above the search. |

## Photographs

| # | Gap | Plan |
|---|---|---|
| G7 | A photo taken by mistake cannot be seen or removed — only counted ("1 photo"). | Proposed: tap the count to see the photos, remove one before confirming. |

## After confirming

| # | Gap | Plan |
|---|---|---|
| G8 | "Done on this tablet" lists handovers but cannot open one to see what was answered. | Proposed: tap a card to see every answer, as filed. |
| G9 | A confirmed handover cannot be corrected on the tablet. | **By design** — it is signed. A correction is a new handover; the dashboard shows both. |
| G10 | Which machines still need a handover this shift, across every tablet (was F5). | Proposed: the server sends the shift's status in the sync bundle. |

## Using the app

| # | Gap | Plan |
|---|---|---|
| **G11** | **No help inside the app.** | **Built.** A **?** button on every screen opens a guide panel from the side: what this screen is for, what is required, what to do next — plus the five steps of a handover. |
| **G12** | **English only.** | **Built.** **Hindi, Odia and Bengali**, switchable from the language chip in every header and from the guide, remembered on the tablet. Covers every screen an operator uses. *Not* the checklist questions themselves — those come from the dashboard and need a translation column per checklist item (proposed as a next step). **Translations are mine and should be read by a native speaker at the mine before go-live.** 354 sentences in each language; `mobile/scripts/i18n_keys.py` lists them and a test fails if a new sentence has no translation. Digits stay 0–9. |
| G13 | The sync and set-up screens are for IT and stay English. | Agreed earlier (D1–D3): hidden before production. |
