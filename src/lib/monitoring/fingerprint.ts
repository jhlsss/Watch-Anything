import { createHash } from "node:crypto";

import { normalizeUrl } from "@/lib/sources/normalize";

type FingerprintCandidate = {
  sourceUrl?: string | null;
  canonicalUrl?: string | null;
  sourceDomain: string;
  title: string;
};

function normalizeText(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase();
}

function normalizeDomain(value: string): string {
  return normalizeText(value).replace(/^www\./u, "");
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function fingerprintWithoutStableUrl({
  title,
  sourceDomain,
}: Pick<FingerprintCandidate, "title" | "sourceDomain">): string {
  return digest(`title-domain:${normalizeText(title)}|${normalizeDomain(sourceDomain)}`);
}

export function fingerprintCandidate(candidate: FingerprintCandidate): string {
  const candidateUrl = candidate.canonicalUrl ?? candidate.sourceUrl;

  if (candidateUrl?.trim()) {
    try {
      const normalizedUrl = normalizeUrl(candidateUrl);
      const url = new URL(normalizedUrl);

      if (url.protocol === "http:" || url.protocol === "https:") {
        return digest(`url:${normalizedUrl}`);
      }
    } catch {
      // A malformed or placeholder URL falls back to the stable title/domain key.
    }
  }

  return fingerprintWithoutStableUrl(candidate);
}

export const createFingerprint = fingerprintCandidate;
