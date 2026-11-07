import { redirect } from "next/navigation";

/**
 * The portal's own address, `/lupon`.
 *
 * Middleware owns the guard for this prefix (lib/supabase/middleware.ts
 * matches `/lupon` exactly as well as everything under it), so only a
 * signed-in, active Lupon member reaches it. What was missing was the
 * page itself: `/lupon` answered 404, which is a strange first thing to
 * see at the portal's own address.
 */
export default function Page() {
  redirect("/lupon/dashboard");
}
