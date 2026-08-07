# Dashboard Logout Design

**Status:** Approved

**Date:** 2026-08-07

## Goal

Add a complete logout flow to the authenticated workspace. A signed-in user can log out from the Dashboard, the server clears the Supabase session, and the browser returns to the public home page at `/`.

## Scope

In scope:

- A server-side Supabase `auth.signOut()` call.
- A parameterless Server Action used by the Dashboard.
- A Dashboard logout control beside the existing locale switcher and new-Radar action.
- English and Simplified Chinese labels for idle, pending, and failed logout states.
- Unit and component coverage for the service, action, and UI behavior.

Out of scope:

- A new `/api/auth/logout` route.
- Changes to the existing login, registration, or protected-route behavior.
- Manual deletion of Supabase-managed cookies.
- Logout controls in the global landing-page navigation or other authenticated pages.

## Architecture

### Auth service

Add `signOut` to `src/lib/auth/service.ts`. It accepts an optional structural client containing `auth.signOut()` so the production path uses the existing server Supabase client while tests can provide a small fake client. The function returns Supabase's sign-out error result without introducing service-role credentials or user input.

### Server Action

Add `LogoutActionResult` and a parameterless `logoutAction` to `src/app/auth/actions.ts`. The action calls the auth service with the server Supabase client. A successful Supabase response maps to `{ ok: true }`; a returned error or thrown exception is logged and maps to `{ ok: false, error: "SIGN_OUT_FAILED" }`.

The action does not accept a redirect target. The client owns the fixed post-success navigation to `/`, so the flow cannot become an open redirect.

### Dashboard control

Create `src/components/auth/logout-button.tsx` as a client component. It receives localized labels from the Dashboard, calls `logoutAction`, and uses `router.replace("/")` after `{ ok: true }`. While the action is running, the button is disabled and uses the pending label. A failed result or unexpected exception leaves the user on the Dashboard and renders a localized `role="alert"` message.

Extend the Dashboard's local copy object with `logout`, `loggingOut`, and `logoutError` strings in both supported locales. Render `LogoutButton` in the existing Dashboard header action group.

## Data flow

1. The user clicks the Dashboard logout button.
2. The client calls the parameterless `logoutAction` Server Action.
3. The action creates the existing server Supabase client and calls `auth.signOut()`.
4. Supabase SSR applies the session-cookie changes through the existing cookie adapter.
5. The action returns success to the client.
6. The client replaces the current history entry with `/`.
7. If any step before success fails, the button is re-enabled and the localized error is shown without navigation.

## Security and error handling

- Logout uses the authenticated server Supabase session and never uses the service-role client.
- The Server Action takes no arguments, so callers cannot provide a destination or affect another user's session.
- Supabase errors and unexpected exceptions are treated as `SIGN_OUT_FAILED` and logged server-side without exposing provider details to the UI.
- The UI must not claim success or navigate to `/` when the server action reports failure.
- Existing proxy protection remains the authority for protected routes after the session is cleared.

## Testing

- Add auth-service coverage proving `signOut` invokes the injected client's `auth.signOut()` and returns its error result.
- Extend auth-action coverage for a successful `logoutAction`, a Supabase sign-out error, and a thrown service error.
- Add `LogoutButton` component coverage proving a successful action calls `router.replace("/")`, while a failed action displays an alert and does not navigate.
- Run the focused tests, the complete Vitest suite, ESLint, and the production build.

## Planned file changes

| File | Responsibility |
| --- | --- |
| `src/lib/auth/service.ts` | Expose the server auth-service sign-out operation. |
| `src/lib/auth/service.test.ts` | Verify the sign-out service behavior. |
| `src/app/auth/actions.ts` | Expose the parameterless logout Server Action and result type. |
| `src/app/auth/actions.test.ts` | Verify logout success and failure mapping. |
| `src/components/auth/logout-button.tsx` | Render and manage the Dashboard logout interaction. |
| `src/components/auth/logout-button.test.tsx` | Verify navigation, pending state, and failure feedback. |
| `src/app/dashboard/page.tsx` | Add localized copy and render the logout control. |

