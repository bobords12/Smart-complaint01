import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ROUTES, SITE } from "@/lib/constants";

export default function AuthLayout({ children, maxWidthClass = "max-w-[476px]" }) {
  return (
    <main className="relative flex min-h-dvh w-full justify-center overflow-x-hidden bg-navy">
      {/* 
        BACKGROUND
        The Figma frame references image.png, which is not present in /public,
        so we render a navy-to-blue gradient with a subtle dotted, 
        government-style pattern and soft gold glows instead.
        REPLACE LATER: drop the official background into /public/auth-bg.png
        and swap these three divs for <Image fill src="/auth-bg.png" ... />
        (do not stretch or distort the image).
      */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(155deg,#0E2F5C_0%,#123F7C_46%,#1B4C8C_100%)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgba(240,206,126,0.1) 1px, transparent 0)",
          backgroundSize: "26px 26px",
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-24 -top-24 h-[360px] w-[360px] rounded-full bg-gold-soft/15 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-32 -left-24 h-[380px] w-[380px] rounded-full bg-jordy/15 blur-3xl"
      />

      <div className={`relative z-10 mx-auto w-full px-4 py-9 sm:px-6 sm:py-12 ${maxWidthClass}`}>
        <div className="flex min-h-[calc(100dvh-7.5rem)] w-full flex-col justify-center">
          <Link
            href={ROUTES.home}
            className="mb-5 inline-flex w-fit items-center gap-2 rounded text-sm font-semibold text-white/85 transition-colors hover:text-gold-soft focus-visible:text-gold-soft"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to Home
          </Link>
          {children}
        </div>

        <p className="mt-6 text-center text-[12.5px] leading-relaxed text-white/60">
          {SITE.name} — a capstone project of the College of Computer Studies,
          St. Peter&apos;s College.
        </p>
      </div>
    </main>
  );
}