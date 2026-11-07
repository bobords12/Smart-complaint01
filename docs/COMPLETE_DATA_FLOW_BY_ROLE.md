# Complete Data Flow Document — By User Role

**Smart Complaint and Blotter Management System — Barangay Abuno**
*Structured as External Entity → Data In → Process → Data Store → Data Out, ready to drop directly into a DFD (Miro, Lucidchart, etc.). Process and Data Store numbers are consistent across all roles so a Level-1 DFD can be assembled from this document without renumbering.*

---

## Reference Key (use across all diagrams)

**Processes**
| ID | Process |
|---|---|
| P1 | File Complaint & Auto-Classify (NLP) |
| P2 | Review &amp; Approve Complaint |
| P3 | Issue &amp; Serve Summons |
| P4 | Conduct Hearing &amp; Record Minutes |
| P5 | Manage Lupon Panel (Pangkat Escalation) |
| P6 | Generate Settlement / Certificate Documents |
| P7 | Issue BAR Status |
| P8 | Send Notifications (SMS + in-app) |
| P9 | Manage Users &amp; Roles |
| P10 | View Activity Log / Analytics / Reports |
| P11 | Check Complaint Status (Kiosk/Web lookup) |

**Data Stores**
| ID | Store |
|---|---|
| D1 | Users |
| D2 | Complaints |
| D3 | ComplaintClassificationLog |
| D4 | Evidence |
| D5 | EvidenceUploadToken |
| D6 | Summons |
| D7 | HearingRecord |
| D8 | AmicableSettlement |
| D9 | LuponPanel |
| D10 | CertificateToFileAction |
| D11 | BARStatus |
| D12 | BlotterRecord |
| D13 | ActivityLog |
| D14 | Notifications |

---

## 1. Resident (Web / Mobile / Kiosk)

**Data In → Process → Data Store**
| Data In (from Resident) | Process | Data Store Written |
|---|---|---|
| Name, mobile number, address (registration) | P1 | D1 |
| Incident date/time/location, narrative text | P1 (triggers auto-classify) | D2, D3 |
| Evidence photo (kiosk camera or QR phone-handoff) | P1 | D4, D5 |
| Confirmation of 2 chosen Lupon members | P5 | D9 |
| Case ID + mobile number (status lookup) | P11 | reads D2, D6, D7, D9, D11 |

**Data Out (to Resident)**
| Data Out | Source | Delivered Via |
|---|---|---|
| Confirmed case type, urgency (never raw confidence score) | D2, D3 | Dashboard / Kiosk result screen |
| Summons (hearing date, time, location) | D6 | SMS + downloadable/printable doc |
| Summons delivery status (served/pending) | D6, D14 | Status lookup screen |
| Hearing outcome (settled / escalated) | D7, D8 | SMS + Complaint Details page |
| Amicable Settlement document | D8 | Downloadable copy |
| Certificate to File Action | D10 | Downloadable copy |
| BAR status notice (if applicable) | D11 | SMS + dashboard flag |
| Mediation period countdown (Day X of 15) | D2, D6 | Status lookup screen |
| Case activity/progress timeline | D2, D6, D7, D8, D9, D10, D13 | Complaint Details (own case only) |

**Notes for DFD:** Resident is the only external entity that both **originates** a complaint (P1) and later **queries** it read-only (P11) without further write access, except confirming Lupon selection (P5). No resident data flow ever touches D1 write access for role/permissions.

---

## 2. Barangay Captain

**Data In → Process → Data Store**
| Data In (from Captain) | Process | Data Store Written |
|---|---|---|
| Classification correction (case type/urgency) | P2 | D2, D3 |
| Approval decision | P2 | D2, D13 |
| Hearing date/time selection | P3 | D6, D13 |
| Minutes text, attendance | P4 | D7, D13 |
| Hearing outcome (settle/reschedule/escalate) | P4 | D2, D7, D13 |
| Lupon panel confirmation | P5 | D9, D13 |
| Settlement terms, signature | P6 | D8, D13 |
| Certificate to File Action signature | P6 | D10, D13 |
| No-show count review → BAR decision | P7 | D11, D13 |
| Add/remove/reassign user accounts, assign roles | P9 | D1, D13 |
| Report/date-range parameters | P10 | reads D2, D7, D12 |

**Data Out (to Captain)**
| Data Out | Source |
|---|---|
| Urgency-sorted complaint queue + PNP advisory flags | D2, D3 |
| Today's hearing schedule | D6, D7 |
| Case activity/audit trail (all cases) | D13 |
| Blotter reports, analytics charts | D12, D2 |
| Full Users &amp; Roles list | D1 |

**Notes for DFD:** Captain is the only entity with a write path into **D1 (Users)** for account/role management (P9) — this is the deliberate exception OIC does not share.

---

## 3. OIC (delegated)

Identical data flow to Captain for all processes **except P9**.

| Data In (from OIC) | Process | Data Store Written |
|---|---|---|
| Same as Captain: classification correction, approval, summons date, minutes, outcome, panel confirmation, settlement, certificate, BAR decision | P2–P7 | D2, D3, D6, D7, D8, D9, D10, D11, D13 |
| **(No write path to D1)** | — | — |

**Data Out (to OIC):** identical to Captain, **plus** a delegation-status read from D1 (who they are standing in for, since-when) surfaced as the dashboard banner. D1 itself remains **read-only** for OIC — this is the one asymmetry versus Captain in the entire diagram.

**Notes for DFD:** Draw OIC and Captain as two external entities both connecting to P2–P8, P10 identically. Only Captain connects to P9. Every `ActivityLog` write from either includes `actor_role_at_time` so D13 records distinguish a Captain-made action from an OIC-made one even though the process paths are identical.

---

## 4. Secretary

**Data In → Process → Data Store**
| Data In (from Secretary) | Process | Data Store Written |
|---|---|---|
| Minutes text, attendance | P4 | D7, D13 |
| Draft Summons content | P3 | D6, D13 |
| Draft Amicable Settlement | P6 | D8, D13 |
| Draft Certificate to File Action | P6 | D10, D13 (status stays "awaiting signature" until Captain/OIC signs) |
| Lupon panel member entry | P5 | D9, D13 |
| Blotter entry text | — | D12, D13 |

**Data Out (to Secretary)**
| Data Out | Source |
|---|---|
| Today's hearings needing minutes | D6, D7 |
| Documents awaiting generation/signature | D6, D8, D10 |
| Complaint details (read-only) | D2, D4 |
| Case activity log (read-only) | D13 |

**Notes for DFD:** Secretary connects to the **same processes** as Captain/OIC for P3–P6, but her data flows into D8 and D10 always leave the record in an "awaiting signature" state — the flow that flips it to "approved/issued" only originates from Captain or OIC. She has **no data flow into P2 (approval), P7 (BAR), or P9 (Users &amp; Roles)** at all — those three processes simply don't connect to her external-entity node on the diagram.

---

## 5. Lupon Member (case-scoped, RLS)

| Data In | Process | Data Store Written |
|---|---|---|
| Mediation notes (own assigned case only) | P4 | D7 (scoped by RLS to matching D9 record) |

| Data Out | Source |
|---|---|
| Assigned case's details/evidence (read-only, one case only) | D2, D4 — filtered by D9 |

**Notes for DFD:** This is the narrowest entity on the whole diagram — draw its data flow arrows only reaching D2/D4/D7, and only ever for the single complaint_id matching their D9 row. Access flow itself is gated by `access_expires_at` in D9 (expired = no data flow at all).

---

## 6. PNP (reference only — not a full external entity)

PNP does not have a data flow into or out of any process. It appears on the DFD only as a **note/annotation** on P2 (Review &amp; Approve Complaint): when D2.urgency_level = "critical," an advisory flag is rendered in the Captain/OIC's own output from P2 — no data is transmitted to PNP by the system itself. If you need to show this on the diagram without implying a real data flow, use a dashed annotation line, not a solid data-flow arrow.

---

*Use this document alongside `ERD_master.txt` (data stores/fields) and `use_case_diagram.puml` (process/actor relationships) to draw the Level-0 Context Diagram (5 external entities: Resident, Captain, OIC, Secretary, Lupon — PNP as annotation only) and the Level-1 DFD (11 processes, 14 data stores) in Miro.*
