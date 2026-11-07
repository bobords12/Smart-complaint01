import {
  Bot,
  Eye,
  HeartHandshake,
  Lock,
  Scale,
  ShieldCheck,
} from "lucide-react";
import { aiStatementPoints, commitments } from "@/data/landingData";
import { SECTION_IDS } from "@/lib/constants";

const FALLBACK_ICON = ShieldCheck;

const ICON_MAP = {
  ShieldCheck,
  Lock,
  Eye,
  HeartHandshake,
  Scale,
};

export default function CommitmentsSection() {
  return (
    <section
      id={SECTION_IDS.commitments}
      className="w-full scroll-mt-[5.5rem] bg-alt"
    >
      <div className="container-scbms py-16 lg:py-24">
        <div className="max-w-[702px]">
          <p className="eyebrow">Our Commitments</p>
          <h2 className="mt-4 font-heading text-3xl font-semibold tracking-tight text-navy dark:text-secondary sm:text-[40px] sm:leading-[1.15]">
            Built on trust, privacy, and transparency
          </h2>
          <p className="mt-4 text-base leading-relaxed text-muted">
            Blotter entries contain sensitive facts. That is why every
            safeguard in this system starts with the people who handle them.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3 lg:gap-y-14">
          {commitments.map((item) => {
            const Icon = ICON_MAP[item.icon] || FALLBACK_ICON;
            return (
              <div key={item.title} className="flex flex-col">
                <span className="flex h-11 w-11 items-center justify-center rounded-full border border-secondary bg-white dark:bg-alt">
                  <Icon className="h-5 w-5 text-secondary" aria-hidden="true" />
                </span>
                <h3 className="mt-4 font-heading text-lg font-semibold text-navy dark:text-secondary">
                  {item.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  {item.description}
                </p>
              </div>
            );
          })}

          {/* Responsible AI card */}
          <div className="flex flex-col rounded-[18px] border border-gold/40 bg-gradient-to-br from-secondary to-navy p-5">
            <span className="flex h-11 w-11 items-center justify-center rounded-full border border-gold-soft/60 bg-white/10">
              <Bot className="h-5 w-5 text-gold-soft" aria-hidden="true" />
            </span>
            <h3 className="mt-4 font-heading text-lg font-semibold text-white">
              Responsible AI
            </h3>
            <ul className="mt-2 space-y-1.5 text-sm leading-relaxed text-white/85">
              {aiStatementPoints.map((point) => (
                <li key={point} className="flex gap-2">
                  <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-gold-soft" aria-hidden="true" />
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}