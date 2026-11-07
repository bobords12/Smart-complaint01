/**
 * send-kiosk-confirmation-sms
 *
 * The server-side worker that delivers the kiosk confirmation SMS.
 *
 * It runs on Supabase's edge runtime, so it does not depend on a
 * running Next.js server, on localhost, or on anybody remembering to
 * press a button. It can be called by the kiosk API right after a
 * complaint is committed, and by a scheduled job when that call did
 * not happen.
 *
 * ── Who may call it ─────────────────────────────────────────────
 *
 * JWT verification is ON (see supabase/config.toml), so the Supabase
 * gateway has already checked the signature and the expiry of the
 * bearer token before this code runs. On top of that the function
 * itself requires the token's role to be `service_role`: a public
 * caller, an `anon` key or a resident's session may not run it.
 *
 * The function never accepts a recipient or a message body. It reads
 * the complaint row and the job row, builds the fixed text itself and
 * sends it to the number persisted on the complaint. There is no
 * public path by which an arbitrary phone number can be messaged.
 *
 * ── Secrets ─────────────────────────────────────────────────────
 *
 *   PHILSMS_API_TOKEN   required, the PhilSMS API token
 *   PHILSMS_SENDER_ID   required, the approved sender id
 *
 * Optional:
 *
 *   PHILSMS_API_BASE_URL     defaults to the New Dashboard base URL
 *   PHILSMS_RECIPIENT_FORMAT "63" (default) or "+63"
 *   PHILSMS_TIMEOUT_MS       defaults to 15000
 *
 * ── Request body ────────────────────────────────────────────────
 *
 *   { "limit": 5, "dry_run": false }
 *
 * `dry_run` builds the messages and returns them without sending
 * anything and without writing anything. It is how the exact wording
 * is verified while the account has no credits.
 */

import { createClient } from "npm:@supabase/supabase-js@2";

import {
  KIOSK_SMS_NOTIFICATION_TYPE,
  PHILSMS_DEFAULT_BASE_URL,
  createPhilsmsSender,
} from "../_shared/kiosk-sms.mjs";
import {
  runKioskSmsWorker,
  type KioskSmsDbAdapter,
  type SmsJobRow,
} from "../_shared/kiosk-sms-worker.mjs";

const OUTBOX_TABLE = "kiosk_sms_outbox";
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 25;

interface WorkerRequest {
  limit?: number;
  dry_run?: boolean;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

/**
 * Decodes the payload of a JWT without verifying it.
 *
 * The signature has already been verified by the Supabase gateway
 * (verify_jwt is on). This only reads the claims so the role can be
 * checked, and the role check is the authorization boundary.
 */
function decodeJwtClaims(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const json = atob(
      parts[1].replace(/-/g, "+").replace(/_/g, "/")
    );
    const claims = JSON.parse(json);
    return claims && typeof claims === "object" ? claims : null;
  } catch {
    return null;
  }
}

/**
 * Refuses anybody whose token is not a service-role token.
 *
 * A kiosk complaint is anonymous, so there is no end user who has a
 * legitimate reason to run this worker.
 */
function assertServiceRole(request: Request): void {
  const header = request.headers.get("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) {
    throw new HttpError(401, "missing_token", "a bearer token is required");
  }

  const claims = decodeJwtClaims(match[1].trim());
  if (!claims) {
    throw new HttpError(401, "invalid_token", "the token could not be read");
  }

  const exp = Number(claims.exp);
  if (Number.isFinite(exp) && exp * 1000 <= Date.now()) {
    throw new HttpError(401, "expired_token", "the token has expired");
  }

  if (claims.role !== "service_role") {
    throw new HttpError(
      403,
      "forbidden_role",
      "only a service-role token may run this worker"
    );
  }
}

class HttpError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

/**
 * The Supabase adapter for the worker.
 *
 * The claim is a compare-and-set: the UPDATE only matches a row that
 * still carries the status the candidate was read with, so two
 * workers racing for the same pending job produce exactly one winner
 * and therefore exactly one SMS.
 */
function createDbAdapter(admin: ReturnType<typeof createClient>): KioskSmsDbAdapter {
  const fail = (error: { message?: string } | null, what: string) => {
    throw new Error(`${what} failed: ${error?.message || "unknown error"}`);
  };

  return {
    async listCandidates({ now, limit }) {
      const { data, error } = await admin
        .from(OUTBOX_TABLE)
        .select("*")
        .eq("notification_type", KIOSK_SMS_NOTIFICATION_TYPE)
        .or(
          `status.eq.pending,and(status.eq.retry,next_attempt_at.lte."${now}")`
        )
        .order("created_at", { ascending: true })
        .limit(limit);

      if (error) fail(error, "listCandidates");
      return (data ?? []) as SmsJobRow[];
    },

    async claim(candidate, { now }) {
      const attempts = Number(candidate.attempts || 0) + 1;

      let query = admin
        .from(OUTBOX_TABLE)
        .update({
          status: "sending",
          locked_at: now,
          updated_at: now,
          attempts,
        })
        .eq("id", candidate.id)
        .eq("status", candidate.status);

      if (candidate.status === "retry") {
        query = query.lte("next_attempt_at", now);
      }

      const { data, error } = await query.select();
      if (error) fail(error, "claim");

      const claimed = (data ?? [])[0] as SmsJobRow | undefined;
      return claimed ?? null;
    },

    async getComplaint(complaintId) {
      const { data, error } = await admin
        .from("complaints")
        .select("id, reference_number, current_status, complainant_snapshot")
        .eq("id", complaintId)
        .maybeSingle();

      if (error) fail(error, "getComplaint");
      if (!data) return null;

      const snapshot =
        data.complainant_snapshot && typeof data.complainant_snapshot === "object"
          ? (data.complainant_snapshot as Record<string, unknown>)
          : {};

      return {
        id: String(data.id),
        reference_number: data.reference_number ? String(data.reference_number) : null,
        current_status: data.current_status ? String(data.current_status) : null,
        mobile_number:
          typeof snapshot.mobile_number === "string" ? snapshot.mobile_number : null,
      };
    },

    async reapStale({ now, staleBefore }) {
      // A job that has been 'sending' for too long belongs to a worker
      // that died. The outcome of that send is unknown, so the job is
      // retired as 'uncertain' and never sent again.
      const { data, error } = await admin
        .from(OUTBOX_TABLE)
        .update({
          status: "uncertain",
          last_error_code: "worker_lost",
          last_error_message:
            "the worker stopped before the provider answered; the message was not resent",
          updated_at: now,
        })
        .eq("status", "sending")
        .lt("locked_at", staleBefore)
        .select("id");

      if (error) fail(error, "reapStale");
      return (data ?? []).length;
    },

    async markSent(job, details) {
      const { error } = await admin
        .from(OUTBOX_TABLE)
        .update({
          status: "sent",
          provider_message_id: details.providerMessageId,
          provider_status: details.providerStatus,
          message: details.message,
          sent_at: details.sentAt,
          updated_at: details.sentAt,
          last_error_code: null,
          last_error_message: null,
        })
        .eq("id", job.id);
      if (error) fail(error, "markSent");
    },

    async markRetry(job, details) {
      const { error } = await admin
        .from(OUTBOX_TABLE)
        .update({
          status: "retry",
          next_attempt_at: details.nextAttemptAt,
          last_error_code: details.code,
          last_error_message: details.message,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id);
      if (error) fail(error, "markRetry");
    },

    async markFailed(job, details) {
      const { error } = await admin
        .from(OUTBOX_TABLE)
        .update({
          status: "failed",
          last_error_code: details.code,
          last_error_message: details.message,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id);
      if (error) fail(error, "markFailed");
    },

    async markUncertain(job, details) {
      const { error } = await admin
        .from(OUTBOX_TABLE)
        .update({
          status: "uncertain",
          last_error_code: details.code,
          last_error_message: details.message,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id);
      if (error) fail(error, "markUncertain");
    },

    async markSkipped(job, details) {
      const { error } = await admin
        .from(OUTBOX_TABLE)
        .update({
          status: "skipped",
          last_error_code: details.code,
          last_error_message: details.message,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id);
      if (error) fail(error, "markSkipped");
    },
  };
}

Deno.serve(async (request: Request) => {
  try {
    assertServiceRole(request);

    if (request.method !== "POST") {
      throw new HttpError(405, "method_not_allowed", "use POST");
    }

    let payload: WorkerRequest = {};
    try {
      const text = await request.text();
      payload = text ? JSON.parse(text) : {};
    } catch {
      throw new HttpError(400, "invalid_body", "the request body is not JSON");
    }

    const dryRun = payload.dry_run === true;
    const limit = Math.min(
      Math.max(Number(payload.limit) || DEFAULT_LIMIT, 1),
      MAX_LIMIT
    );

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      throw new HttpError(
        500,
        "not_configured",
        "the Supabase service credentials are not available to this function"
      );
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const apiToken = Deno.env.get("PHILSMS_API_TOKEN");
    const senderId = Deno.env.get("PHILSMS_SENDER_ID");
    const baseUrl = Deno.env.get("PHILSMS_API_BASE_URL") || PHILSMS_DEFAULT_BASE_URL;
    const recipientFormat =
      Deno.env.get("PHILSMS_RECIPIENT_FORMAT") === "+63" ? "+63" : "63";
    const timeoutMs = Number(Deno.env.get("PHILSMS_TIMEOUT_MS") || 15000);

    // A dry run does not need credentials: it never calls the
    // provider. A real run does, and says so plainly instead of
    // failing later with an opaque error.
    if (!dryRun && (!apiToken || !senderId)) {
      throw new HttpError(
        500,
        "not_configured",
        "PHILSMS_API_TOKEN and PHILSMS_SENDER_ID must be set as function secrets"
      );
    }

    const send = createPhilsmsSender({
      apiToken: apiToken || "",
      senderId: senderId || "",
      baseUrl,
      recipientFormat,
      timeoutMs,
    });

    const db = createDbAdapter(admin);

    const summary = await runKioskSmsWorker({
      db,
      send,
      limit,
      dryRun,
      logger: console,
    });

    // The recipient is deliberately absent from the response. The
    // reference number is enough to identify the job and is a value
    // the complainant already holds.
    return json({
      ok: true,
      provider: "philsms",
      dry_run: dryRun,
      processed: summary.processed,
      sent: summary.sent,
      retried: summary.retried,
      failed: summary.failed,
      uncertain: summary.uncertain,
      skipped: summary.skipped,
      results: summary.results,
    });
  } catch (error) {
    if (error instanceof HttpError) {
      return json({ ok: false, code: error.code, message: error.message }, error.status);
    }
    // Never echo the message: it can carry provider internals. The
    // credential is never part of it either, but the rule is simple
    // enough to keep.
    console.error("[kiosk-sms] worker error:", (error as Error)?.message);
    return json(
      { ok: false, code: "worker_error", message: "the SMS worker could not complete" },
      500
    );
  }
});
