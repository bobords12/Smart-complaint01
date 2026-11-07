export default function EmptyState({ title, message, icon: Icon, children }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
      {Icon ? (
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-info-soft">
          <Icon className="h-6 w-6 text-secondary" aria-hidden="true" />
        </span>
      ) : null}
      <p className="mt-3 text-sm font-semibold text-navy dark:text-secondary">{title}</p>
      {message ? (
        <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-muted">
          {message}
        </p>
      ) : null}
      {children ? <div className="mt-4">{children}</div> : null}
    </div>
  );
}