import { NextResponse } from "next/server";
import { readJson } from "@/lib/kiosk/routeResponse";
import { KioskError, requireUuid } from "@/lib/kiosk/serverApi";
import { createClient } from "@/lib/supabase/server";
import { generateSubmittedReklamo } from "@/lib/reklamo/serverSubmittedReklamo";

/**
 * POST /api/reklamo/generate
 *
 * The resident's submitted Reklamo Form v1 (DOCX) is prepared here, on the
 * trusted server path, the moment a complaint exists — NOT in the resident
 * browser. This is what fixes the two faults in the old flow at once:
 *
 *   - the resident never downloads the master from the private `templates`
 *     bucket anymore (storage RLS there only admits active staff profiles, so
 *     a browser fetch always failed with "Document template is not
 *     available.");
 *   - there is no Generate button to press — the first form is automatic.
 *
 * The handler itself proves identity and ownership with the resident's own
 * session client before the service-role client (which bypasses RLS) is
 * allowed to do anything, and it never exposes the service-role key or the
 * private bucket to the browser.
 *
 * Response contract (consumed by lib/reklamo/requestSubmittedReklamo.js):
 *   200 { ok, success, version, already, filename, storage_path }
 *   4xx/5xx or ok:false with a machine code — every dialect the UI can show.
 */
export async function POST(request) {
  try {
    const body = await readJson(request);
    const complaintId = requireUuid(body?.complaintId, "complaint id");

    // 1. Who is asking: the resident's own session.
    const supabase = await createClient();
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData?.user?.id;
    if (!userId) {
      throw new KioskError("You must be signed in to prepare documents.", {
        status: 401,
        code: "unauthenticated",
      });
    }

    // 2. Proof of ownership: the complaint must be this resident's own.
    const { data: owned } = await supabase
      .from("complaints")
      .select("id")
      .eq("id", complaintId)
      .eq("resident_id", userId)
      .maybeSingle();
    if (!owned) {
      throw new KioskError("Complaint not found.", {
        status: 404,
        code: "not_found",
      });
    }

    // 3. Trusted generation. The service-role work happens only after the
    //    checks above; its errors are categorised and logged, never leaked.
    const result = await generateSubmittedReklamo({ complaintId, residentId: userId });
    if (!result.success) {
      throw new KioskError(result.message, { status: 422, code: result.code });
    }

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof KioskError) {
      return NextResponse.json(
        { ok: false, code: error.code, message: error.message },
        { status: error.status }
      );
    }

    // Anything that reaches here is a genuine, unexpected throw — NOT a
    // configuration guard. The configuration guards live inside
    // generateSubmittedReklamo and are returned as categorized results
    // (e.g. SERVER_GENERATOR_NOT_CONFIGURED when SUPABASE_SERVICE_ROLE_KEY
    // is absent), so they are never folded into this message.
    console.error("[reklamo/generate] unexpected error:", error);
    return NextResponse.json(
      {
        ok: false,
        code: "GENERATION_FAILED",
        message: "The Reklamo Form could not be prepared right now.",
      },
      { status: 500 }
    );
  }
}