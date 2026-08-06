import { NextResponse } from "next/server";

import { createBindingToken } from "@/lib/telegram/binding-token";
import { parseServerEnv } from "@/lib/env";
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

export async function POST(): Promise<NextResponse> {
  const user = await getAuthenticatedUser();

  if (!user) {
    return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });
  }

  try {
    const env = parseServerEnv();
    const binding = createBindingToken();
    const admin = createAdminClient();
    const { error } = await admin.from("telegram_binding_tokens").insert({
      user_id: user.id,
      token_hash: binding.tokenHash,
      expires_at: binding.expiresAt,
    });

    if (error) {
      console.error("Telegram binding token creation failed.", error);
      return NextResponse.json(
        { error: "BINDING_TOKEN_CREATE_FAILED" },
        { status: 500 },
      );
    }

    const username = env.TELEGRAM_BOT_USERNAME.replace(/^@/u, "");
    return NextResponse.json({
      botUrl: `https://t.me/${username}?start=${binding.token}`,
      expiresAt: binding.expiresAt,
    });
  } catch (error) {
    console.error("Telegram binding token route failed.", error);
    return NextResponse.json(
      { error: "BINDING_TOKEN_CREATE_FAILED" },
      { status: 500 },
    );
  }
}

export async function GET(): Promise<NextResponse> {
  return POST();
}
