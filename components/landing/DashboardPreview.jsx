import { Archive, Network, WifiOff } from "lucide-react";
import {
  filingChannels,
  heroFeedRows,
  liveCaseFeed,
  offlineCard,
  urgencyStyles,
} from "@/data/landingData";

const URGENCY_STYLES = { ...urgencyStyles };

function UrgencyPill({ level }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.4px] text-white ${
        URGENCY_STYLES[level] || "bg-muted"
      }`}
    >
      {level}
    </span>
  );
}

function InfoCardShell({ children }) {
  return (
    <div className="rounded-2xl border border-edge bg-white p-5 shadow-float">
      {children}
    </div>
  );
}

function LiveCaseFeedCard() {
  return (
    <InfoCardShell>
      <p className="text-[11px] font-bold uppercase tracking-[0.88px] text-muted">
        Live case feed
      </p>
      <ul className="mt-3">
        {liveCaseFeed.map((item, index) => (
          <li
            key={item.title}
            className={`flex items-center justify-between gap-3 border-t border-alt py-2.5 first:border-t-0 ${
              index === 0 ? "pt-1" : ""
            }`}
          >
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold text-mirage">
                {item.title}
              </p>
              <p className="text-[11px] text-muted">{item.channel}</p>
            </div>
            <UrgencyPill level={item.urgency} />
          </li>
        ))}
      </ul>
    </InfoCardShell>
  );
}

function FilingChannelsCard() {
  return (
    <InfoCardShell>
      <p className="text-[11px] font-bold uppercase tracking-[0.88px] text-muted">
        Filing channels
      </p>
      <ul className="mt-3 space-y-3">
        {filingChannels.map((channel) => (
          <li key={channel} className="flex items-center gap-2.5">
            <span className="h-2 w-2 shrink-0 rounded-full bg-secondary" aria-hidden="true" />
            <span className="text-[13px] font-semibold text-mirage">{channel}</span>
          </li>
        ))}
      </ul>
    </InfoCardShell>
  );
}

function OfflineCard() {
  return (
    <InfoCardShell>
      <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.88px] text-gold">
        <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />
        {offlineCard.title}
      </p>
      <p className="mt-2.5 text-[12.5px] leading-relaxed text-muted">
        {offlineCard.body}
      </p>
    </InfoCardShell>
  );
}

export default function DashboardPreview() {
  return (
    <div className="relative mx-auto mt-10 w-full max-w-[920px] lg:mt-14 lg:min-h-[480px]">
      {/* Main dashboard window */}
      <div className="rounded-[28px] bg-gradient-to-br from-secondary to-navy p-4 shadow-float sm:p-5">
        <div className="overflow-hidden rounded-[26px] border border-white/10 bg-window">
          {/* Window header */}
          <div className="flex items-center gap-1.5 bg-windowbar px-4 py-3">
            <span className="h-2 w-2 rounded-full bg-white/25" aria-hidden="true" />
            <span className="h-2 w-2 rounded-full bg-white/25" aria-hidden="true" />
            <span className="h-2 w-2 rounded-full bg-white/25" aria-hidden="true" />
            <span className="sr-only">Barangay case dashboard preview</span>
          </div>

          <div className="flex">
            {/* Sidebar skeleton */}
            <div className="hidden w-[120px] shrink-0 flex-col gap-2.5 p-4 sm:flex" aria-hidden="true">
              <span className="h-2.5 w-full rounded bg-gold-soft opacity-85" />
              <span className="h-2.5 w-full rounded bg-white/10" />
              <span className="h-2.5 w-full rounded bg-white/10" />
              <span className="h-2.5 w-full rounded bg-white/10" />
              <span className="h-2.5 w-full rounded bg-white/10" />
            </div>

            {/* Feed */}
            <div className="min-w-0 flex-1 p-4 sm:pl-2">
              <div className="mb-3 hidden h-3 w-40 rounded bg-white/15 sm:block" aria-hidden="true" />
              <ul className="space-y-2.5">
                {heroFeedRows.map((row) => (
                  <li
                    key={row.title}
                    className="flex items-center justify-between gap-3 rounded-[10px] bg-white/5 px-3.5 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-semibold text-white">
                        {row.title}
                      </p>
                      <p className="truncate text-[11px] text-white/60">
                        Predicted: {row.meta} · {row.channel}
                      </p>
                    </div>
                    <UrgencyPill level={row.urgency} />
                  </li>
                ))}
              </ul>
              <p className="mt-3.5 flex items-center gap-1.5 rounded-lg bg-white/5 px-3.5 py-2 text-[11px] leading-relaxed text-white/70">
                <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-gold-soft" aria-hidden="true" />
                AI predictions are recommendations. Authorized barangay officials
                verify and confirm the final classification.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Floating info cards — stacked below on small screens, overlaid on lg+ */}
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3 lg:mt-0 lg:block lg:space-y-0">
        <div className="lg:absolute lg:-left-8 lg:top-14 lg:w-[290px] xl:-left-12">
          <LiveCaseFeedCard />
        </div>
        <div className="lg:absolute lg:-right-6 lg:top-0 lg:w-[220px] xl:-right-10">
          <FilingChannelsCard />
        </div>
        <div className="lg:absolute lg:-right-6 lg:bottom-0 lg:w-[220px] xl:-right-12">
          <OfflineCard />
        </div>
      </div>

      {/* Small decorative footer strip inside the mockup cluster */}
      <div className="mt-8 hidden items-center justify-center gap-2 text-[11px] text-muted lg:flex">
        <Archive className="h-3.5 w-3.5" aria-hidden="true" />
        <span>Blotter &amp; case records</span>
        <span className="mx-1 text-alt">•</span>
        <Network className="h-3.5 w-3.5" aria-hidden="true" />
        <span>Web · Mobile · Kiosk</span>
      </div>
    </div>
  );
}