"use client";

import { createClient } from "@/lib/supabase/client";
import {
  complaintStoragePath,
  buildReklamoFieldModel,
  receiptFileName,
  receiptFolder,
  reklamoSnapshotFromModel,
} from "@/lib/reklamo/reklamoDocument";
import { reklamoPdfBlob } from "@/lib/reklamo/reklamoPdf";

export async function setComplaintDesiredRelief(complaintId, desiredRelief) {
  const supabase = createClient();
  const { error } = await supabase.rpc("set_complaint_desired_relief", {
    p_complaint_id: complaintId,
    p_desired_relief: desiredRelief,
  });
  return { success: !error, error: error?.message };
}

async function uploadToPrivateBucket(path, blob) {
  const supabase = createClient();
  const { error } = await supabase.storage.from("documents").upload(path, blob, {
    contentType: "application/pdf",
    upsert: true,
  });
  if (error) throw new Error(error.message);
}

async function recordRow(path, blobSize, model, evidenceCount) {
  const supabase = createClient();
  const { error } = await supabase.rpc("record_submission_receipt", {
    p_complaint_id: model.complaintId,
    p_filename: model.fileName,
    p_storage_path: path,
    p_file_size: blobSize,
    p_evidence_count: evidenceCount,
    p_snapshot: reklamoSnapshotFromModel(model.fieldModel),
  });
  if (error) throw new Error(error.message);
}

export async function issueSubmissionReceipt({ complaint, complainant, evidenceCount = 0 }) {
  try {
    const fieldModel = buildReklamoFieldModel({ complaint, complainant, now: new Date() });
    const fileName = receiptFileName(complaint.reference_number);
    const path = complaintStoragePath(complaint.id, receiptFolder(), fileName);
    const { blob } = reklamoPdfBlob({ model: fieldModel });

    await uploadToPrivateBucket(path, blob);
    await recordRow(path, blob.size, { ...fieldModel, complaintId: complaint.id, fileName }, evidenceCount);

    return { success: true };
  } catch {
    return { success: false };
  }
}
