import { parseServerEnv } from "@/lib/env";
import { normalizeCandidate } from "@/lib/sources/normalize";
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

export async function searchTavily({
  query,
  apiKey = parseServerEnv().TAVILY_API_KEY,
  fetchFn = fetch,
}: SearchTavilyInput): Promise<Candidate[]> {
  try {
    const response = await fetchFn("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: "basic",
        max_results: 5,
      }),
      signal: createTimeoutSignal(8000),
    });

    if (!response.ok) {
      throw new SourceAdapterError(
        "TAVILY_REQUEST_FAILED",
        `Tavily request failed with ${response.status}.`,
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

    return (payload.results ?? []).slice(0, 5).map((result) => normalizeCandidate(result));
  } catch (error) {
    if (error instanceof SourceAdapterError) {
      throw error;
    }

    if (error instanceof DOMException && error.name === "AbortError") {
      throw new SourceAdapterError("TAVILY_TIMEOUT", "Tavily request timed out.");
    }

    throw new SourceAdapterError(
      "TAVILY_REQUEST_FAILED",
      error instanceof Error ? error.message : "Tavily request failed.",
    );
  }
}
