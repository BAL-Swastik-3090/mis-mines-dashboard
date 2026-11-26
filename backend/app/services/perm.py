"""One answer to "may this request do that".

── WHY THIS IS NOT A COPY IN EVERY ROUTER ──────────────────────────────────
It very nearly was. rom_entry and rom_stack each grew their own four-line
_require/_may when they were written, and migration 137 added permissions to
seven more routers -- which would have made nine copies of the same two
functions, each free to drift. pageAccess.ts on the front end carries a long
note about exactly this: there were two answers to "may I open this page", one
in the sidebar and one in the route guard, and they disagreed in a way nobody
noticed until a registrar saw a dashboard full of 403s.

── WHERE THE PERMISSIONS COME FROM ─────────────────────────────────────────
`request.state.permissions` is put there by the auth middleware from the
session, resolved through minehub.mines_user_role -> role_permission ->
permission. A request that never reached the middleware has no attribute at
all, which is why the default below is an empty set rather than a KeyError:
unknown means none, never everything.

THIS IS THE GATE. The sidebar hides what you may not open and the Save button
greys itself out, but both are courtesies -- the person who knows the URL gets
here regardless, and this is what stops them.
"""
from __future__ import annotations

from fastapi import HTTPException, Request


def held(request: Request) -> set[str]:
    """Every permission this request carries. Empty when there are none."""
    return getattr(request.state, "permissions", None) or set()


def may(request: Request, *codes: str) -> bool:
    """True if the request holds ANY of these codes.

    Any rather than all: a screen that opens on either .view or .edit asks
    this with both, and a holder of .edit must not be refused the read of the
    thing they are allowed to rewrite.
    """
    h = held(request)
    return any(c in h for c in codes)


def require(request: Request, code: str, doing: str) -> None:
    """Refuse the request unless it holds `code`.

    `doing` finishes the sentence "You do not have permission to ...", so it
    reads as the act rather than the code: "enter the mines stock position",
    not "stock.edit". The person reading it cannot grant themselves anything
    and naming the code tells them nothing they can act on -- they have to ask
    an Access Manager either way, and a sentence is what they can repeat.
    """
    if code not in held(request):
        raise HTTPException(403, f"You do not have permission to {doing}.")


def require_any(request: Request, codes: tuple[str, ...], doing: str) -> None:
    """Refuse unless the request holds at least one of `codes`."""
    if not may(request, *codes):
        raise HTTPException(403, f"You do not have permission to {doing}.")
