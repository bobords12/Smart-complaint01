export default function Loading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-[65vh] items-center justify-center bg-light"
    >
      <div className="flex flex-col items-center gap-4">
        <span
          aria-hidden="true"
          className="h-11 w-11 animate-spin rounded-full border-4 border-alt border-t-secondary"
        />
        <p className="text-sm text-muted">
          Loading Smart Complaint &amp; Blotter Management System…
        </p>
      </div>
      <span className="sr-only">Loading the page, please wait.</span>
    </div>
  );
}