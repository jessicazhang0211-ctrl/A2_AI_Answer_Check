"""Claim checking: normalise each claim's value and compare it with the handbook facts.

This step is ordinary code, not a model call. GPT proposes the claims; this module decides their status.
Statuses: supported, conflict, outdated, missing (shown to users as "Unresolved").
"""
import json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august",
          "september", "october", "november", "december"]
WORDS = {w: i for i, w in enumerate("zero one two three four five six seven eight nine ten eleven twelve "
                                     "thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty".split())}
# Rules that apply to the whole module, whatever piece of coursework the question mentions.
MODULE_ATTRS = {"late_penalty_per_day", "late_max_days", "extension_max_days", "feedback_days", "resubmission_days"}
LABELS = {"supported": "Supported", "conflict": "Conflicts with handbook",
          "outdated": "Outdated source", "missing": "Unresolved"}


def load_handbook(path=None):
    with open(path or os.path.join(HERE, "data", "handbook.json"), encoding="utf-8") as f:
        return json.load(f)


def norm_number(v):
    s = str(v).lower().replace(",", "")
    m = re.search(r"\d+(\.\d+)?", s)
    if m:
        n = float(m.group())
        return str(int(n)) if n.is_integer() else str(n)
    for w, n in WORDS.items():
        if re.search(r"\b%s\b" % w, s):
            return str(n)
    return None


def norm_date(v):
    s = str(v).lower()
    m = re.search(r"(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        return "%s-%s" % (m.group(2), m.group(3))
    for i, name in enumerate(MONTHS):
        if name in s or re.search(r"\b%s\b" % name[:3], s):
            d = re.search(r"\b(\d{1,2})(st|nd|rd|th)?\b", s)
            if d:
                return "%02d-%02d" % (i + 1, int(d.group(1)))
    return None


def normalise(kind, value):
    if kind == "date":
        return norm_date(value)
    if kind in ("number", "percent"):
        return norm_number(value)
    return None


def norm_subject(s):
    s = (s or "").lower()
    if re.search(r"(coursework|cw|assignment)\s*(1|one)\b", s):
        return "coursework 1"
    if re.search(r"(coursework|cw|assignment)\s*(2|two)\b", s):
        return "coursework 2"
    if "exam" in s:
        return "exam"
    if not s.strip() or s.strip() in ("module", "all", "general"):
        return "module"
    return re.sub(r"\s+", " ", s.strip())  # a subject from the student's own documents, e.g. "lab report"


def _facts(handbook):
    for p in handbook["passages"]:
        for f in p["facts"]:
            yield f, p


def check_claim(claim, handbook):
    """Return a copy of the claim with status, evidence and the wording each cue mode needs."""
    out = dict(claim)
    value = normalise(claim.get("type"), claim.get("value"))
    out["normalised"] = value
    attr = claim.get("attribute")
    subj = norm_subject(claim.get("subject"))
    cands = [(f, p) for f, p in _facts(handbook)
             if f["attribute"] == attr and (attr in MODULE_ATTRS or norm_subject(f["subject"]) == subj)]
    current = [(f, p) for f, p in cands if not p["superseded"]]
    old = [(f, p) for f, p in cands if p["superseded"]]
    match = lambda pairs: [(f, p) for f, p in pairs if value is not None and f["value"] == value]
    evidence, older = None, None
    if not cands:
        status = "missing"
    elif match(current):
        status, evidence = "supported", match(current)[0]
    elif match(old):
        status, older = "outdated", match(old)[0]
        evidence = current[0] if current else None
    else:
        status = "conflict"
        evidence = (current or old)[0]
    out["status"] = status
    out["label"] = LABELS[status]
    if handbook.get("noun", "handbook") != "handbook" and status == "conflict":
        out["label"] = "Conflicts with your documents"
    out["evidence"] = _ev(evidence)
    out["older_evidence"] = _ev(older)
    out["verbal"], out["detail"] = _wording(out, handbook.get("noun", "handbook"))
    return out


def _ev(pair):
    if not pair:
        return None
    f, p = pair
    return {"source": p["source"], "section": p["section"], "updated": p["updated"],
            "superseded": p["superseded"], "text": p["text"], "value": f["span"]}


def _where(noun, ev):
    """Who says it: the demo handbook, or the student's document by name."""
    return "the current handbook" if noun == "handbook" else ev["source"]


def _wording(c, noun="handbook"):
    """First-person sentence (verbal mode) and a short comparison line (visual mode)."""
    ai, ev, old = c.get("value"), c.get("evidence"), c.get("older_evidence")
    s = c["status"]
    if s == "supported":
        return ("I checked this against %s (%s) and it matches." % (_where(noun, ev), ev["section"]),
                "AI: %s · Source: %s" % (ai, ev["value"]))
    if s == "conflict":
        return ("I said \u201c%s\u201d, but %s (%s) says %s. Please check before using this."
                % (c.get("text", ai), _where(noun, ev), ev["section"], ev["value"]),
                "AI: %s · Source: %s" % (ai, ev["value"]))
    if s == "outdated":
        w = _where(noun, ev) if ev else ""
        now = (" %s (%s) says %s." % (w[0].upper() + w[1:], ev["section"], ev["value"])) if ev else ""
        return ("This matches %s%s, which has been replaced.%s" % ("the " if noun == "handbook" else "", old["source"], now),
                "AI: %s · Old version: %s · Current: %s" % (ai, old["value"], ev["value"] if ev else "none"))
    return ("I couldn't find anything about this in %s, so I can't confirm it." % ("the handbook" if noun == "handbook" else noun),
            "AI: %s · Source: no information" % ai)


def check_all(claims, handbook=None):
    handbook = handbook or load_handbook()
    return [check_claim(c, handbook) for c in claims]


if __name__ == "__main__":
    hb = load_handbook()
    sc = json.load(open(os.path.join(HERE, "data", "scenarios.json"), encoding="utf-8"))
    ok = sum(check_claim(c, hb)["status"] == c["gold"] for s in sc for c in s["claims"])
    print("comparator on labelled claims: %d / %d" % (ok, sum(len(s["claims"]) for s in sc)))
