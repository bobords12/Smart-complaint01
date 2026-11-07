import { jsonOk } from "@/lib/kiosk/routeResponse";
import { dispatchKioskConfirmationSms, kioskSmsEnabled } from "@/lib/sms/kioskSms";

/**
 * POST /api/kiosk/sms/sweep  (GET is accepted too, for a cron runner)
 *
 * The safety net for the confirmation SMS.
 *
 * When a complaint is filed, the server queues the job and asks the
 * edge worker to deliver it right away. That is the fast path, and
 * it is the path that matters. This route is the slow path: it
 * delivers whatever is still waiting.
 *
 * It exists because a message must not depend on one request
 * succeeding. If the kiosk server was restarting, if the edge
 * function was redeploying, if the network dropped between the
 * commit and the dispatch, the job would simply sit in the outbox
 * until something comes back to collect it. This is that something.
 *
 * ── Who may call it ────────────────────────────────────────────
 *
 * Only a caller that presents the value of CRON_SECRET. When
 * CRON_SECRET is not configured the route is CLOSED and answers
 * 404: an unprotected sweep would let anyone on the internet make
 * this project send text messages.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function authorized(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const header = request.headers.get("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return false;

  return match[1].trim() === secret;
}

async function sweep(request) {
  if (!authorized(request)) {
    return Response.json(
      { ok: false, code: "not_found", message: "Not found." },
      { status: 404, headers: { "Cache-Control": "no-store" } }
    );
  }

  if (!kioskSmsEnabled()) {
    return jsonOk({ ok: true, dispatched: false, reason: "disabled" });
  }

  const dispatched = await dispatchKioskConfirmationSms({ limit: 20 });

  return jsonOk({ ok: true, ...dispatched });
}

export async function GET(request) {
  return sweep(request);
}

export async function POST(request) {
  return sweep(request);
}
