import { z } from "zod";

const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
});

const serverEnvSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  CRON_SECRET: z.string().min(1),
  RULE_TOKEN_SECRET: z.string().min(32),
  TAVILY_API_KEY: z.string().min(1),
  GEMINI_API_KEY: z.string().min(1),
  GEMINI_MODEL: z.string().min(1).default("gemini-3.1-flash-lite"),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_BOT_USERNAME: z.string().min(1),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(1),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;
export type ServerEnv = z.infer<typeof serverEnvSchema>;
export type EnvironmentInput = Record<string, unknown>;

const publicEnvironment = (): EnvironmentInput => ({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
});

const serverEnvironment = (): EnvironmentInput => ({
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  CRON_SECRET: process.env.CRON_SECRET,
  RULE_TOKEN_SECRET: process.env.RULE_TOKEN_SECRET,
  TAVILY_API_KEY: process.env.TAVILY_API_KEY,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GEMINI_MODEL: process.env.GEMINI_MODEL,
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_BOT_USERNAME: process.env.TELEGRAM_BOT_USERNAME,
  TELEGRAM_WEBHOOK_SECRET: process.env.TELEGRAM_WEBHOOK_SECRET,
});

function throwEnvironmentError(error: z.ZodError): never {
  const issue = error.issues[0];
  const variableName = issue?.path[0] ?? "UNKNOWN_ENVIRONMENT_VARIABLE";
  throw new Error(`Invalid environment variable: ${String(variableName)}`);
}

export function parsePublicEnv(input: EnvironmentInput = publicEnvironment()): PublicEnv {
  const result = publicEnvSchema.safeParse(input);

  if (!result.success) {
    throwEnvironmentError(result.error);
  }

  return result.data;
}

export function parseServerEnv(input: EnvironmentInput = serverEnvironment()): ServerEnv {
  const result = serverEnvSchema.safeParse(input);

  if (!result.success) {
    throwEnvironmentError(result.error);
  }

  return result.data;
}
