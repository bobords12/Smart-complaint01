/**
 * Uniform JSON responses for the kiosk API.
 *
 * Two rules the routes rely on:
 *  - Every failure carries a stable machine code as well as a
 *    message, so the UI can decide between "retry", "ask staff" and
 *    "the link expired" without string matching on prose.
 *  - Nothing from the database reaches the client verbatim. Only
 *    KioskError messages, which are authored to be read by a
 *    citizen, are exposed.
 */

import { KioskError } from "./serverApi";

const CACHE_HEADERS = {
  // Status and session responses are per-citizen and must never be
  // cached by a shared kiosk, a proxy or the Service Worker.
  "Cache-Control": "no-store, no-cache, must-revalidate, private",
  Pragma: "no-cache",
};

export function jsonOk(data, { status = 200 } = {}) {
  return Response.json(data, { status, headers: CACHE_HEADERS });
}

export function jsonError(error) {
  if (error instanceof KioskError) {
    return Response.json(
      { ok: false, code: error.code, message: error.message },
      { status: error.status, headers: CACHE_HEADERS }
    );
  }

  // An unexpected throw. Log it, tell the citizen nothing useful.
  console.error("[kiosk] unhandled route error:", error);
  return Response.json(
    {
      ok: false,
      code: "unavailable",
      message: "Filing is not available right now. Please ask staff for assistance.",
    },
    { status: 500, headers: CACHE_HEADERS }
  );
}

/** Wraps a handler so a thrown KioskError becomes a clean response. */
export async function handle(fn) {
  try {
    const result = await fn();
    return result instanceof Response ? result : jsonOk({ ok: true, ...result });
  } catch (error) {
    return jsonError(error);
  }
}

/** Parses a JSON body, treating anything unparseable as a bad request. */
export async function readJson(request) {
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new KioskError("Invalid request.", { code: "invalid_input" });
    }
    return body;
  } catch (error) {
    if (error instanceof KioskError) throw error;
    throw new KioskError("Invalid request.", { code: "invalid_input" });
  }
}
