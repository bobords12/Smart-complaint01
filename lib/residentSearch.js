import {
  RESIDENT_COMPLAINTS,
  RESIDENT_NOTIFICATIONS,
} from "@/data/residentDashboardData";

function normalize(value) {
  return String(value ?? "").toLowerCase().trim();
}

export function searchResidentData(query) {
  const term = normalize(query);
  if (!term) {
    return { complaints: [], notifications: [] };
  }

  const complaints = RESIDENT_COMPLAINTS.filter((complaint) =>
    [complaint.title, complaint.caseNo, complaint.status, complaint.category, complaint.priority]
      .some((value) => normalize(value).includes(term))
  ).map((complaint) => ({
    type: "complaint",
    caseNo: complaint.caseNo,
    title: complaint.title,
    category: complaint.category,
    status: complaint.status,
  }));

  const notifications = RESIDENT_NOTIFICATIONS.filter((notification) =>
    normalize(notification.message).includes(term)
  ).map((notification) => ({
    type: "notification",
    id: notification.id,
    caseNo: notification.caseNo,
    message: notification.message,
  }));

  return { complaints, notifications };
}