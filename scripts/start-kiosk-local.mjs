import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { isIP } from "node:net";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = 3000;

function isPrivate(ip) {
  if (isIP(ip) !== 4) return false;
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function localAddresses() {
  return Object.entries(networkInterfaces()).flatMap(([name, addresses]) =>
    addresses.filter((item) => item.family === "IPv4" && !item.internal && isPrivate(item.address))
      .map((item) => ({ name, ip: item.address }))
  );
}

// Windows exposes interface index, operational status, default gateway and
// route/interface metrics. Names alone cannot distinguish Wi-Fi from a VPN.
const windowsRoutes = `
$ErrorActionPreference = 'Stop'
$routes = @(Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' | Where-Object { $_.NextHop -ne '0.0.0.0' })
$result = foreach ($route in $routes) {
  $adapter = Get-NetAdapter -InterfaceIndex $route.InterfaceIndex -ErrorAction SilentlyContinue
  $iface = Get-NetIPInterface -InterfaceIndex $route.InterfaceIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue
  $addresses = @(Get-NetIPAddress -InterfaceIndex $route.InterfaceIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.AddressState -eq 'Preferred' })
  foreach ($address in $addresses) {
    [pscustomobject]@{
      ip = $address.IPAddress
      gateway = $route.NextHop
      metric = [int]$route.RouteMetric + [int]$iface.InterfaceMetric
      up = ($adapter.Status -eq 'Up' -and $iface.ConnectionState -eq 'Connected')
      physical = ($adapter.HardwareInterface -eq $true)
    }
  }
}
ConvertTo-Json -InputObject @($result) -Compress -Depth 3
`;

function chooseAddress(addresses) {
  const override = process.env.KIOSK_LAN_HOST?.trim();
  if (override) {
    if (!isPrivate(override) || !addresses.some((item) => item.ip === override)) {
      throw new Error("KIOSK_LAN_HOST must be a private IPv4 currently assigned to this laptop (check ipconfig).");
    }
    return { ip: override, note: "Manual KIOSK_LAN_HOST override" };
  }

  if (process.platform !== "win32") {
    if (addresses.length !== 1) throw new Error("Cannot unambiguously select a LAN interface; set KIOSK_LAN_HOST to an active private IPv4.");
    return { ip: addresses[0].ip, note: "Only active private IPv4 interface" };
  }

  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", windowsRoutes], {
    encoding: "utf8", timeout: 12000, windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw new Error("Could not inspect Windows default routes. Set KIOSK_LAN_HOST after checking ipconfig.");
  }
  let routes;
  try {
    routes = JSON.parse(result.stdout);
  } catch {
    throw new Error("Could not read Windows network routes. Set KIOSK_LAN_HOST after checking ipconfig.");
  }
  const candidates = [...new Map(routes
    .filter((route) => route.up && route.physical && isPrivate(route.ip) &&
      addresses.some((item) => item.ip === route.ip) && isIP(route.gateway) === 4 &&
      Number.isFinite(route.metric))
    .sort((a, b) => a.metric - b.metric)
    .map((route) => [route.ip, route])).values()];

  if (!candidates.length) {
    throw new Error("No active physical adapter with a private IPv4 and default gateway found. Connect to the hotspot or set KIOSK_LAN_HOST.");
  }
  if (candidates.length > 1 && candidates[0].metric === candidates[1].metric) {
    throw new Error(`Ambiguous network routes (${candidates.map((item) => item.ip).join(", ")}). Set KIOSK_LAN_HOST to the hotspot IPv4 shown by ipconfig.`);
  }
  return {
    ip: candidates[0].ip,
    note: candidates.length > 1
      ? `Selected lowest-metric active physical default route (${candidates.map((item) => `${item.ip}: ${item.metric}`).join(", ")}); override with KIOSK_LAN_HOST if this is not the hotspot`
      : "Active physical default route; verified against the laptop's assigned addresses",
  };
}

async function startLocalMlService() {
  if (process.env.ML_SERVICE_URL?.replace(/\/$/, "") !== "http://127.0.0.1:8000" ||
      !process.env.ML_API_KEY) return null;

  // A separately started service can be shared with this dev server.
  try {
    const response = await fetch("http://127.0.0.1:8000/health", {
      signal: AbortSignal.timeout(1000),
    });
    if (response.ok) {
      const health = await response.json();
      console.log(`[ml] Existing service: ${health.models_loaded ? "models ready" : "models unavailable"}`);
      return null;
    }
  } catch {
    // No service is listening; start the local virtual environment below.
  }

  const python = resolve(root, "ml-backend/.venv/Scripts/python.exe");
  if (!existsSync(python)) {
    console.warn("[ml] Local Python environment missing; see ml-backend/README.md to install it.");
    return null;
  }

  const service = spawn(python, ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000"], {
    cwd: resolve(root, "ml-backend"),
    env: process.env,
    stdio: "inherit",
  });
  service.on("error", (error) => console.warn(`[ml] Could not start service: ${error.message}`));
  service.on("exit", (code) => {
    if (code !== 0 && code !== null) console.warn(`[ml] Service exited with code ${code}; suggestions are unavailable.`);
  });
  console.log("[ml] Starting local complaint classifier on http://127.0.0.1:8000");
  return service;
}

loadEnvConfig(root, true);
try {
  const selected = chooseAddress(localAddresses());
  console.log(`[kiosk] ${selected.note}`);
  console.log(`[kiosk] QR origin: http://${selected.ip}:${port} (open the phone on the same hotspot)`);
  const mlService = await startLocalMlService();
  const child = spawn(process.execPath, [resolve(root, "node_modules/next/dist/bin/next"),
    "dev", "--hostname", "0.0.0.0", "--port", String(port)], {
    cwd: root,
    env: { ...process.env, KIOSK_LAN_HOST: selected.ip, KIOSK_APP_PORT: String(port) },
    stdio: "inherit",
  });
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      child.kill(signal);
      mlService?.kill(signal);
    });
  }
  child.on("error", (error) => {
    mlService?.kill();
    console.error(`[kiosk] Next.js failed to start: ${error.message}`);
    process.exitCode = 1;
  });
  child.on("exit", (code) => { mlService?.kill(); process.exitCode = code ?? 0; });
} catch (error) {
  console.error(`[kiosk] ${error.message}`);
  process.exitCode = 1;
}
