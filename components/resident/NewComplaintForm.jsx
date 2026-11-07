"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clipboard,
  Clock,
  Download,
  FileText,
  FileWarning,
  ImageIcon,
  Info,
  Loader2,
  MapPin,
  Pencil,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
  Upload,
  Users,
  Zap,
} from "lucide-react";
import {
  createComplaint,
  uploadEvidence,
  getDocumentSignedUrl,
  getResidentComplaintDocuments,
} from "@/repositories/complaintRepository";
import { issueSubmissionReceipt, setComplaintDesiredRelief } from "@/lib/reklamo/issueSubmissionReceipt";
import { requestSubmittedReklamo } from "@/lib/reklamo/requestSubmittedReklamo";
import {
  DOCUMENT_STATUS,
  DOCUMENT_STATUS_LABELS,
  findReklamoBundle,
} from "@/lib/reklamo/reklamoDocument";
import { RESIDENT_ROUTES } from "@/lib/constants";
import { formatResidentDate, formatResidentTime } from "@/lib/residentDates";
import { useAuth } from "@/context/AuthContext";
import { getResidentProfile } from "@/repositories/profileRepository";
import { useDocumentViewer } from "@/components/shared/DocumentViewerProvider";

const PHOTO_TYPES = ["image/jpeg", "image/jpg", "image/png"];
const DOC_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const STEPS = ["Details", "Evidence", "Review", "Success"];

const inputClass =
  "w-full rounded-xl border border-line bg-white dark:bg-canvas px-3.5 py-2.5 text-sm text-mirage outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-muted/60 focus:border-secondary focus:ring-2 focus:ring-secondary/20";

function todayString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function Stepper({ currentStep, totalSteps }) {
  return (
    <nav aria-label="Complaint submission steps" className="mb-8">
      <ol className="flex items-center">
        {STEPS.slice(0, totalSteps).map((label, idx) => {
          const isCompleted = idx < currentStep;
          const isActive = idx === currentStep;
          return (
            <li key={label} className="flex items-center flex-1 last:flex-none">
              <div className="flex flex-col items-center">
                <span
                  className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold transition-colors ${
                    isCompleted
                      ? "bg-success text-white"
                      : isActive
                        ? "bg-secondary text-white ring-4 ring-secondary/20"
                        : "bg-line text-muted"
                  }`}
                  aria-current={isActive ? "step" : undefined}
                >
                  {isCompleted ? (
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    idx + 1
                  )}
                </span>
                <span
                  className={`mt-1.5 hidden text-[11px] font-medium sm:block ${
                    isActive ? "text-secondary" : isCompleted ? "text-success" : "text-muted"
                  }`}
                >
                  {label}
                </span>
              </div>
              {idx < totalSteps - 1 && (
                <div
                  className={`mx-2 h-0.5 flex-1 rounded-full transition-colors ${
                    idx < currentStep ? "bg-success" : "bg-line"
                  }`}
                  aria-hidden="true"
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
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

function Step1({ values, errors, setField, complainant }) {
  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-line bg-white dark:bg-alt p-5 shadow-feather sm:p-6">
        <h3 className="mb-4 text-sm font-bold text-mirage">Your Information</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <span className="text-[12px] font-medium text-muted">Name</span>
            <p className="mt-1 text-sm font-semibold text-mirage">{complainant.name}</p>
          </div>
          <div>
            <span className="text-[12px] font-medium text-muted">Contact</span>
            <p className="mt-1 text-sm font-semibold text-mirage">{complainant.contact}</p>
          </div>
          <div className="sm:col-span-2">
            <span className="text-[12px] font-medium text-muted">Address</span>
            <p className="mt-1 text-sm font-semibold text-mirage">{complainant.address}</p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-line bg-white dark:bg-alt p-5 shadow-feather sm:p-6">
        <h3 className="mb-4 text-sm font-bold text-mirage">Complaint Details</h3>
        <div className="space-y-5">
          <div>
            <label
              htmlFor="complaint-desc"
              className="mb-1.5 block text-[13.5px] font-semibold text-mirage"
            >
              What happened? <span className="text-critical">*</span>
            </label>
            <textarea
              id="complaint-desc"
              rows={5}
              value={values.description}
              onChange={(e) => setField("description", e.target.value)}
              aria-invalid={Boolean(errors.description)}
              aria-describedby={errors.description ? "err-desc" : undefined}
              placeholder="Describe what happened, when, and who was involved."
              className={`${inputClass} resize-y ${errors.description ? "border-critical" : ""}`}
            />
            <FieldError id="err-desc" message={errors.description} />
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div>
              <label
                htmlFor="complaint-date"
                className="mb-1.5 block text-[13.5px] font-semibold text-mirage"
              >
                Date <span className="text-critical">*</span>
              </label>
              <input
                id="complaint-date"
                type="date"
                max={todayString()}
                value={values.incidentDate}
                onChange={(e) => setField("incidentDate", e.target.value)}
                aria-invalid={Boolean(errors.incidentDate)}
                aria-describedby={errors.incidentDate ? "err-date" : undefined}
                className={`${inputClass} ${errors.incidentDate ? "border-critical" : ""}`}
              />
              <FieldError id="err-date" message={errors.incidentDate} />
            </div>
            <div>
              <label
                htmlFor="complaint-time"
                className="mb-1.5 block text-[13.5px] font-semibold text-mirage"
              >
                Time <span className="text-critical">*</span>
              </label>
              <input
                id="complaint-time"
                type="time"
                value={values.incidentTime}
                onChange={(e) => setField("incidentTime", e.target.value)}
                aria-invalid={Boolean(errors.incidentTime)}
                aria-describedby={errors.incidentTime ? "err-time" : undefined}
                className={`${inputClass} ${errors.incidentTime ? "border-critical" : ""}`}
              />
              <FieldError id="err-time" message={errors.incidentTime} />
            </div>
          </div>

          <div>
            <label
              htmlFor="complaint-location"
              className="mb-1.5 block text-[13.5px] font-semibold text-mirage"
            >
              Location <span className="text-critical">*</span>
            </label>
            <input
              id="complaint-location"
              type="text"
              value={values.location}
              onChange={(e) => setField("location", e.target.value)}
              aria-invalid={Boolean(errors.location)}
              aria-describedby={errors.location ? "err-location" : undefined}
              placeholder="e.g. Purok 13, Abuno, Iligan City"
              className={`${inputClass} ${errors.location ? "border-critical" : ""}`}
            />
            <FieldError id="err-location" message={errors.location} />
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div>
              <label
                htmlFor="complaint-persons"
                className="mb-1.5 block text-[13.5px] font-semibold text-mirage"
              >
                People Involved{" "}
                <span className="font-normal text-muted">(optional)</span>
              </label>
              <input
                id="complaint-persons"
                type="text"
                value={values.personsInvolved}
                onChange={(e) => setField("personsInvolved", e.target.value)}
                placeholder="Names or descriptions"
                className={inputClass}
              />
            </div>
            <div>
              <label
                htmlFor="complaint-witnesses"
                className="mb-1.5 block text-[13.5px] font-semibold text-mirage"
              >
                Witnesses{" "}
                <span className="font-normal text-muted">(optional)</span>
              </label>
              <input
                id="complaint-witnesses"
                type="text"
                value={values.witnesses}
                onChange={(e) => setField("witnesses", e.target.value)}
                placeholder="Names or descriptions"
                className={inputClass}
              />
            </div>
          </div>

          <div className="mt-5">
            <label
              htmlFor="complaint-desired-relief"
              className="mb-1.5 block text-[13.5px] font-semibold text-mirage"
            >
              What do you want to happen?{" "}
              <span className="font-normal text-muted">(optional, but it helps us act on this)</span>
            </label>
            <textarea
              id="complaint-desired-relief"
              rows={3}
              value={values.desiredRelief}
              onChange={(e) => setField("desiredRelief", e.target.value)}
              placeholder="e.g. Have the respondent formally apologize and repair the damaged fence."
              className={inputClass}
            />
            <p className="mt-1.5 text-[12px] text-muted">
              This is copied onto the official Reklamo Form as &ldquo;Nadawat / Gitipigan&rdquo;.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Step2({ values, errors, setField, setPhotos, setDocuments }) {
  const photoInputRef = useRef(null);
  const docInputRef = useRef(null);

  const handlePhotoUpload = useCallback(
    (e) => {
      const files = Array.from(e.target.files || []);
      const valid = [];
      for (const file of files) {
        if (!PHOTO_TYPES.includes(file.type)) {
          toast.error(`"${file.name}" is not a supported image type.`);
          continue;
        }
        if (file.size > MAX_FILE_SIZE) {
          toast.error(`"${file.name}" exceeds 10 MB limit.`);
          continue;
        }
        valid.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          fileName: file.name,
          fileType: file.type,
          fileSize: file.size,
          file,
          previewUrl: URL.createObjectURL(file),
        });
      }
      if (valid.length > 0) {
        setPhotos((prev) => [...prev, ...valid]);
      }
      e.target.value = "";
    },
    [setPhotos],
  );

  const handleDocUpload = useCallback(
    (e) => {
      const files = Array.from(e.target.files || []);
      const valid = [];
      for (const file of files) {
        if (!DOC_TYPES.includes(file.type)) {
          toast.error(`"${file.name}" is not a supported document type.`);
          continue;
        }
        if (file.size > MAX_FILE_SIZE) {
          toast.error(`"${file.name}" exceeds 10 MB limit.`);
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
      if (valid.length > 0) {
        setDocuments((prev) => [...prev, ...valid]);
      }
      e.target.value = "";
    },
    [setDocuments],
  );

  const removePhoto = useCallback(
    (id) => {
      setPhotos((prev) => {
        const target = prev.find((p) => p.id === id);
        if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
        return prev.filter((p) => p.id !== id);
      });
    },
    [setPhotos],
  );

  const removeDoc = useCallback(
    (id) => {
      setDocuments((prev) => prev.filter((d) => d.id !== id));
    },
    [setDocuments],
  );

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-line bg-white dark:bg-alt p-5 shadow-feather sm:p-6">
        <h3 className="mb-1 text-sm font-bold text-mirage">Add Evidence</h3>
        <p className="mb-5 text-[13px] text-muted">
          Photos and documents are optional.
        </p>

        <div className="space-y-5">
          <div>
            <span className="mb-2 block text-[13.5px] font-semibold text-mirage">
              Photos
            </span>
            <input
              ref={photoInputRef}
              type="file"
              accept=".jpg,.jpeg,.png"
              multiple
              onChange={handlePhotoUpload}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => photoInputRef.current?.click()}
              className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line bg-white dark:bg-alt px-4 text-sm font-medium text-muted transition-colors hover:border-secondary hover:text-secondary"
            >
              <Upload className="h-4 w-4" aria-hidden="true" />
              Choose Files (JPG, PNG — max 10 MB)
            </button>
          </div>

          {values.photos.length > 0 && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {values.photos.map((photo) => (
                <div
                  key={photo.id}
                  className="group relative overflow-hidden rounded-xl border border-line"
                >
                  {photo.previewUrl && (
                    <img
                      src={photo.previewUrl}
                      alt={photo.fileName}
                      className="h-28 w-full object-cover"
                    />
                  )}
                  <div className="px-2.5 py-2">
                    <p className="truncate text-[11px] font-medium text-mirage">
                      {photo.fileName}
                    </p>
                    <p className="text-[10px] text-muted">
                      {formatFileSize(photo.fileSize)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => removePhoto(photo.id)}
                    className="absolute top-1.5 right-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-white/90 dark:bg-alt/90 text-critical opacity-0 shadow-sm transition-opacity group-hover:opacity-100"
                    aria-label={`Remove ${photo.fileName}`}
                  >
                    <Trash2 className="h-3 w-3" aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div>
            <span className="mb-2 block text-[13.5px] font-semibold text-mirage">
              Documents
            </span>
            <input
              ref={docInputRef}
              type="file"
              accept=".pdf,.docx"
              multiple
              onChange={handleDocUpload}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => docInputRef.current?.click()}
              className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line bg-white dark:bg-alt px-4 text-sm font-medium text-muted transition-colors hover:border-secondary hover:text-secondary"
            >
              <Upload className="h-4 w-4" aria-hidden="true" />
              Choose Files (PDF, DOCX — max 10 MB)
            </button>
          </div>

          {values.documents.length > 0 && (
            <div className="space-y-2">
              {values.documents.map((doc) => (
                <div
                  key={doc.id}
                  className="group flex items-center gap-3 rounded-xl border border-line bg-white dark:bg-alt px-3.5 py-2.5"
                >
                  {doc.fileType === "application/pdf" ? (
                    <FileText className="h-5 w-5 shrink-0 text-critical" aria-hidden="true" />
                  ) : (
                    <FileWarning className="h-5 w-5 shrink-0 text-secondary" aria-hidden="true" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] font-medium text-mirage">
                      {doc.fileName}
                    </p>
                    <p className="text-[11px] text-muted">{formatFileSize(doc.fileSize)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeDoc(doc.id)}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-critical-soft hover:text-critical"
                    aria-label={`Remove ${doc.fileName}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div>
            <label
              htmlFor="evidence-desc"
              className="mb-1.5 block text-[13.5px] font-semibold text-mirage"
            >
              Notes{" "}
              <span className="font-normal text-muted">(optional)</span>
            </label>
            <textarea
              id="evidence-desc"
              rows={3}
              value={values.evidenceDescription}
              onChange={(e) => setField("evidenceDescription", e.target.value)}
              placeholder="Add context about the files."
              className={`${inputClass} resize-y`}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function Step3({ values, classification, classificationStatus, goToStep }) {
  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-line bg-white dark:bg-alt p-5 shadow-feather sm:p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-bold text-mirage">Review Complaint</h3>
          <button
            type="button"
            onClick={() => goToStep(0)}
            className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-secondary transition-colors hover:text-navy dark:text-secondary"
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            Edit
          </button>
        </div>

        <div className="space-y-4">
          <SummaryRow
            icon={<FileText className="h-4 w-4" />}
            label="Description"
            value={values.description}
          />
          <SummaryRow
            icon={<MapPin className="h-4 w-4" />}
            label="Location"
            value={values.location}
          />
          <div className="grid grid-cols-2 gap-4">
            <SummaryRow
              icon={<Clock className="h-4 w-4" />}
              label="Date"
              value={values.incidentDate}
            />
            <SummaryRow
              icon={<Clock className="h-4 w-4" />}
              label="Time"
              value={values.incidentTime}
            />
          </div>
          {values.personsInvolved && (
            <SummaryRow
              icon={<Users className="h-4 w-4" />}
              label="Person(s) Involved"
              value={values.personsInvolved}
            />
          )}
          {values.witnesses && (
            <SummaryRow
              icon={<Users className="h-4 w-4" />}
              label="Witness(es)"
              value={values.witnesses}
            />
          )}
          {values.desiredRelief && (
            <SummaryRow
              icon={<FileText className="h-4 w-4" />}
              label="What you want to happen"
              value={values.desiredRelief}
            />
          )}
        </div>
      </div>

      {values.photos.length > 0 || values.documents.length > 0 ? (
        <div className="rounded-2xl border border-line bg-white dark:bg-alt p-5 shadow-feather sm:p-6">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-bold text-mirage">Attached Evidence</h3>
            <button
              type="button"
              onClick={() => goToStep(1)}
              className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-secondary transition-colors hover:text-navy dark:text-secondary"
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              Edit
            </button>
          </div>
          <div className="space-y-2">
            {values.photos.map((p) => (
              <div key={p.id} className="flex items-center gap-2 text-[12.5px] text-mirage">
                <ImageIcon className="h-3.5 w-3.5 shrink-0 text-success" aria-hidden="true" />
                <span className="truncate">{p.fileName}</span>
                <span className="text-muted">({formatFileSize(p.fileSize)})</span>
              </div>
            ))}
            {values.documents.map((d) => (
              <div key={d.id} className="flex items-center gap-2 text-[12.5px] text-mirage">
                <FileText className="h-3.5 w-3.5 shrink-0 text-secondary" aria-hidden="true" />
                <span className="truncate">{d.fileName}</span>
                <span className="text-muted">({formatFileSize(d.fileSize)})</span>
              </div>
            ))}
          </div>
          {values.evidenceDescription && (
            <p className="mt-3 border-t border-line pt-3 text-[12.5px] text-muted">
              {values.evidenceDescription}
            </p>
          )}
        </div>
      ) : null}

      <div className="rounded-2xl border border-navy/20 bg-navy p-5 shadow-feather sm:p-6">
        <div className="mb-4 flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-gold" aria-hidden="true" />
          <h3 className="text-sm font-bold text-white">Suggested Classification</h3>
        </div>
        {classificationStatus === "loading" ? (
          <p className="text-[13px] text-alt/70">Analyzing complaint…</p>
        ) : classificationStatus === "error" ? (
          <p className="text-[13px] text-critical">
            Unable to generate classification. Please try again.
          </p>
        ) : classification ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <ClassificationCard
              label="Detected Category"
              value={classification.category}
              accent="text-gold"
               detail="Requires official review"
            />
            <ClassificationCard
              label="Case Type"
              value={classification.caseType}
              accent="text-jordy"
               detail="Requires official review"
            />
            {classification.urgencyLevel && <ClassificationCard
              label="Urgency Level"
              value={classification.urgencyLevel}
              accent={
                classification.urgencyLevel === "Critical"
                  ? "text-critical"
                  : classification.urgencyLevel === "High"
                    ? "text-gold"
                    : "text-success-soft"
              }
              detail={`${confidencePercent(classification.urgencyConfidence)} confidence`}
            />}
            {classification.recommendedAction && <ClassificationCard
              label="Recommended Action"
              value={classification.recommendedAction}
              accent="text-alt"
              detail={`${confidencePercent(classification.recommendationConfidence)} confidence`}
            />}
          </div>
        ) : (
          <p className="text-[13px] text-alt/70">
            Enter a description to generate a classification.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * `formatResidentDate` + `formatResidentTime`, joined the way every
 * other resident date+time is rendered ("October 12, 2026 • 7:00 PM").
 *
 * The whole point is the explicit Manila zone. Left to
 * `toLocale*String`, this receipt would print the reviewer's own
 * timezone, so the same submission reads one day in Manila and the
 * day before it on a build machine — the same class of bug the
 * 2001-10-10 hearing date turned out to be.
 */
function formatSubmittedAt(value = new Date()) {
  const day = formatResidentDate(value);
  const clock = formatResidentTime(value);
  if (day && clock) return `${day} • ${clock}`;
  return day || clock || "";
}

function formatPreparedDate(value) {
  // The Reklamo form is dated in the barangay's own timezone. Formatting
  // this with `toLocaleDateString` prints the *reviewer's* day, so a
  // document prepared at 11 PM Manila reads as the next day for anyone
  // reading in UTC — the same class of bug as the 2001-10-10 hearing
  // date. `formatResidentDate` pins it to Asia/Manila.
  return formatResidentDate(value) || null;
}

function ReklamoSuccessCard({ reklamoStatus, doc, onRetry }) {
  const [busy, setBusy] = useState(false);
  const { viewDocument } = useDocumentViewer();

  // Shows the form on screen in the in-app viewer. The Download button next
  // to it is what saves a copy to the device.
  const handleOpen = useCallback(async () => {
    if (!doc) return;
    setBusy(true);
    const { url, error } = await getDocumentSignedUrl(doc.storage_path);
    setBusy(false);
    if (error || !url) {
      toast.error(error || "Could not open the Reklamo Form.");
      return;
    }
    viewDocument({
      url,
      title: "Reklamo Form",
      subtitle: doc.filename || null,
      filename: doc.filename || "reklamo-form.docx",
      mime: doc.mime_type || null,
    });
  }, [doc, viewDocument]);

  const handleDownload = useCallback(async () => {
    if (!doc) return;
    setBusy(true);
    const { url, error } = await getDocumentSignedUrl(doc.storage_path);
    if (error || !url) {
      setBusy(false);
      toast.error(error || "Could not download the Reklamo Form.");
      return;
    }
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error("Download failed.");
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = doc.filename || "reklamo-form.docx";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
      setBusy(false);
    } catch {
      setBusy(false);
      toast.error("Could not download the Reklamo Form.");
    }
  }, [doc]);

  const isPending = doc?.document_status === DOCUMENT_STATUS.PENDING_REVIEW;
  const prepared = formatPreparedDate(doc?.generated_at);

  return (
    <div className="rounded-2xl border border-line bg-white dark:bg-alt p-5 shadow-feather sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          {reklamoStatus === "generating" ? (
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-info-soft">
              <Loader2 className="h-5 w-5 animate-spin text-secondary" aria-hidden="true" />
            </span>
          ) : (
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-info-soft">
              <FileText className="h-5 w-5 text-secondary" aria-hidden="true" />
            </span>
          )}
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-mirage">Reklamo Form</h3>
            {reklamoStatus === "generating" ? (
              <p className="mt-0.5 text-[13px] text-muted">
                Preparing your Reklamo Form...
              </p>
            ) : reklamoStatus === "failed" ? (
              <div className="mt-1.5 space-y-2">
                <p className="text-[13px] leading-relaxed text-muted">
                  Your complaint was submitted successfully, but the Reklamo Form
                  could not be prepared.
                </p>
                <button
                  type="button"
                  onClick={onRetry}
                  className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full border border-line bg-white dark:bg-alt px-4 py-2 text-sm font-semibold text-mirage transition-colors hover:bg-alt"
                >
                  <RefreshCw className="h-4 w-4 text-secondary" aria-hidden="true" />
                  Try Again
                </button>
              </div>
            ) : (
              <>
                <p className="mt-0.5 text-[13px] font-semibold text-mirage">
                  Submitted Copy
                </p>
                <p className="mt-1 text-[12px] text-muted">
                  {prepared ? `Prepared ${prepared}` : "Prepared just now"}
                  <span className="mx-1.5">·</span>
                  <span className="inline-flex items-center rounded-full bg-canvas px-2 py-0.5 text-[11px] font-semibold text-muted">
                    {isPending
                      ? "Pending Barangay Review"
                      : DOCUMENT_STATUS_LABELS[doc?.document_status]?.toUpperCase() || "ON FILE"}
                  </span>
                </p>
              </>
            )}
          </div>
        </div>

        {reklamoStatus === "ready" && doc ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleOpen}
              disabled={busy}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full border border-line bg-white dark:bg-alt px-4 py-2 text-sm font-semibold text-mirage transition-colors hover:bg-alt disabled:cursor-not-allowed disabled:opacity-60"
            >
              <FileText className="h-4 w-4 text-secondary" aria-hidden="true" />
              View Reklamo
            </button>
            <button
              type="button"
              onClick={handleDownload}
              disabled={busy}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full bg-navy px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              Download
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Step4({ referenceNumber, classification, submittedAt, reklamoStatus, reklamoDoc, onRetryReklamo, evidenceOutcome }) {
  const router = useRouter();
  const handleCopy = useCallback(() => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(referenceNumber);
      toast.success("Reference number copied!");
    } else {
      toast.error("Clipboard not supported.");
    }
  }, [referenceNumber]);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-line bg-white dark:bg-alt p-6 text-center shadow-feather sm:p-8">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-success-soft">
          <CheckCircle2 className="h-8 w-8 text-success" aria-hidden="true" />
        </div>
        <h2 className="mt-4 text-lg font-bold text-mirage">
          Complaint Submitted
        </h2>
        <p className="mt-1.5 text-[13px] text-muted">
          Your complaint is ready for barangay review.
        </p>

        <div className="mx-auto mt-6 max-w-sm rounded-xl border border-line bg-canvas p-4">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
            Reference Number
          </span>
          <div className="mt-1.5 flex items-center justify-center gap-2">
            <span className="text-lg font-bold text-secondary">{referenceNumber}</span>
            <button
              type="button"
              onClick={handleCopy}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-secondary transition-colors hover:bg-info-soft"
              aria-label="Copy reference number"
            >
              <Clipboard className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="mx-auto mt-6 grid max-w-sm grid-cols-2 gap-3 text-left">
          <div>
            <span className="text-[11px] font-medium text-muted">Category</span>
            <p className="mt-0.5 text-sm font-semibold text-mirage">
              {classification?.category || "—"}
            </p>
          </div>
          <div>
            <span className="text-[11px] font-medium text-muted">Priority Level</span>
            <p className="mt-0.5 text-sm font-semibold text-mirage">
              {classification?.urgencyLevel || "—"}
            </p>
          </div>
          <div>
            <span className="text-[11px] font-medium text-muted">Current Status</span>
            <p className="mt-0.5 text-sm font-semibold text-mirage">Pending Review</p>
          </div>
          <div>
            <span className="text-[11px] font-medium text-muted">Submitted</span>
            <p className="mt-0.5 text-sm font-semibold text-mirage">{submittedAt}</p>
          </div>
        </div>
      </div>

      {evidenceOutcome.failed.length > 0 && (
        <p role="alert" className="rounded-xl border border-warning/35 bg-warning-soft p-4 text-sm text-warning">
          Your complaint was filed, but {evidenceOutcome.failed.length} evidence file(s) could not be saved
          ({evidenceOutcome.failed.join(", ")}). {evidenceOutcome.attached} file(s) were attached.
          Please contact barangay staff and provide the missing evidence.
        </p>
      )}

      <ReklamoSuccessCard
        reklamoStatus={reklamoStatus}
        doc={reklamoDoc}
        onRetry={onRetryReklamo}
      />

      <div className="rounded-2xl border border-line bg-white dark:bg-alt p-5 shadow-feather sm:p-6">
          <div className="mb-3 flex items-center gap-2">
          <Info className="h-4 w-4 text-secondary" aria-hidden="true" />
          <h3 className="text-sm font-bold text-mirage">Next</h3>
        </div>
        <p className="text-[13px] text-muted">
          We&apos;ll notify you when the status changes.
        </p>
        <p className="mt-3 text-[13px] text-muted">
          Your <strong>Barangay Case Number</strong> will be assigned after the
          barangay officially receives your complaint.
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
        <button
          type="button"
          onClick={() => router.push(RESIDENT_ROUTES.newComplaint)}
          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full border border-line bg-white dark:bg-alt px-6 py-3 text-sm font-semibold text-mirage transition-colors hover:bg-alt"
        >
          New Complaint
        </button>
        <button
          type="button"
          onClick={() => router.push(RESIDENT_ROUTES.complaints)}
          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full bg-navy px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-secondary"
        >
          My Complaints
        </button>
      </div>
    </div>
  );
}

function SummaryRow({ icon, label, value }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 text-muted" aria-hidden="true">
        {icon}
      </span>
      <div className="min-w-0">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted">
          {label}
        </span>
        <p className="mt-0.5 text-[13px] leading-relaxed text-mirage">{value}</p>
      </div>
    </div>
  );
}

function confidencePercent(value) {
  return `${Math.round((Number(value) || 0) * 100)}%`;
}

function ClassificationCard({ label, value, accent, detail }) {
  return (
    <div className="rounded-xl bg-white dark:bg-alt/10 px-4 py-3">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-alt/60">
        {label}
      </span>
      <p className={`mt-1 text-sm font-bold ${accent}`}>{value}</p>
      {detail ? (
        <p className="mt-0.5 text-[11px] text-alt/60">{detail}</p>
      ) : null}
    </div>
  );
}

export default function NewComplaintForm() {
  const router = useRouter();
  const { user } = useAuth();
  const [complainant, setComplainant] = useState({ name: "", contact: "", address: "" });
  const [step, setStep] = useState(0);
  const [values, setValues] = useState({
    description: "",
    incidentDate: "",
    incidentTime: "",
    location: "",
    personsInvolved: "",
      witnesses: "",
      desiredRelief: "",
      photos: [],
    documents: [],
    evidenceDescription: "",
    confirmed: false,
  });
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [serverRefNumber, setServerRefNumber] = useState(null);
  const [evidenceOutcome, setEvidenceOutcome] = useState({ attached: 0, failed: [] });

  const [submittedComplaintId, setSubmittedComplaintId] = useState(null);
  const [reklamoState, setReklamoState] = useState({
    status: "idle",
    doc: null,
    error: "",
  });

  const runReklamo = useCallback(async (complaintId) => {
    if (!complaintId) return;
    setReklamoState({ status: "generating", doc: null, error: "" });
    try {
      // The master template, the rendering and the storage all live on the
      // server now: the resident browser asks the trusted route to prepare
      // the form (POST /api/reklamo/generate) instead of downloading the
      // private master itself. Idempotent — a rerun cannot stack a second v1.
      const result = await requestSubmittedReklamo({ complaintId });
      if (!result.success) {
        console.warn("Reklamo preparation failed (safe to retry)", result.code, result.error);
        setReklamoState({ status: "failed", doc: null, error: result.error });
        return;
      }

      const rows = await getResidentComplaintDocuments(complaintId);
      const bundle = findReklamoBundle(rows);
      if (!bundle?.form) {
        console.warn("Reklamo form could not be read back", complaintId);
        setReklamoState({
          status: "failed",
          doc: null,
          error: "The Reklamo Form could not be read.",
        });
        return;
      }
      setReklamoState({ status: "ready", doc: bundle.form, error: "" });
    } catch (error) {
      console.warn("Reklamo preparation failed:", error?.message);
      setReklamoState({
        status: "failed",
        doc: null,
        error: error?.message || "Unexpected error while preparing the Reklamo Form.",
      });
    }
  }, []);

  const retryReklamo = useCallback(() => {
    if (submittedComplaintId) runReklamo(submittedComplaintId);
  }, [submittedComplaintId, runReklamo]);

  const [classification, setClassification] = useState(null);
  const [classificationStatus, setClassificationStatus] = useState("idle");
  const classifySeqRef = useRef(0);

  useEffect(() => {
    const description = values.description.trim();
    const seq = ++classifySeqRef.current;
    const timer = setTimeout(async () => {
      if (classifySeqRef.current !== seq) return;
      if (description.length < 10) {
        setClassification(null);
        setClassificationStatus("idle");
        return;
      }
      setClassificationStatus("loading");
      try {
        const res = await fetch("/api/classify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ description }),
        });
        const data = await res.json().catch(() => null);
        if (classifySeqRef.current !== seq) return;
        if (!res.ok || !data?.classification) {
          setClassificationStatus("error");
          return;
        }
        setClassification(data.classification);
        setClassificationStatus("ready");
      } catch {
        if (classifySeqRef.current !== seq) return;
        setClassificationStatus("error");
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [values.description]);

  const referenceNumber = serverRefNumber || "Generating...";

  const hasEvidence = values.photos.length > 0 || values.documents.length > 0;

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    getResidentProfile(user.id).then((profile) => {
      if (cancelled || !profile) return;
      setComplainant({
        name: [profile.first_name, profile.middle_name, profile.last_name].filter(Boolean).join(" "),
        contact: profile.mobile_number || user.email,
        address: [profile.house_street, profile.purok, profile.barangay, profile.city].filter(Boolean).join(", "),
      });
    });
    return () => { cancelled = true; };
  }, [user?.id]);

  const setField = useCallback((field, value) => {
    setValues((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => {
      if (prev[field]) {
        const next = { ...prev };
        delete next[field];
        return next;
      }
      return prev;
    });
  }, []);

  const setPhotos = useCallback((updater) => {
    setValues((prev) => ({
      ...prev,
      photos: typeof updater === "function" ? updater(prev.photos) : updater,
    }));
  }, []);

  const setDocuments = useCallback((updater) => {
    setValues((prev) => ({
      ...prev,
      documents: typeof updater === "function" ? updater(prev.documents) : updater,
    }));
  }, []);

  const validateStep = useCallback(() => {
    const nextErrors = {};

    if (step === 0) {
      if (!values.description.trim()) {
        nextErrors.description = "Please describe your complaint.";
      } else if (values.description.trim().length < 20) {
        nextErrors.description = "Description must be at least 20 characters.";
      }
      if (!values.incidentDate) {
        nextErrors.incidentDate = "Please select the date of the incident.";
      } else {
        const selected = new Date(values.incidentDate);
        const today = new Date();
        today.setHours(23, 59, 59, 999);
        if (selected > today) {
          nextErrors.incidentDate = "Date cannot be in the future.";
        }
      }
      if (!values.incidentTime) {
        nextErrors.incidentTime = "Please select the time of the incident.";
      }
      if (!values.location.trim()) {
        nextErrors.location = "Please enter the location of the incident.";
      }
    }

    if (step === 2) {
      if (!values.confirmed) {
        nextErrors.confirmed = "You must confirm the information is accurate.";
      }
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }, [step, values]);

  const goToStep = useCallback(
    (target) => {
      setStep(target);
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [],
  );

  const handleNext = useCallback(() => {
    if (!validateStep()) return;
    goToStep(step + 1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [validateStep, step, goToStep]);

  const handleBack = useCallback(() => {
    goToStep(step - 1);
  }, [step, goToStep]);

  const handleSubmit = useCallback(async () => {
    if (!validateStep() || submitting) return;
    setSubmitting(true);
    const toastId = toast.loading("Submitting your complaint…");

    try {
      // Final authoritative classification for the exact text being
      // submitted (the debounced one may still be in flight or stale).
      let finalClassification = null;
      const description = values.description.trim();
      if (description.length >= 10) {
        try {
          const res = await fetch("/api/classify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ description }),
          });
          const data = await res.json().catch(() => null);
          if (res.ok && data?.classification) {
            finalClassification = data.classification;
            setClassification(data.classification);
            setClassificationStatus("ready");
          }
        } catch {
          // Filing must not depend on the ML service.
        }
      }

      const result = await createComplaint({
        title: finalClassification?.category || "Complaint",
        description: values.description,
        incident_date: values.incidentDate,
        incident_time: values.incidentTime,
        incident_location: values.location,
        persons_involved: values.personsInvolved || undefined,
        witnesses: values.witnesses || undefined,
        predicted_category: null,
        predicted_case_type: null,
        predicted_urgency: null,
        prediction_confidence: null,
      });

      if (!result.success) {
        toast.dismiss(toastId);
        toast.error(result.error || "Failed to submit complaint. Please try again.");
        setSubmitting(false);
        return;
      }

      const complaintId = result.id;
      setServerRefNumber(result.reference_number);
      // Re-infer from the saved narrative server-side; never trust a preview.
      // A failure leaves the filing intact and can be retried with the same ID.
      if (complaintId) {
        await fetch("/api/classify/attach", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: complaintId }),
        }).catch(() => null);
      }

      // Upload evidence files if any
      const allFiles = [
        ...values.photos.map((p) => ({ file: p.file, type: "photo" })),
        ...values.documents.map((d) => ({ file: d.file, type: "document" })),
      ];

      let attachedCount = 0;
      const failedEvidence = [];
      if (allFiles.length > 0 && complaintId) {
        for (const { file, type } of allFiles) {
          if (file) {
            try {
              const uploaded = await uploadEvidence(complaintId, file, type, values.evidenceDescription);
              if (uploaded.success) attachedCount += 1;
              else failedEvidence.push(file.name);
            } catch {
              failedEvidence.push(file.name);
            }
          }
        }
      }
      setEvidenceOutcome({ attached: attachedCount, failed: failedEvidence });

      // "Nadawat / Gitipigan" on the official Reklamo Form. Sent after the
      // complaint exists because it is a separate RPC, not a create_complaint
      // parameter. Never allowed to fail the submission.
      if (complaintId && values.desiredRelief.trim()) {
        await setComplaintDesiredRelief(complaintId, values.desiredRelief.trim());
      }

      // Issue the submission copy. Never allowed to fail the submission: the
      // resident can always regenerate it later from the complaint page.
      if (complaintId) {
        await issueSubmissionReceipt({
          complaint: {
            id: complaintId,
            reference_number: result.reference_number,
            description: values.description,
            incident_date: values.incidentDate,
            incident_time: values.incidentTime,
            incident_location: values.location,
            persons_involved: values.personsInvolved,
            witnesses: values.witnesses,
            desired_relief: values.desiredRelief,
            predicted_category: finalClassification?.category,
            predicted_urgency: finalClassification?.urgencyLevel,
          },
          complainant,
          evidenceCount: attachedCount,
        });
      }

      toast.dismiss(toastId);
      toast.success(failedEvidence.length
        ? "Complaint submitted. Some evidence needs attention."
        : "Complaint submitted successfully!");
      setSubmitting(false);
      goToStep(3);
      window.scrollTo({ top: 0, behavior: "smooth" });

      // Generate the resident's own submitted Reklamo Form (DOCX) from the
      // official master in the background. The success page mounts instantly
      // and shows "Preparing your Reklamo Form..." while the DOCX is rendered,
      // then swaps to the View/Download card without a refresh. runReklamo
      // rescues an existing record first, so a retry never stacks a duplicate
      // version, and it never fails the submission.
      setSubmittedComplaintId(complaintId);
      runReklamo(complaintId);
    } catch {
      toast.dismiss(toastId);
      toast.error("An unexpected error occurred. Please try again.");
      setSubmitting(false);
    }
  }, [
    validateStep,
    submitting,
    classification,
    values,
    goToStep,
    runReklamo,
  ]);

  return (
    <div className="min-h-screen bg-canvas">
      <div className="container-scbms py-6 sm:py-10">
        {step < 3 && (
          <div className="mx-auto max-w-2xl">
            <h1 className="mb-2 text-xl font-bold text-mirage">New Complaint</h1>
            <p className="mb-6 text-[13px] text-muted">
              Tell us what happened.
            </p>
            <Stepper currentStep={step} totalSteps={4} />
          </div>
        )}

        <div className="mx-auto max-w-2xl">
          {step === 0 && (
            <Step1
              values={values}
              errors={errors}
              setField={setField}
              complainant={complainant}
            />
          )}
          {step === 1 && (
            <Step2
              values={values}
              errors={errors}
              setField={setField}
              setPhotos={setPhotos}
              setDocuments={setDocuments}
            />
          )}
          {step === 2 && (
            <Step3
              values={values}
              classification={classification}
              classificationStatus={classificationStatus}
              goToStep={goToStep}
            />
          )}
          {step === 3 && (
            <Step4
              referenceNumber={referenceNumber}
              classification={classification}
              submittedAt={formatSubmittedAt()}
              reklamoStatus={reklamoState.status}
              reklamoDoc={reklamoState.doc}
              onRetryReklamo={retryReklamo}
              evidenceOutcome={evidenceOutcome}
            />
          )}

          {step < 3 && (
            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-between">
              {step > 0 ? (
                <button
                  type="button"
                  onClick={handleBack}
                  className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full border border-line bg-white dark:bg-alt px-6 py-3 text-sm font-semibold text-mirage transition-colors hover:bg-alt"
                >
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                  Back
                </button>
              ) : (
                <div />
              )}

              <div className="flex gap-3">
                {step === 1 && (
                  <button
                    type="button"
                    onClick={handleNext}
                    disabled={hasEvidence}
                    className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full border border-line bg-white dark:bg-alt px-6 py-3 text-sm font-semibold text-mirage transition-colors hover:bg-alt disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Skip
                  </button>
                )}

                {step === 2 ? (
                  <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={submitting || !values.confirmed}
                    className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full bg-navy px-7 py-3 text-sm font-semibold text-white transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    <Send className="h-4 w-4" aria-hidden="true" />
                    {submitting ? "Submitting…" : "Submit Complaint"}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleNext}
                    disabled={step === 1 && !hasEvidence}
                    className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full bg-navy px-7 py-3 text-sm font-semibold text-white transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {step === 0 ? "Next: Evidence" : "Next: Review"}
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>
          )}

          {step === 2 && errors.confirmed && (
            <p className="mt-3 flex items-center justify-center gap-1.5 text-[12.5px] font-medium text-critical">
              <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
              {errors.confirmed}
            </p>
          )}

          {step === 2 && (
            <div className="mt-6 rounded-2xl border border-line bg-white dark:bg-alt p-5 shadow-feather sm:p-6">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={values.confirmed}
                  onChange={(e) => setField("confirmed", e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-line text-secondary accent-secondary focus:ring-secondary/20"
                />
                <span className="text-[13px] leading-relaxed text-mirage">
                  I confirm these details are accurate.
                </span>
              </label>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
