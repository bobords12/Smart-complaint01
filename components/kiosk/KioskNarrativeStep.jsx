"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Mic, MicOff } from "lucide-react";
import { Field, TextArea, Note } from "./KioskField";
import { MAX_NARRATIVE_CHARS, MIN_NARRATIVE_CHARS } from "@/lib/kiosk/config";

/**
 * Step 5 — Complaint narrative.
 *
 * The single most important field in the whole kiosk, and the only one
 * where a citizen has to produce content rather than pick an option.
 * Three decisions here:
 *
 *  - The textarea is generously sized and typed into directly. A
 *    contenteditable div would give richer formatting and a great deal
 *    of accessibility trouble; a plain <textarea> gives native
 *    spellcheck, native screen-reader behaviour and paste support.
 *  - newlines are preserved exactly, because a complaint narrative is
 *    the complainant's own statement. A "rich text" layer that silently
 *    reflows their sentences is not an improvement.
 *  - Speech input is offered only when the browser actually implements
 *    it. Web Speech is not universal, is often absent in kiosk mode, and
 *    has to be feature-detected rather than assumed. When it is absent
 *    the button is disabled and the reason is stated, instead of
 *    clicking and silently doing nothing.
 */
/**
 * Speech recognition availability.
 *
 * Read through useSyncExternalStore rather than a mount effect, so the
 * server snapshot (false) and the client snapshot can disagree without a
 * hydration error. There is nothing to subscribe to: browser support for
 * webkitSpeechRecognition does not change at runtime.
 */
function subscribeToSpeechSupport() {
  return () => {};
}

function readSpeechSupport() {
  return Boolean(
    typeof window !== "undefined" &&
      (window.SpeechRecognition || window.webkitSpeechRecognition)
  );
}

const SPEECH_UNSUPPORTED = () => false;

export default function KioskNarrativeStep({ t, language, form, errors, attempted, onChange }) {
  const value = form.narrative || "";
  const [listening, setListening] = useState(false);
  const speechSupported = useSyncExternalStore(
    subscribeToSpeechSupport,
    readSpeechSupport,
    SPEECH_UNSUPPORTED
  );
  const recognitionRef = useRef(null);

  // Any navigation away must leave the microphone off. An abandoned
  // recognition session keeps the browser's recording indicator lit and
  // quietly consumes the audio.
  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.stop();
      } catch {
        // Already stopped.
      }
      recognitionRef.current = null;
    };
  }, []);

  function toggleSpeech() {
    if (!speechSupported) return;

    if (listening) {
      recognitionRef.current?.stop();
      return;
    }

    const Impl = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Impl) return;

    const recognition = new Impl();
    recognition.lang = language === "pil" ? "fil-PH" : "en-PH";
    recognition.continuous = true;
    recognition.interimResults = false;
    recognitionRef.current = recognition;

    recognition.onstart = () => setListening(true);
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);

    // Appended to whatever is already typed, separated by a space, so
    // dictating after typing does not overwrite the earlier sentence.
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0]?.transcript || "")
        .join(" ")
        .trim();
      if (!transcript) return;
      const base = value.trim();
      const next = base ? `${base} ${transcript}` : transcript;
      onChange("narrative", next.slice(0, MAX_NARRATIVE_CHARS));
    };

    try {
      recognition.start();
    } catch {
      // start() throws if a session is already running; treat it as
      // "not listening" rather than surfacing an error.
      setListening(false);
    }
  }

  const remaining = MAX_NARRATIVE_CHARS - value.length;
  const belowMinimum = value.trim().length > 0 && value.trim().length < MIN_NARRATIVE_CHARS;
  const overLimit = remaining < 0;
  const error = errors.narrative ? t(errors.narrative) : undefined;

  return (
    <div>
      <header className="mb-5 text-center">
        <h1 className="text-[21px] font-bold leading-tight tracking-tight text-navy sm:text-[24px]">
          {t("narrative.title")}
        </h1>
        <p className="mt-1.5 text-[15px] font-semibold text-muted">
          {t("narrative.subtitle")}
        </p>
      </header>

      <div className="kiosk-card kiosk-card-pad">
        <Field
          id="kiosk-narrative"
          label={t("narrative.label")}
          error={error}
          hint={t("narrative.helper")}
          required
        >
          {({ id, errorId, hintId, describedBy }) => (
            <TextArea
              id={id}
              value={value}
              maxLength={MAX_NARRATIVE_CHARS + 200}
              onChange={(event) => onChange("narrative", event.target.value)}
              error={Boolean(error) || overLimit}
              aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
              spellCheck
              autoCapitalize="sentences"
            />
          )}
        </Field>

        {/* Counter. Polite live region: it changes on every keystroke,
            and assertive would interrupt a slow typist every time. */}
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p
            className={`text-[12.5px] ${
              overLimit ? "font-semibold text-critical" : "text-muted"
            }`}
            aria-live="polite"
          >
            {value.length} / {MAX_NARRATIVE_CHARS} {t("narrative.counter")}
          </p>

          <button
            type="button"
            onClick={toggleSpeech}
            disabled={!speechSupported}
            aria-pressed={listening}
            className={`kiosk-btn kiosk-btn-ghost min-h-[44px] px-3.5 text-[13px] ${
              listening ? "border-critical text-critical" : ""
            }`}
          >
            {listening ? (
              <>
                <MicOff className="h-4 w-4" aria-hidden="true" />
                {t("nav.close")}
              </>
            ) : (
              <>
                <Mic className="h-4 w-4" aria-hidden="true" />
                {t("narrative.speak")}
              </>
            )}
          </button>
        </div>

        {/* Only shown while the citizen is between the minimum and the
            limit, i.e. at the moment the note is actionable. */}
        {belowMinimum ? (
          <p className="mt-2 text-[12.5px] text-muted" role="status">
            {t("err.narrativeShort")}
          </p>
        ) : null}
      </div>

      {speechSupported ? null : (
        <Note tone="info" className="mt-4">
          {t("narrative.speakUnsupported")}
        </Note>
      )}

      {attempted && errors.narrative ? (
        <p className="mt-3 text-[12.5px] text-muted">{t("identity.errorSummary")}</p>
      ) : null}
    </div>
  );
}
