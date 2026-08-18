/**
 * Display helpers for recordings — pure and deterministic (no toLocale*, whose
 * output varies by JS engine and device locale and would make both the UI and
 * the unit tests flaky). Durations render via src/lib/format's formatClock;
 * this module owns the date label and sport naming.
 */
import type { Sport } from "./types";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const SPORT_LABELS: Record<Sport, string> = {
  squash: "Squash",
  unspecified: "Untagged",
};

export function sportLabel(sport: Sport): string {
  return SPORT_LABELS[sport];
}

/** Local-calendar day difference (2 = the day before yesterday), DST-safe via Date.UTC. */
function calendarDayDiff(from: Date, to: Date): number {
  const fromDays = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const toDays = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((toDays - fromDays) / 86_400_000);
}

function formatTime12h(date: Date): string {
  const hours = date.getHours() % 12 || 12;
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes} ${date.getHours() < 12 ? "AM" : "PM"}`;
}

/**
 * Human date label for a recording, relative to `now` (injectable for tests):
 * "Today · 2:07 PM" → "Yesterday · 9:41 AM" → "Mon 3 Aug · 6:15 PM" (same
 * year) → "31 Dec 2025" (older — the time stops mattering by then).
 */
export function formatRecordedAt(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  const diff = calendarDayDiff(date, now);
  if (diff === 0) return `Today · ${formatTime12h(date)}`;
  if (diff === 1) return `Yesterday · ${formatTime12h(date)}`;
  if (date.getFullYear() === now.getFullYear()) {
    return `${DAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]} · ${formatTime12h(date)}`;
  }
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}
