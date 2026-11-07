/** Read-only checks of bucket privacy and the masters used by current generators. */
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import nextEnv from "@next/env";
import { MASTER_TEMPLATES } from "../lib/documents/docxTemplate.js";

nextEnv.loadEnvConfig(fileURLToPath(new URL("../", import.meta.url)));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Read-only verification requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  process.exitCode = 1;
} else {
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  let failed = false;
  for (const bucket of ["templates", "documents", "evidence"]) {
    const { data, error } = await client.storage.getBucket(bucket);
    const privateBucket = data && data.public === false;
    console.log(`${privateBucket ? "PASS" : "FAIL"} ${bucket}: private bucket${error ? " unavailable" : ""}`);
    if (!privateBucket) failed = true;
  }
  // The Notice is generated programmatically now; the active master-based
  // generators are the Respondent Summons and short Amicable Settlement.
  for (const name of ["summons", "amicable_settlement"]) {
    const { data, error } = await client.storage.from("templates").info(MASTER_TEMPLATES[name]);
    console.log(`${data && !error ? "PASS" : "FAIL"} ${name}: configured master ${data ? "exists" : "not readable"}`);
    if (!data || error) failed = true;
    else if (!Number.isFinite(data.size) || !data.contentType) {
      console.log(`FAIL ${name}: Storage info did not expose size and content type`);
      failed = true;
    }
  }
  process.exitCode = failed ? 1 : 0;
}
