import { z } from "zod";

const topicSchema = z.string().trim().min(1).max(60);

export const radarRulesSchema = z
  .object({
    radarName: z.string().trim().min(2).max(80),
    subject: z.string().trim().min(1).max(100),
    aliases: z.array(topicSchema).max(8),
    includeTopics: z.array(topicSchema).min(1).max(8),
    excludeTopics: z.array(topicSchema).max(8),
    searchQuery: z.string().trim().min(1).max(240),
    importanceThreshold: z.number().int().min(0).max(100),
    intervalMinutes: z.literal(360),
  })
  .strict();

export const editableRuleDeltaSchema = z
  .object({
    radarName: z.string().trim().min(2).max(80),
    includeTopics: z.array(topicSchema).min(1).max(8),
    excludeTopics: z.array(topicSchema).max(8),
  })
  .strict();

export const ruleParseRequestSchema = z
  .object({
    prompt: z.string().trim().min(1).max(4_000),
    locale: z.enum(["en", "zh-CN"]).optional(),
  })
  .strict();

export const pendingSetupRequestSchema = z
  .object({
    originalPrompt: z.string().trim().min(1).max(4_000),
    ruleToken: z.string().min(1).max(8_192),
    editableDelta: editableRuleDeltaSchema,
  })
  .strict();

export type RadarRulesInput = z.infer<typeof radarRulesSchema>;
export type EditableRuleDeltaInput = z.infer<typeof editableRuleDeltaSchema>;
export type PendingSetupRequest = z.infer<typeof pendingSetupRequestSchema>;

export function toEditableRuleDelta(rules: RadarRulesInput): EditableRuleDeltaInput {
  return {
    radarName: rules.radarName,
    includeTopics: [...rules.includeTopics],
    excludeTopics: [...rules.excludeTopics],
  };
}
