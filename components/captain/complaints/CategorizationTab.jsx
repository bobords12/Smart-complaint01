"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { Sparkles, Lock } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/context/AuthContext";
import {
  notifyResident,
  confirmOfficialCategorization,
  advancePastCategorization,
  NO_CATEGORY_CONFIRMED,
} from "@/lib/complaintQueries";
import LoadingButton from "@/components/shared/LoadingButton";
import { CATEGORY_OPTIONS, URGENCY_OPTIONS, resolvePredictedCategory } from "./complaintMeta";
import { saveClassificationParts } from "./classificationSave";

const LABEL = "text-[11px] font-medium uppercase tracking-wide text-muted";

export default function CategorizationTab({ complaint, reviews, onChanged }) {
  const { user } = useAuth();
  const canConfirm = user?.role === "captain" || user?.role === "oic";

  const latest = reviews?.[0];

  // Existing official value always wins over the newer AI suggestion, so a
  // saved human decision is never overwritten on load. The AI value is only
  // used to initialise an empty form for convenience.
  const officialType =
    complaint?.confirmed_category || complaint?.confirmed_case_type || latest?.confirmed_category || "";
  const officialUrgency = complaint?.confirmed_urgency || latest?.confirmed_urgency || "";
  const aiType = resolvePredictedCategory(complaint) || "";
  const aiUrgency = complaint?.predicted_urgency || "";

  const confidence = complaint?.prediction_confidence
    ? Math.round((Number(complaint.prediction_confidence) || 0) * 100)
    : null;

  const [form, setForm] = useState(() => {
    const type = officialType || aiType || "";
    return {
      category: type,
      urgency: type === NO_CATEGORY_CONFIRMED ? "" : officialUrgency || aiUrgency || "",
      reviewed: Boolean(latest),
      specific: complaint?.confirmed_specific_category || complaint?.predicted_specific_category || "",
    };
  });
  const [saving, setSaving] = useState(false);

  const alreadyConfirmed = Boolean(officialType && officialUrgency);
  const categoryDefined = form.category !== NO_CATEGORY_CONFIRMED && form.category !== "";
  const canSave =
    form.reviewed &&
    (categoryDefined ? Boolean(form.urgency) : form.category === NO_CATEGORY_CONFIRMED);

  const handleSave = async () => {
    if (!form.reviewed) {
      toast.error("Confirm that the complaint information was reviewed.");
      return;
    }
    if (categoryDefined && !form.urgency) {
      toast.error("Select the official urgency.");
      return;
    }
    if (!form.category) {
      toast.error("Select the official type.");
      return;
    }

    const supabase = createClient();
    setSaving(true);
    try {
      // A retry after the specific-category RPC failed must not repeat the
      // already committed broad decision, review row or audit event.
      const existingDecision = Boolean(latest && complaint?.confirmed_category && complaint?.confirmed_urgency) &&
        form.category === complaint.confirmed_category && form.urgency === complaint.confirmed_urgency;
      const outcome = await saveClassificationParts({
        existingDecision,
        needsSpecific: Boolean(form.specific.trim() &&
          form.specific.trim() !== (complaint?.confirmed_specific_category || "")),
        confirmBroad: () => confirmOfficialCategorization(supabase, {
          complaint, category: form.category, urgency: form.urgency, remarks: "",
          reviewed: form.reviewed, reviewedBy: user?.id || null,
        }),
        confirmSpecific: async () => {
          const { error } = await supabase.rpc("confirm_specific_category", {
            p_complaint_id: complaint.id, p_category: form.specific.trim(),
          });
          return { success: !error };
        },
      });
      if (outcome.status !== "saved") {
        toast.error(outcome.status === "broad_unknown"
          ? "The decision may have been partially saved. Refresh the case before retrying."
          : "The specific category could not be confirmed. The broad decision may already be saved; refresh and retry.");
        onChanged();
        return;
      }

      // The recorded stage has to follow the decision. This tab is the
      // control the "Review Classification" button opens, and it used to
      // write only the confirmed columns: the case stayed parked on
      // 'For Official Categorization', so the ladder kept offering
      // "Review Classification" and the case never reached the summons /
      // Notice of Hearing steps. Re-confirming an already saved decision
      // runs the same advance, which is what repairs a stage an older save
      // left behind.
      const stageAdvanced = await advancePastCategorization(supabase, {
        complaint,
        category: form.category,
        urgency: form.urgency,
        changedBy: user?.id || null,
      });

      if (outcome.changed) {
        await notifyResident(supabase, complaint.id, complaint.resident_id, {
          type: "complaint",
          title: "Categorization reviewed",
          message: `An official reviewed the categorization of your complaint ${complaint.reference_number || ""}.`,
        });
      }

      // Saying which of the two happened matters: without it a re-confirmation
      // of a saved decision looked like a click that did nothing, when what it
      // actually did was release the case onto the summons / Notice of Hearing
      // steps.
      toast.success(
        stageAdvanced
          ? "Classification confirmed. The case is now on summons and hearing processing."
          : "Official classification saved to the audit log."
      );
      onChanged();
    } catch {
      toast.error("Could not save the official classification. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-xs leading-relaxed text-muted">
        AI suggestions are decision support and require official confirmation.
      </p>

      {/* One unified card: AI suggestion and official decision side by side. */}
      <div className="grid grid-cols-1 lg:grid-cols-2">
        {/* AI Suggestion — reference only, never editable. */}
        <div className="min-w-0 pb-5 lg:pb-0 lg:pr-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-heading text-sm font-semibold text-navy">AI Suggestion</h3>
            <span className="inline-flex shrink-0 items-center rounded-full bg-[#714bd8]/10 px-2.5 py-1 text-[11px] font-semibold text-[#714bd8]">
              <Sparkles className="mr-1 h-3 w-3" aria-hidden="true" />
              {complaint?.prediction_model?.startsWith("svm-") ? "Linear SVM" : "Existing classifier"}
            </span>
          </div>
          <dl className="mt-4 space-y-4">
            <div className="min-w-0">
              <dt className={LABEL}>Suggested Type</dt>
              <dd className="mt-1 text-sm font-semibold text-mirage">{aiType || "Not classified"}</dd>
            </div>
            <div className="min-w-0">
              <dt className={LABEL}>Suggested Specific Category</dt>
              <dd className="mt-1 text-sm font-semibold text-mirage">{complaint?.predicted_specific_category || "Pending classification"}</dd>
            </div>
            {canConfirm && !complaint?.predicted_specific_category && !alreadyConfirmed && (
              <button type="button" className="text-xs font-semibold text-secondary underline"
                onClick={async () => {
                  const response = await fetch("/api/classify/attach", {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ id: complaint.id }),
                  });
                  if (response.ok) onChanged();
                  else toast.error("Prediction is still pending. Please retry later.");
                }}>Retry suggestion</button>
            )}
            <div className="min-w-0">
              <dt className={LABEL}>Suggested Urgency</dt>
              <dd className="mt-1 text-sm font-semibold text-mirage">
                {aiUrgency || "Not classified"}
                {!complaint?.prediction_model?.startsWith("svm-") && confidence != null ? ` · ${confidence}%` : ""}
              </dd>
            </div>
          </dl>
        </div>

        {/* Official Verification — the human decision. */}
        <div className="min-w-0 border-t border-line pt-5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-heading text-sm font-semibold text-navy">Official Verification</h3>
            <span
              className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                alreadyConfirmed
                  ? "border-[#17774e]/25 bg-success-soft text-success"
                  : "border-[#b45309]/25 bg-warning-soft text-warning"
              }`}
            >
              {alreadyConfirmed ? "Confirmed" : "Unconfirmed"}
            </span>
          </div>

          <div className="mt-4 space-y-3">
            {!canConfirm ? (
              <>
                <div className="flex items-start gap-2.5 rounded-xl border border-line bg-info-soft/40 p-3">
                  <Lock className="mt-0.5 h-4 w-4 shrink-0 text-secondary" aria-hidden="true" />
                  <p className="text-xs leading-relaxed text-navy">
                    Read-only view. Confirming or editing the official classification is limited to
                    the Barangay Captain or OIC.
                  </p>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="rounded-xl bg-alt px-4 py-3">
                    <p className={LABEL}>Type</p>
                    <p className="mt-1 text-sm font-semibold text-mirage">
                      {officialType || "Not confirmed"}
                    </p>
                  </div>
                  <div className="rounded-xl bg-alt px-4 py-3">
                    <p className={LABEL}>Confirmed Specific Category</p>
                    <p className="mt-1 text-sm font-semibold text-mirage">{complaint?.confirmed_specific_category || "Not confirmed"}</p>
                  </div>
                  <div className="rounded-xl bg-alt px-4 py-3">
                    <p className={LABEL}>Urgency</p>
                    <p className="mt-1 text-sm font-semibold text-mirage">
                      {officialUrgency || "Not confirmed"}
                    </p>
                  </div>
                </div>
                {latest?.review_notes ? (
                  <div className="rounded-xl border border-line px-4 py-3">
                    <p className={LABEL}>Review remarks</p>
                    <p className="mt-1 text-sm text-mirage">{latest.review_notes}</p>
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <div>
                  <label className={`mb-1 block ${LABEL}`} htmlFor="cat-category">
                    Type
                  </label>
                  <select
                    id="cat-category"
                    value={form.category}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        category: e.target.value,
                        urgency:
                          e.target.value === NO_CATEGORY_CONFIRMED ? "" : form.urgency,
                      })
                    }
                    className="h-11 w-full rounded-full border border-line bg-white px-4 text-sm text-mirage outline-none focus:border-secondary focus:ring-2 focus:ring-secondary/20"
                  >
                    <option value="">Select type…</option>
                    {CATEGORY_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                    <option value={NO_CATEGORY_CONFIRMED}>{NO_CATEGORY_CONFIRMED}</option>
                  </select>
                </div>

                <div>
                  <label className={`mb-1 block ${LABEL}`} htmlFor="cat-specific">Specific category (optional)</label>
                  <input id="cat-specific" type="text" maxLength={120} value={form.specific}
                    onChange={(e) => setForm({ ...form, specific: e.target.value })}
                    className="h-11 w-full rounded-full border border-line bg-white px-4 text-sm text-mirage" />
                </div>

                <div>
                  <label className={`mb-1 block ${LABEL}`} htmlFor="cat-urgency">
                    Urgency
                  </label>
                  <select
                    id="cat-urgency"
                    value={form.urgency}
                    disabled={!categoryDefined}
                    onChange={(e) => setForm({ ...form, urgency: e.target.value })}
                    className="h-11 w-full rounded-full border border-line bg-white px-4 text-sm text-mirage outline-none focus:border-secondary focus:ring-2 focus:ring-secondary/20 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <option value="">Select urgency…</option>
                    {URGENCY_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>

                <label className="flex items-start gap-2.5 text-sm text-mirage">
                  <input
                    type="checkbox"
                    checked={form.reviewed}
                    onChange={(e) => setForm({ ...form, reviewed: e.target.checked })}
                    className="mt-0.5 h-4 w-4 rounded border-line accent-[#17774e]"
                  />
                  Complaint information reviewed.
                </label>

                <div className="flex justify-end pt-1">
                  <LoadingButton isLoading={saving} disabled={!canSave} onClick={handleSave}>
                    Confirm Classification
                  </LoadingButton>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <p className="border-t border-line pt-3 text-xs leading-relaxed text-muted">
        <span className="font-semibold text-mirage">Critical-case advisory.</span> A critical result
        creates an advisory flag for immediate review. It does not automatically contact the PNP;
        any external coordination is performed off-system and recorded here as an official note.
      </p>
    </div>
  );
}
