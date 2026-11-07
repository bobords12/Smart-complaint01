import { PencilLine, Info } from "lucide-react";
import { composeFullName, formatMobile } from "@/lib/kiosk/validation";

/**
 * Step 2 — Confirm details.
 *
 * A read-only confirmation, not an editing screen. Each card has its own
 * labelled Edit button that returns to the identity step with everything
 * else intact, which is the only reason this screen can be trusted: the
 * citizen sees exactly what will be stored, in the three terms the
 * reference design uses.
 *
 * The mobile notice is worded carefully. It says status updates MAY be
 * sent to the number. It does not say an SMS was sent, because no
 * messaging provider is wired up and claiming otherwise would be a lie
 * the citizen finds out about later.
 */
export default function KioskConfirmStep({ t, form, onEdit }) {
  const name = composeFullName(form.complainant);
  const address = [
    form.complainant.houseStreet,
    form.complainant.purok,
    "Abuno",
    "Iligan City",
  ]
    .map((part) => (part || "").trim())
    .filter(Boolean)
    .join(", ");

  return (
    <div>
      <header className="mb-5 text-center">
        <h1 className="text-[21px] font-bold leading-tight tracking-tight text-navy sm:text-[24px]">
          {t("confirm.title")}
        </h1>
        <p className="mt-1.5 text-[15px] font-semibold text-muted">
          {t("confirm.subtitle")}
        </p>
      </header>

      <div className="space-y-3">
        <SummaryCard
          label={t("confirm.name")}
          value={name}
          onEdit={() => onEdit("identity")}
          editLabel={t("confirm.edit")}
          fieldLabel={t("confirm.name")}
        />

        <SummaryCard
          label={t("confirm.mobile")}
          value={formatMobile(form.complainant.mobile)}
          onEdit={() => onEdit("identity")}
          editLabel={t("confirm.edit")}
          fieldLabel={t("identity.mobile")}
        />

        <SummaryCard
          label={t("confirm.address")}
          value={address}
          onEdit={() => onEdit("identity")}
          editLabel={t("confirm.edit")}
          fieldLabel={t("identity.address")}
        />
      </div>

      <p className="mt-5 flex items-start gap-2.5 rounded-[12px] border border-line bg-alt/70 p-3.5 text-[13px] leading-relaxed text-mirage">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-secondary" aria-hidden="true" />
        <span>{t("confirm.notice")}</span>
      </p>
    </div>
  );
}

/**
 * One read-only summary row.
 *
 * The Edit control is a real <button> with an accessible name that
 * includes WHICH field it edits, e.g. "Edit Full Name". A row of bare
 * pencil icons is unusable with a screen reader and ambiguous at a
 * glance.
 */
function SummaryCard({ label, value, onEdit, editLabel, fieldLabel, t }) {
  return (
    <div className="kiosk-card kiosk-card-pad flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-[11.5px] font-bold uppercase tracking-[0.08em] text-muted">
          {label}
        </p>
        <p className="mt-1 break-words text-[15px] font-semibold leading-snug text-mirage">
          {value || "—"}
        </p>
      </div>

      <button
        type="button"
        onClick={onEdit}
        aria-label={`${editLabel} ${fieldLabel}`}
        className="kiosk-btn kiosk-btn-ghost min-h-[40px] shrink-0 px-3.5 text-[13px]"
      >
        <PencilLine className="h-3.5 w-3.5" aria-hidden="true" />
        {editLabel}
      </button>
    </div>
  );
}