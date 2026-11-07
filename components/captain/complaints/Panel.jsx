"use client";

export default function Panel({
  title,
  tag,
  tagClass = "bg-alt text-muted",
  actions,
  children,
  className = "",
}) {
  return (
    <section className={`rounded-2xl border border-line bg-white shadow-soft ${className}`}>
      {title || actions ? (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            {title ? (
              <h3 className="font-heading text-sm font-semibold text-navy">{title}</h3>
            ) : null}
            {tag ? (
              <span
                className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${tagClass}`}
              >
                {tag}
              </span>
            ) : null}
          </div>
          {actions}
        </header>
      ) : null}
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}