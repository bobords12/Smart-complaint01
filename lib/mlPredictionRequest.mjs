const BROAD = { CIVIL: "Civil", CRIMINAL: "Criminal", Administrative: "Administrative" };
const DEFAULT_TIMEOUT_MS = 3500;

export function mlRequestTimeout(value) {
  const timeout = Number(value);
  return Number.isInteger(timeout) && timeout >= 500 && timeout <= 60000
    ? timeout
    : DEFAULT_TIMEOUT_MS;
}

// Pure transport contract so the existing server integration can be tested without Supabase.
export async function requestMlPrediction({ text, url, key, timeoutMs = DEFAULT_TIMEOUT_MS, fetcher = fetch }) {
  if (!url || !key || typeof text !== "string" || !text.trim() || text.length > 5000) return null;
  let endpoint;
  try {
    endpoint = new URL(url);
    if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password ||
        (process.env.NODE_ENV === 'production' && endpoint.protocol !== 'https:')) return null;
    endpoint.pathname = `${endpoint.pathname.replace(/\/$/, '')}/api/ml/predict`;
    endpoint.search = '';
    endpoint.hash = '';
  } catch {
    return null;
  }
  try {
    const response = await fetcher(endpoint.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-ML-API-Key": key },
      body: JSON.stringify({ complaint_text: text }),
      signal: AbortSignal.timeout(mlRequestTimeout(timeoutMs)), cache: "no-store",
    });
    if (!response.ok) return null;
    const result = await response.json();
    if (!Object.hasOwn(BROAD, result.broad_classification) ||
        typeof result.specific_category !== "string" ||
        !result.specific_category.trim() || result.specific_category.length > 120 ||
        typeof result.model_version !== "string" || result.model_version.length > 60) return null;
    return { caseType: BROAD[result.broad_classification],
      category: result.specific_category, modelVersion: result.model_version };
  } catch {
    return null;
  }
}
