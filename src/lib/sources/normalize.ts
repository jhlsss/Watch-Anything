import type { Candidate } from "@/types/contracts";

type TavilyRecord = {
  url: string;
  title: string;
  content?: string | null;
  published_date?: string | null;
};

type RssRecord = {
  title?: string | null;
  link?: string | null;
  contentSnippet?: string | null;
  content?: string | null;
  isoDate?: string | null;
  pubDate?: string | null;
};

export class CandidateNormalizationError extends Error {
  constructor(
    public readonly code: "CANDIDATE_INVALID_URL" | "CANDIDATE_INVALID_TITLE",
    message: string,
  ) {
    super(message);
    this.name = "CandidateNormalizationError";
  }
}

const TRACKING_PARAMETERS = new Set([
  "fbclid",
  "gclid",
  "igshid",
  "mc_cid",
  "mc_eid",
]);

function trimTrailingSlash(pathname: string): string {
  if (pathname === "/") {
    return pathname;
  }

  return pathname.replace(/\/+$/, "");
}

function firstSentence(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^(.+?[.!?。！？])(?:\s|$)/);
  return match?.[1]?.trim() ?? trimmed;
}

export function normalizeUrl(rawUrl: string): string {
  if (typeof rawUrl !== "string" || rawUrl.trim().length === 0) {
    throw new CandidateNormalizationError(
      "CANDIDATE_INVALID_URL",
      "Candidate URL is invalid.",
    );
  }

  let url: URL;

  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new CandidateNormalizationError(
      "CANDIDATE_INVALID_URL",
      "Candidate URL is invalid.",
    );
  }

  url.hash = "";

  for (const key of Array.from(url.searchParams.keys())) {
    if (key.startsWith("utm_") || TRACKING_PARAMETERS.has(key)) {
      url.searchParams.delete(key);
    }
  }

  url.pathname = trimTrailingSlash(url.pathname);
  url.search = url.searchParams.toString()
    ? `?${url.searchParams.toString()}`
    : "";

  return url.toString();
}

function truncateExcerpt(value: string): string {
  return value.slice(0, 800).trim();
}

function isTavilyRecord(record: TavilyRecord | RssRecord): record is TavilyRecord {
  return (
    typeof record === "object" &&
    record !== null &&
    "url" in record
  );
}

function normalizeTitle(rawTitle: unknown): string {
  if (typeof rawTitle !== "string" || rawTitle.trim().length === 0) {
    throw new CandidateNormalizationError(
      "CANDIDATE_INVALID_TITLE",
      "Candidate title is invalid.",
    );
  }

  return rawTitle.trim();
}

export function normalizeCandidate(record: TavilyRecord | RssRecord): Candidate {
  if (isTavilyRecord(record)) {
    const sourceUrl = normalizeUrl(record.url);

    return {
      sourceType: "tavily",
      sourceDomain: new URL(sourceUrl).hostname,
      sourceUrl,
      title: normalizeTitle(record.title),
      excerpt: truncateExcerpt(record.content?.trim() ?? ""),
      publishedAt: record.published_date ?? null,
    };
  }

  const sourceUrl = normalizeUrl(record.link ?? "");
  const excerptSource = record.contentSnippet ?? record.content ?? "";

  return {
    sourceType: "rss",
    sourceDomain: new URL(sourceUrl).hostname,
    sourceUrl,
    title: normalizeTitle(record.title),
    excerpt: truncateExcerpt(firstSentence(excerptSource)),
    publishedAt: record.isoDate ?? record.pubDate ?? null,
  };
}
