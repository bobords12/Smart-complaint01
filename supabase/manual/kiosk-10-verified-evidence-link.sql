-- Apply manually after kiosk-01 through kiosk-05, following staging checks.
-- Additive guard only: does not rewrite existing records, policies or RPCs.
-- The kiosk_submit_complaint RPC previously trusted a manifest row as proof
-- of uploaded bytes. A caller with the public RPC grant could supply a
-- registered file ID even if its object did not exist (or had different bytes).
-- This BEFORE INSERT trigger also protects callers that bypass Next.js.
CREATE OR REPLACE FUNCTION public.kiosk_verify_evidence_object()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, storage AS $$
BEGIN
  IF NEW.kiosk_evidence IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  IF NEW.kiosk_upload_session_id IS NULL OR NOT EXISTS (
    SELECT 1
      FROM public.kiosk_upload_session_files f
      JOIN storage.objects o ON o.bucket_id = 'evidence' AND o.name = f.storage_path
     WHERE f.session_id = NEW.kiosk_upload_session_id
       AND f.storage_path = NEW.storage_path
       AND f.file_size = NEW.file_size
       AND f.mime_type = NEW.mime_type
       AND o.metadata->>'size' = f.file_size::text
       AND (o.metadata->>'mimetype' = f.mime_type OR
            (f.mime_type = 'image/jpg' AND o.metadata->>'mimetype' = 'image/jpeg'))
  ) THEN
    RAISE EXCEPTION 'Kiosk evidence upload is missing or does not match its manifest.';
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.kiosk_verify_evidence_object() FROM PUBLIC, anon, authenticated;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'kiosk_verify_evidence_object'
      AND tgrelid = 'public.evidence'::regclass
  ) THEN
    CREATE TRIGGER kiosk_verify_evidence_object
      BEFORE INSERT ON public.evidence
      FOR EACH ROW EXECUTE FUNCTION public.kiosk_verify_evidence_object();
  END IF;
END $$;

-- Read-only post-application verification:
-- SELECT tgname, tgenabled FROM pg_trigger
--  WHERE tgrelid = 'public.evidence'::regclass
--    AND tgname = 'kiosk_verify_evidence_object';
