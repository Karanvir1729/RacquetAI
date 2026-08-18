import { Moon, Sun } from "lucide-react";

import { useTheme } from "@/theme/ThemeProvider";

/**
 * The Sun/Moon switch. Dark is RacquetIQ's default, not a mode — match footage
 * lives better on ink — but light is fully specified, so the switch is real.
 */
export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      className="flex h-11 w-11 items-center justify-center rounded-rq-sm border transition-transform duration-200 ease-rq hover:scale-105"
      style={{
        borderColor: "var(--rq-line)",
        background: "var(--rq-card)",
        color: "var(--rq-text)",
      }}
    >
      {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </button>
  );
}
