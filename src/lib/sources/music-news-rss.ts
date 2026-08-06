import Parser from "rss-parser";
import {
  CandidateNormalizationError,
  normalizeCandidate,
} from "@/lib/sources/normalize";
import type { Candidate } from "@/types/contracts";

export const MUSIC_NEWS_RSS_URL =
  "https://www.music-news.com/rss/c5RAS2tkYoRTvbRq/UK/news";

type FetchLike = typeof fetch;

type ParserLike = Pick<Parser, "parseString">;

type FetchMusicNewsRssInput = {
  fetchFn?: FetchLike;
  parser?: ParserLike;
};

export class RssAdapterError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RssAdapterError";
  }
}

function hasErrorName(error: unknown, name: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === name
  );
}

function isTimeoutOrAbortError(error: unknown): boolean {
  return hasErrorName(error, "TimeoutError") || hasErrorName(error, "AbortError");
}

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
      console.error("RSS request failed.", { status: response.status });
      throw new RssAdapterError("RSS_REQUEST_FAILED", "RSS request failed.");
    }

    const xml = await response.text();
    const parsedFeed = await parser.parseString(xml);

    const items = parsedFeed.items ?? [];

    if (!Array.isArray(items)) {
      throw new RssAdapterError(
        "RSS_INVALID_RESPONSE",
        "RSS response was invalid.",
      );
    }

    return items.map((item) => normalizeCandidate(item));
  } catch (error) {
    if (error instanceof RssAdapterError) {
      throw error;
    }

    if (isTimeoutOrAbortError(error)) {
      console.error("RSS request timed out.", error);
      throw new RssAdapterError("RSS_TIMEOUT", "RSS request timed out.");
    }

    if (error instanceof CandidateNormalizationError) {
      console.error("RSS response was invalid.", error);
      throw new RssAdapterError(
        "RSS_INVALID_RESPONSE",
        "RSS response was invalid.",
      );
    }

    console.error("RSS request failed.", error);
    throw new RssAdapterError("RSS_REQUEST_FAILED", "RSS request failed.");
  }
}
