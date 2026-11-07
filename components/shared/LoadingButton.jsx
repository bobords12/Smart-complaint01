import { Loader2 } from "lucide-react";

export default function LoadingButton({
  children,
  isLoading = false,
  disabled = false,
  className = "",
  ...props
}) {
  return (
    <button
      type="submit"
      disabled={disabled || isLoading}
      className={`inline-flex items-center justify-center gap-2 rounded-full bg-jordy px-7 py-3 text-sm font-semibold text-white shadow-button transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-70 ${className}`}
      {...props}
    >
      {isLoading ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          {children}
        </>
      ) : (
        children
      )}
    </button>
  );
}