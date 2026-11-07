import { createClient } from "@/lib/supabase/client";

const supabase = createClient();

export interface ReferralRequest {
  id: string;
  complaint_id: string;
  resident_user_id: string;
  reason: string;
  has_immediate_safety_concern: boolean;
  status: string;
  decision_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  requested_at: string;
  created_at: string;
  updated_at: string;
}

/**
 * Get the active referral request for a complaint (if any).
 * Returns null if none exists.
 */
export async function getActiveReferralRequest(
  complaintId: string
): Promise<ReferralRequest | null> {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return null;

  const { data, error } = await supabase
    .from("pnp_referral_requests")
    .select("*")
    .eq("complaint_id", complaintId)
    .eq("resident_user_id", userData.user.id)
    .in("status", [
      "pending_review",
      "more_information_required",
      "approved",
      "officially_referred",
    ])
    .order("requested_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return data as ReferralRequest;
}

/**
 * Get all referral requests for a complaint (for the current resident).
 */
export async function getReferralRequests(
  complaintId: string
): Promise<ReferralRequest[]> {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return [];

  const { data, error } = await supabase
    .from("pnp_referral_requests")
    .select("*")
    .eq("complaint_id", complaintId)
    .eq("resident_user_id", userData.user.id)
    .order("requested_at", { ascending: false });

  if (error) return [];
  return (data || []) as ReferralRequest[];
}

/**
 * Submit a new referral request.
 * Database-level unique index prevents duplicate active requests.
 */
export async function submitReferralRequest(
  complaintId: string,
  reason: string,
  hasImmediateSafetyConcern: boolean
): Promise<{ success: boolean; error?: string; request?: ReferralRequest }> {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return { success: false, error: "Please sign in again." };
  }

  const trimmedReason = reason.trim();
  if (!trimmedReason) {
    return { success: false, error: "Enter a reason for your request." };
  }

  const { data, error } = await supabase
    .from("pnp_referral_requests")
    .insert({
      complaint_id: complaintId,
      resident_user_id: userData.user.id,
      reason: trimmedReason,
      has_immediate_safety_concern: hasImmediateSafetyConcern,
      status: "pending_review",
    })
    .select()
    .single();

  if (error) {
    // Check for unique constraint violation (duplicate active request)
    if (error.code === "23505") {
      return {
        success: false,
        error: "A referral request is already under review.",
      };
    }
    return { success: false, error: "Referral request could not be submitted." };
  }

  return { success: true, request: data as ReferralRequest };
}

/**
 * Cancel a pending referral request.
 */
export async function cancelReferralRequest(
  requestId: string
): Promise<{ success: boolean; error?: string }> {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return { success: false, error: "Please sign in again." };
  }

  const { error } = await supabase
    .from("pnp_referral_requests")
    .update({ status: "cancelled" })
    .eq("id", requestId)
    .eq("resident_user_id", userData.user.id)
    .eq("status", "pending_review");

  if (error) {
    return { success: false, error: "Could not cancel the request." };
  }

  return { success: true };
}
