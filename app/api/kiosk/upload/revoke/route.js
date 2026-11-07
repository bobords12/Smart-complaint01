import { handle, readJson } from "@/lib/kiosk/routeResponse";
import { revokeUploadSession } from "@/lib/kiosk/serverApi";

/**
 * POST /api/kiosk/upload/revoke
 *
 * Closes an evidence session early when the citizen backs out of
 * attaching anything. Without this a session would sit open for its
 * full ten minutes holding a Storage policy alive.
 *
 * Best effort: if it fails the session still expires on its own, so
 * the caller can ignore an error here.
 */
export async function POST(request) {
  return handle(async () => {
    const body = await readJson(request);
    const revoked = await revokeUploadSession({
      token: body.token,
      fingerprint: body.fingerprint,
    });
    return { revoked };
  });
}
