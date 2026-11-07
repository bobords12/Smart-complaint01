import { createClient } from "@/lib/supabase/server";
import { predictComplaint } from "@/lib/mlPrediction";

const MIN_LENGTH = 10;
const MAX_LENGTH = 4000;

/**
 * POST /api/classify
 *
 * Authenticated preview for resident and staff forms. Only the
 * narrative reaches the private Python service; the saved complaint
 * is classified independently from its stored text by /attach.
 */
export async function POST(request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const description =
    typeof body?.description === "string" ? body.description.trim() : "";

  if (description.length < MIN_LENGTH) {
    return Response.json(
      { error: `Description must be at least ${MIN_LENGTH} characters.` },
      { status: 400 }
    );
  }
  if (description.length > MAX_LENGTH) {
    return Response.json(
      { error: `Description must not exceed ${MAX_LENGTH} characters.` },
      { status: 400 }
    );
  }

  const prediction = await predictComplaint(description);
  if (!prediction) return Response.json({ error: "Classification is unavailable right now." }, { status: 503 });
  return Response.json({ classification: prediction, model: prediction.modelVersion });
}
