-- Apply after the existing kiosk and official RBAC migrations.
-- Broad labels retain the existing case_category enums; exact notebook labels are text.
ALTER TABLE public.complaints
  ADD COLUMN IF NOT EXISTS predicted_specific_category text,
  ADD COLUMN IF NOT EXISTS confirmed_specific_category text;
ALTER TABLE public.complaints ALTER COLUMN prediction_model DROP DEFAULT;

CREATE OR REPLACE FUNCTION public.guard_specific_categorization()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_role app_role;
BEGIN
  IF NEW.predicted_specific_category IS DISTINCT FROM OLD.predicted_specific_category THEN
    IF auth.role() IS DISTINCT FROM 'service_role' THEN
      RAISE EXCEPTION 'Only the inference service can update the suggested category.';
    END IF;
    IF OLD.confirmed_category IS NOT NULL OR OLD.confirmed_specific_category IS NOT NULL THEN
      RAISE EXCEPTION 'A reviewed classification cannot be overwritten.';
    END IF;
  END IF;
  IF NEW.confirmed_specific_category IS DISTINCT FROM OLD.confirmed_specific_category THEN
    SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
    IF v_role NOT IN ('captain', 'oic') OR v_role IS NULL THEN
      RAISE EXCEPTION 'Only the Captain or OIC can confirm a specific category.';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS guard_specific_categorization ON public.complaints;
CREATE TRIGGER guard_specific_categorization BEFORE UPDATE ON public.complaints
FOR EACH ROW EXECUTE FUNCTION public.guard_specific_categorization();

CREATE OR REPLACE FUNCTION public.audit_specific_categorization()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_role app_role;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.audit_logs(actor_id, actor_role, action, target_type, target_id, details)
    VALUES (auth.uid(), v_role, 'confirmed_specific_category', 'complaint', NEW.id,
      jsonb_build_object('previous', OLD.confirmed_specific_category, 'new', NEW.confirmed_specific_category));
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS audit_specific_categorization ON public.complaints;
CREATE TRIGGER audit_specific_categorization AFTER UPDATE OF confirmed_specific_category ON public.complaints
FOR EACH ROW WHEN (OLD.confirmed_specific_category IS DISTINCT FROM NEW.confirmed_specific_category)
EXECUTE FUNCTION public.audit_specific_categorization();

CREATE OR REPLACE FUNCTION public.confirm_specific_category(p_complaint_id uuid, p_category text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_role app_role;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('captain', 'oic') OR v_role IS NULL THEN
    RAISE EXCEPTION 'Not authorized to confirm a specific category.';
  END IF;
  IF p_category IS NULL OR length(trim(p_category)) < 2 OR length(p_category) > 120 THEN
    RAISE EXCEPTION 'Invalid specific category.';
  END IF;
  UPDATE public.complaints SET confirmed_specific_category = trim(p_category)
    WHERE id = p_complaint_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Complaint not found.'; END IF;
END $$;

REVOKE ALL ON FUNCTION public.confirm_specific_category(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_specific_category(uuid, text) TO authenticated;
