"use client";

/**
 * Server-facing helpers for staff-assisted complaint encoding.
 * All authorization is enforced again inside the SQL RPC via auth.uid().
 */

import { createClient } from "@/lib/supabase/client";

const STEP_FIELDS = ["resident", "details", "respondent", "evidence", "review", "success"];

export const ENCODE_STEPS = [
  { id: "resident", label: "Resident" },
  { id: "details", label: "Complaint Details" },
  { id: "respondent", label: "Respondent & Incident" },
  { id: "evidence", label: "Evidence" },
  { id: "review", label: "Review & Submit" },
  { id: "success", label: "Success" },
];

export function stepIndexOf(id) {
  return Math.max(0, STEP_FIELDS.indexOf(id));
}

const ALLOWED_MIME = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "application/pdf",
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/ogg",
  "audio/webm",
];

const MAX_FILE_SIZE = 10 * 1024 * 1024;

export function isAllowedEvidenceFile(file) {
  return ALLOWED_MIME.includes(file.type);
}

export function isOversizedEvidence(file) {
  return file.size > MAX_FILE_SIZE;
}

/** Philippine-friendly mobile: 09XXXXXXXXX, +639XXXXXXXXX, spaces/dashes OK. */
export function isValidPhMobile(value) {
  if (!value) return true;
  const digits = String(value).replace(/[\s\-()]/g, "");
  return /^(?:\+63|0)9\d{9}$/.test(digits);
}

export function isValidEmail(value) {
  if (!value) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * Search resident profiles with minimal returned fields.
 * Officials RLS: "Officials read all resident profiles".
 */
export async function searchResidents(supabase, query) {
  const q = String(query || "").trim();
  if (q.length < 2) return [];

  const escaped = q.replace(/[%_,()]/g, " ");
  const orParts = [
    `first_name.ilike.%${escaped}%`,
    `last_name.ilike.%${escaped}%`,
    `middle_name.ilike.%${escaped}%`,
    `mobile_number.ilike.%${escaped}%`,
  ];

  const { data, error } = await supabase
    .from("resident_profiles")
    .select(
      "user_id, first_name, middle_name, last_name, suffix, date_of_birth, sex, mobile_number, house_street, purok, barangay, city, verification_status"
    )
    .or(orParts.join(","))
    .order("last_name", { ascending: true })
    .limit(8);

  if (error) return [];
  return data || [];
}

/**
 * Find likely duplicate complaints (warning only — does not block).
 */
export async function findPossibleDuplicates(supabase, { residentUserId, title, incidentDate }) {
  if (!title && !residentUserId) return [];

  let query = supabase
    .from("complaints")
    .select("id, reference_number, title, incident_date, submitted_at, current_status")
    .order("submitted_at", { ascending: false })
    .limit(12);

  if (residentUserId) {
    query = query.eq("resident_id", residentUserId);
  } else if (title) {
    query = query.ilike("title", `%${title.slice(0, 40)}%`);
  }

  const { data, error } = await query;
  if (error || !data?.length) return [];

  const titleWords = String(title || "")
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3);

  return data.filter((row) => {
    if (residentUserId && !title) return true;
    const rowTitle = String(row.title || "").toLowerCase();
    const sameDate =
      incidentDate && row.incident_date === incidentDate;
    const wordHit = titleWords.some((w) => rowTitle.includes(w));
    return wordHit || sameDate;
  }).slice(0, 5);
}

/**
 * Create complaint via SECURITY DEFINER RPC (reference + encoded_by server-side).
 */
export async function submitStaffAssistedComplaint(supabase, payload) {
  let classification = null;
  try {
    const response = await fetch("/api/classify", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: payload.description }),
    });
    if (response.ok) classification = (await response.json()).classification;
  } catch { /* An inference outage must not block an authorized filing. */ }

  const snapshot =
    payload.residentUserId == null
      ? {
          first_name: payload.walkIn.firstName,
          middle_name: payload.walkIn.middleName || "",
          last_name: payload.walkIn.lastName,
          suffix: payload.walkIn.suffix || "",
          date_of_birth: payload.walkIn.dateOfBirth || null,
          sex: payload.walkIn.sex || null,
          mobile_number: payload.walkIn.mobile || null,
          email: payload.walkIn.email || null,
          house_street: payload.walkIn.houseStreet || null,
          purok: payload.walkIn.purok || null,
          barangay: "Abuno",
          city: "Iligan City",
        }
      : null;

  const { data, error } = await supabase.rpc("create_staff_assisted_complaint", {
    p_title: payload.title,
    p_description: payload.description,
    p_incident_date: payload.incidentDate || null,
    p_incident_time: payload.incidentTime || null,
    p_incident_location: payload.incidentLocation,
    p_incident_purok: payload.incidentPurok || null,
    p_persons_involved: payload.personsInvolved || null,
    p_witnesses: payload.witnesses || null,
    p_resident_user_id: payload.residentUserId || null,
    p_complainant_snapshot: snapshot,
    p_respondent_name: payload.respondentName || null,
    p_respondent_address: payload.respondentAddress || null,
    p_respondent_contact: payload.respondentContact || null,
    p_other_involved: payload.otherInvolved || null,
    p_assisted_filing_reason: payload.assistedReason || null,
    p_confirmation_method: payload.confirmationMethod || "verbal_confirmed_in_hall",
    p_resident_ack_note: payload.ackNote || null,
    p_duplicate_override_reason: payload.duplicateOverrideReason || null,
    p_predicted_category: null,
    p_predicted_case_type: null,
    p_predicted_urgency: null,
    p_prediction_confidence: null,
    p_filing_channel: payload.filingChannel || "staff_assisted",
  });

  if (error) {
    return { success: false, error: error.message };
  }

  const result = data;
  if (result?.id) {
    await fetch("/api/classify/attach", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: result.id }),
    }).catch(() => null);
  }

  // complaints.desired_relief has no parameter on
  // create_staff_assisted_complaint(), and adding one would leave the old
  // signature in place as an ambiguous overload. It is set through the narrow
  // RPC instead, which the encoder is allowed to call.
  if (payload.desiredRelief && result?.id) {
    const { error: reliefError } = await supabase.rpc("set_complaint_desired_relief", {
      p_complaint_id: result.id,
      p_desired_relief: payload.desiredRelief,
    });
    if (reliefError) {
      return { success: false, error: reliefError.message, id: result?.id };
    }
  }

  return {
    success: true,
    id: result?.id,
    reference_number: result?.reference_number,
    classification,
  };
}

/**
 * Upload evidence under the encoder's own storage folder:
 *   {encoderUid}/{complaintId}/{uuid}.{ext}
 */
export async function uploadStaffEvidence(supabase, complaintId, file, description) {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { success: false, error: "Not authenticated" };

  if (!isAllowedEvidenceFile(file)) {
    return { success: false, error: `"${file.name}" is not a supported type.` };
  }
  if (isOversizedEvidence(file)) {
    return { success: false, error: `"${file.name}" exceeds 10 MB.` };
  }

  const ext = (file.name.split(".").pop() || "bin").toLowerCase();
  const path = `${userData.user.id}/${complaintId}/${crypto.randomUUID()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from("evidence")
    .upload(path, file);

  if (uploadError) return { success: false, error: uploadError.message };

  const mimeBase = file.type.split("/")[0];
  const evidenceType =
    mimeBase === "image" ? "photo" : mimeBase === "audio" ? "audio" : mimeBase === "video" ? "video" : "document";

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

/** Notify linked resident (tolerant). */
export async function notifyLinkedResident(supabase, complaintId, residentUserId, referenceNumber) {
  if (!residentUserId) return false;
  const { error } = await supabase.from("notifications").insert({
    user_id: residentUserId,
    type: "complaint",
    title: "Complaint filed at barangay hall",
    message: `Your complaint ${referenceNumber || ""} was encoded by barangay staff and is awaiting review.`,
    related_complaint_id: complaintId,
    related_hearing_id: null,
  });
  return !error;
}

export { createClient };
