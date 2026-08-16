/**
 * Contain-fit ("letterbox") geometry for the corner picker — pure and
 * unit-tested, because this mapping is the easiest thing in the flow to get
 * subtly wrong: the reference frame renders with `contentFit="contain"`, so
 * the drawn image is inset by bars either top/bottom (wide image in a tall
 * box) or left/right (tall image in a wide box). Corner taps must be measured
 * against the DRAWN image rect, not the view, or every coordinate sent to the
 * server is skewed by the bar width.
 *
 * All view-space values are in the same unit (layout points); normalized
 * values are 0..1 relative to the intrinsic image, origin top-left — exactly
 * what POST /jobs/{id}/corners expects.
 */

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Where a `contain`-fit image actually draws inside its container: scaled to
 * touch the container on its long side, centred on the other. Null when either
 * size is degenerate (layout not measured yet, image not loaded yet).
 */
export function containRect(container: Size, image: Size): Rect | null {
  if (container.width <= 0 || container.height <= 0) return null;
  if (image.width <= 0 || image.height <= 0) return null;
  const scale = Math.min(container.width / image.width, container.height / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  return {
    x: (container.width - width) / 2,
    y: (container.height - height) / 2,
    width,
    height,
  };
}

/**
 * A tap in container coordinates → normalized 0..1 image coordinates, or null
 * when the tap landed in a letterbox bar (or geometry is degenerate). Edges
 * are inclusive so a corner tapped exactly on the image boundary maps to 0/1.
 */
export function tapToNormalized(tap: Point, container: Size, image: Size): Point | null {
  const rect = containRect(container, image);
  if (rect === null) return null;
  const x = (tap.x - rect.x) / rect.width;
  const y = (tap.y - rect.y) / rect.height;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { x, y };
}

/** A normalized image point → container coordinates, for rendering markers. */
export function normalizedToView(point: Point, container: Size, image: Size): Point | null {
  const rect = containRect(container, image);
  if (rect === null) return null;
  return { x: rect.x + point.x * rect.width, y: rect.y + point.y * rect.height };
}
