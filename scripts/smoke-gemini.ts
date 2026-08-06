import { z } from "zod";

import {
  createGeminiClient,
  createStructuredOutput,
  resolveGeminiModel,
} from "../src/lib/ai/schemas";

const nextEnvModule = await import("@next/env");
const nextEnv = (nextEnvModule.default ?? nextEnvModule) as typeof import("@next/env");
nextEnv.loadEnvConfig(process.cwd());

const smokeJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    ok: { type: "boolean" },
  },
  required: ["ok"],
} as const;

async function main(): Promise<void> {
  await createStructuredOutput({
    ai: createGeminiClient(),
    model: resolveGeminiModel(),
    schemaName: "gemini_smoke",
    jsonSchema: smokeJsonSchema,
    messages: [
      {
        role: "user",
        content: 'Return exactly one JSON object: {"ok":true}.',
      },
    ],
    validator: z.object({ ok: z.literal(true) }),
    maxCompletionTokens: 32,
  });

  console.log("Gemini smoke test passed.");
}

try {
  await main();
} catch {
  console.error("Gemini smoke test failed.");
  process.exitCode = 1;
}
