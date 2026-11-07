export type ComplaintStatus =
  | "Pending Review"
  | "For Official Categorization"
  | "Received"
  | "In Progress"
  | "Awaiting Meeting"
  | "Resolved"
  | "Closed"
  | "Rejected";

export type UrgencyLevel = "Critical" | "High" | "Normal";

export type CaseCategory = "Criminal" | "Civil" | "Administrative";

export type CaseType = "Criminal" | "Civil" | "Administrative";

export interface ComplaintUpdate {
  date: string;
  note: string;
  status?: ComplaintStatus;
}

export interface EvidenceMetadata {
  id: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  description?: string;
  uploadedAt?: string;
  previewUrl?: string;
  storage_path?: string;
}

export type KPPhaseType =
  | "Assessment"
  | "Mediation"
  | "Conciliation"
  | "Conciliation Extension"
  | "Completed"
  | "Not Applicable";

export type KPPhaseStatus =
  | "Not Started"
  | "Active"
  | "Due Soon"
  | "Settled"
  | "Completed Without Settlement"
  | "Period Elapsed"
  | "Extended"
  | "Completed";

export interface KPPhaseRecord {
  id: string;
  phase: "Mediation" | "Conciliation" | "Conciliation Extension";
  startDate: string;
  deadlineDate: string;
  durationDays: number;
  status: KPPhaseStatus;
  completedAt?: string;
  outcome?: string;
  extensionDays?: number;
  extensionReason?: string;
  approvedAt?: string;
  approvedBy?: string;
}

export interface KPTracker {
  applicable: boolean;
  applicabilityConfirmedAt?: string;
  applicabilityConfirmedBy?: string;
  currentPhase: KPPhaseType;
  phases: KPPhaseRecord[];
}

export interface DeadlineTracker {
  applicable: boolean;
  status:
    | "Not Started"
    | "Active"
    | "Due Soon"
    | "Completed"
    | "Expired"
    | "Not Applicable";
  startDate?: string;
  endDate?: string;
  totalDays?: number;
  elapsedDays?: number;
  basis?: string;
}

export interface HearingSchedule {
  id: string;
  title: string;
  date: string;
  time?: string;
  venue?: string;
  attendance?: string;
  status: "Upcoming" | "Completed" | "Rescheduled" | "Cancelled";
  relatedDocumentId?: string;
}

export interface ProgressEntry {
  id: string;
  title: string;
  description: string;
  occurredAt?: string;
  state: "completed" | "current" | "pending";
}

export interface Complaint {
  id: string;
  caseNo: string;
  title: string;
  category: CaseCategory;
  confirmedCategory?: CaseCategory;
  priority: UrgencyLevel;
  confirmedPriority?: UrgencyLevel;
  status: ComplaintStatus;
  submittedOn: string;
  submittedAt?: string;
  summary: string;
  description?: string;
  incidentDate?: string;
  incidentTime?: string;
  location?: string;
  personsInvolved?: string;
  witnesses?: string;
  purok?: string;
  complainantName?: string;
  complainantContact?: string;
  complainantAddress?: string;
  respondent?: string;
  evidenceDescription?: string;
  referenceNumber?: string;
  // Official receipt. Set together by receive_complaint_official().
  // barangayCaseNumber stays null until then, and is a different
  // identifier from the tracking reference number.
  barangayCaseNumber?: string | null;
  officialReceivedAt?: string | null;
  receivedBy?: string | null;
  receivedByName?: string | null;
  // "Nadawat / Gitipigan" on the official Reklamo Form.
  desiredRelief?: string | null;
  officialCategory?: string | null;
  officialUrgency?: string | null;
  // Raw snake_case columns. The mapped fields above are display shapes; these
  // pass through unchanged for document and form generation, where the exact
  // stored value matters.
  reference_number?: string | null;
  barangay_case_number?: string | null;
  official_received_at?: string | null;
  received_by?: string | null;
  desired_relief?: string | null;
  official_category?: string | null;
  official_urgency?: string | null;
  // The resident-safe half of the routing assessment. An official can
  // record that a submission is missing something; the resident has to be
  // able to read what is missing and answer, so these six are the only
  // routing columns exposed to the resident app. The internal reasons
  // (routing_reason, kp_applicability_reason) are deliberately absent.
  completeness_status?: string | null;
  routing_status?: string | null;
  requested_information?: string | null;
  requested_information_at?: string | null;
  last_information_response_at?: string | null;
  information_responses?: number | null;
  evidence_count?: number | null;
  updates: ComplaintUpdate[];
  evidence?: EvidenceMetadata[];
  deadlineTracker?: DeadlineTracker | null;
  kpTracker?: KPTracker | null;
  hearingSchedule?: HearingSchedule[];
  progressHistory?: ProgressEntry[];
  residentId?: string;
  aiPrediction?: {
    category: string;
    caseType: CaseType;
    urgencyLevel: UrgencyLevel;
    recommendedAction: string;
    confidence: number;
  };
}

export interface Hearing {
  id: string;
  caseNo: string;
  complaintTitle: string;
  hearingType: string;
  date: string;
  time: string;
  venue: string;
  status: "Upcoming" | "Completed" | "Rescheduled" | "Cancelled";
  instructions?: string;
  participants?: string[];
  hasSummons?: boolean;
}

export interface Notification {
  id: string;
  caseNo?: string;
  hearingId?: string;
  message: string;
  time: string;
  unread: boolean;
  type: "complaint" | "hearing" | "general";
}
