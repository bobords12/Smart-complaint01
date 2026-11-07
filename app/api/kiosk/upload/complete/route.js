import { createHash } from "node:crypto";
import { KioskError, requireUploadToken, requireUuid } from "@/lib/kiosk/serverApi";
import { handle, readJson } from "@/lib/kiosk/routeResponse";
import { createAdminClient } from "@/lib/supabase/admin";

// Report success only after verifying the actual stored object against the
// manifest produced by the validated QR session. Never trust a client path.
export async function POST(request) {
  return handle(async () => {
    const body = await readJson(request);
    const token = requireUploadToken(body.token);
    const fileId = requireUuid(body.fileId, "file id");
    const admin = createAdminClient();
    // The resolver RPC is intentionally not executable by service_role.
    // Reproduce its predicate with the service-role client, without granting
    // public roles any table access or storing the raw capability in a table.
    const tokenHash = createHash("sha256").update(token, "utf8").digest("hex");
    const { data: session, error: sessionError } = await admin.from("kiosk_upload_sessions")
      .select("id").eq("token_hash", tokenHash).is("revoked_at", null)
      .is("consumed_at", null).gt("expires_at", new Date().toISOString()).maybeSingle();
    if (sessionError) throw new KioskError("Upload session unavailable. Please try again.", {
      status: 503, code: "unavailable",
    });
    if (!session) throw new KioskError("This upload link is no longer valid.", {
      code: "invalid_token",
    });
    const { data: row, error: rowError } = await admin.from("kiosk_upload_session_files")
      .select("id, storage_path, original_filename, mime_type, file_size")
      .eq("session_id", session.id).eq("id", fileId).maybeSingle();
    if (rowError || !row) throw new KioskError("That file is not part of this session.", {
      code: "invalid_upload",
    });

    const { data: stored, error: storageError } = await admin.storage.from("evidence").info(row.storage_path);
    if (storageError || !stored) throw new KioskError("That file has not been uploaded. Please try again.", {
      code: "upload_failed",
    });
    const mimeMatches = stored.contentType === row.mime_type ||
      (row.mime_type === "image/jpg" && stored.contentType === "image/jpeg");
    if (Number(stored.size) !== Number(row.file_size) || !mimeMatches) {
      // A signed upload is scoped to one path, but the holder can still send
      // different bytes. Never link an object whose size/type differs from the
      // validated manifest. Do not remove it here: another request may be
      // completing the same upload concurrently; expired orphans are reaped.
      throw new KioskError("The uploaded file did not match the selected file.", {
        code: "invalid_upload",
      });
    }
    return { file: { id: row.id, name: row.original_filename, mime_type: row.mime_type,
      size: row.file_size, uploaded: true } };
  });
}
