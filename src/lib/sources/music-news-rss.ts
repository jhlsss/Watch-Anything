import Parser from "rss-parser";
import { normalizeCandidate } from "@/lib/sources/normalize";
import type { Candidate } from "@/types/contracts";

export const MUSIC_NEWS_RSS_URL =
  "https://www.music-news.com/rss/c5RAS2tkYoRTvbRq/UK/news";

type FetchLike = typeof fetch;

type ParserLike = Pick<Parser, "parseString">;

type FetchMusicNewsRssInput = {
  fetchFn?: FetchLike;
  parser?: ParserLike;
};

export async function fetchMusicNewsRss({
  fetchFn = fetch,
  parser = new Parser(),
}: FetchMusicNewsRssInput = {}): Promise<Candidate[]> {
  try {
    const response = await fetchFn(MUSIC_NEWS_RSS_URL, {
      method: "GET",
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      throw new Error(`RSS request failed with ${response.status}.`);
    }

    const xml = await response.text();
    const parsedFeed = await parser.parseString(xml);

    return (parsedFeed.items ?? []).map((item) => normalizeCandidate(item));
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("RSS_TIMEOUT");
    }

    throw error;
  }
}
