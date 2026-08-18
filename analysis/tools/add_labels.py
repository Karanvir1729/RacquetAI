#!/usr/bin/env python3
"""Append hand labels to analysis/eval/labels_v1.json.

Reads a small JSON payload on stdin so the labelling pass can commit a batch of
labels to disk as soon as the frames have been looked at:

    {"windows": [{"clip":"archive_match2","t0":154.24,"t1":163.84}],
     "contacts": [{"clip":"archive_match2","t":161.40,"strikerLook":"light",
                   "strikerBox":"B","inPlay":false,"conf":"med","note":"..."}],
     "candidates":[{"clip":"archive_match2","t":157.965,"contact":false,
                    "conf":"med","reason":"pickup"}]}

Idempotent per (clip, t, kind): re-adding the same time replaces the entry.
"""
import json
import os
import sys

LABELS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                      "eval", "labels_v1.json")


def merge(dst, new, keys):
    idx = {tuple(round(r[k], 3) if isinstance(r[k], float) else r[k] for k in keys): i
           for i, r in enumerate(dst)}
    for r in new:
        k = tuple(round(r[k], 3) if isinstance(r[k], float) else r[k] for k in keys)
        if k in idx:
            dst[idx[k]] = r
        else:
            dst.append(r)
    dst.sort(key=lambda r: (r["clip"], r.get("t", r.get("t0", 0.0))))


def main():
    payload = json.load(sys.stdin)
    doc = json.load(open(LABELS))
    merge(doc["exhaustiveWindows"], payload.get("windows", []), ("clip", "t0"))
    merge(doc["contacts"], payload.get("contacts", []), ("clip", "t"))
    merge(doc["candidateLabels"], payload.get("candidates", []), ("clip", "t"))
    with open(LABELS, "w") as f:
        json.dump(doc, f, indent=1)
    print(f"windows={len(doc['exhaustiveWindows'])} contacts={len(doc['contacts'])} "
          f"candidates={len(doc['candidateLabels'])}")


if __name__ == "__main__":
    main()
