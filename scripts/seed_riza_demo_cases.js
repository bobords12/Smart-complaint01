#!/usr/bin/env node
/**
 * SEED SCRIPT - REVIEW ONLY - NOT EXECUTED
 * Creates 8 fictional demo cases for Riza Oyangorin (46b21e4e-59a1-4861-9ddb-3a4396cd656d)
 * All data marked SAMPLE — FOR CAPSTONE DEMONSTRATION ONLY
 * Idempotent - checks for existing demo cases before inserting
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const ENV_PATH = path.join(ROOT, ".env");

function getEnv(name) {
  const t = fs.readFileSync(ENV_PATH, "utf8");
  const m = t.match(new RegExp(name + "\\s*=\\s*(.*)"));
  if (!m) throw new Error(`Missing ${name} in .env`);
  return m[1].trim().replace(/^["']|["']$/g, "");
}

const SUPABASE_URL = getEnv("NEXT_PUBLIC_SUPABASE_URL");
const SERVICE_KEY = getEnv("SUPABASE_SERVICE_ROLE_KEY");
const RIZA_PROFILE_ID = "46b21e4e-59a1-4861-9ddb-3a4396cd656d";

const DEMO_MARKER = "SAMPLE — FOR CAPSTONE DEMONSTRATION ONLY";

const cases = [
  {
    ref: "AB-2026-9001",
    title: `[DEMO] ${DEMO_MARKER} - Unpaid Debt (Civil, Normal)`,
    description: `[DEMO] ${DEMO_MARKER}. Complainant alleges respondent borrowed money for a small business but has failed to repay despite repeated verbal demands. Amount involved is moderate. Parties known to each other.`,
    category: "Civil",
    urgency: "Normal",
    complaint_nature: "two_party_dispute",
    respondent_status: "identified",
    respondent_display_name: "DEMO - Mateo Dela Cruz",
    incident_location: "DEMO - Purok 2, Barangay Abuno, Iligan City",
    desired_relief: "DEMO - Request for amicable settlement and repayment schedule",
    status: "Pending Review",
    stage: "Pending Review",
    routing_status: "pending_assessment",
    filing_channel: "resident_portal",
    source: "resident_portal",
    has_hearing: true,
    has_pangkat: false,
    has_settlement: false,
    has_cfa: false,
    has_pnp: false,
  },
  {
    ref: "AB-2026-9002",
    title: `[DEMO] ${DEMO_MARKER} - Boundary Dispute (Civil, High)`,
    description: `[DEMO] ${DEMO_MARKER}. Dispute over property boundary between adjacent lots. Both parties claim right of way. Tensions escalating between families.`,
    category: "Civil",
    urgency: "High",
    complaint_nature: "two_party_dispute",
    respondent_status: "identified",
    respondent_display_name: "DEMO - Ana Marie Santos",
    incident_location: "DEMO - Purok 3, Barangay Abuno, Iligan City",
    desired_relief: "DEMO - Boundary clarification and amicable settlement",
    status: "In Progress",
    stage: "Mediation",
    routing_status: "kp_mediation",
    filing_channel: "staff_assisted",
    source: "staff_assisted",
    has_hearing: true,
    has_pangkat: false,
    has_settlement: false,
    has_cfa: false,
    has_pnp: false,
  },
  {
    ref: "AB-2026-9003",
    title: `[DEMO] ${DEMO_MARKER} - Theft of Personal Belongings (Criminal, High)`,
    description: `[DEMO] ${DEMO_MARKER}. Complainant reports theft of personal belongings from residence. Suspect known to complainant. Items of significant value taken.`,
    category: "Criminal",
    urgency: "High",
    complaint_nature: "two_party_dispute",
    respondent_status: "identified",
    respondent_display_name: "DEMO - Rico Villanueva",
    incident_location: "DEMO - Purok 1, Barangay Abuno, Iligan City",
    desired_relief: "DEMO - Recovery of items and appropriate action",
    status: "In Progress",
    stage: "Mediation",
    routing_status: "kp_mediation",
    filing_channel: "resident_portal",
    source: "resident_portal",
    has_hearing: true,
    has_pangkat: false,
    has_settlement: false,
    has_cfa: false,
    has_pnp: false,
  },
  {
    ref: "AB-2026-9004",
    title: `[DEMO] ${DEMO_MARKER} - Grave Threats (Criminal, Critical)`,
    description: `[DEMO] ${DEMO_MARKER}. Serious threats made against complainant and family members. Immediate safety concern. Requires careful handling per barangay procedures.`,
    category: "Criminal",
    urgency: "Critical",
    complaint_nature: "two_party_dispute",
    respondent_status: "identified",
    respondent_display_name: "DEMO - Junie Batucan",
    incident_location: "DEMO - Purok 4, Barangay Abuno, Iligan City",
    desired_relief: "DEMO - Protection and resolution of threats",
    status: "In Progress",
    stage: "Mediation",
    routing_status: "kp_mediation",
    filing_channel: "barangay_hall",
    source: "staff_assisted",
    has_hearing: true,
    has_pangkat: false,
    has_settlement: false,
    has_cfa: false,
    has_pnp: true, // PNP referral for this Critical Criminal case
  },
  {
    ref: "AB-2026-9005",
    title: `[DEMO] ${DEMO_MARKER} - Noise Disturbance (Administrative, Normal)`,
    description: `[DEMO] ${DEMO_MARKER}. Repeated late-night noise from neighboring establishment causing disturbance to sleep and peace of neighborhood.`,
    category: "Administrative",
    urgency: "Normal",
    complaint_nature: "two_party_dispute",
    respondent_status: "identified",
    respondent_display_name: "DEMO - Lucky Seven Sari-Sari Store (Representative)",
    incident_location: "DEMO - Purok 5, Barangay Abuno, Iligan City",
    desired_relief: "DEMO - Compliance with barangay noise ordinance",
    status: "In Progress",
    stage: "Mediation",
    routing_status: "kp_mediation",
    filing_channel: "resident_portal",
    source: "resident_portal",
    has_hearing: true,
    has_pangkat: false,
    has_settlement: false,
    has_cfa: false,
    has_pnp: false,
  },
  {
    ref: "AB-2026-9006",
    title: `[DEMO] ${DEMO_MARKER} - Unlawful Construction Obstruction (Administrative, High)`,
    description: `[DEMO] ${DEMO_MARKER}. Construction activities blocking public access/pathway without proper clearance. Affects multiple residents.`,
    category: "Administrative",
    urgency: "High",
    complaint_nature: "two_party_dispute",
    respondent_status: "identified",
    respondent_display_name: "DEMO - Pedro Mangubat",
    incident_location: "DEMO - Purok 2, Barangay Abuno, Iligan City",
    desired_relief: "DEMO - Removal of obstruction and compliance",
    status: "Awaiting Meeting",
    stage: "Pangkat Formation",
    routing_status: "pangkat_conciliation",
    filing_channel: "staff_assisted",
    source: "staff_assisted",
    has_hearing: true,
    has_pangkat: true,
    has_settlement: false,
    has_cfa: false,
    has_pnp: false,
  },
  {
    ref: "AB-2026-9007",
    title: `[DEMO] ${DEMO_MARKER} - Loan Dispute with Amicable Settlement (Civil, Normal)`,
    description: `[DEMO] ${DEMO_MARKER}. Loan agreement dispute where parties have reached preliminary agreement to settle. Suitable for amicable settlement documentation.`,
    category: "Civil",
    urgency: "Normal",
    complaint_nature: "two_party_dispute",
    respondent_status: "identified",
    respondent_display_name: "DEMO - Liza Fernandez",
    incident_location: "DEMO - Purok 6, Barangay Abuno, Iligan City",
    desired_relief: "DEMO - Formalize amicable settlement",
    status: "Resolved",
    stage: "Resolved",
    routing_status: "resolved_at_intake",
    filing_channel: "barangay_hall",
    source: "staff_assisted",
    has_hearing: true,
    has_pangkat: false,
    has_settlement: true,
    has_cfa: false,
    has_pnp: false,
  },
  {
    ref: "AB-2026-9008",
    title: `[DEMO] ${DEMO_MARKER} - Damages Dispute with CFA (Civil, High)`,
    description: `[DEMO] ${DEMO_MARKER}. Property damage dispute where settlement failed or repudiation considerations apply. Case requires Certificate to File Action (CFA) per process - NOT auto-issued.`,
    category: "Civil",
    urgency: "High",
    complaint_nature: "two_party_dispute",
    respondent_status: "identified",
    respondent_display_name: "DEMO - Carlos Mendoza",
    incident_location: "DEMO - Purok 7, Barangay Abuno, Iligan City",
    desired_relief: "DEMO - Appropriate remedy; may require CFA if settlement conditions not met",
    status: "In Progress",
    stage: "Pangkat Formation",
    routing_status: "pangkat_conciliation",
    filing_channel: "staff_assisted",
    source: "staff_assisted",
    has_hearing: true,
    has_pangkat: true,
    has_settlement: true,
    has_cfa: true,
    has_pnp: false,
  },
];

async function main() {
  console.log("=== SEED SCRIPT - DRY RUN MODE ===");
  console.log(`Target: Riza Oyangorin (${RIZA_PROFILE_ID})`);
  console.log(`Demo marker: ${DEMO_MARKER}`);
  console.log(`Cases to create: ${cases.length}`);
  console.log("\nThis script will NOT execute database writes without explicit approval.");
  console.log("Review the cases above and the SQL/script before proceeding.");
}

main();
