"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { useAuth } from "@/context/AuthContext";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  FileText,
  Gavel,
  Loader2,
  Lock,
  Paperclip,
  Scale,
  Timer,
  UserCheck,
  Users,
} from "lucide-react";
import {
  ATTENDANCE_STATUSES,
  OUTCOME_TYPES,
  convenePangkat,
  createDocumentSignedUrl,
  formatDate,
  formatDateTime,
  formatTime,
  getCaseBundle,
  getMyRoleInCase,
  isLeadRole,
  readClock,
  recordAttendance,
  recordOutcome,
  requestExtension,
} from "@/repositories/luponRepository";
import { LUPON_ROUTES } from "@/lib/constants";

/* ── Reusable pieces ─────────────────────────────────────── */

/**
 * Which party put a member on the Pangkat.
 *
 * The panel is constituted by each party choosing one member and those
 * two choosing the third, so who chose whom is part of the record of a
 * properly formed Pangkat — and the only part of a member's identity
 * this page is able to show.
 */
const CHOOSER_LABEL = {
  complainant: "Chosen by the complainant",
  respondent: "Chosen by the respondent",
  jointly: "Chosen jointly by both parties",
};

function Section({ icon: Icon, title, action, children }) {
  return (
    <section className="rounded-2xl border border-line bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-heading text-base font-semibold tracking-tight text-navy">
          <Icon className="h-5 w-5 text-gold" aria-hidden="true" />
          {title}
        </h2>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/**
 * One case document, and the way to actually open it.
 *
 * The title used to be read from `d.label ?? d.doc_type` — neither is a
 * column on `official_documents` — so every row listed a blank name
 * and only its date showed. The real columns are `title` and
 * `document_type`.
 *
 * The file can now be opened as well. The bucket is private and the
 * storage policy authorises a member only for documents on cases they
 * are actively assigned to, so each URL is signed on demand and
 * expires; nothing is handed out that outlives the member's assignment.
 */
function DocumentRow({ doc }) {
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const signed = await createDocumentSignedUrl(doc.storage_path);
        if (!cancelled) setUrl(signed);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [doc.storage_path]);

  const label = doc.title || doc.document_type || "Official document";

  return (
    <li className="flex items-center gap-2 rounded-xl border border-line px-3 py-2.5">
      <FileText className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-medium text-navy">{label}</span>
        <span className="block truncate text-[11px] text-muted">
          {formatDate(doc.created_at)}
          {doc.filename ? ` · ${doc.filename}` : ""}
        </span>
      </span>
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-[12px] font-semibold text-secondary transition-colors hover:bg-alt"
        >
          Open
        </a>
      ) : failed ? (
        <span className="shrink-0 text-[11px] text-muted">Unavailable</span>
      ) : (
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted" aria-label="Loading" />
      )}
    </li>
  );
}

function ClockPanel({ assignment, canLead, onConvene, busy }) {
  const clock = readClock(assignment);
  if (!clock) {
    return (
      <div className="rounded-2xl border border-line bg-white p-6 shadow-sm">
        <h2 className="flex items-center gap-2 font-heading text-base font-semibold text-navy">
          <Timer className="h-5 w-5 text-gold" aria-hidden="true" />
          Pangkat period
        </h2>
        <p className="mt-3 text-[13px] leading-relaxed text-muted">
          The 15-day conciliation period has not started. It begins on the day
          the Pangkat officially convenes.
        </p>
        {canLead ? (
          <button
            type="button"
            onClick={onConvene}
            disabled={busy}
            className="mt-4 inline-flex min-h-[40px] items-center gap-2 rounded-xl bg-secondary px-4 text-[13px] font-semibold text-white transition-colors hover:bg-navy disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Gavel className="h-4 w-4" aria-hidden="true" />
            )}
            Convene the Pangkat
          </button>
        ) : (
          <p className="mt-4 rounded-xl bg-alt p-3 text-[12px] text-muted">
            Only the Chairperson or Secretary can convene the Pangkat.
          </p>
        )}
      </div>
    );
  }

  const terminal = clock.status === "Concluded" || clock.status === "Terminated";
  const urgent = !terminal && clock.daysLeft !== null && clock.daysLeft <= 3;
  const pct = clock.totalDays
    ? Math.min(100, Math.round((clock.dayNumber / clock.totalDays) * 100))
    : 0;

  return (
    <div className="rounded-2xl border border-line bg-white p-6 shadow-sm">
      <h2 className="flex items-center gap-2 font-heading text-base font-semibold text-navy">
        <Timer className="h-5 w-5 text-gold" aria-hidden="true" />
        Pangkat period
      </h2>
      <p
        className={`mt-3 font-heading text-3xl font-bold tracking-tight ${
          terminal ? "text-muted" : urgent ? "text-critical" : "text-navy"
        }`}
      >
        {clock.label}
      </p>
      <div
        className="mt-3 h-2 w-full overflow-hidden rounded-full bg-alt"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Pangkat period progress"
      >
        <div
          className={`h-full rounded-full transition-all ${
            terminal ? "bg-muted" : urgent ? "bg-critical" : "bg-secondary"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-[12px]">
        <div>
          <dt className="text-muted">Deadline</dt>
          <dd className="font-semibold text-navy">
            {formatDate(clock.deadlineOn)}
          </dd>
        </div>
        <div>
          <dt className="text-muted">Days left</dt>
          <dd className="font-semibold text-navy">
            {terminal ? "—" : (clock.daysLeft ?? "—")}
          </dd>
        </div>
      </dl>
    </div>
  );
}

/* ── Attendance ──────────────────────────────────────────── */

function AttendanceEditor({ hearings, attendance, onSaved }) {
  const [chosenId, setChosenId] = useState("");
  const [label, setLabel] = useState("");
  const [role, setRole] = useState("Complainant");
  const [status, setStatus] = useState("Present");
  const [excuse, setExcuse] = useState("");
  const [busy, setBusy] = useState(false);

  // Default to the first hearing instead of syncing it with an
  // effect: deriving it keeps the selection correct when the
  // hearing list arrives, with no extra render pass.
  const hearingId = chosenId || hearings[0]?.id || "";

  const rows = useMemo(
    () => attendance.filter((a) => a.hearing_id === hearingId),
    [attendance, hearingId]
  );

  if (hearings.length === 0) {
    return (
      <p className="text-[13px] text-muted">
        There is no hearing on this case yet, so there is nobody to take
        attendance for.
      </p>
    );
  }

  const add = async (e) => {
    e.preventDefault();
    if (!label.trim()) {
      toast.error("Enter who this row is for.");
      return;
    }
    setBusy(true);
    try {
      await recordAttendance({
        hearingId,
        attendeeLabel: label.trim(),
        partyRole: role.trim(),
        status,
        excuseReason: status === "Excused" ? excuse.trim() || null : null,
      });
      toast.success("Attendance saved.");
      setLabel("");
      setExcuse("");
      onSaved();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const field =
    "min-h-[40px] w-full rounded-xl border border-line bg-white px-3 text-[13px] text-navy focus-visible:outline-2 focus-visible:outline-secondary";

  return (
    <div className="space-y-4">
      {hearings.length > 1 ? (
        <div>
          <label htmlFor="att-hearing" className="mb-1.5 block text-[12px] font-semibold text-navy">
            Hearing
          </label>
          <select
            id="att-hearing"
            value={hearingId}
            onChange={(e) => setChosenId(e.target.value)}
            className={field}
          >
            {hearings.map((h) => (
              <option key={h.id} value={h.id}>
                {formatDate(h.hearing_date)} · {formatTime(h.hearing_time)}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {rows.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[420px] text-left text-[13px]">
            <thead className="bg-alt/60 text-[11px] uppercase tracking-wider text-muted">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-semibold">Attendee</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">Role</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((a) => (
                <tr key={a.id}>
                  <td className="px-4 py-2.5 font-medium text-navy">
                    {a.attendee_label}
                  </td>
                  <td className="px-4 py-2.5 text-muted">{a.party_role ?? "—"}</td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                        a.attendance_status === "Present"
                          ? "bg-success/10 text-success"
                          : a.attendance_status === "Excused"
                            ? "bg-warning/15 text-navy"
                            : a.attendance_status === "Not Recorded"
                              ? "bg-alt text-muted"
                              : "bg-critical-soft text-critical"
                      }`}
                    >
                      {a.attendance_status ?? (a.attended ? "Present" : "Absent")}
                    </span>
                    {a.excuse_reason ? (
                      <p className="mt-1 text-[11px] text-muted">
                        {a.excuse_reason}
                      </p>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-[13px] text-muted">Nobody recorded for this hearing yet.</p>
      )}

      <form onSubmit={add} className="rounded-xl bg-alt/50 p-4">
        <p className="mb-3 text-[12px] font-semibold text-navy">
          Add or correct a row
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Name (e.g. Juan Dela Cruz)"
            aria-label="Attendee name"
            className={field}
          />
          <input
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="Party role"
            aria-label="Party role"
            className={field}
          />
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            aria-label="Attendance status"
            className={field}
          >
            {ATTENDANCE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          {status === "Excused" ? (
            <input
              value={excuse}
              onChange={(e) => setExcuse(e.target.value)}
              placeholder="Reason for excuse"
              aria-label="Reason for excuse"
              className={field}
            />
          ) : null}
        </div>
        <button
          type="submit"
          disabled={busy}
          className="mt-3 inline-flex min-h-[40px] items-center gap-2 rounded-xl bg-secondary px-4 text-[13px] font-semibold text-white transition-colors hover:bg-navy disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <UserCheck className="h-4 w-4" aria-hidden="true" />
          )}
          Save attendance
        </button>
      </form>
    </div>
  );
}

/* ── Extension request ───────────────────────────────────── */

function ExtensionRequest({ complaintId, onSaved }) {
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState("5");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const n = Number(days);
    if (!Number.isInteger(n) || n < 1 || n > 15) {
      toast.error("An extension must be between 1 and 15 days.");
      return;
    }
    if (!reason.trim()) {
      toast.error("A reason is required.");
      return;
    }
    setBusy(true);
    try {
      await requestExtension(complaintId, n, reason.trim());
      toast.success("Extension requested. An official will decide on it.");
      setOpen(false);
      setReason("");
      onSaved();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="min-h-[36px] rounded-xl border border-line px-3.5 text-[13px] font-semibold text-navy transition-colors hover:border-secondary/40"
      >
        {open ? "Cancel" : "Request extension"}
      </button>
      {open ? (
        <form
          onSubmit={submit}
          className="mt-3 rounded-xl bg-alt/50 p-4 text-left"
        >
          <label htmlFor="ext-days" className="mb-1.5 block text-[12px] font-semibold text-navy">
            Days requested (1–15, total cap 15)
          </label>
          <input
            id="ext-days"
            type="number"
            min={1}
            max={15}
            value={days}
            onChange={(e) => setDays(e.target.value)}
            className="min-h-[40px] w-32 rounded-xl border border-line bg-white px-3 text-[13px] text-navy focus-visible:outline-2 focus-visible:outline-secondary"
          />
          <label htmlFor="ext-reason" className="mb-1.5 mt-3 block text-[12px] font-semibold text-navy">
            Reason
          </label>
          <textarea
            id="ext-reason"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why more time is needed."
            className="w-full rounded-xl border border-line bg-white px-3 py-2 text-[13px] text-navy focus-visible:outline-2 focus-visible:outline-secondary"
          />
          <button
            type="submit"
            disabled={busy}
            className="mt-3 inline-flex min-h-[40px] items-center gap-2 rounded-xl bg-secondary px-4 text-[13px] font-semibold text-white transition-colors hover:bg-navy disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : null}
            Send request
          </button>
        </form>
      ) : null}
    </>
  );
}

/* ── Outcome ─────────────────────────────────────────────── */

function OutcomePanel({ complaintId, canLead, existing, onSaved }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState(OUTCOME_TYPES[0]);
  const [summary, setSummary] = useState("");
  const [terms, setTerms] = useState("");
  const [absence, setAbsence] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!summary.trim()) {
      toast.error("A summary is required.");
      return;
    }
    if (type === "Amicably Settled" && !terms.trim()) {
      toast.error("An amicable settlement must record the terms agreed.");
      return;
    }
    setBusy(true);
    try {
      await recordOutcome({
        complaintId,
        outcomeType: type,
        summary: summary.trim(),
        terms: type === "Amicably Settled" ? terms.trim() : null,
        absenceRecorded: absence,
      });
      toast.success("Outcome recorded.");
      setOpen(false);
      onSaved();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const field =
    "min-h-[40px] w-full rounded-xl border border-line bg-white px-3 text-[13px] text-navy focus-visible:outline-2 focus-visible:outline-secondary";

  return (
    <>
      {existing ? (
        <div className="rounded-xl border border-success/30 bg-success/5 p-4">
          <p className="flex items-center gap-2 font-heading text-[15px] font-semibold text-success">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            {existing.outcome_type}
          </p>
          <p className="mt-2 whitespace-pre-line text-[13px] leading-relaxed text-navy">
            {existing.summary}
          </p>
          {existing.terms ? (
            <>
              <p className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-muted">
                Terms agreed
              </p>
              <p className="mt-1 whitespace-pre-line text-[13px] text-navy">
                {existing.terms}
              </p>
            </>
          ) : null}
          {existing.absence_recorded ? (
            <p className="mt-3 text-[12px] font-semibold text-critical">
              Absence of a party was recorded.
            </p>
          ) : null}
          <p className="mt-3 text-[11px] text-muted">
            Recorded {formatDateTime(existing.recorded_at)}. The complaint status
            is unchanged — that decision stays with the Barangay Captain.
          </p>
        </div>
      ) : canLead ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex min-h-[38px] items-center gap-2 rounded-xl border border-line px-3.5 text-[13px] font-semibold text-navy transition-colors hover:border-secondary/40"
        >
          <Scale className="h-4 w-4" aria-hidden="true" />
          {open ? "Cancel" : "Record the outcome"}
        </button>
      ) : (
        <p className="text-[13px] text-muted">
          No outcome has been recorded yet. Only the Chairperson or Secretary
          can record it.
        </p>
      )}

      {open && canLead ? (
        <form onSubmit={submit} className="mt-3 space-y-3 rounded-xl bg-alt/50 p-4 text-left">
          <div>
            <label htmlFor="oc-type" className="mb-1.5 block text-[12px] font-semibold text-navy">
              Outcome
            </label>
            <select
              id="oc-type"
              value={type}
              onChange={(e) => setType(e.target.value)}
              className={field}
            >
              {OUTCOME_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="oc-summary" className="mb-1.5 block text-[12px] font-semibold text-navy">
              Summary <span className="text-critical">*</span>
            </label>
            <textarea
              id="oc-summary"
              rows={3}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              className="w-full rounded-xl border border-line bg-white px-3 py-2 text-[13px] text-navy focus-visible:outline-2 focus-visible:outline-secondary"
            />
          </div>
          {type === "Amicably Settled" ? (
            <div>
              <label htmlFor="oc-terms" className="mb-1.5 block text-[12px] font-semibold text-navy">
                Terms agreed <span className="text-critical">*</span>
              </label>
              <textarea
                id="oc-terms"
                rows={3}
                value={terms}
                onChange={(e) => setTerms(e.target.value)}
                className="w-full rounded-xl border border-line bg-white px-3 py-2 text-[13px] text-navy focus-visible:outline-2 focus-visible:outline-secondary"
              />
            </div>
          ) : null}
          <label className="flex items-center gap-2 text-[13px] text-navy">
            <input
              type="checkbox"
              checked={absence}
              onChange={(e) => setAbsence(e.target.checked)}
              className="h-4 w-4 rounded border-line"
            />
            A party was absent
          </label>
          <button
            type="submit"
            disabled={busy}
            className="inline-flex min-h-[40px] items-center gap-2 rounded-xl bg-secondary px-4 text-[13px] font-semibold text-white transition-colors hover:bg-navy disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : null}
            Record outcome
          </button>
        </form>
      ) : null}
    </>
  );
}

/* ── Page ────────────────────────────────────────────────── */

export default function LuponCaseDetail({ caseId }) {
  const router = useRouter();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [bundle, setBundle] = useState(null);
  const [assignment, setAssignment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notAssigned, setNotAssigned] = useState(false);
  const [error, setError] = useState(null);
  const [convening, setConvening] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [data, mine] = await Promise.all([
        getCaseBundle(caseId),
        getMyRoleInCase(caseId),
      ]);
      setBundle(data);
      setAssignment(mine);
      setNotAssigned(data === null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  // `load` reports its own failures through `error` and never
  // rejects, so this needs no catch. The async boundary matters: the
  // try/catch that used to be here was dead code whose only action was
  // setNotAssigned(true) — the "this case does not exist" screen, which
  // is exactly the wrong answer to a failed read.
  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  const onConvene = async () => {
    setConvening(true);
    try {
      await convenePangkat(caseId);
      toast.success("The Pangkat is convened. The 15-day period has started.");
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setConvening(false);
    }
  };

  const canLead = isLeadRole(assignment?.my_role);
  const isSecretary = String(assignment?.my_role).toLowerCase() === "secretary";
  const finalMinutes = useMemo(
    () => bundle?.minutes?.find((m) => m.status === "Final") ?? null,
    [bundle]
  );

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center gap-3 text-muted">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
        <span className="text-sm">Loading the case…</span>
      </div>
    );
  }

  // A read that failed is not a case that is missing.
  //
  // Both produce a null bundle, and the branch below used to answer
  // either one with "This case does not exist, or you are not assigned
  // to it" — telling a member their case was gone when the query had
  // simply timed out. The two are now told apart, and a failure gets a
  // retry rather than a wrong fact.
  if (error && !bundle) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-critical-soft text-critical">
          <AlertTriangle className="h-6 w-6" aria-hidden="true" />
        </span>
        <h1 className="mt-4 font-heading text-xl font-bold text-navy">
          This case could not be loaded
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          The connection to the case file failed. This is a technical problem,
          not a missing case — your assignment has not changed.
        </p>
        <p className="mt-4 break-words rounded-xl border border-line bg-alt/60 p-3 text-left font-mono text-[11px] leading-relaxed text-muted">
          {error}
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={load}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-secondary px-5 text-sm font-semibold text-white transition-colors hover:bg-navy"
          >
            <Loader2 className="h-4 w-4" aria-hidden="true" />
            Try again
          </button>
          <Link
            href={LUPON_ROUTES.cases}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-line px-5 text-sm font-semibold text-navy transition-colors hover:bg-alt"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to my cases
          </Link>
        </div>
      </div>
    );
  }

  // "Not found" and "not yours" render the same screen on purpose.
  // Telling them apart would let a member probe for the existence of
  // other people's cases.
  if (notAssigned || !bundle) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-alt text-muted">
          <FileText className="h-6 w-6" aria-hidden="true" />
        </span>
        <h1 className="mt-4 font-heading text-xl font-bold text-navy">
          Case unavailable
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          This case does not exist, or you are not assigned to it.
        </p>
        <Link
          href={LUPON_ROUTES.cases}
          className="mt-6 inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-secondary px-5 text-sm font-semibold text-white transition-colors hover:bg-navy"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to my cases
        </Link>
      </div>
    );
  }

  const {
    complaint,
    hearings,
    attendance,
    minutes,
    outcome,
    extensions,
    panel,
    documents,
    readErrors = [],
  } = bundle;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <button
          type="button"
          onClick={() => router.push(LUPON_ROUTES.cases)}
          className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-secondary hover:underline"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          My cases
        </button>
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-xl border border-critical/30 bg-critical-soft p-4 text-sm text-critical"
        >
          {error}
        </p>
      ) : null}

      {/*
        A section whose query failed is not a section that is empty.
        Saying "no hearing has been set" when the read itself broke
        would put a fact on the case file that nobody recorded.
      */}
      {readErrors.length ? (
        <p
          role="alert"
          className="rounded-xl border border-warning/30 bg-warning-soft p-4 text-sm leading-relaxed text-warning"
        >
          <strong className="font-semibold">Some of this case could not be loaded.</strong>{" "}
          {readErrors.join(" ")} Reload the page; if it keeps happening, tell the Barangay
          Secretary.
        </p>
      ) : null}

      <header className="rounded-2xl border border-line bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[12px] font-semibold text-secondary">
              {complaint.reference_number}
              {/* A case carries two numbers: the tracking reference the
                  portal lists it under, and the Barangay Case No. the
                  official documents are named after. Showing only the
                  first made every document filename look like it
                  belonged to a different case. */}
              {complaint.barangay_case_number
                ? ` · Barangay Case No. ${complaint.barangay_case_number}`
                : ""}
            </p>
            <h1 className="mt-1 font-heading text-2xl font-bold tracking-tight text-navy">
              {complaint.title}
            </h1>
            <p className="mt-1.5 text-[13px] text-muted">
              {/* confirmed_* is the official classification; predicted_* is
                  the AI suggestion and is not a finding. Filtering keeps a
                  complaint with neither from rendering a bare "· filed". */}
              {[
                String(
                  complaint.confirmed_category || complaint.confirmed_case_type || ""
                )
                  .replace(/_/g, " ")
                  .trim(),
                `filed ${formatDate(complaint.submitted_at)}`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <span className="rounded-full bg-alt px-3 py-1 text-[12px] font-semibold capitalize text-muted">
              {String(complaint.current_status ?? "").replace(/_/g, " ")}
            </span>
            <span className="rounded-full bg-secondary/10 px-3 py-1 text-[12px] font-semibold capitalize text-secondary">
              You are {assignment?.my_role ?? "a member"}
            </span>
          </div>
        </div>
        {complaint.description ? (
          <p className="mt-4 whitespace-pre-line border-t border-line pt-4 text-[13px] leading-relaxed text-muted">
            {complaint.description}
          </p>
        ) : null}
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Section icon={CalendarClock} title="Hearings">
            {hearings.length === 0 ? (
              <p className="text-[13px] text-muted">
                No hearing has been set on this case yet.
              </p>
            ) : (
              <ul className="space-y-2.5">
                {hearings.map((h) => (
                  <li
                    key={h.id}
                    className="rounded-xl border border-line p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[13px] font-semibold text-navy">
                        {formatDate(h.hearing_date)} · {formatTime(h.hearing_time)}
                      </p>
                      <span className="rounded-full bg-alt px-2.5 py-1 text-[11px] font-semibold text-muted">
                        {h.status ?? "Scheduled"}
                      </span>
                    </div>
                    <p className="mt-1 text-[12px] text-muted">
                      {h.is_online ? "Online hearing" : (h.venue ?? "Barangay Hall")}
                      {h.hearing_type ? ` · ${h.hearing_type}` : ""}
                    </p>
                    {/* online_link was selected but never rendered, so an
                        online session read as the words "Online hearing"
                        with no way to reach it — the one detail a member
                        running the session needs most. */}
                    {h.is_online ? (
                      h.online_link ? (
                        /^https?:\/\//i.test(h.online_link) ? (
                          <a
                            href={h.online_link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-1.5 inline-flex items-center gap-1.5 break-all text-[12px] font-semibold text-secondary underline-offset-2 hover:underline"
                          >
                            Join the online hearing
                            <span aria-hidden="true">→</span>
                          </a>
                        ) : (
                          // Not a URL — show it verbatim rather than
                          // hand the browser something it cannot open.
                          <span className="mt-1.5 block break-all text-[12px] font-medium text-navy">
                            {h.online_link}
                          </span>
                        )
                      ) : (
                        <span className="mt-1.5 block text-[12px] text-muted">
                          No meeting link has been recorded for this session.
                        </span>
                      )
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section icon={UserCheck} title="Attendance">
            <AttendanceEditor
              hearings={hearings}
              attendance={attendance}
              onSaved={load}
            />
          </Section>

          <Section
            icon={Lock}
            title="Minutes"
            action={
              <Link
                href={LUPON_ROUTES.minutes}
                className="text-[13px] font-semibold text-secondary hover:underline"
              >
                Open minutes
              </Link>
            }
          >
            {minutes.length === 0 ? (
              <p className="text-[13px] text-muted">
                No minutes have been drafted for this case yet.
              </p>
            ) : finalMinutes ? (
              <div>
                <p className="flex items-center gap-2 text-[12px] font-semibold text-success">
                  <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                  Finalised {formatDateTime(finalMinutes.updated_at)}
                </p>
                <p className="mt-2 whitespace-pre-line text-[13px] leading-relaxed text-navy">
                  {finalMinutes.narrative}
                </p>
              </div>
            ) : (
              <ul className="space-y-2">
                {minutes.map((m) => (
                  <li key={m.id} className="rounded-xl border border-line p-3">
                    <p className="text-[12px] font-semibold text-secondary">
                      {m.status}
                    </p>
                    <p className="mt-1 line-clamp-2 text-[13px] text-muted">
                      {m.narrative}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>

        <div className="space-y-6">
          <ClockPanel
            assignment={assignment}
            canLead={canLead}
            onConvene={onConvene}
            busy={convening}
          />

          <Section icon={Scale} title="Outcome">
            <OutcomePanel
              complaintId={caseId}
              canLead={canLead}
              existing={outcome}
              onSaved={load}
            />
            {isSecretary ? (
              <p className="mt-3 text-[11px] text-muted">
                As Secretary you are the only role that can finalise the minutes.
              </p>
            ) : null}
          </Section>

          <Section
            icon={Timer}
            title="Deadline extensions"
            action={
              assignment ? (
                <ExtensionRequest complaintId={caseId} onSaved={load} />
              ) : null
            }
          >
            {extensions.length === 0 ? (
              <p className="text-[13px] text-muted">
                No extension has been requested.
              </p>
            ) : (
              <ul className="space-y-2">
                {extensions.map((ext) => (
                  <li key={ext.id} className="rounded-xl border border-line p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[13px] font-semibold text-navy">
                        +{ext.requested_days} day{ext.requested_days === 1 ? "" : "s"}
                      </p>
                      <span
                        className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                          ext.status === "Approved"
                            ? "bg-success/10 text-success"
                            : ext.status === "Rejected"
                              ? "bg-critical-soft text-critical"
                              : "bg-warning/15 text-navy"
                        }`}
                      >
                        {ext.status}
                      </span>
                    </div>
                    <p className="mt-1 text-[12px] text-muted">{ext.reason}</p>
                    {ext.decision_note ? (
                      <p className="mt-1 text-[12px] text-navy">
                        <AlertTriangle
                          className="mr-1 inline h-3 w-3"
                          aria-hidden="true"
                        />
                        {ext.decision_note}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section icon={Users} title="Panel">
            <ul className="space-y-2">
              {panel.map((p) => {
                const isMe = p.member_id === userId;
                return (
                  <li
                    key={p.id}
                    className="flex items-center justify-between gap-2 rounded-xl border border-line px-3 py-2.5"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-medium text-navy">
                        {isMe ? "You" : `Member ${p.member_id.slice(0, 8)}…`}
                      </span>
                      {p.assigned_at ? (
                        <span className="block text-[11px] text-muted">
                          Since {formatDate(p.assigned_at)}
                        </span>
                      ) : null}
                      {CHOOSER_LABEL[p.selected_by] ? (
                        <span className="block text-[11px] text-muted">
                          {CHOOSER_LABEL[p.selected_by]}
                        </span>
                      ) : null}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="rounded-full bg-alt px-2.5 py-1 text-[11px] font-semibold capitalize text-muted">
                        {p.role}
                      </span>
                      <span
                        className={`rounded-full px-2 py-1 text-[10px] font-semibold ${
                          p.status === "active"
                            ? "bg-success/10 text-success"
                            : "bg-alt text-muted"
                        }`}
                      >
                        {p.status}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 text-[11px] leading-relaxed text-muted">
              Colleagues are shown by a short id rather than a name: the profiles
              table only lets a member read their own row, so this page cannot
              resolve member names to anything. Roles, status and which party
              chose each member are enough to see how the panel was constituted.
            </p>
          </Section>

          {documents.length > 0 ? (
            <Section icon={Paperclip} title="Documents">
              <ul className="space-y-2">
                {documents.map((d) => (
                  <DocumentRow key={d.id} doc={d} />
                ))}
              </ul>
            </Section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
