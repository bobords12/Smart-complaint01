import { jsPDF } from "jspdf";
import { SITE } from "@/lib/constants";

export function sanitizeFilename(str) {
  return (str || "unknown")
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function safe(val, fallback = "Not provided") {
  if (val === null || val === undefined || val === "") return fallback;
  return String(val);
}

/**
 * Build a printable official document (summons, hearing notice, minutes,
 * settlement, resolution, certificate, referral note) as a PDF blob.
 * Returns { blob, filename }.
 */
export function buildOfficialDocumentPdf({
  documentType,
  title,
  complaint,
  complainant,
  respondent,
  hearing = null,
}) {
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

  function field(label, value) {
    checkPage(12);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...muted);
    doc.text(label, margin, y);
    y += 4.5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...dark);
    const lines = doc.splitTextToSize(safe(value), contentWidth);
    for (const ln of lines) {
      checkPage(6);
      doc.text(ln, margin, y);
      y += 5;
    }
    y += 2;
  }

  // Header
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

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(...navy);
  doc.text(title || "Official Document", margin, y);
  y += 4;
  doc.setFont("helvetica", "italic");
  doc.setFontSize(9);
  doc.setTextColor(...muted);
  doc.text(`Document type: ${documentType || "other"}`, margin, y);
  y += 6;
  addLine();
  y += 2;

  // Complaint info
  field("Reference Number", complaint?.reference_number);
  field("Complaint Title", complaint?.title);
  field("Complainant", complainant);
  field("Respondent", respondent);

  if (hearing) {
    field("Hearing", hearing.title);
    field("Hearing Date", hearing.hearing_date);
    field("Hearing Time", hearing.hearing_time);
    field("Venue", hearing.venue || SITE.hall);
  }

  // Footer
  checkPage(20);
  y += 4;
  addLine();
  y += 2;
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
  doc.text("This document is generated within the Barangay complaint workspace.", margin, y);

  const base = sanitizeFilename(title || documentType);
  const ref = sanitizeFilename(complaint?.reference_number || complaint?.id?.slice(0, 8) || "case");
  const filename = `${base}-${ref}.pdf`;
  return { blob: doc.output("blob"), filename };
}