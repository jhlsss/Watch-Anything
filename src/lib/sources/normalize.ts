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
  const url = new URL(rawUrl);

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
  return "url" in record;
}

export function normalizeCandidate(record: TavilyRecord | RssRecord): Candidate {
  if (isTavilyRecord(record)) {
    const sourceUrl = normalizeUrl(record.url);

    return {
      sourceType: "tavily",
      sourceDomain: new URL(sourceUrl).hostname,
      sourceUrl,
      title: record.title,
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
    title: record.title?.trim() ?? "",
    excerpt: truncateExcerpt(firstSentence(excerptSource)),
    publishedAt: record.isoDate ?? record.pubDate ?? null,
  };
}
