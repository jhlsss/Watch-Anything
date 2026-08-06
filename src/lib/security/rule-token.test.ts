import { beforeAll, describe, expect, it } from "vitest";

import {
  editableRuleDeltaSchema,
  radarRulesSchema,
} from "@/lib/validation/radar-rules";
import { signRuleToken, verifyRuleToken } from "@/lib/security/rule-token";
import type { RadarRules } from "@/types/contracts";

const validRules: RadarRules = {
  radarName: "LISA Official Radar",
  subject: "Track important official LISA music releases and tours.",
  aliases: ["Lalisa Manobal", "BLACKPINK LISA"],
  includeTopics: ["official releases", "tour announcements"],
  excludeTopics: ["fan speculation"],
  searchQuery: "LISA official release tour",
  importanceThreshold: 75,
  intervalMinutes: 360,
};

beforeAll(() => {
  process.env.RULE_TOKEN_SECRET =
    "test-rule-token-secret-that-is-at-least-32-characters-long";
});

describe("radar rules schema", () => {
  it("accepts the bounded editable and signed rule shape", () => {
    expect(radarRulesSchema.safeParse(validRules).success).toBe(true);
    expect(
      editableRuleDeltaSchema.safeParse({
        radarName: "LISA Radar",
        includeTopics: ["official releases"],
        excludeTopics: [],
      }).success,
    ).toBe(true);
  });

  it("rejects values outside the rule creation limits", () => {
    expect(radarRulesSchema.safeParse({ ...validRules, radarName: "A" }).success).toBe(false);
    expect(radarRulesSchema.safeParse({ ...validRules, includeTopics: [] }).success).toBe(false);
    expect(
      radarRulesSchema.safeParse({
        ...validRules,
        includeTopics: Array.from({ length: 9 }, (_, index) => `topic-${index}`),
      }).success,
    ).toBe(false);
    expect(
      radarRulesSchema.safeParse({
        ...validRules,
        includeTopics: ["x".repeat(61)],
      }).success,
    ).toBe(false);
    expect(radarRulesSchema.safeParse({ ...validRules, importanceThreshold: 101 }).success).toBe(false);
    expect(radarRulesSchema.safeParse({ ...validRules, intervalMinutes: 60 }).success).toBe(false);
  });
});

describe("rule token", () => {
  it("round-trips signed rules and rejects tampering or expiry", () => {
    const now = Date.parse("2026-08-06T00:00:00.000Z");
    const token = signRuleToken(validRules, now);

    expect(verifyRuleToken(token, now + 60_000)).toMatchObject(validRules);
    expect(() => verifyRuleToken(`${token}x`, now)).toThrow("INVALID_RULE_TOKEN");
    expect(() => verifyRuleToken(token, now + 7_200_001)).toThrow("EXPIRED_RULE_TOKEN");
  });

  it("rejects a token signed with a different secret", () => {
    const now = Date.parse("2026-08-06T00:00:00.000Z");
    const token = signRuleToken(validRules, now);
    const originalSecret = process.env.RULE_TOKEN_SECRET;
    process.env.RULE_TOKEN_SECRET = "another-rule-token-secret-that-is-at-least-32-characters-long";

    try {
      expect(() => verifyRuleToken(token, now)).toThrow("INVALID_RULE_TOKEN");
    } finally {
      process.env.RULE_TOKEN_SECRET = originalSecret;
    }
  });
});
