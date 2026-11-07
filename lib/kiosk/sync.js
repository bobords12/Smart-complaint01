/**
 * Offline queue synchronisation.
 *
 * This is the component that makes "saved, will send itself" true.
 *
 * The whole design rests on one property of the backend: every
 * submission carries its own idempotency key
 * (`complaints.kiosk_client_submission_id`), and
 * kiosk_submit_complaint() returns the existing row when it sees a
 * key it has already used. So running this engine twice, or running it
 * after a half-finished attempt, cannot create a second complaint.
 * That is why the retry loop below is written to be aggressive: it
 * re-sends the whole body rather than trying to remember what it last
 * managed to do.
 *
 * Evidence complicates it. A QR upload session lives for ten minutes
 * and is created over the network, so an offline entry cannot have
 * one. The engine therefore opens a session at sync time and sends the
 * queued blobs through the same scoped signed-Storage upload a
 * phone uses. `draftReference` is regenerated for that session,
 * which is safe precisely because it is only a storage folder name;
 * `clientSubmissionId` and `statusToken`, the two values that carry
 * meaning, are read back out of the sealed payload untouched.
 *
 * That path is implemented and tested, but today it is never taken:
 * the wizard's only evidence route is a phone scanning a QR code, so
 * `queueSubmission` is always called with an empty evidence array. The
 * capability is kept because it is the only way a future "attach files
 * at the kiosk" feature could work offline, and because an entry that
 * somehow arrived with evidence must still be handled correctly
 * rather than filed without its attachments.
 *
 * The service worker deliberately does NOT share this capability. It
 * can decrypt the queue with the non-extractable device key, but it
 * refuses to submit an entry carrying evidence and parks it in
 * `needs_attention` instead, because filing a complaint whose evidence
 * silently failed to upload is worse than filing nothing. So if
 * evidence is ever queued, the tab-open drain below must run; the
 * worker alone will not complete it.
 *
 * Nothing here trusts IndexedDB state. Every record is decrypted and
 * re-sent, and the server is the only thing that decides what exists.
 */

import {
  OFFLINE_STATES,
  UPLOAD_SESSION_MS,
} from "./config";
import {
  deleteSubmission,
  getSubmission,
  listQueue,
  pruneExpired,
  releaseStaleSyncing,
  setState,
} from "./offlineStore";
import {
  KioskRequestError,
  openUploadSession,
  pollUploadSession,
  submitComplaint,
  revokeUploadSession,
} from "./api";
import { uploadKioskEvidence } from "./signedUpload";

/** Retry schedule in ms, per attempt. Capped so a kiosk never spins. */
const BACKOFF_MS = [0, 2000, 5000, 15000, 30000, 60000];

/** Attempts before an entry stops being retried automatically. */
const MAX_ATTEMPTS = 6;

/** Evidence for a queued entry must not exceed this; it lives in RAM. */
const MAX_TOTAL_EVIDENCE_BYTES = 40 * 1024 * 1024;

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (ms <= 0) return resolve();
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true }
    );
  });
}

function evidenceSize(evidence) {
  return evidence.reduce((total, file) => total + (file.size || 0), 0);
}

/**
 * Uploads queued blobs into a freshly opened session.
 *
 * Returns the file descriptors the submission endpoint expects, in the
 * citizen's original order. A single failed file is not fatal: it is
 * skipped so the complaint still reaches the queue, and the count is
 * reported back so the UI can be honest about what was lost.
 */
async function uploadQueuedEvidence(token, evidence, { signal, onFile }) {
  const uploaded = [];

  for (const file of evidence) {
    let uploadedFile;
    try {
      uploadedFile = await uploadKioskEvidence(token,
        new File([file.blob], file.name, { type: file.mime }), { signal });
    } catch (error) {
      // A type or size rejection is the file's fault, not the network's.
      // Retrying it forever would block the complaint forever, so the
      // evidence is dropped and the complaint goes on without it.
      if (error.code === "unsupported_type" || error.code === "file_too_large") {
        continue;
      }
      throw error;
    }

    uploaded.push(uploadedFile);
    onFile?.(uploaded.length, evidence.length);
  }

  return uploaded;
}

/**
 * Syncs one queue entry.
 *
 * @returns {Promise<{ outcome: string, tracking?: string, message?: string }>}
 */
async function syncEntry(id, { signal, onEvent }) {
  const record = await getSubmission(id);
  if (!record) return { outcome: "missing" };

  // Nothing to send. Either a crash after success, or retention pruned it.
  if (record.state === OFFLINE_STATES.SYNCED) {
    await deleteSubmission(id);
    return { outcome: "already_synced" };
  }

  if (evidenceSize(record.evidence) > MAX_TOTAL_EVIDENCE_BYTES) {
    await setState(id, OFFLINE_STATES.NEEDS_ATTENTION, {
      error: "queued evidence exceeds the safe sync limit",
    });
    return { outcome: "needs_attention" };
  }

  const attempt = (record.attemptCount || 0) + 1;
  const applied = await setState(id, OFFLINE_STATES.SYNCING, { attemptCount: attempt });
  if (applied === OFFLINE_STATES.NEEDS_ATTENTION) {
    return { outcome: "needs_attention" };
  }

  const payload = record.payload;
  let sessionToken = null;

  try {
    onEvent?.({ entryId: id, phase: "syncing" });

    let draftReference = payload.draftReference;
    let evidence = [];

    if (record.evidence.length > 0) {
      onEvent?.({ entryId: id, phase: "uploading", count: record.evidence.length });
      const session = await openUploadSession(
        { fingerprint: payload.fingerprint },
        { signal }
      );
      sessionToken = session.session.token;
      draftReference = session.session.draft_reference;

      evidence = await uploadQueuedEvidence(sessionToken, record.evidence, {
        signal,
        onFile: (done, total) =>
          onEvent?.({ entryId: id, phase: "file", done, total }),
      });
    }

    onEvent?.({ entryId: id, phase: "submitting" });

    const response = await submitComplaint(
      {
        ...payload,
        draftReference,
        evidence: evidence.map((file) => ({
          id: file.id,
          file_name: file.name,
          evidence_type: String(file.mime_type || "").startsWith("image/")
            ? "photo"
            : "document",
        })),
      },
      { signal }
    );

    const result = response.result;
    const tracking = result?.reference_number || null;

    if (!tracking) {
      // A 200 without a tracking number means the function ran but did
      // not confirm. Not treating that as success is the whole point
      // of the idempotency key: the next attempt returns the real row.
      throw new KioskRequestError("The submission was not confirmed.", {
        code: "unconfirmed",
        status: 502,
      });
    }

    await setState(id, OFFLINE_STATES.SYNCED);
    onEvent?.({ entryId: id, phase: "synced", tracking });

    // Only now is the ciphertext disposable. Before the server confirmed
    // the complaint exists, deleting the queue entry would be the one way
    // to genuinely lose a citizen's filing.
    await deleteSubmission(id);
    onEvent?.({ entryId: id, phase: "removed", tracking });

    return { outcome: "synced", tracking };
  } catch (error) {
    if (error?.name === "AbortError") {
      await setState(id, OFFLINE_STATES.PENDING);
      return { outcome: "aborted" };
    }

    const retryable = !(error instanceof KioskRequestError) || error.retryable;
    const terminal = !retryable || attempt >= MAX_ATTEMPTS;

    if (sessionToken) {
      // Best effort. Leaving the session open would hold a Storage
      // policy for the rest of its ten minutes for nothing.
      revokeUploadSession(
        { token: sessionToken, fingerprint: payload.fingerprint },
        { signal }
      ).catch(() => {});
    }

    await setState(
      id,
      terminal ? OFFLINE_STATES.NEEDS_ATTENTION : OFFLINE_STATES.FAILED,
      { error: error?.code || error?.message || "sync failed" }
    );
    onEvent?.({ entryId: id, phase: "failed", terminal });

    return {
      outcome: terminal ? "needs_attention" : "retry",
      message: error?.code || null,
    };
  }
}

/**
 * Runs a full sync pass over the queue.
 *
 * Entries are processed oldest first and one at a time. Parallelism
 * would gain very little here, and serial processing means the
 * staffing data stays consistent while the queue drains.
 *
 * @param {object}   [options]
 * @param {AbortSignal} [options.signal]
 * @param {Function} [options.onEvent]
 * @returns {Promise<{ synced: number, failed: number, needsAttention: number, tracking: string[] }>}
 */
export async function syncQueue({ signal, onEvent } = {}) {
  const summary = { synced: 0, failed: 0, needsAttention: 0, tracking: [] };

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return summary;
  }

  await releaseStaleSyncing();

  const rows = await listQueue();
  for (const row of rows) {
    if (signal?.aborted) break;
    if (row.state === OFFLINE_STATES.SYNCED) {
      await deleteSubmission(row.id);
      continue;
    }

    const delay = BACKOFF_MS[Math.min(row.attemptCount || 0, BACKOFF_MS.length - 1)];
    try {
      await sleep(delay, signal);
    } catch {
      break;
    }

    const result = await syncEntry(row.id, { signal, onEvent });
    if (result.outcome === "synced") {
      summary.synced += 1;
      if (result.tracking) summary.tracking.push(result.tracking);
    } else if (result.outcome === "needs_attention") {
      summary.needsAttention += 1;
    } else if (result.outcome === "retry" || result.outcome === "failed") {
      summary.failed += 1;
    }
  }

  return summary;
}

/** Asks the browser to wake us when connectivity returns. */
export async function requestBackgroundSync(tag = "kiosk-outbox") {
  try {
    // navigator.serviceWorker.ready does not settle until a worker is
    // ACTIVE and controlling this page. On a first visit, or when
    // registration is blocked outright (plain http on a LAN address, a
    // private window, kiosk policy), it can stay pending forever, and an
    // awaited promise that never settles means the tag is never
    // registered at all. Bounding the wait turns that into a clean
    // "unsupported here", which the interval drain handles.
    const registration = await Promise.race([
      navigator.serviceWorker?.ready,
      new Promise((resolve) => setTimeout(() => resolve(null), 3000)),
    ]);

    if (!registration || !("sync" in registration)) return false;
    await registration.sync.register(tag);
    return true;
  } catch {
    return false;
  }
}

/** Housekeeping on load: recover crashes, drop abandoned entries. */
export async function prepareQueue() {
  try {
    const recovered = await releaseStaleSyncing();
    const pruned = await pruneExpired();
    return { recovered, pruned };
  } catch {
    // A kiosk with a locked or full database must still file online.
    return { recovered: 0, pruned: 0 };
  }
}

/**
 * Session probe used by the QR evidence screen.
 *
 * `expires_at` comes from the server and is the truth; the local
 * UPLOAD_SESSION_MS is only used to start the countdown before the
 * first response arrives.
 */
export function sessionExpiryHint() {
  return new Date(Date.now() + UPLOAD_SESSION_MS).toISOString();
}

export { pollUploadSession, submitComplaint };
