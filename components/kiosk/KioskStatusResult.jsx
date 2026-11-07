"use client";

import { useRouter } from "next/navigation";
import { Clock, Gavel, Users } from "lucide-react";

import KioskStatusTimeline from "./KioskStatusTimeline";
import KioskStatusDocuments from "./KioskStatusDocuments";
import { Note } from "./KioskField";
import {
  formatDate,
  formatDateTime,
  formatTime,
  statusLabel,
  statusTone,
} from "@/lib/kiosk/format";

/**
 * Renders one resident-safe status payload.
 *
 * Everything on this screen comes from kiosk_status_payload() in
 * kiosk-03-status-token-security.sql, which is SECURITY DEFINER and is
 * the only thing allowed to read case_statuses, kp_trackers and hearings
 * on a walk-in's behalf. It selects a fixed column list and returns
 * jsonb, so there is no path by which a staff note, an audit row, a
 * Lupon deliberation or someone else's complaint reaches this component.
 *
 * The component's own job is to refuse to show a value it was not given.
 * `confirmed_category` and `confirmed_urgency` stay null until a human
 * confirms them, and they are rendered as such rather than being filled
 * in from `classification_status` or from an AI suggestion: an
 * unconfirmed classification presented as fact is the single worst thing
 * this screen could do.
 *
 * Both conditional cards are gated on real data, never on a guess:
 *
 *  - The mediation-period card renders only when the database found an
 *    actual Mediation or Conciliation phase that has started. KP
 *    eligibility alone does not summon it.
 *  - The next-hearing card renders only when there is a real Upcoming
 *    hearing row.
 */
export default function KioskStatusResult({ payload, t, language, statusToken }) {
  const router = useRouter();
  const tone = statusTone(payload?.current_status);

  return (
    <div className="space-y-4">
      {/* ── Case summary ─────────────────────────────────────── */}
      <section className="kiosk-card kiosk-card-pad">
        <h2 className="text-[12px] font-bold uppercase tracking-[0.1em] text-muted">
          {t("timeline.caseSummary")}
        </h2>

        <p className="mt-2 font-mono text-[22px] font-bold tracking-[0.05em] break-all text-navy sm:text-[24px]">
          {payload?.reference_number || "—"}
        </p>

        <div className="mt-3">
          <span className={`kiosk-badge kiosk-badge-${tone}`}>
            {statusLabel(payload?.current_status, language)}
          </span>
        </div>

        <dl className="mt-4 space-y-2.5">
          {/* The Barangay Case Number is assigned only on official
              receipt. It is shown as "not yet assigned" rather than
              left blank, so the resident is never left guessing. */}
          <Row label={t("status.caseNumber")}>
            {payload?.barangay_case_number ? (
              <span className="font-mono">{payload.barangay_case_number}</span>
            ) : (
              t("status.caseNumberPending")
            )}
          </Row>
          <Row label={t("status.filed")}>
            {formatDateTime(payload?.submitted_at, language)}
          </Row>
          <Row label={t("status.lastUpdated")}>
            {formatDateTime(payload?.last_updated_at, language)}
          </Row>
        </dl>
      </section>

      {/* ── Current safe action ───────────────────────────────── */}
      {/* `resident_visible_message` is the wording an official wrote for
          the resident. When there is none, the honest answer is that no
          official has confirmed anything yet. */}
      <section className="kiosk-card kiosk-card-pad">
        <h2 className="text-[12px] font-bold uppercase tracking-[0.1em] text-muted">
          {t("status.nextAction")}
        </h2>
        <p className="mt-2 text-[14.5px] leading-relaxed text-mirage">
          {payload?.last_message || t("status.resultNotYet")}
        </p>
      </section>

      {/* ── Timeline ─────────────────────────────────────────── */}
      <KioskStatusTimeline payload={payload} t={t} language={language} />

      {/* ── Shared documents, only when the barangay shared any ─ */}
      <KioskStatusDocuments
        documents={payload?.documents}
        statusToken={statusToken}
      />

      {/* ── Mediation period, only when one is actually running ─ */}
      {payload?.mediation ? (
        <section className="kiosk-card kiosk-card-pad">
          <h2 className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.1em] text-muted">
            <Users className="h-4 w-4" aria-hidden="true" />
            {t("timeline.mediationCard")}
          </h2>
          <dl className="mt-3 space-y-2.5">
            <Row label={t("timeline.mediationDeadline")}>
              {formatDate(payload.mediation.deadline, language)}
            </Row>
            <Row label={t("status.lastUpdated")}>{payload.mediation.status}</Row>
          </dl>
        </section>
      ) : null}

      {/* ── Next hearing, only when a hearing row exists ──────── */}
      {payload?.next_hearing ? (
        <section className="kiosk-card kiosk-card-pad">
          <h2 className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.1em] text-muted">
            <Gavel className="h-4 w-4" aria-hidden="true" />
            {t("timeline.hearingCard")}
          </h2>
          <p className="mt-2 text-[15px] font-semibold text-navy">
            {payload.next_hearing.title || t("timeline.hearingCard")}
          </p>
          <dl className="mt-3 space-y-2.5">
            <Row label={t("timeline.hearingDate")}>
              {formatDate(payload.next_hearing.date, language)}
            </Row>
            <Row label={t("timeline.hearingTime")}>
              {formatTime(payload.next_hearing.time)}
            </Row>
            {payload.next_hearing.status ? (
              <Row label={t("timeline.hearingStatus")}>
                {payload.next_hearing.status}
              </Row>
            ) : null}
            {payload.next_hearing.venue ? (
              <Row label={t("timeline.hearingVenue")}>
                {payload.next_hearing.venue}
              </Row>
            ) : null}
          </dl>
        </section>
      ) : null}

      {/* ── Case details ─────────────────────────────────────── */}
      <section className="kiosk-card kiosk-card-pad">
        <h2 className="text-[12px] font-bold uppercase tracking-[0.1em] text-muted">
          {t("timeline.caseDetails")}
        </h2>

        <dl className="mt-3 space-y-2.5">
          <Row label={t("status.category")}>
            {payload?.confirmed_category || t("timeline.noConfirmedYet")}
          </Row>
          <Row label={t("status.urgency")}>
            {payload?.confirmed_urgency || t("timeline.noConfirmedYet")}
          </Row>
          <Row label={t("otherParty.title")}>
            {otherPartyLabel(payload?.other_party_status, t)}
          </Row>
          <Row label={t("incident.ongoing")}>{yesNo(payload?.incident_ongoing, t)}</Row>
          <Row label={t("incident.immediate")}>
            {yesNo(payload?.immediate_safety_concern, t)}
          </Row>
        </dl>
      </section>

      {/* Safety flags are surfaced, never acted on. The kiosk does not
          dispatch anybody, and saying so next to a "yes" is the honest
          thing to do. Note supplies its own icon, so the text goes in
          bare rather than nesting a second one. */}
      {payload?.immediate_safety_concern === true || payload?.incident_ongoing === true ? (
        <Note tone="warn">{t("incident.emergency")}</Note>
      ) : null}

      {/* ── Privacy ──────────────────────────────────────────── */}
      <Note tone="info">{t("timeline.privacyNotice")}</Note>

      <button
        type="button"
        onClick={() => router.push("/kiosk")}
        className="kiosk-btn kiosk-btn-primary kiosk-btn-block min-h-[52px] text-[16px]"
      >
        {t("status.returnHome")}
      </button>
    </div>
  );
}

/** One label/value pair. The value keeps its own colour for warnings. */
function Row({ label, children }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
      <dt className="text-[13px] font-medium text-muted">{label}</dt>
      <dd className="text-[13.5px] font-semibold text-mirage text-right">{children}</dd>
    </div>
  );
}

/** The three other-party answers, in the kiosk's own wording. */
function otherPartyLabel(status, t) {
  if (status === "known") return t("otherParty.known");
  if (status === "unknown") return t("otherParty.unknown");
  if (status === "not_applicable") return t("otherParty.none");
  return "—";
}

function yesNo(value, t) {
  if (value === true) return t("common.yes");
  if (value === false) return t("common.no");
  return "—";
}

/**
 * The offline-receipt state.
 *
 * Shown when kiosk_status_by_token() resolves to `pending_sync`, which is
 * deliberately also what an unknown, expired or revoked token resolves
 * to. That single shape is what stops the endpoint from being an oracle
 * for "does this complaint exist", and it is why this screen cannot say
 * "no such complaint" and must simply describe the state.
 */
export function KioskStatusPendingSync({ t }) {
  const router = useRouter();

  return (
    <div className="space-y-4">
      <section className="kiosk-card kiosk-card-pad text-center">
        <Clock className="mx-auto h-12 w-12 text-warning" aria-hidden="true" strokeWidth={1.75} />
        <h2 className="mt-3 text-[18px] font-bold leading-snug text-navy">
          {t("status.pendingSync")}
        </h2>
        <p className="mt-2 text-[14px] leading-relaxed text-muted">
          {t("status.pendingSyncHelp")}
        </p>
      </section>

      <Note tone="warn">{t("offline.pendingNotice")}</Note>

      <button
        type="button"
        onClick={() => router.push("/kiosk")}
        className="kiosk-btn kiosk-btn-primary kiosk-btn-block min-h-[52px] text-[16px]"
      >
        {t("status.returnHome")}
      </button>
    </div>
  );
}

/** Heading shared by both status routes. */
export function KioskStatusHeading({ t }) {
  return (
    <div className="mb-4 text-center">
      <h1 className="text-[21px] font-bold leading-tight tracking-tight text-navy sm:text-[24px]">
        {t("status.title")}
      </h1>
      <p className="mt-1 text-[13.5px] font-semibold text-muted">{t("status.subtitle")}</p>
    </div>
  );
}
