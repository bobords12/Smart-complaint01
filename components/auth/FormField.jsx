import { AlertCircle } from "lucide-react";

export const baseInputClass =
  "w-full rounded-[10px] border bg-light px-3.5 py-[11px] text-sm text-mirage outline-none transition-[border-color,box-shadow,background-color] duration-150 placeholder:text-muted/60 disabled:cursor-not-allowed disabled:opacity-60";

export const normalInputClass = `${baseInputClass} border-line focus:border-secondary focus:ring-2 focus:ring-secondary/25`;

export const errorInputClass = `${baseInputClass} border-critical focus:border-critical focus:ring-2 focus:ring-critical/25`;

export default function FormField({
  id,
  label,
  required = false,
  optional = false,
  error,
  hint,
  children,
}) {
  const errorId = `${id}-error`;
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[13px] font-semibold text-mirage">
        {label}
        {required ? (
          <span aria-hidden="true" className="ml-0.5 text-critical">
            *
          </span>
        ) : null}
        {optional ? (
          <span className="font-normal text-muted"> (optional)</span>
        ) : null}
        {hint ? <span className="font-normal text-muted">{hint}</span> : null}
      </label>
      {children}
      {error ? (
        <p id={errorId} className="mt-1.5 flex items-start gap-1.5 text-[12.5px] font-medium leading-snug text-critical">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}