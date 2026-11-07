import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-only Supabase client built with the service-role key.
 *
 * Import ONLY from route handlers and server modules. The key lives in
 * `SUPABASE_SERVICE_ROLE_KEY` (never `NEXT_PUBLIC_*`, so Next.js never
 * inlines it into the browser bundle), and this module must never be imported
 * by a client component.
 *
 * Its one intended use: automatic resident Reklamo generation. The private
 * `templates` bucket is denied to residents by storage RLS, so a route handler
 * that has already verified ownership with the resident's session client
 * (`@/lib/supabase/server`) uses this client to read the master template,
 * upload the generated DOCX and record the document rows.
 */
export function createAdminClient(supabaseUrl?: string, serviceRoleKey?: string): SupabaseClient {
  const url = supabaseUrl || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = serviceRoleKey || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Supabase service-role credentials are not configured on the server.");
  }

  return createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}