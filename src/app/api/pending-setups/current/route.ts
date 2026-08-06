import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient as createAdminClient } from "@/lib/supabase/admin";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { radarRulesSchema } from "@/lib/validation/radar-rules";

const SETUP_COOKIE = "wa_setup";
const setupIdSchema = z.string().uuid();

async function getCurrentUser() {
  const client = await createServerClient();
  const { data, error } = await client.auth.getUser();

  if (error || !data.user) {
    return null;
  }

  return data.user;
}

function clearSetupCookie(response: NextResponse): NextResponse {
  response.cookies.set({
    name: SETUP_COOKIE,
    value: "",
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 0,
    expires: new Date(0),
    path: "/",
  });

  return response;
}

export async function GET(): Promise<NextResponse> {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });
  }

  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(SETUP_COOKIE)?.value;
  const setupId = setupIdSchema.safeParse(cookieValue);

  if (!setupId.success) {
    return clearSetupCookie(NextResponse.json({ setup: null }));
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("pending_radar_setups")
    .select("id, original_prompt, radar_name, rules, expires_at")
    .eq("id", setupId.data)
    .eq("user_id", user.id)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (error) {
    console.error("Pending setup lookup failed.", error);
    return NextResponse.json({ error: "PENDING_SETUP_LOOKUP_FAILED" }, { status: 500 });
  }

  if (!data) {
    return clearSetupCookie(NextResponse.json({ setup: null }));
  }

  const rules = radarRulesSchema.safeParse(data.rules);

  if (!rules.success) {
    console.error("Pending setup contains invalid rules.");
    return NextResponse.json({ error: "PENDING_SETUP_INVALID" }, { status: 500 });
  }

  return NextResponse.json({
    setup: {
      id: data.id,
      originalPrompt: data.original_prompt,
      radarName: data.radar_name,
      rules: rules.data,
      expiresAt: data.expires_at,
    },
  });
}
