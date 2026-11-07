"use client";

import { useState } from "react";
import { ChevronDown, MessageCircleQuestion } from "lucide-react";
import { faqs } from "@/data/landingData";
import { SECTION_IDS } from "@/lib/constants";

export default function FAQSection() {
  const [openIndex, setOpenIndex] = useState(null);

  return (
    <section
      id={SECTION_IDS.faq}
      aria-labelledby="faq-heading"
      className="w-full scroll-mt-[5.5rem] bg-light"
    >
      <div className="container-scbms py-16 lg:py-24">
        <div className="max-w-[702px]">
          <p className="eyebrow">Frequently Asked Questions</p>
          <h2
            id="faq-heading"
            className="mt-4 font-heading text-3xl font-semibold tracking-tight text-navy dark:text-secondary sm:text-[40px] sm:leading-[1.15]"
          >
            Answers before you even ask
          </h2>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-5 lg:grid-cols-2">
          {faqs.map((item, index) => {
            const isOpen = openIndex === index;
            return (
              <div key={item.question} className="shrink-0">
                <h3>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={`faq-panel-${index}`}
                    id={`faq-trigger-${index}`}
                    onClick={() =>
                      setOpenIndex((current) =>
                        current === index ? null : index
                      )
                    }
                    className={`flex w-full items-center justify-between gap-4 rounded-[20px] border px-5 py-4 text-left transition-colors ${
                      isOpen
                        ? "border-secondary bg-white dark:bg-alt shadow-soft"
                        : "border-line bg-white dark:bg-alt hover:border-secondary"
                    }`}
                  >
                    <span className="text-[15px] font-semibold leading-snug text-navy dark:text-secondary">
                      {item.question}
                    </span>
                    <ChevronDown
                      className={`h-4 w-4 shrink-0 text-secondary transition-transform duration-300 ${
                        isOpen ? "rotate-180" : ""
                      }`}
                      aria-hidden="true"
                    />
                  </button>
                </h3>
                <div
                  id={`faq-panel-${index}`}
                  role="region"
                  aria-labelledby={`faq-trigger-${index}`}
                  className="grid transition-[grid-template-rows] duration-300 ease-out"
                  style={{
                    gridTemplateRows: isOpen ? "1fr" : "0fr",
                  }}
                >
                  <div className="overflow-hidden">
                    <div className="px-5 pb-5 pt-3 text-sm leading-relaxed text-muted">
                      {item.answer}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <p className="mt-12 flex items-start justify-start gap-2 text-sm text-muted">
          <MessageCircleQuestion className="mt-0.5 h-4 w-4 shrink-0 text-gold" aria-hidden="true" />
          <span>
            Something else on your mind about how the system works or how a
            case moves from filing to resolution?
            <a
              href="mailto:support@scbms.local?subject=Landing%20page%20question"
              className="font-semibold text-secondary underline decoration-alt underline-offset-4 transition-colors hover:text-navy dark:hover:text-secondary"
            >
              Ask us
            </a>
            — and see it in the FAQ.
          </span>
        </p>
      </div>
    </section>
  );
}