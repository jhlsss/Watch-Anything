# Backend Workspace UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让四个后台页面共享同一套工作台壳层，并在不破坏真实数据和操作的前提下改善列表、详情和 Telegram 状态的视觉层级。

**Architecture:** `AppSidebar` 作为唯一视觉实现，`WorkspaceNavigation` 作为现有调用方的兼容适配器。页面仍由服务端读取 Supabase 数据，只有连接页和已有操作组件继续承担客户端交互；本次只调整文案、布局 utility、状态显示条件和详情指标表达。

**Tech Stack:** Next.js 16.3 App Router, React 19, Tailwind CSS utilities, Lucide React, Supabase SSR, TypeScript, Vitest, Testing Library, pnpm.

## Global Constraints

- 不新增 Overview、request 或其他原型不存在的后台路由。
- 不修改 Supabase 认证、Radars API、Telegram 绑定协议、轮询时序或登录状态判断。
- 保留 Dashboard、Radars、详情和 Telegram 页的现有链接、真实数据、空状态和错误状态。
- 中文后台导航使用“工作台 / 我的 Radars / Telegram”；产品名 `Radar` 和 `Telegram` 不翻译。
- Telegram 页面初始状态不能显示等待确认文案；只有进入等待或连接完成状态时显示状态反馈。
- 最近一次运行指标必须明确区分相关结果和候选结果，不能继续只渲染无标签的 `X / Y`。
- 触控控件保持至少约 40px 高度，移动端 390px 左右不得横向滚动，底部导航不得遮挡正文。
- 后台品牌链接使用 `/?lang=<locale>` 回到首页；首页已登录状态显示账户入口和 `进入工作区` / `Open workspace`，未登录状态保持原有 Login / Get started。
- 遵循 Next.js 16.3 App Router 文档、现有 Vitest / Testing Library 约定和 TDD 红—绿—重构顺序。

---

### Task 1: Unify the workspace shell and navigation copy

**Files:**
- Modify: `src/components/layout/app-sidebar.tsx`
- Modify: `src/components/radar/radar-actions.tsx`
- Modify: `src/lib/i18n/messages/zh-CN.ts`
- Test: `src/components/layout/page-props.test.tsx`
- Test: `src/components/radar/radar-card.test.tsx`

**Interfaces:**
- Consumes: existing `AppSidebar({ locale, currentPath })`, `WorkspaceNavigation({ locale, currentPath })`, and `getMessages(locale)`.
- Produces: one dark desktop / white mobile workspace navigation with `aria-current="page"` on the active destination; `WorkspaceNavigation` renders the same component.

- [ ] **Step 1: Add failing navigation assertions**

In `src/components/layout/page-props.test.tsx`, add a nested-route test:

```tsx
it("keeps the Radars destination active for a radar detail path", () => {
  render(<AppSidebar locale="zh-CN" currentPath="/radars/radar-1" />);

  const radarLinks = screen.getAllByRole("link", { name: "我的 Radars" });
  expect(radarLinks).toHaveLength(2);
  expect(radarLinks.every((link) => link.getAttribute("aria-current") === "page")).toBe(true);
});
```

In `src/components/radar/radar-card.test.tsx`, update the existing Chinese navigation assertions from `Dashboard` / `Radars` to `工作台` / `我的 Radars`, and keep the three locale-preserving href assertions unchanged.

- [ ] **Step 2: Run the focused tests and confirm RED**

Run:

```bash
pnpm exec vitest run src/components/layout/page-props.test.tsx src/components/radar/radar-card.test.tsx
```

Expected: FAIL because the current Chinese labels are still English and `AppSidebar` does not expose `aria-current` for `/radars/radar-1`.

- [ ] **Step 3: Implement the minimal shared shell change**

In `src/lib/i18n/messages/zh-CN.ts`, set:

```ts
dashboard: "工作台",
radars: "我的 Radars",
telegram: "Telegram",
```

In `src/components/layout/app-sidebar.tsx`:

```tsx
const active = currentPath === href || (href === "/radars" && currentPath.startsWith("/radars/"));
```

Use `aria-current={active ? "page" : undefined}` on both desktop and mobile links. Render the desktop aside with `w-60 bg-slate-950 text-white`, a violet Radar icon mark beside the brand, rounded active links with `bg-white/10`, and keep the mobile bottom navigation as a white fixed bar with `min-h-12` links. The brand link must use `withLocale("/", locale)` so the backend shell returns to the public home page.

In `src/components/radar/radar-actions.tsx`, replace the duplicated `WorkspaceNavigation` JSX and its local navigation copy with:

```tsx
import { AppSidebar } from "@/components/layout/app-sidebar";

export function WorkspaceNavigation({ locale, currentPath }: { locale: Locale; currentPath: string }) {
  return <AppSidebar locale={locale} currentPath={currentPath} />;
}
```

Increase the locale toggle buttons to `min-h-9` with `px-3` while keeping the existing persistence and router behavior unchanged.

In `src/components/layout/site-header.tsx`, add an optional `accountAction?: NavLink` prop. Render it as a compact, truncated account link before the locale switcher, with the same localized href handling as the existing actions. Keep it absent when the visitor is not authenticated.

In `src/app/page.tsx`, import the existing browser Supabase client and read `auth.getUser()` in a guarded `useEffect`. Store only the user's email for display; a failed read leaves the public header unchanged. Pass `accountAction={{ href: "/dashboard", label: userEmail }}` and `primaryAction={{ href: "/dashboard", label: copy.nav.workspace }}` when an email exists. Otherwise preserve the existing `/auth` and `/#hero-request` actions. Add `workspace: "Open workspace"` and `workspace: "进入工作区"` to the two message files.

- [ ] **Step 4: Run the focused tests and confirm GREEN**

Run the same Vitest command. Expected: all existing navigation, page-prop, Radar, Dashboard and detail tests pass.

### Task 2: Clarify Telegram connection states

**Files:**
- Modify: `src/lib/i18n/messages/en.ts`
- Modify: `src/lib/i18n/messages/zh-CN.ts`
- Modify: `src/components/telegram/connect-card.tsx`
- Modify: `src/app/connect-telegram/page.tsx`
- Test: `src/components/telegram/connect-card.test.tsx`
- Test: `src/app/connect-telegram/page.test.tsx`

**Interfaces:**
- Consumes: existing `ConnectionState`, `botUrl`, `isPreparing`, `onConnectTelegram`, and Telegram polling APIs.
- Produces: `ConnectCard` accepts `statusMessage?: string | null` and renders it only when provided; the page passes a status only for waiting, connected, or error states.

- [ ] **Step 1: Add the failing initial-state assertion**

Add to `src/components/telegram/connect-card.test.tsx`:

```tsx
it("does not show a waiting message before confirmation begins", () => {
  const copy = getMessages("en").telegram;

  render(
    <ConnectCard
      locale="en"
      botUrl="https://t.me/watchanything_bot?start=one-time-token"
      onConnectTelegram={vi.fn()}
    />,
  );

  expect(screen.queryByText(copy.waiting)).not.toBeInTheDocument();
});
```

Change the existing waiting test to pass `statusMessage={copy.waiting}` and assert the message is rendered after the callback button is clicked. Add `statusMessage?: string | null` to the test fixture only after the implementation makes the prop available.

- [ ] **Step 2: Run the focused Telegram tests and confirm RED**

Run:

```bash
pnpm exec vitest run src/components/telegram/connect-card.test.tsx src/app/connect-telegram/page.test.tsx
```

Expected: the new initial-state test fails because `ConnectCard` currently renders `copy.waiting` unconditionally.

- [ ] **Step 3: Implement state-aware user copy**

Change the English and Chinese `telegram.waiting` strings to `Waiting for Telegram connection confirmation.` and `正在等待 Telegram 连接确认。` respectively. In `ConnectCard`, render the bottom status panel only when `statusMessage` is non-empty:

```tsx
{statusMessage ? (
  <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700" role="status" aria-live="polite">
    {statusMessage}
  </div>
) : null}
```

In `src/app/connect-telegram/page.tsx`, change the default `statusText` to `null` and keep messages only for `waiting`, `connected`, and `error`; the idle state is already explained by the numbered steps. Pass `statusMessage={statusText}` into `ConnectCard`, and remove the duplicate outer status paragraph. Preserve `fetch`, polling, `activateRadar`, and redirects exactly.

- [ ] **Step 4: Run the focused Telegram tests and confirm GREEN**

Run the same focused Vitest command. Expected: token generation, button callback, initial idle, and state feedback tests pass.

### Task 3: Make the Radar list and detail data easier to scan

**Files:**
- Modify: `src/components/radar/radar-card.tsx`
- Modify: `src/app/radars/page.tsx`
- Modify: `src/app/radars/[id]/page.tsx`
- Test: `src/components/radar/radar-card.test.tsx`

**Interfaces:**
- Consumes: existing `RadarCardRadar`, `RadarStatus`, findings, runs, rules and `RadarActions` props.
- Produces: no API or data-shape changes; the Radar card remains one full-card link and detail page remains server-rendered.

- [ ] **Step 1: Add the failing run-summary assertion**

In the existing detail-page test fixture, assert that the rendered latest-run metric includes the explicit labels:

```tsx
expect(screen.getByText("相关 2 / 候选 4")).toBeInTheDocument();
```

Use the existing `detailRadarRow` and run fixture values so the assertion is tied to real page data rather than a hard-coded component mock.

- [ ] **Step 2: Run the detail-focused test and confirm RED**

Run:

```bash
pnpm exec vitest run src/components/radar/radar-card.test.tsx
```

Expected: FAIL because the current detail page renders only `2 / 4`.

- [ ] **Step 3: Implement the list and detail visual changes**

In `src/app/radars/[id]/page.tsx`, add localized functions:

```ts
runSummary: (relevant: number, candidates: number) => `Relevant ${relevant} / Candidates ${candidates}`
runSummary: (relevant: number, candidates: number) => `相关 ${relevant} / 候选 ${candidates}`
```

Render `labels.runSummary(latestRun.relevant_count, latestRun.candidate_count)` in the KPI value. Make the desktop rules aside `min-[850px]:sticky min-[850px]:top-6 self-start`, keep findings before rules in the responsive DOM order, and use tighter mobile padding (`p-4 sm:p-5`) without removing any rule content.

In `src/app/radars/page.tsx`, change the Radar section to `className="mt-7 grid min-w-0 gap-3"`.

In `src/components/radar/radar-card.tsx`, change the article to a calmer `rounded-2xl` list row with no translate-on-hover, keep a white background and thin border, use responsive `sm:flex` metric alignment where it fits, preserve full-card focus ring, and highlight a positive `newFindings` count with violet text. Do not add new actions or change the href.

- [ ] **Step 4: Run the detail/list tests and confirm GREEN**

Run the same Vitest command and confirm Radar, Dashboard, Radars, detail, action, and locale tests pass.

### Task 4: Verify the complete backend UI

**Files:**
- No additional source files unless a verification failure identifies a regression.

- [ ] **Step 1: Add failing homepage account-state tests**

In `src/app/page.test.tsx`, mock `@/lib/supabase/client` with a browser client whose `auth.getUser()` can return a user, then add:

```tsx
it("shows the signed-in account and workspace link on the homepage", async () => {
  createBrowserClientMock.mockReturnValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { email: "qa@example.com" } } }) },
  });

  render(<Home searchParams={fulfilledSearchParams as never} />);

  expect(await screen.findByRole("link", { name: "qa@example.com" })).toHaveAttribute(
    "href",
    "/dashboard?lang=en",
  );
  expect(screen.getByRole("link", { name: "Open workspace" })).toHaveAttribute(
    "href",
    "/dashboard?lang=en",
  );
  expect(screen.queryByRole("link", { name: "Log in" })).toBeNull();
});
```

In `src/components/layout/site-header.test.tsx`, add a direct prop test proving `accountAction` renders as a language-preserving Dashboard link. Keep the existing public header tests unchanged.

- [ ] **Step 2: Run all focused tests and confirm RED**

```bash
pnpm exec vitest run src/components/layout/page-props.test.tsx src/components/layout/site-header.test.tsx src/app/page.test.tsx src/components/radar/radar-card.test.tsx src/components/telegram/connect-card.test.tsx src/app/connect-telegram/page.test.tsx
```

Expected: the new account and updated shell assertions fail before their implementation exists.

- [ ] **Step 3: Implement the homepage auth-aware header**

Add `workspace` copy to `src/lib/i18n/messages/en.ts` and `src/lib/i18n/messages/zh-CN.ts`. Use the existing `createClient` from `src/lib/supabase/client` in `Home`:

```tsx
const [accountEmail, setAccountEmail] = useState<string | null>(null);

useEffect(() => {
  let active = true;
  const supabase = createClient();

  void supabase.auth.getUser().then(({ data: { user } }) => {
    if (active) setAccountEmail(user?.email ?? null);
  }).catch(() => {
    if (active) setAccountEmail(null);
  });

  return () => {
    active = false;
  };
}, []);
```

Pass `accountAction` and the authenticated `primaryAction` to `SiteHeader` only when `accountEmail` is non-null. Do not store tokens or user objects in local storage, and do not change the existing request flow.

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run the focused command again. Expected: account links, public header links, workspace navigation, and Telegram tests all pass.

- [ ] **Step 5: Run focused regression tests**

```bash
pnpm exec vitest run src/components/layout/page-props.test.tsx src/components/radar/radar-card.test.tsx src/components/telegram/connect-card.test.tsx src/app/connect-telegram/page.test.tsx
```

- [ ] **Step 6: Run repository checks**

```bash
pnpm test
pnpm lint
pnpm build
```

Expected: all commands exit 0 without TypeScript, ESLint, or console errors.

- [ ] **Step 7: Run browser visual regression**

With the local app running, inspect `/dashboard?lang=en`, `/radars?lang=en`, one real `/radars/[id]?lang=en`, and `/connect-telegram?lang=en` at desktop and approximately 390px wide. Repeat for `lang=zh-CN`. Confirm the shared shell, active navigation, state messages, real links, no horizontal scrolling, and no bottom-nav overlap. Record any remaining issues before claiming completion.
