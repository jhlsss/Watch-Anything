# Radar capacity and authentication UX

## Goal

When a signed-in user already has the maximum of three active Radars, the landing page should explain the limit before sending a rule-generation request. An unauthenticated visitor should still be able to prepare rules, then receive a clear capacity message after authentication without being treated as logged out.

## Design

- Add a small authenticated capacity check used by the landing flow. It returns the active Radar count and maximum without exposing data for unauthenticated visitors.
- The landing submit handler checks capacity before calling the rules parser. At the limit it shows a localized message and links the user to the workspace; no AI request is made.
- Keep the existing server-side `ACTIVE_RADAR_LIMIT_REACHED` guard for races and direct API calls.
- When an unauthenticated rule flow reaches the limit after login or signup, preserve the authenticated session, keep the rule flow available, and route to the workspace with an explicit capacity message instead of leaving the user on `/auth` with a generic authentication error.

## Error and data flow

```text
Landing submit
  ├─ authenticated + active >= 3 → localized capacity message → workspace link
  └─ guest → parse rules → auth → pending setup
                            ├─ capacity available → continue activation
                            └─ capacity reached → authenticated workspace + message
```

The preflight is advisory; the existing creation RPC remains authoritative so concurrent requests cannot bypass the limit.

## Verification

- Logged-in user at three active Radars does not call the rules parser and sees the limit message.
- Guest flow still calls the parser and reaches authentication.
- Post-auth capacity failure redirects out of the auth page with the session intact and a specific message.
- Existing auth, landing, pending-setup, and Radar tests remain green.
