"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/context/AuthContext";
import EmptyState from "@/components/shared/EmptyState";
import StatusBadge from "@/components/shared/StatusBadge";
import LoadingButton from "@/components/shared/LoadingButton";
import ResidentModal from "@/components/shared/ResidentModal";
import {
  FolderOpen,
  Upload,
  Download,
  Archive,
  Search,
  FileText,
  Filter,
  X,
  ChevronDown,
  CheckCircle2,
  Eye,
} from "lucide-react";
import toast from "react-hot-toast";
import { useDocumentViewer } from "@/components/shared/DocumentViewerProvider";

const DOCUMENT_TYPES = [
  { value: "complaint_summary", label: "Complaint Summary" },
  // "summons" stays listed so case files opened before the summons was
  // retired can still be filtered down to those older documents.
  { value: "summons", label: "Summons" },
  { value: "hearing_notice", label: "Notice of Hearing" },
  { value: "minutes", label: "Minutes" },
  { value: "settlement", label: "Settlement" },
  { value: "certificate_to_file_action", label: "Certificate to File Action" },
  { value: "blotter_report", label: "Blotter Report" },
  { value: "referral_note", label: "Referral Note" },
  { value: "resolution", label: "Resolution" },
  { value: "proof_of_service", label: "Proof of Service" },
  { value: "other", label: "Other" },
];

const VISIBILITY_OPTIONS = [
  { value: "official", label: "Official Only" },
  { value: "resident_visible", label: "Resident Visible" },
  { value: "public", label: "Public" },
];

const ACCEPTED_TYPES = ".pdf,.docx,.doc,.png,.jpg,.jpeg,.gif";

function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function typeLabel(value) {
  const found = DOCUMENT_TYPES.find((t) => t.value === value);
  return found ? found.label : value;
}

export default function CaptainDocumentsPage() {
  const { user } = useAuth();

  const [documents, setDocuments] = useState([]);
  const [complaints, setComplaints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [searchInput, setSearchInput] = useState("");
  // Responsive per keystroke; the document list re-filters on a pause.
  const [typeFilter, setTypeFilter] = useState("");

  const [showUpload, setShowUpload] = useState(false);
  const [uploadForm, setUploadForm] = useState({
    document_type: "",
    title: "",
    complaint_id: "",
    visibility: "official",
    file: null,
  });
  const [uploading, setUploading] = useState(false);

  const [archiving, setArchiving] = useState(null);
  const { viewDocument } = useDocumentViewer();

  const fetchDocuments = useCallback(async () => {
    const supabase = createClient();
    const { data, error: fetchErr } = await supabase
      .from("official_documents")
      // Pinned to uploaded_by: official_documents also has a generated_by
      // foreign key to profiles, which made the bare embed ambiguous.
      .select("*, complaints(reference_number, title), profiles!uploaded_by(display_name)")
      .order("created_at", { ascending: false });

    if (fetchErr) {
      setError(fetchErr.message);
      return [];
    }
    setDocuments(data || []);
    return data || [];
  }, []);

  const fetchComplaints = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("complaints")
      .select("id, reference_number, title")
      .order("created_at", { ascending: false });

    setComplaints(data || []);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      await Promise.all([fetchDocuments(), fetchComplaints()]);
      if (!cancelled) setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [fetchDocuments, fetchComplaints]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("captain-documents-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "official_documents" }, () => {
        fetchDocuments();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchDocuments]);

  // Memoized so a keystroke in the search box does not re-run the filter
  // over the whole document list, and so the upload form below is not
  // re-rendered with the page on every character.
  const filtered = useMemo(() => {
    const needle = searchInput.trim().toLowerCase();
    return documents.filter((doc) => {
      const matchesSearch =
        !needle ||
        doc.title?.toLowerCase().includes(needle) ||
        doc.filename?.toLowerCase().includes(needle);
      const matchesType = !typeFilter || doc.document_type === typeFilter;
      return matchesSearch && matchesType;
    });
  }, [documents, searchInput, typeFilter]);

  const handleUploadChange = (field, value) => {
    setUploadForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0] || null;
    handleUploadChange("file", file);
  };

  const resetUploadForm = () => {
    setUploadForm({
      document_type: "",
      title: "",
      complaint_id: "",
      visibility: "official",
      file: null,
    });
  };

  const handleUpload = async () => {
    if (!uploadForm.document_type || !uploadForm.title || !uploadForm.file) {
      toast.error("Please fill in all required fields.");
      return;
    }

    setUploading(true);
    const supabase = createClient();

    try {
      const file = uploadForm.file;
      const fileExt = file.name.split(".").pop();
      const storagePath = `documents/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${fileExt}`;

      const { error: storageErr } = await supabase.storage
        .from("documents")
        .upload(storagePath, file);

      if (storageErr) {
        toast.error(`Upload failed: ${storageErr.message}`);
        return;
      }

      const { error: insertErr } = await supabase.from("official_documents").insert({
        document_type: uploadForm.document_type,
        title: uploadForm.title,
        filename: file.name,
        storage_path: storagePath,
        mime_type: file.type,
        file_size: file.size,
        visibility: uploadForm.visibility,
        complaint_id: uploadForm.complaint_id || null,
        uploaded_by: user?.id || null,
        status: "active",
      });

      if (insertErr) {
        toast.error(`Failed to save document: ${insertErr.message}`);
        return;
      }

      toast.success("Document uploaded successfully.");
      setShowUpload(false);
      resetUploadForm();
      fetchDocuments();
    } catch (err) {
      toast.error("An unexpected error occurred.");
    } finally {
      setUploading(false);
    }
  };

  // Reads the document inside the app. Download stays a separate action so
  // an officer can still keep a copy, but reading one no longer requires it.
  const handleView = (doc) => {
    if (!doc.storage_path) {
      toast.error("This document has no stored file.");
      return;
    }
    viewDocument({
      supabase: createClient(),
      bucket: "documents",
      storagePath: doc.storage_path,
      title: doc.title || doc.filename || "Document",
      subtitle: DOCUMENT_TYPES.find((t) => t.value === doc.document_type)?.label || null,
      filename: doc.filename || null,
      mime: doc.mime_type || null,
      errorMessage: "Could not open this document.",
    });
  };

  const handleDownload = async (doc) => {
    const supabase = createClient();
    const { data, error: urlErr } = await supabase.storage
      .from("documents")
      .createSignedUrl(doc.storage_path, 60);

    if (urlErr || !data?.signedUrl) {
      toast.error("Failed to generate download link.");
      return;
    }

    const a = window.document.createElement("a");
    a.href = data.signedUrl;
    a.download = doc.filename || doc.title;
    a.click();
    toast.success("Download started.");
  };

  const handleArchive = async (doc) => {
    setArchiving(doc.id);
    const supabase = createClient();
    const { error } = await supabase
      .from("official_documents")
      .update({ status: "archived" })
      .eq("id", doc.id);

    if (error) {
      toast.error("Failed to archive document.");
    } else {
      toast.success("Document archived.");
      fetchDocuments();
    }
    setArchiving(null);
  };

  const activeDocs = filtered.filter((d) => d.status !== "archived");
  const archivedDocs = filtered.filter((d) => d.status === "archived");

  if (loading) {
    return (
      <div className="mx-auto max-w-[1280px] space-y-6">
        <div className="flex items-center gap-3">
          <FolderOpen className="h-6 w-6 text-secondary" />
          <h1 className="font-heading text-2xl font-semibold tracking-tight text-navy">
            Document Management
          </h1>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="rounded-2xl border border-line bg-white p-6 shadow-[0_1px_2px_rgba(11,33,68,0.06)]"
            >
              <div className="space-y-3">
                <div className="h-4 w-32 animate-pulse rounded bg-alt" />
                <div className="h-3 w-20 animate-pulse rounded bg-alt" />
                <div className="h-3 w-48 animate-pulse rounded bg-alt" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1280px] space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <FolderOpen className="h-6 w-6 shrink-0 text-secondary" />
          <div className="min-w-0">
            <h1 className="font-heading text-xl font-semibold tracking-tight text-navy sm:text-2xl">
              Document Management
            </h1>
            <p className="text-[13px] text-muted">
              Manage official documents, uploads, and archives
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowUpload(true)}
          className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-2 rounded-full bg-jordy px-5 py-2.5 text-sm font-semibold text-white shadow-button transition-colors hover:bg-secondary"
        >
          <Upload className="h-4 w-4" aria-hidden="true" />
          Upload Document
        </button>
      </div>

      {/* Filters */}
      <section className="rounded-2xl border border-line bg-white p-4 shadow-[0_1px_2px_rgba(11,33,68,0.06)]">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
            <input
              type="text"
value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search by title or filename..."
              className="h-10 w-full rounded-full border border-line bg-canvas pl-9 pr-4 text-[13px] text-navy placeholder:text-muted focus:border-secondary focus:outline-none focus:ring-2 focus:ring-secondary/20"
            />
          </div>
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="h-10 appearance-none rounded-full border border-line bg-canvas pl-9 pr-8 text-[13px] text-navy focus:border-secondary focus:outline-none focus:ring-2 focus:ring-secondary/20"
            >
              <option value="">All Types</option>
              {DOCUMENT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
          </div>
        </div>
      </section>

      {/* Active Documents Table */}
      <section
        aria-labelledby="active-documents"
        className="rounded-2xl border border-line bg-white p-6 shadow-[0_1px_2px_rgba(11,33,68,0.06)]"
      >
        <h2
          id="active-documents"
          className="flex items-center gap-2 font-heading text-base font-semibold tracking-tight text-navy"
        >
          <FileText className="h-5 w-5 text-gold" aria-hidden="true" />
          Active Documents
          <span className="ml-1 rounded-full bg-alt px-2 py-0.5 text-[11px] font-semibold text-muted">
            {activeDocs.length}
          </span>
        </h2>

        {activeDocs.length === 0 ? (
          <EmptyState
            title="No documents found"
            message="Upload your first document to get started."
            icon={FolderOpen}
          />
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-[11px] font-semibold uppercase tracking-wider text-muted">
                  <th className="pb-3 pr-4">Title</th>
                  <th className="pb-3 pr-4">Type</th>
                  <th className="pb-3 pr-4">Linked Case</th>
                  <th className="pb-3 pr-4">File Size</th>
                  <th className="pb-3 pr-4">Uploaded By</th>
                  <th className="pb-3 pr-4">Date</th>
                  <th className="pb-3 pr-4">Status</th>
                  <th className="pb-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {activeDocs.map((doc) => (
                  <tr
                    key={doc.id}
                    className="transition-colors hover:bg-alt/40"
                  >
                    <td className="max-w-[200px] truncate py-3 pr-4 font-medium text-navy">
                      {doc.title}
                    </td>
                    <td className="py-3 pr-4">
                      <StatusBadge label={typeLabel(doc.document_type)} />
                    </td>
                    <td className="py-3 pr-4 text-muted">
                      {doc.complaints
                        ? doc.complaints.reference_number || doc.complaints.title || "—"
                        : "—"}
                    </td>
                    <td className="py-3 pr-4 text-muted">
                      {formatFileSize(doc.file_size)}
                    </td>
                    <td className="py-3 pr-4 text-muted">
                      {doc.profiles?.display_name || "—"}
                    </td>
                    <td className="py-3 pr-4 text-muted">
                      {formatDate(doc.created_at)}
                    </td>
                    <td className="py-3 pr-4">
                      <StatusBadge
                        label={doc.status?.charAt(0).toUpperCase() + doc.status?.slice(1)}
                      />
                    </td>
                    <td className="py-3">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleView(doc)}
                          className="inline-flex items-center gap-1 rounded-full bg-alt px-3 py-1.5 text-[12px] font-semibold text-navy transition-colors hover:bg-info-soft"
                          title="View without downloading"
                        >
                          <Eye className="h-3 w-3" aria-hidden="true" />
                          View
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDownload(doc)}
                          className="inline-flex items-center gap-1 rounded-full bg-alt px-3 py-1.5 text-[12px] font-semibold text-secondary transition-colors hover:bg-info-soft hover:text-secondary"
                          title="Download"
                        >
                          <Download className="h-3 w-3" aria-hidden="true" />
                          Download
                        </button>
                        <button
                          type="button"
                          onClick={() => handleArchive(doc)}
                          disabled={archiving === doc.id}
                          className="inline-flex items-center gap-1 rounded-full bg-critical-soft px-3 py-1.5 text-[12px] font-semibold text-critical transition-colors hover:bg-critical/10 disabled:opacity-50"
                          title="Archive"
                        >
                          <Archive className="h-3 w-3" aria-hidden="true" />
                          Archive
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Archived Documents */}
      {archivedDocs.length > 0 && (
        <section
          aria-labelledby="archived-documents"
          className="rounded-2xl border border-line bg-white p-6 shadow-[0_1px_2px_rgba(11,33,68,0.06)]"
        >
          <h2
            id="archived-documents"
            className="flex items-center gap-2 font-heading text-base font-semibold tracking-tight text-navy"
          >
            <Archive className="h-5 w-5 text-muted" aria-hidden="true" />
            Archived Documents
            <span className="ml-1 rounded-full bg-alt px-2 py-0.5 text-[11px] font-semibold text-muted">
              {archivedDocs.length}
            </span>
          </h2>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[700px] text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-[11px] font-semibold uppercase tracking-wider text-muted">
                  <th className="pb-3 pr-4">Title</th>
                  <th className="pb-3 pr-4">Type</th>
                  <th className="pb-3 pr-4">Date</th>
                  <th className="pb-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {archivedDocs.map((doc) => (
                  <tr
                    key={doc.id}
                    className="transition-colors hover:bg-alt/40 opacity-60"
                  >
                    <td className="max-w-[200px] truncate py-3 pr-4 font-medium text-navy">
                      {doc.title}
                    </td>
                    <td className="py-3 pr-4">
                      <StatusBadge label={typeLabel(doc.document_type)} />
                    </td>
                    <td className="py-3 pr-4 text-muted">
                      {formatDate(doc.created_at)}
                    </td>
                    <td className="py-3">
                      <button
                        type="button"
                        onClick={() => handleDownload(doc)}
                        className="inline-flex items-center gap-1 rounded-full bg-alt px-3 py-1.5 text-[12px] font-semibold text-secondary transition-colors hover:bg-info-soft hover:text-secondary"
                      >
                        <Download className="h-3 w-3" aria-hidden="true" />
                        Download
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Upload Modal */}
      <ResidentModal
        open={showUpload}
        onClose={() => { setShowUpload(false); resetUploadForm(); }}
        labelledBy="upload-document-title"
        title="Upload Document"
        maxWidthClass="max-w-lg"
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-[13px] font-semibold text-navy">
              Document Type <span className="text-critical">*</span>
            </label>
            <select
              value={uploadForm.document_type}
              onChange={(e) => handleUploadChange("document_type", e.target.value)}
              className="h-10 w-full rounded-xl border border-line bg-canvas px-3 text-[13px] text-navy focus:border-secondary focus:outline-none focus:ring-2 focus:ring-secondary/20"
            >
              <option value="">Select type...</option>
              {DOCUMENT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-[13px] font-semibold text-navy">
              Title <span className="text-critical">*</span>
            </label>
            <input
              type="text"
              value={uploadForm.title}
              onChange={(e) => handleUploadChange("title", e.target.value)}
              placeholder="Enter document title..."
              className="h-10 w-full rounded-xl border border-line bg-canvas px-3 text-[13px] text-navy placeholder:text-muted focus:border-secondary focus:outline-none focus:ring-2 focus:ring-secondary/20"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-[13px] font-semibold text-navy">
              Linked Complaint
            </label>
            <select
              value={uploadForm.complaint_id}
              onChange={(e) => handleUploadChange("complaint_id", e.target.value)}
              className="h-10 w-full rounded-xl border border-line bg-canvas px-3 text-[13px] text-navy focus:border-secondary focus:outline-none focus:ring-2 focus:ring-secondary/20"
            >
              <option value="">None (standalone document)</option>
              {complaints.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.reference_number} — {c.title}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-[13px] font-semibold text-navy">
              File <span className="text-critical">*</span>
            </label>
            <input
              type="file"
              accept={ACCEPTED_TYPES}
              onChange={handleFileChange}
              className="block w-full text-[13px] text-muted file:mr-3 file:rounded-xl file:border-0 file:bg-alt file:px-4 file:py-2 file:text-[13px] file:font-semibold file:text-navy hover:file:bg-info-soft"
            />
            {uploadForm.file && (
              <p className="mt-1.5 text-[12px] text-muted">
                {uploadForm.file.name} ({formatFileSize(uploadForm.file.size)})
              </p>
            )}
          </div>

          <div>
            <label className="mb-1.5 block text-[13px] font-semibold text-navy">
              Visibility
            </label>
            <select
              value={uploadForm.visibility}
              onChange={(e) => handleUploadChange("visibility", e.target.value)}
              className="h-10 w-full rounded-xl border border-line bg-canvas px-3 text-[13px] text-navy focus:border-secondary focus:outline-none focus:ring-2 focus:ring-secondary/20"
            >
              {VISIBILITY_OPTIONS.map((v) => (
                <option key={v.value} value={v.value}>
                  {v.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => { setShowUpload(false); resetUploadForm(); }}
              disabled={uploading}
              className="inline-flex h-11 items-center justify-center rounded-full border border-line px-5 text-sm font-semibold text-mirage transition-colors hover:bg-alt disabled:opacity-60"
            >
              Cancel
            </button>
            <LoadingButton isLoading={uploading} onClick={handleUpload}>
              <Upload className="h-4 w-4" aria-hidden="true" />
              Upload
            </LoadingButton>
          </div>
        </div>
      </ResidentModal>

      {error && (
        <div
          role="alert"
          className="fixed bottom-4 right-4 z-50 max-w-sm rounded-xl border border-critical/30 bg-white px-4 py-3 shadow-lg"
        >
          <p className="text-sm font-semibold text-critical">{error}</p>
        </div>
      )}
    </div>
  );
}