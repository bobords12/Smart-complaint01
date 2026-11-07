import assert from "node:assert/strict";
import { test } from "node:test";
import { saveClassificationParts } from "../components/captain/complaints/classificationSave.js";

test("a specific-category outage never repeats the broad decision on retry", async () => {
  let broadCalls = 0;
  let specificCalls = 0;
  const initial = await saveClassificationParts({
    existingDecision: false, needsSpecific: true,
    confirmBroad: async () => { broadCalls++; return { success: true, confirmed: true }; },
    confirmSpecific: async () => { specificCalls++; throw Error("network dropped"); },
  });
  assert.equal(initial.status, "specific_unknown");
  const retry = await saveClassificationParts({
    existingDecision: true, needsSpecific: true,
    confirmBroad: async () => { broadCalls++; return { success: true, confirmed: true }; },
    confirmSpecific: async () => { specificCalls++; return { success: true }; },
  });
  assert.deepEqual(retry, { status: "saved", changed: true });
  assert.equal(broadCalls, 1);
  assert.equal(specificCalls, 2);
});

test("unknown broad-write outcome prevents a second write before refreshing", async () => {
  let specificCalls = 0;
  const result = await saveClassificationParts({
    existingDecision: false, needsSpecific: true,
    confirmBroad: async () => { throw Error("response lost"); },
    confirmSpecific: async () => { specificCalls++; return { success: true }; },
  });
  assert.equal(result.status, "broad_unknown");
  assert.equal(specificCalls, 0);
});
