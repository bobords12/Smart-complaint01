const TONES = {
  blue: "bg-info-soft text-secondary ring-info-soft",
  green: "bg-success-soft text-success ring-success-soft",
  red: "bg-critical-soft text-critical ring-critical-soft",
  orange: "bg-warning-soft text-warning ring-warning-soft",
  violet: "bg-[#714bd8]/10 text-[#714bd8] ring-[#714bd8]/20",
  neutral: "bg-alt text-muted ring-alt",
};

const DOT_COLORS = {
  blue: "bg-secondary",
  green: "bg-success",
  red: "bg-critical",
  orange: "bg-warning",
  violet: "bg-[#714bd8]",
  neutral: "bg-muted",
};

const TONE_BY_LABEL = {
  "Pending Review": "orange",
  "For Official Categorization": "violet",
  Received: "blue",
  "In Progress": "blue",
  "Awaiting Meeting": "orange",
  Resolved: "green",
  Closed: "neutral",
  Rejected: "red",
  Critical: "red",
  High: "orange",
  Normal: "neutral",
  Civil: "blue",
  Criminal: "red",
  Administrative: "neutral",
  Upcoming: "blue",
  Completed: "green",
  Rescheduled: "orange",
  Cancelled: "neutral",
};

export default function StatusBadge({ label, className = "" }) {
  const tone = TONE_BY_LABEL[label] ?? "neutral";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold ring-1 ring-inset ${TONES[tone]} ${className}`}
    >
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full ${DOT_COLORS[tone]}`}
      />
      {label}
    </span>
  );
}