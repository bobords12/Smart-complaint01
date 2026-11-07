import { redirect } from "next/navigation";

/**
 * The portal's own address, `/pnp`.
 *
 * There is no dashboard markup here on purpose: middleware already
 * owns the guard for this prefix (lib/supabase/middleware.ts matches
 * `/pnp` exactly as well as everything under it), so an officer who is
 * not a signed-in, active PNP officer is turned away before this page
 * is ever reached. What was missing was the page itself — `/pnp` was
 * the one URL in the portal that answered 404.
 */
export default function Page() {
  redirect("/pnp/dashboard");
}
