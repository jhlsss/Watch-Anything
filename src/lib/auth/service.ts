import type { AuthResponse, User } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";

type PasswordAuthClient = {
  auth: {
    signInWithPassword(credentials: {
      email: string;
      password: string;
    }): Promise<AuthResponse>;
    signUp(credentials: {
      email: string;
      password: string;
      options: {
        emailRedirectTo?: string;
      };
    }): Promise<AuthResponse>;
  };
};

type AdminAuthClient = {
  auth: {
    admin: {
      createUser(credentials: {
        email: string;
        password: string;
        email_confirm: boolean;
        user_metadata?: Record<string, unknown>;
      }): Promise<{
        data: { user: User | null };
        error: AuthResponse["error"];
      }>;
    };
  };
};

export type AuthServiceInput = {
  email: string;
  password: string;
  fullName?: string;
  next?: string;
};

export type AuthServiceResult = {
  data: {
    user: User | null;
    session: AuthResponse["data"]["session"];
  };
  error: AuthResponse["error"];
  next: "/dashboard" | "/radars" | "/connect-telegram";
};

export function resolveSafeNext(next: unknown): "/dashboard" | "/radars" | "/connect-telegram" {
  if (next === "connect-telegram") {
    return "/connect-telegram";
  }

  return next === "radars" ? "/radars" : "/dashboard";
}

function parseCredentials(input: AuthServiceInput) {
  const email = input.email.trim();

  if (!email.includes("@")) {
    throw new Error("Invalid auth input");
  }

  if (input.password.length < 8) {
    throw new Error("Invalid auth input");
  }

  return {
    email,
    password: input.password,
  };
}

async function resolveClient(client?: PasswordAuthClient) {
  return client ?? (await createClient());
}

async function resolveAdminClient(client?: AdminAuthClient): Promise<AdminAuthClient> {
  if (client) {
    return client;
  }

  const { createClient: createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient() as unknown as AdminAuthClient;
}

export async function signInWithPassword(
  input: AuthServiceInput,
  client?: PasswordAuthClient,
): Promise<AuthServiceResult> {
  const credentials = parseCredentials(input);
  const supabase = await resolveClient(client);
  const result = await supabase.auth.signInWithPassword(credentials);

  return {
    ...result,
    next: resolveSafeNext(input.next),
  };
}

export async function signUpWithPassword(
  input: AuthServiceInput,
  client?: PasswordAuthClient,
  adminClient?: AdminAuthClient,
): Promise<AuthServiceResult> {
  const credentials = parseCredentials(input);
  const supabase = await resolveClient(client);
  const admin = await resolveAdminClient(adminClient);
  const result = await admin.auth.admin.createUser({
    ...credentials,
    email_confirm: true,
    ...(input.fullName?.trim()
      ? { user_metadata: { full_name: input.fullName.trim() } }
      : {}),
  });

  if (result.error) {
    return {
      data: { user: result.data.user, session: null },
      error: result.error,
      next: resolveSafeNext(input.next),
    };
  }

  const signInResult = await supabase.auth.signInWithPassword(credentials);

  return {
    ...signInResult,
    next: resolveSafeNext(input.next),
  };
}
