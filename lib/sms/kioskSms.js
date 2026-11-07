/**
 * Server-side glue between a committed kiosk complaint and the SMS
 * worker.
 *
 * IMPORT ONLY FROM A ROUTE HANDLER. This module talks to Supabase
 * with the service-role key and it holds no credential of its own,
 * but it must never end up in a browser bundle.
 *
 * ── What it does ───────────────────────────────────────────────
 *
 * After kiosk_submit_complaint() has COMMITTED a complaint, this
 * module:
 *
 *   1. makes sure a confirmation job exists for that complaint,
 *   2. asks the edge worker to deliver it now.
 *
 * Step 1 is idempotent. The job row is keyed by
 * (complaint_id, notification_type), so a double-clicked Submit, a
 * retried request, a browser refresh and a replayed offline queue
 * entry all resolve to the same row and can never produce a second
 * message.
 *
 * Step 2 is best effort. If the worker cannot be reached, the job
 * stays pending and the scheduled sweeper picks it up later. A
 * failure here NEVER fails the filing: the complaint, its evidence,
 * its reference number and its tracking QR code are already safe in
 * the database, and a citizen must never lose a filing because a
 * text message could not be queued.
 *
 * ── What it deliberately does not do ────────────────────────────
 *
 * It never sends an SMS itself. It never sees the complainant's
 * mobile number: the job row is written by a database function that
 * reads the complaint row, and the worker reads the recipient from
 * the same place. This server only passes a complaint id around.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import {
  isKioskSmsDispatchEnabled,
  isKioskSmsEnabled,
} from "../../supabase/functions/_shared/kiosk-sms.mjs";

/** Name of the edge function that performs the delivery. */
const FUNCTION_NAME = "send-kiosk-confirmation-sms";

/**
 * How long the filing waits for the worker.
 *
 * Short on purpose. The citizen is standing at the kiosk watching a
 * spinner, and the SMS does not need to arrive before the receipt
 * appears. When the worker is slow the job simply stays pending.
 */
const DISPATCH_TIMEOUT_MS = 8000;

/** How many jobs the worker may pick up in one call. */
const DISPATCH_LIMIT = 5;

/**
 * True when the whole feature is switched off.
 *
 * `KIOSK_SMS_ENABLED=0` keeps the kiosk filing exactly as it was,
 * which is the switch to use while the database migration has not
 * been applied yet.
 */
export function kioskSmsEnabled() {
  return isKioskSmsEnabled(process.env);
}

/** True when the opportunistic dispatch should be skipped. */
export function kioskSmsDispatchEnabled() {
  return isKioskSmsDispatchEnabled(process.env);
}

/** URL of the edge function. */
function functionUrl() {
  if (process.env.KIOSK_SMS_FUNCTION_URL) {
    return process.env.KIOSK_SMS_FUNCTION_URL;
  }
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  return `${base.replace(/\/+$/, "")}/functions/v1/${FUNCTION_NAME}`;
}

/**
 * Ensures a confirmation job exists for a committed complaint.
 *
 * The database function does the work: it reads the persisted
 * reference number and the persisted mobile number out of the
 * complaint row and writes the job. Nothing sensitive travels
 * through this server.
 *
 * @param {{complaintId: string}} params
 * @returns {Promise<{queued: boolean, status: string|null, reason: string|null}>}
 */
export async function enqueueKioskConfirmationSms({ complaintId }) {
  if (!kioskSmsEnabled() || !complaintId) {
    return { queued: false, status: null, reason: "disabled" };
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch (error) {
    console.warn("[kiosk-sms] service credentials are not configured:", error?.message);
    return { queued: false, status: null, reason: "not_configured" };
  }

  try {
    const { data, error } = await admin.rpc("kiosk_enqueue_confirmation_sms", {
      p_complaint_id: complaintId,
    });

    if (error) {
      // PGRST202 means the SQL function is not in the database yet.
      // That is an expected state while the migration is pending and
      // must never break a filing.
      console.warn(
        "[kiosk-sms] could not enqueue the confirmation:",
        error.code || "",
        error.message
      );
      return { queued: false, status: null, reason: error.code || "rpc_failed" };
    }

    const result = data && typeof data === "object" ? data : {};
    return {
      queued: result.queued === true,
      status: typeof result.status === "string" ? result.status : null,
      reason: typeof result.reason === "string" ? result.reason : null,
    };
  } catch (error) {
    console.warn("[kiosk-sms] could not enqueue the confirmation:", error?.message);
    return { queued: false, status: null, reason: "rpc_failed" };
  }
}

/**
 * Asks the edge worker to deliver what is waiting.
 *
 * Best effort by design: a worker that is down, a function that has
 * not been deployed yet or a network hiccup all end the same way —
 * the job stays pending and the sweeper tries again later.
 *
 * @param {{limit?: number}} [options]
 * @returns {Promise<{dispatched: boolean, reason: string|null}>}
 */
export async function dispatchKioskConfirmationSms({ limit = DISPATCH_LIMIT } = {}) {
  if (!kioskSmsEnabled() || !kioskSmsDispatchEnabled()) {
    return { dispatched: false, reason: "disabled" };
  }

  const url = functionUrl();
  const token = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !token) {
    return { dispatched: false, reason: "not_configured" };
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ limit }),
      signal: AbortSignal.timeout(DISPATCH_TIMEOUT_MS),
      cache: "no-store",
    });

    if (!response.ok) {
      console.warn(
        `[kiosk-sms] the worker answered ${response.status}; the job stays queued`
      );
      return { dispatched: false, reason: `worker_status_${response.status}` };
    }

    return { dispatched: true, reason: null };
  } catch (error) {
    console.warn("[kiosk-sms] the worker could not be reached:", error?.message);
    return { dispatched: false, reason: "worker_unreachable" };
  }
}

/**
 * The whole post-commit sequence for one kiosk filing.
 *
 * Called by the submit route AFTER the complaint has been committed.
 * The result of this function never influences whether the filing
 * succeeded.
 *
 * @param {{result: {id?: string, reference_number?: string}}} params
 * @returns {Promise<{queued: boolean, status: string|null, reason: string|null}>}
 */
export async function handleKioskSubmissionSms({ result }) {
  const complaintId = result?.id;
  if (!complaintId) {
    return { queued: false, status: null, reason: "no_complaint_id" };
  }

  const enqueued = await enqueueKioskConfirmationSms({ complaintId });
  if (!enqueued.queued) {
    return enqueued;
  }

  // The job exists. Delivery is attempted immediately; when it does
  // not happen the sweeper takes over.
  await dispatchKioskConfirmationSms();

  return enqueued;
}
