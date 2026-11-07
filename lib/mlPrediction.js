import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { mlRequestTimeout, requestMlPrediction } from "@/lib/mlPredictionRequest.mjs";

export async function predictComplaint(text) {
  return requestMlPrediction({ text, url: process.env.ML_SERVICE_URL, key: process.env.ML_API_KEY,
    timeoutMs: mlRequestTimeout(process.env.ML_REQUEST_TIMEOUT_MS) });
}

// Called only after the existing authorized RPC has committed a complaint.
// Compare the narrative and review state again; a retry never replaces a human decision.
export async function savePrediction(id, narrative, prediction, { kioskSubmissionId } = {}) {
  if (!prediction || !id) return false;
  try {
    const admin = createAdminClient();
    let query = admin.from("complaints").select("id, description, confirmed_category, confirmed_specific_category, predicted_specific_category").eq("id", id);
    if (kioskSubmissionId) query = query.eq("kiosk_client_submission_id", kioskSubmissionId);
    const { data: row, error } = await query.single();
    if (error || row.description !== narrative || row.confirmed_category ||
        row.confirmed_specific_category || row.predicted_specific_category) return false;
    const { data: updated, error: updateError } = await admin.from("complaints").update({
      predicted_category: prediction.caseType,
      predicted_case_type: prediction.caseType,
      predicted_specific_category: prediction.category,
      prediction_model: `svm-${prediction.modelVersion}`,
      prediction_confidence: null,
      classification_status: "suggested",
      classification_at: new Date().toISOString(),
    }).eq("id", id).is("confirmed_category", null).is("confirmed_specific_category", null)
      .is("predicted_specific_category", null).select("id");
    return !updateError && updated?.length === 1;
  } catch {
    return false;
  }
}
