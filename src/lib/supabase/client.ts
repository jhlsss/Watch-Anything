import { createBrowserClient } from "@supabase/ssr";

import { parsePublicEnv } from "@/lib/env";

export function createClient() {
  const env = parsePublicEnv();

  return createBrowserClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}
