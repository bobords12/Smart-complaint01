import { jsPDF } from "jspdf";
import { SITE } from "@/lib/constants";

function sanitizeFilename(str) {
  return (str || "unknown").replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function safe(val, fallback = "Not provided") {
  if (val === null || val === undefined || val === "") return fallback;
  return String(val);
}

function formatDateLabel(isoOrStr) {
  if (!isoOrStr) return "Not provided";
  try {
    const d = new Date(isoOrStr);
    if (isNaN(d.getTime())) return String(isoOrStr);
    return d.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return String(isoOrStr);
  }
}

function formatDateTimeLabel(isoOrStr) {
  if (!isoOrStr) return "Not provided";
  try {
    const d = new Date(isoOrStr);
    if (isNaN(d.getTime())) return String(isoOrStr);
    return d.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return String(isoOrStr);
  }
}

const REFERRAL_STATUS_LABELS = {
  pending_review: "Pending Barangay Review",
  more_information_required: "More Information Required",
  approved: "Approved for Referral",
  declined: "Declined",
  officially_referred: "Referred to PNP",
  completed: "Completed",
  cancelled: "Cancelled",
};

/**
 * Generate a complaint summary PDF and trigger download.
 * Returns true on success, throws on failure.
 */
export function generateComplaintPdf(complaint, options = {}) {
  const {
    evidence = [],
    hearings = [],
    caseStatuses = [],
    referralRequest = null,
  } = options;

  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 18;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  const navy = [14, 47, 92];
  const dark = [30, 30, 30];
  const muted = [100, 110, 130];
  const line = [220, 226, 238];

  function addLine() {
    doc.setDrawColor(...line);
    doc.setLineWidth(0.3);
    doc.line(margin, y, pageWidth - margin, y);
    y += 4;
  }

  function checkPage(needed) {
    if (y + needed > doc.internal.pageSize.getHeight() - margin) {
      doc.addPage();
      y = margin;
    }
  }

  function addSectionTitle(text) {
    checkPage(14);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...navy);
    doc.text(text, margin, y);
    y += 2;
    addLine();
    y += 4;
  }

  function addField(label, value) {
    const displayValue = safe(value);
    checkPage(12);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...muted);
    doc.text(label, margin, y);
    y += 4.5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...dark);
    const lines = doc.splitTextToSize(displayValue, contentWidth);
    for (const line of lines) {
      checkPage(6);
      doc.text(line, margin, y);
      y += 5;
    }
    y += 2;
  }

  function addMultiLineField(label, value) {
    const displayValue = safe(value);
    checkPage(12);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...muted);
    doc.text(label, margin, y);
    y += 4.5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...dark);
    const lines = doc.splitTextToSize(displayValue, contentWidth);
    for (const ln of lines) {
      checkPage(6);
      doc.text(ln, margin, y);
      y += 5;
    }
    y += 2;
  }

  // ── Header ──────────────────────────────────────────────
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(...navy);
  doc.text(SITE.name, margin, y);
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...muted);
  doc.text(`${SITE.barangay}, ${SITE.city}`, margin, y);
  y += 10;

  // ── Title ───────────────────────────────────────────────
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(...navy);
  doc.text("Complaint Summary", margin, y);
  y += 8;

  addLine();
  y += 2;

  // ── Complaint Info ──────────────────────────────────────
  addSectionTitle("Complaint Information");
  addField("Title", complaint.title);
  addField("Reference Number", complaint.caseNo);
  addField("Date Filed", complaint.submittedOn);
  addField("Current Status", complaint.status);
  addField("Current Stage", complaint.status);
  addField("Confirmed Category", complaint.confirmedCategory);
  addField("Confirmed Urgency", complaint.confirmedPriority);
  addField("Last Updated", complaint.submittedOn);

  // ── Parties ─────────────────────────────────────────────
  addSectionTitle("Parties");
  addField("Complainant", complaint.complainantName);
  addField("Respondent", complaint.respondent || complaint.personsInvolved);

  // ── Incident Details ────────────────────────────────────
  addSectionTitle("Incident Details");
  addField("Incident Date", formatDateLabel(complaint.incidentDate));
  addField("Incident Time", complaint.incidentTime || "Not provided");
  addField("Location", complaint.location);

  // ── Description ─────────────────────────────────────────
  addSectionTitle("Description");
  addMultiLineField("Complaint Description", complaint.description || complaint.summary);

  // ── Evidence ────────────────────────────────────────────
  if (evidence.length > 0) {
    addSectionTitle("Evidence");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...dark);
    for (const ev of evidence) {
      checkPage(6);
      const name = ev.fileName || ev.original_filename || "Unnamed file";
      doc.text(`- ${name}`, margin, y);
      y += 5;
    }
    y += 2;
  }

  // ── Hearing Schedule ────────────────────────────────────
  if (hearings.length > 0) {
    addSectionTitle("Hearing Schedule");
    for (const h of hearings) {
      checkPage(16);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(...dark);
      doc.text(safe(h.title, "Hearing"), margin, y);
      y += 5;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(...muted);
      const details = [
        h.date ? `Date: ${formatDateLabel(h.date)}` : null,
        h.time ? `Time: ${h.time}` : null,
        h.venue ? `Venue: ${h.venue}` : null,
        h.status ? `Status: ${h.status}` : null,
      ].filter(Boolean);
      if (details.length > 0) {
        doc.text(details.join("  |  "), margin, y);
        y += 5;
      }
      y += 2;
    }
  }

  // ── Case Progress ───────────────────────────────────────
  if (caseStatuses.length > 0) {
    addSectionTitle("Case Progress");
    for (const cs of caseStatuses) {
      checkPage(10);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(...dark);
      doc.text(safe(cs.status, "Status"), margin, y);
      y += 4;
      if (cs.resident_visible_message || cs.notes) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.setTextColor(...muted);
        const msg = cs.resident_visible_message || cs.notes;
        const lines = doc.splitTextToSize(msg, contentWidth);
        for (const ln of lines) {
          checkPage(5);
          doc.text(ln, margin, y);
          y += 4;
        }
      }
      if (cs.created_at) {
        doc.setFont("helvetica", "italic");
        doc.setFontSize(8);
        doc.setTextColor(...muted);
        doc.text(formatDateTimeLabel(cs.created_at), margin, y);
        y += 4;
      }
      y += 2;
    }
  }

  // ── Referral Status ─────────────────────────────────────
  if (referralRequest) {
    addSectionTitle("PNP Referral Request");
    const statusLabel = REFERRAL_STATUS_LABELS[referralRequest.status] || referralRequest.status;
    addField("Status", statusLabel);
    addField("Date Requested", formatDateLabel(referralRequest.requested_at));
    if (referralRequest.decision_note) {
      addField("Update", referralRequest.decision_note);
    }
  }

  // ── Footer ──────────────────────────────────────────────
  checkPage(20);
  y += 4;
  addLine();
  y += 4;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...muted);
  const now = new Date();
  doc.text(
    `Generated: ${now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })} ${now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`,
    margin,
    y
  );
  y += 4;
  doc.text("This document is for the resident's personal records.", margin, y);

  // ── Download ────────────────────────────────────────────
  const refSanitized = sanitizeFilename(complaint.caseNo);
  const filename = `Complaint-${refSanitized}-Summary.pdf`;
  doc.save(filename);

  return filename;
}
