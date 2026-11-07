"use client";

import {
  ArrowRight,
  BookOpen,
  CalendarClock,
  ChartColumnBig,
  Gauge,
  Globe,
  Paperclip,
  Route,
  ScanText,
} from "lucide-react";
import { features, featureStats } from "@/data/landingData";
import { SECTION_IDS } from "@/lib/constants";
import { useAuthModal } from "@/context/AuthModalContext";

const FALLBACK_ICON = Globe;

const ICON_MAP = {
  Globe,
  Paperclip,
  ScanText,
  Gauge,
  Route,
  CalendarClock,
  BookOpen,
  ChartColumnBig,
};

export default function FeaturesSection() {
  const { openRegister } = useAuthModal();

  return (
    <section id={SECTION_IDS.features} className="w-full scroll-mt-[5.5rem] bg-light">
      <div className="container-scbms py-16 lg:py-24">
        <div className="max-w-[702px]">
          <p className="eyebrow">Core Features</p>
          <h2 className="mt-4 font-heading text-3xl font-semibold tracking-tight text-navy dark:text-secondary sm:text-[40px] sm:leading-[1.15]">
            Everything a barangay Hall needs — without the paperwork
          </h2>
          <p className="mt-4 text-base leading-relaxed text-muted">
            A single digital workflow connects every person and committee in
            case handling. Every complaint, assessment, hearing, and resolution
            lives in one place — complete, audited, and easy to find.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-x-6 gap-y-14 sm:grid-cols-2 lg:mt-14 lg:grid-cols-4 lg:gap-y-16">
          {features.map((feature) => {
            const Icon = ICON_MAP[feature.icon] || FALLBACK_ICON;
            return (
              <figure
                key={feature.title}
                className="flex flex-col border-t-2 border-transparent transition-all duration-300 hover:border-t-secondary hover:shadow-soft"
              >
                <span className="mt-6 inline-flex h-11 w-11 items-center justify-center rounded-full border border-cardline text-3xl">
                  <Icon className="h-5 w-5 text-secondary" aria-hidden="true" />
                </span>
                <figcaption className="mt-4 font-heading text-lg font-semibold text-navy dark:text-secondary">
                  {feature.title}
                </figcaption>
                <p className="mt-2.5 text-sm leading-relaxed text-muted">
                  {feature.description}
                </p>
              </figure>
            );
          })}
        </div>

        {/* Gradient stat cards (from the Figma design) */}
        <div className="mt-12 grid grid-cols-1 gap-5 sm:grid-cols-2">
          {featureStats.map((stat) => (
            <div
              key={stat.value}
              className="rounded-[28px] bg-gradient-to-br from-secondary to-navy p-6 text-left shadow-float sm:p-8 lg:p-10"
            >
              <p className="flex min-h-[46px] items-end font-heading text-5xl font-semibold leading-none text-gold-soft">
                {stat.value}
              </p>
              <p className="mt-4 max-w-md text-sm leading-relaxed text-white/90">
                {stat.label}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-10 text-center">
          <button
            type="button"
            onClick={openRegister}
            className="group inline-flex items-center gap-2 text-sm font-semibold text-secondary transition-colors hover:text-navy dark:hover:text-secondary"
          >
            Try filing a complaint
            <ArrowRight
              className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
              aria-hidden="true"
            />
          </button>
        </div>
      </div>
    </section>
  );
}
