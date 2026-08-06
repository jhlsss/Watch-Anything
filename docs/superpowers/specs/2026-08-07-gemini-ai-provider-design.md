# Gemini AI Provider Migration Design

**Date:** 2026-08-07

## Goal

Replace the current Groq-only AI integration with Gemini as the single configured text AI provider for Watch-anything. Rules parsing, candidate evaluation, and future structured text tasks must use one provider-agnostic AI boundary so later features do not instantiate a vendor SDK inside business logic.

## Context

The application currently has two production AI paths:

- `src/lib/ai/parse-rules.ts` converts a user prompt into editable Radar rules.
- `src/lib/monitoring/run-radar.ts` evaluates up to eight source candidates during manual, baseline, and scheduled runs.

Both paths depend on `src/lib/ai/schemas.ts`, which currently sends OpenAI-style chat-completion requests through `groq-sdk` and requires strict structured JSON. The monitoring path also constructs a Groq client directly so it can pass an abort signal and request timeout.

The selected Gemini integration will use Gemini's OpenAI-compatible chat-completions endpoint for the current text-only workflows. The application will keep its own Zod validation because provider-level structured output only constrains syntax and schema shape; business-level validation remains an application responsibility.

## Architecture

### Provider boundary

`src/lib/ai/schemas.ts` will expose a generic `AiLike` chat-completions interface, `createGeminiClient()`, and `resolveGeminiModel()`. The structured-output helper will accept `AiLike` rather than a Groq-specific type. The default client will be created from `GEMINI_API_KEY` and `GEMINI_MODEL`.

Business modules will depend on the generic interface:

- `parseRules` accepts an optional `ai` override for tests and defaults to the configured Gemini client.
- `evaluateCandidates` accepts an optional `ai` override for tests and defaults to the configured Gemini client.
- `runRadar` accepts an optional generic `ai` override. Its deadline wrapper will pass `AbortSignal`, timeout, and `maxRetries: 0` to the Gemini-compatible client.

No future business module will import `groq-sdk`, `openai`, or a Gemini SDK directly. Future structured text tasks will call the shared structured-output helper with a schema and validator.

### Gemini transport

Use the OpenAI-compatible Gemini endpoint:

```text
https://generativelanguage.googleapis.com/v1beta/openai/
```

The implementation will use the `openai` JavaScript client because it supports the required timeout, abort signal, and retry configuration while allowing the base URL and API key to be swapped. The direct Google SDK is intentionally deferred until a future feature needs Gemini-native capabilities such as file uploads, Google Search grounding, or other provider-specific tools.

The default model will be `gemini-3.1-flash-lite`, configurable through `GEMINI_MODEL` so a currently available Flash-Lite model can be selected without another code change.

### Structured output compatibility

The existing request will continue to use `response_format.type = "json_schema"` with application-side Zod validation. The JSON schema will be kept within Gemini's documented subset:

- object, array, string, number, boolean, and nullable values;
- required properties;
- `additionalProperties: false`;
- array item schemas and bounded item counts.

The `importance_threshold` provider schema will emit a number rather than the current `number|string` union. The Zod preprocessor will continue accepting qualitative or string values if a compatible provider returns them, but the Gemini request schema will describe the canonical numeric form. The existing nullable event-key fields remain explicitly nullable.

The request will use `max_tokens`, which is the portable chat-completions field supported by Gemini, instead of Groq-specific `max_completion_tokens`.

### Error handling

Provider-independent error codes will replace Groq-specific public codes:

- `AI_RATE_LIMITED` for HTTP 429 responses;
- `AI_INVALID_RESPONSE` for missing, non-JSON, or Zod-invalid content;
- `AI_REQUEST_FAILED` for other transport/provider failures.

Transient rate limits will retry once using the provider's retry headers when available, capped at ten seconds. A second failure will surface `AI_RATE_LIMITED`. The existing rules fallback will return confirmation-safe editable rules when the provider quota is exhausted. Radar candidate evaluation will preserve the current behavior: mark the AI stage failed and complete the run without inventing candidate scores.

Empty or filtered Gemini responses will be treated as invalid provider output, retried once with a JSON-only repair message, and then mapped to a stable application error. Provider error bodies and API keys will never be returned to the browser.

### Configuration

Required server variables become:

```env
GEMINI_API_KEY=your-gemini-api-key
GEMINI_MODEL=gemini-3.1-flash-lite
```

The `.env.example` file and server environment parser will use these names. `GROQ_API_KEY` and `GROQ_MODEL` will no longer be required by the application after migration. Existing local or deployment variables can remain temporarily during rollout, but the application will not read them.

## Testing

Tests will verify:

1. Gemini environment defaults and missing-key validation.
2. The Gemini client base URL and configured model are used.
3. Structured requests use `response_format.json_schema` and `max_tokens`.
4. Both parse-rules and candidate-evaluation schemas validate Gemini-compatible output.
5. Invalid JSON receives exactly one repair attempt.
6. 429 errors retry once, then map to `AI_RATE_LIMITED`.
7. Daily/total quota exhaustion still produces the existing rules fallback.
8. Monitoring deadline wrappers pass the abort signal and timeout to the generic client.
9. The full existing test suite, lint, production build, and a real Gemini smoke request using the configured local environment pass.

The smoke request will use a minimal structured prompt and will not log the API key or response content beyond the validation result.

## Non-goals

- Adding automatic multi-provider fallback in this migration.
- Adding Gemini Search grounding; the project continues to use Tavily for web search.
- Adding image, audio, video, or embedding workflows.
- Changing Radar rules, database contracts, user-facing copy, or monitoring semantics.

## Rollout

1. Update the transport boundary, schemas, environment contract, and tests.
2. Replace direct Groq construction in the monitoring path.
3. Remove the Groq SDK dependency and add the OpenAI client dependency.
4. Run tests, lint, build, and the configured Gemini smoke check.
5. Update the environment example and hand off the exact deployment variables.

