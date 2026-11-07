import { KioskError, registerUploadedFile } from "@/lib/kiosk/serverApi";
import { handle, readJson } from "@/lib/kiosk/routeResponse";
import { createAdminClient } from "@/lib/supabase/admin";

// The QR token is validated by the existing RPC, which also names the only
// permitted storage path. File bytes never pass through this function.
export async function POST(request) {
  return handle(async () => {
    const body = await readJson(request);
    const file = await registerUploadedFile({
      token: body.token,
      filename: body.filename,
      mimeType: body.mimeType,
      fileSize: body.fileSize,
    });
    const { data, error } = await createAdminClient().storage.from("evidence")
      .createSignedUploadUrl(file.storage_path, { upsert: false });
    if (error || !data?.token || data.path !== file.storage_path) {
      console.error("[kiosk] could not authorize scoped evidence upload:", error?.message);
      throw new KioskError("That file could not be prepared. Please try again.", {
        status: 502, code: "upload_failed",
      });
    }
    return { file: { id: file.id, path: file.storage_path, name: file.name,
      mime_type: file.mime_type, size: file.size }, uploadToken: data.token };
  });
}
