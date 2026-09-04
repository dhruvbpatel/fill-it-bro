#!/usr/bin/env python3
"""Print tickets whose blockers are all done. Usage: frontier.py [--json] [--all] [--no-gh]   (done = Status line says done OR a merged PR titled TNN exists)"""
import json, re, sys
from pathlib import Path

ISSUES = Path(__file__).resolve().parent.parent / "issues"

def load():
    tickets = {}
    for p in sorted(ISSUES.glob("[0-9][0-9]-*.md")):
        text = p.read_text()
        num = p.name[:2]
        title = re.search(r"^# \d\d: (.+)$", text, re.M).group(1).strip()
        blocked = re.search(r"\*\*Blocked by:\*\* (.+)", text).group(1)
        deps = [] if blocked.startswith("None") else re.findall(r"\b(\d\d)\b", blocked)
        status = re.search(r"\*\*Status:\*\* (\S+)", text).group(1)
        tickets[num] = {"num": num, "title": title, "deps": deps, "status": status, "file": p.name}
    return tickets

def merged_from_github():
    """Ticket numbers whose PR (title 'TNN: ...' or 'T NN: ...') is merged on GitHub."""
    import subprocess
    try:
        out = subprocess.run(["gh","pr","list","--state","merged","--limit","100","--json","title"],
                             capture_output=True, text=True, timeout=20, check=True).stdout
        return {m.group(1) for t in json.loads(out) for m in [re.match(r"T\s?(\d\d)\b", t["title"])] if m}
    except Exception:
        return set()

def apply_github(tickets):
    for n in merged_from_github():
        if n in tickets and tickets[n]["status"] != "done":
            tickets[n]["status"] = "done (merged PR)"
    return tickets

def is_done(t): return t["status"].startswith("done")

def frontier(tickets):
    return [t for t in tickets.values()
            if not is_done(t) and all(is_done(tickets[d]) for d in t["deps"])]

if __name__ == "__main__":
    t = load()
    if "--no-gh" not in sys.argv: t = apply_github(t)
    rows = list(t.values()) if "--all" in sys.argv else frontier(t)
    if "--json" in sys.argv:
        print(json.dumps(rows, indent=2))
    else:
        for r in rows:
            print(f"{r['num']}  {r['status']:<16} deps={','.join(r['deps']) or '-':<20} {r['title']}")
