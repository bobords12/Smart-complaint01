import { AlertTriangle, GraduationCap } from "lucide-react";
import { researchStats } from "@/data/landingData";
import { SECTION_IDS } from "@/lib/constants";

export default function ResearchBasisSection() {
  return (
    <section
      id={SECTION_IDS.research}
      className="w-full scroll-mt-[5.5rem] bg-white dark:bg-alt"
    >
      <div className="container-scbms py-16 lg:py-24">
        <div className="max-w-[702px]">
          <p className="eyebrow">Research Basis</p>
          <h2 className="mt-4 font-heading text-3xl font-semibold tracking-tight text-navy dark:text-secondary sm:text-[40px] sm:leading-[1.15]">
            Numbers that guide the design
          </h2>
          <p className="mt-4 text-base leading-relaxed text-muted">
            The feature set and expected performance are grounded in comparable
            studies on NLP-based public complaint systems.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {researchStats.map((stat) => (
            <div
              key={stat.metric}
              className="rounded-[22px] border border-line bg-light p-6 shadow-feather sm:p-7"
            >
              <p className="font-heading text-4xl font-semibold tracking-tight text-secondary sm:text-5xl">
                {stat.metric}
              </p>
              <p className="mt-3 text-sm leading-relaxed text-muted">
                {stat.description}
              </p>
              {stat.placeholderNote ? (
                <p className="mt-4 flex items-start gap-1.5 rounded-md border border-gold/40 bg-gold/10 px-3 py-2 text-[11px] font-medium text-secondary">
                  <AlertTriangle
                    className="mt-0.5 h-3 w-3 shrink-0 text-gold"
                    aria-hidden="true"
                  />
                  <span>{stat.placeholderNote}</span>
                </p>
              ) : null}
            </div>
          ))}
        </div>

        <p className="mt-10 flex items-start gap-2 text-[13px] leading-relaxed text-muted">
          <GraduationCap className="mt-0.5 h-4 w-4 shrink-0 text-gold" aria-hidden="true" />
          <span>
            Figures shown are working targets for the study during the
            Jan–Jun 2026 pilot. The accuracy estimate will be replaced by a
            verified, cited source before final submission.
          </span>
        </p>
      </div>
    </section>
  );
}