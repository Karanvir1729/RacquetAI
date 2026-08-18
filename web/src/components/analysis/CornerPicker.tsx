import { Check, CornerDownLeft, RotateCcw, Undo2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";

import { cellLabel } from "@/analysis/format";
import { CORNER_ORDER, type CourtCorners } from "@/analysis/jobContract";
import {
  normalizedToView,
  tapToNormalizedUnclamped,
  type Point,
  type Size,
} from "@/analysis/letterbox";
import { Button } from "@/components/ui/Button";
import { Card, Hairline } from "@/components/ui/Card";
import { useElementSize } from "@/lib/useElementSize";

/**
 * "Mark the court corners" — the one step of the flow the pipeline cannot do
 * for you, and the one most likely to be fumbled on a phone.
 *
 * Three decisions worth knowing about:
 *
 * 1. NOTHING IS CLAMPED. `POST /jobs/<id>/corners` documents that normalized
 *    values may fall outside 0..1, "because court corners can sit outside the
 *    camera frame" — on a wide club recording the back corners routinely do.
 *    So the frame is drawn inside a deliberately larger stage with a visible
 *    off-frame margin, marks may be placed in it, and a corner at -0.12 goes
 *    to the server as -0.12. Squeezing it to 0 would skew the homography for
 *    the entire match.
 *
 * 2. PLACE, THEN CONFIRM. A fingertip is about 9 mm across and a court corner
 *    is a few pixels; tapping once and being stuck with it is not a design. So
 *    a tap places a DRAFT, dragging moves it, a loupe magnifies what is under
 *    it, and a full-width button commits it. Arrow keys nudge the draft, which
 *    is both the fine-adjust and the keyboard path through the whole step.
 *
 * 3. The loupe is pinned to a corner of the stage, not floated under the
 *    finger — the thumb is already covering that part of the screen.
 */

const LOUPE_PX = 116;
const LOUPE_ZOOM = 3.5;
/** Arrow-key step, in normalized units: ~1 pixel of an 854-wide frame. */
const NUDGE = 0.0012;
const NUDGE_COARSE = 0.012;

interface CornerPickerProps {
  frameSrc: string;
  submitting: boolean;
  /** Non-null when the server refused the last submission. */
  error: string | null;
  onSubmit: (corners: CourtCorners) => void;
}

export function CornerPicker({ frameSrc, submitting, error, onSubmit }: CornerPickerProps) {
  const [frameRef, frameSize] = useElementSize<HTMLDivElement>();
  const frameElementRef = useRef<HTMLDivElement | null>(null);
  const [imageSize, setImageSize] = useState<Size | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  /** Committed corners, in CORNER_ORDER. */
  const [points, setPoints] = useState<Point[]>([]);
  const [draft, setDraft] = useState<Point | null>(null);
  const [dragging, setDragging] = useState(false);
  const lastFrameSrc = useRef(frameSrc);

  const index = points.length;
  const nextCell = index < CORNER_ORDER.length ? CORNER_ORDER[index] : undefined;
  const ready = frameSize !== null && imageSize !== null;
  const complete = index === CORNER_ORDER.length;

  useEffect(() => {
    // A NEW frame (retry, re-upload) invalidates everything measured off the
    // old one. Guarded on an actual change rather than firing on mount too,
    // because on mount it would race the ref below and null out a size that
    // had just been read from an already-decoded image.
    if (lastFrameSrc.current === frameSrc) return;
    lastFrameSrc.current = frameSrc;
    setPoints([]);
    setDraft(null);
    setImageSize(null);
    setImageFailed(false);
  }, [frameSrc]);

  /**
   * Measure the frame the moment the element exists.
   *
   * `onLoad` alone is not enough: a cached or already-decoded image can finish
   * loading before React attaches the handler, and then the event never fires,
   * `imageSize` stays null and the picker silently refuses every tap. Reading
   * `complete`/`naturalWidth` off the node covers that case; `onLoad` still
   * covers the ordinary one.
   */
  const measureImage = useCallback((node: HTMLImageElement | null) => {
    if (node === null || !node.complete || node.naturalWidth <= 0) return;
    setImageSize({ width: node.naturalWidth, height: node.naturalHeight });
  }, []);

  /** Pointer position → normalized frame coordinates, unclamped by design. */
  const toNormalized = useCallback(
    (clientX: number, clientY: number): Point | null => {
      const element = frameElementRef.current;
      if (element === null || imageSize === null) return null;
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      return tapToNormalizedUnclamped(
        { x: clientX - rect.left, y: clientY - rect.top },
        { width: rect.width, height: rect.height },
        imageSize,
      );
    },
    [imageSize],
  );

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (complete || submitting) return;
    const normalized = toNormalized(event.clientX, event.clientY);
    if (normalized === null) return;
    // Capture keeps the drag alive when the finger leaves the stage, which it
    // will — the whole point is that a corner can be off the picture. It is
    // best-effort: a browser that refuses capture still gets a working tap.
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* no capture available; the pointerup listener still ends the drag */
    }
    setDragging(true);
    setDraft(normalized);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging || complete || submitting) return;
    const normalized = toNormalized(event.clientX, event.clientY);
    if (normalized !== null) setDraft(normalized);
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      /* never had capture; nothing to release */
    }
    setDragging(false);
  };

  const nudge = (dx: number, dy: number) => {
    if (complete || submitting) return;
    setDraft((current) => {
      const from = current ?? { x: 0.5, y: 0.5 };
      return { x: from.x + dx, y: from.y + dy };
    });
  };

  const commit = () => {
    if (draft === null || complete || submitting) return;
    setPoints((current) => [...current, draft]);
    setDraft(null);
  };

  const undo = () => {
    if (submitting) return;
    setDraft(null);
    setPoints((current) => current.slice(0, -1));
  };

  const startOver = () => {
    if (submitting) return;
    setPoints([]);
    setDraft(null);
  };

  const submit = () => {
    if (!complete || submitting) return;
    const corners = {} as CourtCorners;
    CORNER_ORDER.forEach((cell, cellIndex) => {
      const point = points[cellIndex];
      if (point !== undefined) corners[cell] = point;
    });
    onSubmit(corners);
  };

  // The quad the server will build the homography from, once all four are in.
  const quad = useMemo(() => {
    if (!ready || points.length !== 4) return null;
    // Draw order front-left → front-right → back-right → back-left so the
    // outline is the court, not a bow tie.
    const order = [0, 1, 3, 2];
    const view = order.map((at) => {
      const point = points[at];
      return point === undefined ? null : normalizedToView(point, frameSize, imageSize);
    });
    if (view.some((point) => point === null)) return null;
    return (view as Point[]).map((point) => `${point.x},${point.y}`).join(" ");
  }, [frameSize, imageSize, points, ready]);

  const activePoint = draft ?? null;
  const loupeOnLeft = activePoint !== null && activePoint.x > 0.55;

  return (
    <Card className="overflow-hidden">
      <div className="px-5 pt-5 sm:px-6 sm:pt-6">
        <p className="rq-eyebrow">Step 2 · Mark the court</p>
        <h2 className="rq-h3 mt-2">
          {complete
            ? "All four corners placed."
            : `Place the ${nextCell === undefined ? "" : cellLabel(nextCell).toLowerCase()} floor corner`}
        </h2>
        <p className="rq-lead mt-3 text-[15px]">
          {complete
            ? "Check the outline traces the court floor, then start the analysis."
            : "Tap or drag on the frame, fine-tune with the loupe or the arrow keys, then confirm. A corner that sits off the edge of the picture goes in the hatched margin — the pipeline expects that and does not clamp it."}
        </p>
      </div>

      <div className="px-2 pb-3 pt-5 sm:px-4">
        {/* The stage. Its padding IS the off-frame margin — real estate for
            corners that sit outside the camera's view — sized at about 12% of
            the picture on every side, which covers the overhang a wide club
            recording actually produces without shrinking the picture past
            usefulness on a phone. `touch-action: none` keeps a drag from
            scrolling the page out from under the finger. */}
        <div
          className="relative mx-auto w-full select-none rounded-rq-md px-[10%] py-[8%]"
          style={{
            // Hatched, not merely tinted: on the light theme a 4%-opacity wash
            // is invisible, and the margin has to read as "outside the
            // picture" or nobody will believe a mark belongs there.
            backgroundColor: "var(--rq-input-foot)",
            backgroundImage:
              "repeating-linear-gradient(135deg, var(--rq-line) 0 1px, transparent 1px 9px)",
            border: "1px dashed var(--rq-line-2)",
            touchAction: "none",
            maxWidth: "min(100%, 56rem)",
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <div
            ref={(node) => {
              frameElementRef.current = node;
              frameRef(node);
            }}
            className="relative w-full"
            style={{ aspectRatio: imageSize === null ? "16 / 9" : `${imageSize.width} / ${imageSize.height}` }}
          >
            {imageFailed ? (
              <div className="absolute inset-0 flex items-center justify-center rounded-rq-sm border p-6 text-center"
                style={{ borderColor: "var(--rq-line)", background: "var(--rq-card)" }}>
                <p className="rq-caption max-w-xs">
                  The reference frame could not be loaded from the server. It becomes available as
                  soon as the job reaches the corner-marking stage.
                </p>
              </div>
            ) : (
              <img
                ref={measureImage}
                src={frameSrc}
                alt="A frame from the middle of your match, for marking the court corners"
                className="absolute inset-0 h-full w-full object-contain"
                draggable={false}
                onLoad={(event) =>
                  setImageSize({
                    width: event.currentTarget.naturalWidth,
                    height: event.currentTarget.naturalHeight,
                  })
                }
                onError={() => setImageFailed(true)}
              />
            )}

            {/* Marks live in the frame box's coordinate space but are allowed
                to overflow it — that is what the stage padding is for. */}
            {ready ? (
              <>
                {quad !== null ? (
                  <svg
                    className="pointer-events-none absolute inset-0 overflow-visible"
                    width={frameSize.width}
                    height={frameSize.height}
                    aria-hidden="true"
                  >
                    <polygon
                      points={quad}
                      fill="var(--rq-overlay-a)"
                      fillOpacity="0.14"
                      stroke="var(--rq-overlay-a)"
                      strokeWidth="2"
                      strokeLinejoin="round"
                      paintOrder="stroke"
                    />
                  </svg>
                ) : null}

                {points.map((point, at) => {
                  const view = normalizedToView(point, frameSize, imageSize);
                  const cell = CORNER_ORDER[at];
                  if (view === null || cell === undefined) return null;
                  return (
                    <Marker
                      key={cell}
                      x={view.x}
                      y={view.y}
                      label={String(at + 1)}
                      title={cellLabel(cell)}
                    />
                  );
                })}

                {draft !== null
                  ? (() => {
                      const view = normalizedToView(draft, frameSize, imageSize);
                      if (view === null) return null;
                      return <Crosshair x={view.x} y={view.y} active={dragging} />;
                    })()
                  : null}
              </>
            ) : null}
          </div>

          {/* Loupe. Pinned to a top corner, and it hops to the other side when
              the mark is under it, so the magnifier never hides its subject. */}
          {activePoint !== null && ready && !imageFailed ? (
            <Loupe
              src={frameSrc}
              point={activePoint}
              frameSize={frameSize}
              imageSize={imageSize}
              onLeft={loupeOnLeft}
            />
          ) : null}
        </div>

        {/* Keyboard path. A real focusable control, not a div with a handler:
            it announces itself, and arrow keys are the fine adjustment for
            anyone whose pointer is not precise enough. */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            className="inline-flex min-h-[44px] items-center gap-2 rounded-rq-sm border px-3 text-[13px] font-semibold"
            style={{
              borderColor: "var(--rq-line)",
              background: "var(--rq-card)",
              color: "var(--rq-text-dim)",
            }}
            aria-label="Nudge the pending corner with the arrow keys. Hold shift for larger steps."
            onKeyDown={(event) => {
              const step = event.shiftKey ? NUDGE_COARSE : NUDGE;
              if (event.key === "ArrowLeft") nudge(-step, 0);
              else if (event.key === "ArrowRight") nudge(step, 0);
              else if (event.key === "ArrowUp") nudge(0, -step);
              else if (event.key === "ArrowDown") nudge(0, step);
              else if (event.key === "Enter" || event.key === " ") commit();
              else return;
              event.preventDefault();
            }}
          >
            <CornerDownLeft className="h-4 w-4" />
            Arrow keys nudge · Enter confirms
          </button>

          <p className="rq-num text-[12px]" style={{ color: "var(--rq-text-faint)" }}>
            {draft === null
              ? `${index} of 4 placed`
              : `x ${draft.x.toFixed(3)} · y ${draft.y.toFixed(3)}`}
          </p>
        </div>
      </div>

      <Hairline />

      <div className="flex flex-col gap-3 px-5 py-5 sm:px-6">
        {error !== null ? (
          <p
            className="rounded-rq-sm border px-3 py-2.5 text-[13px] font-semibold"
            style={{
              borderColor: "var(--rq-danger)",
              background: "var(--rq-danger-soft)",
              color: "var(--rq-danger)",
            }}
          >
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2.5">
          {complete ? (
            <Button size="lg" onClick={submit} disabled={submitting} className="grow sm:grow-0">
              {submitting ? "Sending…" : "Start the analysis"}
            </Button>
          ) : (
            <Button
              size="lg"
              onClick={commit}
              disabled={draft === null || submitting}
              className="grow sm:grow-0"
            >
              <Check className="h-4 w-4" />
              {nextCell === undefined ? "Confirm" : `Confirm ${cellLabel(nextCell).toLowerCase()}`}
            </Button>
          )}
          <Button
            size="md"
            variant="outline"
            onClick={undo}
            disabled={points.length === 0 || submitting}
          >
            <Undo2 className="h-4 w-4" /> Undo
          </Button>
          <Button
            size="md"
            variant="ghost"
            onClick={startOver}
            disabled={(points.length === 0 && draft === null) || submitting}
          >
            <RotateCcw className="h-4 w-4" /> Start over
          </Button>
        </div>

        <ol className="mt-1 flex flex-wrap gap-x-4 gap-y-1.5">
          {CORNER_ORDER.map((cell, at) => (
            <li
              key={cell}
              className="flex items-center gap-2 text-[12.5px] font-semibold"
              style={{
                color:
                  at < index
                    ? "var(--rq-accent-text)"
                    : at === index
                      ? "var(--rq-text)"
                      : "var(--rq-text-faint)",
              }}
            >
              <span
                className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-extrabold"
                style={{
                  background: at < index ? "var(--rq-accent)" : "var(--rq-card-raised)",
                  color: at < index ? "var(--rq-on-accent)" : "var(--rq-text-faint)",
                  border: "1px solid var(--rq-line)",
                }}
              >
                {at + 1}
              </span>
              {cellLabel(cell)}
            </li>
          ))}
        </ol>
      </div>
    </Card>
  );
}

/** A committed corner: a numbered disc centred exactly on the placed point. */
function Marker({ x, y, label, title }: { x: number; y: number; label: string; title: string }) {
  return (
    <span
      className="pointer-events-none absolute inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-extrabold"
      title={title}
      style={{
        left: x - 12,
        top: y - 12,
        background: "var(--rq-overlay-a)",
        color: "var(--rq-overlay-casing)",
        boxShadow: "0 0 0 2px var(--rq-overlay-casing)",
      }}
    >
      {label}
    </span>
  );
}

/**
 * The pending corner: a long crosshair so the eye can line it up on both axes.
 *
 * Drawn in Optic with an ink casing, like the pose skeleton and for the same
 * reason — it lands on photographic frames and on the hatched margin, neither
 * of which follows the page theme, so a plain accent line vanishes on a pale
 * court floor and a plain dark line vanishes on a shadowed one.
 */
const CROSSHAIR_CASING = "0 0 0 1px color-mix(in srgb, var(--rq-overlay-casing) 55%, transparent)";

function Crosshair({ x, y, active }: { x: number; y: number; active: boolean }) {
  return (
    <span className="pointer-events-none absolute" style={{ left: x, top: y }}>
      <span
        className="absolute"
        style={{
          left: -40,
          top: -0.5,
          width: 80,
          height: 1,
          background: "var(--rq-overlay-a)",
          boxShadow: CROSSHAIR_CASING,
        }}
      />
      <span
        className="absolute"
        style={{
          left: -0.5,
          top: -40,
          width: 1,
          height: 80,
          background: "var(--rq-overlay-a)",
          boxShadow: CROSSHAIR_CASING,
        }}
      />
      <span
        className="absolute rounded-full"
        style={{
          left: -7,
          top: -7,
          width: 14,
          height: 14,
          border: "2px solid var(--rq-overlay-a)",
          boxShadow: CROSSHAIR_CASING,
          transform: active ? "scale(1.25)" : "scale(1)",
          transition: "transform 120ms var(--rq-ease)",
        }}
      />
    </span>
  );
}

/**
 * A magnified circle of the frame around the pending point. Built from the
 * same <img> URL as a scaled background, so there is no second decode and no
 * canvas — and points outside the picture simply show empty backing, which is
 * the honest rendering of "this corner is off frame".
 */
function Loupe({
  src,
  point,
  frameSize,
  imageSize,
  onLeft,
}: {
  src: string;
  point: Point;
  frameSize: Size;
  imageSize: Size;
  onLeft: boolean;
}) {
  const view = normalizedToView(point, frameSize, imageSize);
  if (view === null) return null;

  const scale = Math.min(frameSize.width / imageSize.width, frameSize.height / imageSize.height);
  const drawnWidth = imageSize.width * scale * LOUPE_ZOOM;
  const drawnHeight = imageSize.height * scale * LOUPE_ZOOM;
  // The point's offset INSIDE the drawn picture (frame-box coordinates minus
  // the letterbox bar), magnified — that is what has to land on the crosshair.
  const insideX = (view.x - (frameSize.width - imageSize.width * scale) / 2) * LOUPE_ZOOM;
  const insideY = (view.y - (frameSize.height - imageSize.height * scale) / 2) * LOUPE_ZOOM;

  return (
    <div
      className="pointer-events-none absolute z-10 overflow-hidden rounded-full"
      style={{
        width: LOUPE_PX,
        height: LOUPE_PX,
        top: 10,
        left: onLeft ? 10 : undefined,
        right: onLeft ? undefined : 10,
        border: "2px solid var(--rq-overlay-a)",
        boxShadow: "var(--rq-lift-shadow)",
        background: "var(--rq-court-floor)",
        backgroundImage: `url("${src}")`,
        backgroundRepeat: "no-repeat",
        backgroundSize: `${drawnWidth}px ${drawnHeight}px`,
        backgroundPosition: `${LOUPE_PX / 2 - insideX}px ${LOUPE_PX / 2 - insideY}px`,
      }}
    >
      <span
        className="absolute"
        style={{ left: 0, top: LOUPE_PX / 2, width: "100%", height: 1, background: "var(--rq-overlay-a)", opacity: 0.85 }}
      />
      <span
        className="absolute"
        style={{ top: 0, left: LOUPE_PX / 2, height: "100%", width: 1, background: "var(--rq-overlay-a)", opacity: 0.85 }}
      />
    </div>
  );
}
