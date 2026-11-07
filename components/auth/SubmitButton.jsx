import { Loader2 } from "lucide-react";

export default function SubmitButton({
  children,
  loading = false,
  loadingText,
  ...props
}) {
  return (
    <button
      type="submit"
      disabled={loading}
      aria-busy={loading}
      className="relative inline-flex w-full items-center justify-center gap-2 rounded-[10px] bg-secondary px-6 py-3.5 font-heading text-[15px] font-bold text-white shadow-[0_6px_20px_-8px_rgba(27,76,140,0.8)] transition-colors hover:bg-navy active:bg-navy focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary disabled:cursor-not-allowed disabled:opacity-60"
      {...props}
    >
      {loading ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          {loadingText}
        </>
      ) : (
        children
      )}
    </button>
  );
}