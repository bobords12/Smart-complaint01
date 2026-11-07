/**
 * "Needs Information" — the resident's half of the information request.
 *
 * An official can record that a complaint is missing something, but on
 * its own that is a one-way door: the resident was told to supply
 * information and had no way to supply it. This panel is that way back.
 *
 * Design rules this follows:
 *   * The resident is never told WHY the barangay wants something, only
 *     what is missing. The official's reason for the request is internal
 *     (routing_reason, kp_applicability_reason) and is not sent to the
 *     client at all.
 *   * Nothing is claimed that did not happen. "Sent on <date>" comes from
 *     the server's created_at, and the panel disappears once the official
 *     re-reviews, rather than showing a stale request.
 *   * An answer is text and/or attachments. A text-only answer is valid;
 *     so is a photo-only answer, because "send us a picture of the
 *     damaged wall" should not require typing a paragraph.
 *   * Every failure is reported in the resident's own terms. The RPC
 *     refuses politely when the case is no longer waiting, which happens
 *     legitimately if an official closes the request first.
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, FileText, Paperclip, Send, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  fetchInformationResponses,
  informationRequestState,
  provideRequestedInformation,
} from "@/lib/captainComplaintRouting";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
];

function formatDateTime(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-PH", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatBytes(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function InformationRequestPanel({ complaint, onSent }) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [history, setHistory] = useState(null);
  const fileInputRef = useRef(null);

  const state = informationRequestState(complaint);
  const awaiting = state === "unanswered";
  const answered = state === "answered";

  async function addFiles(event) {
    const picked = Array.from(event.target.files || []);
    event.target.value = "";

    const rejected = [];
    const accepted = [];
    for (const file of picked) {
      if (!ALLOWED.includes(file.type)) {
        rejected.push(`${file.name} is not a JPG, PNG, WEBP or PDF.`);
      } else if (file.size > MAX_FILE_BYTES) {
        rejected.push(`${file.name} is larger than 10 MB.`);
      } else {
        accepted.push(file);
      }
    }

    setError(rejected.join(" "));
    setFiles((prev) => [...prev, ...accepted].slice(0, 5));
  }

  async function handleSend() {
    if (sending) return;
    setSending(true);
    setError("");

    const supabase = createClient();
    const evidenceIds = [];

    try {
      // Uploads happen first and are committed to `evidence` by the
      // resident's own RLS policy. If the answer call then fails, the
      // files are still on the complaint as ordinary evidence and the
      // resident can reference them next time — nothing is lost.
      for (const file of files) {
        const { data: userData } = await supabase.auth.getUser();
        if (!userData?.user) throw new Error("Please sign in again before sending.");

        const ext = (file.name.split(".").pop() || "bin").toLowerCase();
        const path = `${userData.user.id}/${complaint.id}/info-${crypto.randomUUID()}.${ext}`;

        const { error: uploadError } = await supabase.storage
          .from("evidence")
          .upload(path, file);
        if (uploadError) throw new Error(uploadError.message);

        const { data: inserted, error: insertError } = await supabase
          .from("evidence")
          .insert({
            complaint_id: complaint.id,
            uploaded_by: userData.user.id,
            storage_path: path,
            original_filename: file.name,
            mime_type: file.type,
            file_size: file.size,
            evidence_type: "document",
            description: "Answer to the barangay's information request",
          })
          .select("id")
          .single();
        if (insertError) throw new Error(insertError.message);

        evidenceIds.push(inserted.id);
      }

      const result = await provideRequestedInformation(supabase, {
        complaintId: complaint.id,
        text,
        evidenceIds,
      });

      if (!result.success) {
        setError(result.error || "Your answer could not be sent.");
        return;
      }

      setText("");
      setFiles([]);
      setSent(true);
      setHistory(null);
      if (onSent) onSent();
    } catch (err) {
      setError(err.message || "Your answer could not be sent.");
    } finally {
      setSending(false);
    }
  }

  // The answers already on file. Fetched only once a request has been
  // answered and the panel is showing, and treated as optional: if the
  // migration has not been applied the panel still works and simply
  // shows no earlier answers.
  useEffect(() => {
    if (history !== null) return;
    if (informationRequestState(complaint) !== "answered") return;

    let cancelled = false;
    const supabase = createClient();
    fetchInformationResponses(supabase, complaint.id).then((rows) => {
      if (!cancelled) setHistory(rows);
    });

    return () => {
      cancelled = true;
    };
  }, [complaint, history]);

  return (
    <section
      aria-labelledby="information-request-title"
      className="mt-6 rounded-2xl border border-line bg-white p-5 shadow-soft no-print"
    >
      <header className="flex items-start gap-3">
        <span
          className={`mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
            awaiting ? "bg-warning-soft text-warning" : "bg-success-soft text-success"
          }`}
          aria-hidden="true"
        >
          {awaiting ? <AlertCircle className="h-4.5 w-4.5" /> : <CheckCircle2 className="h-4.5 w-4.5" />}
        </span>
        <div className="min-w-0">
          <h2
            id="information-request-title"
            className="font-heading text-sm font-semibold text-navy dark:text-secondary"
          >
            {awaiting ? "The barangay needs more information" : "Information received"}
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            {awaiting
              ? "Your complaint is on hold until the information below is supplied."
              : "You supplied the requested information. An official will review it and update your complaint."}
          </p>
        </div>
      </header>

      {complaint.requested_information ? (
        <div className="mt-4 rounded-xl border border-line bg-alt px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
            What was asked for
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-mirage">
            {complaint.requested_information}
          </p>
          {complaint.requested_information_at ? (
            <p className="mt-2 text-[11px] text-muted">
              Asked on {formatDateTime(complaint.requested_information_at)}
            </p>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="mt-4 rounded-xl border border-critical/25 bg-critical-soft px-4 py-3 text-xs font-semibold leading-relaxed text-critical"
        >
          {error}
        </p>
      ) : null}

      {sent ? (
        <p
          role="status"
          className="mt-4 rounded-xl border border-[#17774e]/25 bg-success-soft px-4 py-3 text-xs font-semibold leading-relaxed text-success"
        >
          Your answer was sent. You do not need to do anything else right now.
        </p>
      ) : null}

      {awaiting ? (
        <div className="mt-4 space-y-3">
          <div>
            <label
              htmlFor="information-response"
              className="mb-1 block text-[12px] font-semibold text-navy dark:text-secondary"
            >
              Your answer
            </label>
            <textarea
              id="information-response"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={5}
              placeholder="Type your answer here. You may also attach a photo or PDF below."
              className="w-full rounded-xl border border-line bg-canvas px-4 py-3 text-sm text-navy focus:border-secondary focus:outline-none focus:ring-1 focus:ring-secondary"
            />
          </div>

          <div>
            <p className="mb-1 text-[12px] font-semibold text-navy dark:text-secondary">
              Attachments <span className="font-normal text-muted">(optional)</span>
            </p>
            <input
              ref={fileInputRef}
              id="information-response-files"
              type="file"
              accept={ALLOWED.join(",")}
              multiple
              onChange={addFiles}
              className="sr-only"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-line bg-white px-4 text-xs font-semibold text-mirage transition-colors hover:bg-alt"
            >
              <Paperclip className="h-4 w-4" aria-hidden="true" />
              Choose a photo or PDF
            </button>
            <p className="mt-1.5 text-[11px] text-muted">
              JPG, PNG, WEBP or PDF, up to 10 MB each. Up to 5 files.
            </p>

            {files.length > 0 ? (
              <ul className="mt-2 space-y-1">
                {files.map((file, index) => (
                  <li
                    key={`${file.name}-${index}`}
                    className="flex items-center justify-between gap-3 rounded-lg bg-alt px-3 py-2 text-xs text-mirage"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <FileText className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden="true" />
                      <span className="truncate">{file.name}</span>
                      <span className="shrink-0 text-muted">{formatBytes(file.size)}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setFiles((prev) => prev.filter((_, i) => i !== index))}
                      aria-label={`Remove ${file.name}`}
                      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted hover:text-critical"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <button
            type="button"
            onClick={handleSend}
            disabled={sending || (!text.trim() && files.length === 0)}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-full bg-navy px-5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Send className="h-4 w-4" aria-hidden="true" />
            {sending ? "Sending…" : "Send to the barangay"}
          </button>
        </div>
      ) : null}

      {answered && history && history.length > 0 ? (
        <div className="mt-4 space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
            What you sent
          </p>
          {history.map((item) => (
            <div key={item.id} className="rounded-xl border border-line bg-alt px-4 py-3">
              <p className="text-[11px] text-muted">{formatDateTime(item.created_at)}</p>
              {item.text ? (
                <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-mirage">
                  {item.text}
                </p>
              ) : (
                <p className="mt-1 text-sm italic text-muted">Attachments only.</p>
              )}
              {item.evidenceIds.length > 0 ? (
                <p className="mt-1.5 text-xs text-muted">
                  {item.evidenceIds.length} file{item.evidenceIds.length > 1 ? "s" : ""} attached
                </p>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
