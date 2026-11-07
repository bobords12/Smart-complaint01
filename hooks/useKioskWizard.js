"use client";

/**
 * Wizard state machine for the public kiosk.
 *
 * Kept as one hook rather than a page component because the whole
 * filing flow has to survive a language switch, an Edit-and-return
 * from the review screen, and an inactivity reset without ever writing
 * anything to localStorage. Holding the state here makes that obvious:
 * it exists only while this React tree is mounted.
 *
 * Screens, not steps. The reference designs show nineteen distinct
 * screens, but only seven of them are numbered steps. Modelling those
 * nineteen as "steps" would be the single easiest way to end up with a
 * header that says "Step 8 of 7", so the two concepts are kept apart:
 *
 *   screen  - what is on screen, including the welcome page, the
 *             three-phase intro, the QR waiting screen and the two
 *             receipts. Not numbered.
 *   step    - one of KIOSK_STEPS, always 1..7. The header renders
 *             `stepNumber(currentStep)` and `TOTAL_STEPS`, both from
 *             the same array, so they cannot disagree.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  KIOSK_STEPS,
  STEP_INDEX,
  TOTAL_STEPS,
  createEmptyForm,
  stepNumber,
} from "@/lib/kiosk/config";
import { validateAll, validateStep, hasErrors } from "@/lib/kiosk/validation";

export const SCREENS = {
  WELCOME: "welcome",
  INTRO: "intro",
  ACCOUNT: "account",
  FORM: "form",
  QR_EVIDENCE: "qrEvidence",
  EVIDENCE_RECEIVED: "evidenceReceived",
  REVIEWING: "reviewing",
  SUBMITTED: "submitted",
  OFFLINE_SAVED: "offlineSaved",
};

/** Screens that expose a numbered step to the header. */
const STEP_SCREENS = new Set([
  "identity",
  "confirm",
  "otherParty",
  "incident",
  "narrative",
  "evidence",
  "review",
]);

export function useKioskWizard() {
  const [screen, setScreen] = useState(SCREENS.WELCOME);
  const [step, setStep] = useState(KIOSK_STEPS[0].id);
  const [form, setForm] = useState(createEmptyForm);
  const [errors, setErrors] = useState({});
  const [attempted, setAttempted] = useState(false);

  /**
   * Files the citizen attached during this session.
   *
   * Kept as `{ id, name, mime_type, size, previewUrl }` where previewUrl
   * is an object URL the reset path is responsible for revoking. Storing
   * the descriptors rather than the File objects keeps the review screen
   * from holding tens of megabytes of blobs alive.
   */
  const [evidence, setEvidence] = useState([]);

  const [uploadSession, setUploadSessionValue] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const objectUrls = useRef(new Set());

  // ── Object URL lifetime ─────────────────────────────────────
  // Every URL handed to an <img> or an <a download> is registered here
  // so a privacy reset can revoke all of them at once. Leaking them
  // would keep a previous walk-in's photo readable from memory.
  const trackUrl = useCallback((url) => {
    if (url) objectUrls.current.add(url);
    return url;
  }, []);

  const revokeUrls = useCallback((urls) => {
    urls.forEach((url) => {
      if (!url) return;
      try {
        URL.revokeObjectURL(url);
      } catch {
        // Already revoked; nothing to clean up.
      }
      objectUrls.current.delete(url);
    });
  }, []);

  // ── Navigation ──────────────────────────────────────────────
  const startFiling = useCallback(() => {
    setForm(createEmptyForm());
    setErrors({});
    setAttempted(false);
    setEvidence([]);
    setStep(KIOSK_STEPS[0].id);
    setScreen(SCREENS.INTRO);
  }, []);

  const beginForm = useCallback(() => {
    setStep(KIOSK_STEPS[0].id);
    setScreen(SCREENS.FORM);
  }, []);

  const goToWelcome = useCallback(() => {
    setScreen(SCREENS.WELCOME);
  }, []);

  /**
   * Moves one step forward after validating the current one.
   *
   * Returns true when the step advanced. A false return means the form
   * did not change, so callers can leave focus where it is and let the
   * error summary handle announcement.
   */
  const advance = useCallback(() => {
    const stepErrors = validateStep(step, form);
    if (hasErrors(stepErrors)) {
      setErrors((previous) => ({ ...previous, ...stepErrors }));
      setAttempted(true);
      return false;
    }
    setErrors((previous) => {
      const next = { ...previous };
      Object.keys(stepErrors).forEach((key) => delete next[key]);
      return next;
    });

    const index = STEP_INDEX[step];
    if (index < TOTAL_STEPS - 1) {
      const next = KIOSK_STEPS[index + 1];
      setStep(next.id);
      if (next.id === "review") {
        setScreen(SCREENS.REVIEWING);
      } else {
        setScreen(SCREENS.FORM);
      }
    }
    return true;
  }, [step, form]);

  const back = useCallback(() => {
    setAttempted(false);
    const index = STEP_INDEX[step];

    if (index > 0) {
      setStep(KIOSK_STEPS[index - 1].id);
      setScreen(SCREENS.FORM);
      return;
    }

    // Step 1 with nothing filled in goes back to the account choice
    // rather than all the way to the welcome page, which keeps the
    // "guest" decision editable without restarting the session.
    const hasIdentityData = Boolean(
      form.complainant.firstName ||
        form.complainant.mobile ||
        form.complainant.houseStreet
    );
    setScreen(hasIdentityData ? SCREENS.ACCOUNT : SCREENS.INTRO);
  }, [step, form.complainant]);

  /**
   * Jumps to a step from an Edit link on the review screen.
   *
   * Every other field is preserved. That is the entire reason Edit links
   * exist, so nothing here touches `form` except the step itself.
   */
  const editStep = useCallback((stepId) => {
    if (!(stepId in STEP_INDEX)) return;
    setAttempted(false);
    setStep(stepId);
    setScreen(SCREENS.FORM);
  }, []);

  /** Re-validation pass, run again immediately before submitting. */
  const revalidateAll = useCallback(() => {
    const all = validateAll(form);
    setErrors(all);
    setAttempted(true);
    if (!hasErrors(all)) return null;

    // Send the citizen to the earliest step that is wrong, which is
    // more useful than dumping them on the review screen.
    const order = ["identity", "otherParty", "incident", "narrative", "review"];
    for (const candidate of order) {
      const stepErrors = validateStep(candidate, form);
      if (hasErrors(stepErrors)) {
        setStep(candidate);
        setScreen(SCREENS.FORM);
        return candidate;
      }
    }
    return null;
  }, [form]);

  // ── Form mutation ───────────────────────────────────────────
  const setField = useCallback((path, value) => {
    setForm((previous) => {
      const next = { ...previous };
      const parts = path.split(".");
      let cursor = next;
      for (let i = 0; i < parts.length - 1; i += 1) {
        cursor[parts[i]] = { ...cursor[parts[i]] };
        cursor = cursor[parts[i]];
      }
      cursor[parts[parts.length - 1]] = value;
      return next;
    });

    // Clear a field's error as soon as the citizen edits it, so the
    // red state never contradicts what is on screen.
    setErrors((previous) => {
      if (!(path in previous)) return previous;
      const next = { ...previous };
      delete next[path];
      return next;
    });
  }, []);

  const setConsent = useCallback((key, value) => {
    setForm((previous) => ({ ...previous, consent: { ...previous.consent, [key]: value } }));
    setErrors((previous) => {
      const path = `consent.${key}`;
      if (!(path in previous)) return previous;
      const next = { ...previous };
      delete next[path];
      return next;
    });
  }, []);

  // ── Evidence ────────────────────────────────────────────────
  const addEvidence = useCallback(
    (files) => {
      setEvidence((previous) => [...previous, ...files.map((f) => ({ ...f, previewUrl: trackUrl(f.previewUrl) }))]);
    },
    [trackUrl]
  );

  const removeEvidence = useCallback(
    (id) => {
      setEvidence((previous) => {
        const target = previous.find((file) => file.id === id);
        revokeUrls(target ? [target.previewUrl] : []);
        return previous.filter((file) => file.id !== id);
      });
    },
    [revokeUrls]
  );

  const setUploadSession = useCallback((session) => {
    setUploadSessionValue(session);
  }, []);

  // ── Submission ──────────────────────────────────────────────
  const beginSubmit = useCallback(() => setSubmitting(true), []);
  const endSubmit = useCallback(() => setSubmitting(false), []);

  const showReceipt = useCallback((next) => {
    setReceipt(next);
    setScreen(next.synced ? SCREENS.SUBMITTED : SCREENS.OFFLINE_SAVED);
  }, []);

  /**
   * Full reset for a privacy timeout.
   *
   * Runs when the inactivity countdown expires, and when a citizen
   * finishes. Notably it does NOT touch the offline queue: a queued
   * complaint belongs to the citizen who filed it, not to whoever sits
   * down next, and it must keep syncing. It also never touches the
   * device fingerprint, because throttling the kiosk by throwing that
   * away would let anyone reset the rate limit with a button press.
   */
  const reset = useCallback(() => {
    revokeUrls(Array.from(objectUrls.current));
    objectUrls.current.clear();
    setForm(createEmptyForm());
    setErrors({});
    setAttempted(false);
    setEvidence([]);
    setUploadSession(null);
    setReceipt(null);
    setStep(KIOSK_STEPS[0].id);
    setScreen(SCREENS.WELCOME);
  }, [revokeUrls, setUploadSession]);

  // Unmounting the wizard must not leave previews alive.
  useEffect(() => {
    const urls = objectUrls.current;
    return () => {
      urls.forEach((url) => {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // Nothing to do.
        }
      });
      urls.clear();
    };
  }, []);

  // ── Derived header state ────────────────────────────────────
  // The header shows a step number only when a numbered step is on
  // screen. Computing it here from the same KIOSK_STEPS array the
  // progress bar uses is what makes "Step 4 of 7" and
  // "Hakbang 4 ng 7" structurally impossible to desynchronise.
  const header = useMemo(() => {
    // A step number is shown only while a numbered step is actually on
    // screen. The welcome page, the three-phase intro, the account
    // choice, the QR upload and both receipts keep `step` set to
    // whatever it was, so testing `step` alone would put "Step 1 of 7"
    // above the welcome page.
    const onStepScreen =
      screen === SCREENS.FORM || screen === SCREENS.REVIEWING;
    if (!onStepScreen || !STEP_SCREENS.has(step)) {
      return { visible: false, number: 0, total: TOTAL_STEPS, id: step };
    }
    const number = stepNumber(step);
    return { visible: true, number, total: TOTAL_STEPS, id: step };
  }, [step, screen]);

  const progressPercent = useMemo(() => {
    if (!header.visible) return 0;
    return Math.round((header.number / header.total) * 100);
  }, [header]);

  return {
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

    setScreen,
    setStep,
    setEvidence,
    setUploadSession,
    setField,
    setConsent,
    addEvidence,
    removeEvidence,

    startFiling,
    beginForm,
    back,
    advance,
    editStep,
    goToWelcome,
    revalidateAll,
    beginSubmit,
    endSubmit,
    showReceipt,
    reset,
    revokeUrls,
  };
}