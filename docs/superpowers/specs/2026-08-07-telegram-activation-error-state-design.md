# Telegram connection and Radar activation error states

## Problem

After Telegram sends a successful `/start` update, the connect page continues into Radar activation. The page currently handles Telegram status polling and Radar activation in one `try/catch`, so a missing pending setup or a Radar API failure is reported as “Telegram verification failed”. This makes a successful Telegram binding look broken.

## Design

- Keep Telegram verification and Radar activation as separate phases in the client flow.
- When the status endpoint reports `connected`, preserve that success state even if there is no pending Radar setup.
- If a pending setup exists but Radar activation fails, display an activation-specific error and preserve the actual API error code for diagnosis.
- Disable the confirmation action while a poll/activation attempt is in progress so repeated clicks cannot replace an active attempt.
- Cover the connected-without-setup and activation-failure paths with page tests; retain the existing deep-link test.

## Acceptance criteria

1. A successful Telegram binding never renders the Telegram verification error because Radar activation failed.
2. Opening the standalone Telegram page with no pending setup shows Telegram as connected without attempting to create a Radar.
3. A Radar activation failure is visible as a Radar activation failure, not a Telegram failure.
4. Repeated confirmation clicks do not start overlapping polling attempts.
5. Existing typecheck, lint, build, and test suites remain green.
