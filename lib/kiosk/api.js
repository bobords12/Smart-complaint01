/**
 * Browser-side client for the kiosk API routes.
 *
 * Every function returns parsed JSON or throws a KioskRequestError
 * carrying the server's machine code, so the UI can distinguish
 * "offline", "link expired" and "ask staff" without inspecting
 * message text.
 */

export class KioskRequestError extends Error {
  constructor(message, { code = "unavailable", status = 0 } = {}) {
    super(message);
    this.name = "KioskRequestError";
    this.code = code;
    this.status = status;
  }

  /** True when retrying later could plausibly succeed. */
  get retryable() {
    return (
      this.code === "network" ||
      this.code === "unavailable" ||
      this.code === "upload_failed" ||
      this.status === 503 ||
      this.status === 504
    );
  }
}

async function request(path, { method = "POST", body, signal } = {}) {
  let response;
  try {
    response = await fetch(path, {
      method,
      signal,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new KioskRequestError(
      "No connection to the service.",
      { code: "network" }
    );
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // A non-JSON body from a proxy or an edge function.
    throw new KioskRequestError(
      "The service did not respond properly.",
      { code: "unavailable", status: response.status }
    );
  }

  if (!response.ok || payload?.ok === false) {
    throw new KioskRequestError(
      payload?.message || "Something went wrong. Please try again.",
      { code: payload?.code || "unavailable", status: response.status }
    );
  }

  return payload;
}

/** Files a complaint. Throws KioskRequestError with code 'network' when offline. */
export function submitComplaint(payload, { signal } = {}) {
  return request("/api/kiosk/submit", { body: payload, signal });
}

export function fetchStatusByToken({ token, fingerprint }, { signal } = {}) {
  return request("/api/kiosk/status/token", {
    body: { token, fingerprint },
    signal,
  });
}

export function fetchStatusByLookup({ reference, mobile, fingerprint }, { signal } = {}) {
  return request("/api/kiosk/status/lookup", {
    body: { reference, mobile, fingerprint },
    signal,
  });
}

export function fetchDocumentUrl({ token, documentId, fingerprint }, { signal } = {}) {
  return request("/api/kiosk/document", {
    body: { token, documentId, fingerprint },
    signal,
  });
}

export function openUploadSession({ fingerprint }, { signal } = {}) {
  return request("/api/kiosk/upload/session", { body: { fingerprint }, signal });
}

export function pollUploadSession({ token, fingerprint }, { signal } = {}) {
  return request(
    `/api/kiosk/upload/session?token=${encodeURIComponent(token)}&fingerprint=${encodeURIComponent(fingerprint)}`,
    { method: "GET", signal }
  );
}

export function revokeUploadSession({ token, fingerprint }, { signal } = {}) {
  return request("/api/kiosk/upload/revoke", { body: { token, fingerprint }, signal });
}

/** Simple reachability probe for the "online / offline" pill. */
export async function checkOnline({ signal } = {}) {
  try {
    // The status endpoint is the cheapest authenticated round trip and
    // a deliberately malformed token is rejected locally by the
    // server's guard, so this doubles as a connectivity test.
    await request("/api/kiosk/status/lookup", {
      body: { reference: "AB-0000-0000", mobile: "0", fingerprint: "0".repeat(16) },
      signal,
    });
    return true;
  } catch (error) {
    // A 400 means the server answered, which is all we needed.
    return error.status > 0 && error.status < 500;
  }
}
