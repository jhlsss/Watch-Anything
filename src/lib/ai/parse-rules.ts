import type { RadarRules } from "@/types/contracts";
import {
  createGroqClient,
  createStructuredOutput,
  parseRulesJsonSchema,
  parseRulesStructuredSchema,
  resolveGroqModel,
  type GroqLike,
} from "@/lib/ai/schemas";

type ParseRulesInput = {
  prompt: string;
  groq?: GroqLike;
};

export async function parseRules({
  prompt,
  groq = createGroqClient(),
}: ParseRulesInput): Promise<RadarRules> {
  const model = resolveGroqModel();
  const parsed = await createStructuredOutput({
    groq,
    model,
    schemaName: "parse_rules",
    jsonSchema: parseRulesJsonSchema,
    validator: parseRulesStructuredSchema,
    maxCompletionTokens: 2048,
    messages: [
      {
        role: "system",
        content:
          "Convert the user's monitoring request into stable Radar rules. Return JSON only.",
      },
      {
        role: "user",
        content: prompt,
      },
    ],
  });

  return {
    radarName: parsed.radar_name,
    subject: parsed.subject,
    aliases: parsed.aliases,
    includeTopics: parsed.include_topics,
    excludeTopics: parsed.exclude_topics,
    searchQuery: parsed.search_query,
    importanceThreshold: parsed.importance_threshold,
    intervalMinutes: 360,
  };
}
