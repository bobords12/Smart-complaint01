import { handle, readJson } from "@/lib/kiosk/routeResponse";
import { documentAccess } from "@/lib/kiosk/serverApi";

/**
 * POST /api/kiosk/document
 *
 * Returns a short-lived signed URL for ONE resident-visible document
 * belonging to the complaint a tracking token points at.
 *
 * The token is the credential, exactly as on the status route. The
 * service-role RPC re-checks ownership and visibility server-side and
 * yields the private storage path; the response carries only the signed
 * URL, never the path.
 */
export async function POST(request) {
  return handle(async () => {
    const body = await readJson(request);
    const document = await documentAccess({
      token: body.token,
      documentId: body.documentId,
      fingerprint: body.fingerprint,
    });
    return { document };
  });
}
