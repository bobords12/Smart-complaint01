"use client";

export default function WelcomeSection() {
  return (
    <section aria-labelledby="welcome-heading">
      <h1
        id="welcome-heading"
        className="font-heading text-2xl font-semibold tracking-tight text-navy dark:text-secondary sm:text-3xl"
      >
        Resident Dashboard
      </h1>
      <p className="mt-1 text-sm text-muted">
        Monitor your complaints, hearings, and recent updates.
      </p>
    </section>
  );
}
