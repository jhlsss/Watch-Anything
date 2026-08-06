import { z } from "zod";
import type { Candidate, RadarRules } from "@/types/contracts";
import {
  createGeminiClient,
  createStructuredOutput,
  evaluateCandidateItemSchema,
  evaluateCandidatesJsonSchema,
  resolveGeminiModel,
  type AiLike,
} from "@/lib/ai/schemas";

export interface CandidateEvaluation {
  candidate: Candidate;
  evaluation: z.infer<typeof evaluateCandidateItemSchema>;
}

type EvaluateCandidatesInput = {
  rules: RadarRules;
  candidates: Candidate[];
  ai?: AiLike;
};

function trimExcerpt(excerpt: string): string {
  return excerpt.slice(0, 800);
}

export async function evaluateCandidates({
  rules,
  candidates,
  ai = createGeminiClient(),
}: EvaluateCandidatesInput): Promise<CandidateEvaluation[]> {
  const model = resolveGeminiModel();
  const selectedCandidates = candidates.slice(0, 8);

  if (selectedCandidates.length === 0) {
    return [];
  }

  const promptCandidates = selectedCandidates.map((candidate) => ({
    ...candidate,
    excerpt: trimExcerpt(candidate.excerpt),
  }));

  const evaluationSchema = z
    .array(evaluateCandidateItemSchema)
    .length(selectedCandidates.length);

  const evaluations = await createStructuredOutput({
    ai,
    model,
    schemaName: "evaluate_candidates",
    jsonSchema: evaluateCandidatesJsonSchema,
    validator: evaluationSchema,
    messages: [
      {
        role: "system",
        content:
          "Score each candidate against the Radar rules. Return one JSON array item per candidate in order.",
      },
      {
        role: "user",
        content: JSON.stringify({
          rules,
          candidates: promptCandidates,
        }),
      },
    ],
  });

  return selectedCandidates.map((candidate, index) => ({
    candidate,
    evaluation: evaluations[index],
  }));
}
