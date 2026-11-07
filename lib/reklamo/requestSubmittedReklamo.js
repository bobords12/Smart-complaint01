/**
 * Browser-side call into the trusted server generation route
 * (POST /api/reklamo/generate).
 *
 * This is the ONLY thing the resident browser does for the submitted Reklamo
 * Form: ask the server to prepare it. The master template, the rendering and
 * the storage live on the server, so the private `templates` bucket is never
 * reachable from a resident account again.
 *
 * Always resolves — the caller treats a failure as "document pending /
 * recoverable", never as a failed submission, and may safely retry because the
 * route is idempotent.
 */
export async function requestSubmittedReklamo({ complaintId }) {
  try {
    const response = await fetch("/api/reklamo/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ complaintId }),
    });
    const json = await response.json().catch(() => null);

    if (!response.ok || !json || json.ok !== true) {
      return {
        success: false,
        code: json?.code || "GENERATION_FAILED",
        error: json?.message || "Could not prepare the Reklamo Form.",
      };
    }

    return {
      success: true,
      version: json.version,
      already: json.already === true,
      filename: json.filename,
      storage_path: json.storage_path,
    };
  } catch (error) {
    console.warn("Reklamo auto-generation request failed (safe to retry)", error?.message);
    return {
      success: false,
      code: "NETWORK_ERROR",
      error: "Could not reach the server. Please try again.",
    };
  }
}