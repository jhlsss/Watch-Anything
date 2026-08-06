import OpenAI from "openai";
import { z } from "zod";
import { parseServerEnv } from "@/lib/env";

const GEMINI_OPENAI_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta/openai/";

export type AiMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type AiCompletionResult = {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
};

export type AiRequestOptions = {
  signal?: AbortSignal;
  timeout?: number;
  maxRetries?: number;
};

export interface AiLike {
  chat: {
    completions: {
      create(
        request: Record<string, unknown>,
        options?: AiRequestOptions,
      ): Promise<AiCompletionResult>;
    };
  };
}

export type AiAdapterErrorCode =
  | "AI_INVALID_RESPONSE"
  | "AI_RATE_LIMITED"
  | "AI_REQUEST_FAILED";

export class AiAdapterError extends Error {
  constructor(
    public readonly code: AiAdapterErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AiAdapterError";
  }
}

const importanceThresholdSchema = z.preprocess(
  (value) => {
    const qualitativeThresholds: Record<string, number> = {
      "very high": 90,
      high: 75,
      important: 75,
      medium: 50,
      normal: 50,
      low: 25,
      "very low": 10,
    };
    const numericValue =
      typeof value === "string" && value.trim() !== ""
        ? qualitativeThresholds[value.trim().toLowerCase()] ?? Number(value)
        : value;

    if (
      typeof numericValue === "number" &&
      Number.isFinite(numericValue) &&
      numericValue > 0 &&
      numericValue < 1
    ) {
      return Math.round(numericValue * 100);
    }

    return numericValue;
  },
  z.number().int().min(0).max(100),
);

export const parseRulesStructuredSchema = z.object({
  radar_name: z.string().trim().min(2).max(80),
  subject: z.string().trim().min(1).max(100),
  aliases: z.array(z.string().trim().min(1).max(60)).max(8),
  include_topics: z
    .array(z.string().trim().min(1).max(60))
    .min(1)
    .max(8),
  exclude_topics: z.array(z.string().trim().min(1).max(60)).max(8),
  search_query: z.string().trim().min(1).max(240),
  importance_threshold: importanceThresholdSchema,
});

export const evaluateCandidateItemSchema = z.object({
  relevant: z.boolean(),
  relevance_score: z.number().min(0).max(100),
  importance_score: z.number().min(0).max(100),
  confidence: z.number().min(0).max(1),
  event_key: z.string().min(1).nullable(),
  duplicate_of_event_key: z.string().min(1).nullable(),
  reason: z.string().min(1),
});

export const evaluateCandidatesStructuredSchema = z
  .array(evaluateCandidateItemSchema)
  .min(1)
  .max(8);

export const parseRulesJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "radar_name",
    "subject",
    "aliases",
    "include_topics",
    "exclude_topics",
    "search_query",
    "importance_threshold",
  ],
  properties: {
    radar_name: { type: "string", minLength: 2, maxLength: 80 },
    subject: { type: "string", minLength: 1, maxLength: 100 },
    aliases: {
      type: "array",
      maxItems: 8,
      items: { type: "string", minLength: 1, maxLength: 60 },
    },
    include_topics: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: { type: "string", minLength: 1, maxLength: 60 },
    },
    exclude_topics: {
      type: "array",
      maxItems: 8,
      items: { type: "string", minLength: 1, maxLength: 60 },
    },
    search_query: { type: "string", minLength: 1, maxLength: 240 },
    importance_threshold: { type: "number", minimum: 0, maximum: 100 },
  },
} as const;

export const evaluateCandidatesJsonSchema = {
  type: "array",
  minItems: 1,
  maxItems: 8,
  items: {
    type: "object",
    additionalProperties: false,
    required: [
      "relevant",
      "relevance_score",
      "importance_score",
      "confidence",
      "event_key",
      "duplicate_of_event_key",
      "reason",
    ],
    properties: {
      relevant: { type: "boolean" },
      relevance_score: { type: "number" },
      importance_score: { type: "number" },
      confidence: { type: "number" },
      event_key: {
        type: ["string", "null"],
      },
      duplicate_of_event_key: {
        type: ["string", "null"],
      },
      reason: { type: "string" },
    },
  },
} as const;

export function createGeminiClient(apiKey?: string): AiLike {
  const resolvedApiKey = apiKey ?? parseServerEnv().GEMINI_API_KEY;
  return new OpenAI({
    apiKey: resolvedApiKey,
    baseURL: GEMINI_OPENAI_BASE_URL,
  }) as unknown as AiLike;
}

export function resolveGeminiModel(): string {
  return parseServerEnv().GEMINI_MODEL;
}

function invalidResponseError(): AiAdapterError {
  return new AiAdapterError(
    "AI_INVALID_RESPONSE",
    "AI provider returned an invalid response.",
  );
}

function requestFailedError(): AiAdapterError {
  return new AiAdapterError("AI_REQUEST_FAILED", "AI provider request failed.");
}

function rateLimitedError(): AiAdapterError {
  return new AiAdapterError("AI_RATE_LIMITED", "AI provider rate limit reached.");
}

function readMessageContent(result: AiCompletionResult): string {
  const content = result.choices?.[0]?.message?.content;

  if (typeof content === "string" && content.trim() !== "") {
    return content;
  }

  throw invalidResponseError();
}

function parseStructuredContent<T>(
  rawContent: string,
  validator: z.ZodType<T>,
): T {
  let parsedJson: unknown;

  try {
    parsedJson = JSON.parse(rawContent);
  } catch {
    throw invalidResponseError();
  }

  const parsedResult = validator.safeParse(parsedJson);

  if (!parsedResult.success) {
    throw invalidResponseError();
  }

  return parsedResult.data;
}

async function runStructuredCompletion<T>({
  ai,
  model,
  schemaName,
  jsonSchema,
  messages,
  validator,
  maxCompletionTokens,
  requestOptions,
}: {
  ai: AiLike;
  model: string;
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  messages: AiMessage[];
  validator: z.ZodType<T>;
  maxCompletionTokens?: number;
  requestOptions?: AiRequestOptions;
}): Promise<T> {
  const request: Record<string, unknown> = {
    model,
    messages,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: schemaName,
        strict: true,
        schema: jsonSchema,
      },
    },
  };

  if (maxCompletionTokens !== undefined) {
    request.max_tokens = maxCompletionTokens;
  }

  const response = await ai.chat.completions.create(request, requestOptions);

  return parseStructuredContent(readMessageContent(response), validator);
}

function isRateLimitError(error: unknown): error is {
  status: 429;
  headers?: Headers;
  message?: string;
  error?: {
    code?: string;
    message?: string;
  };
} {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    error.status === 429
  );
}

function rateLimitRetryDelayMs(error: { headers?: Headers }): number {
  const retryAfterMs = error.headers?.get("retry-after-ms");

  if (retryAfterMs) {
    const delayMs = Number(retryAfterMs);

    if (Number.isFinite(delayMs) && delayMs >= 0) {
      return Math.min(delayMs, 10_000);
    }
  }

  const retryAfter = error.headers?.get("retry-after");

  if (retryAfter) {
    const delaySeconds = Number(retryAfter);

    if (Number.isFinite(delaySeconds) && delaySeconds >= 0) {
      return Math.min(delaySeconds * 1_000, 10_000);
    }

    const delayMs = Date.parse(retryAfter) - Date.now();

    if (Number.isFinite(delayMs) && delayMs >= 0) {
      return Math.min(delayMs, 10_000);
    }
  }

  return 1_000;
}

type RateLimitRetryBudget = {
  remaining: number;
};

async function runStructuredCompletionWithRateLimitRetry<T>(
  options: Parameters<typeof runStructuredCompletion<T>>[0],
  rateLimitRetryBudget: RateLimitRetryBudget,
): Promise<T> {
  try {
    return await runStructuredCompletion(options);
  } catch (error) {
    if (!isRateLimitError(error) || rateLimitRetryBudget.remaining <= 0) {
      throw error;
    }

    rateLimitRetryBudget.remaining -= 1;

    await new Promise((resolve) => {
      setTimeout(resolve, rateLimitRetryDelayMs(error));
    });

    return runStructuredCompletion(options);
  }
}

export async function createStructuredOutput<T>({
  ai,
  model,
  schemaName,
  jsonSchema,
  messages,
  validator,
  maxCompletionTokens,
  requestOptions,
}: {
  ai: AiLike;
  model: string;
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  messages: AiMessage[];
  validator: z.ZodType<T>;
  maxCompletionTokens?: number;
  requestOptions?: AiRequestOptions;
}): Promise<T> {
  const rateLimitRetryBudget: RateLimitRetryBudget = { remaining: 1 };

  try {
    return await runStructuredCompletionWithRateLimitRetry({
      ai,
      model,
      schemaName,
      jsonSchema,
      messages,
      validator,
      maxCompletionTokens,
      requestOptions,
    }, rateLimitRetryBudget);
  } catch (error) {
    if (isRateLimitError(error)) {
      throw rateLimitedError();
    }

    if (!(error instanceof AiAdapterError) || error.code !== "AI_INVALID_RESPONSE") {
      if (error instanceof AiAdapterError) {
        throw error;
      }

      throw requestFailedError();
    }

    try {
      return await runStructuredCompletionWithRateLimitRetry({
        ai,
        model,
        schemaName,
        jsonSchema,
        messages: [
          ...messages,
          {
            role: "user",
            content: `Your previous response failed validation: ${error.message} Return valid JSON only.`,
          },
        ],
        validator,
        maxCompletionTokens,
        requestOptions,
      }, rateLimitRetryBudget);
    } catch (retryError) {
      if (isRateLimitError(retryError)) {
        throw rateLimitedError();
      }

      if (retryError instanceof AiAdapterError) {
        throw retryError;
      }

      throw requestFailedError();
    }
  }
}
