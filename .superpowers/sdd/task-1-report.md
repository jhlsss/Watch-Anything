# Task 1 Report: Replace the dependency and environment contract

## Scope

Implemented only Task 1 dependency and environment changes. The configured Gemini secret values were not read, printed, or included in this report.

## Files changed

- `package.json`: added `@next/env` and `openai`; removed `groq-sdk`.
- `pnpm-lock.yaml`: updated through pnpm for the dependency changes.
- `src/lib/env.ts`: replaced the Groq server fields with required `GEMINI_API_KEY` and defaulted `GEMINI_MODEL` to `gemini-3.1-flash-lite`.
- `src/lib/env.test.ts`: changed the fixture and default-model assertion to Gemini while retaining all non-AI requirements.
- `.env.example`: replaced the Groq variables with the requested Gemini variables; Supabase, Tavily, cron, and Telegram variables are unchanged.

## TDD evidence

- RED: after changing `src/lib/env.test.ts` first, `pnpm vitest run src/lib/env.test.ts` failed 1 of 4 tests because `src/lib/env.ts` still required `GROQ_API_KEY`.
- GREEN: after the minimal implementation, the same focused command passed all 4 tests.

## Verification

- `pnpm vitest run src/lib/env.test.ts` — PASS, 1 file and 4 tests.
- `pnpm exec eslint src/lib/env.ts src/lib/env.test.ts` — PASS.
- `git diff --check` — PASS.
- `pnpm test` — 19 test files passed; 7 failed to load or run because later migration tasks still import the intentionally removed `groq-sdk`. One additional integration test failed for the same unresolved later-task import path. This is the expected cross-task dependency gap while Tasks 2–6 remain untouched.

## Self-review

The diff is limited to the requested Task 1 files plus this report. Non-AI server requirements remain present, the Gemini key remains server-only, no `NEXT_PUBLIC_` alias was added, and no secret value appears in source, output, or this report.

## Concerns

The complete repository test suite cannot pass until the later approved migration tasks update remaining Groq imports and fixtures. No Task 2–6 changes were made to mask that expected intermediate-state failure.
