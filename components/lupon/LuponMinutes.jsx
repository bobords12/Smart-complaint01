"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import {
  AlertTriangle,
  CheckCircle2,
  FilePlus2,
  Loader2,
  Lock,
  ScrollText,
  Send,
} from "lucide-react";
import {
  formatDate,
  formatDateTime,
  formatTime,
  getMyAssignments,
  getMyHearings,
  getMyMinutes,
  getMyPastHearings,
  isLeadRole,
  minutesAction,
  saveMinutesDraft,
} from "@/repositories/luponRepository";
import { LUPON_ROUTES } from "@/lib/constants";

/* ── Status presentation ─────────────────────────────────── */

const STATUS_STYLE = {
  Draft: "bg-alt text-muted",
  "Returned for Correction": "bg-warning/15 text-navy",
  "Submitted for Review": "bg-secondary/10 text-secondary",
  Attested: "bg-gold/20 text-navy",
  Final: "bg-success/10 text-success",
};

const STATUS_ORDER = [
  "Draft",
  "Returned for Correction",
  "Submitted for Review",
  "Attested",
  "Final",
];

function StatusBadge({ status }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${
        STATUS_STYLE[status] ?? "bg-alt text-muted"
      }`}
    >
      {status ?? "Draft"}
    </span>
  );
}

function LifecycleTrack({ status }) {
  const currentIndex = STATUS_ORDER.indexOf(status);
  return (
    <ol className="flex flex-wrap items-center gap-1.5" aria-label="Minutes lifecycle">
      {STATUS_ORDER.map((step, i) => {
        const reached = currentIndex >= 0 && i <= currentIndex;
        return (
          <li key={step} className="flex items-center gap-1.5">
            <span
              className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${
                i === currentIndex
                  ? "bg-secondary text-white"
                  : reached
                    ? "bg-secondary/15 text-secondary"
                    : "bg-alt text-muted"
              }`}
            >
              {step}
            </span>
            {i < STATUS_ORDER.length - 1 ? (
              <span aria-hidden="true" className="text-muted/50">
                ›
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/* ── Editor ──────────────────────────────────────────────── */

function MinutesEditor({ record, onClose, onSaved }) {
  const [narrative, setNarrative] = useState(record?.narrative ?? "");
  const [agreements, setAgreements] = useState(record?.agreements ?? "");
  const [nextStep, setNextStep] = useState(record?.next_step ?? "");
  const [busy, setBusy] = useState(false);

  const submit = async (thenAction) => {
    if (!narrative.trim()) {
      toast.error("The narrative cannot be empty.");
      return;
    }
    setBusy(true);
    try {
        const hearingId = record?.hearing_id ?? record?.id;
        if (!hearingId) {
          throw new Error("No hearing linked to this draft");
        }
        const id = await saveMinutesDraft({
          hearingId,
          narrative,
          agreements,
          nextStep,
          hearingDate: record?.hearing_date ?? null,
        });
        if (thenAction) await minutesAction(id, thenAction);
      toast.success(
        thenAction === "submit"
          ? "Minutes submitted for review."
          : "Draft saved."
      );
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const field =
    "w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-[13px] text-navy placeholder:text-muted focus-visible:outline-2 focus-visible:outline-secondary";
  const label = "mb-1.5 block text-[12px] font-semibold text-navy";

  return (
    <div className="rounded-2xl border border-secondary/40 bg-white p-6 shadow-sm">
      <h2 className="font-heading text-base font-semibold tracking-tight text-navy">
        {record?.id ? "Edit minutes" : "Draft minutes for this hearing"}
      </h2>
      {record?.hearings?.hearing_date ? (
        <p className="mt-1 text-[13px] text-muted">
          {formatDate(record.hearings.hearing_date)} ·{" "}
          {formatTime(record.hearings.hearing_time)}
        </p>
      ) : null}

      <div className="mt-4 space-y-4">
        <div>
          <label htmlFor="minutes-narrative" className={label}>
            Narrative <span className="text-critical">*</span>
          </label>
          <textarea
            id="minutes-narrative"
            rows={7}
            value={narrative}
            onChange={(e) => setNarrative(e.target.value)}
            placeholder="What happened at the hearing, in order."
            className={field}
          />
        </div>
        <div>
          <label htmlFor="minutes-agreements" className={label}>
            Agreements reached
          </label>
          <textarea
            id="minutes-agreements"
            rows={3}
            value={agreements}
            onChange={(e) => setAgreements(e.target.value)}
            placeholder="Leave blank if the parties did not agree on anything."
            className={field}
          />
        </div>
        <div>
          <label htmlFor="minutes-next-step" className={label}>
            Next step
          </label>
          <textarea
            id="minutes-next-step"
            rows={2}
            value={nextStep}
            onChange={(e) => setNextStep(e.target.value)}
            placeholder="What happens next, and by when."
            className={field}
          />
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-end gap-2.5">
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="min-h-[40px] rounded-xl border border-line px-4 text-[13px] font-semibold text-muted transition-colors hover:text-navy"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => submit(null)}
          disabled={busy}
          className="min-h-[40px] rounded-xl border border-secondary px-4 text-[13px] font-semibold text-secondary transition-colors hover:bg-secondary/10 disabled:opacity-50"
        >
          Save draft
        </button>
        <button
          type="button"
          onClick={() => submit("submit")}
          disabled={busy}
          className="inline-flex min-h-[40px] items-center gap-2 rounded-xl bg-secondary px-4 text-[13px] font-semibold text-white transition-colors hover:bg-navy disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Send className="h-4 w-4" aria-hidden="true" />
          )}
          Submit for review
        </button>
      </div>
    </div>
  );
}

/* ── Record card ─────────────────────────────────────────── */

function MinutesCard({ record, role, onEdit, onRefresh }) {
  const canEdit = isLeadRole(role) &&
    (record.status === "Draft" || record.status === "Returned for Correction");
  const canSubmit = isLeadRole(role) && (record.status === "Draft" || record.status === "Returned for Correction");
  const canAttest = isLeadRole(role) && record.status === "Submitted for Review";
  const canFinalize = String(role).toLowerCase() === "secretary" && record.status === "Attested";

  const [busy, setBusy] = useState(false);
  const act = async (action, label) => {
    setBusy(true);
    try {
      await minutesAction(record.id, action);
      toast.success(label);
      onRefresh();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="rounded-2xl border border-line bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={LUPON_ROUTES.caseDetail(record.complaint_id)}
            className="text-[12px] font-semibold text-secondary hover:underline"
          >
            {record.complaints?.reference_number ?? "Case"}
          </Link>
          <h3 className="mt-0.5 line-clamp-2 font-heading text-[15px] font-semibold text-navy">
            {record.complaints?.title ?? "Untitled case"}
          </h3>
          <p className="mt-1 text-[12px] text-muted">
            {record.hearings?.hearing_date
              ? `Hearing ${formatDate(record.hearings.hearing_date)}`
              : "No linked hearing"}
            {record.updated_at ? ` · updated ${formatDateTime(record.updated_at)}` : ""}
          </p>
        </div>
        <StatusBadge status={record.status} />
      </div>

      <div className="mt-3">
        <LifecycleTrack status={record.status} />
      </div>

      {record.narrative ? (
        <p className="mt-3 line-clamp-3 whitespace-pre-line text-[13px] leading-relaxed text-muted">
          {record.narrative}
        </p>
      ) : null}

      {record.status === "Returned for Correction" ? (
        <p className="mt-3 flex items-start gap-2 rounded-xl bg-warning/10 p-3 text-[12px] text-navy">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            <strong className="font-semibold">Returned for correction.</strong>{" "}
            {record.returned_reason ?? "See the review note on the case page."}
          </span>
        </p>
      ) : null}

      {record.status === "Final" ? (
        <p className="mt-3 flex items-center gap-2 text-[12px] font-semibold text-success">
          <Lock className="h-3.5 w-3.5" aria-hidden="true" />
          Finalised and locked. This record can no longer be edited.
        </p>
      ) : null}

      {canEdit || canAttest || canFinalize ? (
        <div className="mt-4 flex flex-wrap gap-2.5">
          {canEdit ? (
            <button
              type="button"
              onClick={() => onEdit(record)}
              className="min-h-[38px] rounded-xl border border-line px-3.5 text-[13px] font-semibold text-navy transition-colors hover:border-secondary/40"
            >
              Edit
            </button>
          ) : null}
          {canSubmit ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => act("submit", "Minutes submitted for review.")}
              className="inline-flex min-h-[38px] items-center gap-2 rounded-xl border border-secondary px-3.5 text-[13px] font-semibold text-secondary transition-colors hover:bg-secondary/10 disabled:opacity-50"
            >
              <Send className="h-3.5 w-3.5" aria-hidden="true" />
              Submit
            </button>
          ) : null}
          {canAttest ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => act("attest", "Minutes attested.")}
              className="inline-flex min-h-[38px] items-center gap-2 rounded-xl border border-secondary px-3.5 text-[13px] font-semibold text-secondary transition-colors hover:bg-secondary/10 disabled:opacity-50"
            >
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
              Attest
            </button>
          ) : null}
          {canFinalize ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => act("finalize", "Minutes finalised and locked.")}
              className="inline-flex min-h-[38px] items-center gap-2 rounded-xl bg-success px-3.5 text-[13px] font-semibold text-white transition-colors hover:bg-navy disabled:opacity-50"
            >
              <Lock className="h-3.5 w-3.5" aria-hidden="true" />
              Finalise
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/* ── Page ────────────────────────────────────────────────── */

export default function LuponMinutes() {
  const [records, setRecords] = useState([]);
  const [roleByCase, setRoleByCase] = useState({});
  const [hearings, setHearings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null);
  const [picking, setPicking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, assignments, future, past] = await Promise.all([
        getMyMinutes(),
        getMyAssignments(),
        getMyHearings(),
        getMyPastHearings(),
      ]);
      setRecords(list);
      setRoleByCase(
        Object.fromEntries(
          assignments.map((a) => [a.complaint_id, a.my_role])
        )
      );
      setHearings([...future, ...past]);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await load();
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  // Hearings on cases the member leads that have no editable
  // minutes record yet, offered in the "new draft" picker.
  const draftableHearings = useMemo(() => {
    const covered = new Set(
      records
        .filter((r) => r.status !== "Final")
        .map((r) => r.hearing_id)
    );
    return hearings.filter(
      (h) => isLeadRole(roleByCase[h.complaint_id]) && !covered.has(h.id)
    );
  }, [hearings, records, roleByCase]);

  const refreshAndClose = () => {
    setEditing(null);
    setPicking(false);
    load();
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight text-navy sm:text-3xl">
            Minutes
          </h1>
          <p className="mt-1.5 text-sm text-muted">
            The Chairperson or Secretary drafts. Only the Secretary finalises, and
            a final record is locked permanently.
          </p>
        </div>
        {draftableHearings.length > 0 ? (
          <button
            type="button"
            onClick={() => setPicking((v) => !v)}
            className="inline-flex min-h-[40px] items-center gap-2 rounded-xl bg-secondary px-4 text-[13px] font-semibold text-white transition-colors hover:bg-navy"
          >
            <FilePlus2 className="h-4 w-4" aria-hidden="true" />
            New minutes
          </button>
        ) : null}
      </header>

      {error ? (
        <p
          role="alert"
          className="rounded-xl border border-critical/30 bg-critical-soft p-4 text-sm text-critical"
        >
          {error}
        </p>
      ) : null}

      {picking ? (
        <div className="rounded-2xl border border-line bg-white p-6 shadow-sm">
          <h2 className="font-heading text-base font-semibold text-navy">
            Pick a hearing
          </h2>
          {draftableHearings.length === 0 ? (
            <p className="mt-2 text-[13px] text-muted">
              Every hearing on a case you lead already has minutes.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {draftableHearings.map((h) => (
                <li key={h.id}>
                  <button
                    type="button"
                    onClick={() => setEditing({ ...h, hearing_id: h.id })}                    className="w-full rounded-xl border border-line px-4 py-3 text-left transition-colors hover:border-secondary/40 hover:bg-alt/50"
                  >
                    <span className="block text-[12px] font-semibold text-secondary">
                      {h.complaints?.reference_number}
                    </span>
                    <span className="mt-0.5 block text-[13px] font-medium text-navy">
                      {h.complaints?.title}
                    </span>
                    <span className="mt-0.5 block text-[12px] text-muted">
                      {formatDate(h.hearing_date)} · {formatTime(h.hearing_time)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {editing ? (
        <MinutesEditor
          record={editing}
          onClose={() => setEditing(null)}
          onSaved={refreshAndClose}
        />
      ) : null}

      {loading ? (
        <div className="flex items-center justify-center gap-3 rounded-2xl border border-line bg-white py-16 text-muted">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          <span className="text-sm">Loading minutes…</span>
        </div>
      ) : records.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-white px-6 py-16 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-alt text-muted">
            <ScrollText className="h-6 w-6" aria-hidden="true" />
          </span>
          <h2 className="mt-4 font-heading text-base font-semibold text-navy">
            No minutes yet
          </h2>
          <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted">
            Minutes appear here once the Chairperson or Secretary drafts them for a
            hearing on one of your cases.
          </p>
        </div>
      ) : (
        <ul className="space-y-4">
          {records.map((r) => (
            <MinutesCard
              key={r.id}
              record={r}
              role={roleByCase[r.complaint_id]}
              onEdit={(record) => setEditing(record)}
              onRefresh={load}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
