import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getPostLoginRoute } from "@/lib/roleRoutes";

/**
 * Portal prefixes, each mapped to the app_role that owns it.
 *
 * The role is always read from public.profiles (below), never
 * from the URL, a cookie, or anything the client controls. The
 * URL only decides WHICH portal is being asked for; the profile
 * decides whether the caller is allowed to be there.
 */
const PORTAL_PREFIXES = [
  { prefix: "/captain", role: "captain" },
  { prefix: "/oic", role: "oic" },
  { prefix: "/secretary", role: "secretary" },
  // A Lupon member is NOT an official, but /lupon is just as
  // protected: it needs a signed-in user with the lupon role.
  { prefix: "/lupon", role: "lupon" },
  // A PNP officer is an external partner, not a barangay official.
  // /pnp is protected the same way and must never be satisfied by a
  // captain/oic/secretary account, however active that account is.
  { prefix: "/pnp", role: "pnp_officer" },
  { prefix: "/resident", role: "resident" },
] as const;

type PortalPrefix = (typeof PORTAL_PREFIXES)[number];

type MaybeOfficialRole = Parameters<typeof getPostLoginRoute>[0];

function findPortal(pathname: string): PortalPrefix | undefined {
  return PORTAL_PREFIXES.find(
    (entry) => pathname === entry.prefix || pathname.startsWith(`${entry.prefix}/`)
  );
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const url = request.nextUrl.clone();
  const pathname = url.pathname;

  const withSessionCookies = (res: NextResponse) => {
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      res.cookies.set(cookie);
    });
    return res;
  };

  const redirectTo = (path: string) =>
    withSessionCookies(NextResponse.redirect(new URL(path, request.url)));

  const portal = findPortal(pathname);

  if (portal && !user) {
    return redirectTo("/");
  }

  if (user && portal) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role, account_status")
      .eq("id", user.id)
      .single();

    if (!profile?.role) {
      await supabase.auth.signOut();
      return redirectTo("/");
    }

    const role = profile.role as MaybeOfficialRole;
    const status = profile.account_status as string | null | undefined;

    if (status === "suspended" || status === "disabled") {
      await supabase.auth.signOut();
      return redirectTo("/");
    }

    if (
      (profile.role === "oic" ||
        profile.role === "secretary" ||
        profile.role === "lupon" ||
        profile.role === "pnp_officer") &&
      status !== "active"
    ) {
      await supabase.auth.signOut();
      return redirectTo("/");
    }

    // Single role check for every portal. Previously the
    // official branches and the resident branch were handled
    // separately, and the resident branch explicitly ALLOWED
    // profiles.role = 'lupon' through. A Lupon member is not a
    // resident and must not reach /resident/*.
    if (profile.role !== portal.role) {
      return redirectTo(getPostLoginRoute(role));
    }
  }

  if (
    user &&
    (pathname === "/login" || pathname === "/register" || pathname === "/")
  ) {
    // Client-side AuthRedirect handles role-based redirect from login.
    return supabaseResponse;
  }

  return supabaseResponse;
}
