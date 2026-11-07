/**
 * Static sample content for the landing page.
 * All data here is purely presentational and will be replaced by
 * Supabase reads in a future phase. Keep UI components untouched
 * when connecting the database — only this file (and the future
 * data-service layer) should change.
 */

// Hero dashboard — submitted complaints shown in the mockup.
export const heroFeedRows = [
  {
    title: "Loud videoke, past midnight",
    channel: "via Mobile",
    urgency: "Normal",
    meta: "Noise Disturbance",
  },
  {
    title: "Domestic dispute, Purok 3",
    channel: "via Kiosk",
    urgency: "Critical",
    meta: "Domestic Dispute",
  },
  {
    title: "Reported theft, livestock",
    channel: "via Web",
    urgency: "High",
    meta: "Theft",
  },
  {
    title: "Boundary dispute, Purok 5",
    channel: "via Kiosk",
    urgency: "Normal",
    meta: "Boundary Dispute",
  },
];

// Small white cards that float around the dashboard mockup.
export const liveCaseFeed = [
  { title: "Loud videoke, past midnight", channel: "via Mobile", urgency: "Normal" },
  { title: "Domestic dispute, Purok 3", channel: "via Kiosk", urgency: "Critical" },
  { title: "Reported theft, livestock", channel: "via Web", urgency: "High" },
];

export const filingChannels = [
  "Resident Web Portal",
  "Mobile-Friendly Site",
  "On-Site Kiosk",
];

export const offlineCard = {
  title: "Offline-safe",
  body: "A local queue keeps recording complaints during outages, auto-syncing to the database once reconnected.",
};

// Tech strip — "built with" logos rendered as styled text.
export const techStack = [
  "React.js",
  "Node.js",
  "Supabase",
  "Naive Bayes",
  "SQLite",
];

// Features grid (8 cards).
export const features = [
  {
    icon: "Globe",
    title: "File Any Way",
    description:
      "Register and file complaints through the web portal, a mobile-friendly site, or the on-site kiosk — no paperwork required.",
  },
  {
    icon: "Paperclip",
    title: "Evidence Attachment",
    description:
      "Attach photos and supporting files to your complaint, captured with the kiosk camera or uploaded from a phone.",
  },
  {
    icon: "ScanText",
    title: "Automatic Categorization",
    description:
      "A Naive Bayes engine reads the narrative and suggests the right case category instantly.",
  },
  {
    icon: "Gauge",
    title: "Urgency Prediction",
    description:
      "Each complaint is scored for urgency — normal, high, or critical — so officials can act faster.",
  },
  {
    icon: "Route",
    title: "Complaint Tracking",
    description:
      "Follow every stage of your case, from filing to settlement, on a simple status page.",
  },
  {
    icon: "CalendarClock",
    title: "Hearing & Summons Updates",
    description:
      "Get notified by SMS and in-app when a summons is issued and a hearing is scheduled.",
  },
  {
    icon: "BookOpen",
    title: "Blotter & Case Records",
    description:
      "Authorized staff keep blotter entries and case records in one searchable digital file.",
  },
  {
    icon: "ChartColumnBig",
    title: "Reports & Analytics",
    description:
      "Officials get summaries and analytics that make barangay decisions clearer.",
  },
];

// Navy gradient stat cards under the features grid.
export const featureStats = [
  {
    value: "5",
    label: "User roles served: Residents, Captain/OIC, Secretary, and Lupon members",
  },
  {
    value: "6",
    label:
      "ISO 9126 quality dimensions evaluated: functionality, reliability, usability, efficiency, maintainability, portability",
  },
];

// Commitments cards.
export const commitments = [
  {
    icon: "ShieldCheck",
    title: "Data Privacy",
    description:
      "Complaint and blotter records are managed under role-based access control, designed in line with the Data Privacy Act of 2012 (RA 10173).",
  },
  {
    icon: "Lock",
    title: "Role-Based Access",
    description:
      "Residents, the Captain/OIC, the Secretary, and Lupon members each see only what their role requires.",
  },
  {
    icon: "Eye",
    title: "Transparent Tracking",
    description:
      "Residents can follow their own case at every step — from filing through resolution and issued documents.",
  },
  {
    icon: "HeartHandshake",
    title: "Accessible Service",
    description:
      "No smartphone or internet? The on-site kiosk still lets anyone file and track a complaint.",
  },
  {
    icon: "Scale",
    title: "Responsible AI Support",
    description:
      "The AI recommends — authorized barangay officials verify and confirm every classification before it becomes final.",
  },
];

// Responsible-AI statement bullets shown under the commitments cards.
export const aiStatementPoints = [
  "AI recommends classifications and urgency levels.",
  "Authorized barangay officials verify and confirm the results.",
  "The system does not automatically determine guilt or the truth of an allegation.",
  "Critical complaints may display an advisory note for officials.",
  "Police coordination remains a manual, off-system activity.",
];

// Research basis stat cards. `isPlaceholder` marks unverified citations
// that must be swapped for real sources before final presentation.
export const researchStats = [
  {
    metric: "88—95%",
    description:
      "Classification accuracy reported by comparable NLP complaint systems.",
    placeholderNote: "Placeholder citation — replace with a verified source.",
  },
  {
    metric: "Jan—Jun 2026",
    description: "Development and pilot period with Barangay Abuno Hall, Iligan City.",
    placeholderNote: null,
  },
  {
    metric: "3",
    description: "Filing channels — web, mobile, and on-site kiosk.",
    placeholderNote: null,
  },
  {
    metric: "6+",
    description:
      "Case types classified, mapped to criminal, civil, or administrative categories.",
    placeholderNote: null,
  },
];

// FAQ items for the accordion.
export const faqs = [
  {
    question: "Who can file a complaint?",
    answer:
      "Anyone can file a complaint through the web portal, a mobile-friendly site, or the on-site kiosk at the barangay hall. Residents of Barangay Abuno are the primary users. Once filed, an authorized official reviews the entry before the case is officially processed.",
  },
  {
    question: "How does automatic categorization work?",
    answer:
      "The narrative text of a complaint is passed through a TF-IDF vectorizer and a Naive Bayes classifier trained on prior barangay case text. The model suggests a case type and the legal category (criminal, civil, or administrative) it maps to. The suggestion is always verifiable — an official confirms or corrects it before it becomes final.",
  },
  {
    question: "How does the system determine urgency?",
    answer:
      "The NLP engine assigns an urgency level — critical, high, or normal — along with a confidence score that is never shown to the public. Critical cases are flagged for the Barangay Captain or OIC's attention on the dashboard, but only an authorized official can confirm the final urgency level.",
  },
  {
    question: "Can residents submit evidence?",
    answer:
      "Yes. Photos and supporting files can be attached when filing — uploaded from a phone, or captured with the kiosk camera for residents without a device. Evidence is stored per case and can only be viewed by roles involved in that case.",
  },
  {
    question: "How are residents notified?",
    answer:
      "Residents receive SMS and in-app notifications for key events: confirmation of filing, a scheduled hearing, the issuance of a summons, and the outcome of mediation. Notification details will be finalized when the messaging service is integrated in a later phase.",
  },
  {
    question: "What happens during mediation?",
    answer:
      "A hearing is scheduled by the Barangay Captain or OIC, and the Lupon handles the proceedings. Minutes and attendance are recorded in the system. The case ends in an amicable settlement, a certificate to file action, or escalation — and the resident is notified of the outcome.",
  },
  {
    question: "Is resident information protected?",
    answer:
      "Yes. Complaint and blotter records are managed under role-based access control, and access is limited to the roles that need it — consistent with the principles of the Data Privacy Act of 2012 (RA 10173). Residents only ever see their own case.",
  },
  {
    question: "Is the kiosk available without internet access?",
    answer:
      "Yes. A local queue keeps recording complaint entries at the kiosk even during an outage. A scheduler automatically synchronizes them with the main database once the connection is restored.",
  },
];

// Footer link columns. `href: null` marks pages that do not exist yet;
// they render as a button that shows a "coming soon" toast.
export const footerColumns = [
  {
    title: "Residents",
    links: [
      { label: "File a Complaint", href: "/register" },
      { label: "Track My Case", href: null },
      { label: "Hearings & Summons", href: null },
      { label: "Help Center", href: null },
    ],
  },
  {
    title: "Officials",
    links: [
      { label: "Captain / OIC Dashboard", href: null },
      { label: "Secretary Tools", href: null },
      { label: "Lupon Case Access", href: null },
      { label: "Reports & Analytics", href: null },
    ],
  },
  {
    title: "System",
    links: [
      { label: "About the System", href: null },
      { label: "How It Works", href: null },
      { label: "Privacy Policy", href: null },
      { label: "Terms of Service", href: null },
      { label: "Contact Us", href: null },
    ],
  },
];

// Constants reused inside the dashboard mockup urgency pills.
export const urgencyStyles = {
  Normal: "bg-normal text-white",
  High: "bg-gold text-white",
  Critical: "bg-critical text-white",
};
