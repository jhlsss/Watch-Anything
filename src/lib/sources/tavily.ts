import { parseServerEnv } from "@/lib/env";
import {
  CandidateNormalizationError,
  normalizeCandidate,
} from "@/lib/sources/normalize";
import type { Candidate } from "@/types/contracts";

export class SourceAdapterError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SourceAdapterError";
  }
}

type FetchLike = typeof fetch;

type SearchTavilyInput = {
  query: string;
  apiKey?: string;
  fetchFn?: FetchLike;
};

function createTimeoutSignal(timeoutMs: number): AbortSignal {
  return AbortSignal.timeout(timeoutMs);
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

export async function searchTavily({
  query,
  apiKey,
  fetchFn = fetch,
}: SearchTavilyInput): Promise<Candidate[]> {
  try {
    const resolvedApiKey = apiKey ?? parseServerEnv().TAVILY_API_KEY;
    const response = await fetchFn("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        api_key: resolvedApiKey,
        query,
        search_depth: "basic",
        max_results: 5,
      }),
      signal: createTimeoutSignal(8000),
    });

    if (!response.ok) {
      console.error("Tavily request failed.", { status: response.status });
      throw new SourceAdapterError(
        "TAVILY_REQUEST_FAILED",
        "Tavily request failed.",
      );
    }

    const payload = (await response.json()) as {
      results?: Array<{
        url: string;
        title: string;
        content?: string | null;
        published_date?: string | null;
      }>;
    };

    if (payload.results !== undefined && !Array.isArray(payload.results)) {
      throw new SourceAdapterError(
        "TAVILY_INVALID_RESPONSE",
        "Tavily response was invalid.",
      );
    }

    return (payload.results ?? [])
      .slice(0, 5)
      .map((result) => normalizeCandidate(result));
  } catch (error) {
    if (error instanceof SourceAdapterError) {
      throw error;
    }

    if (isTimeoutOrAbortError(error)) {
      console.error("Tavily request timed out.", error);
      throw new SourceAdapterError("TAVILY_TIMEOUT", "Tavily request timed out.");
    }

    if (error instanceof CandidateNormalizationError) {
      console.error("Tavily response was invalid.", error);
      throw new SourceAdapterError(
        "TAVILY_INVALID_RESPONSE",
        "Tavily response was invalid.",
      );
    }

    console.error("Tavily request failed.", error);
    throw new SourceAdapterError(
      "TAVILY_REQUEST_FAILED",
      "Tavily request failed.",
    );
  }
}
