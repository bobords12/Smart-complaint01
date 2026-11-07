import ResidentModal from "@/components/shared/ResidentModal";
import StatusBadge from "@/components/shared/StatusBadge";

export default function ComplaintDetailModal({ complaint, onClose }) {
  if (!complaint) return null;
  const complaintId = `complaint-detail-${complaint.caseNo}`;

  const meta = [
    { label: "Case Number", value: complaint.caseNo },
    { label: "Category", value: complaint.category },
    { label: "Priority", value: complaint.priority },
    { label: "Submitted", value: complaint.submittedOn },
  ];

  return (
    <ResidentModal
      open
      onClose={onClose}
      labelledBy={`${complaintId}-title`}
      title={complaint.title}
      maxWidthClass="max-w-lg"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <StatusBadge label={complaint.status} />
        <p className="text-[13px] text-muted">Case #{complaint.caseNo}</p>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        {meta.map((row) => (
          <div key={row.label} className="min-w-0">
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">
              {row.label}
            </dt>
            <dd className="mt-0.5 truncate text-sm font-semibold text-mirage">
              {row.value}
            </dd>
          </div>
        ))}
      </dl>

      <h3 className="mt-5 text-[13px] font-semibold uppercase tracking-wide text-muted">
        Details
      </h3>
      <p className="mt-1.5 text-sm leading-relaxed text-mirage">
        {complaint.summary}
      </p>

      <h3 className="mt-5 text-[13px] font-semibold uppercase tracking-wide text-muted">
        Updates
      </h3>
      <ol className="mt-2 space-y-3 border-l border-line pl-4">
        {complaint.updates.map((update, index) => (
          <li key={`${update.date}-${index}`} className="relative">
            <span
              aria-hidden="true"
              className="absolute -left-[21.5px] top-1.5 h-2 w-2 rounded-full border-2 border-white bg-secondary ring-1 ring-line"
            />
            <p className="text-[12px] font-semibold text-muted">{update.date}</p>
            <p className="mt-0.5 text-sm text-mirage">{update.note}</p>
          </li>
        ))}
      </ol>

      <p className="mt-5 rounded-xl bg-alt px-4 py-3 text-[13px] leading-relaxed text-secondary">
        Prototype detail view — complainant identity and other personal data are
        withheld from this sample.
      </p>
    </ResidentModal>
  );
}