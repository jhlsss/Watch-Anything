# QA Report Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 2026-08-07 本地 QA 报告中已确认的 Landing、Rules、Auth、导航和冻结 API 问题，并保持改动局部、可回归验证。

**Architecture:** 保留现有 Next.js App Router、Rules signed token、localStorage pending flow 和 Supabase service-role 边界。Rules 在服务端解析成功前只显示原始请求与可重试状态；Auth 继续负责恢复 pending setup；Telegram/Cron 只新增报告要求的 route handler，不重写监控引擎。

**Tech Stack:** Next.js 16、React 19、TypeScript、Tailwind CSS、Zod、Supabase、Vitest、Testing Library。

## Global Constraints

- 只修 QA 报告列出的问题，不做无关重构。
- 每项行为先有一个会失败的测试，再写生产代码。
- 搜索词、重要度阈值、AI 生成主题和签名规则继续由服务端控制；客户端只提交 Radar 名称、关注项和排除项。
- Telegram/Cron 未登录或错误 secret 必须返回稳定 401，不能再返回 404。
- 所有提交只进入当前 `codex/qa-report-fixes-2026-08-07` 分支，不合并 `main`。

---

### Task 1: Write the QA regression tests first

**Files:**
- Modify: `src/components/layout/page-props.test.tsx`
- Modify: `src/components/landing/hero.test.tsx`
- Modify: `src/components/radar/rules-form.test.tsx`
- Create: `src/app/page.test.tsx`
- Create: `src/app/rules/page.test.tsx`
- Create: `src/components/auth/auth-form.test.tsx`
- Modify: `src/app/auth/actions.test.ts`

**Interfaces:**
- Consumes: current page components and existing route-flow helpers.
- Produces: failing assertions for QA-001 through QA-010 and QA-013.

- [ ] **Step 1: Add failing navigation and template assertions**

Assert that AppSidebar links use `/dashboard` and `/radars`, protected Radars preserve `next=radars`, each Landing template carries a distinct encoded `request`, and an empty hero submit stays on the page with a required-field message.

- [ ] **Step 2: Add failing Rules assertions**

Mock `/api/rules/parse` with a 502 and assert no LISA/demo rule form is rendered, the original request remains visible, and a `Retry` control exists. Mock a successful parse and assert confirming rules calls the router with `/auth?lang=en&mode=signup`. Assert Search query and Importance threshold are not editable controls.

- [ ] **Step 3: Add failing Auth assertions**

Render signup mode and assert signup-specific heading/description. Submit empty and malformed signup data and assert field-level messages without invoking authentication. Render `reset=1` and assert an explicit password-reset MVP state rather than the login form.

- [ ] **Step 4: Run the focused tests and verify they fail for the reported behavior**

Run: `pnpm vitest run src/components/layout/page-props.test.tsx src/components/landing/hero.test.tsx src/app/page.test.tsx src/app/rules/page.test.tsx src/components/radar/rules-form.test.tsx src/components/auth/auth-form.test.tsx src/app/auth/actions.test.ts`

Expected: FAIL on the new assertions because the current implementation still points to `/auth`/`/rules`, renders demo defaults after parse failure, exposes immutable inputs, keeps login copy in signup mode, and has no reset state.

### Task 2: Write failing API contract tests

**Files:**
- Create: `src/app/api/telegram/routes.test.ts`
- Create: `src/app/api/cron/run-due/route.test.ts`

**Interfaces:**
- Consumes: route handlers under `src/app/api`.
- Produces: failing assertions that the missing API paths return 401 for unauthenticated/unauthorized requests.

- [ ] **Step 1: Add route existence and auth-boundary tests**

Mock Supabase auth and server environment. Assert `GET /api/telegram/status`, `POST /api/telegram/binding-token`, and `POST /api/cron/run-due` return 401 before reading business data; assert Telegram webhook returns 401 before reading the body when the secret header is missing or wrong.

- [ ] **Step 2: Run only the API tests and verify they fail with missing-module or missing-handler failures**

Run: `pnpm vitest run src/app/api/telegram/routes.test.ts src/app/api/cron/run-due/route.test.ts`

Expected: FAIL because the route files do not exist.

### Task 3: Minimal UI and flow fixes

**Files:**
- Modify: `src/components/layout/app-sidebar.tsx`
- Modify: `src/proxy.ts`
- Modify: `src/lib/auth/service.ts`
- Modify: `src/lib/validation/auth.ts`
- Modify: `src/app/auth/actions.ts`
- Modify: `src/app/auth/page.tsx`
- Modify: `src/components/auth/auth-form.tsx`
- Modify: `src/lib/i18n/messages/en.ts`
- Modify: `src/lib/i18n/messages/zh-CN.ts`
- Modify: `src/components/landing/hero.tsx`
- Modify: `src/app/page.tsx`
- Modify: `src/components/radar/rules-form.tsx`
- Modify: `src/app/rules/page.tsx`

**Interfaces:**
- Consumes: the regression tests from Task 1.
- Produces: localized, testable Rules/Auth flows with no demo fallback after parse failure.

- [ ] **Step 1: Correct routes and safe `next` values**

Point the sidebar at `/dashboard` and `/radars`; allow the `radars` return target through proxy, validation, auth service, and action result mapping.

- [ ] **Step 2: Remove fake Rules fallback and add Retry**

Keep the original prompt in local storage, render the form only after a valid `{ rules, ruleToken }` response, show a request-specific failure card with a retry button, and route a confirmed valid draft to signup Auth.

- [ ] **Step 3: Restrict Rules editing and replace the UI-shell preview**

Keep only Radar name/include/exclude as inputs. Render generated subject, search query, threshold, schedule, and a human-readable live preview as read-only content. Add the three-step progress strip and enough bottom/mobile padding to avoid horizontal overflow and fixed-nav overlap.

- [ ] **Step 4: Preserve Landing request context and block empty submission**

Give each template its own initial prompt, encode it in `/rules?request=...`, and prevent an empty primary CTA from navigating while showing a localized required message.

- [ ] **Step 5: Fix Auth signup copy, field validation, and reset state**

Synchronize the parent heading with AuthForm mode, validate full name/email/password before invoking the server action, render errors beside their fields, and show an explicit reset-password MVP placeholder for `reset=1`.

- [ ] **Step 6: Run the focused tests and then the existing suite**

Run: `pnpm vitest run <focused files>` followed by `pnpm test`.

Expected: new assertions and all existing tests pass.

### Task 4: Add the missing Telegram and Cron route handlers

**Files:**
- Create: `src/app/api/telegram/binding-token/route.ts`
- Create: `src/app/api/telegram/status/route.ts`
- Create: `src/app/api/telegram/webhook/route.ts`
- Create: `src/app/api/cron/run-due/route.ts`
- Modify: `src/lib/telegram/binding-token.ts`
- Add: `supabase/migrations/202608070001_qa_api_routes.sql` only if the binding consume RPC is required by the route implementation.

**Interfaces:**
- Consumes: current Supabase server/admin clients, `parseServerEnv`, `hashRuleToken`, `runRadar`/`executeClaimedRun`.
- Produces: fixed API paths with stable 401 boundaries and bounded authenticated behavior.

- [ ] **Step 1: Implement binding-token and status routes**

Authenticate first. Generate a short-lived random token, persist only its hash, return the configured bot URL and expiry, and return `{ connected, username }` from the authenticated user’s Telegram connection.

- [ ] **Step 2: Implement webhook secret validation and private-chat handling**

Compare `X-Telegram-Bot-Api-Secret-Token` before parsing the body. Handle private `/start <token>` through the binding consume boundary and `/help` through the existing Telegram client; return stable JSON errors without exposing secrets.

- [ ] **Step 3: Implement Cron secret validation and one due-radar execution**

Compare `Authorization: Bearer <CRON_SECRET>` before database access. Select one due active Radar and invoke the existing schedule executor, returning a bounded summary; return 401 for missing or wrong secrets.

- [ ] **Step 4: Run API tests and lint/type checks**

Run: `pnpm vitest run src/app/api/telegram/routes.test.ts src/app/api/cron/run-due/route.test.ts && pnpm lint`.

Expected: PASS with no new lint errors.

### Task 5: Final verification and branch handoff

**Files:**
- No additional production files unless verification exposes a regression covered by the QA report.

- [ ] **Step 1: Run all tests and production checks**

Run: `pnpm test`, `pnpm lint`, `pnpm build`, and `git diff --check`.

- [ ] **Step 2: Review scope and working tree**

Confirm every changed production file maps to a QA issue, preserve the user’s pre-existing documentation/temp changes, and do not stage unrelated files.

- [ ] **Step 3: Commit the repair branch**

Run: `git add <only QA fix files>` and `git commit -m "fix: address localhost QA report"`.

Expected: commit succeeds on `codex/qa-report-fixes-2026-08-07`; do not merge `main`.
