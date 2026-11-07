import { KioskError, registerUploadedFile, requireUploadToken } from "@/lib/kiosk/serverApi";
import { createAdminClient } from "@/lib/supabase/admin";
import { handle, jsonOk } from "@/lib/kiosk/routeResponse";

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

/**
 * POST /api/kiosk/upload/direct
 *
 * Legacy small-file route retained for older clients. The current phone
 * uploads directly to private Storage using /sign and /complete, so 10 MB
 * files never enter a Vercel Function request body. The QR token remains
 * the only credential for this compatibility route.
 *
 * Order matters. The storage path is derived server-side by
 * kiosk_register_uploaded_file(), which is why the manifest row has
 * to come first: the client is never allowed to name a path. If the
 * byte upload then fails, the row is left as an orphan, and the
 * status RPC reports uploaded = false for it so the review screen
 * will not offer a file that is not really there.
 *
 * The token is not accepted from a header here. It is a capability
 * that a phone camera puts in a URL, and it is hashed in the rate
 * limiter, so a form field keeps it out of access logs.
 */
export async function POST(request) {
  return handle(async () => {
    // Reject on the declared length before buffering, so an oversized
    // upload cannot be used to exhaust the kiosk's memory.
    const declared = Number(request.headers.get("content-length") || "0");
    if (declared > MAX_BYTES + 64 * 1024) {
      throw new KioskError("File must be 10 MB or smaller.", {
        code: "file_too_large",
      });
    }

    let form;
    try {
      form = await request.formData();
    } catch {
      throw new KioskError("That file could not be read.", {
        code: "invalid_upload",
      });
    }

    const token = requireUploadToken(form.get("token"));
    const file = form.get("file");

    if (!(file instanceof File) || file.size === 0) {
      throw new KioskError("No file was received.", { code: "invalid_upload" });
    }
    if (file.size > MAX_BYTES) {
      throw new KioskError("File must be 10 MB or smaller.", {
        code: "file_too_large",
      });
    }
    if (!ALLOWED_MIME.has(file.type)) {
      throw new KioskError("Only photos and PDF files are accepted.", {
        code: "unsupported_type",
      });
    }

    // 1. Ask the database to name the path.
    const manifest = await registerUploadedFile({
      token,
      filename: file.name || "evidence",
      mimeType: file.type,
      fileSize: file.size,
    });

    // 2. Put the bytes where it said.
    //
    //    The byte write uses the service-role client, not the anon one.
    //    Storage evaluates an INSERT's WITH CHECK as the caller's role, and
    //    both storage policies that apply to anon read tables anon cannot
    //    SELECT (kiosk-04 revokes them):
    //
    //      - "Officials upload own evidence storage" (23_staff_assisted)
    //        declares no TO clause, so it is PUBLIC and still applies to
    //        anon. Its qual is `bucket_id = 'evidence' AND foldername =
    //        auth.uid() AND EXISTS (SELECT ... FROM public.profiles)`.
    //        For anon the middle term is NULL, which does not short-circuit
    //        an AND, so the profiles subquery runs -> "permission denied
    //        for table profiles". This is the error that was reported.
    //      - "Kiosk uploads into a live session folder" (kiosk-05) is the
    //        policy meant for this write, but it reads
    //        public.kiosk_upload_sessions, also revoked from anon, so it
    //        fails too. Fixing only the first policy would just surface the
    //        second error.
    //
    //    Authorisation is unchanged: step 1 above already called
    //    kiosk_register_uploaded_file(), a SECURITY DEFINER function that
    //    re-checks the token hash, revoked/consumed/expiry, the MIME and
    //    10 MB limits and the 5-file cap, then derives storage_path itself.
    //    The bytes therefore go exactly where the database named, and anon
    //    never needs read access to any table to complete an upload.
    const buffer = await file.arrayBuffer();
    const supabase = createAdminClient();
    const { error: uploadError } = await supabase.storage
      .from("evidence")
      .upload(manifest.storage_path, buffer, {
        contentType: file.type,
        // Never let the browser pick a content disposition or a
        // different content type than the one we validated.
        upsert: false,
      });

    if (uploadError) {
      console.error("[kiosk] storage upload failed:", uploadError.message);
      throw new KioskError("That file could not be saved. Please try again.", {
        status: 502,
        code: "upload_failed",
      });
    }

    return jsonOk({
      ok: true,
      file: {
        id: manifest.id,
        name: manifest.name,
        mime_type: manifest.mime_type,
        size: manifest.size,
        uploaded: true,
      },
    });
  });
}
