import Groq from "groq-sdk";
import { z } from "zod";
import { parseServerEnv } from "@/lib/env";

type GroqMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type GroqCompletionResult = {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
};

export interface GroqLike {
  chat: {
    completions: {
      create(request: Record<string, unknown>): Promise<GroqCompletionResult>;
    };
  };
}

export class AiAdapterError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AiAdapterError";
  }
}

const importanceThresholdSchema = z.preprocess(
  (value) => {
    const numericValue =
      typeof value === "string" && value.trim() !== ""
        ? Number(value)
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
  radar_name: z.string().min(1),
  subject: z.string().min(1),
  aliases: z.array(z.string()),
  include_topics: z.array(z.string()),
  exclude_topics: z.array(z.string()),
  search_query: z.string().min(1),
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
    radar_name: { type: "string" },
    subject: { type: "string" },
    aliases: {
      type: "array",
      items: { type: "string" },
    },
    include_topics: {
      type: "array",
      items: { type: "string" },
    },
    exclude_topics: {
      type: "array",
      items: { type: "string" },
    },
    search_query: { type: "string" },
    importance_threshold: { type: ["number", "string"] },
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

export function createGroqClient(apiKey?: string): GroqLike {
  const resolvedApiKey = apiKey ?? parseServerEnv().GROQ_API_KEY;
  return new Groq({ apiKey: resolvedApiKey }) as unknown as GroqLike;
}

export function resolveGroqModel(): string {
  return parseServerEnv().GROQ_MODEL;
}

function readMessageContent(result: GroqCompletionResult): string {
  const content = result.choices?.[0]?.message?.content;

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }

        if (
          part &&
          typeof part === "object" &&
          "text" in part &&
          typeof part.text === "string"
        ) {
          return part.text;
        }

        return "";
      })
      .join("");
  }

  throw new AiAdapterError(
    "GROQ_INVALID_RESPONSE",
    "Groq returned an invalid response.",
  );
}

function parseStructuredContent<T>(
  rawContent: string,
  validator: z.ZodType<T>,
): T {
  let parsedJson: unknown;

  try {
    parsedJson = JSON.parse(rawContent);
  } catch {
    throw new AiAdapterError(
      "GROQ_INVALID_RESPONSE",
      "Groq returned an invalid response.",
    );
  }

  const parsedResult = validator.safeParse(parsedJson);

  if (!parsedResult.success) {
    throw new AiAdapterError(
      "GROQ_INVALID_RESPONSE",
      "Groq returned an invalid response.",
    );
  }

  return parsedResult.data;
}

async function runStructuredCompletion<T>({
  groq,
  model,
  schemaName,
  jsonSchema,
  messages,
  validator,
}: {
  groq: GroqLike;
  model: string;
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  messages: GroqMessage[];
  validator: z.ZodType<T>;
}): Promise<T> {
  const response = await groq.chat.completions.create({
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
  });

  return parseStructuredContent(readMessageContent(response), validator);
}

export async function createStructuredOutput<T>({
  groq,
  model,
  schemaName,
  jsonSchema,
  messages,
  validator,
}: {
  groq: GroqLike;
  model: string;
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  messages: GroqMessage[];
  validator: z.ZodType<T>;
}): Promise<T> {
  try {
    return await runStructuredCompletion({
      groq,
      model,
      schemaName,
      jsonSchema,
      messages,
      validator,
    });
  } catch (error) {
    if (!(error instanceof AiAdapterError) || error.code !== "GROQ_INVALID_RESPONSE") {
      if (error instanceof AiAdapterError) {
        throw error;
      }

      console.error("Groq request failed.", error);
      throw new AiAdapterError("GROQ_REQUEST_FAILED", "Groq request failed.");
    }

    try {
      return await runStructuredCompletion({
        groq,
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
      });
    } catch (retryError) {
      if (retryError instanceof AiAdapterError) {
        throw retryError;
      }

      console.error("Groq request failed after response repair.", retryError);
      throw new AiAdapterError("GROQ_REQUEST_FAILED", "Groq request failed.");
    }
  }
}
