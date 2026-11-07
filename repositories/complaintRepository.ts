import { createClient } from "@/lib/supabase/client";
import type { Complaint, ComplaintStatus } from "@/types/complaint";

const supabase = createClient();

interface CreateComplaintInput {
  title: string;
  description: string;
  incident_date: string;
  incident_time: string;
  incident_location: string;
  persons_involved?: string;
  witnesses?: string;
  predicted_category: string;
  predicted_case_type: string;
  predicted_urgency: string;
  prediction_confidence: number;
}

/**
 * Create a complaint via the server-side RPC for atomic
 * reference number generation and initial status creation.
 */
export async function createComplaint(
  input: CreateComplaintInput
): Promise<{ success: boolean; id?: string; reference_number?: string; error?: string }> {
  const { data, error } = await supabase.rpc("create_complaint", {
    p_title: input.title,
    p_description: input.description,
    p_incident_date: input.incident_date || null,
    p_incident_time: input.incident_time || null,
    p_incident_location: input.incident_location,
    p_persons_involved: input.persons_involved || null,
    p_witnesses: input.witnesses || null,
    p_predicted_category: input.predicted_category,
    p_predicted_case_type: input.predicted_case_type,
    p_predicted_urgency: input.predicted_urgency,
    p_prediction_confidence: input.prediction_confidence,
  });

  if (error) return { success: false, error: error.message };

  const result = data as { id: string; reference_number: string };
  return {
    success: true,
    id: result.id,
    reference_number: result.reference_number,
  };
}

/**
 * Get all complaints for the current resident.
 */
export async function getResidentComplaints(): Promise<Complaint[]> {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return [];

  const { data, error } = await supabase
    .from("complaints")
    .select("*")
    .eq("resident_id", userData.user.id)
    .order("submitted_at", { ascending: false });

  if (error) return [];

  return (data || []).map(mapDbComplaint);
}

/**
 * Get a single complaint by ID (with ownership check via RLS).
 */
export async function getComplaintById(
  complaintId: string
): Promise<Complaint | null> {
  const { data, error } = await supabase
    .from("complaints")
    .select("*")
    .eq("id", complaintId)
    .single();

  if (error) return null;
  return mapDbComplaint(data);
}

/**
 * Get evidence for a complaint.
 */
export async function getComplaintEvidence(complaintId: string) {
  const { data, error } = await supabase
    .from("evidence")
    .select("*")
    .eq("complaint_id", complaintId)
    .order("created_at", { ascending: true });

  if (error) return [];
  return data || [];
}

/**
 * Upload evidence file to Storage and insert metadata.
 */
export async function uploadEvidence(
  complaintId: string,
  file: File,
  evidenceType: string = "document",
  description?: string
): Promise<{ success: boolean; error?: string }> {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { success: false, error: "Not authenticated" };

  const ext = file.name.split(".").pop() || "bin";
  const path = `${userData.user.id}/${complaintId}/${crypto.randomUUID()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from("evidence")
    .upload(path, file);

  if (uploadError) return { success: false, error: uploadError.message };

  const { error: insertError } = await supabase.from("evidence").insert({
    complaint_id: complaintId,
    uploaded_by: userData.user.id,
    storage_path: path,
    original_filename: file.name,
    mime_type: file.type,
    file_size: file.size,
    evidence_type: evidenceType,
    description: description || null,
  });

  if (insertError) return { success: false, error: insertError.message };
  return { success: true };
}

/**
 * Get official documents a resident is allowed to read for a complaint.
 * Relies entirely on RLS: the SQL migration installs a policy that scopes
 * resident reads to documents whose complaint they own, so no client-side
 * filter is trusted here.
 */
export async function getResidentComplaintDocuments(complaintId: string) {
  const { data, error } = await supabase
    .from("official_documents")
    .select(
      "id, complaint_id, document_type, document_status, title, filename, storage_path, mime_type, file_size, version, generated_at, created_at"
    )
    .eq("complaint_id", complaintId)
    .eq("visibility", "resident_visible")
    .order("created_at", { ascending: true });

  if (error) return [];
  return data || [];
}

/**
 * Create a short-lived signed URL for a document the caller may read.
 * The URL is never persisted.
 */
export async function getDocumentSignedUrl(
  storagePath: string
): Promise<{ url: string | null; error?: string }> {
  const { data, error } = await supabase.storage
    .from("documents")
    .createSignedUrl(storagePath, 300);

  if (error) return { url: null, error: error.message };
  return { url: data?.signedUrl ?? null };
}

/**
 * Upload the submission-copy PDF and record its document row through the
 * record_submission_receipt RPC, which re-checks ownership server-side.
 */
export async function recordSubmissionReceipt(input: {
  complaintId: string;
  fileName: string;
  storagePath: string;
  fileSize: number;
  evidenceCount: number;
  snapshot: Record<string, unknown>;
}): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase.rpc("record_submission_receipt", {
    p_complaint_id: input.complaintId,
    p_filename: input.fileName,
    p_storage_path: input.storagePath,
    p_file_size: input.fileSize,
    p_evidence_count: input.evidenceCount,
    p_snapshot: input.snapshot,
  });

  if (error) return { success: false, error: error.message };
  return { success: true };
}

/**
 * Get case statuses for a complaint.
 */
export async function getCaseStatuses(complaintId: string) {
  const { data, error } = await supabase
    .from("case_statuses")
    .select("*")
    .eq("complaint_id", complaintId)
    .order("created_at", { ascending: true });

  if (error) return [];
  return data || [];
}

/**
 * Get KP tracker for a complaint.
 */
export async function getKpTracker(complaintId: string) {
  const { data, error } = await supabase
    .from("kp_trackers")
    .select("*")
    .eq("complaint_id", complaintId)
    .single();

  if (error) return null;
  return data;
}

/**
 * Get KP phases for a tracker.
 */
export async function getKpPhases(trackerId: string) {
  const { data, error } = await supabase
    .from("kp_phases")
    .select("*")
    .eq("tracker_id", trackerId)
    .order("created_at", { ascending: true });

  if (error) return [];
  return data || [];
}

/**
 * Get hearings for a complaint.
 */
export async function getComplaintHearings(complaintId: string) {
  const { data, error } = await supabase
    .from("hearings")
    .select("*")
    .eq("complaint_id", complaintId)
    .order("hearing_date", { ascending: true });

  if (error) return [];
  return data || [];
}

/**
 * Get all hearings for the current resident's complaints.
 *
 * `rescheduled_from_id` / `rescheduled_to_id` are the canonical links the
 * Captain reschedule RPC writes, and they are what the resident's Schedule
 * History block follows. Reading them here means the history is never
 * reconstructed by guessing which session replaced which from dates alone.
 *
 * `cancel_reason` is included because the Captain cancel RPC requires one;
 * it is the resident-visible explanation for a cancelled session.
 */
export async function getResidentHearings() {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return [];

  const { data, error } = await supabase
    .from("hearings")
    .select(
      "*, complaints!inner(resident_id, reference_number, title, barangay_case_number, current_status, submitted_at, official_received_at)"
    )
    .eq("complaints.resident_id", userData.user.id)
    .order("hearing_date", { ascending: true });

  if (error) return [];
  return data || [];
}

/**
 * Resident-visible case history for every complaint the resident owns.
 *
 * `case_statuses.resident_visible_message` is the canonical written
 * history the Captain workflow produces on every state change. This is the
 * source of a complaint card's "Latest Update", so that wording can never
 * drift from what the Captain actually recorded.
 */
export async function getResidentCaseStatuses() {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return [];

  const { data: complaintRows, error: complaintError } = await supabase
    .from("complaints")
    .select("id")
    .eq("resident_id", userData.user.id);

  if (complaintError || !complaintRows?.length) return [];

  const { data, error } = await supabase
    .from("case_statuses")
    .select("id, complaint_id, status, stage, resident_visible_message, created_at")
    .in(
      "complaint_id",
      complaintRows.map((row) => row.id)
    )
    .order("created_at", { ascending: true });

  if (error) return [];
  return data || [];
}

/**
 * Resident-visible official documents for every complaint the resident
 * owns. The `visibility` filter is repeated on the client even though the
 * resident RLS policy already enforces it, so a policy regression cannot
 * silently widen what this list shows.
 */
export async function getResidentVisibleDocuments() {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return [];

  const { data: complaintRows, error: complaintError } = await supabase
    .from("complaints")
    .select("id")
    .eq("resident_id", userData.user.id);

  if (complaintError || !complaintRows?.length) return [];

  const { data, error } = await supabase
    .from("official_documents")
    .select(
      "id, complaint_id, document_type, document_status, title, filename, storage_path, mime_type, file_size, version, generated_at, created_at, visibility"
    )
    .in(
      "complaint_id",
      complaintRows.map((row) => row.id)
    )
    .eq("visibility", "resident_visible")
    .eq("status", "active")
    .order("created_at", { ascending: false });

  if (error) return [];
  return data || [];
}

/**
 * The resident's own profile name, used for the PARTIES block of a hearing
 * detail. Scoped to the signed-in user by construction.
 */
export async function getResidentProfileName() {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return null;

  const { data, error } = await supabase
    .from("resident_profiles")
    .select("first_name, middle_name, last_name, suffix")
    .eq("user_id", userData.user.id)
    .maybeSingle();

  if (error || !data) return null;
  const full = [data.first_name, data.middle_name, data.last_name, data.suffix]
    .map((part) => (part || "").trim())
    .filter(Boolean)
    .join(" ");
  return full || null;
}

/**
 * Get classification logs for a complaint.
 */
export async function getClassificationLogs(complaintId: string) {
  const { data, error } = await supabase
    .from("complaint_classification_logs")
    .select("*")
    .eq("complaint_id", complaintId)
    .order("created_at", { ascending: false });

  if (error) return [];
  return data || [];
}

/**
 * Get review for a complaint.
 */
export async function getComplaintReview(complaintId: string) {
  const { data, error } = await supabase
    .from("complaint_reviews")
    .select("*")
    .eq("complaint_id", complaintId)
    .single();

  if (error) return null;
  return data;
}

/**
 * Map database complaint row to the application Complaint type.
 */
function mapDbComplaint(row: any): Complaint {
  return {
    id: row.id,
    caseNo: row.reference_number,
    title: row.title,
    category: row.predicted_category || row.confirmed_category || "Administrative",
    confirmedCategory: row.confirmed_category || undefined,
    priority: row.predicted_urgency || row.confirmed_urgency || "Normal",
    confirmedPriority: row.confirmed_urgency || undefined,
    status: row.current_status,
    submittedOn: new Date(row.submitted_at).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    }),
    submittedAt: row.submitted_at,
    summary: row.description?.slice(0, 200) || "",
    description: row.description,
    incidentDate: row.incident_date,
    incidentTime: row.incident_time,
    location: row.incident_location,
    personsInvolved: row.persons_involved,
    witnesses: row.witnesses,
    referenceNumber: row.reference_number || undefined,
    barangayCaseNumber: row.barangay_case_number || null,
    officialReceivedAt: row.official_received_at || null,
    receivedBy: row.received_by || null,
    desiredRelief: row.desired_relief || null,
    officialCategory: row.official_category || null,
    officialUrgency: row.official_urgency || null,
    reference_number: row.reference_number || null,
    barangay_case_number: row.barangay_case_number || null,
    official_received_at: row.official_received_at || null,
    received_by: row.received_by || null,
    desired_relief: row.desired_relief || null,
    official_category: row.official_category || null,
    official_urgency: row.official_urgency || null,
    // Resident-safe routing state. These six are the ONLY routing columns
    // the resident app receives, and they are the ones a resident needs in
    // order to act: what the barangay asked for, when it was asked, and
    // whether they have already answered. The official's reasons
    // (routing_reason, kp_applicability_reason, kp_applicability) stay on
    // the server and are never mapped here.
    completeness_status: row.completeness_status || null,
    routing_status: row.routing_status || null,
    requested_information: row.requested_information || null,
    requested_information_at: row.requested_information_at || null,
    last_information_response_at: row.last_information_response_at || null,
    information_responses: row.information_responses ?? 0,
    // The complainant of record. `complainant_snapshot` is what the kiosk and
    // the staff-assisted filing wrote at submission time, so it is the same
    // name the printed forms carry. For a complaint filed from a resident
    // account there is no snapshot (the row is tied to `resident_id` instead),
    // which the detail view resolves against the resident's own profile.
    complainantName: complainantSnapshotName(row.complainant_snapshot) || undefined,
    complainantContact: row.complainant_snapshot?.mobile_number || undefined,
    complainantAddress:
      [
        row.complainant_snapshot?.house_street,
        row.complainant_snapshot?.purok,
        row.complainant_snapshot?.barangay,
        row.complainant_snapshot?.city,
      ]
        .map((part) => (part || "").trim())
        .filter(Boolean)
        .join(", ") || undefined,
    updates: [],
    residentId: row.resident_id,
  };
}

/** Name parts as the filing wrote them; missing parts are skipped, never blank-padded. */
function complainantSnapshotName(snapshot: any) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return "";
  return [snapshot.first_name, snapshot.middle_name, snapshot.last_name, snapshot.suffix]
    .map((part) => (part == null ? "" : String(part).trim()))
    .filter(Boolean)
    .join(" ");
}

/**
 * Submit an inquiry about a complaint.
 */
export async function submitInquiry(
  complaintId: string,
  subject: string,
  message: string
): Promise<{ success: boolean; error?: string }> {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { success: false, error: "Not authenticated" };

  const { error } = await supabase.from("case_inquiries").insert({
    complaint_id: complaintId,
    resident_id: userData.user.id,
    subject,
    message,
  });

  if (error) return { success: false, error: error.message };
  return { success: true };
}
