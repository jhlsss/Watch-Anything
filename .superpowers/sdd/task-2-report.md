# Task 2 report: provider-neutral Gemini structured-output adapter

## Summary

Implemented Task 2 only:

- Added focused adapter coverage in `src/lib/ai/schemas.test.ts`.
- Refactored `src/lib/ai/schemas.ts` from the removed Groq SDK surface to a provider-neutral OpenAI-compatible Gemini adapter contract.
- Added `AiMessage`, `AiCompletionResult`, `AiRequestOptions`, `AiLike`, and generic `AiAdapterErrorCode`.
- Added `createGeminiClient(apiKey?)` with the exact Gemini OpenAI-compatible base URL:
  `https://generativelanguage.googleapis.com/v1beta/openai/`.
- Added `resolveGeminiModel()` via `parseServerEnv().GEMINI_MODEL`.
- Changed structured requests to send `response_format.type = "json_schema"`, the strict schema wrapper, `max_tokens`, and forwarded request options.
- Converted missing, empty, or non-string response content plus JSON/schema validation failures into `AI_INVALID_RESPONSE` without logging raw provider responses.
- Converted exhausted HTTP 429 retry budget into `AI_RATE_LIMITED`.
- Converted other provider transport failures into `AI_REQUEST_FAILED` without logging raw provider responses.
- Updated `parseRulesJsonSchema.properties.importance_threshold` to `{ type: "number", minimum: 0, maximum: 100 }`.
- Preserved Zod preprocessing in `parseRulesStructuredSchema` for qualitative thresholds and numeric strings.

## TDD evidence

RED:

```bash
pnpm vitest run src/lib/ai/schemas.test.ts
```

Result: failed before implementation because `src/lib/ai/schemas.ts` still imported removed `groq-sdk`.

GREEN:

```bash
pnpm vitest run src/lib/ai/schemas.test.ts
```

Result: passed, 1 test file / 6 tests.

During the first GREEN run, two test harness issues surfaced:

- The mocked `openai` default export needed to be constructible with `new`.
- The 429 rejection assertion needed to be attached before fake timers flushed.

Those were corrected in the test harness, then the focused adapter suite passed.

## Verification commands

```bash
pnpm vitest run src/lib/ai/schemas.test.ts
```

Passed: 1 test file, 6 tests.

```bash
pnpm lint
```

Passed.

```bash
pnpm test
```

Failed as expected for the current migration boundary. The failures are in later-task Groq callers and legacy tests that still import or call the old surface:

- `src/lib/monitoring/run-radar.ts` still imports `groq-sdk`.
- `src/lib/monitoring/run-radar.test.ts` still imports `groq-sdk`.
- `src/lib/ai/parse-rules.ts` still imports/calls `createGroqClient`, `resolveGroqModel`, `GroqLike`, and passes `groq` to `createStructuredOutput`.
- `src/lib/ai/evaluate-candidates.ts` still imports/calls the old Groq surface.
- Legacy tests still assert `GROQ_*` error codes and `GROQ_MODEL`.

Per the Task 2 brief, I did not modify those later-task callers.

## Files changed

- `src/lib/ai/schemas.ts`
- `src/lib/ai/schemas.test.ts`
- `.superpowers/sdd/task-2-report.md`

## Self-review

- Scope: limited to Task 2 adapter/schema work and its focused test/report.
- Task 1 files: not modified.
- Tasks 3–6: not started; old Groq callers remain untouched and documented.
- Secrets: `createGeminiClient` reads server env only and no credential values are printed.
- Provider responses: raw provider responses/errors are not logged.
- Base URL: exact brief URL used.
- Request shape: uses `json_schema` wrapper and `max_tokens`; focused test asserts `max_completion_tokens` is omitted.
- Retry behavior: one retry for HTTP 429, then `AI_RATE_LIMITED`.
- Repair behavior: invalid response gets one validation-repair attempt; repeated invalid response stays `AI_INVALID_RESPONSE`.
- Schema compatibility: JSON schema requires numeric `importance_threshold`; Zod preprocessing still accepts fixture-style strings/qualitative values after response parsing.

## Concerns / follow-up

The repository-wide test command cannot pass until later migration tasks update old Groq callers and tests. This is expected intermediate breakage for Task 2 and was not fixed here to avoid expanding scope.
