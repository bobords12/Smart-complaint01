import { createClient } from "@/lib/supabase/server";
import { predictComplaint, savePrediction } from "@/lib/mlPrediction";

// Best-effort post-submission classification; retry with the same complaint ID.
export async function POST(request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (typeof body?.id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.id))
    return Response.json({ error: "Invalid complaint ID" }, { status: 400 });
  // The authenticated client applies existing RLS; the owner must match.
  const { data: row, error } = await supabase.from("complaints")
    .select("id, resident_id, encoded_by, description, confirmed_category, predicted_specific_category")
    .eq("id", body.id).single();
  if (error || !row) return Response.json({ error: "Complaint unavailable" }, { status: 404 });
  if (row.resident_id !== user.id) {
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    const encoder = row.encoded_by === user.id && ["captain", "oic", "secretary"].includes(profile?.role);
    const reviewer = ["captain", "oic"].includes(profile?.role);
    if (!encoder && !reviewer)
      return Response.json({ error: "Complaint unavailable" }, { status: 404 });
  }
  if (row.confirmed_category || row.predicted_specific_category) return Response.json({ status: "already_processed" });
  const prediction = await predictComplaint(row.description);
  if (!prediction) return Response.json({ status: "pending" }, { status: 202 });
  const saved = await savePrediction(row.id, row.description, prediction);
  return Response.json({ status: saved ? "suggested" : "pending" }, { status: saved ? 200 : 202 });
}
