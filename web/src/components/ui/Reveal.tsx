import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";

/**
 * Section entrances. The whole motion vocabulary of this site is: things rise
 * 22px into place, once, as you reach them. Stagger a grid with `delay={i * 0.08}`.
 *
 * Motion always has a reason (Daybot's rule) — and `prefers-reduced-motion`
 * turns it off completely rather than merely shortening it.
 */
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const reduced = useReducedMotion();

  if (reduced) return <div className={className}>{children}</div>;

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 22 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1], delay }}
    >
      {children}
    </motion.div>
  );
}
