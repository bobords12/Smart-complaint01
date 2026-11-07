import { isIP } from "node:net";

// Pure selector shared by the server boundary and deployment regression checks.
export function selectKioskOrigin(env) {
  if (env.NODE_ENV === "production") {
    const configured = env.KIOSK_PUBLIC_ORIGIN ||
      (env.VERCEL_ENV === "preview" && env.VERCEL_URL ? `https://${env.VERCEL_URL}` : "");
    try {
      const origin = new URL(configured);
      if (origin.protocol !== "https:" || origin.username || origin.password ||
          origin.pathname !== "/" || origin.search || origin.hash || !origin.hostname) return "";
      return origin.origin;
    } catch {
      return "";
    }
  }

  const host = env.KIOSK_LAN_HOST;
  const port = env.KIOSK_APP_PORT || "3000";
  const [first, second] = (host || "").split(".").map(Number);
  const privateIp = first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168);
  if (isIP(host) !== 4 || !privateIp || !/^\d{1,5}$/.test(port) || +port < 1 || +port > 65535) return "";
  return `http://${host}:${port}`;
}
