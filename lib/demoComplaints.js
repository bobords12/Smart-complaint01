// Local, read-only defense examples. These IDs are never Supabase complaint IDs.
// Both switches must be set at build time; only explicitly listed signed-in users see them.
export function demoComplaintsEnabledFor(user) {
  return process.env.NEXT_PUBLIC_DEMO_COMPLAINTS_ENABLED === "true" &&
    Boolean(user?.id) &&
    (process.env.NEXT_PUBLIC_DEMO_COMPLAINT_USER_IDS || "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
      .includes(user.id);
}

function sample(number, title, description, status, complainant, respondent, steps) {
  const id = `demo-26-${number}`;
  const day = number === "001" ? 1 : number === "002" ? 8 : 15;
  return {
    id,
    isDemo: true,
    reference_number: `DEMO-26-${number}`,
    title,
    description,
    current_status: status,
    current_stage: status,
    confirmed_category: "Civil",
    confirmed_urgency: "Normal",
    complaint_nature: "two_party_dispute",
    respondent_status: "identified",
    respondent_name: respondent,
    persons_involved: respondent,
    profiles: { display_name: complainant },
    complainantName: complainant,
    submitted_at: `2026-09-${String(day).padStart(2, "0")}T09:00:00+08:00`,
    timeline: steps.map((label, index) => ({
      id: `${id}-step-${index + 1}`,
      label,
      at: `2026-09-${String(day + index).padStart(2, "0")}T09:00:00+08:00`,
    })),
  };
}

export const demoComplaints = [
  {
    ...sample("001", "Noise Disturbance Complaint",
      "The complainant reports repeated loud music and disturbances from a neighboring household during nighttime hours.",
      "Under Mediation", "Maya Santos", "Nico Rivera", [
        "Complaint Filed", "Complaint Reviewed", "Initial Mediation Scheduled", "Under Mediation",
      ]),
    routing_status: "kp_mediation",
  },
  {
    ...sample("002", "Property Fence Dispute",
      "The complainant reports a disagreement with a neighboring household regarding a shared property fence.",
      "For Lupon/Pangkat Formation", "Lina Mercado", "Tomas Velasco", [
        "Complaint Filed", "Complaint Reviewed", "Initial Mediation Conducted",
        "No Settlement Reached", "For Pangkat Formation",
      ]),
    routing_status: "pangkat_conciliation",
  },
  {
    ...sample("003", "Unpaid Personal Loan Complaint",
      "The complainant reports an unpaid personal loan despite previous attempts to reach an agreement.",
      "CFA Issued", "Iris Navarro", "Paolo Mendoza", [
        "Complaint Filed", "Complaint Reviewed", "Initial Mediation Conducted",
        "No Settlement Reached", "Pangkat Conciliation Conducted",
        "Conciliation Unsuccessful", "Certificate to File Action Issued",
      ]),
    routing_status: "closed",
  },
];

export function getDemoComplaint(id) {
  return demoComplaints.find((complaint) => complaint.id === id) || null;
}
