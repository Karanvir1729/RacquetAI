import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Link } from "react-router-dom";

import { cn } from "@/lib/cn";

/**
 * The one button. Four variants, three sizes, and never a literal colour —
 * every surface reads a `--rq-*` token, so light mode and any re-skin come free.
 *
 * `primary` is an Optic fill carrying Court Ink text (`--rq-on-accent`), which
 * is the app's rule: an accent fill ALWAYS carries ink text, never Chalk.
 *
 * Every size clears the 44px HIG tap target — `sm` included, because this site
 * has to be usable with a thumb.
 */

export type ButtonVariant = "primary" | "secondary" | "outline" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

const BASE =
  "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap font-extrabold " +
  "transition-[transform,background-color,border-color,opacity] duration-200 ease-rq " +
  "active:scale-[0.985] disabled:pointer-events-none disabled:opacity-50";

const SIZES: Record<ButtonSize, string> = {
  sm: "min-h-[44px] rounded-rq-sm px-4 text-[14px]",
  md: "min-h-[48px] rounded-rq-md px-5 text-[15px]",
  lg: "min-h-[56px] rounded-rq-lg px-7 text-[17px]",
};

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-rq-accent text-rq-on-accent hover:brightness-105",
  secondary: "bg-rq-accent-soft text-rq-accent-text hover:brightness-110",
  outline: "border border-rq-line2 bg-rq-card text-rq-text hover:border-rq-accent",
  ghost: "text-rq-dim hover:text-rq-text",
};

export function buttonClass(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  className?: string,
): string {
  return cn(BASE, SIZES[size], VARIANTS[variant], className);
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", className, children, type = "button", ...rest },
  ref,
) {
  return (
    <button ref={ref} type={type} className={buttonClass(variant, size, className)} {...rest}>
      {children}
    </button>
  );
});

interface ButtonLinkProps {
  to: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: ReactNode;
  /** Anchors (`#how`) and external URLs render as <a>; routes use <Link>. */
  external?: boolean;
  onClick?: () => void;
  "aria-label"?: string;
}

export function ButtonLink({
  to,
  variant = "primary",
  size = "md",
  className,
  children,
  external,
  onClick,
  ...rest
}: ButtonLinkProps) {
  const classes = buttonClass(variant, size, className);
  const isAnchorOrUrl = external || to.startsWith("#") || /^https?:/.test(to) || to.startsWith("mailto:");

  if (isAnchorOrUrl) {
    return (
      <a
        href={to}
        className={classes}
        onClick={onClick}
        {...(/^https?:/.test(to) ? { target: "_blank", rel: "noreferrer" } : {})}
        {...rest}
      >
        {children}
      </a>
    );
  }

  return (
    <Link to={to} className={classes} onClick={onClick} {...rest}>
      {children}
    </Link>
  );
}
