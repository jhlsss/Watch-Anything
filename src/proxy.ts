import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import { parsePublicEnv } from "@/lib/env";

function isProtectedPath(pathname: string) {
  return (
    pathname === "/dashboard" ||
    pathname.startsWith("/radars") ||
    pathname === "/connect-telegram"
  );
}

function authRedirect(request: NextRequest) {
  const url = request.nextUrl.clone();
  url.pathname = "/auth";
  url.searchParams.set("mode", "login");
  url.searchParams.set(
    "next",
    request.nextUrl.pathname === "/connect-telegram"
      ? "connect-telegram"
      : "dashboard",
  );

  return url;
}

export async function proxy(request: NextRequest) {
  const env = parsePublicEnv();
  let response = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });

          response = NextResponse.next({
            request,
          });

          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });

          Object.entries(headers).forEach(([key, value]) => {
            response.headers.set(key, value);
          });
        },
      },
    },
  );

  const claimsResult = await supabase.auth.getClaims();
  const claims = claimsResult.data?.claims ?? null;

  if (!claims && isProtectedPath(request.nextUrl.pathname)) {
    const redirectResponse = NextResponse.redirect(authRedirect(request));

    response.cookies.getAll().forEach((cookie) => {
      redirectResponse.cookies.set(cookie);
    });

    return redirectResponse;
  }

  return response;
}

export const config = {
  matcher: ["/dashboard/:path*", "/radars/:path*", "/connect-telegram/:path*"],
};
