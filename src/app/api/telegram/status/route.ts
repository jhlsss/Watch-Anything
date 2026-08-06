import { NextResponse } from "next/server";

import { createClient as createAdminClient } from "@/lib/supabase/admin";
import { createClient as createServerClient } from "@/lib/supabase/server";

async function getAuthenticatedUser() {
  const client = await createServerClient();
  const { data, error } = await client.auth.getUser();

  if (error || !data.user) {
    return null;
  }

  return data.user;
}

export async function GET(): Promise<NextResponse> {
  const user = await getAuthenticatedUser();

  if (!user) {
    return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("telegram_connections")
    .select("telegram_username")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("Telegram status lookup failed.", error);
    return NextResponse.json({ error: "TELEGRAM_STATUS_FAILED" }, { status: 500 });
  }

  return NextResponse.json({
    connected: Boolean(data),
    username: data?.telegram_username ?? null,
  });
}
