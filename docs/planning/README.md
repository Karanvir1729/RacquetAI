# Planning boards

## Week 1 board (15–21 Aug 2026)

The 7-day execution plan and the squash-club product definition, as one Excalidraw board.

| File | What it is |
| --- | --- |
| `week1-board.excalidraw` | The board. Open it at [excalidraw.com](https://excalidraw.com/) via **☰ → Open**, or drag it onto the canvas. |
| `week1-board.png` | Flat render, for reading without Excalidraw. |
| `week1-board.content.json` | The board's **content** — tracks, days, cards, pillars, features, requirements. Edit this, not the scene. |
| `render_board.py` | Regenerates the scene from the content. Python 3, stdlib only. |

Regenerate after editing the content:

```bash
python3 docs/planning/render_board.py docs/planning/week1-board.content.json docs/planning/week1-board.excalidraw
```

The renderer lays the board out from scratch every run and self-checks that no two boxes
overlap and no text spills its container, so content edits cannot silently break the layout.
Output is deterministic — the same content always produces a byte-identical scene, so diffs
stay meaningful.

### What the board says

**Section A — the 7-day plan.** Five tracks running in parallel (Capture, Vision & Azure,
Club Product, Integration & Release, Pilot & Consent) across Sat 15 → Fri 21 Aug, ending at a
squash club recording a real box-league match on their own phone off a TestFlight build. No AI
runs inside the app; every AI step is offline, on already-recorded video. Below the grid:
risks with mitigations, what is explicitly out of scope this week, and the Day-7 demo gate.

**Section B — squash clubs, the beachhead.** Four pillars (Data Recording, Feedback, Data
Injection & Analytics, AI Coaching) with features prioritised P0 (needed for the first club
pilot) / P1 (needed to charge money) / P2 (the moat later), then what a club must have or
agree to — court fit-out, network and storage, consent and safeguarding, ownership and
deletion rights, integrations, staffing, and commercial terms — and the open questions that a
single phone call to a club would settle.
