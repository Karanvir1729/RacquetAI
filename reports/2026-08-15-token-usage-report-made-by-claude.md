# RacquetAI — Token Usage & Cost Report · Made by Claude

> **Prepared by Claude** (Anthropic's Claude Code) for management, as the companion to the [build day report](2026-08-15-build-day-report-made-by-claude.md).
>
> **Repository:** <https://github.com/Karanvir1729/RacquetAI> · **Open pull request:** [#1](https://github.com/Karanvir1729/RacquetAI/pull/1)
>
> Figures are as of Aug 16, 2026, ~3:05 AM EDT. The reporting session was still running when measured, so its row (and the totals) undercount slightly.

## Headline numbers

| Metric | Value |
|---|---:|
| Total tokens processed (input + output + cache) | **302,523,454** |
| Tokens generated (output) | **2,491,998** |
| Fresh (uncached) input tokens | 117,824 |
| Cache writes | 13,245,962 |
| Cache reads | 286,667,670 |
| Claude sessions | 4 |
| Subagent transcripts (workflow agents) | 36 |
| **Estimated cost at Anthropic API list rates** | **US$424 – 498** |

The striking shape of these numbers — 95% of all tokens are *cache reads* — is what makes a build like this economical. Claude re-reads its full working context on every step, but prompt caching serves those tokens at roughly one-tenth the normal input price.

## Per-session breakdown

Tokens include each session's own transcript **plus all subagent/workflow transcripts it spawned**. The forked session shares its first ~26 messages with the main session; those were counted once (deduplicated by message ID).

| Session (models) | When (EDT) | Input | Output | Cache write | Cache read | Total |
|---|---|---:|---:|---:|---:|---:|
| Main build — "RacquetAI repo setup and planning" (Fable 5; subagents Fable 5 + Opus 5) | Aug 15, 6:54 PM – 10:33 PM | 43,854 | 1,009,732 | 4,957,760 | 146,124,171 | **152,135,517** |
| Forked planning session — board + squash pivot (Fable 5 → Opus 5) | Aug 15, ~7:10 PM – 10:10 PM | 73,393 | 987,382 | 6,091,751 | 113,511,819 | **120,664,345** |
| Brand redraw worktree — "Redraw RacquetAI mark as a squash racquet" (Opus 5) | Aug 15, 10:06 – 10:23 PM | 215 | 190,795 | 276,044 | 13,276,254 | **13,743,308** |
| This reporting session (Fable 5 + a 4-agent mining workflow) | Aug 16, 2:38 AM – | 362 | 304,089 | 1,920,407 | 13,755,426 | **15,980,284** |
| **Total** | | **117,824** | **2,491,998** | **13,245,962** | **286,667,670** | **302,523,454** |

Subagents did the heavy lifting: of the ~2.49M generated tokens, roughly **1.9M were produced by the 36 workflow subagents** (feature builders, integrator, auditor, board authors, critics, icon designers, transcript miners) rather than the four top-level sessions.

## Cost estimate by model

Priced at Anthropic API list rates (source: Anthropic pricing documentation): **Claude Fable 5** $10 / $50 per million input/output tokens; **Claude Opus 5** $5 / $25. Cache reads bill at ~0.1× the input rate; cache writes at 1.25× (5-minute TTL) to 2× (1-hour TTL) — the range below spans those two write assumptions.

| Model | Input | Output | Cache write | Cache read | Est. cost |
|---|---:|---:|---:|---:|---:|
| Claude Fable 5 | 35,918 | 1,158,659 | 6,420,139 | 131,338,310 | $270 – 318 |
| Claude Opus 5 | 81,906 | 1,333,339 | 6,825,823 | 155,329,360 | $154 – 180 |
| **Total** | | | | | **$424 – 498** |

Two framing notes for management:

1. **This is list-rate equivalent value, not necessarily the invoice.** Work ran through a Claude Code subscription; the figures answer "what would this compute cost at published API prices," which is the fair basis for a build-vs-buy comparison.
2. **Counterfactual:** without prompt caching, the same 286.7M cache-read tokens would have billed as fresh input — roughly **$2,300 of additional spend**. Caching cut the effective compute bill by ~80%.

## What the tokens bought

One evening of spend (~$424–498 list-rate) produced: a public GitHub repo with 18 commits and ~38K insertions; a working, simulator-verified iOS app with 178 passing tests; four merged feature branches plus an open PR; a complete brand system; 8 documentation files including an App Store runbook and a budget-gated AI plan; and a rendered 7-day execution board. Details and screenshots: [build day report](2026-08-15-build-day-report-made-by-claude.md).

## Methodology

- **Source of truth:** the local Claude Code session transcripts (JSONL) for all four sessions, plus every subagent/workflow transcript they spawned (36 files, ~40 MB total). Each assistant message records exact `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, and `cache_read_input_tokens` as billed by the API.
- **Deduplication:** the forked session's transcript embeds a copy of the main session's first ~26 messages; all sums are deduplicated by message UUID so no API call is counted twice.
- **Session identification:** sessions were matched to the work via timestamps against git commit times and their own recorded commands (e.g., the main session's final write coincides with commit `1f48d7a` at 10:32 PM EDT).
- **Pricing:** Anthropic list rates as of Aug 2026 (Fable 5 $10/$50, Opus 5 $5/$25 per MTok; cache read 0.1×; cache write 1.25–2×).

---

*Made by Claude (Claude Code) · Aug 16, 2026*
