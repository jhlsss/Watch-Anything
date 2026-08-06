import type { RadarRules } from "@/types/contracts";
import { z } from "zod";
import {
  AiAdapterError,
  createGeminiClient,
  createStructuredOutput,
  parseRulesJsonSchema,
  parseRulesStructuredSchema,
  resolveGeminiModel,
  type AiLike,
} from "@/lib/ai/schemas";

type ParseRulesInput = {
  prompt: string;
  ai?: AiLike;
};

const fallbackStopWords = new Set([
  "a",
  "about",
  "all",
  "an",
  "and",
  "are",
  "from",
  "for",
  "find",
  "in",
  "latest",
  "me",
  "monitor",
  "monitoring",
  "news",
  "notify",
  "of",
  "official",
  "on",
  "or",
  "public",
  "sources",
  "source",
  "the",
  "to",
  "track",
  "trusted",
  "updates",
  "update",
  "watch",
  "with",
  "关注",
  "官方",
  "来自",
  "监控",
  "提醒",
  "通知",
  "请",
  "跟踪",
  "追踪",
]);

const fallbackExclusionPattern =
  /\b(?:exclude|excluding|except|without)\b|不要关注|不包括|排除/iu;

function extractFallbackTopics(text: string): string[] {
  const topics = text
    .replace(/[“”‘’"']/g, " ")
    .replace(/[()[\]{}]/g, " ")
    .split(/[\s,，。.!！？?、;；:：\/|]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0 && token.length <= 60)
    .filter((token) => !fallbackStopWords.has(token.toLowerCase()))
    .map((token) => (/^[A-Za-z0-9-]+$/.test(token) ? token.toLowerCase() : token));

  return [...new Set(topics)].slice(0, 8);
}

function buildRateLimitFallback(prompt: string): RadarRules {
  const normalizedPrompt = prompt.replace(/\s+/g, " ").trim();
  const exclusionMatch = fallbackExclusionPattern.exec(normalizedPrompt);
  const includeText = exclusionMatch
    ? normalizedPrompt.slice(0, exclusionMatch.index)
    : normalizedPrompt;
  const excludeText = exclusionMatch
    ? normalizedPrompt.slice(exclusionMatch.index + exclusionMatch[0].length)
    : "";
  const excludeTopics = extractFallbackTopics(excludeText);
  const includeTopics = extractFallbackTopics(includeText).filter(
    (topic) => !excludeTopics.includes(topic),
  );
  const safeIncludeTopics =
    includeTopics.length > 0
      ? includeTopics
      : [normalizedPrompt.slice(0, 60) || "user request"];
  const topicSummary = safeIncludeTopics.slice(0, 3).join(" ");
  const subject = (topicSummary || normalizedPrompt || "user request").slice(0, 100);

  return {
    radarName: `${subject} Radar`.slice(0, 80),
    subject,
    aliases: [],
    includeTopics: safeIncludeTopics,
    excludeTopics,
    searchQuery: safeIncludeTopics.join(" ").slice(0, 240),
    importanceThreshold: 75,
    intervalMinutes: 360,
  };
}

export async function parseRules({
  prompt,
  ai = createGeminiClient(),
}: ParseRulesInput): Promise<RadarRules> {
  const model = resolveGeminiModel();
  let parsed: z.infer<typeof parseRulesStructuredSchema>;

  try {
    parsed = await createStructuredOutput({
      ai,
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
  } catch (error) {
    if (error instanceof AiAdapterError && error.code === "AI_RATE_LIMITED") {
      return buildRateLimitFallback(prompt);
    }

    throw error;
  }

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
