import { KioskError } from "@/lib/kiosk/serverApi";
import { handle, readJson, jsonOk } from "@/lib/kiosk/routeResponse";
import { createUploadSession, uploadSessionStatus } from "@/lib/kiosk/serverApi";

/**
 * POST /api/kiosk/upload/session
 *
 * Opens a ten minute evidence window and returns the token the kiosk
 * renders as a QR code. The token is returned once and stored only as
 * a digest, so the kiosk keeps it in memory and the offline queue
 * keeps it inside its ciphertext.
 */
export async function POST(request) {
  return handle(async () => {
    const body = await readJson(request);
    const session = await createUploadSession({ fingerprint: body.fingerprint });
    return { session };
  });
}

/**
 * GET /api/kiosk/upload/session?token=...
 *
 * Polled by the kiosk while the citizen uses their phone, to learn
 * which files actually arrived. 'uploaded' is only true once the
 * object is really in Storage.
 */
export async function GET(request) {
  return handle(async () => {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get("token");
    const fingerprint = searchParams.get("fingerprint");

    if (!token) {
      throw new KioskError("This upload link is no longer valid.", {
        code: "invalid_token",
      });
    }

    const status = await uploadSessionStatus({ token, fingerprint });
    return jsonOk({ ok: true, status });
  });
}
