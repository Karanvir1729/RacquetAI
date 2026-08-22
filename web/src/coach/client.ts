/**
 * Talking to the coach.
 *
 * There is no model key in this bundle and there never can be: a key shipped
 * to the browser is a public key. Every call here goes to the analysis server,
 * which holds the Azure OpenAI credentials and will not act without a Supabase
 * bearer token. So the client's whole job is: attach the token, send the
 * context, narrow whatever comes back.
 *
 * The analysis travels with the request rather than living on the server,
 * because that is already how this app works — the read-out is the visitor's,
 * held in their browser (see analysis/history.ts). Sending it per-turn keeps
 * the server stateless and means the coach can talk about a match the server
 * has long since swept out of its job store.
 */
import { authHeader, defaultApiBase, readApiBase } from "@/analysis/client";
import type { MatchAnalysis } from "@/analysis/types";
import type { OpponentBrief } from "@/players/scout";

export interface CoachTurn {
  role: "user" | "assistant";
  content: string;
}

export class CoachError extends Error {
  readonly status: number | undefined;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "CoachError";
    this.status = status;
  }
}

function base(): string {
  return (readApiBase() || defaultApiBase()).replace(/\/+$/, "");
}

/** The pose track is 98% of an analysis and useless to a coach — never send it. */
function slim(analysis: MatchAnalysis | null): unknown {
  if (analysis === null) return undefined;
  const { tracks: _tracks, ...rest } = analysis;
  return rest;
}

async function post(path: string, body: unknown): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(`${base()}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeader()) },
      body: JSON.stringify(body),
    });
  } catch {
    throw new CoachError("Could not reach the coach. Check your connection and try again.");
  }

  let parsed: unknown = null;
  try {
    parsed = await response.json();
  } catch {
    parsed = null;
  }
  const record =
    typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};

  if (!response.ok) {
    const detail = typeof record.error === "string" ? record.error : null;
    throw new CoachError(
      detail ?? `The coach could not answer (HTTP ${response.status}).`,
      response.status,
    );
  }
  return record;
}

/** Is a model wired up on the server this browser is pointed at? */
export async function coachAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${base()}/coach/status`);
    if (!response.ok) return false;
    const body: unknown = await response.json();
    return (
      typeof body === "object" && body !== null && (body as Record<string, unknown>).configured === true
    );
  } catch {
    return false;
  }
}

/**
 * The opponent brief rides along the same way the analysis does — per turn,
 * stateless — and only when the page is scouting someone; the key is left out
 * of the body entirely otherwise, so the server's "no opponent" path is the
 * old path, byte for byte. The server re-validates every field before any of
 * it reaches a prompt (see _narrow_opponent in analysis/coach_api.py).
 */
function withOpponent(body: Record<string, unknown>, opponent?: OpponentBrief): Record<string, unknown> {
  return opponent === undefined ? body : { ...body, opponent };
}

export async function askCoach(
  message: string,
  history: CoachTurn[],
  analysis: MatchAnalysis | null,
  opponent?: OpponentBrief,
): Promise<string> {
  const body = await post(
    "/coach/chat",
    withOpponent({ message, history, analysis: slim(analysis) }, opponent),
  );
  const reply = body.reply;
  if (typeof reply !== "string" || reply.length === 0) {
    throw new CoachError("The coach replied with nothing. Try asking again.");
  }
  return reply;
}

export async function requestFeedback(
  analysis: MatchAnalysis,
  opponent?: OpponentBrief,
): Promise<string> {
  const body = await post("/coach/feedback", withOpponent({ analysis: slim(analysis) }, opponent));
  const feedback = body.feedback;
  if (typeof feedback !== "string" || feedback.length === 0) {
    throw new CoachError("The coach replied with nothing. Try again.");
  }
  return feedback;
}
