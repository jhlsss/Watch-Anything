# Dashboard Logout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a server-backed Dashboard logout control that clears the Supabase session and navigates to `/` only after a successful sign-out.

**Architecture:** Extend the existing server auth service with an injectable `signOut` operation. Add a parameterless `logoutAction` Server Action that maps provider failures to a stable result, then let a small client `LogoutButton` call the action, show pending/error states, and replace the browser location with `/` on success. Wire that component into the existing Dashboard header with English and Simplified Chinese copy.

**Tech Stack:** Next.js 16.3 App Router, React 19, Supabase SSR, TypeScript, Vitest, Testing Library, pnpm.

## Global Constraints

- Keep the logout entry only in the Dashboard header, beside the existing locale switcher and new-Radar action.
- Use the existing server Supabase client and `auth.signOut()`; do not use the service-role client or manually delete Supabase cookies.
- `logoutAction` accepts no arguments and never accepts a caller-provided redirect target.
- Navigate to `/` only after `{ ok: true }`; keep the user on Dashboard for failures.
- Add English and Simplified Chinese idle, pending, and error labels.
- Follow the repository's Vitest and Testing Library conventions and preserve all existing unrelated working-tree changes.
- Follow Next.js 16.3 App Router conventions in `node_modules/next/dist/docs/`; Server Action code stays in a module with the existing `"use server"` directive.

---

### Task 1: Add the auth-service sign-out operation

**Files:**
- Create: `src/lib/auth/service.test.ts`
- Modify: `src/lib/auth/service.ts:5-19,78-80,91-135`

**Interfaces:**
- Consumes: the existing `createClient` import from `@/lib/supabase/server` and Supabase's `AuthResponse["error"]` type.
- Produces: `signOut(client?: SignOutClient): Promise<{ error: AuthResponse["error"] }>` for the Server Action and tests.

- [ ] **Step 1: Write the failing service test**

Create `src/lib/auth/service.test.ts` with one behavior-focused test:

```typescript
import { describe, expect, it, vi } from "vitest";

import { signOut } from "@/lib/auth/service";

describe("signOut", () => {
  it("calls the provided auth client and returns its provider result", async () => {
    const providerError = { message: "Sign out unavailable" };
    const signOutMock = vi.fn().mockResolvedValue({ error: providerError });
    const client = { auth: { signOut: signOutMock } };

    await expect(signOut(client)).resolves.toEqual({ error: providerError });
    expect(signOutMock).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
pnpm exec vitest run src/lib/auth/service.test.ts
```

Expected: FAIL because `src/lib/auth/service.ts` does not yet export `signOut`.

- [ ] **Step 3: Implement the minimal service operation**

In `src/lib/auth/service.ts`, add this client type after `PasswordAuthClient`:

```typescript
type SignOutClient = {
  auth: {
    signOut(): Promise<{ error: AuthResponse["error"] }>;
  };
};
```

Add a resolver after the existing `resolveClient` helper:

```typescript
async function resolveSignOutClient(client?: SignOutClient) {
  return client ?? (await createClient());
}
```

Add this exported function after the existing password-auth functions:

```typescript
export async function signOut(
  client?: SignOutClient,
): Promise<{ error: AuthResponse["error"] }> {
  const supabase = await resolveSignOutClient(client);
  return supabase.auth.signOut();
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
pnpm exec vitest run src/lib/auth/service.test.ts
```

Expected: PASS with one passing test and no warnings.

- [ ] **Step 5: Commit the service change**

```bash
git add src/lib/auth/service.ts src/lib/auth/service.test.ts
git commit -m "feat: add server auth sign-out service"
```

### Task 2: Add the logout Server Action and stable result mapping

**Files:**
- Modify: `src/app/auth/actions.ts:3-8, after AuthenticateActionResult`
- Modify: `src/app/auth/actions.test.ts:1-8, after the authenticateAction suite`

**Interfaces:**
- Consumes: `signOut()` from `@/lib/auth/service` and the existing mocked server Supabase client.
- Produces: `LogoutActionResult` and `logoutAction(): Promise<LogoutActionResult>`.

- [ ] **Step 1: Extend the auth-action test with failing logout cases**

In `src/app/auth/actions.test.ts`:

1. Add `logoutAction` to the existing import:

```typescript
import { authenticateAction, logoutAction } from "@/app/auth/actions";
```

2. Add `signOutMock` to the existing `vi.hoisted` object:

```typescript
const {
  createAdminClientMock,
  createServerClientMock,
  parseRulesMock,
  signInMock,
  createUserMock,
  signOutMock,
} = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(),
  createServerClientMock: vi.fn(),
  parseRulesMock: vi.fn(),
  signInMock: vi.fn(),
  createUserMock: vi.fn(),
  signOutMock: vi.fn(),
}));
```

3. Add this suite after the existing `describe("authenticateAction", ...)` block:

```typescript
describe("logoutAction", () => {
  beforeEach(() => {
    signOutMock.mockReset();
    createServerClientMock.mockReset();
    createServerClientMock.mockReturnValue({
      auth: { signOut: signOutMock },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns success after the server Supabase client signs out", async () => {
    signOutMock.mockResolvedValue({ error: null });

    await expect(logoutAction()).resolves.toEqual({ ok: true });
    expect(signOutMock).toHaveBeenCalledOnce();
  });

  it("maps a Supabase sign-out error to a stable action error", async () => {
    const providerError = { message: "Sign out unavailable" };
    signOutMock.mockResolvedValue({ error: providerError });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(logoutAction()).resolves.toEqual({
      ok: false,
      error: "SIGN_OUT_FAILED",
    });
    expect(consoleError).toHaveBeenCalledWith("Logout failed.", providerError);
  });

  it("maps an unexpected sign-out exception to a stable action error", async () => {
    const exception = new Error("network unavailable");
    signOutMock.mockRejectedValue(exception);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(logoutAction()).resolves.toEqual({
      ok: false,
      error: "SIGN_OUT_FAILED",
    });
    expect(consoleError).toHaveBeenCalledWith("Logout failed.", exception);
  });
});
```

- [ ] **Step 2: Run the action tests to verify they fail**

Run:

```bash
pnpm exec vitest run src/app/auth/actions.test.ts
```

Expected: FAIL because `logoutAction` is not exported yet.

- [ ] **Step 3: Implement the minimal Server Action**

In `src/app/auth/actions.ts`, include `signOut` in the auth-service import:

```typescript
import {
  resolveSafeNext,
  signInWithPassword,
  signOut,
  signUpWithPassword,
} from "@/lib/auth/service";
```

Add the result type after `AuthenticateActionResult`:

```typescript
export type LogoutActionResult =
  | { ok: true }
  | { ok: false; error: "SIGN_OUT_FAILED" };
```

Add the Server Action after `authenticateAction`:

```typescript
export async function logoutAction(): Promise<LogoutActionResult> {
  try {
    const result = await signOut();

    if (result.error) {
      console.error("Logout failed.", result.error);
      return { ok: false, error: "SIGN_OUT_FAILED" };
    }

    return { ok: true };
  } catch (error) {
    console.error("Logout failed.", error);
    return { ok: false, error: "SIGN_OUT_FAILED" };
  }
}
```

- [ ] **Step 4: Run the action tests to verify they pass**

Run:

```bash
pnpm exec vitest run src/app/auth/actions.test.ts
```

Expected: PASS for the existing authentication tests and all three new logout tests.

- [ ] **Step 5: Commit the Server Action change**

```bash
git add src/app/auth/actions.ts src/app/auth/actions.test.ts
git commit -m "feat: add logout server action"
```

### Task 3: Build and test the reusable logout button

**Files:**
- Create: `src/components/auth/logout-button.tsx`
- Create: `src/components/auth/logout-button.test.tsx`

**Interfaces:**
- Consumes: `logoutAction()` and `useRouter().replace()`.
- Produces: `LogoutButtonLabels` and `LogoutButton` for the Dashboard header.

- [ ] **Step 1: Write the failing component tests**

Create `src/components/auth/logout-button.test.tsx`:

```tsx
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { logoutActionMock, routerReplaceMock } = vi.hoisted(() => ({
  logoutActionMock: vi.fn(),
  routerReplaceMock: vi.fn(),
}));

vi.mock("@/app/auth/actions", () => ({ logoutAction: logoutActionMock }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: routerReplaceMock }),
}));

import { LogoutButton, type LogoutButtonLabels } from "@/components/auth/logout-button";

const labels: LogoutButtonLabels = {
  logout: "Log out",
  loggingOut: "Logging out…",
  error: "Logout failed. Please try again.",
};

afterEach(() => {
  cleanup();
  logoutActionMock.mockReset();
  routerReplaceMock.mockReset();
});

describe("LogoutButton", () => {
  it("replaces the current route with the home page after a successful logout", async () => {
    logoutActionMock.mockResolvedValue({ ok: true });
    render(<LogoutButton labels={labels} />);

    fireEvent.click(screen.getByRole("button", { name: "Log out" }));

    await waitFor(() => expect(routerReplaceMock).toHaveBeenCalledWith("/"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("disables the button and shows the pending label while logout is running", async () => {
    let resolveLogout!: (value: { ok: true }) => void;
    logoutActionMock.mockReturnValue(
      new Promise<{ ok: true }>((resolve) => {
        resolveLogout = resolve;
      }),
    );
    render(<LogoutButton labels={labels} />);

    fireEvent.click(screen.getByRole("button", { name: "Log out" }));

    expect(screen.getByRole("button", { name: "Logging out…" })).toBeDisabled();
    resolveLogout({ ok: true });
    await waitFor(() => expect(routerReplaceMock).toHaveBeenCalledWith("/"));
  });

  it("shows an alert and does not navigate when logout fails", async () => {
    logoutActionMock.mockResolvedValue({ ok: false, error: "SIGN_OUT_FAILED" });
    render(<LogoutButton labels={labels} />);

    fireEvent.click(screen.getByRole("button", { name: "Log out" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(labels.error);
    expect(routerReplaceMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the component tests to verify they fail**

Run:

```bash
pnpm exec vitest run src/components/auth/logout-button.test.tsx
```

Expected: FAIL because `src/components/auth/logout-button.tsx` does not exist.

- [ ] **Step 3: Implement the minimal client component**

Create `src/components/auth/logout-button.tsx`:

```tsx
"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { logoutAction } from "@/app/auth/actions";

export type LogoutButtonLabels = {
  logout: string;
  loggingOut: string;
  error: string;
};

export function LogoutButton({ labels }: { labels: LogoutButtonLabels }) {
  const router = useRouter();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [hasError, setHasError] = useState(false);

  const handleLogout = async () => {
    if (isLoggingOut) {
      return;
    }

    setHasError(false);
    setIsLoggingOut(true);

    try {
      const result = await logoutAction();

      if (!result.ok) {
        setHasError(true);
        return;
      }

      router.replace("/");
    } catch {
      setHasError(true);
    } finally {
      setIsLoggingOut(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={isLoggingOut}
        aria-busy={isLoggingOut}
        onClick={() => void handleLogout()}
        className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-600 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <LogOut className="h-4 w-4" aria-hidden="true" />
        {isLoggingOut ? labels.loggingOut : labels.logout}
      </button>
      {hasError ? (
        <p role="alert" className="text-xs text-rose-600">
          {labels.error}
        </p>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Run the component tests to verify they pass**

Run:

```bash
pnpm exec vitest run src/components/auth/logout-button.test.tsx
```

Expected: PASS for success navigation, pending state, and failure feedback.

- [ ] **Step 5: Commit the component change**

```bash
git add src/components/auth/logout-button.tsx src/components/auth/logout-button.test.tsx
git commit -m "feat: add logout button"
```

### Task 4: Wire the logout button into Dashboard with localized copy

**Files:**
- Modify: `src/app/dashboard/page.tsx:1-10,48-113,283-292`
- Modify: `src/components/radar/radar-card.test.tsx:1-18, existing Dashboard rendering test`

**Interfaces:**
- Consumes: `LogoutButton` and its `LogoutButtonLabels` prop type.
- Produces: a visible Dashboard logout control with localized labels and no change to protected-page data loading.

- [ ] **Step 1: Add the failing Dashboard integration assertion**

In the existing Dashboard locale-link test in `src/components/radar/radar-card.test.tsx`, after the existing view-all link assertion, add:

```tsx
expect(screen.getByRole("button", { name: "退出登录" })).toBeInTheDocument();
```

Add this hoisted mock near the existing `vi.hoisted` mocks before importing `DashboardPage` so the integration test never invokes the real Server Action:

```tsx
const logoutActionMock = vi.hoisted(() => vi.fn());

vi.mock("@/app/auth/actions", () => ({
  logoutAction: logoutActionMock,
}));
```

- [ ] **Step 2: Run the Dashboard integration test to verify it fails**

Run:

```bash
pnpm exec vitest run src/components/radar/radar-card.test.tsx
```

Expected: FAIL in the Dashboard locale-link test because no logout button is rendered yet.

- [ ] **Step 3: Add localized copy and render the control**

In `src/app/dashboard/page.tsx`, import the component:

```tsx
import { LogoutButton } from "@/components/auth/logout-button";
```

Add these fields to both branches of the existing `copy` object:

```typescript
// en
logout: "Log out",
loggingOut: "Logging out…",
logoutError: "Logout failed. Please try again.",

// zh-CN
logout: "退出登录",
loggingOut: "退出中…",
logoutError: "退出失败，请重试。",
```

Render the component in the existing header action group before `WorkspaceLocaleSwitcher`:

```tsx
<LogoutButton
  labels={{
    logout: labels.logout,
    loggingOut: labels.loggingOut,
    error: labels.logoutError,
  }}
/>
<WorkspaceLocaleSwitcher locale={locale} userId={user.id} path="/dashboard" />
```

- [ ] **Step 4: Run the Dashboard integration test to verify it passes**

Run:

```bash
pnpm exec vitest run src/components/radar/radar-card.test.tsx
```

Expected: PASS, including the existing Dashboard and workspace tests, with the localized `退出登录` button present.

- [ ] **Step 5: Commit the Dashboard integration**

```bash
git add src/app/dashboard/page.tsx src/components/radar/radar-card.test.tsx
git commit -m "feat: add dashboard logout entry"
```

### Task 5: Run the complete verification gate

**Files:**
- Read-only verification of all changed files and the existing worktree.

**Interfaces:**
- Consumes: the four committed implementation slices from Tasks 1–4.
- Produces: verified tests, lint, build, and a clean diff check for the new changes without staging unrelated user work.

- [ ] **Step 1: Run the focused logout and Dashboard tests**

```bash
pnpm exec vitest run \
  src/lib/auth/service.test.ts \
  src/app/auth/actions.test.ts \
  src/components/auth/logout-button.test.tsx \
  src/components/radar/radar-card.test.tsx
```

Expected: PASS with zero failed tests.

- [ ] **Step 2: Run the complete test suite**

```bash
pnpm test
```

Expected: PASS for the full Vitest suite.

- [ ] **Step 3: Run lint**

```bash
pnpm lint
```

Expected: ESLint exits with code 0 and reports no warnings/errors introduced by the logout files.

- [ ] **Step 4: Run the production build**

```bash
pnpm build
```

Expected: Next.js 16.3 production build exits with code 0.

- [ ] **Step 5: Check the final diff and preserve unrelated work**

```bash
git diff --check
git status --short
```

Expected: no whitespace errors. The pre-existing modifications to `src/app/auth/page.tsx`, `src/app/rules/page.test.tsx`, `src/app/rules/page.tsx`, and untracked `src/lib/auth/pending-setup.ts` remain present and are not staged by the logout commits.
