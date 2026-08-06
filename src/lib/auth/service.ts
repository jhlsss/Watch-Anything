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

export type AuthServiceInput = {
  email: string;
  password: string;
  next?: string;
};

export type AuthServiceResult = {
  data: {
    user: User | null;
    session: AuthResponse["data"]["session"];
  };
  error: AuthResponse["error"];
  next: "/dashboard" | "/connect-telegram";
};

export function resolveSafeNext(next: unknown): "/dashboard" | "/connect-telegram" {
  return next === "connect-telegram" ? "/connect-telegram" : "/dashboard";
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
): Promise<AuthServiceResult> {
  const credentials = parseCredentials(input);
  const supabase = await resolveClient(client);
  const result = await supabase.auth.signUp({
    ...credentials,
    options: {
      emailRedirectTo: undefined,
    },
  });

  return {
    ...result,
    next: resolveSafeNext(input.next),
  };
}
