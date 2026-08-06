import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { parsePublicEnv, parseServerEnv } from "@/lib/env";

export function createClient() {
  const publicEnv = parsePublicEnv();
  const serverEnv = parseServerEnv();

  return createSupabaseClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    serverEnv.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
