"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ScrollText, ShieldCheck } from "lucide-react";
import { fetchReferralActivity } from "@/repositories/pnpReferralRepository";
import { formatDateTime, humanize } from "@/lib/pnpReferral";
import { PNP_ROUTES } from "@/lib/constants";
import {
  BoundaryNote,
  DetailField,
  EmptyState,
  LoadingBlock,
  PnpPageHeader,
} from "./PnpPrimitives";

/**
 * The PNP's audit view.
 *
 * This is NOT a window onto public.activity_logs. That table also
 * holds role changes, account suspensions and other records a PNP
 * officer has no business reading, so it stays closed to the role
 * entirely. Instead this page calls pnp_referral_activity(), a narrow
 * SECURITY DEFINER reader that returns only rows whose target is a
 * referral with an active assignment for this officer, and strips
 * the jsonb payloads down to a few keys on the way out.
 *
 * The practical difference from the official portal's audit log: an
 * officer sees the history of their own referrals and nothing else.
 */

/**
 * How each action reads. Keys are the action strings written by the
 * RPCs in pnp-portal-03.
 */
const ACTION_META = {
  pnp_referral_created: { label: "Referral created", tone: "default" },
  pnp_referral_status_changed: { label: "Status changed", tone: "default" },
  pnp_referral_assigned: { label: "Officer assigned", tone: "default" },
  pnp_referral_released: { label: "Officer released", tone: "warning" },
  pnp_referral_note_added: { label: "Note added", tone: "default" },
  pnp_referral_evidence_shared: { label: "Evidence shared", tone: "default" },
  pnp_referral_information_requested: { label: "Information requested", tone: "warning" },
  pnp_referral_information_answered: { label: "Information provided", tone: "success" },
  pnp_referral_external_reference_set: { label: "External reference set", tone: "default" },
};

const TONE_CLASSES = {
  default: "bg-alt text-muted",
  warning: "bg-warning-soft text-warning",
  success: "bg-success-soft text-success",
};

/** Render a details blob without guessing at its shape. */
function DetailPairs({ details }) {
  const entries = useMemo(() => {
    if (!details || typeof details !== "object") return [];
    return Object.entries(details).filter(
      ([, value]) => value !== null && value !== undefined && value !== ""
    );
  }, [details]);

  if (entries.length === 0) return null;

  return (
    <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
      {entries.map(([key, value]) => (
        <div key={key} className="flex gap-1.5 text-[12px]">
          <dt className="text-muted">{humanize(key)}:</dt>
          <dd className="font-medium text-navy">
            {typeof value === "object" ? JSON.stringify(value) : String(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export default function PnpActivityLogs() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  const load = useCallback(async () => {
    const result = await fetchReferralActivity(null, 200);
    setRows(result.rows);
    setUnavailable(result.unavailable);
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await load();
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PnpPageHeader
        title="Activity Logs"
        subtitle="Every recorded action on the referrals assigned to you, newest first."
      />

      <BoundaryNote title="Scope of this log">
        <p>
          These rows come from a reader that returns referral activity only. Account changes, role
          changes and other system-wide records are not part of this portal, and the officer cannot
          read the barangay&apos;s full audit table. Internal notes and the reasons behind a
          return, decline or closure are removed before these rows are returned.
        </p>
      </BoundaryNote>

      {loading ? (
        <LoadingBlock label="Loading activity…" />
      ) : unavailable ? (
        <EmptyState
          icon={ScrollText}
          title="Activity log not available"
          message="The referral activity reader has not been applied. Run supabase/manual/pnp-portal-03-referral-functions.sql in the Supabase SQL Editor."
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title="No activity yet"
          message="Actions on your assigned referrals will be recorded here, including status changes, notes, evidence shares and information exchanges."
        />
      ) : (
        <section className="rounded-2xl border border-line bg-white shadow-sm">
          <ol className="divide-y divide-line">
            {rows.map((row) => {
              const meta = ACTION_META[row.action] || {
                label: humanize(row.action),
                tone: "default",
              };
              return (
                <li key={row.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                        TONE_CLASSES[meta.tone] || TONE_CLASSES.default
                      }`}
                    >
                      {meta.label}
                    </span>
                    {row.entity_ref ? (
                      <span className="font-mono text-[12px] font-semibold text-secondary">
                        {row.entity_ref}
                      </span>
                    ) : null}
                    <span className="ml-auto text-[12px] text-muted">
                      {formatDateTime(row.created_at)}
                    </span>
                  </div>
                  <DetailPairs details={row.details} />
                  {row.referral_id ? (
                    <Link
                      href={PNP_ROUTES.referralDetail(row.referral_id)}
                      className="mt-2 inline-block text-[12px] font-semibold text-secondary hover:text-navy"
                    >
                      Open referral
                    </Link>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </section>
      )}

      <p className="flex items-start gap-2 text-[12px] leading-relaxed text-muted">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        These entries are written inside the same database transaction as the action they describe,
        so an action cannot succeed without its audit row.
      </p>
    </div>
  );
}
