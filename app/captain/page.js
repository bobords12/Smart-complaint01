import { redirect } from "next/navigation";

/**
 * The portal's own address, `/captain`.
 *
 * Middleware owns the guard for this prefix (lib/supabase/middleware.ts
 * matches `/captain` exactly as well as everything under it), so only a
 * signed-in Captain reaches it. What was missing was the page itself:
 * `/captain` answered 404.
 */
export default function Page() {
  redirect("/captain/dashboard");
}
