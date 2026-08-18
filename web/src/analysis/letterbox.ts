/**
 * Contain-fit ("letterbox") geometry — ported from the app's
 * `src/features/analysis/letterbox.ts`. Both the corner picker and the pose
 * overlay draw their media with `object-fit: contain`, so the picture is inset
 * by bars either top/bottom (a wide image in a tall box) or left/right. Every
 * coordinate must be measured against the DRAWN rect, not the element box, or
 * the whole overlay sits off the players by the width of a bar.
 *
 * One deliberate divergence from the app. The app's `tapToNormalized` returns
 * null for a tap in a letterbox bar, because on a phone that is almost always
 * a fat-finger miss. The web picker also needs the OPPOSITE behaviour: the
 * server's contract says court corners "may fall outside 0..1 because court
 * corners can sit outside the camera frame", and on a wide-angle club recording
 * the back corners routinely do. So `tapToNormalizedUnclamped` exists alongside
 * it and never clamps, never rejects — a click 12% past the left edge is a
 * legitimate -0.12, and the picker deliberately renders a margin of dead space
 * around the frame so there is somewhere to put it.
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
 * A point in container coordinates → normalized image coordinates, or null
 * when the point landed in a letterbox bar (or geometry is degenerate). Edges
 * are inclusive so a corner clicked exactly on the image boundary maps to 0/1.
 */
export function tapToNormalized(tap: Point, container: Size, image: Size): Point | null {
  const normalized = tapToNormalizedUnclamped(tap, container, image);
  if (normalized === null) return null;
  const { x, y } = normalized;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  return normalized;
}

/**
 * The same mapping with no bounds check: values outside 0..1 mean "off the
 * edge of the frame", which the corners endpoint accepts and the homography
 * needs. Null only when the geometry itself is unusable.
 */
export function tapToNormalizedUnclamped(
  tap: Point,
  container: Size,
  image: Size,
): Point | null {
  const rect = containRect(container, image);
  if (rect === null) return null;
  return { x: (tap.x - rect.x) / rect.width, y: (tap.y - rect.y) / rect.height };
}

/**
 * A normalized image point → container coordinates, for rendering markers.
 * Off-frame inputs come back as off-image container points, by design: the
 * marker for a corner at -0.12 must draw to the left of the picture, exactly
 * where the user put it.
 */
export function normalizedToView(point: Point, container: Size, image: Size): Point | null {
  const rect = containRect(container, image);
  if (rect === null) return null;
  return { x: rect.x + point.x * rect.width, y: rect.y + point.y * rect.height };
}
