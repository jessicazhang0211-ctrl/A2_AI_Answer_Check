"""Offline evaluation: are the claim statuses the interface relies on trustworthy? No participants.

    python eval.py            Part A always; Parts B-C need OPENAI_API_KEY
    python eval.py --runs 3   GPT extraction runs per scenario (default 3)

A  Comparator: status of each hand-labelled claim vs its label.
B  Extraction: GPT splits each scripted answer into claims; matched to labels by subject,
   attribute and normalised value. Reports recall, precision and end-to-end status accuracy.
C  Reminders: how often a correct (supported) claim would wrongly trigger the accept reminder.
Results are written to results/eval_results.json and results/eval_report.md.
"""
import collections, json, os, sys
import checker, llm, pipeline

HERE = os.path.dirname(os.path.abspath(__file__))
SC = json.load(open(os.path.join(HERE, "data", "scenarios.json"), encoding="utf-8"))
HB = checker.load_handbook()
STATUSES = ["supported", "conflict", "outdated", "missing"]
SHOW = lambda st: "unresolved" if st == "missing" else st   # "missing" is the internal name; users see "Unresolved"


def key(c):
    attr = c["attribute"]
    subj = "module" if attr in checker.MODULE_ATTRS else checker.norm_subject(c["subject"])
    return (subj, attr, checker.normalise(c["type"], c["value"]))


def confusion(pairs):
    m = {g: collections.Counter() for g in STATUSES}
    for g, p in pairs:
        m[g][p] += 1
    return m


def part_a():
    pairs = [(c["gold"], checker.check_claim(c, HB)["status"]) for s in SC for c in s["claims"]]
    return {"correct": sum(g == p for g, p in pairs), "total": len(pairs), "confusion": confusion(pairs)}


def part_b(runs):
    rows, pairs, extracted_total, matched_total = [], [], 0, 0
    for s in SC:
        for r in range(runs):
            claims = pipeline.valid_claims(llm.chat_json(pipeline.EXTRACT_SYSTEM, "Answer:\n" + s["answer"]), s["answer"]) or []
            checked = checker.check_all(claims, HB)
            extracted_total += len(checked)
            found = {key(c): c for c in checked}
            for g in s["claims"]:
                hit = found.get(key(g))
                matched_total += 1 if hit else 0
                pairs.append((g["gold"], hit["status"] if hit else "not extracted"))
                rows.append({"scenario": s["id"], "run": r + 1, "claim": g["text"], "gold": g["gold"],
                             "extracted": bool(hit), "status": hit["status"] if hit else None})
            if r == 0:  # keep one run as the cache the app reads offline
                os.makedirs(pipeline.CACHE, exist_ok=True)
                json.dump(claims, open(pipeline._cache_path(s["answer"]), "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    gold_total = sum(len(s["claims"]) for s in SC) * runs
    correct = sum(g == p for g, p in pairs)
    m = {g: collections.Counter() for g in STATUSES}
    for g, p in pairs:
        m[g][p] += 1
    return {"model": llm.MODEL, "runs": runs, "recall": matched_total / gold_total,
            "precision": matched_total / extracted_total if extracted_total else 0.0,
            "status_accuracy": correct / gold_total, "correct": correct, "total": gold_total,
            "confusion": m, "rows": rows}


def reminders(conf):
    """Supported claims labelled conflict or outdated would trigger the reminder by mistake."""
    s = conf["supported"]
    return {"false_reminders": s["conflict"] + s["outdated"], "supported_claims": sum(s.values())}


def table(conf, cols):
    out = ["| label \\ system | " + " | ".join(SHOW(c) for c in cols) + " |", "|---" * (len(cols) + 1) + "|"]
    for g in STATUSES:
        out.append("| %s | %s |" % (SHOW(g), " | ".join(str(conf[g][c]) for c in cols)))
    return "\n".join(out)


if __name__ == "__main__":
    runs = int(sys.argv[sys.argv.index("--runs") + 1]) if "--runs" in sys.argv else 3
    res = {"A": part_a()}
    res["A"]["reminders"] = reminders(res["A"]["confusion"])
    lines = ["# Offline evaluation", "",
             "## A. Comparator on hand-labelled claims", "",
             "%d of %d claims received the labelled status." % (res["A"]["correct"], res["A"]["total"]), "",
             table(res["A"]["confusion"], STATUSES), ""]
    if llm.live():
        res["B"] = part_b(runs)
        res["B"]["reminders"] = reminders(res["B"]["confusion"])
        b = res["B"]
        lines += ["## B. GPT extraction + comparator (%s, %d runs per scenario)" % (b["model"], runs), "",
                  "- Recall (labelled claims extracted with the right subject, attribute and value): %.0f%%" % (100 * b["recall"]),
                  "- Precision (extracted claims that match a labelled claim): %.0f%%" % (100 * b["precision"]),
                  "- End-to-end status accuracy: %d / %d = %.0f%%" % (b["correct"], b["total"], 100 * b["status_accuracy"]), "",
                  table(b["confusion"], STATUSES + ["not extracted"]), "",
                  "## C. Reminders on correct claims", "",
                  "%d of %d supported claims would have triggered the accept reminder by mistake." % (b["reminders"]["false_reminders"], b["reminders"]["supported_claims"]), ""]
        misses = [r for r in b["rows"] if not r["extracted"] or r["status"] != r["gold"]]
        if misses:
            lines += ["### Errors", "", "| scenario | run | claim | label | system |", "|---|---|---|---|---|"]
            lines += ["| %s | %d | %s | %s | %s |" % (r["scenario"], r["run"], r["claim"], SHOW(r["gold"]), SHOW(r["status"]) if r["status"] else "not extracted") for r in misses]
    else:
        lines += ["## B-C. Skipped", "", "Set OPENAI_API_KEY and run again to evaluate GPT extraction."]
    os.makedirs(os.path.join(HERE, "results"), exist_ok=True)
    json.dump(res, open(os.path.join(HERE, "results", "eval_results.json"), "w", encoding="utf-8"), indent=1, default=dict)
    open(os.path.join(HERE, "results", "eval_report.md"), "w", encoding="utf-8").write("\n".join(lines) + "\n")
    print("\n".join(lines))
