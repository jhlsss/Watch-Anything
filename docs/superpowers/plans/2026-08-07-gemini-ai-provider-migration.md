# Gemini AI Provider Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the application's Groq-only text-AI integration with Gemini through its OpenAI-compatible API, while keeping rules parsing, candidate evaluation, rate-limit recovery, monitoring deadlines, and future structured-text AI work behind one provider-neutral boundary.

**Architecture:** `src/lib/ai/schemas.ts` owns the provider-neutral completion contract, Gemini client construction, model resolution, JSON-schema request construction, response validation, retry classification, and stable public error codes. `parseRules`, `evaluateCandidates`, and `runRadar` depend on that contract and accept injectable clients for tests. Gemini is the only configured provider in this migration; no automatic second-provider fallback is introduced.

**Tech Stack:** Next.js 16.3 App Router/Route Handlers, TypeScript, Zod 4, Vitest, `openai` JavaScript SDK pointed at Gemini's OpenAI-compatible endpoint, `@next/env` for the optional local smoke script, pnpm.

## Global Constraints

- Preserve unrelated existing work in the working tree. Do not use `git reset --hard`, `git checkout --`, broad deletion, or whole-file replacement when a focused patch is sufficient.
- Keep `GEMINI_API_KEY` server-only. Do not add a `NEXT_PUBLIC_` alias and never print its value in tests, logs, smoke output, or the final response.
- Read the Gemini model and API key through `parseServerEnv`; do not hard-code credentials or let callers override the configured model.
- Use `https://generativelanguage.googleapis.com/v1beta/openai/` as the OpenAI client `baseURL`.
- Keep the existing business behavior: one invalid-response repair attempt, one rate-limit retry using the provider retry delay when available, Rules fallback on rate limiting, and monitoring evaluation failure handling.
- Use Gemini-compatible JSON Schema. The public Rules parser may still normalize qualitative/string input through Zod, but its provider schema must request a numeric `importance_threshold` from 0 through 100.
- Use the generic request field `max_tokens`; remove Groq-only `max_completion_tokens` and all Groq-specific names from application source, tests, scripts, package metadata, and `.env.example`.
- Run focused tests after each implementation task, then run the complete test, lint, build, smoke, and diff checks before claiming completion.

---

## File Map

### Provider contract and environment

- `package.json` — replace `groq-sdk`, add `openai` and `@next/env`, and expose `smoke:gemini`.
- `pnpm-lock.yaml` — lock the dependency changes through pnpm.
- `src/lib/env.ts` — validate `GEMINI_API_KEY` and default `GEMINI_MODEL` to `gemini-3.1-flash-lite`.
- `src/lib/env.test.ts` — assert the Gemini environment contract and default model.
- `.env.example` — document only the Gemini AI variables.
- `src/lib/ai/schemas.ts` — provider-neutral AI types, Gemini client, structured-output transport, response validation, retry/error mapping, and JSON schemas.
- `src/lib/ai/schemas.test.ts` — new unit tests for Gemini client construction and the provider-neutral adapter contract.

### AI callers and monitoring deadline handling

- `src/lib/ai/parse-rules.ts` — inject `AiLike`, resolve `GEMINI_MODEL`, and classify `AI_RATE_LIMITED` for the existing fallback.
- `src/lib/ai/evaluate-candidates.ts` — inject the same provider-neutral client and model boundary.
- `src/lib/ai/parse-rules.fallback.test.ts` — migrate the fallback regression fixture from Groq to Gemini names and generic errors.
- `src/lib/ai/parse-rules.rate-limit.test.ts` — migrate rate-limit retry fixtures and assertions.
- `src/lib/sources/normalize.test.ts` — migrate shared AI stubs, environment fixtures, request assertions, and error assertions.
- `src/lib/monitoring/run-radar.ts` — construct the Gemini client, wrap the generic client with deadline signal/timeout options, and pass the generic dependency into evaluation.
- `src/lib/monitoring/run-radar.test.ts` — verify deadline forwarding and receiver binding through the OpenAI-compatible client shape.
- `src/app/api/cron/run-due/route.test.ts` — update server-environment fixtures.
- `src/app/api/telegram/routes.test.ts` — update server-environment fixtures.
- `src/app/api/telegram/webhook/route.test.ts` — update server-environment fixtures.

### Verification

- `scripts/smoke-gemini.ts` — load the local Next environment and make one minimal structured Gemini request without exposing secrets.

---

## Task 1: Replace the dependency and environment contract

- [ ] Install the provider-neutral client dependencies and remove the Groq SDK:

  ```bash
  pnpm add openai @next/env
  pnpm remove groq-sdk
  ```

  Expected result: `package.json` contains `openai` and `@next/env`, no `groq-sdk`, and `pnpm-lock.yaml` is updated without an install error.

- [ ] Update `src/lib/env.test.ts` first: replace the fixture's `GROQ_API_KEY` with `GEMINI_API_KEY`, change the default-model test to assert `parseServerEnv(validServerEnv).GEMINI_MODEL === "gemini-3.1-flash-lite"`, and keep all non-AI server requirements intact.

- [ ] Run the focused test before changing the implementation:

  ```bash
  pnpm vitest run src/lib/env.test.ts
  ```

  Expected result: the test fails because `src/lib/env.ts` still requires the Groq variables and returns `GROQ_MODEL`. This confirms the test detects the intended contract change.

- [ ] Implement the environment contract in `src/lib/env.ts`: require `GEMINI_API_KEY`, define `GEMINI_MODEL` as a non-empty string with the `gemini-3.1-flash-lite` default, and read both from `serverEnvironment()`. Remove the Groq fields.

- [ ] Update `.env.example` to:

  ```dotenv
  GEMINI_API_KEY=your-gemini-api-key
  GEMINI_MODEL=gemini-3.1-flash-lite
  ```

  Keep the existing Supabase, Tavily, cron, and Telegram variables unchanged.

- [ ] Run the focused test again:

  ```bash
  pnpm vitest run src/lib/env.test.ts
  ```

  Expected result: all environment tests pass, including the Gemini default-model assertion.

## Task 2: Build and test the provider-neutral Gemini structured-output adapter

- [ ] Add `src/lib/ai/schemas.test.ts` before changing `src/lib/ai/schemas.ts`. Mock the `openai` default constructor and add tests that:

  1. `createGeminiClient("gemini-test-key")` constructs the SDK with exactly that key and `baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/"`.
  2. `resolveGeminiModel()` reads `GEMINI_MODEL` from a complete server-environment fixture.
  3. `createStructuredOutput` sends `response_format.type = "json_schema"`, the strict schema wrapper, and `max_tokens`, while omitting `max_completion_tokens`.
  4. An invalid response is classified as `AI_INVALID_RESPONSE`, and a synthetic HTTP 429 is classified as `AI_RATE_LIMITED` after its single retry budget.

- [ ] Run the new test before implementation:

  ```bash
  pnpm vitest run src/lib/ai/schemas.test.ts
  ```

  Expected result: the test fails because the Gemini client, model resolver, and generic adapter types do not exist yet.

- [ ] Refactor the top of `src/lib/ai/schemas.ts` to define and export provider-neutral types:

  - `AiMessage` with `system`, `user`, and `assistant` roles and string content.
  - `AiCompletionResult` with the minimum OpenAI-compatible `choices[0].message.content` shape accepted by the parser.
  - `AiRequestOptions` with optional `signal`, `timeout`, and `maxRetries`.
  - `AiLike` whose `chat.completions.create` accepts a request object plus optional request options.
  - `AiAdapterErrorCode` limited to the three generic codes above.

- [ ] Replace the Groq import and constructors with an `OpenAI` import and implement:

  ```ts
  createGeminiClient(apiKey?: string): AiLike
  resolveGeminiModel(): string
  ```

  `createGeminiClient` must use `parseServerEnv().GEMINI_API_KEY` when no key is passed and the exact Gemini OpenAI-compatible `baseURL`. `resolveGeminiModel` must return `parseServerEnv().GEMINI_MODEL`.

- [ ] Update the structured request path in `src/lib/ai/schemas.ts`:

  - Rename `groq` parameters to `ai`.
  - Keep the current system/user prompt construction and response-repair flow.
  - Send `response_format.type = "json_schema"` with the existing schema name/strict wrapper.
  - Send `max_tokens: maxCompletionTokens`; do not send `max_completion_tokens`.
  - Forward optional `AiRequestOptions` to `chat.completions.create` so monitoring can supply an `AbortSignal`, timeout, and zero retries.
  - Read string content from the OpenAI-compatible response and convert missing/empty/non-string content to `AI_INVALID_RESPONSE` without leaking provider response details.

- [ ] Update `parseRulesJsonSchema` so `importance_threshold` is `{ type: "number", minimum: 0, maximum: 100 }`. Retain Zod preprocessing in `parseRulesStructuredSchema` for qualitative values and numeric strings returned by compatible test fixtures.

- [ ] Make the retry classifier recognize a Gemini/OpenAI-compatible HTTP 429 response and throw `AI_RATE_LIMITED` after the single retry budget is exhausted. Keep invalid JSON/schema repair as `AI_INVALID_RESPONSE` and all other transport failures as `AI_REQUEST_FAILED`.

- [ ] Run the adapter tests:

  ```bash
  pnpm vitest run src/lib/ai/schemas.test.ts
  ```

  Expected result: all new client-construction and generic-contract tests pass.

## Task 3: Migrate Rules parsing and candidate evaluation

- [ ] Update the existing AI caller tests first:

  - In `src/lib/ai/parse-rules.fallback.test.ts` and `src/lib/ai/parse-rules.rate-limit.test.ts`, import `AiLike`, stub `GEMINI_API_KEY`/`GEMINI_MODEL`, rename local clients and arguments to `ai`, and expect `AI_RATE_LIMITED` where the test asserts the stable error.
  - In `src/lib/sources/normalize.test.ts`, rename `createGroqStub` to `createAiStub`, use `GEMINI_*` fixtures, pass `ai`, update test descriptions, and assert `GEMINI_MODEL` and `AI_REQUEST_FAILED`.
  - Preserve the existing request-schema assertions, including strict JSON schema, model selection, retry count, and candidate evaluation output.

- [ ] Run these tests before implementation:

  ```bash
  pnpm vitest run src/lib/ai/parse-rules.fallback.test.ts src/lib/ai/parse-rules.rate-limit.test.ts src/lib/sources/normalize.test.ts
  ```

  Expected result: compilation or runtime failures identify the still-Groq caller signatures and error codes.

- [ ] Implement `src/lib/ai/parse-rules.ts` changes:

  - Accept `ai?: AiLike` and default to `createGeminiClient()`.
  - Resolve the model with `resolveGeminiModel()`.
  - Pass `ai` to `createStructuredOutput`.
  - Preserve the existing `AI_RATE_LIMITED` fallback path and all other parser behavior.

- [ ] Implement the equivalent `ai?: AiLike`, `createGeminiClient()`, `resolveGeminiModel()`, and `ai` request changes in `src/lib/ai/evaluate-candidates.ts`.

- [ ] Run the focused caller tests again:

  ```bash
  pnpm vitest run src/lib/ai/parse-rules.fallback.test.ts src/lib/ai/parse-rules.rate-limit.test.ts src/lib/sources/normalize.test.ts
  ```

  Expected result: all Rules parsing, fallback, rate-limit, normalization, and candidate evaluation tests pass.

## Task 4: Migrate monitoring's deadline-aware evaluation path

- [ ] Update `src/lib/monitoring/run-radar.test.ts` before implementation:

  - Replace the Groq SDK import/type with `OpenAI` and `AiLike`.
  - Rename injected dependencies from `groq` to `ai` and environment fixtures to `GEMINI_*`.
  - Rename test descriptions to Gemini/OpenAI-compatible behavior.
  - Keep the fake-fetch assertions for request URL, authorization, model, JSON response format, and the deadline options.

- [ ] Run the focused monitoring test before implementation:

  ```bash
  pnpm vitest run src/lib/monitoring/run-radar.test.ts
  ```

  Expected result: the test fails to compile or fails its renamed dependency assertions while `run-radar.ts` still uses Groq.

- [ ] Refactor `src/lib/monitoring/run-radar.ts`:

  - Remove the `groq-sdk` import and use the shared `createGeminiClient()` for production client construction.
  - Replace `GroqLike`/`GroqRequestOptions`/`createDeadlineGroq` with `AiLike`/`AiRequestOptions`/`createDeadlineAi`.
  - Rename `RunRadarDependencies.groq` to `ai`.
  - Build the default client with `createGeminiClient()` and pass the remaining budget, `AbortSignal`, and `maxRetries: 0` through the generic request-options wrapper; the test must verify the same endpoint and deadline behavior.
  - Preserve method receiver binding when wrapping `chat.completions.create`.
  - Pass `createDeadlineAi(...)` and `resolveGeminiModel()` to `createStructuredOutput`.
  - Pass `dependencies.ai` through the existing execution path.

- [ ] Run the focused monitoring test again:

  ```bash
  pnpm vitest run src/lib/monitoring/run-radar.test.ts
  ```

  Expected result: deadline, abort-signal, receiver-binding, fake-fetch, and evaluation-failure tests pass.

## Task 5: Update all server test fixtures and remove the old provider surface

- [ ] Replace the remaining `GROQ_API_KEY`/`GROQ_MODEL` fixtures with `GEMINI_API_KEY`/`GEMINI_MODEL` in:

  - `src/app/api/cron/run-due/route.test.ts`
  - `src/app/api/telegram/routes.test.ts`
  - `src/app/api/telegram/webhook/route.test.ts`

  Keep their unrelated route behavior and mocks unchanged.

- [ ] Run a source-surface search:

  ```bash
  rg -n -i "groq|GROQ|groq-sdk" src scripts .env.example package.json pnpm-lock.yaml
  ```

  Expected result: no matches. Historical design/research documents under `docs/superpowers/` may retain provider-comparison context and are outside this cleanup check.

- [ ] Run the complete automated suite:

  ```bash
  pnpm test
  ```

  Expected result: Vitest exits with status 0 and every test file passes.

## Task 6: Add a safe Gemini smoke check and perform final verification

- [ ] Add `scripts/smoke-gemini.ts`:

  - Call `loadEnvConfig(process.cwd())` from `@next/env` before invoking the adapter.
  - Create the configured Gemini client through `createGeminiClient()` and resolve `GEMINI_MODEL` through `resolveGeminiModel()`.
  - Send one minimal strict structured-output request with a boolean `ok` field and a Zod validator requiring `ok: true`.
  - Print only `Gemini smoke test passed.` on success; on failure print a generic failure message and set a non-zero exit code without printing the API key or raw provider payload.

- [ ] Add the package script:

  ```json
  "smoke:gemini": "tsx scripts/smoke-gemini.ts"
  ```

- [ ] Run the smoke request using the already configured local `.env.local`:

  ```bash
  pnpm run smoke:gemini
  ```

  Expected result: one real Gemini request completes and the command prints `Gemini smoke test passed.`. A provider quota, network, or region failure must produce a non-zero command with a generic diagnostic; it must not expose the secret.

- [ ] Run final static and production checks:

  ```bash
  pnpm lint
  pnpm build
  git diff --check
  ```

  Expected result: ESLint, the Next.js production build, and whitespace validation all exit with status 0.

- [ ] Confirm the configured variable names without revealing values:

  ```bash
  awk -F= '/^(GEMINI_API_KEY|GEMINI_MODEL)=/{print $1"=<configured>"}' .env.local
  ```

  Expected result: the command prints the two variable names with `<configured>` placeholders only.

- [ ] Review the final diff for accidental edits outside the migration, confirm no credentials are staged, and report the exact verification commands/results before declaring the migration complete.
