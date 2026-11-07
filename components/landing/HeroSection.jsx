"use client";

import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { ROUTES, SECTION_IDS, SITE } from "@/lib/constants";
import { useAuthModal } from "@/context/AuthModalContext";
import DashboardPreview from "@/components/landing/DashboardPreview";

export default function HeroSection() {
  const { openRegister } = useAuthModal();

  return (
    <section className="relative w-full overflow-hidden bg-alt">
      {/* Soft background glows */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-32 left-1/2 h-[420px] w-[820px] -translate-x-1/2 rounded-full bg-secondary/20 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute right-[-180px] top-40 h-[300px] w-[380px] rounded-full bg-gold/20 blur-3xl"
      />

      <div className="container-scbms relative pb-16 pt-12 text-center sm:pt-16 lg:pb-20">
        <p className="eyebrow">{SITE.heroLabel}</p>

        <h1 className="mx-auto mt-5 max-w-[1021px] font-heading text-4xl font-semibold leading-[1.08] tracking-tight text-navy dark:text-secondary sm:text-5xl lg:text-[62px] lg:leading-[1.05]">
          Smart Complaint &amp; Blotter Management for Barangay Halls with{" "}
          <span className="relative inline-block rounded-2xl bg-gold/25 px-2.5 text-navy dark:text-secondary lg:whitespace-nowrap lg:px-4">
            Automatic Case Categorization
          </span>
        </h1>

        <p className="mx-auto mt-6 max-w-[540px] text-base leading-relaxed text-muted sm:text-lg">
          {SITE.tagline.replace(
            "Smart Complaint and Blotter Management",
            "File digitally. Track every step"
          )}{" "}
          of your case from anywhere in Barangay {SITE.barangay.split(" ")[1]} —
          from filing to settlement.
        </p>

        <div className="mt-9 flex flex-col items-center justify-center gap-3.5 sm:flex-row">
          <button
            type="button"
            onClick={openRegister}
            className="group inline-flex w-full items-center justify-center gap-2 rounded-full bg-jordy px-7 py-[13px] text-sm font-semibold text-white shadow-button transition-colors hover:bg-secondary sm:w-auto"
          >
            File a Complaint
            <ArrowRight
              className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
              aria-hidden="true"
            />
          </button>
          <a
            href={`#${SECTION_IDS.features}`}
            className="inline-flex w-full items-center justify-center rounded-full border border-navy px-7 py-[13px] text-sm font-semibold text-navy dark:border-secondary dark:text-secondary transition-colors hover:bg-navy hover:text-white dark:hover:bg-secondary sm:w-auto"
          >
            Know More
          </a>
        </div>

        <div className="mt-7 inline-flex items-center gap-2 rounded-full border border-line bg-white dark:bg-alt px-4 py-2 text-[13px] text-mirage">
          <Sparkles className="h-3.5 w-3.5 text-gold" aria-hidden="true" />
          <span className="font-semibold text-navy dark:text-secondary">NLP-Powered</span>
          <span className="text-muted">— Naive Bayes case classification</span>
        </div>

        <DashboardPreview />
      </div>
    </section>
  );
}
