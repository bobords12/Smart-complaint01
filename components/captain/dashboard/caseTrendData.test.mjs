import assert from "node:assert/strict";
import test from "node:test";
import { aggregateCaseTrend, trendSince } from "./caseTrendData.mjs";

const now = new Date("2026-11-04T16:30:00.000Z"); // Nov 5, 00:30 Manila

test("Manila calendar boundaries and every filter's bucket count", () => {
  assert.equal(trendSince("1d", now), "2026-11-03T17:00:00.000Z");
  assert.equal(trendSince("7d", now), "2026-10-29T16:00:00.000Z");
  assert.equal(trendSince("1m", now), "2026-10-06T16:00:00.000Z");
  assert.equal(trendSince("1y", now), "2025-11-30T16:00:00.000Z");
  assert.equal(trendSince("all", now), null);
  for (const [filter, length] of [["1d", 24], ["7d", 7], ["1m", 30], ["1y", 12]]) {
    assert.equal(aggregateCaseTrend([], filter, now).length, length, filter);
  }
});

test("a filing stays in its Manila day; only distinct complaint ids contribute", () => {
  const rows = [
    { id: "a", submitted_at: "2026-11-04T15:55:00Z", predicted_urgency: "High" },
    { id: "a", submitted_at: "2026-11-04T15:55:00Z", predicted_urgency: "High" },
    { id: "b", submitted_at: "2026-11-04T16:05:00Z", predicted_urgency: "Normal", confirmed_urgency: "Critical" },
    { id: "c", submitted_at: "2026-11-04T16:06:00Z", predicted_urgency: null },
    { id: "d", submitted_at: "2026-11-04T16:07:00Z", predicted_urgency: "Normal", confirmed_urgency: "High" },
  ];
  const points = aggregateCaseTrend(rows, "7d", now);
  assert.deepEqual(points.at(-2) && [points.at(-2).Total, points.at(-2).High], [1, 1]);
  assert.deepEqual([points.at(-1).Total, points.at(-1).Normal, points.at(-1).High,
    points.at(-1).Critical, points.at(-1).Unassessed], [3, 0, 1, 1, 1]);
  assert.equal(points.reduce((sum, point) => sum + point.Total, 0), 4);
});

test("unrecognized official urgency is unassessed, not invented Normal", () => {
  const rows = [{ id: "a", submitted_at: "2026-11-04T16:00:00Z",
    confirmed_urgency: "Unknown", predicted_urgency: "Normal" }];
  const point = aggregateCaseTrend(rows, "1d", now).at(-1);
  assert.equal(point.Unassessed, 1);
  assert.equal(point.Normal, 0);
});

test("All fills calendar gaps, while the yearly filter excludes older months", () => {
  const rows = [
    { id: "old", submitted_at: "2025-10-03T02:00:00Z", confirmed_urgency: "Normal" },
    { id: "new", submitted_at: "2026-11-03T02:00:00Z", confirmed_urgency: "High" },
  ];
  const history = aggregateCaseTrend(rows, "all", now);
  assert.equal(history.length, 14);
  assert.equal(history[0].Total, 1);
  assert.equal(history[1].Total, 0);
  assert.equal(history.at(-1).Total, 1);
  assert.equal(aggregateCaseTrend(rows, "1y", now).reduce((sum, point) => sum + point.Total, 0), 1);
});
