"use client";

import toast from "react-hot-toast";
import Link from "next/link";
import Image from "next/image";
import { ArrowUp, MapPin } from "lucide-react";
import { RESIDENT_ROUTES, SECTION_IDS, SITE } from "@/lib/constants";
import { useAuthModal } from "@/context/AuthModalContext";

const residentServices = [
  { label: "File a Complaint", href: RESIDENT_ROUTES.newComplaint, type: "link" },
  { label: "My Complaints", href: RESIDENT_ROUTES.complaints, type: "link" },
  { label: "Hearings & Notices", href: RESIDENT_ROUTES.hearings, type: "link" },
  { label: "Help & FAQ", href: `#${SECTION_IDS.faq}`, type: "anchor" },
];

const informationLinks = [
  {
    label: "About the System",
    href: `#${SECTION_IDS.research}`,
    type: "anchor",
  },
  {
    label: "How It Works",
    href: `#${SECTION_IDS.features}`,
    type: "anchor",
  },
  {
    label: "Privacy Notice",
    href: `#${SECTION_IDS.commitments}`,
    type: "anchor",
  },
  {
    label: "Terms of Service",
    type: "notice",
    notice: "Terms of Service will be published before formal deployment.",
  },
  {
    label: "Authorized Staff Sign In",
    type: "login",
  },
];

const linkClassName =
  "text-sm text-white/75 underline-offset-4 transition-colors hover:text-gold-soft hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-soft";

function smoothScrollToTop() {
  const reduced =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
}

export default function Footer() {
  const { openLogin } = useAuthModal();

  const handleNotice = (message) => {
    toast.info(message);
  };

  return (
    <footer className="relative w-full overflow-hidden bg-navy text-white">
      {/* Decorative ABUNO wordmark */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute bottom-[-0.08em] left-1/2 z-0 w-max max-w-none -translate-x-1/2 select-none whitespace-nowrap font-heading text-[clamp(4.5rem,18vw,10.5rem)] font-bold leading-none tracking-tight text-white/[0.06]"
      >
        ABUNO
      </span>

      <div className="relative z-10 mx-auto w-full max-w-7xl px-4 pb-16 pt-8 sm:px-6 md:pb-20 md:pt-12 lg:px-8 lg:pb-24 lg:pt-16">
        <div className="grid grid-cols-1 gap-10 md:grid-cols-2 md:gap-8 lg:grid-cols-3 lg:gap-12">
          {/* Column 1 — System identity */}
          <div className="max-w-md">
            <div className="flex items-center gap-3">
              <Image
                src="/Abunoi.jpg"
                alt="Barangay Abuno logo"
                width={56}
                height={56}
                className="h-14 w-14 shrink-0 rounded-full object-contain"
              />
              <p className="font-heading text-lg font-bold leading-snug text-white">
                {SITE.name}
              </p>
            </div>

            <p className="mt-4 text-sm leading-relaxed text-white/70">
              File complaints, track case progress, and receive hearing updates
              online.
            </p>

            <address className="mt-4 not-italic">
              <span className="flex items-start gap-2 text-sm text-white/70">
                <MapPin
                  className="mt-0.5 h-4 w-4 shrink-0 text-gold-soft"
                  aria-hidden="true"
                />
                <span>Barangay Abuno, Iligan City</span>
              </span>
            </address>
          </div>

          {/* Column 2 — Resident Services */}
          <nav aria-label="Resident services" className="md:pt-1">
            <h2 className="font-heading text-sm font-bold uppercase tracking-[0.12em] text-gold-soft">
              Resident Services
            </h2>
            <ul className="mt-4 space-y-3">
              {residentServices.map((item) => (
                <li key={item.label}>
                  <Link href={item.href} className={linkClassName}>
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          {/* Column 3 — Information */}
          <nav aria-label="Footer information" className="md:pt-1">
            <h2 className="font-heading text-sm font-bold uppercase tracking-[0.12em] text-gold-soft">
              Information
            </h2>
            <ul className="mt-4 space-y-3">
              {informationLinks.map((item) => {
                if (item.type === "login") {
                  return (
                    <li key={item.label}>
                      <button
                        type="button"
                        onClick={openLogin}
                        className={`${linkClassName} text-left`}
                      >
                        {item.label}
                      </button>
                    </li>
                  );
                }

                if (item.type === "notice") {
                  return (
                    <li key={item.label}>
                      <button
                        type="button"
                        onClick={() => handleNotice(item.notice)}
                        className={`${linkClassName} text-left`}
                      >
                        {item.label}
                      </button>
                    </li>
                  );
                }

                return (
                  <li key={item.label}>
                    <Link href={item.href} className={linkClassName}>
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        </div>
      </div>

      {/* Bottom legal bar */}
      <div className="relative z-10 border-t border-white/10">
        <div className="mx-auto flex w-full max-w-7xl flex-col items-start justify-between gap-4 px-4 py-5 sm:px-6 md:flex-row md:items-center lg:px-8">
          <p className="text-sm text-white/60">
            © {new Date().getFullYear()} {SITE.name}
          </p>

          <div className="flex w-full items-center justify-between gap-4 md:w-auto md:justify-end">
            <p className="text-sm text-white/60">
              <span className="text-white/75">Capstone Project</span>
              <span className="mx-2 text-white/30" aria-hidden="true">
                ·
              </span>
              Barangay Abuno, Iligan City
            </p>

            <button
              type="button"
              onClick={smoothScrollToTop}
              aria-label="Back to top"
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/25 text-white/85 transition-colors hover:border-gold-soft hover:text-gold-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-soft"
            >
              <ArrowUp className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </footer>
  );
}
