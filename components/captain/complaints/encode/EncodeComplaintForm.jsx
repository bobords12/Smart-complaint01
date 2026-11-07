"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Building2,
  CheckCircle2,
  Clipboard,
  FileText,
  Info,
  MapPin,
  Pencil,
  Search,
  Trash2,
  Upload,
  UserRound,
  Users,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { SITE } from "@/lib/constants";
import ReklamoFormPreview from "@/components/reklamo/ReklamoFormPreview";
import { buildReklamoFieldModel } from "@/lib/reklamo/reklamoDocument";
import { useOfficialRoutes } from "@/components/official/OfficialPortalProvider";
import { useAuth } from "@/context/AuthContext";
import { getOfficialIdentity } from "@/repositories/profileRepository";
import {
  ENCODE_STEPS,
  findPossibleDuplicates,
  isAllowedEvidenceFile,
  isOversizedEvidence,
  isValidEmail,
  isValidPhMobile,
  notifyLinkedResident,
  searchResidents,
  submitStaffAssistedComplaint,
  uploadStaffEvidence,
} from "@/lib/staffAssistedComplaint";

const inputClass =
  "w-full min-h-[44px] rounded-xl border border-line bg-white dark:bg-canvas px-3.5 py-2.5 text-sm text-mirage outline-none transition-colors placeholder:text-muted/60 focus:border-secondary focus:ring-2 focus:ring-secondary/20";

const fileLabelClass =
  "flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line bg-white dark:bg-alt px-4 text-sm font-medium text-muted transition-colors hover:border-secondary hover:text-secondary";

function todayString() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FieldError({ id, message }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-1.5 flex items-start gap-1.5 text-[12.5px] font-medium text-critical">
      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {message}
    </p>
  );
}

function Stepper({ currentStep }) {
  const currentLabel = ENCODE_STEPS[currentStep]?.label || "";
  return (
    <nav aria-label="Encode complaint steps" className="mb-6">
      <p className="sr-only" aria-live="polite">
        Step {currentStep + 1} of {ENCODE_STEPS.length}: {currentLabel}
      </p>
      <ol className="flex items-start justify-between gap-1 overflow-x-auto pb-1">
        {ENCODE_STEPS.map((step, idx) => {
          const isCompleted = idx < currentStep;
          const isActive = idx === currentStep;
          return (
            <li key={step.id} className="flex min-w-[56px] flex-1 flex-col items-center sm:min-w-0">
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold transition-colors ${
                  isCompleted
                    ? "bg-success text-white"
                    : isActive
                      ? "bg-secondary text-white ring-4 ring-secondary/20"
                      : "bg-line text-muted"
                }`}
                aria-current={isActive ? "step" : undefined}
              >
                {isCompleted ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : idx + 1}
              </span>
              <span
                className={`mt-1 hidden max-w-[72px] text-center text-[10px] font-medium leading-tight sm:block ${
                  isActive ? "text-secondary" : isCompleted ? "text-success" : "text-muted"
                }`}
              >
                {step.label}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function SummaryRow({ icon, label, value }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 text-muted" aria-hidden="true">
        {icon}
      </span>
      <div className="min-w-0">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted">{label}</span>
        <p className="mt-0.5 break-words text-[13px] leading-relaxed text-mirage">{value || "—"}</p>
      </div>
    </div>
  );
}

const ASSISTED_REASONS = [
  { value: "walk_in_no_account", label: "Walk-in resident without a portal account" },
  { value: "walk_in_prefers_assistance", label: "Walk-in resident prefers staff assistance" },
  { value: "accessibility", label: "Resident needs accessibility assistance" },
  { value: "other", label: "Other authorized reason" },
];

export default function EncodeComplaintForm() {
  const router = useRouter();
  const routes = useOfficialRoutes();
  const { user, isLoading: authLoading } = useAuth();
  const [supabase] = useState(() => createClient());
  const identity = getOfficialIdentity(user);

  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const submitLockRef = useRef(false);
  const [result, setResult] = useState(null);
  const [duplicates, setDuplicates] = useState([]);
  const [duplicateAck, setDuplicateAck] = useState(false);
  const [duplicateChecked, setDuplicateChecked] = useState(false);

  const [residentMode, setResidentMode] = useState("search");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchDone, setSearchDone] = useState(false);
  const [selectedResident, setSelectedResident] = useState(null);

  const [walkIn, setWalkIn] = useState({
    firstName: "",
    middleName: "",
    lastName: "",
    suffix: "",
    dateOfBirth: "",
    sex: "",
    mobile: "",
    email: "",
    houseStreet: "",
    purok: "",
  });

  const [details, setDetails] = useState({
    title: "",
    description: "",
    incidentDate: "",
    incidentTime: "",
    desiredRemedy: "",
  });

  const [respondent, setRespondent] = useState({
    name: "",
    address: "",
    contact: "",
    location: "",
    purok: "",
    witnesses: "",
    otherInvolved: "",
  });

  const [files, setFiles] = useState([]);
  const [fileNotes, setFileNotes] = useState("");
  const [showReklamoPreview, setShowReklamoPreview] = useState(false);
  const fileInputRef = useRef(null);

  const [confirmations, setConfirmations] = useState({
    confirmedWithComplainant: false,
    complainantReviewed: false,
    informedNotEstablished: false,
  });
  const [assistedReason, setAssistedReason] = useState("walk_in_no_account");
  const [ackNote, setAckNote] = useState("");

  const authorized = ["captain", "oic", "secretary"].includes(user?.role);
  const filingLabel =
    residentMode === "walk_in" || !selectedResident
      ? "Barangay Hall (walk-in)"
      : "Barangay Hall (linked resident)";

  const canContinueResident =
    residentMode === "search" ? Boolean(selectedResident) : Boolean(walkIn.firstName && walkIn.lastName);

  const clearError = useCallback((field) => {
    setErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }, []);

  const setDetailField = useCallback(
    (field, value) => {
      setDetails((prev) => ({ ...prev, [field]: value }));
      clearError(field);
    },
    [clearError]
  );

  const setRespField = useCallback(
    (field, value) => {
      setRespondent((prev) => ({ ...prev, [field]: value }));
      clearError(field);
    },
    [clearError]
  );

  const setWalkField = useCallback(
    (field, value) => {
      setWalkIn((prev) => ({ ...prev, [field]: value }));
      clearError(field);
    },
    [clearError]
  );

  useEffect(() => {
    if (residentMode !== "search") return undefined;
    const q = searchQuery.trim();
    if (q.length < 2) return undefined;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const rows = await searchResidents(supabase, q);
      if (cancelled) return;
      setSearchResults(rows);
      setSearchDone(true);
      setSearching(false);
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      setSearching(false);
    };
  }, [searchQuery, residentMode, supabase]);

  const handleSearchChange = useCallback((value) => {
    setSearchQuery(value);
    if (value.trim().length < 2) {
      setSearchResults([]);
      setSearchDone(false);
      setSearching(false);
    } else {
      setSearching(true);
    }
  }, []);

  const handleFilesChosen = useCallback((e) => {
    const chosen = Array.from(e.target.files || []);
    const valid = [];
    for (const file of chosen) {
      if (!isAllowedEvidenceFile(file)) {
        toast.error(`"${file.name}" is not a supported type.`);
        continue;
      }
      if (isOversizedEvidence(file)) {
        toast.error(`"${file.name}" exceeds 10 MB.`);
        continue;
      }
      valid.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
        file,
      });
    }
    if (valid.length) setFiles((prev) => [...prev, ...valid]);
    e.target.value = "";
  }, []);

  const removeFile = useCallback((id) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const validateStep = useCallback(() => {
    const next = {};

    if (step === 0) {
      if (residentMode === "search" && !selectedResident) {
        next.resident = "Select an existing resident or switch to walk-in encoding.";
      }
      if (residentMode === "walk_in") {
        if (!walkIn.firstName.trim()) next.firstName = "First name is required.";
        if (!walkIn.lastName.trim()) next.lastName = "Last name is required.";
        if (walkIn.mobile && !isValidPhMobile(walkIn.mobile)) {
          next.mobile = "Enter a valid Philippine mobile (e.g. 09171234567).";
        }
        if (walkIn.email && !isValidEmail(walkIn.email)) {
          next.email = "Enter a valid email address.";
        }
        if (!walkIn.purok.trim()) next.purok = "Purok is required.";
      }
    }

    if (step === 1) {
      if (!details.title.trim()) next.title = "Complaint title or subject is required.";
      if (!details.description.trim()) {
        next.description = "Narrative is required.";
      } else if (details.description.trim().length < 20) {
        next.description = "Narrative must be at least 20 characters.";
      }
      if (!details.incidentDate) {
        next.incidentDate = "Incident date is required.";
      } else if (details.incidentDate > todayString()) {
        next.incidentDate = "Incident date cannot be in the future.";
      }
    }

    if (step === 2) {
      if (!respondent.location.trim()) {
        next.location = "Incident location is required.";
      }
    }

    if (step === 4) {
      if (!confirmations.confirmedWithComplainant) next.c1 = "Required confirmation.";
      if (!confirmations.complainantReviewed) next.c2 = "Required confirmation.";
      if (!confirmations.informedNotEstablished) next.c3 = "Required confirmation.";
      if (duplicateChecked && duplicates.length > 0 && !duplicateAck) {
        next.duplicate = "Review the duplicate warning and confirm to continue.";
      }
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  }, [
    step,
    residentMode,
    selectedResident,
    walkIn,
    details,
    respondent,
    confirmations,
    duplicateChecked,
    duplicates.length,
    duplicateAck,
  ]);

  const goToStep = useCallback((target) => {
    setStep(target);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const handleNext = useCallback(() => {
    if (!validateStep()) return;
    if (step === 4 && !duplicateChecked) {
      (async () => {
        const dups = await findPossibleDuplicates(supabase, {
          residentUserId: selectedResident?.user_id || null,
          title: details.title,
          incidentDate: details.incidentDate,
        });
        setDuplicates(dups);
        setDuplicateChecked(true);
        goToStep(step + 1);
      })();
      return;
    }
    goToStep(step + 1);
  }, [validateStep, step, duplicateChecked, goToStep, supabase, selectedResident, details]);

  const handleBack = useCallback(() => {
    goToStep(step - 1);
  }, [step, goToStep]);

  const handleSubmit = useCallback(async () => {
    if (!validateStep() || submitting || submitLockRef.current) return;
    submitLockRef.current = true;
    setSubmitting(true);
    const toastId = toast.loading("Submitting complaint...");

    try {
      const residentUserId = selectedResident?.user_id || null;

      const payload = {
        title: details.title.trim(),
        description: details.description.trim(),
        incidentDate: details.incidentDate,
        incidentTime: details.incidentTime || null,
        incidentLocation: respondent.location.trim(),
        incidentPurok: respondent.purok || null,
        // Stored on its own column by create_staff_assisted_complaint(). It is
        // no longer prefixed into persons_involved, which would have printed a
        // sentence in the "Sinumbong" box of the official Reklamo Form.
        personsInvolved: respondent.otherInvolved || null,
        desiredRelief: details.desiredRemedy || null,
        witnesses: respondent.witnesses || null,
        residentUserId,
        walkIn,
        respondentName: respondent.name || null,
        respondentAddress: respondent.address || null,
        respondentContact: respondent.contact || null,
        otherInvolved: respondent.otherInvolved || null,
        assistedReason,
        confirmationMethod: "verbal_confirmed_in_hall",
        ackNote: ackNote || null,
        duplicateOverrideReason:
          duplicateChecked && duplicateAck && duplicates.length
            ? ackNote || "Reviewed by encoder"
            : null,
        filingChannel: "barangay_hall",
      };

      const created = await submitStaffAssistedComplaint(supabase, payload);

      if (!created.success || !created.id) {
        toast.error(created.error || "Complaint could not be recorded.", { id: toastId });
        submitLockRef.current = false;
        setSubmitting(false);
        return;
      }

      let evidenceFailures = 0;
      for (const item of files) {
        const up = await uploadStaffEvidence(supabase, created.id, item.file, fileNotes || null);
        if (!up.success) evidenceFailures += 1;
      }

      if (residentUserId) {
        await notifyLinkedResident(supabase, created.id, residentUserId, created.reference_number);
      }

      toast.success("Complaint encoded successfully.", { id: toastId });
      if (evidenceFailures > 0) {
        toast(
          `${evidenceFailures} evidence file(s) could not be uploaded. You can attach them from the case workspace.`,
          { icon: "⚠️" }
        );
      }

      setResult({
        id: created.id,
        referenceNumber: created.reference_number,
        complainantName: selectedResident
          ? [selectedResident.first_name, selectedResident.last_name].filter(Boolean).join(" ")
          : [walkIn.firstName, walkIn.lastName].filter(Boolean).join(" "),
        filedAt: new Date().toLocaleString("en-PH", {
          dateStyle: "medium",
          timeStyle: "short",
        }),
      });
      goToStep(5);
    } catch (err) {
      toast.error("Complaint could not be encoded.", { id: toastId });
      console.error("Staff-assisted encode failed:", err?.name || "Error");
    } finally {
      submitLockRef.current = false;
      setSubmitting(false);
    }
  }, [
    validateStep,
    submitting,
    selectedResident,
    details,
    respondent,
    walkIn,
    assistedReason,
    ackNote,
    duplicateChecked,
    duplicateAck,
    duplicates.length,
    files,
    fileNotes,
    supabase,
    goToStep,
  ]);

  if (authLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <p className="text-sm text-muted" role="status">
          Loading…
        </p>
      </div>
    );
  }

  if (!authorized) {
    return (
      <div className="mx-auto max-w-xl py-14 text-center">
        <AlertTriangle className="mx-auto h-10 w-10 text-critical" aria-hidden="true" />
        <h1 className="mt-4 text-lg font-bold text-navy">Access denied</h1>
        <p className="mt-2 text-sm text-muted">
          Staff-assisted encoding is limited to the Barangay Captain, OIC, and Secretary.
        </p>
        <button
          type="button"
          onClick={() => router.push(routes.complaints)}
          className="mt-6 inline-flex min-h-[44px] items-center rounded-full border border-line bg-white px-6 text-sm font-semibold text-mirage hover:bg-alt"
        >
          Back to Complaints
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl pb-14 pt-4 sm:pt-6">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <button
            type="button"
            onClick={() => router.push(routes.complaints)}
            className="mb-2 inline-flex min-h-[40px] items-center gap-1.5 text-sm font-semibold text-secondary hover:text-navy"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Complaints
          </button>
          <h1 className="font-heading text-2xl font-bold tracking-tight text-navy sm:text-3xl">
            Encode Complaint
          </h1>
          <p className="mt-1 text-sm text-muted">
            <span className="font-semibold text-navy">Assisted Filing</span> — use this form to
            encode a complaint for a resident who is filing at the Barangay Hall. You are the
            encoder; the resident remains the complainant.
          </p>
        </div>
        <div className="shrink-0 rounded-xl border border-line bg-white px-3 py-2 text-xs">
          <p className="font-semibold text-mirage">{identity.displayName}</p>
          <p className="text-muted">{identity.roleLabel}</p>
        </div>
      </div>

      <div className="rounded-2xl border border-line bg-white p-4 shadow-soft sm:p-6">
        {step < 5 && <Stepper currentStep={step} />}

        {step === 0 && (
          <div className="space-y-5">
            <div className="flex flex-col gap-2 sm:flex-row" role="radiogroup" aria-label="Resident type">
              <button
                type="button"
                role="radio"
                aria-checked={residentMode === "search"}
                onClick={() => setResidentMode("search")}
                className={`inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold transition-colors ${
                  residentMode === "search"
                    ? "bg-navy text-white"
                    : "border border-line bg-white text-mirage hover:bg-alt"
                }`}
              >
                <Search className="h-4 w-4" aria-hidden="true" />
                Existing resident
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={residentMode === "walk_in"}
                onClick={() => setResidentMode("walk_in")}
                className={`inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold transition-colors ${
                  residentMode === "walk_in"
                    ? "bg-navy text-white"
                    : "border border-line bg-white text-mirage hover:bg-alt"
                }`}
              >
                <UserRound className="h-4 w-4" aria-hidden="true" />
                Walk-in (no account)
              </button>
            </div>

            {residentMode === "search" && (
              <div className="space-y-4">
                <div>
                  <label htmlFor="resident-search" className="mb-1.5 block text-[13.5px] font-semibold text-mirage">
                    Find resident <span className="text-critical">*</span>
                  </label>
                  <div className="relative">
                    <Search
                      className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
                      aria-hidden="true"
                    />
                    <input
                      id="resident-search"
                      type="search"
                      value={searchQuery}
                      onChange={(e) => handleSearchChange(e.target.value)}
                      placeholder="Full name, email, or mobile number"
                      className={`${inputClass} pl-10`}
                      autoComplete="off"
                      aria-describedby={errors.resident ? "err-resident" : undefined}
                      aria-invalid={Boolean(errors.resident)}
                    />
                  </div>
                  <FieldError id="err-resident" message={errors.resident} />
                  <p className="mt-1 text-xs text-muted" aria-live="polite">
                    {searching
                      ? "Searching…"
                      : searchDone
                        ? `${searchResults.length} match(es)`
                        : "Type at least 2 characters. Only resident profile fields needed for selection are shown."}
                  </p>
                </div>

                {searchResults.length > 0 && (
                  <ul className="max-h-64 space-y-2 overflow-y-auto" role="listbox" aria-label="Resident search results">
                    {searchResults.map((r) => {
                      const name = [r.first_name, r.middle_name, r.last_name].filter(Boolean).join(" ");
                      const isSelected = selectedResident?.user_id === r.user_id;
                      return (
                        <li key={r.user_id} role="option" aria-selected={isSelected}>
                          <button
                            type="button"
                            onClick={() => setSelectedResident(r)}
                            className={`flex w-full min-h-[44px] flex-col items-start gap-0.5 rounded-xl border px-4 py-3 text-left transition-colors ${
                              isSelected
                                ? "border-secondary bg-info-soft"
                                : "border-line bg-white hover:bg-alt"
                            }`}
                          >
                            <span className="text-sm font-semibold text-mirage">{name}</span>
                            <span className="truncate text-xs text-muted">
                              {[r.purok, r.mobile_number, r.verification_status].filter(Boolean).join(" · ")}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}

                {selectedResident && (
                  <div className="rounded-xl border border-success/30 bg-success-soft p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-success">
                      Database-sourced (verified profile)
                    </p>
                    <dl className="mt-2 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                      <div>
                        <dt className="text-xs text-muted">Name</dt>
                        <dd className="font-semibold text-mirage">
                          {[selectedResident.first_name, selectedResident.middle_name, selectedResident.last_name]
                            .filter(Boolean)
                            .join(" ")}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted">Mobile</dt>
                        <dd className="font-semibold text-mirage">{selectedResident.mobile_number || "—"}</dd>
                      </div>
                      <div className="sm:col-span-2">
                        <dt className="text-xs text-muted">Address</dt>
                        <dd className="font-semibold text-mirage">
                          {[
                            selectedResident.house_street,
                            selectedResident.purok,
                            selectedResident.barangay,
                            selectedResident.city,
                          ]
                            .filter(Boolean)
                            .join(", ")}
                        </dd>
                      </div>
                    </dl>
                    <p className="mt-2 text-xs text-muted">
                      Linked as resident account. Profile data is not overwritten by this form.
                    </p>
                    <button
                      type="button"
                      onClick={() => setSelectedResident(null)}
                      className="mt-2 min-h-[40px] text-xs font-semibold text-critical hover:underline"
                    >
                      Clear selection
                    </button>
                  </div>
                )}
              </div>
            )}

            {residentMode === "walk_in" && (
              <div className="space-y-4">
                <p className="rounded-xl border border-line bg-canvas px-4 py-3 text-xs leading-relaxed text-muted">
                  <Info className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
                  No account will be created. Email is optional. Do not invent credentials for the walk-in
                  resident.
                </p>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="wi-first" className="mb-1.5 block text-[13.5px] font-semibold text-mirage">
                      First Name <span className="text-critical">*</span>
                    </label>
                    <input
                      id="wi-first"
                      type="text"
                      value={walkIn.firstName}
                      onChange={(e) => setWalkField("firstName", e.target.value)}
                      className={`${inputClass} ${errors.firstName ? "border-critical" : ""}`}
                      aria-invalid={Boolean(errors.firstName)}
                      aria-describedby={errors.firstName ? "err-wi-first" : undefined}
                    />
                    <FieldError id="err-wi-first" message={errors.firstName} />
                  </div>
                  <div>
                    <label htmlFor="wi-last" className="mb-1.5 block text-[13.5px] font-semibold text-mirage">
                      Last Name <span className="text-critical">*</span>
                    </label>
                    <input
                      id="wi-last"
                      type="text"
                      value={walkIn.lastName}
                      onChange={(e) => setWalkField("lastName", e.target.value)}
                      className={`${inputClass} ${errors.lastName ? "border-critical" : ""}`}
                      aria-invalid={Boolean(errors.lastName)}
                      aria-describedby={errors.lastName ? "err-wi-last" : undefined}
                    />
                    <FieldError id="err-wi-last" message={errors.lastName} />
                  </div>
                  <div>
                    <label htmlFor="wi-middle" className="mb-1.5 block text-[13.5px] font-semibold text-mirage">
                      Middle Name <span className="font-normal text-muted">(optional)</span>
                    </label>
                    <input
                      id="wi-middle"
                      type="text"
                      value={walkIn.middleName}
                      onChange={(e) => setWalkField("middleName", e.target.value)}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label htmlFor="wi-suffix" className="mb-1.5 block text-[13.5px] font-semibold text-mirage">
                      Suffix <span className="font-normal text-muted">(optional)</span>
                    </label>
                    <input
                      id="wi-suffix"
                      type="text"
                      placeholder="Jr., Sr., III"
                      value={walkIn.suffix}
                      onChange={(e) => setWalkField("suffix", e.target.value)}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label htmlFor="wi-dob" className="mb-1.5 block text-[13.5px] font-semibold text-mirage">
                      Date of Birth <span className="font-normal text-muted">(optional)</span>
                    </label>
                    <input
                      id="wi-dob"
                      type="date"
                      max={todayString()}
                      value={walkIn.dateOfBirth}
                      onChange={(e) => setWalkField("dateOfBirth", e.target.value)}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label htmlFor="wi-sex" className="mb-1.5 block text-[13.5px] font-semibold text-mirage">
                      Sex <span className="font-normal text-muted">(optional)</span>
                    </label>
                    <select
                      id="wi-sex"
                      value={walkIn.sex}
                      onChange={(e) => setWalkField("sex", e.target.value)}
                      className={inputClass}
                    >
                      <option value="">Prefer not to say</option>
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="wi-mobile" className="mb-1.5 block text-[13.5px] font-semibold text-mirage">
                      Mobile Number <span className="font-normal text-muted">(optional)</span>
                    </label>
                    <input
                      id="wi-mobile"
                      type="tel"
                      inputMode="tel"
                      placeholder="09171234567"
                      value={walkIn.mobile}
                      onChange={(e) => setWalkField("mobile", e.target.value)}
                      className={`${inputClass} ${errors.mobile ? "border-critical" : ""}`}
                      aria-invalid={Boolean(errors.mobile)}
                      aria-describedby={errors.mobile ? "err-wi-mobile" : undefined}
                    />
                    <FieldError id="err-wi-mobile" message={errors.mobile} />
                  </div>
                  <div>
                    <label htmlFor="wi-email" className="mb-1.5 block text-[13.5px] font-semibold text-mirage">
                      Email <span className="font-normal text-muted">(optional — leave blank if none)</span>
                    </label>
                    <input
                      id="wi-email"
                      type="email"
                      value={walkIn.email}
                      onChange={(e) => setWalkField("email", e.target.value)}
                      className={`${inputClass} ${errors.email ? "border-critical" : ""}`}
                      aria-invalid={Boolean(errors.email)}
                      aria-describedby={errors.email ? "err-wi-email" : undefined}
                    />
                    <FieldError id="err-wi-email" message={errors.email} />
                  </div>
                  <div>
                    <label htmlFor="wi-house" className="mb-1.5 block text-[13.5px] font-semibold text-mirage">
                      House No. / Street <span className="font-normal text-muted">(optional)</span>
                    </label>
                    <input
                      id="wi-house"
                      type="text"
                      value={walkIn.houseStreet}
                      onChange={(e) => setWalkField("houseStreet", e.target.value)}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label htmlFor="wi-purok" className="mb-1.5 block text-[13.5px] font-semibold text-mirage">
                      Purok <span className="text-critical">*</span>
                    </label>
                    <input
                      id="wi-purok"
                      type="text"
                      placeholder="e.g. Purok 3"
                      value={walkIn.purok}
                      onChange={(e) => setWalkField("purok", e.target.value)}
                      className={`${inputClass} ${errors.purok ? "border-critical" : ""}`}
                      aria-invalid={Boolean(errors.purok)}
                      aria-describedby={errors.purok ? "err-wi-purok" : undefined}
                    />
                    <FieldError id="err-wi-purok" message={errors.purok} />
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-sm">
                  <div className="rounded-xl bg-alt px-3 py-2">
                    <span className="text-[11px] text-muted">Barangay</span>
                    <p className="font-semibold text-mirage">{SITE.barangay}</p>
                  </div>
                  <div className="rounded-xl bg-alt px-3 py-2">
                    <span className="text-[11px] text-muted">City</span>
                    <p className="font-semibold text-mirage">{SITE.city}</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {step === 1 && (
          <div className="space-y-5">
            <p className="rounded-xl border border-gold-soft bg-paledgold px-4 py-3 text-xs leading-relaxed text-mirage">
              <strong className="font-semibold text-warning">Reminder:</strong> Record the
              resident&apos;s statement accurately. Do not add personal conclusions.
            </p>
            <div>
              <label htmlFor="c-title" className="mb-1.5 block text-[13.5px] font-semibold text-mirage">
                Complaint title / subject <span className="text-critical">*</span>
              </label>
              <input
                id="c-title"
                type="text"
                value={details.title}
                onChange={(e) => setDetailField("title", e.target.value)}
                className={`${inputClass} ${errors.title ? "border-critical" : ""}`}
                aria-invalid={Boolean(errors.title)}
                aria-describedby={errors.title ? "err-title" : undefined}
              />
              <FieldError id="err-title" message={errors.title} />
            </div>
            <div>
              <label htmlFor="c-desc" className="mb-1.5 block text-[13.5px] font-semibold text-mirage">
                Detailed narrative (resident&apos;s statement) <span className="text-critical">*</span>
              </label>
              <textarea
                id="c-desc"
                rows={6}
                value={details.description}
                onChange={(e) => setDetailField("description", e.target.value)}
                placeholder="What happened, when, and who was involved — in the resident’s words."
                className={`${inputClass} resize-y ${errors.description ? "border-critical" : ""}`}
                aria-invalid={Boolean(errors.description)}
                aria-describedby={errors.description ? "err-desc" : "desc-hint"}
              />
              <FieldError id="err-desc" message={errors.description} />
              <p id="desc-hint" className="mt-1 text-xs text-muted">
                Minimum 20 characters.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="c-date" className="mb-1.5 block text-[13.5px] font-semibold text-mirage">
                  Date of incident <span className="text-critical">*</span>
                </label>
                <input
                  id="c-date"
                  type="date"
                  max={todayString()}
                  value={details.incidentDate}
                  onChange={(e) => setDetailField("incidentDate", e.target.value)}
                  className={`${inputClass} ${errors.incidentDate ? "border-critical" : ""}`}
                  aria-invalid={Boolean(errors.incidentDate)}
                  aria-describedby={errors.incidentDate ? "err-date" : undefined}
                />
                <FieldError id="err-date" message={errors.incidentDate} />
              </div>
              <div>
                <label htmlFor="c-time" className="mb-1.5 block text-[13.5px] font-semibold text-mirage">
                  Time of incident <span className="font-normal text-muted">(optional if unknown)</span>
                </label>
                <input
                  id="c-time"
                  type="time"
                  value={details.incidentTime}
                  onChange={(e) => setDetailField("incidentTime", e.target.value)}
                  className={inputClass}
                />
              </div>
            </div>
            <div className="rounded-xl bg-alt px-4 py-3 text-sm">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted">Filing date (system)</span>
              <p className="mt-0.5 font-semibold text-mirage">{todayString()}</p>
            </div>
            <div>
              <label htmlFor="c-remedy" className="mb-1.5 block text-[13.5px] font-semibold text-mirage">
                Desired remedy / requested assistance{" "}
                <span className="font-normal text-muted">(optional)</span>
              </label>
              <textarea
                id="c-remedy"
                rows={3}
                value={details.desiredRemedy}
                onChange={(e) => setDetailField("desiredRemedy", e.target.value)}
                className={`${inputClass} resize-y`}
              />
            </div>
            <p className="text-xs text-muted">
              Official category and urgency are set later during Case Categorization — not in this form.
            </p>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="r-name" className="mb-1.5 block text-[13.5px] font-semibold text-mirage">
                  Respondent full name <span className="font-normal text-muted">(if known)</span>
                </label>
                <input
                  id="r-name"
                  type="text"
                  value={respondent.name}
                  onChange={(e) => setRespField("name", e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="r-address" className="mb-1.5 block text-[13.5px] font-semibold text-mirage">
                  Respondent address <span className="font-normal text-muted">(if known)</span>
                </label>
                <input
                  id="r-address"
                  type="text"
                  value={respondent.address}
                  onChange={(e) => setRespField("address", e.target.value)}
                  className={inputClass}
                />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="r-contact" className="mb-1.5 block text-[13.5px] font-semibold text-mirage">
                  Respondent contact{" "}
                  <span className="font-normal text-muted">(optional, only if lawfully provided)</span>
                </label>
                <input
                  id="r-contact"
                  type="tel"
                  inputMode="tel"
                  value={respondent.contact}
                  onChange={(e) => setRespField("contact", e.target.value)}
                  className={inputClass}
                />
              </div>
            </div>
            <div>
              <label htmlFor="r-loc" className="mb-1.5 block text-[13.5px] font-semibold text-mirage">
                Incident location <span className="text-critical">*</span>
              </label>
              <input
                id="r-loc"
                type="text"
                placeholder="e.g. Purok 3 near the chapel, Abuno, Iligan City"
                value={respondent.location}
                onChange={(e) => setRespField("location", e.target.value)}
                className={`${inputClass} ${errors.location ? "border-critical" : ""}`}
                aria-invalid={Boolean(errors.location)}
                aria-describedby={errors.location ? "err-loc" : undefined}
              />
              <FieldError id="err-loc" message={errors.location} />
            </div>
            <div>
              <label htmlFor="r-purok" className="mb-1.5 block text-[13.5px] font-semibold text-mirage">
                Purok of incident <span className="font-normal text-muted">(optional)</span>
              </label>
              <input
                id="r-purok"
                type="text"
                value={respondent.purok}
                onChange={(e) => setRespField("purok", e.target.value)}
                className={inputClass}
              />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="r-wit" className="mb-1.5 block text-[13.5px] font-semibold text-mirage">
                  Witness names <span className="font-normal text-muted">(optional)</span>
                </label>
                <textarea
                  id="r-wit"
                  rows={3}
                  value={respondent.witnesses}
                  onChange={(e) => setRespField("witnesses", e.target.value)}
                  className={`${inputClass} resize-y`}
                />
              </div>
              <div>
                <label htmlFor="r-other" className="mb-1.5 block text-[13.5px] font-semibold text-mirage">
                  Other involved persons <span className="font-normal text-muted">(optional)</span>
                </label>
                <textarea
                  id="r-other"
                  rows={3}
                  value={respondent.otherInvolved}
                  onChange={(e) => setRespField("otherInvolved", e.target.value)}
                  className={`${inputClass} resize-y`}
                />
              </div>
            </div>
            <p className="text-xs text-muted">Filing is allowed even when respondent details are incomplete.</p>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-5">
            <div>
              <h3 className="text-sm font-bold text-mirage">Attach evidence</h3>
              <p className="mt-1 text-[13px] text-muted">
                Photos, PDFs, and audio supplied by the resident. JPG, PNG, WebP, PDF, audio — max 10 MB each.
                Files upload to the private evidence bucket.
              </p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".jpg,.jpeg,.png,.webp,.pdf,.mp3,.wav,.ogg,.m4a,audio/*"
              onChange={handleFilesChosen}
              className="hidden"
              aria-label="Choose evidence files"
            />
            <button type="button" onClick={() => fileInputRef.current?.click()} className={fileLabelClass}>
              <Upload className="h-4 w-4" aria-hidden="true" />
              Choose evidence files
            </button>

            {files.length > 0 && (
              <ul className="space-y-2" aria-label="Selected evidence files">
                {files.map((item) => (
                  <li key={item.id} className="flex items-center gap-3 rounded-xl border border-line bg-white px-3.5 py-2.5">
                    <FileText className="h-5 w-5 shrink-0 text-secondary" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12.5px] font-medium text-mirage">{item.fileName}</p>
                      <p className="text-[11px] text-muted">
                        {item.fileType || "unknown"} · {formatFileSize(item.fileSize)}
                      </p>
                    </div>
                    <span className="shrink-0 text-[11px] font-medium text-muted">Ready</span>
                    <button
                      type="button"
                      onClick={() => removeFile(item.id)}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted hover:bg-critical-soft hover:text-critical"
                      aria-label={`Remove ${item.fileName}`}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div>
              <label htmlFor="e-notes" className="mb-1.5 block text-[13.5px] font-semibold text-mirage">
                Short description <span className="font-normal text-muted">(optional)</span>
              </label>
              <textarea
                id="e-notes"
                rows={3}
                value={fileNotes}
                onChange={(e) => setFileNotes(e.target.value)}
                placeholder="Context about the attached files."
                className={`${inputClass} resize-y`}
              />
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-5">
            <div className="rounded-2xl border border-line bg-canvas p-4 sm:p-5">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-mirage">Review encoded complaint</h3>
                <button
                  type="button"
                  onClick={() => goToStep(0)}
                  className="inline-flex min-h-[40px] items-center gap-1.5 text-[12.5px] font-semibold text-secondary"
                >
                  <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                  Edit
                </button>
              </div>
              <div className="space-y-4">
                <SummaryRow
                  icon={<UserRound className="h-4 w-4" />}
                  label="Complainant"
                  value={
                    selectedResident
                      ? [selectedResident.first_name, selectedResident.last_name].filter(Boolean).join(" ") +
                        " (linked resident account)"
                      : [walkIn.firstName, walkIn.middleName, walkIn.lastName].filter(Boolean).join(" ") +
                        " (walk-in)"
                  }
                />
                <SummaryRow icon={<FileText className="h-4 w-4" />} label="Title" value={details.title} />
                <SummaryRow icon={<FileText className="h-4 w-4" />} label="Narrative" value={details.description} />
                <SummaryRow icon={<MapPin className="h-4 w-4" />} label="Incident location" value={respondent.location} />
                <SummaryRow icon={<Users className="h-4 w-4" />} label="Respondent" value={respondent.name || "Unknown"} />
                <SummaryRow
                  icon={<Clipboard className="h-4 w-4" />}
                  label="Incident date"
                  value={details.incidentDate + (details.incidentTime ? ` · ${details.incidentTime}` : "")}
                />
                <SummaryRow
                  icon={<Upload className="h-4 w-4" />}
                  label="Evidence"
                  value={files.length ? `${files.length} file(s)` : "None"}
                />
                <SummaryRow
                  icon={<Clipboard className="h-4 w-4" />}
                  label="Desired resolution"
                  value={details.desiredRemedy || "Not specified"}
                />
                <SummaryRow icon={<Building2 className="h-4 w-4" />} label="Filing channel" value={filingLabel} />
                <SummaryRow
                  icon={<Info className="h-4 w-4" />}
                  label="Encoder"
                  value={`${identity.displayName} · ${identity.roleLabel}`}
                />
              </div>
            </div>

            <div className="rounded-2xl border border-line bg-canvas p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-mirage">Reklamo Form preview</h3>
                <button
                  type="button"
                  onClick={() => setShowReklamoPreview((v) => !v)}
                  aria-expanded={showReklamoPreview}
                  className="inline-flex min-h-[40px] items-center gap-1.5 text-[12.5px] font-semibold text-secondary"
                >
                  {showReklamoPreview ? "Hide preview" : "Preview form"}
                </button>
              </div>
              <p className="mt-1 text-xs text-muted">
                This is the document the barangay will use once an official formally receives
                the complaint. Check the narrative and details before submitting.
              </p>
              {showReklamoPreview ? (
                <div className="mt-4">
                  <ReklamoFormPreview
                    model={buildReklamoFieldModel({
                      complaint: {
                        description: details.description,
                        incident_date: details.incidentDate,
                        incident_time: details.incidentTime,
                        incident_location: respondent.location,
                        persons_involved: respondent.otherInvolved,
                        witnesses: respondent.witnesses,
                        desired_relief: details.desiredRemedy,
                      },
                      complainant: {
                        name: selectedResident
                          ? [selectedResident.first_name, selectedResident.last_name].filter(Boolean).join(" ")
                          : [walkIn.firstName, walkIn.middleName, walkIn.lastName].filter(Boolean).join(" "),
                        contact: selectedResident?.mobile_number || walkIn.mobile || "",
                        address: [
                          walkIn.houseStreet,
                          walkIn.purok,
                          selectedResident?.barangay,
                          selectedResident?.city,
                        ]
                          .filter(Boolean)
                          .join(", "),
                      },
                      respondentLines: respondent.name
                        ? [respondent.name, respondent.address].filter(Boolean)
                        : [],
                      officialName: "",
                    })}
                  />
                </div>
              ) : null}
            </div>

            {duplicateChecked && duplicates.length > 0 && (
              <div className="rounded-2xl border border-warning/40 bg-warning-soft p-4" role="alert">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-mirage">Possible duplicate warning</p>
                    <p className="mt-1 text-xs text-muted">
                      Review matches below. A possible duplicate does not block submission — confirm after
                      review to continue.
                    </p>
                    <ul className="mt-2 space-y-1">
                      {duplicates.map((d) => (
                        <li key={d.id} className="truncate text-xs text-mirage">
                          <span className="font-semibold">{d.reference_number}</span> · {d.title} ·{" "}
                          {d.incident_date || "—"}
                        </li>
                      ))}
                    </ul>
                    <label className="mt-3 flex items-start gap-2 text-sm text-mirage">
                      <input
                        type="checkbox"
                        checked={duplicateAck}
                        onChange={(e) => setDuplicateAck(e.target.checked)}
                        className="mt-0.5 h-4 w-4 rounded border-line accent-secondary"
                        aria-invalid={Boolean(errors.duplicate)}
                      />
                      I reviewed the possible matches and this is a distinct complaint.
                    </label>
                    <FieldError id="err-dup" message={errors.duplicate} />
                  </div>
                </div>
              </div>
            )}

            <div className="rounded-2xl border border-line bg-white p-4">
              <h3 className="text-sm font-bold text-mirage">Confirmation before encoding</h3>
              <div className="mt-3 space-y-3">
                <label className="flex items-start gap-2.5 text-sm text-mirage">
                  <input
                    type="checkbox"
                    checked={confirmations.confirmedWithComplainant}
                    onChange={(e) => setConfirmations((p) => ({ ...p, confirmedWithComplainant: e.target.checked }))}
                    className="mt-0.5 h-4 w-4 rounded border-line accent-secondary"
                  />
                  <span>I confirmed the details with the complainant.</span>
                  {errors.c1 && <span className="text-critical"> {errors.c1}</span>}
                </label>
                <label className="flex items-start gap-2.5 text-sm text-mirage">
                  <input
                    type="checkbox"
                    checked={confirmations.complainantReviewed}
                    onChange={(e) => setConfirmations((p) => ({ ...p, complainantReviewed: e.target.checked }))}
                    className="mt-0.5 h-4 w-4 rounded border-line accent-secondary"
                  />
                  <span>The complainant reviewed and agreed with this encoding.</span>
                  {errors.c2 && <span className="text-critical"> {errors.c2}</span>}
                </label>
                <label className="flex items-start gap-2.5 text-sm text-mirage">
                  <input
                    type="checkbox"
                    checked={confirmations.informedNotEstablished}
                    onChange={(e) => setConfirmations((p) => ({ ...p, informedNotEstablished: e.target.checked }))}
                    className="mt-0.5 h-4 w-4 rounded border-line accent-secondary"
                  />
                  <span>I informed the complainant that filing does not establish fault or guilt.</span>
                  {errors.c3 && <span className="text-critical"> {errors.c3}</span>}
                </label>
              </div>
            </div>

            <div className="rounded-2xl border border-line bg-white p-4">
              <label htmlFor="assist-reason" className="mb-1.5 block text-[13.5px] font-semibold text-mirage">
                Reason for staff assistance <span className="text-critical">*</span>
              </label>
              <select
                id="assist-reason"
                value={assistedReason}
                onChange={(e) => setAssistedReason(e.target.value)}
                className={inputClass}
              >
                {ASSISTED_REASONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
              <label htmlFor="ack-note" className="mb-1.5 mt-4 block text-[13.5px] font-semibold text-mirage">
                Resident acknowledgment note <span className="font-normal text-muted">(optional)</span>
              </label>
              <textarea
                id="ack-note"
                rows={2}
                value={ackNote}
                onChange={(e) => setAckNote(e.target.value)}
                placeholder="Any note on how the resident confirmed the encoded details."
                className={`${inputClass} resize-y`}
              />
            </div>
          </div>
        )}

        {step === 5 && result && (
          <div className="py-6 text-center" aria-live="polite">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-success-soft">
              <CheckCircle2 className="h-7 w-7 text-success" aria-hidden="true" />
            </div>
            <h2 className="mt-4 font-heading text-xl font-bold text-navy">Complaint encoded successfully</h2>
            <p className="mt-2 text-sm text-muted">
              Encoded as a Barangay Hall assisted filing. The case has been added to the Complaints
              queue and is awaiting information check.
            </p>
            <dl className="mx-auto mt-5 max-w-md space-y-2 rounded-2xl border border-line bg-canvas p-4 text-left text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Reference</dt>
                <dd className="font-mono font-bold text-navy">{result.referenceNumber}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Complainant</dt>
                <dd className="font-semibold text-mirage">{result.complainantName}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Filed</dt>
                <dd className="font-semibold text-mirage">{result.filedAt}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Encoder</dt>
                <dd className="font-semibold text-mirage">{identity.displayName}</dd>
              </div>
            </dl>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
              <button
                type="button"
                onClick={() => router.push(`${routes.complaints}/${result.id}`)}
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full bg-navy px-6 text-sm font-semibold text-white hover:bg-navy/90"
              >
                View Complaint
              </button>
              <button
                type="button"
                onClick={() => {
                  setResult(null);
                  setStep(0);
                  setErrors({});
                  setDuplicates([]);
                  setDuplicateAck(false);
                  setDuplicateChecked(false);
                  setSelectedResident(null);
                  setSearchQuery("");
                  setSearchResults([]);
                  setResidentMode("search");
                  setWalkIn({
                    firstName: "",
                    middleName: "",
                    lastName: "",
                    suffix: "",
                    dateOfBirth: "",
                    sex: "",
                    mobile: "",
                    email: "",
                    houseStreet: "",
                    purok: "",
                  });
                  setDetails({ title: "", description: "", incidentDate: "", incidentTime: "", desiredRemedy: "" });
                  setRespondent({
                    name: "",
                    address: "",
                    contact: "",
                    location: "",
                    purok: "",
                    witnesses: "",
                    otherInvolved: "",
                  });
                  setFiles([]);
                  setFileNotes("");
                  setConfirmations({
                    confirmedWithComplainant: false,
                    complainantReviewed: false,
                    informedNotEstablished: false,
                  });
                  setAckNote("");
                }}
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full border border-line bg-white px-6 text-sm font-semibold text-mirage hover:bg-alt"
              >
                Encode Another
              </button>
              <button
                type="button"
                onClick={() => router.push(routes.complaints)}
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full border border-line bg-white px-6 text-sm font-semibold text-mirage hover:bg-alt"
              >
                Return to Complaints
              </button>
            </div>
          </div>
        )}

        {step < 5 && (
          <div className="mt-6 flex flex-col-reverse gap-3 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button"
              onClick={step === 0 ? () => router.push(routes.complaints) : handleBack}
              disabled={submitting}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full border border-line bg-white px-5 text-sm font-semibold text-mirage hover:bg-alt disabled:opacity-50"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              {step === 0 ? "Cancel" : "Back"}
            </button>
            <button
              type="button"
              onClick={step === 4 ? handleSubmit : handleNext}
              disabled={submitting || (step === 0 && !canContinueResident)}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full bg-navy px-6 text-sm font-semibold text-white hover:bg-navy/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? "Submitting…" : step === 4 ? "Submit Complaint" : "Continue"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
