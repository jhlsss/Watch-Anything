import type { RadarRules } from "@/types/contracts";

const MUSIC_TOPIC_PATTERN = /(?:\b(?:album|albums|artist|artists|band|bands|concert|concerts|discography|k[- ]?pop|music|musical|singer|single|singles|song|songs|tour|tours)\b|音乐|歌曲|专辑|单曲|巡演|演唱会|歌手|乐队)/iu;

export function shouldFetchMusicNewsRss(rules: RadarRules): boolean {
  return MUSIC_TOPIC_PATTERN.test(
    [
      rules.subject,
      rules.searchQuery,
      ...rules.aliases,
      ...rules.includeTopics,
    ].join(" "),
  );
}
