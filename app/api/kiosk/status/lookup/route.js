import { handle, readJson } from "@/lib/kiosk/routeResponse";
import { statusByLookup } from "@/lib/kiosk/serverApi";

/**
 * POST /api/kiosk/status/lookup
 *
 * Manual tracking for a citizen who lost the printed slip.
 *
 * Tracking number plus the mobile number given at filing is required.
 * Both are compared in the database, the mobile is normalised there
 * rather than trusted from the browser, failures are deliberately
 * indistinguishable, and the endpoint is rate limited per device.
 */
export async function POST(request) {
  return handle(async () => {
    const body = await readJson(request);
    const status = await statusByLookup({
      reference: body.reference,
      mobile: body.mobile,
      fingerprint: body.fingerprint,
    });
    return { status };
  });
}
