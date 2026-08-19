import type { InputHTMLAttributes } from "react";

/**
 * The one text field, matching the ServerSettings input recipe: 44px target,
 * small radius, `--rq-line-2` border on the `--rq-input` surface.
 *
 * `error` is the field's own problem, not the form's: it renders under the
 * input and is wired to it with aria-invalid + aria-describedby, so a screen
 * reader reads the fault with the field rather than as a loose sentence.
 */
interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  id: string;
  error?: string;
}

export function Field({ label, id, error, ...rest }: FieldProps) {
  const errorId = `${id}-error`;

  return (
    <label htmlFor={id} className="flex flex-col gap-1.5">
      <span className="rq-label" style={{ color: "var(--rq-text-dim)" }}>
        {label}
      </span>
      <input
        id={id}
        className="min-h-[44px] w-full rounded-rq-sm border px-3 text-[15px]"
        style={{
          borderColor: error === undefined ? "var(--rq-line-2)" : "var(--rq-danger)",
          background: "var(--rq-input)",
          color: "var(--rq-text)",
        }}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={error === undefined ? undefined : errorId}
        {...rest}
      />
      {error !== undefined ? (
        <span id={errorId} className="rq-caption" style={{ color: "var(--rq-danger)" }}>
          {error}
        </span>
      ) : null}
    </label>
  );
}
