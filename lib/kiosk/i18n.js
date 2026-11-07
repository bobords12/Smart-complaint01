/**
 * Centralised EN / PIL dictionary for the public kiosk.
 *
 * Two languages only, never three: English and Filipino. `format.js`
 * pins its Intl locale to en-PH / fil-PH for the same reason, because a
 * kiosk machine set to a Cebuano locale is how Cebuano quietly creeps
 * into a system the specification says must not contain it.
 *
 * Every validator returns a KEY from this dictionary rather than a
 * finished sentence (see validation.js), which is what allows a language
 * switch to re-render error text without re-running validation and
 * without the citizen losing anything they typed.
 *
 * Keys are grouped by screen so a translator can work one screen at a
 * time. Several screens deliberately render BOTH languages at once, such
 * as welcome.title / welcome.subtitle, which is why a few pairs are
 * mirrored between the en and pil objects rather than being one string.
 */
export const LANGUAGES = [
  { code: "en", label: "EN" },
  { code: "pil", label: "PIL" },
];
export const DEFAULT_LANGUAGE = "en";

const en = {
  // ── Screen-reader announcements ──────────────────────────────
  "a11y.languageSwitch": "Switch language",
  "a11y.progress": "Filing progress",
  "a11y.stepOf": "Step {n} of {total}",
  "a11y.timelineProgress": "Complaint progress",

  // ── Screen 1 — Welcome ───────────────────────────────────────
  "brand.barangay": "BARANGAY ABUNO",
  "brand.hall": "BARANGAY ABUNO HALL",
  "brand.kiosk": "PUBLIC KIOSK PORTAL",
  "brand.noAccount": "No Account Required",
  "brand.noAccountPil": "Walang Account na Kailangan",
  "brand.location": "Barangay Abuno Hall, Iligan City",
  "welcome.title": "File a Complaint",
  "welcome.subtitle": "Mag-file ng Reklamo",
  "welcome.description":
    "File a barangay complaint on your own. Answer a few questions and print your receipt.",
  "welcome.cta": "Tap to Begin",
  "welcome.ctaPil": "Pindutin Upang Magsimula",
  "welcome.status": "Track Your Complaint",
  "welcome.statusPil": "Subaybayan ang Iyong Reklamo",
  "welcome.advisory":
    "This kiosk is not an emergency-response service. For an emergency, go to the barangay hall front desk or contact the proper emergency authority.",
  "welcome.sealAlt": "Barangay Abuno seal",

  // ── Screen 2 — Three-phase introduction ─────────────────────
  // These three cards are a summary of the seven steps, NOT a
  // replacement for them, and the progress bar is hidden here.
  "intro.title": "3 Easy Steps to File a Complaint",
  "intro.subtitle": "3 Madaling Hakbang para Maghain ng Reklamo",
  "intro.phase1": "Tell us who you are",
  "intro.phase1Pil": "We will ask for your name, mobile number and address.",
  "intro.phase2": "Describe the incident",
  "intro.phase2Pil": "Tell us what happened, where and when.",
  "intro.phase3": "Review and submit",
  "intro.phase3Pil": "Check your answers, then file your complaint.",
  "intro.nextAction": "What you will need",
  "intro.nextActionPil":
    "Your full name, an active mobile number, your address, and a short description of what happened.",

  // ── Screen 3 — Account or guest ──────────────────────────────
  "account.title": "Do you have an account?",
  "account.subtitle": "May account ka ba?",
  "account.yes": "Yes — look up my details",
  "account.yesHint": "Use your mobile number to fill in your details faster.",
  "account.no": "No — continue as guest",
  "account.noHint": "File as a walk-in. No account, no password.",
  "account.lookupUnavailable":
    "Mobile verification is not available yet. Please continue as a guest.",
  "account.lookupTitle": "Look up your details",
  "account.lookupHelp":
    "Enter the mobile number you gave when you filed before. We will send a one-time code to confirm the number belongs to you.",
  "account.lookupContinue": "Continue as guest instead",

  // ── Step 1 — Identity ────────────────────────────────────────
  "identity.title": "Your Details",
  "identity.subtitle": "Tell us who you are.",
  "identity.firstName": "First name",
  "identity.middleName": "Middle name",
  "identity.lastName": "Last name",
  "identity.suffix": "Suffix",
  "identity.mobile": "Mobile number",
  "identity.mobileHelp": "Used only to contact you about this complaint.",
  "identity.address": "House number and street",
  "identity.purok": "Purok",
  "identity.barangay": "Barangay",
  "identity.city": "City",
  "identity.errorSummary": "Please fix the following:",

  // ── Step 2 — Confirm details ─────────────────────────────────
  "confirm.title": "Confirm Your Details",
  "confirm.subtitle": "Please check before you continue.",
  "confirm.name": "Full Name",
  "confirm.mobile": "Mobile Number",
  "confirm.address": "Complete Address",
  "confirm.edit": "Edit",
  // Deliberately says a confirmation MAY be sent and that status
  // updates may follow. The SMS is only a queued job until the
  // provider accepts it, so the kiosk never claims a message was
  // delivered.
  "confirm.notice":
    "A confirmation and any status updates may be sent to this mobile number. Your details are used only to process this complaint.",

  // ── Step 3 — Other party ─────────────────────────────────────
  "otherParty.title": "Other Party",
  "otherParty.subtitle": "Is there someone on the other side?",
  "otherParty.known": "Known Person",
  "otherParty.unknown": "Unknown or Not Identified",
  "otherParty.none": "No Other Party Applicable",
  "otherParty.name": "Name",
  "otherParty.address": "Address, if known",
  "otherParty.purok": "Purok, if known",
  "otherParty.relationship": "Relationship to you",
  "otherParty.contact": "Contact number, if available",
  "otherParty.unknownNote":
    "We will not require a name. If you can, describe what the person looked like or was wearing.",
  "otherParty.noneNote":
    "Some complaints are about a service, a facility, or the barangay's own process. Choose this if no other person is involved.",

  // ── Step 4 — Incident details ────────────────────────────────
  "incident.title": "Incident Details",
  "incident.subtitle": "When and where did it happen?",
  "incident.date": "Date of incident",
  "incident.time": "Time of incident",
  "incident.location": "Specific location",
  "incident.purok": "Purok",
  "incident.ongoing": "Is it still happening now?",
  "incident.immediate": "Is there an immediate safety concern?",
  // The most safety-relevant string in the kiosk: this kiosk does not
  // dispatch anybody.
  "incident.emergency":
    "This kiosk does not send help. If anyone is in danger, go to the barangay hall front desk or contact the proper emergency authority now.",

  // ── Step 5 — Complaint narrative ─────────────────────────────
  "narrative.title": "What happened?",
  "narrative.subtitle": "Ano ang nangyari?",
  "narrative.label": "Tell us what happened",
  "narrative.helper":
    "Include dates, names and places if you can. You may use up to 5,000 characters.",
  "narrative.counter": "characters",
  "narrative.speak": "Speak",
  // Shown only when the browser genuinely lacks Web Speech support, so
  // the button is never a dead control.
  "narrative.speakUnsupported":
    "Speech input is not available on this device. Please type instead.",

  // ── Step 6 — Evidence ────────────────────────────────────────
  "evidence.title": "Add Evidence",
  "evidence.subtitle": "Optional — you can file without it.",
  "evidence.qr": "Scan to Upload",
  "evidence.qrHint": "Use your phone to send a photo or file to this kiosk.",
  "evidence.skip": "Skip Evidence",
  "evidence.skipHint": "Submit without attaching anything.",
  "evidence.optionalNote":
    "Evidence is optional. You can skip this step and still file your complaint.",

  // ── QR evidence upload ───────────────────────────────────────
  "qr.title": "Scan to Upload Evidence",
  "qr.instructions":
    "Scan this QR code with your phone, then choose a photo or file to send to the kiosk.",
  "qr.privacyNote":
    "This QR code contains a temporary secure code only. It does not include your name, address, or complaint details.",
  "qr.expiresIn": "This code expires in",
  "qr.expired": "This QR code has expired.",
  "qr.waiting": "Waiting for files",
  "qr.received": "file received",
  "qr.filesReceived": "files received",
  "qr.help":
    "You can close this page on your phone and return to the kiosk at any time.",
  "qr.copyLink": "Copy Link",
  "qr.openLink": "Open Link",
  "qr.linkCopied": "Link copied.",
  "qr.copyFailed": "Could not copy. Please select the link below manually.",

  // ── Screen 11 — Evidence received ────────────────────────────
  "received.title": "Evidence Received",
  "received.count": "file",
  "received.empty": "No files have arrived yet.",
  "received.addMore": "Add More",
  "received.review": "Review and Submit",

  // ── Screen 12 — Reviewing transition ─────────────────────────
  "reviewing.title": "Got It — Reviewing Your Complaint",
  "reviewing.subtitle": "Your complaint has been received by this kiosk.",

  // ── Step 7 — Review and submit ───────────────────────────────
  "review.title": "Review and Submit",
  "review.subtitle": "Check everything before you send it.",
  "review.complainant": "Complainant",
  "review.contact": "Contact",
  "review.address": "Address",
  "review.otherParty": "Other party",
  "review.incident": "Incident",
  "review.narrative": "Your statement",
  "review.evidence": "Evidence",
  "review.noEvidence": "No evidence attached.",
  "review.privacyLabel":
    "I understand my details will be used to process this complaint, and that this screen clears when I finish.",
  "review.confirmLabel":
    "I confirm the information above is correct and ready to submit.",
  "review.submitNote":
    "Submitting sends your complaint to the barangay for review. It is not yet an official case number or blotter entry.",

  // ── Screens 14/18 — Success and status ───────────────────────
  "success.title": "Complaint Filed Successfully",
  "success.tracking": "Complaint Tracking Number",
  "success.statusQr": "Your Complaint Status QR Code",
  "success.statusQrHint":
    "Scan this QR code anytime to check the status of your complaint.",
  "success.statusQrAction": "Track Your Complaint",
  "success.print": "Print Receipt",
  "success.done": "Done",
  "success.disclaimer":
    "This receipt confirms that the complaint was received. It is not yet an official Barangay Case Number, Barangay Blotter Entry, PNP Blotter Number, or Certificate to File Action.",
  "success.nextSteps":
    "Next: the Captain, OIC or Secretary will review your complaint. You can scan the QR code above, or use your tracking number and mobile number, to check the status at any time.",
  "success.notice":
    "Thank you. Please go to the front desk if you have questions about your complaint.",
  "success.smsQueued":
    "Your complaint was successfully submitted. SMS confirmation is being processed to the mobile number you provided.",
  "success.evidencePartial":
    "Your complaint was filed and the tracking number above is valid, but only {linked} of your {expected} uploaded file(s) were attached — the upload link expired before submission. Please approach the front desk so barangay staff can help attach your remaining evidence.",

  // ── Screen 15 — Manual status lookup ─────────────────────────
  "status.title": "Check Complaint Status",
  "status.subtitle": "Enter your details, or scan the QR code on your receipt.",
  "status.tracking": "Tracking number",
  "status.mobile": "Mobile number",
  "status.search": "Search",
  // One message for a wrong tracking number, a wrong mobile number, and
  // a combination that never existed: telling a stranger which half was
  // right is the leak this design refuses.
  "status.notFound":
    "Complaint Not Found. Please check your tracking number and mobile number.",
  "status.invalidLink": "Invalid or incomplete QR link.",
  "status.returnHome": "Return to Kiosk Home",
  "status.filed": "Date filed",
  "status.caseNumber": "Barangay Case No.",
  "status.caseNumberPending": "Not yet assigned",
  "status.lastUpdated": "Last updated",
  "status.category": "Category",
  "status.urgency": "Urgency",
  "status.nextAction": "Current status / next step",
  "status.resultNotYet":
    "No official has confirmed a status for this complaint yet.",
  "status.pendingSync": "Saved on Kiosk — Pending Sync",
  "status.pendingSyncHelp":
    "This complaint is saved on the kiosk and will be sent to the barangay when the connection returns. The same QR code will show the final status after that.",

  // ── QR status scanning ───────────────────────────────────────
  "status.scanQr": "Scan Complaint QR Code",
  "status.scanQrPil": "I-scan ang QR Code ng Reklamo",
  "qr.scanQrTitle": "Scan Your Complaint QR Code",
  "qr.scanQrHint": "Place the QR code inside the scanning frame.",
  "qr.scanStart": "Start Camera",
  "qr.scanUnsupported":
    "This browser cannot scan QR codes. You can still check your status using your tracking number and mobile number.",
  "qr.scanned": "QR Code Scanned Successfully",
  "qr.invalidQr": "Invalid Complaint QR Code",
  "qr.notFoundQr": "Complaint Not Found",
  "qr.revokedQr": "This QR code is no longer available.",

  // ── Screen 18b — Complaint tracking guidance ─────────────────
  "track.title": "Track Your Complaint",
  "track.subtitle": "Subaybayan ang Iyong Reklamo",
  "track.intro":
    "Use the QR code on your receipt to follow your complaint from filing to resolution. The same code works for the whole life of the complaint.",
  "track.qrTitle": "Use the QR code on your receipt",
  "track.qrBody":
    "Scan the QR code with your own phone. It opens a page that shows your complaint's current status, progress, and any scheduled hearing.",
  "track.phoneTitle": "This kiosk does not scan codes",
  "track.phoneBody":
    "To protect your privacy, the kiosk never scans your receipt. Scan it with your phone, or keep the receipt and use your tracking number at the front desk.",
  "track.slipTitle": "Keep your receipt",
  "track.slipBody":
    "Your receipt shows your tracking number and the QR code. Keep it safe; it is the only copy. You can print another copy now from the success screen after filing.",
  "track.lostTitle": "Lost your receipt or QR code?",
  "track.lostBody":
    "For your protection there is no online recovery. Please go to the Barangay Abuno Hall front desk and ask the staff for help with your complaint.",
  "track.officeNote":
    "The Barangay Abuno Hall front desk can look up your complaint if you filed it here.",
  "track.start": "File a New Complaint",
  "track.back": "Back to Kiosk Home",

  // ── Screen 18 — Status timeline ──────────────────────────────
  "timeline.caseSummary": "Case summary",
  "timeline.caseDetails": "Case details",
  "timeline.currentStage": "Current stage",
  "timeline.reached": "Reached",
  "timeline.notReached": "Not reached",
  "timeline.noConfirmedYet": "Not confirmed yet",
  "timeline.mediationCard": "Mediation period",
  "timeline.mediationDeadline": "Period ends",
  "timeline.hearingCard": "Next hearing",
  "timeline.hearingDate": "Date",
  "timeline.hearingTime": "Time",
  "timeline.hearingStatus": "Status",
  "timeline.hearingVenue": "Venue",
  "timeline.privacyNotice":
    "This page shows only information approved for residents. Internal notes, other people's details, and private evidence are not shown.",

  // Stage labels. Which of these are shown is decided by the database
  // (is_kp_case plus other_party_status), never by this file.
  "timeline.stage.filed": "Complaint Filed",
  "timeline.stage.reviewed": "Reviewed and Approved",
  "timeline.stage.summons": "Summons Issued",
  "timeline.stage.mediation": "In Mediation",
  "timeline.stage.settlement": "Settlement or Escalation",
  "timeline.stage.underReview": "Under Review",
  "timeline.stage.routing": "Routing Confirmed",
  "timeline.stage.linked": "Blotter Linked or Referred",
  "timeline.stage.closed": "Completed or Closed",

  // ── Resident documents ───────────────────────────────────────
  "docs.title": "Your Documents",
  "docs.intro": "Documents the barangay has shared with you about this complaint.",
  "docs.open": "View",
  "docs.unavailable": "This document is not available right now.",
  "docs.type.reklamo_form": "Reklamo Form (Submitted Copy)",
  "docs.type.signed_reklamo_form": "Reklamo Form (Signed)",
  "docs.type.hearing_notice": "Notice of Hearing",
  "docs.type.other": "Document",

  // ── Screen 16 — Offline ──────────────────────────────────────
  "offline.savedTitle": "Saved on Kiosk — Pending Sync",
  "offline.banner": "Saved on Kiosk — Pending Sync",
  "offline.bannerPil": "Naka-save sa kiosk, ipapadala kapag bumalik ang internet",
  "offline.synced": "Sent to the barangay",
  "offline.syncing": "Sending your complaint...",
  "offline.syncFailed":
    "We could not send your complaint yet. It is still saved on this kiosk.",
  "offline.pendingStatus": "Pending sync",
  "offline.reference": "Offline reference",
  "offline.savedAt": "Saved at",
  "offline.pendingNotice":
    "This is not yet an official complaint number. The barangay has not received your complaint yet.",
  "offline.instructions":
    "You may leave the kiosk. Your complaint will be sent automatically when the connection returns.",
  "offline.queuedHidden":
    "This reference will not be shown again once your complaint has been sent.",

  // ── Screen 17 — Inactivity ───────────────────────────────────
  "inactivity.title": "Are you still there?",
  "inactivity.subtitle": "Nandito ka pa ba?",
  "inactivity.stillHere": "I'm Still Here",
  "inactivity.stillHerePil": "Nandito Pa Ako",
  "inactivity.seconds": "seconds",

  // ── Shared navigation ────────────────────────────────────────
  "nav.back": "Back",
  "nav.continue": "Continue",
  "nav.submit": "Submit",
  "nav.search": "Search",
  "nav.start": "Start",
  "nav.review": "Review",
  "nav.skip": "Skip",
  "nav.edit": "Edit",
  "nav.done": "Done",
  "nav.print": "Print Receipt",
  "nav.cancel": "Cancel",
  "nav.close": "Close",
  "nav.main": "Main Screen",

  // ── Shared words ─────────────────────────────────────────────
  "common.yes": "Yes",
  "common.no": "No",
  "common.optional": "Optional",
  "common.of": "of",
  "common.step": "Step",
  "common.hakbang": "Hakbang",
  "common.loading": "Loading",
  "common.retry": "Try Again",
  "common.remove": "Remove",
  "common.files": "files",

  // ── Connection state ─────────────────────────────────────────
  "net.online": "Online",
  "net.offline": "Offline",
  "net.reconnecting": "Connecting",

  // ── Validation and submission errors ─────────────────────────
  "err.required": "This field is required.",
  "err.fullName": "Please enter your full name.",
  "err.mobile": "Enter a valid mobile number (09XX XXX XXXX).",
  "err.address": "Please enter your complete address.",
  "err.purok": "Please enter your purok.",
  "err.otherParty": "Please choose one of the options.",
  "err.respondentName": "Please enter the other party's name.",
  "err.incidentDate": "Please enter the date of the incident.",
  "err.incidentDateInvalid": "Please enter a valid date.",
  "err.incidentDateFuture": "The incident date cannot be in the future.",
  "err.incidentTime": "Please enter the time of the incident.",
  "err.incidentLocation": "Please enter where it happened.",
  "err.incidentPurok": "Please enter the purok where it happened.",
  "err.incidentOngoing": "Please answer yes or no.",
  "err.incidentImmediate": "Please answer yes or no.",
  "err.narrative": "Please describe what happened.",
  "err.narrativeShort": "Please add a little more detail.",
  "err.narrativeLong": "Your description is too long. Please shorten it.",
  "err.consentPrivacy": "Please confirm the privacy notice.",
  "err.consentAccuracy": "Please confirm your complaint is ready to submit.",
  "err.fileType": "Only JPG, PNG, WebP, or PDF files are accepted.",
  "err.fileSize": "Each file must be 10 MB or smaller.",
  "err.fileCount": "You can attach up to 5 files.",
  "err.fileFailed": "The file could not be uploaded. Please try again.",
  "err.submitting": "Submitting...",
  "err.submitFailed": "Complaint could not be submitted. Please try again.",
  "err.network":
    "Unable to connect. Please check your connection and try again.",
  "err.lookupUnavailable":
    "Unable to retrieve complaint status. Please try again.",
  "err.rateLimited": "Too many attempts. Please wait a moment and try again.",
  "err.quota":
    "This kiosk's offline storage is full. Please ask a staff member for help.",
  "err.linkExpired":
    "This QR code has expired. Please generate a new one at the kiosk.",
  "err.camera": "Camera access is required to scan the QR code.",
  "err.sessionUnavailable":
    "This kiosk cannot start a secure filing session right now. Please ask a staff member for help.",
};

const pil = {
  // ── Screen-reader announcements ──────────────────────────────
  "a11y.languageSwitch": "Palitan ang wika",
  "a11y.progress": "Progreso ng pag-file",
  "a11y.stepOf": "Hakbang {n} ng {total}",
  "a11y.timelineProgress": "Progreso ng reklamo",

  // ── Screen 1 — Welcome ───────────────────────────────────────
  "brand.barangay": "BARANGAY ABUNO",
  "brand.hall": "BARANGAY ABUNO HALL",
  "brand.kiosk": "PUBLIC KIOSK PORTAL",
  "brand.noAccount": "Walang Account na Kailangan",
  "brand.noAccountPil": "No Account Required",
  "brand.location": "Barangay Abuno Hall, Lungsod ng Iligan",
  "welcome.title": "Mag-file ng Reklamo",
  "welcome.subtitle": "File a Complaint",
  "welcome.description":
    "Mag-file ng reklamo sa barangay nang mag-isa. Sagutin ang ilang tanong at i-print ang iyong resibo.",
  "welcome.cta": "Pindutin Upang Magsimula",
  "welcome.ctaPil": "Tap to Begin",
  "welcome.status": "Subaybayan ang Iyong Reklamo",
  "welcome.statusPil": "Track Your Complaint",
  "welcome.advisory":
    "Ang kiosk na ito ay hindi serbisyo pang-emergency. Kung may emergency, pumunta sa front desk ng barangay hall o makipag-ugnayan sa tamang awtoridad.",
  "welcome.sealAlt": "Selyo ng Barangay Abuno",

  // ── Screen 2 — Three-phase introduction ─────────────────────
  "intro.title": "3 Madaling Hakbang para Maghain ng Reklamo",
  "intro.subtitle": "3 Easy Steps to File a Complaint",
  "intro.phase1": "Sabihin sa amin kung sino ka",
  "intro.phase1Pil": "Hihingiin namin ang iyong pangalan, mobile number at address.",
  "intro.phase2": "Ilarawan ang insidente",
  "intro.phase2Pil": "Sabihin sa amin kung ano ang nangyari, saan at kailan.",
  "intro.phase3": "Suriin at isumite",
  "intro.phase3Pil": "Suriin ang iyong sagot, pagkatapos ay i-file ang iyong reklamo.",
  "intro.nextAction": "Kailangan mo",
  "intro.nextActionPil":
    "Ang iyong buong pangalan, aktibong mobile number, address, at maikling paglalarawan ng nangyari.",

  // ── Screen 3 — Account or guest ──────────────────────────────
  "account.title": "May account ka ba?",
  "account.subtitle": "Do you have an account?",
  "account.yes": "Oo — hanapin ang aking detalye",
  "account.yesHint":
    "Gamitin ang iyong mobile number para mas mabilis na punan ang iyong detalye.",
  "account.no": "Hindi — magpatuloy bilang bisita",
  "account.noHint": "Mag-file bilang walk-in. Walang account, walang password.",
  "account.lookupUnavailable":
    "Wala pang mobile verification. Mangyaring magpatuloy bilang bisita.",
  "account.lookupTitle": "Hanapin ang iyong detalye",
  "account.lookupHelp":
    "Ilagay ang mobile number na ibinigay mo noon. Magpapadala kami ng one-time code upang kumpirmahin na sa iyo ang numerong iyon.",
  "account.lookupContinue": "Magpatuloy na lang bilang bisita",

  // ── Step 1 — Identity ────────────────────────────────────────
  "identity.title": "Ang Iyong Detalye",
  "identity.subtitle": "Sabihin sa amin kung sino ka.",
  "identity.firstName": "Unang pangalan",
  "identity.middleName": "Gitnang pangalan",
  "identity.lastName": "Huling pangalan",
  "identity.suffix": "Sufiks",
  "identity.mobile": "Mobile number",
  "identity.mobileHelp":
    "Ginagamit lamang para makipag-ugnayan sa iyo tungkol sa reklamong ito.",
  "identity.address": "Numero ng bahay at kalye",
  "identity.purok": "Purok",
  "identity.barangay": "Barangay",
  "identity.city": "Lungsod",
  "identity.errorSummary": "Pakisuri ang mga sumusunod:",

  // ── Step 2 — Confirm details ─────────────────────────────────
  "confirm.title": "Kumpirmahin ang Iyong Detalye",
  "confirm.subtitle": "Pakisuri bago ka magpatuloy.",
  "confirm.name": "Buong Pangalan",
  "confirm.mobile": "Mobile Number",
  "confirm.address": "Kumpletong Address",
  "confirm.edit": "I-edit",
  "confirm.notice":
    "Maaaring ipadala ang kumpirmasyon at ang mga update ng status sa mobile number na ito. Ginagamit lamang ang iyong detalye para iproseso ang reklamong ito.",

  // ── Step 3 — Other party ─────────────────────────────────────
  "otherParty.title": "Ibang Partido",
  "otherParty.subtitle": "Mayroon bang kasama sa kabilang panig?",
  "otherParty.known": "Kilalang Tao",
  "otherParty.unknown": "Hindi Alam o Hindi Natukoy",
  "otherParty.none": "Walang Ibang Partido na Saklaw",
  "otherParty.name": "Pangalan",
  "otherParty.address": "Address, kung alam",
  "otherParty.purok": "Purok, kung alam",
  "otherParty.relationship": "Kaugnayan sa iyo",
  "otherParty.contact": "Contact number, kung mayroon",
  "otherParty.unknownNote":
    "Hindi namin kailangan ang pangalan. Kung kaya, ilarawan ang anyo o damit ng tao.",
  "otherParty.noneNote":
    "May mga reklamo tungkol sa serbisyo, pasilidad, o proseso mismo ng barangay. Piliin ito kung walang ibang taong kasangkot.",

  // ── Step 4 — Incident details ────────────────────────────────
  "incident.title": "Detalye ng Insidente",
  "incident.subtitle": "Kailan at saan nangyari?",
  "incident.date": "Petsa ng insidente",
  "incident.time": "Oras ng insidente",
  "incident.location": "Tiyak na lokasyon",
  "incident.purok": "Purok",
  "incident.ongoing": "Naghihappang pa ba ito ngayon?",
  "incident.immediate": "May agarang alaga sa kaligtasan ba?",
  "incident.emergency":
    "Hindi nagpapadala ng tulog ang kiosk na ito. Kung may nanganganib, pumunta agad sa front desk ng barangay hall o makipag-ugnayan sa tamang awtoridad para sa emergency.",

  // ── Step 5 — Complaint narrative ─────────────────────────────
  "narrative.title": "Ano ang nangyari?",
  "narrative.subtitle": "What happened?",
  "narrative.label": "Sabihin sa amin kung ano ang nangyari",
  "narrative.helper":
    "Isama ang petsa, pangalan, at lugar kung kaya. Maaari kang gumamit ng hanggang 5,000 na karakter.",
  "narrative.counter": "karakter",
  "narrative.speak": "Magsalita",
  "narrative.speakUnsupported":
    "Hindi available ang voice input sa device na ito. Pakilagay na lamang.",

  // ── Step 6 — Evidence ────────────────────────────────────────
  "evidence.title": "Magdagdag ng Ebidensiya",
  "evidence.subtitle": "Opsyonal — maaari kang mag-file nang wala ito.",
  "evidence.qr": "I-scan para Mag-upload",
  "evidence.qrHint":
    "Gamitin ang iyong telepono para magpadala ng larawan o file sa kiosk na ito.",
  "evidence.skip": "Laktawan ang Ebidensiya",
  "evidence.skipHint": "Mag-submit nang walang naka-attach.",
  "evidence.optionalNote":
    "Ang ebidensiya ay opsyonal. Maaari mong laktawan ang hakbang na ito at mag-file pa rin.",

  // ── QR evidence upload ───────────────────────────────────────
  "qr.title": "I-scan para Mag-upload ng Ebidensiya",
  "qr.instructions":
    "I-scan ang QR code na ito gamit ang iyong telepono, pagkatapos ay pumili ng larawan o file na ipapadala sa kiosk.",
  "qr.privacyNote":
    "Ang QR code na ito ay may pansamantalang secure na code lamang. Wala rito ang iyong pangalan, address, o detalye ng reklamo.",
  "qr.expiresIn": "Nag-e-expire ang code na ito sa loob ng",
  "qr.expired": "Nag-expire na ang QR code na ito.",
  "qr.waiting": "Naghihintay ng mga file",
  "qr.received": "file ang natanggap",
  "qr.filesReceived": "file ang natanggap",
  "qr.help":
    "Maaari mong isara ang pahinang ito sa telepono at bumalik sa kiosk anumang oras.",
  "qr.copyLink": "Kopyahin ang Link",
  "qr.openLink": "Buksan ang Link",
  "qr.linkCopied": "Nakopya ang link.",
  "qr.copyFailed": "Hindi makopya. Piliin nang manu-mano ang link sa ibaba.",

  // ── Screen 11 — Evidence received ────────────────────────────
  "received.title": "Natanggap ang Ebidensiya",
  "received.count": "file",
  "received.empty": "Wala pang naiabot na file.",
  "received.addMore": "Magdagdag Pa",
  "received.review": "Suriin at Isumite",

  // ── Screen 12 — Reviewing transition ─────────────────────────
  "reviewing.title": "Naiintindihan Ko — Sinusuri ang Iyong Reklamo",
  "reviewing.subtitle": "Natanggap na ng kiosk na ito ang iyong reklamo.",

  // ── Step 7 — Review and submit ───────────────────────────────
  "review.title": "Suriin at Isumite",
  "review.subtitle": "Suriin ang lahat bago mo ito ipadala.",
  "review.complainant": "Nag-areklamo",
  "review.contact": "Kontak",
  "review.address": "Address",
  "review.otherParty": "Ibang partido",
  "review.incident": "Insidente",
  "review.narrative": "Ang iyong pahayag",
  "review.evidence": "Ebidensiya",
  "review.noEvidence": "Walang naka-attach na ebidensiya.",
  "review.privacyLabel":
    "Naiintindihan ko na gagamitin ang aking detalye para iproseso ang reklamong ito, at na malilinis ang screen na ito kapag tapos na ako.",
  "review.confirmLabel":
    "Kinukumpirma ko na tama ang impormasyon sa itaas at handa nang ipadala.",
  "review.submitNote":
    "Ang pag-submit ay ipapadala ang iyong reklamo sa barangay para pagsusuran. Hindi pa ito opisyalal na numero ng kaso o entry sa blotter.",

  // ── Screens 14/18 — Success and status ───────────────────────
  "success.title": "Matagumpay Na Naisampa ang Reklamo",
  "success.tracking": "Tracking Number ng Reklamo",
  "success.statusQr": "QR Code para sa Status ng Iyong Reklamo",
  "success.statusQrHint":
    "I-scan ang QR code na ito upang tingnan ang status ng iyong reklamo.",
  "success.statusQrAction": "Subaybayan ang Iyong Reklamo",
  "success.print": "I-print ang Resibo",
  "success.done": "Tapos na",
  "success.disclaimer":
    "Napakumpirma ng resibong ito na natanggap ang reklamo. Hindi pa ito opisyalal na Barangay Case Number, Barangay Blotter Entry, PNP Blotter Number, o Certificate to File Action.",
  "success.nextSteps":
    "Susunod: Susuriin ng Kapitan, OIC o Kalihid ang iyong reklamo. Maaari mong i-scan ang QR code sa itaas, o gamitin ang iyong tracking number at mobile number, upang tingnan ang status anumang oras.",
  "success.notice":
    "Salamat. Pumunta sa front desk kung may tanong tungkol sa iyong reklamo.",
  "success.smsQueued":
    "Matagumpay na naisampa ang iyong reklamo. Pinoproseso ang SMS na kumpirmasyon sa mobile number na ibinigay mo.",
  "success.evidencePartial":
    "Naisampa ang iyong reklamo at wasto ang tracking number sa itaas, ngunit {linked} lamang sa {expected} na na-upload na file ang na-attach — nag-expire ang upload link bago mag-submit. Lumapit sa front desk upang matulungan kang i-attach ang natitirang ebidensiya.",

  // ── Screen 15 — Manual status lookup ─────────────────────────
  "status.title": "Tingnan ang Status ng Reklamo",
  "status.subtitle":
    "Ilagay ang iyong detalye, o i-scan ang QR code sa iyong resibo.",
  "status.tracking": "Tracking number",
  "status.mobile": "Mobile number",
  "status.search": "Hanapin",
  "status.notFound":
    "Hindi makita ang reklamo. Pakisuri ang iyong tracking number at mobile number.",
  "status.invalidLink": "Hindi wasto o kulang ang QR link.",
  "status.returnHome": "Bumalik sa Home ng Kiosk",
  "status.filed": "Petsa ng pag-file",
  "status.caseNumber": "Barangay Case No.",
  "status.caseNumberPending": "Wala pa",
  "status.lastUpdated": "Huling update",
  "status.category": "Kategorya",
  "status.urgency": "Kagipatian",
  "status.nextAction": "Kasalukuyang status / susunod na hakbang",
  "status.resultNotYet":
    "Wala pang opisyal na nakumpirma na status para sa reklamong ito.",
  "status.pendingSync": "Naka-save sa Kiosk — Naghihintay ng Sync",
  "status.pendingSyncHelp":
    "Naka-save ang reklamong ito sa kiosk at ipapadala sa barangay kapag bumalik ang koneksyon. Ipapakita ng parehong QR code ang final status pagkatapos nito.",

  // ── QR status scanning ───────────────────────────────────────
  "status.scanQr": "I-scan ang QR Code ng Reklamo",
  "status.scanQrPil": "Scan Complaint QR Code",
  "qr.scanQrTitle": "I-scan ang QR Code ng Iyong Reklamo",
  "qr.scanQrHint": "Ilagay ang QR code sa loob ng scanning frame.",
  "qr.scanStart": "Buksan ang Kamera",
  "qr.scanUnsupported":
    "Hindi makaharap ang browser na ito na mag-scan ng QR code. Maaari mo pa ring tingnan ang status gamit ang iyong tracking number at mobile number.",
  "qr.scanned": "Matagumpay nga na-scan ang QR Code",
  "qr.invalidQr": "Hindi valid ang QR Code ng reklamo.",
  "qr.notFoundQr": "Hindi makita ang reklamo.",
  "qr.revokedQr": "Ang QR code na ito ay hindi na available.",

  // ── Screen 18b — Complaint tracking guidance ─────────────────
  "track.title": "Subaybayan ang Iyong Reklamo",
  "track.subtitle": "Track Your Complaint",
  "track.intro":
    "Gamitin ang QR code sa iyong resibo upang subaybayan ang iyong reklamo mula sa pag-file hanggang sa resolusyon. Gagana ang parehong code sa buong buhay ng reklamo.",
  "track.qrTitle": "Gamitin ang QR code sa iyong resibo",
  "track.qrBody":
    "I-scan ang QR code gamit ang sarili mong telepono. Magbubukas ito ng pahina na nagpapakita ng kasalukuyang status, progreso, at anumang nakatakdang pagdinig ng iyong reklamo.",
  "track.phoneTitle": "Hindi nag-scan ng code ang kiosk na ito",
  "track.phoneBody":
    "Upang protektahan ang iyong privacy, hindi kailanman nag-scan ang kiosk ng iyong resibo. I-scan ito gamit ang iyong telepono, o itago ang resibo at gamitin ang tracking number sa front desk.",
  "track.slipTitle": "Itago ang iyong resibo",
  "track.slipBody":
    "Nakikita sa iyong resibo ang tracking number at QR code. Itago ito nang maayos; ito ang tanging kopya. Maaari kang mag-print muli mula sa success screen pagkatapos mag-file.",
  "track.lostTitle": "Nawala ang resibo o QR code?",
  "track.lostBody":
    "Para sa iyong proteksyon, walang online na pagbawi. Pumunta sa front desk ng Barangay Abuno Hall at humingi ng tulong sa tauhan tungkol sa iyong reklamo.",
  "track.officeNote":
    "Maaaring hanapin ng front desk ng Barangay Abuno Hall ang iyong reklamo kung dito ka nag-file.",
  "track.start": "Mag-file ng Bagong Reklamo",
  "track.back": "Bumalik sa Home ng Kiosk",

  // ── Screen 18 — Status timeline ──────────────────────────────
  "timeline.caseSummary": "Buod ng kaso",
  "timeline.caseDetails": "Detalye ng kaso",
  "timeline.currentStage": "Kasalukuyang yugto",
  "timeline.reached": "Dumaanan",
  "timeline.notReached": "Hindi pa dumaanan",
  "timeline.noConfirmedYet": "Hindi pa nakumpirma",
  "timeline.mediationCard": "Panahon ng pagbabayuhan",
  "timeline.mediationDeadline": "Tapos ang panahon noong",
  "timeline.hearingCard": "Susunod na pagdinig",
  "timeline.hearingDate": "Petsa",
  "timeline.hearingTime": "Oras",
  "timeline.hearingStatus": "Status",
  "timeline.hearingVenue": "Venue",
  "timeline.privacyNotice":
    "Ipinapakita lamang ng pahinang ito ang impormasyong inaprubahan para sa mga kaso sa barangay. Hindi ipinapakita ang mga panloob na tala, detalye ng iba, o pribadong ebidensiya.",

  "timeline.stage.filed": "Naisampa ang Reklamo",
  "timeline.stage.reviewed": "Sinuri at Aprubado",
  "timeline.stage.summons": "Ipinadala ang Summons",
  "timeline.stage.mediation": "Nasa Pagbabayuhan",
  "timeline.stage.settlement": "Kasunduan o Escalation",
  "timeline.stage.underReview": "Sinusuri",
  "timeline.stage.routing": "Nakumpirma ang Routing",
  "timeline.stage.linked": "Naka-link sa Blotter o Ini-refer",
  "timeline.stage.closed": "Tapos o Nakasara",

  // ── Resident documents ───────────────────────────────────────
  "docs.title": "Iyong mga Dokumento",
  "docs.intro": "Mga dokumentong ibinahagi sa iyo ng barangay tungkol sa reklamong ito.",
  "docs.open": "Tingnan",
  "docs.unavailable": "Hindi available ang dokumentong ito sa ngayon.",
  "docs.type.reklamo_form": "Reklamo Form (Isinumiteng Kopya)",
  "docs.type.signed_reklamo_form": "Reklamo Form (Napirmahan)",
  "docs.type.hearing_notice": "Abiso ng Pagdinig",
  "docs.type.other": "Dokumento",

  // ── Screen 16 — Offline ──────────────────────────────────────
  "offline.savedTitle": "Naka-save sa Kiosk — Naghihintay ng Sync",
  "offline.banner": "Naka-save sa Kiosk — Naghihintay ng Sync",
  "offline.bannerPil":
    "Saved on Kiosk — Pending Sync. Ipadala kapag bumalik ang internet",
  "offline.synced": "Naipadala na sa barangay",
  "offline.syncing": "Ipinapadala ang iyong reklamo...",
  "offline.syncFailed":
    "Hindi pa namin naipadala ang iyong reklamo. Naka-save pa rin ito sa kiosk na ito.",
  "offline.pendingStatus": "Naghihintay ng sync",
  "offline.reference": "Offline na reference",
  "offline.savedAt": "Naka-save noong",
  "offline.pendingNotice":
    "Hindi pa ito opisyalal na numero ng reklamo. Hindi pa natatanggap ng barangay ang iyong reklamo.",
  "offline.instructions":
    "Maaari kang umalis sa kiosk. Ipadala ang iyong reklamo nang automatic kapag bumalik ang koneksyon.",
  "offline.queuedHidden":
    "Hindi na ipapakita ang reference na ito kapag naipadala na ang iyong reklamo.",

  // ── Screen 17 — Inactivity ───────────────────────────────────
  "inactivity.title": "Nandito ka pa ba?",
  "inactivity.subtitle": "Are you still there?",
  "inactivity.stillHere": "Nandito Pa Ako",
  "inactivity.stillHerePil": "I'm Still Here",
  "inactivity.seconds": "segundo",

  // ── Shared navigation ────────────────────────────────────────
  "nav.back": "Bumalik",
  "nav.continue": "Magpatuloy",
  "nav.submit": "Isumite",
  "nav.search": "Hanapin",
  "nav.start": "Magsimula",
  "nav.review": "Suriin",
  "nav.skip": "Lagpasan",
  "nav.edit": "I-edit",
  "nav.done": "Tapos na",
  "nav.print": "I-print ang Resibo",
  "nav.cancel": "Kanselahin",
  "nav.close": "Isara",
  "nav.main": "Pangunahing Screen",

  // ── Shared words ─────────────────────────────────────────────
  "common.yes": "Oo",
  "common.no": "Hindi",
  "common.optional": "Opsyonal",
  "common.of": "ng",
  "common.step": "Step",
  "common.hakbang": "Hakbang",
  "common.loading": "Naglo-load",
  "common.retry": "Subukan Muli",
  "common.remove": "Alisin",
  "common.files": "file",

  // ── Connection state ─────────────────────────────────────────
  "net.online": "Online",
  "net.offline": "Walang Internet",
  "net.reconnecting": "Kumokonekta",

  // ── Validation and submission errors ─────────────────────────
  "err.required": "Kailangan ang field na ito.",
  "err.fullName": "Pakilagay ang iyong buong pangalan.",
  "err.mobile": "Ilagay ang wastong mobile number (09XX XXX XXXX).",
  "err.address": "Pakilagay ang iyong kumpletong address.",
  "err.purok": "Pakilagay ang iyong purok.",
  "err.otherParty": "Pumili ng isa sa mga opsyon.",
  "err.respondentName": "Pakilagay ang pangalan ng ibang partido.",
  "err.incidentDate": "Pakilagay ang petsa ng insidente.",
  "err.incidentDateInvalid": "Pakilagay ang wastong petsa.",
  "err.incidentDateFuture": "Hindi maaaring nasa hinaharap ang petsa ng insidente.",
  "err.incidentTime": "Pakilagay ang oras ng insidente.",
  "err.incidentLocation": "Pakilagay kung saan nangyari.",
  "err.incidentPurok": "Pakilagay ang purok kung saan nangyari.",
  "err.incidentOngoing": "Pumili ng oo o hindi.",
  "err.incidentImmediate": "Pumili ng oo o hindi.",
  "err.narrative": "Pakilarawan ang nangyari.",
  "err.narrativeShort": "Pakilagay pa ng kaunting detalye.",
  "err.narrativeLong": "Masyadong mahaba ang iyong paglalarawan. Pakis shorten.",
  "err.consentPrivacy": "Pakikumpirma ang abiso sa privacy.",
  "err.consentAccuracy":
    "Pakikumpirma ang handa nang ipadala ang iyong reklamo.",
  "err.fileType": "JPG, PNG, WebP, o PDF lang ang tinatanggap.",
  "err.fileSize": "Dapat 10 MB o mas maliit ang bawat file.",
  "err.fileCount": "Maaari kang mag-attach ng hanggang 5 na file.",
  "err.fileFailed": "Hindi ma-upload ang file. Pakisubukan muli.",
  "err.submitting": "Isinusumite...",
  "err.submitFailed":
    "Hindi maisumite ang reklamo. Pakisubukan muli.",
  "err.network":
    "Hindi makakonekta. Pakisuri ang iyong koneksyon at subukan muli.",
  "err.lookupUnavailable":
    "Hindi makuha ang status ng reklamo. Pakisubukan muli.",
  "err.rateLimited":
    "Masyadong maraming pagsubok. Pakhintay sandali at subukan muli.",
  "err.quota":
    "Puno na ang offline storage ng kiosk na ito. Mangyaring humingi ng tulong sa tauhan.",
  "err.linkExpired":
    "Nag-expire na ang QR code na ito. Mangyaring gumawa ng bago sa kiosk.",
  "err.camera": "Kailangan ng camera access upang ma-scan ang QR code.",
  "err.sessionUnavailable":
    "Hindi makapagsimula ng secure na filing session ang kiosk na ito sa ngayon. Mangyaring humingi ng tulong sa tauhan.",
};

const dictionary = { en, pil };

export const HTML_LANG = { en: "en", pil: "fil" };

export function translate(language, key, replacements) {
  const lang = language === "pil" ? "pil" : "en";
  let str = dictionary[lang][key] ?? dictionary.en[key] ?? key;
  if (replacements) {
    for (const [k, v] of Object.entries(replacements)) {
      str = str.replace(new RegExp("{" + k + "}", "g"), String(v));
    }
  }
  return str;
}
