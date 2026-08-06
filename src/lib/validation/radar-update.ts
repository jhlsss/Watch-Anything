import { z } from "zod";

const radarNameSchema = z.string().trim().min(2).max(80);
const topicSchema = z.string().trim().min(1).max(60);
const topicListSchema = z.array(topicSchema).max(8);

const pauseSchema = z
  .object({
    action: z.literal("pause"),
  })
  .strict();

const resumeSchema = z
  .object({
    action: z.literal("resume"),
  })
  .strict();

const editableRuleDeltaSchema = z
  .object({
    radarName: radarNameSchema,
    includeTopics: topicListSchema.min(1),
    excludeTopics: topicListSchema,
  })
  .strict();

const directUpdateRulesSchema = z
  .object({
    action: z.literal("update_rules"),
    radarName: radarNameSchema,
    includeTopics: topicListSchema.min(1),
    excludeTopics: topicListSchema,
  })
  .strict();

const nestedUpdateRulesSchema = z
  .object({
    action: z.literal("update_rules"),
    rules: editableRuleDeltaSchema,
  })
  .strict();

export const radarUpdateSchema = z.union([
  pauseSchema,
  resumeSchema,
  directUpdateRulesSchema,
  nestedUpdateRulesSchema,
]);

export type RadarUpdateInput = z.infer<typeof radarUpdateSchema>;
export type NormalizedRadarUpdate =
  | { action: "pause" }
  | { action: "resume" }
  | {
      action: "update_rules";
      radarName: string;
      includeTopics: string[];
      excludeTopics: string[];
    };

export function parseRadarUpdate(input: unknown): NormalizedRadarUpdate {
  const parsed = radarUpdateSchema.parse(input);

  if (parsed.action !== "update_rules") {
    return parsed;
  }

  if ("rules" in parsed) {
    return {
      action: parsed.action,
      ...parsed.rules,
    };
  }

  return parsed;
}
