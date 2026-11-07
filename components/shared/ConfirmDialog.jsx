import ResidentModal from "@/components/shared/ResidentModal";
import LoadingButton from "@/components/shared/LoadingButton";

export default function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = "Confirm",
  busy = false,
  children,
}) {
  return (
    <ResidentModal
      open={open}
      onClose={onClose}
      labelledBy="confirm-dialog-title"
      title={title}
      maxWidthClass="max-w-md"
    >
      <p className="text-sm leading-relaxed text-muted">{message}</p>
      {children}
      <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="inline-flex h-11 items-center justify-center rounded-full border border-line px-5 text-sm font-semibold text-mirage transition-colors hover:bg-alt disabled:opacity-60"
        >
          Cancel
        </button>
        <LoadingButton isLoading={busy} onClick={onConfirm} disabled={busy}>
          {confirmLabel}
        </LoadingButton>
      </div>
    </ResidentModal>
  );
}