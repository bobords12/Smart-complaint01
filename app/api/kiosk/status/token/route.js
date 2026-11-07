import { handle, readJson } from "@/lib/kiosk/routeResponse";
import { statusByToken, statusByLookup } from "@/lib/kiosk/serverApi";

/**
 * POST /api/kiosk/status/token
 *
 * Resident-facing status for the QR on a receipt. The token is the
 * only credential, and the database stores just its digest.
 *
 * The function answers 'pending_sync' for both a real unsynchronised
 * offline receipt and a token that does not exist, so this endpoint
 * cannot be used to test whether a given complaint exists.
 */
export async function POST(request) {
  return handle(async () => {
    const body = await readJson(request);
    const status = await statusByToken({
      token: body.token,
      fingerprint: body.fingerprint,
    });
    return { status };
  });
}
