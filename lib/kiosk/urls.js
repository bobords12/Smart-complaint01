/** The kiosk's two QR payloads share the same server-selected LAN origin. */
function buildTokenUrl(origin, path, token) {
  if (!origin || typeof token !== "string" || !token.trim()) return "";
  // The origin is supplied by the server, never by window.location (which
  // may be localhost on the kiosk and is unreachable from a phone).
  return `${origin}${path}${encodeURIComponent(token.trim())}`;
}

export function buildKioskUploadUrl(origin, token) {
  return buildTokenUrl(origin, "/kiosk/upload/", token);
}

export function buildKioskStatusUrl(origin, token) {
  return buildTokenUrl(origin, "/kiosk/status/", token);
}
