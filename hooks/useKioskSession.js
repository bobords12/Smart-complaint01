"use client";

/**
 * Kiosk language, connection state, and the shared inactivity timer.
 *
 * Grouped in one file because each is a small piece of session-wide
 * kiosk state that every screen needs and no screen owns. Hooks, not
 * context: the kiosk tree is shallow and a provider would only add
 * indirection between the header and the form.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_LANGUAGE, HTML_LANG, translate } from "@/lib/kiosk/i18n";
import { INACTIVITY_COUNTDOWN_SECONDS, INACTIVITY_WARNING_MS } from "@/lib/kiosk/config";

/**
 * Current UI language and a bound translator.
 *
 * Changing this re-renders everything and, crucially, re-renders
 * validation messages too: the validators return i18n KEYS, never
 * sentences, so a field that was wrong stays wrong and simply says so
 * in the new language. Nothing is persisted, because a shared kiosk
 * must not inherit the previous walk-in's preference.
 */
export function useKioskLanguage() {
  const [language, setLanguage] = useState(DEFAULT_LANGUAGE);

  // Keep the document metadata honest for screen readers.
  useEffect(() => {
    document.documentElement.lang = HTML_LANG[language] || "en";
  }, [language]);

  const toggle = useCallback(() => {
    setLanguage((previous) => (previous === "en" ? "pil" : "en"));
  }, []);

  const t = useCallback(
    (key, replacements) => translate(language, key, replacements),
    [language]
  );

  const other = language === "en" ? "pil" : "en";

  return { language, setLanguage, toggle, other, t };
}

/**
 * Online / Offline / Reconnecting.
 *
 * `navigator.onLine` is famously optimistic, so being online is treated
 * as a hypothesis rather than a fact. `verify()` performs a real
 * request; while one is outstanding the state is 'reconnecting'. That
 * is what keeps the kiosk from telling a citizen it is online when the
 * upstream is unreachable behind a captive portal.
 */
export function useKioskConnection() {
  const [state, setState] = useState("online");

  useEffect(() => {
    const update = () => {
      setState(navigator.onLine ? "online" : "offline");
    };
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  /** Flips to 'reconnecting' for the duration of a call, then resolves. */
  const verify = useCallback(async (operation) => {
    if (!navigator.onLine) {
      setState("offline");
      throw Object.assign(new Error("offline"), { code: "network" });
    }
    setState("reconnecting");
    try {
      const result = await operation();
      setState("online");
      return result;
    } catch (error) {
      setState(error?.code === "network" ? "offline" : "online");
      throw error;
    }
  }, []);

  return { state, isOffline: state === "offline", verify };
}

/**
 * The inactivity privacy timer.
 *
 * On a shared kiosk the real threat is not someone reading a stranger's
 * name off the screen, it is the next walk-in finding the previous one's
 * form still filled in. So the timer warns at four minutes, the citizen
 * gets thirty seconds, and if nobody answers the whole session is
 * thrown away.
 *
 * Two details that are easy to get wrong:
 *
 *  - Activity is only real interaction. A moving mouse with no buttons
 *    pressed does not count, otherwise a visitor idling in front of the
 *    screen would keep a half-finished complaint alive indefinitely.
 *  - The countdown is paused by the warning modal itself. Otherwise the
 *    modal's own animation frames, or a stray touch on the overlay,
 *    would reset the thirty seconds and the citizen could never be
 *    timed out at all.
 */
export function useKioskInactivity({ enabled = true, onTimeout }) {
  const [warning, setWarning] = useState(false);
  const [remaining, setRemaining] = useState(INACTIVITY_COUNTDOWN_SECONDS);

  // Refs rather than state: the clock is read every second by a timer
  // and must never itself cause a render. Seeded in a mount effect rather
  // than with Date.now() at render time, which would make the first
  // render's output depend on when it happened.
  const lastActivity = useRef(null);
  const warned = useRef(false);
  const timeoutRef = useRef(onTimeout);

  useEffect(() => {
    lastActivity.current = Date.now();
  }, []);

  // Kept current so the countdown callback never closes over a stale
  // handler and never has to be torn down and rebuilt when it changes.
  useEffect(() => {
    timeoutRef.current = onTimeout;
  }, [onTimeout]);

  const markActive = useCallback(() => {
    if (warning) return;
    lastActivity.current = Date.now();
    warned.current = false;
  }, [warning]);

  const dismiss = useCallback(() => {
    setWarning(false);
    setRemaining(INACTIVITY_COUNTDOWN_SECONDS);
    lastActivity.current = Date.now();
    warned.current = false;
  }, []);
  // Real interaction only, and never while the modal is up.
  useEffect(() => {
    if (!enabled) return undefined;

    const events = ["pointerdown", "keydown", "touchstart", "wheel", "focusin"];
    const handler = () => markActive();

    events.forEach((name) =>
      window.addEventListener(name, handler, { passive: true })
    );
    // The visual tab of the browser is activity too: somebody came back.
    const onVisible = () => {
      if (document.visibilityState === "visible") markActive();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      events.forEach((name) => window.removeEventListener(name, handler));
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, markActive]);

  // The warning trigger.
  useEffect(() => {
    if (!enabled) return undefined;

    const timer = setInterval(() => {
      if (warning) return;
      if (lastActivity.current === null) {
        lastActivity.current = Date.now();
        return;
      }
      const idle = Date.now() - lastActivity.current;
      if (idle >= INACTIVITY_WARNING_MS && !warned.current) {
        warned.current = true;
        setRemaining(INACTIVITY_COUNTDOWN_SECONDS);
        setWarning(true);
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [enabled, warning]);

  // The countdown, then the reset.
  useEffect(() => {
    if (!warning) return undefined;

    const timer = setInterval(() => {
      setRemaining((previous) => {
        if (previous <= 1) {
          clearInterval(timer);
          setWarning(false);
          timeoutRef.current?.();
          return INACTIVITY_COUNTDOWN_SECONDS;
        }
        return previous - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [warning]);

  // A successful filing should not be interrupted by a privacy prompt.
  const suspend = useCallback(() => setWarning(false), []);

  return useMemo(
    () => ({ warning, remaining, dismiss, suspend, markActive }),
    [warning, remaining, dismiss, suspend, markActive]
  );
}

/** True when the citizen asked for less motion. */
export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return reduced;
}