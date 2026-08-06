import { describe, expect, it } from "vitest";

import {
  parseRadarUpdate,
  radarUpdateSchema,
} from "@/lib/validation/radar-update";

describe("radarUpdateSchema", () => {
  it("accepts pause and resume actions without editable rule fields", () => {
    expect(radarUpdateSchema.safeParse({ action: "pause" }).success).toBe(true);
    expect(radarUpdateSchema.safeParse({ action: "resume" }).success).toBe(true);
  });

  it("accepts only the editable rule delta", () => {
    const result = parseRadarUpdate({
      action: "update_rules",
      radarName: "OpenAI Releases",
      includeTopics: ["official announcements"],
      excludeTopics: ["rumours"],
    });

    expect(result).toEqual({
      action: "update_rules",
      radarName: "OpenAI Releases",
      includeTopics: ["official announcements"],
      excludeTopics: ["rumours"],
    });
  });

  it("rejects immutable rule fields and unknown actions", () => {
    expect(
      radarUpdateSchema.safeParse({
        action: "update_rules",
        radarName: "OpenAI Releases",
        includeTopics: ["official announcements"],
        excludeTopics: [],
        subject: "OpenAI",
        searchQuery: "OpenAI news",
        intervalMinutes: 60,
        userId: "another-user",
      }).success,
    ).toBe(false);
    expect(radarUpdateSchema.safeParse({ action: "delete" }).success).toBe(false);
  });
});
