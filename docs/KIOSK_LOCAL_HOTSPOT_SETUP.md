# Kiosk QR access on a local hotspot (Windows)

## Start and connect

1. Turn on your phone's **Mobile Hotspot** and connect the Windows laptop to that Wi-Fi network. Keep the phone and laptop on the same network; check that the hotspot permits connected devices to reach each other. The phone must also have internet access for Supabase (and the laptop must be able to reach the configured Supabase API/Storage).
2. In **Windows CMD**, from the project directory, run:

   ```cmd
   ipconfig
   npm run dev
   ```

   Under the connected Wi-Fi adapter, note its **IPv4 Address** and **Default Gateway**. The startup script checks live private IPv4 addresses against Windows physical, connected default routes; it prefers the lowest route metric and prints the selected address. Virtual adapters with no active physical default route (for example WSL/Docker) are excluded. If multiple viable routes have the same metric, startup stops rather than guessing. If multiple routes have different metrics, read the startup message and verify that the selected address is the hotspot address from `ipconfig`.
3. The script prints `QR origin: http://<CURRENT_LAPTOP_IPV4>:3000`. Use the exact address it prints. Next.js listens on `0.0.0.0:3000`; open `http://localhost:3000/kiosk` on the laptop and `http://<CURRENT_LAPTOP_IPV4>:3000/kiosk` on the phone. Do **not** use `localhost` on the phone.

### Manual override

If detection fails or chooses another connected network, use the active **laptop** IPv4 from `ipconfig` (not the gateway or phone address) in the same CMD window:

```cmd
set KIOSK_LAN_HOST=<CURRENT_LAPTOP_IPV4>
npm run dev
```

Replace the angle-bracket placeholder with the actual numeric address. The script rejects overrides not assigned to this laptop or not private IPv4. Alternatively put `KIOSK_LAN_HOST=<CURRENT_LAPTOP_IPV4>` in your local `.env` (never a `NEXT_PUBLIC_` URL); restart the server after edits. To clear a temporary CMD override, run `set KIOSK_LAN_HOST=`. After changing hotspots, stop and re-run `npm run dev`, verify the new origin and refresh the kiosk page. Newly generated QR codes will use the new IP; old printed links cannot follow an address change. Existing database tokens/complaints are not recreated by changing the IP.

## Check both QR flows

- **Evidence:** On the laptop kiosk, start a guest complaint, reach Evidence and choose **Scan to Upload**. Confirm the visible link and QR start with the printed LAN origin and end in `/kiosk/upload/<32-hex-token>`. Scan on the phone; choose/take a photo or select a PDF (JPEG/PNG/WebP/PDF, maximum 10 MB each and five files). The phone calls the same-origin `/api/kiosk/upload/direct`; expect success and, after the kiosk polls (up to 30 seconds), a received file count. Submit the complaint while the 10-minute session is still live and check that the receipt reports attachments; an expired/revoked token must be refused. Never test by pasting a real person's QR token in shared logs.
- **Status:** Submit a test complaint once and inspect the receipt's QR and printed link: `http://<CURRENT_LAPTOP_IPV4>:3000/kiosk/status/<64-hex-token>`. Scan on the phone; the status page calls `/api/kiosk/status/token` and should show only the filing's resident-safe status. Try a malformed token to see invalid-link feedback; an unknown or expired token intentionally shows the same pending-sync view (to prevent complaint enumeration). Check retry/error feedback by temporarily disconnecting the phone. The status token is a bearer capability; don't share the link publicly.

## Connectivity and browser limitations

- If the phone cannot open the laptop address, verify the hotspot connection, the printed address and port, and that the hotspot does not isolate clients. Test `http://<CURRENT_LAPTOP_IPV4>:3000/kiosk` in the phone browser *before* scanning. Check `netstat -ano | findstr :3000` on Windows; the listener should include `0.0.0.0:3000`. Ensure another program is not using port 3000.
- On the Windows Defender Firewall prompt for Node.js, allow access for the network profile used by the hotspot. If the prompt was dismissed, review **Windows Security → Firewall & network protection → Allow an app through firewall** for Node.js on that profile (or ask the administrator to allow inbound TCP port 3000 for that network). No firewall rules are changed by this project. Recheck the IP after reconnection.
- If the page opens but the QR route or resources fail, restart Next.js and refresh the kiosk page. The detected host is also the single allowed development origin for Next.js assets/HMR; no wildcard LAN origins are allowed. Same-origin kiosk API calls use relative paths. Supabase keeps its separately configured cloud/self-hosted URL: if it is self-hosted, the laptop must reach that endpoint independently; mobile access to a self-hosted Supabase URL is needed only for any direct browser Supabase calls in the other portals.
- If the phone page loads but upload returns an error, check the server log for the specific kiosk RPC/Storage error. The existing upload route validates the token and limits through `kiosk_register_uploaded_file`, then writes to the private `evidence` bucket using the server-side service-role client. A `42501`/permission-denied RPC error means the required kiosk SQL functions or their execute grants need review; a storage write error requires checking the bucket and server-only service-role configuration. Keep RLS and the existing token checks intact; do not grant anonymous table access or place the service-role key in the browser.
- **Plain HTTP on a LAN IP is not a secure browser context.** The phone can use the file picker (camera availability through the picker depends on the device), and kiosk status lookup has a random rate-limit identifier fallback for browsers without `crypto.subtle`. Service workers, background sync, secure-context-only camera APIs (`getUserMedia`), and the encrypted offline queue are unavailable at an HTTP LAN IP. For offline filing, open the kiosk on laptop `localhost` where those browser APIs are available; both QR codes still contain the LAN address. A trusted local HTTPS deployment is required to use those features on other devices.
- Kiosk QR routes do not use Supabase Auth redirect URLs. If you test **separate authenticated portal** email sign-in/reset links on the phone, review the Supabase Auth Site URL and allowed redirect URLs for the current LAN origin; add only the exact required origin/paths for that test (and remove stale ones when done). Do not replace the Supabase API URL with the laptop's IP or expose the service-role key.
