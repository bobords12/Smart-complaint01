export function getErrorMessage(err, fallback = "Something went wrong. Please try again.") {
  if (typeof err === "string") return err || fallback;
  if (!err) return fallback;
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "object") {
    const msg =
      err.message ||
      err.error_description ||
      err.description ||
      err.error ||
      err.details ||
      err.hint;
    if (typeof msg === "string" && msg.trim()) return msg;
    try {
      const s = JSON.stringify(err);
      if (s && s !== "{}") return s;
    } catch {
      // ignore invalid circular/JSON errors
    }
  }
  return fallback;
}

export function logSupabaseError(context, ...errors) {
  const msgs = errors.filter(Boolean).map((e) => getErrorMessage(e, "Unknown error"));
  console.error(`[${context}]`, msgs.length ? msgs.join(" | ") : "Unknown error");
}