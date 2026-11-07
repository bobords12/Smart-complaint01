// Chart-only calendar grouping. Modern Asia/Manila dates use UTC+08:00;
// shifting before UTC calendar arithmetic keeps midnight/hour boundaries stable.
const MANILA_OFFSET = 8 * 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;
const URGENCIES = new Set(["Normal", "High", "Critical"]);

function manilaDate(instant) {
  return new Date(instant.getTime() + MANILA_OFFSET);
}

function startOfBucket(date, mode) {
  const local = manilaDate(date);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(),
    mode === "month" ? 1 : local.getUTCDate(), mode === "hour" ? local.getUTCHours() : 0));
}

function modeFor(filter) {
  return filter === "1d" ? "hour" : filter === "1y" || filter === "all" ? "month" : "day";
}

function advance(date, mode, amount) {
  const next = new Date(date);
  if (mode === "month") next.setUTCMonth(next.getUTCMonth() + amount);
  else if (mode === "hour") next.setUTCHours(next.getUTCHours() + amount);
  else next.setUTCDate(next.getUTCDate() + amount);
  return next;
}

function bucketStart(filter, now) {
  const mode = modeFor(filter);
  const end = startOfBucket(now, mode);
  return filter === "1d" ? advance(end, mode, -23)
    : filter === "7d" ? advance(end, mode, -6)
    : filter === "1m" ? advance(end, mode, -29)
    : filter === "1y" ? advance(end, mode, -11) : null;
}

export function trendSince(filter, now = new Date()) {
  const first = bucketStart(filter, now);
  return first ? new Date(first.getTime() - MANILA_OFFSET).toISOString() : null;
}

function labels(date, mode) {
  const timeZone = "UTC"; // The date has already been shifted to Manila calendar time.
  const full = date.toLocaleString("en-PH", mode === "hour"
    ? { timeZone, month: "long", day: "numeric", year: "numeric", hour: "numeric", hour12: true }
    : { timeZone, month: "long", day: "numeric", year: "numeric" });
  const short = date.toLocaleString("en-PH", mode === "hour"
    ? { timeZone, hour: "numeric", hour12: true }
    : mode === "month" ? { timeZone, month: "short", year: "2-digit" }
      : { timeZone, month: "short", day: "numeric" });
  return { full, short };
}

export function aggregateCaseTrend(rows, filter, now = new Date()) {
  const mode = modeFor(filter);
  const seen = new Set();
  const counts = new Map();
  const cutoff = bucketStart(filter, now);
  let first = cutoff;
  for (const row of rows) {
    if (!row.id || seen.has(row.id)) continue;
    seen.add(row.id);
    if (!row.submitted_at) continue;
    const filed = new Date(row.submitted_at);
    if (Number.isNaN(filed.getTime()) || filed > now) continue;
    const date = startOfBucket(filed, mode);
    if (cutoff && date < cutoff) continue;
    if (!first || date < first) first = date;
    const key = date.getTime();
    const bucket = counts.get(key) || { Total: 0, Normal: 0, High: 0, Critical: 0, Unassessed: 0 };
    const reviewed = row.confirmed_urgency;
    const urgency = URGENCIES.has(reviewed) ? reviewed
      : reviewed ? null : URGENCIES.has(row.predicted_urgency) ? row.predicted_urgency : null;
    bucket.Total += 1;
    bucket[urgency || "Unassessed"] += 1;
    counts.set(key, bucket);
  }
  if (!first) return [];
  const last = startOfBucket(now, mode);
  const result = [];
  for (let date = first; date <= last; date = advance(date, mode, 1)) {
    const label = labels(date, mode);
    result.push({ key: date.getTime(), label: label.short, fullLabel: label.full,
      ...(counts.get(date.getTime()) || { Total: 0, Normal: 0, High: 0, Critical: 0, Unassessed: 0 }) });
  }
  return result;
}
