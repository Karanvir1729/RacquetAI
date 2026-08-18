#!/usr/bin/env python3
"""Verify every App Store metadata field in listing.md is inside Apple's limit.

    python3 store/check-lengths.py

Exit status is non-zero if any field is over, so this can gate a submission.
Fields are pulled out of listing.md by heading, so editing the copy in that
file is enough — there is no second copy of the strings to keep in sync.
"""
import pathlib
import re
import sys

LISTING = pathlib.Path(__file__).resolve().parent / "listing.md"

LIMITS = {
    "App Name": 30,
    "Subtitle": 30,
    "Promotional text": 170,
    "Keywords": 100,
    "Description": 4000,
    "What's New": 4000,
}


def first_fenced_block(section):
    """The first ``` fenced block in a section, verbatim minus the fences."""
    match = re.search(r"```[a-z]*\n(.*?)\n```", section, re.S)
    return match.group(1) if match else None


def sections(text):
    """Split on '## ' headings, keyed by the heading line."""
    out = {}
    for part in re.split(r"^## ", text, flags=re.M)[1:]:
        heading, _, body = part.partition("\n")
        out[heading.strip()] = body
    return out


def main():
    found = sections(LISTING.read_text(encoding="utf-8"))
    failures = 0
    checked = 0

    for heading, body in found.items():
        for name, limit in LIMITS.items():
            if not heading.startswith(name):
                continue
            block = first_fenced_block(body)
            if block is None:
                print("MISSING  %s: no fenced block under %r" % (name, heading))
                failures += 1
                break
            length = len(block)
            print("%s %s: %d/%d" % ("OVER   " if length > limit else "ok     ",
                                    name, length, limit))
            checked += 1
            if length > limit:
                failures += 1
            if name == "Keywords":
                # Apple counts spaces; they buy nothing.
                if " " in block:
                    print("         ! contains a space — wastes characters")
                    failures += 1
                parts = block.split(",")
                dupes = sorted({k for k in parts if parts.count(k) > 1})
                if dupes:
                    print("         ! duplicate keywords: %s" % dupes)
                    failures += 1
            break

    if checked != len(LIMITS):
        print("\nWARNING: checked %d fields, expected %d" % (checked, len(LIMITS)))

    print("\n%d problem(s)." % failures)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
