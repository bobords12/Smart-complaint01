import { createClient } from "@/lib/supabase/client";
import { KioskRequestError } from "./api";

// Keep a failed transfer's manifest in memory for this phone tab. If the
// Storage response or completion acknowledgement was lost, a retry verifies
// the original path instead of registering a second copy of the same file.
const pendingUploads = new Map();

async function request(path, body, signal) {
  let response;
  try {
    response = await fetch(path, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body), signal, cache: "no-store",
    });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new KioskRequestError("No connection to the service.", { code: "network" });
  }
  const result = await response.json().catch(() => null);
  if (!response.ok || result?.ok !== true) {
    throw new KioskRequestError(result?.message || "That file could not be saved.", {
      code: result?.code || "upload_failed", status: response.status,
    });
  }
  return result;
}

export async function uploadKioskEvidence(token, file, { signal } = {}) {
  const key = `${token}:${file.name}:${file.size}:${file.type}`;
  const completeUpload = (signed) => request("/api/kiosk/upload/complete", {
    token, fileId: signed.file.id,
  }, signal);
  let signed = pendingUploads.get(key);
  if (signed) {
    try {
      const result = await completeUpload(signed);
      pendingUploads.delete(key);
      return result.file;
    } catch (error) {
      if (["invalid_token", "invalid_upload"].includes(error.code)) pendingUploads.delete(key);
      if (error.code !== "upload_failed") throw error;
      // There is no stored object yet: retry this exact non-upsert path.
    }
  } else {
    signed = await request("/api/kiosk/upload/sign", {
      token, filename: file.name, mimeType: file.type, fileSize: file.size,
    }, signal);
    pendingUploads.set(key, signed);
  }
  // This is the anon browser client. Only a one-path, non-upsert signed token
  // crosses the wire; neither a service-role credential nor a client path does.
  const { error } = await createClient().storage.from("evidence")
    .uploadToSignedUrl(signed.file.path, signed.uploadToken, file, {
      contentType: file.type, upsert: false,
    });
  // Even when Storage reports a network/conflict error, its write may have
  // committed. Confirm the original path before reporting failure or retrying.
  if (error) {
    try {
      const result = await completeUpload(signed);
      pendingUploads.delete(key);
      return result.file;
    } catch (confirmationError) {
      if (["invalid_token", "invalid_upload"].includes(confirmationError.code)) pendingUploads.delete(key);
      throw new KioskRequestError("That file could not be uploaded.", {
        code: confirmationError.code || "upload_failed",
      });
    }
  }
  const result = await completeUpload(signed);
  pendingUploads.delete(key);
  return result.file;
}
