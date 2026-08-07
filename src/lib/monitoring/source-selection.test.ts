import { describe, expect, it } from "vitest";

import { shouldFetchMusicNewsRss } from "@/lib/monitoring/source-selection";
import type { RadarRules } from "@/types/contracts";

function rules(overrides: Partial<RadarRules> = {}): RadarRules {
  return {
    radarName: "Radar",
    subject: "Track official updates",
    aliases: [],
    includeTopics: ["announcements"],
    excludeTopics: [],
    searchQuery: "official updates",
    importanceThreshold: 70,
    intervalMinutes: 360,
    ...overrides,
  };
}

describe("shouldFetchMusicNewsRss", () => {
  it("enables the fixed feed for music-focused rules", () => {
    expect(
      shouldFetchMusicNewsRss(
        rules({
          subject: "Track official LISA music releases and tours",
          searchQuery: "LISA official music release tour",
        }),
      ),
    ).toBe(true);
  });

  it("does not enable the fixed music feed for OpenAI product updates", () => {
    expect(
      shouldFetchMusicNewsRss(
        rules({
          subject: "Track official OpenAI product releases and model updates",
          aliases: ["OpenAI"],
          includeTopics: ["product releases", "model updates"],
          searchQuery: "OpenAI product release model update",
        }),
      ),
    ).toBe(false);
  });
});
