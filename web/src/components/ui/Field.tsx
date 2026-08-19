import type { InputHTMLAttributes } from "react";

/**
 * The one text field, matching the ServerSettings input recipe: 44px target,
 * small radius, `--rq-line-2` border on the `--rq-input` surface.
 */
interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  id: string;
}

export function Field({ label, id, ...rest }: FieldProps) {
  return (
    <label htmlFor={id} className="flex flex-col gap-1.5">
      <span className="rq-label" style={{ color: "var(--rq-text-dim)" }}>
        {label}
      </span>
      <input
        id={id}
        className="min-h-[44px] w-full rounded-rq-sm border px-3 text-[15px]"
        style={{
          borderColor: "var(--rq-line-2)",
          background: "var(--rq-input)",
          color: "var(--rq-text)",
        }}
        {...rest}
      />
    </label>
  );
}
