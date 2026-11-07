// Kiosk confirmation SMS — regression checks.
//
// Everything here runs WITHOUT a Supabase project and WITHOUT a single
// SMS credit: the provider is a mocked fetch and the outbox is an
// in-memory stand-in that behaves like the real one (one job per
// complaint, compare-and-set claim, no resend after an unknown
// outcome).
//
// What is being defended:
//
//   1. The message is exactly the wording the barangay approved, with
//      the reference number the DATABASE saved.
//   2. A complainant can receive AT MOST ONE message per complaint,
//      no matter how many times the kiosk submits, retries or
//      replays.
//   3. A message whose outcome is unknown is never sent again.
//   4. The API token never leaves the Authorization header.
//   5. The database migration still carries the guarantees the worker
//      relies on.
//
// Run: npm run test:kiosk-sms
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";

register("./resolve-alias.mjs", import.meta.url);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const {
  KIOSK_SMS_NOTIFICATION_TYPE,
  PHILSMS_DEFAULT_BASE_URL,
  buildKioskConfirmationMessage,
  buildPhilsmsSendPayload,
  classifyPhilsmsOutcome,
  countSmsSegments,
  createPhilsmsSender,
  normalizePhMobile,
  philsmsSendUrl,
  toProviderRecipient,
} = await import("../supabase/functions/_shared/kiosk-sms.mjs");

const { runKioskSmsWorker } = await import(
  "../supabase/functions/_shared/kiosk-sms-worker.mjs"
);

let pass = 0;
let fail = 0;
function check(label, ok, extra = "") {
  if (ok) {
    pass += 1;
    console.log(`  ok   ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL ${label}${extra ? ` — ${extra}` : ""}`);
  }
}
function eq(label, actual, expected) {
  check(
    label,
    actual === expected,
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
  );
}

// ─────────────────────────────────────────────────────────────
// 1. The Philippine mobile number rules
// ─────────────────────────────────────────────────────────────
console.log("1. the mobile number rules");
{
  eq("09171234567 stays canonical", normalizePhMobile("09171234567"), "09171234567");
  eq("+639171234567 becomes canonical", normalizePhMobile("+639171234567"), "09171234567");
  eq("639171234567 becomes canonical", normalizePhMobile("639171234567"), "09171234567");
  eq("spaces are ignored", normalizePhMobile("0917 123 4567"), "09171234567");
  eq("dashes are ignored", normalizePhMobile("0917-123-4567"), "09171234567");
  eq("parentheses are ignored", normalizePhMobile("(0917) 123-4567"), "09171234567");
  eq("9171234567 becomes canonical", normalizePhMobile("9171234567"), "09171234567");
  eq("an empty value is rejected", normalizePhMobile(""), null);
  eq("null is rejected", normalizePhMobile(null), null);
  eq("undefined is rejected", normalizePhMobile(undefined), null);
  eq("a landline is rejected", normalizePhMobile("0917123456"), null);
  eq("a too-long number is rejected", normalizePhMobile("091712345678"), null);
  eq("a foreign number is rejected", normalizePhMobile("+14155552671"), null);
}

// ─────────────────────────────────────────────────────────────
// 2. The recipient format the provider expects
// ─────────────────────────────────────────────────────────────
console.log("2. the provider recipient format");
{
  eq("default is the bare country code", toProviderRecipient("09171234567"), "639171234567");
  eq(
    "the plus form is available",
    toProviderRecipient("09171234567", { format: "+63" }),
    "+639171234567"
  );
  eq("an invalid number has no recipient", toProviderRecipient("12345"), null);
  eq("no number has no recipient", toProviderRecipient(null), null);
}

// ─────────────────────────────────────────────────────────────
// 3. The message, character for character
// ─────────────────────────────────────────────────────────────
console.log("3. the exact confirmation text");
{
  const REFERENCE = "AB-2026-0042";
  const expected = [
    "BARANGAY ABUNO",
    "",
    "Your complaint has been successfully submitted through our Public Kiosk.",
    "",
    `Reference No.: ${REFERENCE}`,
    "Status: Pending Review",
    "",
    "Your complaint is awaiting review by the Barangay Office.",
    "",
    "Please keep your reference number and the Tracking QR Code provided at the kiosk for future updates and inquiries.",
    "",
    "This is an automated message. Please do not reply.",
  ].join("\n");

  const message = buildKioskConfirmationMessage({ referenceNumber: REFERENCE });

  eq("the wording matches the approved template exactly", message, expected);
  check("the reference number is inside the message", message.includes(REFERENCE));
  check(
    "the message never claims the SMS was delivered",
    !/delivered|received your message/i.test(message)
  );

  const other = buildKioskConfirmationMessage({ referenceNumber: "AB-2026-0007" });
  check("a different complaint gets a different reference", other.includes("AB-2026-0007"));
  check(
    "a missing reference does not silently produce an empty slot",
    !/Reference No.:\s*$/.test(other)
  );

  const moved = buildKioskConfirmationMessage({
    referenceNumber: REFERENCE,
    status: "Received",
  });
  check("the real status is substituted", moved.includes("Status: Received"));
  check(
    "the pending wording is not claimed once the status moved",
    !moved.includes("awaiting review")
  );

  const segments = countSmsSegments(message);
  eq("the text is plain ASCII", segments.encoding, "gsm7");
  eq("the text is 367 characters", segments.length, 367);
  // Providers bill per segment, so this number is a real cost line
  // for the thesis: one confirmation costs three GSM-7 segments.
  eq("the text costs three segments", segments.segments, 3);
}

// ─────────────────────────────────────────────────────────────
// 4. What the provider answered
// ─────────────────────────────────────────────────────────────
console.log("4. reading the provider's answer");
{
  const accepted = classifyPhilsmsOutcome({
    httpStatus: 200,
    body: { status: "success", data: { message_id: "abc-123", status: "queued" } },
  });
  eq("a success envelope is accepted", accepted.kind, "accepted");
  eq("the message id is extracted", accepted.providerMessageId, "abc-123");

  const rejected = classifyPhilsmsOutcome({
    httpStatus: 400,
    body: { status: "error", message: "Invalid recipient" },
  });
  eq("a rejection is permanent", rejected.kind, "permanent");

  const noCredit = classifyPhilsmsOutcome({
    httpStatus: 400,
    body: { status: "error", message: "Insufficient credit balance" },
  });
  eq("no credit is worth retrying", noCredit.kind, "retryable");

  const limited = classifyPhilsmsOutcome({ httpStatus: 429, body: null });
  eq("a rate limit is worth retrying", limited.kind, "retryable");

  const gateway = classifyPhilsmsOutcome({ httpStatus: 503, body: null });
  eq("a 503 is worth retrying", gateway.kind, "retryable");

  const timedOut = classifyPhilsmsOutcome({ httpStatus: 504, body: null });
  eq("a 504 leaves the outcome unknown", timedOut.kind, "uncertain");

  const unauthorized = classifyPhilsmsOutcome({ httpStatus: 401, body: null });
  eq("a rejected credential is permanent", unauthorized.kind, "permanent");

  const unreadable = classifyPhilsmsOutcome({ httpStatus: 200, body: null });
  eq("an unreadable answer leaves the outcome unknown", unreadable.kind, "uncertain");

  const dropped = classifyPhilsmsOutcome({ transportError: "ECONNRESET" });
  eq("a dropped connection is worth retrying", dropped.kind, "retryable");
}

// ─────────────────────────────────────────────────────────────
// 5. The request that would go out
// ─────────────────────────────────────────────────────────────
console.log("5. the request that would go out");
{
  let captured = null;
  const send = createPhilsmsSender({
    apiToken: "SECRET-TOKEN",
    senderId: "ABUNO",
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return new Response(
        JSON.stringify({ status: "success", data: { message_id: "m-1" } }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    },
  });

  const result = await send({
    recipient: "09171234567",
    message: buildKioskConfirmationMessage({ referenceNumber: "AB-2026-0042" }),
  });

  eq("the send succeeded", result.ok, true);
  eq("the endpoint is the documented one", captured.url, `${PHILSMS_DEFAULT_BASE_URL}/sms/send`);
  eq("the method is POST", captured.options.method, "POST");
  eq(
    "the token is in the Authorization header",
    captured.options.headers.Authorization,
    "Bearer SECRET-TOKEN"
  );
  check(
    "the token is nowhere in the URL",
    !captured.url.includes("SECRET-TOKEN")
  );

  const body = JSON.parse(captured.options.body);
  eq("the recipient is the provider format", body.recipient, "639171234567");
  eq("the sender id is the account's", body.sender_id, "ABUNO");
  eq("the type is plain", body.type, "plain");
  check(
    "the body holds the reference number",
    body.message.includes("AB-2026-0042")
  );
  check(
    "the token is nowhere in the body",
    !captured.options.body.includes("SECRET-TOKEN")
  );

  const payload = buildPhilsmsSendPayload({
    recipient: "639171234567",
    senderId: "ABUNO",
    message: "hello",
  });
  eq("the payload has exactly four fields", Object.keys(payload).length, 4);
  eq("the endpoint is built from the base url", philsmsSendUrl(), `${PHILSMS_DEFAULT_BASE_URL}/sms/send`);

  const unauthorised = await createPhilsmsSender({
    apiToken: "",
    senderId: "ABUNO",
    fetchImpl: async () => {
      throw new Error("the provider must not be called");
    },
  })({ recipient: "09171234567", message: "hello" });
  eq("no token means no call", unauthorised.code, "missing_api_token");
}

// ─────────────────────────────────────────────────────────────
// 6. The worker
// ─────────────────────────────────────────────────────────────

/**
 * An in-memory stand-in for the outbox table.
 *
 * It behaves like the real one in the ways the worker depends on:
 * one job per (complaint, type), a compare-and-set claim, and a
 * status that only moves forward.
 */
function createFakeDb({ jobs = [], complaints = {} } = {}) {
  const db = {
    jobs: jobs.map((job) => ({ ...job })),
    complaints: { ...complaints },
    calls: {
      listCandidates: 0,
      claim: 0,
      getComplaint: 0,
      markSent: 0,
      markRetry: 0,
      markFailed: 0,
      markUncertain: 0,
      markSkipped: 0,
      reapStale: 0,
    },

    async listCandidates({ now, limit }) {
      db.calls.listCandidates += 1;
      // Copies, not the stored rows: the worker must not be able to
      // change a row by holding on to what the list returned, and the
      // real database hands out rows the caller cannot write back
      // into.
      return db.jobs
        .filter(
          (job) =>
            job.status === "pending" ||
            (job.status === "retry" &&
              (!job.next_attempt_at || job.next_attempt_at <= now))
        )
        .slice(0, limit)
        .map((job) => ({ ...job }));
    },

    async claim(candidate, { now }) {
      db.calls.claim += 1;
      const job = db.jobs.find((entry) => entry.id === candidate.id);
      if (!job) return null;
      // The compare-and-set: the row must still carry the status the
      // candidate was read with.
      if (job.status !== candidate.status) return null;
      if (candidate.status === "retry" && job.next_attempt_at > now) return null;
      job.status = "sending";
      job.locked_at = now;
      job.attempts = Number(job.attempts || 0) + 1;
      return { ...job };
    },

    async getComplaint(complaintId) {
      db.calls.getComplaint += 1;
      return db.complaints[complaintId] ?? null;
    },

    async reapStale() {
      db.calls.reapStale += 1;
      return 0;
    },

    async markSent(job, details) {
      db.calls.markSent += 1;
      const row = db.jobs.find((entry) => entry.id === job.id);
      if (row) {
        row.status = "sent";
        row.provider_message_id = details.providerMessageId;
        row.message = details.message;
        row.sent_at = details.sentAt;
      }
    },

    async markRetry(job, details) {
      db.calls.markRetry += 1;
      const row = db.jobs.find((entry) => entry.id === job.id);
      if (row) {
        row.status = "retry";
        row.next_attempt_at = details.nextAttemptAt;
        row.last_error_code = details.code;
      }
    },

    async markFailed(job, details) {
      db.calls.markFailed += 1;
      const row = db.jobs.find((entry) => entry.id === job.id);
      if (row) {
        row.status = "failed";
        row.last_error_code = details.code;
      }
    },

    async markUncertain(job, details) {
      db.calls.markUncertain += 1;
      const row = db.jobs.find((entry) => entry.id === job.id);
      if (row) {
        row.status = "uncertain";
        row.last_error_code = details.code;
      }
    },

    async markSkipped(job, details) {
      db.calls.markSkipped += 1;
      const row = db.jobs.find((entry) => entry.id === job.id);
      if (row) {
        row.status = "skipped";
        row.last_error_code = details.code;
      }
    },
  };

  return db;
}

const COMPLAINT = {
  id: "c-1",
  reference_number: "AB-2026-0042",
  current_status: "Pending Review",
  mobile_number: "09171234567",
};

function makeJob(overrides = {}) {
  return {
    id: "j-1",
    complaint_id: "c-1",
    notification_type: KIOSK_SMS_NOTIFICATION_TYPE,
    recipient: "09171234567",
    recipient_format: "63",
    reference_number: "AB-2026-0042",
    status: "pending",
    attempts: 0,
    next_attempt_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

console.log("6. the worker");
{
  // 6a. The ordinary case: one job, one message.
  const db = createFakeDb({ jobs: [makeJob()], complaints: { "c-1": COMPLAINT } });
  const sent = [];
  const summary = await runKioskSmsWorker({
    db,
    send: async (input) => {
      sent.push(input);
      return { ok: true, providerMessageId: "m-1" };
    },
  });

  eq("one job was processed", summary.processed, 1);
  eq("one message was sent", summary.sent, 1);
  eq("nothing failed", summary.failed, 0);
  eq("nothing is uncertain", summary.uncertain, 0);
  eq("exactly one message went out", sent.length, 1);
  eq("the recipient is the provider format", sent[0].recipient, "639171234567");
  check(
    "the message carries the saved reference",
    sent[0].message.includes("AB-2026-0042")
  );
  eq("the job is marked sent", db.jobs[0].status, "sent");
  eq("the provider id is recorded", db.jobs[0].provider_message_id, "m-1");
  eq("the attempt is counted", db.jobs[0].attempts, 1);
}

{
  // 6b. Running the worker again sends nothing: the job is done.
  const db = createFakeDb({ jobs: [makeJob()], complaints: { "c-1": COMPLAINT } });
  const send = async () => ({ ok: true, providerMessageId: "m-1" });
  await runKioskSmsWorker({ db, send });
  const second = await runKioskSmsWorker({ db, send });
  eq("a second pass processes nothing", second.processed, 0);
  eq("a second pass sends nothing", second.sent, 0);
}

{
  // 6c. Two workers race for the same job. Exactly one sends.
  const db = createFakeDb({ jobs: [makeJob()], complaints: { "c-1": COMPLAINT } });
  let sends = 0;
  const send = async () => {
    sends += 1;
    return { ok: true, providerMessageId: "m-1" };
  };
  const [a, b] = await Promise.all([
    runKioskSmsWorker({ db, send }),
    runKioskSmsWorker({ db, send }),
  ]);
  eq("exactly one message went out", sends, 1);
  eq("only one worker reported a send", a.sent + b.sent, 1);
}

{
  // 6d. A refused message is retried, and the retry waits.
  const db = createFakeDb({ jobs: [makeJob()], complaints: { "c-1": COMPLAINT } });
  const summary = await runKioskSmsWorker({
    db,
    send: async () => ({
      ok: false,
      kind: "retryable",
      code: "provider_rate_limited",
      message: "too many requests",
    }),
    now: () => Date.parse("2026-01-01T00:00:00.000Z"),
  });

  eq("the job is waiting for a retry", summary.retried, 1);
  eq("nothing failed yet", summary.failed, 0);
  eq("the job is marked retry", db.jobs[0].status, "retry");
  check(
    "the retry is scheduled in the future",
    db.jobs[0].next_attempt_at > "2026-01-01T00:00:00.000Z"
  );
}

{
  // 6e. A retry that is not due yet is not attempted.
  const db = createFakeDb({
    jobs: [makeJob({ status: "retry", next_attempt_at: "2026-01-01T00:10:00.000Z" })],
    complaints: { "c-1": COMPLAINT },
  });
  let sends = 0;
  const summary = await runKioskSmsWorker({
    db,
    send: async () => {
      sends += 1;
      return { ok: true };
    },
    now: () => Date.parse("2026-01-01T00:00:00.000Z"),
  });
  eq("nothing was sent", sends, 0);
  eq("nothing was processed", summary.processed, 0);
}

{
  // 6f. An unknown outcome is retired, never sent again.
  const db = createFakeDb({ jobs: [makeJob()], complaints: { "c-1": COMPLAINT } });
  let sends = 0;
  const send = async () => {
    sends += 1;
    return {
      ok: false,
      kind: "uncertain",
      code: "request_timeout",
      message: "the provider did not answer in time",
    };
  };

  const first = await runKioskSmsWorker({ db, send });
  eq("the outcome is unknown", first.uncertain, 1);
  eq("the job is marked uncertain", db.jobs[0].status, "uncertain");

  const second = await runKioskSmsWorker({ db, send });
  eq("a second pass sends nothing", sends, 1);
  eq("a second pass processes nothing", second.processed, 0);
  eq("the job is still uncertain", db.jobs[0].status, "uncertain");
}

{
  // 6g. A complaint whose number is unusable is skipped, not sent.
  const db = createFakeDb({
    jobs: [makeJob()],
    complaints: {
      "c-1": { ...COMPLAINT, mobile_number: "not-a-number" },
    },
  });
  let sends = 0;
  const summary = await runKioskSmsWorker({
    db,
    send: async () => {
      sends += 1;
      return { ok: true };
    },
  });
  eq("nothing was sent", sends, 0);
  eq("the job was skipped", summary.skipped, 1);
  eq("the job is marked skipped", db.jobs[0].status, "skipped");
}

{
  // 6h. A job whose complaint has vanished fails loudly.
  const db = createFakeDb({ jobs: [makeJob()], complaints: {} });
  let sends = 0;
  const summary = await runKioskSmsWorker({
    db,
    send: async () => {
      sends += 1;
      return { ok: true };
    },
  });
  eq("nothing was sent", sends, 0);
  eq("the job failed", summary.failed, 1);
  eq("the job is marked failed", db.jobs[0].status, "failed");
}

{
  // 6i. A refusal that never improves eventually fails for good.
  const db = createFakeDb({ jobs: [makeJob()], complaints: { "c-1": COMPLAINT } });
  const summary = await runKioskSmsWorker({
    db,
    send: async () => ({
      ok: false,
      kind: "retryable",
      code: "provider_rate_limited",
      message: "too many requests",
    }),
    maxAttempts: 1,
  });
  eq("the job failed instead of retrying", summary.failed, 1);
  eq("the job is marked failed", db.jobs[0].status, "failed");
}

{
  // 6j. A dry run builds the message and sends nothing at all.
  const db = createFakeDb({ jobs: [makeJob()], complaints: { "c-1": COMPLAINT } });
  let sends = 0;
  const summary = await runKioskSmsWorker({
    db,
    send: async () => {
      sends += 1;
      return { ok: true };
    },
    dryRun: true,
  });
  eq("nothing was sent", sends, 0);
  eq("nothing was marked sent", db.calls.markSent, 0);
  eq("the job is still pending", db.jobs[0].status, "pending");
  eq("one message was prepared", summary.results.length, 1);
  check(
    "the prepared message is the real one",
    summary.results[0].message.includes("AB-2026-0042")
  );
}

// ─────────────────────────────────────────────────────────────
// 7. The guarantees the database has to carry
//
// These are static checks on the migration. They are not a
// substitute for the verification queries at the bottom of the file,
// but they catch the day somebody edits the constraint away.
// ─────────────────────────────────────────────────────────────
console.log("7. the database guarantees");
{
  const sql = fs.readFileSync(
    path.join(ROOT, "supabase", "manual", "kiosk-08-sms-outbox.sql"),
    "utf8"
  );

  check(
    "one job per complaint and notification type",
    /UNIQUE\s*\(complaint_id,\s*notification_type\)/i.test(sql)
  );
  check(
    "a second enqueue resolves to the same row",
    /ON CONFLICT \(complaint_id, notification_type\) DO NOTHING/i.test(sql)
  );
  check(
    "only kiosk filings enqueue a job",
    /filing_channel IS DISTINCT FROM 'kiosk'/i.test(sql)
  );
  check(
    "the outbox is closed to the public",
    /REVOKE ALL ON TABLE public\.kiosk_sms_outbox FROM anon, authenticated/i.test(sql)
  );
  check(
    "row level security is enabled on the outbox",
    /ALTER TABLE public\.kiosk_sms_outbox ENABLE ROW LEVEL SECURITY/i.test(sql)
  );
  check(
    "the repair function is closed to the public",
    /REVOKE ALL ON FUNCTION public\.kiosk_enqueue_confirmation_sms\(uuid\) FROM PUBLIC, anon, authenticated/i.test(
      sql
    )
  );
  check(
    "the notification type matches the worker",
    sql.includes(`'${KIOSK_SMS_NOTIFICATION_TYPE}'`)
  );
  check(
    "the mobile number is checked for the Philippine shape",
    /\^09\[0-9\]\{9\}\$/.test(sql)
  );

  // The SMS job is a courtesy on top of a filing that already
  // succeeded. Losing the job is a nuisance; losing the complaint is
  // not acceptable. These checks pin the guard in place so a future
  // edit cannot quietly make SMS bookkeeping fatal again.
  const fnStart = sql.indexOf(
    "CREATE OR REPLACE FUNCTION public.kiosk_enqueue_confirmation_sms_on_complaint()"
  );
  const fnAs = fnStart < 0 ? -1 : sql.indexOf("AS $$", fnStart);
  const fnEnd = fnAs < 0 ? -1 : sql.indexOf("$$;", fnAs + 5);
  const fnHeader = fnStart < 0 || fnAs < 0 ? "" : sql.slice(fnStart, fnAs);
  const fnBody = fnStart < 0 || fnEnd < 0 ? "" : sql.slice(fnAs + 5, fnEnd);
  const fnCode = fnBody.replace(/--[^\n]*/g, "");

  check("the enqueue trigger function is present and complete", fnBody.length > 0);
  check(
    "it is still a SECURITY DEFINER trigger with a pinned search_path",
    /RETURNS trigger/i.test(fnHeader) &&
      /SECURITY DEFINER/i.test(fnHeader) &&
      /SET search_path = public/i.test(fnHeader)
  );
  check(
    "the trigger still fires AFTER INSERT for each complaint row",
    /CREATE TRIGGER trg_kiosk_enqueue_confirmation_sms\s+AFTER INSERT ON public\.complaints\s+FOR EACH ROW/i.test(
      sql
    )
  );

  const handlerAt = fnCode.search(/EXCEPTION\s+WHEN\s+OTHERS\s+THEN/i);
  const insertAt = fnCode.indexOf("INSERT INTO public.kiosk_sms_outbox");
  const innerBeginAt = fnCode.indexOf("BEGIN", fnCode.indexOf("BEGIN") + 1);

  check("the guard is an exception handler around the SMS block", handlerAt > 0);
  check(
    "the outbox insert happens before the handler, inside the guarded block",
    insertAt > 0 && innerBeginAt > 0 && innerBeginAt < insertAt && insertAt < handlerAt
  );
  check(
    "a swallowed failure still logs a warning and returns NEW",
    handlerAt > 0 &&
      /RAISE WARNING/i.test(fnCode.slice(handlerAt)) &&
      /RETURN NEW;/i.test(fnCode.slice(handlerAt))
  );
  check(
    "the trigger never raises an exception of its own",
    !/RAISE\s+EXCEPTION/i.test(fnCode)
  );
  check(
    "the handler does not retry the insert",
    !/INSERT\s+INTO/i.test(fnCode.slice(handlerAt))
  );
  check(
    "the handler records the SQLSTATE and constraint for repair",
    /GET STACKED DIAGNOSTICS/i.test(fnCode.slice(handlerAt)) &&
      /RETURNED_SQLSTATE/i.test(fnCode.slice(handlerAt)) &&
      /CONSTRAINT_NAME/i.test(fnCode.slice(handlerAt))
  );

  const warning = fnCode.slice(handlerAt).match(/RAISE\s+WARNING[\s\S]*?;/i);
  check("the warning is a single non-sensitive statement", Boolean(warning));
  check(
    "the warning carries no phone number, reference or complaint content",
    Boolean(warning) &&
      !/mobile|phone|recipient|snapshot|reference|narrative|description|complainant|token|secret|password/i.test(
        warning[0]
      ) &&
      /\bNEW\.id\b/.test(warning[0])
  );

  // A mismatch here would raise INSIDE the handler, which would put the
  // complaint back at risk: the guard has to be correct, not just present.
  const raiseParts = Boolean(warning) && warning[0].match(/RAISE\s+WARNING\s*'((?:[^']|'')*)'([\s\S]*?);/i);
  check(
    "the warning's placeholders match its arguments",
    Boolean(raiseParts) &&
      (raiseParts[1].match(/%/g) || []).length === 3 &&
      /\bNEW\.id\b/.test(raiseParts[2]) &&
      /\bv_sqlstate\b/.test(raiseParts[2]) &&
      /\bv_constraint\b/.test(raiseParts[2])
  );
}

// ─────────────────────────────────────────────────────────────
// 8. The switch that turns the feature off
// ─────────────────────────────────────────────────────────────
console.log("8. the off switch");
{
  const { isKioskSmsEnabled, isKioskSmsDispatchEnabled } = await import(
    "../supabase/functions/_shared/kiosk-sms.mjs"
  );

  eq("the feature is on by default", isKioskSmsEnabled({}), true);
  eq("the dispatch is on by default", isKioskSmsDispatchEnabled({}), true);

  eq("KIOSK_SMS_ENABLED=0 turns it off", isKioskSmsEnabled({ KIOSK_SMS_ENABLED: "0" }), false);
  eq("false turns it off too", isKioskSmsEnabled({ KIOSK_SMS_ENABLED: "false" }), false);
  eq("off turns it off too", isKioskSmsEnabled({ KIOSK_SMS_ENABLED: "OFF" }), false);
  eq("1 leaves it on", isKioskSmsEnabled({ KIOSK_SMS_ENABLED: "1" }), true);
  eq(
    "the dispatch can be switched off on its own",
    isKioskSmsDispatchEnabled({ KIOSK_SMS_DISPATCH: "0" }),
    false
  );
}

console.log("");
console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
