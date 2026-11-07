/**
 * The kiosk SMS worker: claim a job, send it once, record what
 * happened.
 *
 * This file contains NO database code and NO provider code. It is the
 * decision layer, and everything it touches is injected, which is what
 * makes the duplicate-prevention rules testable without a Supabase
 * project and without a single SMS credit.
 *
 * ── The one rule that matters ───────────────────────────────────
 *
 * A complainant may receive AT MOST ONE confirmation SMS per
 * complaint. Three independent things enforce that:
 *
 *   1. There is at most one job row per (complaint_id,
 *      notification_type). A duplicate submission, a retried request
 *      or a replayed offline queue entry all resolve to the SAME row,
 *      so they cannot create a second job.
 *
 *   2. A job is claimed with a compare-and-set. Two workers that
 *      see the same pending row race for it and exactly one wins, so
 *      a repeated invocation cannot send twice.
 *
 *   3. A job whose previous outcome is UNKNOWN is never sent again.
 *      If a worker dies between "provider accepted it" and "job marked
 *      sent", the job is left in 'sending'; when it is found later it
 *      is moved to 'uncertain' and left there. It is never re-sent,
 *      because sending it again could give the citizen a second
 *      identical message. A human decides what happens next.
 *
 * Retries happen only for outcomes the provider explicitly refused
 * (rate limit, credit top-up in progress, a 5xx from the gateway) and
 * only a bounded number of times.
 *
 * ── The database adapter contract ───────────────────────────────
 *
 *   listCandidates({ now, limit })            -> job rows
 *   claim(candidate, { now })                 -> claimed job row | null
 *   getComplaint(complaintId)                 -> complaint row | null
 *   reapStale({ now, staleBefore })           -> number of jobs reaped
 *   markSent(job, {...}) / markRetry / markFailed / markUncertain /
 *   markSkipped
 */

import {
  buildKioskConfirmationMessage,
  normalizePhMobile,
  toProviderRecipient,
} from "./kiosk-sms.mjs";

/** The states a job row can be in. */
export const SMS_JOB_STATUS = {
  PENDING: "pending",
  SENDING: "sending",
  RETRY: "retry",
  SENT: "sent",
  FAILED: "failed",
  UNCERTAIN: "uncertain",
  SKIPPED: "skipped",
};

/** Bounded retry schedule in ms. The last entry is repeated. */
export const DEFAULT_BACKOFF_MS = [60_000, 300_000, 900_000, 1_800_000];

/** A job that has been 'sending' longer than this is considered lost. */
export const DEFAULT_STALE_MS = 5 * 60 * 1000;

/** How many attempts a job gets before it is failed for good. */
export const DEFAULT_MAX_ATTEMPTS = 5;

function backoffFor(attempts, backoffMs) {
  const list = backoffMs && backoffMs.length ? backoffMs : DEFAULT_BACKOFF_MS;
  const index = Math.min(Math.max(attempts - 1, 0), list.length - 1);
  return list[index];
}

/**
 * Runs one pass of the worker.
 *
 * @param {object} options
 * @param {object} options.db      Database adapter (see the contract above).
 * @param {Function} options.send  `send({ recipient, message })` returning
 *                                 `{ ok: true, providerMessageId }` or
 *                                 `{ ok: false, kind, code, message }`.
 * @param {number} [options.limit]        Jobs to consider in this pass.
 * @param {number} [options.maxAttempts]  Bounded retries per job.
 * @param {number} [options.staleMs]      Age at which a 'sending' job
 *                                        is considered lost.
 * @param {number[]} [options.backoffMs]  Retry schedule.
 * @param {Function} [options.now]        Clock, returns ms.
 * @param {boolean} [options.dryRun]       Build the messages but send
 *                                         nothing and write nothing.
 * @param {object} [options.logger]
 * @returns {Promise<{processed: number, sent: number, failed: number,
 *                    uncertain: number, skipped: number, retried: number,
 *                    results: object[]}>}
 */
export async function runKioskSmsWorker({
  db,
  send,
  limit = 5,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  staleMs = DEFAULT_STALE_MS,
  backoffMs = DEFAULT_BACKOFF_MS,
  now = () => Date.now(),
  dryRun = false,
  logger = console,
} = {}) {
  const summary = {
    processed: 0,
    sent: 0,
    failed: 0,
    uncertain: 0,
    skipped: 0,
    retried: 0,
    results: [],
  };

  if (!db || typeof send !== "function") {
    throw new Error("runKioskSmsWorker needs a database adapter and a sender");
  }

  const nowMs = now();
  const nowIso = new Date(nowMs).toISOString();
  const staleBefore = new Date(nowMs - staleMs).toISOString();

  // A worker that died mid-send leaves a 'sending' row behind. The
  // outcome of that send is unknown, so the row is retired as
  // 'uncertain' instead of being tried again.
  if (!dryRun && typeof db.reapStale === "function") {
    const reaped = await db.reapStale({ now: nowIso, staleBefore });
    if (reaped) {
      logger.log?.(`[kiosk-sms] retired ${reaped} stale job(s) as uncertain`);
      summary.uncertain += reaped;
    }
  }

  const candidates = await db.listCandidates({ now: nowIso, limit });

  for (const candidate of candidates || []) {
    // A dry run does not CLAIM anything. Claiming moves the row to
    // 'sending', and a row left in 'sending' is later retired as
    // 'uncertain' and never sent — so a dry run that claimed a job
    // would silently destroy the very message it was pretending to
    // check.
    const job = dryRun
      ? candidate
      : await db.claim(candidate, { now: nowIso, staleBefore });

    if (!job) {
      // Another worker got there first. Not an error: the point of
      // the compare-and-set is that exactly one of them proceeds.
      continue;
    }

    const attempt = Number(job.attempts || 1);
    const complaint = await db.getComplaint(job.complaint_id);

    if (!complaint) {
      summary.processed += 1;
      summary.failed += 1;
      summary.results.push({
        id: job.id,
        reference: job.reference_number || null,
        outcome: "failed",
        code: "complaint_missing",
      });
      if (!dryRun) {
        await db.markFailed(job, {
          code: "complaint_missing",
          message: "the complaint row could not be read",
        });
      }
      continue;
    }

    // The recipient is the one persisted on the complaint, never a
    // value carried by the caller.
    const mobile = normalizePhMobile(complaint.mobile_number);
    if (!mobile) {
      summary.processed += 1;
      summary.skipped += 1;
      summary.results.push({
        id: job.id,
        reference: complaint.reference_number || null,
        outcome: "skipped",
        code: "invalid_recipient",
      });
      if (!dryRun) {
        await db.markSkipped(job, {
          code: "invalid_recipient",
          message: "the complaint carries no valid Philippine mobile number",
        });
      }
      continue;
    }

    const reference = String(complaint.reference_number || "").trim();
    if (!reference) {
      summary.processed += 1;
      summary.failed += 1;
      summary.results.push({
        id: job.id,
        reference: null,
        outcome: "failed",
        code: "reference_missing",
      });
      if (!dryRun) {
        await db.markFailed(job, {
          code: "reference_missing",
          message: "the complaint carries no reference number",
        });
      }
      continue;
    }

    const message = buildKioskConfirmationMessage({
      referenceNumber: reference,
      status: complaint.current_status,
    });

    const recipient = toProviderRecipient(mobile, {
      format: job.recipient_format || "63",
    });

    if (dryRun) {
      // Nothing is sent and nothing is written. This is how the exact
      // text is checked without spending a credit.
      summary.processed += 1;
      summary.results.push({
        id: job.id,
        reference,
        outcome: "dry_run",
        code: "dry_run",
        message,
      });
      continue;
    }

    const response = await send({ recipient, message, referenceNumber: reference });

    if (response?.ok) {
      summary.processed += 1;
      summary.sent += 1;
      summary.results.push({
        id: job.id,
        reference,
        outcome: "sent",
        code: "accepted",
        providerMessageId: response.providerMessageId || null,
      });
      await db.markSent(job, {
        providerMessageId: response.providerMessageId || null,
        providerStatus: response.providerStatus || null,
        message,
        sentAt: new Date(now()).toISOString(),
      });
      continue;
    }

    const kind = response?.kind || "permanent";
    const code = response?.code || "provider_error";
    const detail = response?.message || "";

    if (kind === "uncertain") {
      // We do not know whether the provider took it. Sending again
      // could duplicate the message, so this job stops here.
      summary.processed += 1;
      summary.uncertain += 1;
      summary.results.push({
        id: job.id,
        reference,
        outcome: "uncertain",
        code,
      });
      await db.markUncertain(job, { code, message: detail });
      continue;
    }

    if (kind === "retryable" && attempt < maxAttempts) {
      const nextAttemptAt = new Date(
        now() + backoffFor(attempt, backoffMs)
      ).toISOString();
      summary.processed += 1;
      summary.retried += 1;
      summary.results.push({
        id: job.id,
        reference,
        outcome: "retry",
        code,
        nextAttemptAt,
      });
      await db.markRetry(job, { code, message: detail, nextAttemptAt });
      continue;
    }

    summary.processed += 1;
    summary.failed += 1;
    summary.results.push({
      id: job.id,
      reference,
      outcome: "failed",
      code,
    });
    await db.markFailed(job, { code, message: detail });
  }

  return summary;
}
