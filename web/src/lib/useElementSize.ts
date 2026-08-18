import { useCallback, useEffect, useRef, useState } from "react";

export interface Size {
  width: number;
  height: number;
}

/**
 * The live border-box size of an element, via ResizeObserver.
 *
 * Both the corner picker and the pose overlay map normalized coordinates onto
 * a rendered box, so they need the box's real size — not a guess from the
 * viewport — and they need it again on every rotation, split-screen resize and
 * font-driven reflow. A stale size here means marks and skeletons drawn in the
 * wrong place, which is why this measures rather than assumes.
 */
export function useElementSize<T extends HTMLElement>(): [
  (node: T | null) => void,
  Size | null,
  T | null,
] {
  const [size, setSize] = useState<Size | null>(null);
  const [node, setNode] = useState<T | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);

  const ref = useCallback((next: T | null) => setNode(next), []);

  useEffect(() => {
    observerRef.current?.disconnect();
    if (node === null) {
      setSize(null);
      return;
    }
    const measure = () => {
      const rect = node.getBoundingClientRect();
      setSize((current) =>
        current !== null && current.width === rect.width && current.height === rect.height
          ? current
          : { width: rect.width, height: rect.height },
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    observerRef.current = observer;
    return () => observer.disconnect();
  }, [node]);

  return [ref, size, node];
}
