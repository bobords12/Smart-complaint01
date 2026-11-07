"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { TriangleAlert } from "lucide-react";

import KioskHeader from "@/components/kiosk/KioskHeader";
import KioskBottomBar, { KioskLiveRegion } from "@/components/kiosk/KioskBottomBar";
import KioskInactivityModal from "@/components/kiosk/KioskInactivityModal";
import KioskWelcome from "@/components/kiosk/KioskWelcome";
import KioskIntro from "@/components/kiosk/KioskIntro";
import KioskAccountChoice from "@/components/kiosk/KioskAccountChoice";
import KioskIdentityStep from "@/components/kiosk/KioskIdentityStep";
import KioskConfirmStep from "@/components/kiosk/KioskConfirmStep";
import KioskOtherPartyStep from "@/components/kiosk/KioskOtherPartyStep";
import KioskIncidentStep from "@/components/kiosk/KioskIncidentStep";
import KioskNarrativeStep from "@/components/kiosk/KioskNarrativeStep";
import KioskEvidenceStep from "@/components/kiosk/KioskEvidenceStep";
import KioskQrEvidence from "@/components/kiosk/KioskQrEvidence";
import KioskEvidenceReceived from "@/components/kiosk/KioskEvidenceReceived";
import KioskReviewing from "@/components/kiosk/KioskReviewing";
import KioskReviewStep from "@/components/kiosk/KioskReviewStep";
import KioskSuccess from "@/components/kiosk/KioskSuccess";
import KioskOfflineSaved from "@/components/kiosk/KioskOfflineSaved";

import { SCREENS, useKioskWizard } from "@/hooks/useKioskWizard";
import {
  useKioskConnection,
  useKioskInactivity,
  useKioskLanguage,
} from "@/hooks/useKioskSession";
import { openUploadSession, pollUploadSession, submitComplaint } from "@/lib/kiosk/api";
import { buildKioskUploadUrl } from "@/lib/kiosk/urls";
import { buildSubmission } from "@/lib/kiosk/payload";
import { getFingerprint } from "@/lib/kiosk/device";
import { isOfflineQueueAvailable, queueSubmission } from "@/lib/kiosk/offlineStore";
import { prepareQueue, requestBackgroundSync, syncQueue } from "@/lib/kiosk/sync";

/** How often the QR screen asks the server what a phone has delivered.
 *
 * 30 s, not 3 s: kiosk_upload_session_status allows 240 polls per hour
 * per fingerprint (kiosk-03 SQL), and a persisted fingerprint shared by
 * every test in the last hour made faster polling exhaust the budget
 * mid-session — after which every poll is rejected and the screen can
 * only show a connection error. At 30 s the budget is 120/hour, so the
 * screen can stay open indefinitely without tripping the limiter. */
const POLL_INTERVAL_MS = 30000;
/**
 * Cooldown after the server rejects a poll with "Too many requests".
 *
 * The SQL limiter (kiosk_upload_session_status: 240/hour per
 * fingerprint) answers HTTP 400 with the generic code `rejected` — the
 * same code every kiosk RAISE carries — so the message text is what
 * identifies a rate limit here. The route sends no Retry-After header,
 * and the window is server state the client cannot read, so instead of
 * probing continuously the poller backs off in bounded steps: 5 min,
 * then 10, then 15 (capped). One probe per cooldown is enough to
 * discover when the window has rolled, and a successful poll resets the
 * ladder back to normal 30-second polling.
 */
const RATE_LIMIT_BASE_MS = 5 * 60 * 1000;
const RATE_LIMIT_MAX_MS = 15 * 60 * 1000;
/**
 * How close to expiry is "too close" for reusing an upload session.
 *
 * A session whose window is nearly gone is not worth going back to:
 * the phone could not finish an upload inside the remainder, and
 * every second shaved off the window is a second the final submit
 * has less room to link the files (kiosk_submit_complaint only
 * links evidence while the session is still live). Anything with
 * more than this much headroom is reused as-is, so an "Add more"
 * round-trip keeps every file under ONE draft reference — the value
 * the submit RPC needs to find the session.
 */
const SESSION_REUSE_MARGIN_MS = 15000;

/**
 * True when a kiosk API error is the rate limiter speaking.
 *
 * Every kiosk SQL RAISE surfaces as code `rejected`, so code alone
 * cannot distinguish "too many requests" from a validation refusal.
 * The two rate-limit messages the kiosk SQL can produce both start
 * with "Too many", and both are authored by this project — no user
 * input can ever appear inside them.
 */
function isRateLimitRejection(error) {
  return (
    error?.code === "rejected" &&
    typeof error?.message === "string" &&
    /^too many/i.test(error.message)
  );
}
/** How long the acknowledgement screen stays up before moving on. */
const REVIEWING_DELAY_MS = 1400;
/** How often the outbox is drained while the kiosk is online. */
const SYNC_INTERVAL_MS = 30000;

/**
 * The kiosk orchestrator.
 *
 * Every one of the reference screens is rendered from here, so the whole
 * filing flow is one React tree with one set of state. That is a privacy
 * requirement as much as a code-organisation one: a complaint exists only
 * while this component is mounted, and the inactivity reset unmounts it.
 *
 * The mapping is deliberately explicit rather than data-driven:
 *
 *   welcome / intro / account      unnumbered entry screens
 *   FORM + step 1..7                the seven numbered steps
 *   QR_EVIDENCE / EVIDENCE_RECEIVED the two evidence sub-screens
 *   REVIEWING                       a timed acknowledgement
 *   SUBMITTED / OFFLINE_SAVED       the two receipts
 */
export default function KioskClient({ lanOrigin }) {
  const router = useRouter();

  const { t, language, toggle } = useKioskLanguage();
  const connection = useKioskConnection();
  const wizard = useKioskWizard();
  const {
    screen,
    step,
    form,
    errors,
    attempted,
    evidence,
    uploadSession,
    receipt,
    submitting,
    header,
    progressPercent,
  } = wizard;

  // Offline-queue lifecycle for the CURRENT receipt, so the offline
  // screen can show syncing → synced without re-reading the queue.
  const [syncState, setSyncState] = useState("pending");
  const [submitError, setSubmitError] = useState(null);
  const [evidenceError, setEvidenceError] = useState(null);
  const [polling, setPolling] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  // Set once the server reports the session expired, so the interval
  // stops burning the hourly poll budget on a session that can never
  // become active again. Reset when a new session is opened.
  const pollStopped = useRef(false);
  // Rate-limit pause state. Until `rateLimitedUntil` passes, the poll
  // callback returns without sending anything, so the pause is a real
  // pause and not a faster failure loop. Both reset when a poll
  // succeeds or a new session opens.
  const rateLimitedUntil = useRef(0);
  const rateLimitStrikes = useRef(0);

  const fingerprint = useRef(null);
  // "pending" until the digest resolves. It is NOT optional: the server's
  // requireFingerprint rejects a missing value, so a kiosk that submits
  // without one gets an opaque 400 after the citizen has already filled in
  // all seven steps. An earlier version of this comment claimed the
  // server "treats it as an unknown device rather than failing", which is
  // not what requireFingerprint does.
  const [sessionState, setSessionState] = useState("pending");

  // ── Device fingerprint ───────────────────────────────────────
  // Resolved once. It is used for rate limiting and for the upload
  // session, and it is deliberately not part of the reset: clearing it
  // would let anybody defeat the kiosk's rate limit with a button press.
  useEffect(() => {
    let cancelled = false;
    getFingerprint()
      .then((value) => {
        if (cancelled) return;
        fingerprint.current = value;
        setSessionState("ready");
      })
      .catch(() => {
        // IndexedDB or SubtleCrypto is unavailable: private browsing, a
        // locked-down kiosk profile, or storage denied. The citizen is
        // told plainly instead of being walked through seven screens that
        // were never going to save anything.
        if (!cancelled) setSessionState("unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Housekeeping on load ─────────────────────────────────────
  useEffect(() => {
    prepareQueue().catch(() => {});
  }, []);

  // ── Submission ───────────────────────────────────────────────
  const submitOnline = useCallback(
    async (payload) => {
      const response = await submitComplaint(payload);
      const result = response.result || response;
      const linked = result.evidence_count ?? 0;
      const expected = Array.isArray(payload.evidence) ? payload.evidence.length : 0;
      return {
        synced: true,
        referenceNumber: result.reference_number,
        statusToken: payload.statusToken,
        submittedAt: result.submitted_at,
        alreadySubmitted: result.already_submitted === true,
        evidenceCount: linked,
        // kiosk_submit_complaint links evidence only while the upload
        // session is still live, and it reports how many files it
        // actually linked. A short count is a REAL partial failure —
        // usually a session that expired between upload and submit —
        // and the receipt must say so explicitly instead of showing
        // the same unqualified success as a fully linked filing.
        evidencePartial: expected > linked ? { linked, expected } : null,
        // The server tells us whether a confirmation SMS was queued
        // for this complaint. It is a fact about a queued job, NOT a
        // claim that a message was delivered: the receipt says the
        // SMS is being processed and says nothing more.
        smsQueued: response.sms?.queued === true,
      };
    },
    []
  );

  /**
   * Queues the complaint locally.
   *
   * Two honest limits of this path, both stated rather than hidden:
   *
   *  - Evidence cannot be queued. The only evidence route in the design
   *    is a phone scanning a QR code, which needs a working connection,
   *    so an offline filing has no attachments. The encrypted-blob path
   *    in offlineStore exists and is used for the payload; a local file
   *    picker would be the only way to also queue bytes, and the design
   *    has none.
   *  - Without usable storage the citizen cannot be left holding a form
   *    that silently vanishes. If IndexedDB is unavailable while
   *    offline, filing is refused with an explanation instead.
   */
  const submitOffline = useCallback(async (payload) => {
    if (!isOfflineQueueAvailable()) {
      const error = new Error("storage-unavailable");
      error.code = "storage_unavailable";
      throw error;
    }

    const { id, queuedAt } = await queueSubmission({ payload, evidence: [] });

    // Ask the browser to wake us when connectivity returns. If the
    // Background Sync API is missing, the interval below still covers it
    // while this tab is open, and the next kiosk load covers the rest.
    requestBackgroundSync().catch(() => {});

    return {
      synced: false,
      queueId: id,
      queuedAt,
      // Local, not an official number: derived from the draft reference
      // the citizen's own device generated. Labelled as pending
      // everywhere it appears.
      referenceNumber: `AB-${String(payload.draftReference || "")
        .replace(/-/g, "")
        .slice(0, 8)
        .toUpperCase()}`,
    };
  }, []);

  const handleSubmit = useCallback(async () => {
    setSubmitError(null);

    // Re-validate everything one last time. A value can have gone stale
    // while the citizen walked away from the review screen.
    const offender = wizard.revalidateAll();
    if (offender) return;

    // A missing fingerprint is a hard stop, not something to send and
    // let the server reject. Sending it wasted the whole filing and
    // surfaced only as "something went wrong".
    if (!fingerprint.current) {
      setSubmitError("err.sessionUnavailable");
      return;
    }

    wizard.beginSubmit();

    try {
      const { body } = buildSubmission(form, evidence, {
        fingerprint: fingerprint.current,
        // The upload session's SERVER-issued draft reference is what
        // kiosk_submit_complaint uses to find the session and link
        // its files to this complaint (step 10 of the SQL). Omitting
        // it made buildSubmission fall back to a fresh random UUID,
        // which matches no session — so every submission reported
        // evidence_linked: 0 and the phone's uploads were orphaned.
        // The wizard keeps the RPC response verbatim, so the key is
        // the snake_case one the server sent.
        draftReference: uploadSession?.draft_reference || null,
      });

      if (connection.isOffline) {
        const next = await submitOffline(body);
        setSyncState("pending");
        wizard.showReceipt(next);
        setAnnouncement(t("offline.savedTitle"));
        return;
      }

      try {
        const next = await connection.verify(() => submitOnline(body));
        wizard.showReceipt(next);
        setAnnouncement(`${t("success.title")} ${next.referenceNumber}`);
      } catch (error) {
        // A network failure while we believed we were online is the
        // offline case, not a hard failure: the complaint is queued
        // instead of lost.
        if (error.code === "network" || error.code === "unavailable") {
          const next = await submitOffline(body);
          setSyncState("pending");
          wizard.showReceipt(next);
          setAnnouncement(t("offline.savedTitle"));
          return;
        }
        setSubmitError(error.code === "rate_limited" ? "err.rateLimited" : "err.submitFailed");
      }
    } catch (error) {
      setSubmitError(
        error.code === "storage_unavailable" ? "err.quota" : "err.submitFailed"
      );
    } finally {
      wizard.endSubmit();
    }
  }, [connection, evidence, form, t, wizard, uploadSession, submitOffline, submitOnline]);

  // ── Offline queue: keep draining while the kiosk is online ──
  useEffect(() => {
    if (!navigator.onLine) return undefined;

    let cancelled = false;

    const drain = async () => {
      try {
        const summary = await syncQueue({
          onEvent: (event) => {
            if (!cancelled && event.phase === "synced") {
              setSyncState("synced");
              setAnnouncement(
                `${t("offline.synced")} ${event.tracking?.reference_number || ""}`.trim()
              );
            }
          },
        });
        if (!cancelled && summary.synced > 0 && screen === SCREENS.OFFLINE_SAVED) {
          setSyncState("synced");
        }
      } catch {
        // A failed drain is retried on the next tick.
      }
    };

    drain();
    const timer = setInterval(drain, SYNC_INTERVAL_MS);
    window.addEventListener("online", drain);

    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("online", drain);
    };
  }, [screen, t]);

  // ── Inactivity ───────────────────────────────────────────────
  // Suspended on the receipts: a citizen reading their tracking number
  // must not be timed out and thrown back to the welcome screen.
  const inactivityEnabled =
    screen !== SCREENS.SUBMITTED && screen !== SCREENS.OFFLINE_SAVED;

  const inactivity = useKioskInactivity({
    enabled: inactivityEnabled,
    onTimeout: () => {
      wizard.reset();
      setSyncState("pending");
      setSubmitError(null);
      setEvidenceError(null);
      setAnnouncement(t("nav.main"));
    },
  });

  // ── The acknowledgement screen advances itself ───────────────
  useEffect(() => {
    if (screen !== SCREENS.REVIEWING) return undefined;
    const timer = setTimeout(() => wizard.setScreen(SCREENS.FORM), REVIEWING_DELAY_MS);
    return () => clearTimeout(timer);
  }, [screen, wizard]);

  // ── Evidence: QR upload session ──────────────────────────────
  const beginEvidenceSession = useCallback(async () => {
    setEvidenceError(null);

    // Same rule as submission: the session RPC validates the
    // fingerprint too, so an empty one is reported here rather than
    // producing a QR code for a session that can never be opened.
    if (!fingerprint.current) {
      setEvidenceError("err.sessionUnavailable");
      return;
    }

    if (connection.isOffline) {
      // The session is created server-side; there is no honest way to
      // fake a QR code that would not work.
      setEvidenceError("err.network");
      return;
    }

    // Reuse the current session while it is still comfortably live.
    //
    // Every file must end up under ONE draft reference, because that
    // reference is the only key kiosk_submit_complaint has for
    // finding the session whose files it may link. Opening a SECOND
    // session for an "Add more" round-trip would strand the first
    // session's files: the submit call can carry only one draft
    // reference, so the earlier uploads could never be linked and
    // would be silently dropped. Reusing the live session keeps the
    // same QR, the same folder and the same poll loop, and costs one
    // fewer round trip. A session too close to expiry is NOT reused
    // (the phone could not finish inside the remainder) — a fresh
    // one is opened instead, and any files left over from the old
    // session are reported as unattached on the receipt rather than
    // silently lost.
    const expiryMs = Date.parse(uploadSession?.expiresAt || "");
    if (
      uploadSession?.token &&
      uploadSession?.draft_reference &&
      Number.isFinite(expiryMs) &&
      expiryMs - Date.now() > SESSION_REUSE_MARGIN_MS
    ) {
      pollStopped.current = false;
      rateLimitedUntil.current = 0;
      rateLimitStrikes.current = 0;
      wizard.setScreen(SCREENS.QR_EVIDENCE);
      return;
    }

    try {
      const response = await connection.verify(() =>
        openUploadSession({ fingerprint: fingerprint.current })
      );
      const session = response.session || response;
      pollStopped.current = false;
      // A new session deserves a fresh look: if the previous one was
      // paused by the limiter, the first poll below decides whether
      // the window has rolled rather than inheriting the old cooldown.
      rateLimitedUntil.current = 0;
      rateLimitStrikes.current = 0;
      wizard.setUploadSession({
        ...session,
        // The RPC returns a bare token; the QR payload is a kiosk URL, so
        // it is composed here rather than trusted from the server. The
        // The server-selected LAN origin remains reachable when the kiosk
        // itself is open at localhost.
        uploadUrl: buildKioskUploadUrl(lanOrigin, session.token),
        // The RPC names it `expires_at` but the countdown reads
        // `expiresAt`, so without this the screen shows "--:--" for the
        // whole ten minutes and looks broken even though the code is good.
        expiresAt: session.expiresAt ?? session.expires_at,
      });
      wizard.setScreen(SCREENS.QR_EVIDENCE);
    } catch (error) {
      setEvidenceError(
        isRateLimitRejection(error) || error.code === "rate_limited"
          ? "err.rateLimited"
          : "err.network"
      );
    }
  }, [connection, lanOrigin, uploadSession, wizard]);

  /**
   * Asks the server which files a phone has actually delivered.
   *
   * Only files whose storage object really exists are offered. The server
   * reports `uploaded` by checking for the object rather than trusting the
   * registration timestamp, and this screen honours that: showing a file
   * whose bytes never arrived would put a broken attachment into the
   * review screen and then into the complaint.
   */
  const pollEvidence = useCallback(async () => {
    if (!uploadSession?.token || polling || pollStopped.current) return;
    // Rate-limited: the cooldown has not elapsed. Returning BEFORE
    // setPolling means no request leaves the browser at all — the
    // interval keeps time, but the server is not probed until the
    // cooldown expires, at which point exactly one probe decides
    // whether polling resumes.
    if (Date.now() < rateLimitedUntil.current) return;
    setPolling(true);

    try {
      const response = await pollUploadSession({
        token: uploadSession.token,
        fingerprint: fingerprint.current || "",
      });
      // GET /api/kiosk/upload/session wraps the RPC result as
      // { ok, status }. An earlier version read only `response.session`
      // (the POST shape), got the envelope instead, found no `files`
      // on it, and therefore rendered "0 files received" forever no
      // matter what the phone delivered. Both keys are accepted so the
      // reader cannot fall out of step with either route shape again.
      const status = response.status || response.session || response;

      if (status.state === "expired") {
        // Stop polling: a dead session only wastes the hourly budget,
        // and the message below never changes.
        pollStopped.current = true;
        setEvidenceError("err.linkExpired");
        return;
      }

      // A successful answer ends any rate-limit pause and clears any
      // transient error a previous poll left behind (dev-server
      // restart, HMR gap, momentary network blip, or the "Too many
      // requests" message above). Without this, one failed poll kept
      // "Unable to connect" on screen for the rest of the session
      // even though every later poll was succeeding.
      rateLimitedUntil.current = 0;
      rateLimitStrikes.current = 0;
      setEvidenceError((current) =>
        current === "err.network" || current === "err.rateLimited" ? null : current
      );

      const delivered = (status.files || []).filter((file) => file.uploaded === true);
      const known = new Set(evidence.map((file) => file.id));
      const fresh = delivered.filter((file) => !known.has(file.id));

      if (fresh.length > 0) {
        wizard.addEvidence(
          fresh.map((file) => ({
            id: file.id,
            name: file.name,
            mime_type: file.mime_type,
            size: file.size,
            previewUrl: null,
          }))
        );
        setAnnouncement(
          `${delivered.length} ${t("qr.filesReceived")}`
        );
      }
    } catch (error) {
      if (isRateLimitRejection(error)) {
        // Bounded backoff (see RATE_LIMIT_BASE_MS): 5, 10, then 15
        // minutes, held in a ref so the interval's ticks during the
        // pause are cheap no-ops instead of requests. The accurate
        // message replaces the old "Unable to connect", which wrongly
        // blamed the network for a deliberate server refusal.
        rateLimitStrikes.current = Math.min(rateLimitStrikes.current + 1, 3);
        rateLimitedUntil.current =
          Date.now() +
          Math.min(
            RATE_LIMIT_BASE_MS * 2 ** (rateLimitStrikes.current - 1),
            RATE_LIMIT_MAX_MS
          );
        setEvidenceError("err.rateLimited");
      } else {
        setEvidenceError(
          error.code === "rate_limited" ? "err.rateLimited" : "err.network"
        );
      }
    } finally {
      setPolling(false);
    }
  }, [evidence, polling, t, uploadSession, wizard]);

  useEffect(() => {
    if (screen !== SCREENS.QR_EVIDENCE || !uploadSession?.token) return undefined;
    const timer = setInterval(pollEvidence, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [screen, pollEvidence, uploadSession?.token]);

  const finishEvidence = useCallback(() => {
    setEvidenceError(null);
    // Land on the confirmation screen whenever anything actually
    // arrived, so the citizen is told what was received before being
    // taken to the review screen.
    if (evidence.length > 0) {
      wizard.setScreen(SCREENS.EVIDENCE_RECEIVED);
      return;
    }
    wizard.setStep("review");
    wizard.setScreen(SCREENS.REVIEWING);
  }, [evidence.length, wizard]);

  const proceedToReview = useCallback(() => {
    setEvidenceError(null);
    wizard.setStep("review");
    wizard.setScreen(SCREENS.REVIEWING);
  }, [wizard]);

  const skipEvidence = useCallback(() => {
    wizard.setField("evidenceMethod", "skip");
    setEvidenceError(null);
    wizard.advance();
  }, [wizard]);

  // ── Screen transitions out of the numbered steps ─────────────
  // Evidence never blocks Continue: it is optional, so an undecided
  // citizen simply continues and the review screen says plainly that no
  // evidence is attached.
  const handleContinue = useCallback(() => {
    wizard.advance();
  }, [wizard]);

  const goToStatus = useCallback(() => router.push("/kiosk/track"), [router]);

  // ── Render ───────────────────────────────────────────────────
  const isFormScreen = screen === SCREENS.FORM || screen === SCREENS.REVIEWING;

  return (
    <>
      <KioskHeader
        t={t}
        header={header}
        progressPercent={progressPercent}
        connection={connection.state}
        language={language}
        onToggleLanguage={toggle}
      />

      <main id="kiosk-main" className="kiosk-main">
        <ScreenRouter
          screen={screen}
          t={t}
          language={language}
          wizard={wizard}
          connection={connection}
          onStart={wizard.startFiling}
          onBeginForm={wizard.beginForm}
          onCheckStatus={goToStatus}
          onContinue={handleContinue}
          onSubmit={handleSubmit}
          onBeginEvidence={beginEvidenceSession}
          onPollEvidence={pollEvidence}
          onFinishEvidence={finishEvidence}
          // The EVIDENCE_RECEIVED screen's Continue is NOT the generic
          // wizard advance: it must land on the Review and Submit flow
          // exactly like finishing evidence with nothing attached.
          // ScreenRouter is a separate component, so the handler has to
          // be passed as a prop — referencing proceedToReview inside it
          // throws a ReferenceError.
          onProceedToReview={proceedToReview}
          onSkipEvidence={skipEvidence}
          evidence={evidence}
          uploadSession={uploadSession}
          polling={polling}
          evidenceError={evidenceError}
          submitting={submitting}
          submitError={submitError}
          receipt={receipt}
          lanOrigin={lanOrigin}
          syncState={syncState}
          onRetrySync={() => {
            setSyncState("pending");
            syncQueue().catch(() => {});
          }}
        />

        {/* Said once, at the top, rather than only on the submit button.
            A citizen who cannot file should learn it on the first screen
            instead of after filling in seven steps, and the status QR
            keeps working either way because it needs no fingerprint. */}
        {sessionState === "unavailable" ? (
          <div
            role="alert"
            className="mt-4 flex items-start gap-2.5 rounded-[12px] border border-critical bg-critical-soft/60 p-3.5 text-[13px] font-semibold leading-relaxed text-critical"
          >
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{t("err.sessionUnavailable")}</span>
          </div>
        ) : null}
      </main>

      {isFormScreen ? (
        <KioskBottomBar
          t={t}
          onBack={step === "identity" ? undefined : wizard.back}
          onNext={step === "review" ? undefined : handleContinue}
          nextLabel={step === "review" ? t("nav.submit") : t("nav.continue")}
          busy={submitting}
          showHome={step === "identity"}
        />
      ) : null}

      <KioskLiveRegion message={announcement} />

      {inactivity.warning ? (
        <KioskInactivityModal
          t={t}
          remaining={inactivity.remaining}
          onStay={inactivity.dismiss}
        />
      ) : null}
    </>
  );
}

/**
 * Screen router.
 *
 * Split out so the wizard state, the hooks and the transitions all sit in
 * one readable block and the screen list is a single switch at the bottom
 * of the file. Adding a screen is a case here, not another pile of
 * conditionals inside the orchestrator.
 */
function ScreenRouter(props) {
  const {
    screen,
    t,
    language,
    wizard,
    connection,
    onStart,
    onBeginForm,
    onCheckStatus,
    onContinue,
    onSubmit,
    onBeginEvidence,
    onPollEvidence,
    onFinishEvidence,
    onProceedToReview,
    onSkipEvidence,
    evidence,
    uploadSession,
    polling,
    evidenceError,
    submitting,
    submitError,
    receipt,
    lanOrigin,
    syncState,
    onRetrySync,
  } = props;

  switch (screen) {
    case SCREENS.WELCOME:
      // Not wrapped in .kiosk-page: the welcome screen is deliberately
      // full-bleed navy edge to edge.
      return <KioskWelcome t={t} onStart={onStart} />;

    case SCREENS.INTRO:
      return <KioskIntro t={t} onStart={onBeginForm} onCheckStatus={onCheckStatus} />;

    case SCREENS.ACCOUNT:
      return (
        <KioskAccountChoice
          t={t}
          onGuest={onBeginForm}
          onAccountLookup={onBeginForm}
        />
      );

    case SCREENS.QR_EVIDENCE:
      return (
        <div className="kiosk-page kiosk-page-inner">
          <KioskQrEvidence
            key={uploadSession?.token || "no-session"}
            t={t}
            session={uploadSession}
            files={evidence}
            uploading={polling}
            error={evidenceError}
            onRefresh={onPollEvidence}
            onContinue={onFinishEvidence}
            onSkip={onSkipEvidence}
          />
        </div>
      );

    case SCREENS.EVIDENCE_RECEIVED:
      return (
        <div className="kiosk-page kiosk-page-inner">
          <KioskEvidenceReceived
            t={t}
            files={evidence}
            onRemove={wizard.removeEvidence}
            onAddMore={onBeginEvidence}
            onContinue={onProceedToReview}
            onSkip={onSkipEvidence}
          />
        </div>
      );

    case SCREENS.REVIEWING:
      return <KioskReviewing t={t} />;

    case SCREENS.SUBMITTED:
      return (
        <KioskSuccess t={t} language={language} receipt={receipt} lanOrigin={lanOrigin} onDone={wizard.reset} />
      );

    case SCREENS.OFFLINE_SAVED:
      return (
        <KioskOfflineSaved
          t={t}
          language={language}
          receipt={receipt}
          state={syncState}
          onDone={wizard.reset}
          onRetry={onRetrySync}
        />
      );

    case SCREENS.FORM:
    default:
      return (
        <StepRouter
          t={t}
          language={language}
          wizard={wizard}
          connection={connection}
          onSubmit={onSubmit}
          submitting={submitting}
          submitError={submitError}
          onBeginEvidence={onBeginEvidence}
          evidenceError={evidenceError}
        />
      );
  }
}

/** The seven numbered steps. */
function StepRouter({
  t,
  language,
  wizard,
  connection,
  onSubmit,
  submitting,
  submitError,
  onBeginEvidence,
  evidenceError,
}) {
  const { step, form, errors, attempted, evidence } = wizard;
  const onChange = wizard.setField;

  switch (step) {
    case "identity":
      return (
        <KioskIdentityStep
          t={t}
          form={form}
          errors={errors}
          attempted={attempted}
          onChange={onChange}
        />
      );

    case "confirm":
      return <KioskConfirmStep t={t} form={form} onEdit={wizard.editStep} />;

    case "otherParty":
      return (
        <KioskOtherPartyStep
          t={t}
          form={form}
          errors={errors}
          attempted={attempted}
          onChange={onChange}
        />
      );

    case "incident":
      return (
        <KioskIncidentStep
          t={t}
          form={form}
          errors={errors}
          attempted={attempted}
          onChange={onChange}
        />
      );

    case "narrative":
      return (
        <KioskNarrativeStep
          t={t}
          language={language}
          form={form}
          errors={errors}
          attempted={attempted}
          onChange={onChange}
        />
      );

    case "evidence":
      return (
        <KioskEvidenceStep
          t={t}
          language={language}
          form={form}
          evidence={evidence}
          error={evidenceError}
          onChoose={(value) => {
            onChange("evidenceMethod", value);
            if (value === "qr") {
              // The QR screen renders whatever session it is handed, so
              // the session has to exist before the screen does. Jumping
              // straight to SCREENS.QR_EVIDENCE left the kiosk showing a
              // spinner and a "--:--" countdown forever, because no token
              // was ever requested from the server.
              onBeginEvidence();
            }
          }}
        />
      );

    case "review":
    default:
      return (
        <KioskReviewStep
          t={t}
          language={language}
          form={form}
          evidence={evidence}
          errors={errors}
          attempted={attempted}
          onEdit={wizard.editStep}
          onConsent={wizard.setConsent}
          onSubmit={onSubmit}
          submitting={submitting}
          isOffline={connection.isOffline}
          submitError={submitError}
        />
      );
  }
}
