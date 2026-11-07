import { Layers } from "lucide-react";
import { SITE } from "@/lib/constants";
import { techStack } from "@/data/landingData";

export default function TechStrip() {
  return (
    <section
      aria-label="Built with"
      className="w-full border-b border-line bg-white dark:bg-alt"
    >
      <div className="container-scbms flex flex-col items-center gap-5 px-4 py-8 lg:flex-row lg:gap-10">
        <p className="flex shrink-0 items-center gap-2 text-xs font-bold uppercase tracking-[1.28px] text-muted">
          <Layers className="h-4 w-4 text-gold" aria-hidden="true" />
          Built With
        </p>
        <ul className="flex flex-wrap items-center justify-center gap-x-9 gap-y-3">
          {techStack.map((tech) => (
            <li
              key={tech}
              className="font-heading text-sm font-semibold text-secondary"
            >
              {tech}
            </li>
          ))}
        </ul>
        <p className="sr-only">{SITE.name}</p>
      </div>
    </section>
  );
}