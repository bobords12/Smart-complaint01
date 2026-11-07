import { handle, readJson } from "@/lib/kiosk/routeResponse";
import { submitComplaint } from "@/lib/kiosk/serverApi";
import { handleKioskSubmissionSms } from "@/lib/sms/kioskSms";

/**
 * POST /api/kiosk/submit
 *
 * Files a complaint. Works identically whether the kiosk is online
 * now or replaying an offline queue entry, because the idempotency
 * key and the queued_at timestamp travel with the request and the
 * function decides what they mean. That is what makes a retried
 * offline sync safe rather than a duplicate-complaint generator.
 *
 * The SMS confirmation is a FOLLOW-UP, not part of the filing. It is
 * attempted only after the complaint has been committed, and nothing
 * it does can fail the request: the complaint, its evidence, its
 * reference number and its tracking QR code are already safe in the
 * database by then, and a citizen must never lose a filing because a
 * text message could not be queued.
 */
export async function POST(request) {
  return handle(async () => {
    const body = await readJson(request);
    const result = await submitComplaint(body);

    let sms = { queued: false, status: null, reason: "not_attempted" };
    try {
      sms = await handleKioskSubmissionSms({ result });
    } catch (error) {
      console.warn("[kiosk] the SMS follow-up failed:", error?.message);
    }

    return { result, sms };
  });
}
