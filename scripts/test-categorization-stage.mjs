// The recorded stage must follow the classification decision.
//
// `advancePastCategorization()` is the one advance both the Stage 2 action
// modal and the Review & Classification tab run. It exists because the tab
// used to write only the confirmed columns: the case stayed parked on
// 'For Official Categorization', the Case Progress stepper showed Step 5
// (Notice of Hearing) while the next-action panel kept offering "Review
// Classification", and pressing it changed nothing.
//
// No network: the writes are recorded by a stub client.
//
// Run: node --test scripts/test-categorization-stage.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { register } from "node:module";

register("./resolve-alias.mjs", import.meta.url);

const { advancePastCategorization, NO_CATEGORY_CONFIRMED } = await import(
  "@/lib/complaintQueries"
);

/** Records every write instead of performing it. */
function recordingClient() {
  const writes = [];
  const client = {
    writes,
    from(table) {
      return {
        update(values) {
          return {
            eq(column, value) {
              writes.push({ table, op: "update", values, where: { column, value } });
              return Promise.resolve({ error: null });
            },
          };
        },
        insert(values) {
          writes.push({ table, op: "insert", values });
          return Promise.resolve({ error: null });
        },
      };
    },
  };
  return client;
}

const staleRow = {
  id: "6f38a284-c74e-453f-bcc9-a43724472c66",
  current_status: "For Official Categorization",
  current_stage: "For Official Categorization",
  confirmed_category: "Civil",
  confirmed_urgency: "Normal",
};

test("a classified case still on the categorization stage is advanced", async () => {
  const supabase = recordingClient();
  const advanced = await advancePastCategorization(supabase, { complaint: staleRow });

  assert.equal(advanced, true);
  assert.equal(supabase.writes.length, 2, "one status write, one timeline row");

  const [complaintWrite, statusWrite] = supabase.writes;
  assert.equal(complaintWrite.table, "complaints");
  assert.equal(complaintWrite.op, "update");
  assert.equal(complaintWrite.values.current_status, "Received");
  assert.equal(complaintWrite.values.current_stage, "Received — Pending Summons");
  assert.equal(complaintWrite.where.value, staleRow.id);

  assert.equal(statusWrite.table, "case_statuses");
  assert.equal(statusWrite.values.status, "Received");
  assert.equal(
    statusWrite.values.stage,
    "Categorization Confirmed — Pending Summons"
  );
});

test("the decision just saved by the tab is the one that advances the stage", async () => {
  const supabase = recordingClient();
  // The prop row predates the save, so the confirmed columns are not on it.
  const advanced = await advancePastCategorization(supabase, {
    complaint: { ...staleRow, confirmed_category: null, confirmed_urgency: null },
    category: "Criminal",
    urgency: "High",
    changedBy: "2b1f0d9e-0000-4000-8000-000000000001",
  });

  assert.equal(advanced, true);
  assert.equal(supabase.writes[0].values.current_status, "Received");
  assert.equal(
    supabase.writes[1].values.changed_by,
    "2b1f0d9e-0000-4000-8000-000000000001"
  );
});

test("a case that already moved on is never touched again", async () => {
  const supabase = recordingClient();
  const advanced = await advancePastCategorization(supabase, {
    complaint: { ...staleRow, current_status: "Received", current_stage: "Received — Pending Summons" },
  });

  assert.equal(advanced, false);
  assert.equal(supabase.writes.length, 0, "no write, no duplicate timeline row");
});

test("a decision still open on the sentinel never becomes a summons stage", async () => {
  const supabase = recordingClient();
  const advanced = await advancePastCategorization(supabase, {
    complaint: staleRow,
    category: NO_CATEGORY_CONFIRMED,
    urgency: "",
  });

  assert.equal(advanced, false);
  assert.equal(supabase.writes.length, 0);
});

test("a half-decided classification (category without urgency) is left parked", async () => {
  const supabase = recordingClient();
  const advanced = await advancePastCategorization(supabase, {
    complaint: staleRow,
    urgency: "",
  });

  assert.equal(advanced, false);
  assert.equal(supabase.writes.length, 0);
});

test("a failed status write is reported, never swallowed", async () => {
  const supabase = {
    from(table) {
      return {
        update() {
          return {
            eq() {
              return Promise.resolve({ error: { message: `permission denied on ${table}` } });
            },
          };
        },
        insert() {
          return Promise.resolve({ error: null });
        },
      };
    },
  };

  await assert.rejects(
    () => advancePastCategorization(supabase, { complaint: staleRow }),
    /permission denied/
  );
});
