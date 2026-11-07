"use client";

import { useRouter } from "next/navigation";
import { FilePlus2, HelpCircle, QrCode, ReceiptText, ShieldCheck } from "lucide-react";

import { useKioskLanguage } from "@/hooks/useKioskSession";

/**
 * Screen 18b — Complaint tracking guidance.
 *
 * This is the screen the home page's "Track Your Complaint" action leads
 * to. It is deliberately informational: the kiosk does NOT scan a
 * resident's receipt, because a shared hall terminal must not read a
 * complaint QR that belongs to someone else.
 *
 * The resident scans the QR on their own receipt with their own phone,
 * which opens the resident-safe status page. Everything else here is the
 * honest answer to the two questions a walk-in actually asks: what do I
 * do with this QR, and what if I lost it.
 *
 * Lost-receipt recovery is intentionally NOT offered online. There is no
 * OTP or verified-contact infrastructure in this system, so the only safe
 * recovery is a human at the front desk who can verify the person.
 */
export default function KioskTrackInfo() {
  const router = useRouter();
  const { t } = useKioskLanguage();

  return (
    <div className="space-y-4">
      <div className="mb-1 text-center">
        <h1 className="text-[21px] font-bold leading-tight tracking-tight text-navy sm:text-[24px]">
          {t("track.title")}
        </h1>
        <p className="mt-1 text-[13.5px] font-semibold text-muted">
          {t("track.subtitle")}
        </p>
      </div>

      <p className="text-center text-[14px] leading-relaxed text-muted">
        {t("track.intro")}
      </p>

      <section className="kiosk-card kiosk-card-pad">
        <h2 className="flex items-center gap-2 text-[15px] font-bold text-navy">
          <QrCode className="h-5 w-5 text-secondary" aria-hidden="true" />
          {t("track.qrTitle")}
        </h2>
        <p className="mt-2 text-[14px] leading-relaxed text-mirage">
          {t("track.qrBody")}
        </p>
      </section>

      <section className="kiosk-card kiosk-card-pad">
        <h2 className="flex items-center gap-2 text-[15px] font-bold text-navy">
          <ShieldCheck className="h-5 w-5 text-secondary" aria-hidden="true" />
          {t("track.phoneTitle")}
        </h2>
        <p className="mt-2 text-[14px] leading-relaxed text-mirage">
          {t("track.phoneBody")}
        </p>
      </section>

      <section className="kiosk-card kiosk-card-pad">
        <h2 className="flex items-center gap-2 text-[15px] font-bold text-navy">
          <ReceiptText className="h-5 w-5 text-secondary" aria-hidden="true" />
          {t("track.slipTitle")}
        </h2>
        <p className="mt-2 text-[14px] leading-relaxed text-mirage">
          {t("track.slipBody")}
        </p>
      </section>

      <section className="kiosk-card kiosk-card-pad">
        <h2 className="flex items-center gap-2 text-[15px] font-bold text-navy">
          <HelpCircle className="h-5 w-5 text-warning" aria-hidden="true" />
          {t("track.lostTitle")}
        </h2>
        <p className="mt-2 text-[14px] leading-relaxed text-mirage">
          {t("track.lostBody")}
        </p>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">
          {t("track.officeNote")}
        </p>
      </section>

      <div className="space-y-3 pt-1">
        <button
          type="button"
          onClick={() => router.push("/kiosk")}
          className="kiosk-btn kiosk-btn-primary kiosk-btn-block min-h-[52px] text-[16px]"
        >
          <FilePlus2 className="h-5 w-5" aria-hidden="true" />
          {t("track.start")}
        </button>
        <button
          type="button"
          onClick={() => router.push("/kiosk")}
          className="kiosk-btn kiosk-btn-quiet kiosk-btn-block"
        >
          {t("track.back")}
        </button>
      </div>
    </div>
  );
}
