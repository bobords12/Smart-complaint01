// A failed schedule must say WHY, in a sentence the official can act on.
//
// The console entry for a failed save logged an object, which the Next.js
// dev overlay renders collapsed as "{}" — the exact reason was invisible
// in the only place the raw error was recorded. Two things fix that:
// `scheduleFailureMessage()` turns every failure into one readable
// sentence (shown in the toast and the inline error), and the callers
// log it again as plain strings so the overlay can never hide it.
//
// This file pins the four cases that matter: an empty message (the worst
// case — a failure with no reason at all), an expired session, an RLS
// policy block, and the database guards whose own sentences must pass
// through unchanged.
//
// No network: nothing here calls Supabase.
//
// Run: node --test scripts/test-schedule-error-message.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { register } from "node:module";

register("./resolve-alias.mjs", import.meta.url);

const { scheduleFailureMessage } = await import("@/lib/captainComplaintWorkflow");

test("an error with no message still produces a sentence", () => {
  assert.equal(scheduleFailureMessage({}), "Could not schedule the hearing.");
  assert.equal(scheduleFailureMessage(undefined), "Could not schedule the hearing.");
});

test("an expired session is translated into an action", () => {
  const message = scheduleFailureMessage({
    code: "401",
    message: "Invalid JWT: token is expired",
  });
  assert.match(message, /session has expired/i);
  assert.match(message, /sign in again/i);
});

test("a policy block names the account it needs", () => {
  const message = scheduleFailureMessage({
    code: "42501",
    message: 'new row violates row-level security policy for table "hearings"',
  });
  assert.match(message, /official account/i);
  assert.match(message, /captain/i);
});

test("a database guard keeps its own exact sentence", () => {
  const gate =
    "This complaint cannot proceed to a summons, hearing, Lupon or 15-day period yet. " +
    "Complete routing assessment first (respondent status, then KP applicability). " +
    "Complaint: AB-2026-0055, respondent: pending, KP: pending.";
  assert.equal(scheduleFailureMessage({ code: "23514", message: gate }), gate);
});

test("a dropped connection is distinguished from a rejection", () => {
  const message = scheduleFailureMessage(new TypeError("Failed to fetch"));
  assert.match(message, /reach the server/i);
  assert.match(message, /try again/i);
});
