import assert from "node:assert/strict";
import { test } from "node:test";
import { selectKioskOrigin } from "../lib/kiosk/origin.mjs";
import { buildKioskStatusUrl, buildKioskUploadUrl } from "../lib/kiosk/urls.js";

test("local hotspot QR links retain their LAN origin and route", () => {
  const origin = selectKioskOrigin({ NODE_ENV: "development", KIOSK_LAN_HOST: "192.168.1.23" });
  assert.equal(buildKioskUploadUrl(origin, "abc"), "http://192.168.1.23:3000/kiosk/upload/abc");
  assert.equal(buildKioskStatusUrl(origin, "def"), "http://192.168.1.23:3000/kiosk/status/def");
});

test("production requires a configured clean HTTPS origin", () => {
  assert.equal(selectKioskOrigin({ NODE_ENV: "production", KIOSK_PUBLIC_ORIGIN: "https://barangay.example" }),
    "https://barangay.example");
  for (const value of ["http://barangay.example", "https://barangay.example/kiosk",
    "https://barangay.example?token=1", "https://user:secret@barangay.example", "javascript:alert(1)"]) {
    assert.equal(selectKioskOrigin({ NODE_ENV: "production", KIOSK_PUBLIC_ORIGIN: value }), "");
  }
  assert.equal(selectKioskOrigin({ NODE_ENV: "production", KIOSK_LAN_HOST: "192.168.1.23" }), "");
});

test("preview may use Vercel's HTTPS deployment domain without changing production", () => {
  assert.equal(selectKioskOrigin({ NODE_ENV: "production", VERCEL_ENV: "preview", VERCEL_URL: "preview.example.vercel.app" }),
    "https://preview.example.vercel.app");
  assert.equal(selectKioskOrigin({ NODE_ENV: "production", VERCEL_ENV: "production", VERCEL_URL: "temporary.vercel.app" }), "");
});
