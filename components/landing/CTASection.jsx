"use client";

import { ArrowRight, Sparkles } from "lucide-react";
import { SITE } from "@/lib/constants";
import { useAuthModal } from "@/context/AuthModalContext";

export default function CTASection() {
  const { openRegister, openLogin } = useAuthModal();

  return (
    <section className="w-full bg-light px-4 pb-16 lg:pb-24">
      <div className="container-scbms">
        <div className="relative overflow-hidden rounded-[32px] bg-gradient-to-br from-secondary to-navy px-6 py-16 text-center shadow-float sm:px-12 lg:py-24">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-24 left-1/2 h-72 w-[640px] -translate-x-1/2 rounded-full bg-gold-soft/15 blur-3xl"
          />

          <p className="eyebrow">{SITE.barangay}</p>

          <h2 className="mx-auto mt-4 max-w-[720px] font-heading text-3xl font-semibold leading-tight tracking-tight text-white sm:text-4xl lg:text-[46px] lg:leading-[1.12]">
            Help us build a better Barangay{" "}
            {SITE.barangay.split(" ")[1]}, one case at a time
          </h2>

          <p className="mx-auto mt-5 max-w-[540px] text-base leading-relaxed text-white/80">
            File a complaint online or through the kiosk, or log in to follow
            an ongoing case. Everything stays private, tracked, and secure.
          </p>

          <div className="mt-9 flex flex-col items-center justify-center gap-3.5 sm:flex-row">
            <button
              type="button"
              onClick={openRegister}
              className="group inline-flex w-full items-center justify-center gap-2 rounded-full bg-white px-7 py-[13px] text-sm font-semibold text-navy shadow-button transition-colors hover:bg-gold-soft sm:w-auto"
            >
              File a Complaint
              <ArrowRight
                className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </button>
            <button
              type="button"
              onClick={openLogin}
              className="inline-flex w-full items-center justify-center rounded-full border border-white/60 px-7 py-[13px] text-sm font-semibold text-white transition-colors hover:border-white hover:bg-white/10 sm:w-auto"
            >
              Login
            </button>
          </div>

          <div className="mt-8 flex items-center justify-center gap-2 text-[13px] text-white/70">
            <Sparkles className="h-3.5 w-3.5 text-gold-soft" aria-hidden="true" />
            <span>Now piloting at Barangay Abuno Hall, {SITE.city}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
