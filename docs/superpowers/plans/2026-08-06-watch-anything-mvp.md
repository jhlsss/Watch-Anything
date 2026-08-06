# Watch Anything MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` (recommended) or `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在约 12 个有效工作小时内完成并部署一个可演示的 SaaS MVP：用户描述需求，AI 生成规则，用户登录并绑定 Telegram，创建多个 Radar，获取真实信息并发送通知。

**Architecture:** 使用 Next.js 模块化单体承载页面、API 和监控逻辑；Supabase 提供 Auth、PostgreSQL、RLS 和 Cron；Groq 负责规则生成与候选筛选；Tavily 与固定 RSS 提供公开信息；Telegram Bot 负责账号绑定和通知。开发按垂直闭环推进，不先铺开非核心页面。

**Tech Stack:** pnpm、Next.js App Router、TypeScript、Tailwind CSS、shadcn/ui、Lucide、React Hook Form、Zod、Supabase、Groq、Tavily、Telegram Bot API、Vitest、Vercel。

## Global Constraints

- 统一使用 `pnpm`；禁止混用 npm、yarn 或 bun，仓库只提交 `pnpm-lock.yaml`。
- Node.js 最低 20.9。
- 额外支出不超过 50 元，不购买域名或服务器，使用 Vercel 免费域名。
- 创建流程固定为独立页面：Landing → Rules → Auth → Telegram → Radar 详情，不改回弹窗。
- 一个用户只绑定一个 Telegram 私聊，该连接服务于这个用户的所有 Radar。
- 最多同时启用 3 个 Radar；演示至少真实创建 2 个。
- Run 对用户只显示 `running`、`success`、`failed`。
- 不向用户显示 Tavily、RSS、Groq、HTTP 状态码或内部错误细节。
- 所有密钥只在服务端使用；Supabase Session 使用官方 SSR Cookie，不把 JWT 放进 localStorage。
- UI 参照 `.superpowers/brainstorm/79724-1785854240/content/` 中的 canonical 原型；原型决定布局和流程，需求文档决定行为，技术设计决定安全与数据边界。
- shadcn/ui 只作为基础组件源码；颜色、间距和布局不得退回默认模板风格。
- 所有功能图标使用 Lucide SVG，不使用 Emoji。
- 850px 以下切为单栏；390 × 844 不允许横向滚动；移动端必须保留 Dashboard、Radars、Telegram。
- 自动 Cron 可以在第 8 小时真实闭环未完成时降级为“立即检查”，但真实搜索、真实 Telegram、多个 Radar、部署地址和核心双语不能降级。

---

## 1. 冻结的公共接口

Task 0 创建这些类型。后续窗口只能导入，不能自行重命名或复制另一套类型。

```ts
export type RunStatus = "running" | "success" | "failed";
export type RadarStatus = "active" | "paused";
export type NotificationStatus =
  | "pending"
  | "sending"
  | "sent"
  | "failed"
  | "unknown";

export interface RadarRules {
  radarName: string;
  subject: string;
  aliases: string[];
  includeTopics: string[];
  excludeTopics: string[];
  searchQuery: string;
  importanceThreshold: number;
  intervalMinutes: 360;
}

export interface EditableRuleDelta {
  radarName: string;
  includeTopics: string[];
  excludeTopics: string[];
}

export interface Candidate {
  sourceType: "tavily" | "rss";
  sourceDomain: string;
  sourceUrl: string;
  title: string;
  excerpt: string;
  publishedAt: string | null;
}

export interface SourceOutcome {
  source: "tavily" | "rss";
  success: boolean;
  candidateCount: number;
  errorCode: string | null;
}

export interface RunResult {
  runId: string;
  status: RunStatus;
  candidateCount: number;
  relevantCount: number;
  notificationCount: number;
}
```

固定 API：

| Method | Path | 返回或职责 |
|---|---|---|
| POST | `/api/rules/parse` | `{ rules, ruleToken }` |
| POST | `/api/pending-setups` | `{ next: "connect-telegram" }` 或 `{ next: "radar", radarId }` |
| GET | `/api/pending-setups/current` | 当前用户未过期 setup |
| POST | `/api/telegram/binding-token` | `{ botUrl, expiresAt }` |
| GET | `/api/telegram/status` | `{ connected, username }` |
| POST | `/api/telegram/webhook` | Telegram `/start` 与 `/help` |
| GET/POST | `/api/radars` | 列表、从 setup 创建 Radar |
| GET/PATCH | `/api/radars/[id]` | 详情、暂停、恢复、编辑规则 |
| POST | `/api/radars/[id]/run` | 手动检查 |
| POST | `/api/cron/run-due` | 恢复旧 Run 并执行到期 Radar |

---

## 2. 并行执行拓扑

### 不可并行的主链

```text
Task 0 项目骨架与契约
  ↓
Wave 1 合并与全量验证
  ↓
Wave 2 启动：Task 4 / Task 5 / Task 6 并行
  ↓
先合并 Task 5 + Task 4 并应用数据库 Migration
  ↓
Task 7 首次部署、Telegram Webhook 与真实创建闭环
  ↓
合并 Task 6 并验证完整可见流程
  ↓
Task 8 Cron、最终部署与最终验收
```

Task 0、两次合并验证、Task 7 和 Task 8 必须由主窗口串行执行。Task 7 只等待 Task 4 和 Task 5，不等待 Task 6 的页面精修；Task 6 可以继续并行，但合并后必须再跑一次完整 UI Smoke Test。

### Wave 1：可以并行

Task 0 合并后，从同一个提交创建三个独立 git worktree：

| 窗口 | Task | 分支 | 文件所有权 |
|---|---|---|---|
| A | Task 1 数据库与 Auth | `feat/data-auth` | `supabase/`、`src/lib/supabase/`、`src/lib/auth/`、`src/lib/validation/auth*`、`src/proxy.ts` |
| B | Task 2 UI 基础与双语页面 | `feat/ui-shell` | `src/components/ui/`、`src/components/layout/`、`src/lib/i18n/`、公开页面组件 |
| C | Task 3 第三方适配器 | `feat/integrations` | `src/lib/ai/`、`src/lib/sources/`、`src/lib/telegram/client.ts` |

三个窗口不得修改 `package.json`、`pnpm-lock.yaml`、`src/types/contracts.ts` 或对方拥有的目录。缺少依赖时停止并通知主窗口，由主窗口统一添加。

### Wave 2：可以并行

Wave 1 全部合并且 `pnpm test && pnpm lint && pnpm build` 通过后，再创建三个 worktree：

| 窗口 | Task | 分支 | 文件所有权 |
|---|---|---|---|
| D | Task 4 安全规则创建流程 | `feat/rule-flow` | rules/pending setup API、规则 Token、Rules 与 Auth 流程整合 |
| E | Task 5 监控引擎 | `feat/monitoring` | monitoring Migration、`src/lib/monitoring/`、Finding/Notification 服务、全部 Radar API |
| F | Task 6 后台页面 | `feat/workspace` | Dashboard、My Radars、Radar 详情和对应组件 |

Task 4 不创建 Radar；它只保存 pending setup。Task 5 提供 `createRadarFromSetup()` 与 `runRadar()`。Task 7 才把 Telegram 绑定、pending setup 与 Radar 创建完整串起来。

Task 6 在并行期间依据第 1 节冻结 API 编写组件测试，可以 mock API；它不能把 mock 当作验收结果。Task 5 合并并应用 Migration 后，Task 6 才能进行真实数据库和暂停/恢复/编辑操作验收。

### 12 小时硬时间盒

| 时间 | 退出条件 |
|---|---|
| 0–1 小时 | Task 0 完成，外部账号和依赖预检全部通过 |
| 1–3 小时 | Wave 1 三个任务完成并合并 |
| 3–3.5 小时 | 全量 test/lint/build 通过，创建 Wave 2 worktree |
| 3.5–6.5 小时 | Task 4、Task 5 完成；Task 6 同时继续 |
| 6.5–8 小时 | Task 7 完成首次部署、Webhook、真实绑定、首个 Radar 与通知证明 |
| 8–9 小时 | 合并 Task 6，创建并运行第二个 Radar，验证可见流程 |
| 9–11 小时 | Task 8 Cron、README、最终部署与无登录浏览器验收 |
| 11–12 小时 | 只修 P0、录制演示和推送 GitHub，不新增功能 |

Wave 2 worktree 命令：

```bash
git worktree add ../watch-anything-rule-flow -b feat/rule-flow
git worktree add ../watch-anything-monitoring -b feat/monitoring
git worktree add ../watch-anything-workspace -b feat/workspace
```

### Wave 1 worktree 命令

主窗口在 Wave 1 开始时执行，目录不得互相嵌套：

```bash
git worktree add ../watch-anything-data-auth -b feat/data-auth
git worktree add ../watch-anything-ui-shell -b feat/ui-shell
git worktree add ../watch-anything-integrations -b feat/integrations
```

每个并行窗口只提交自己的分支，不自行 merge 或 push 到主分支。主窗口逐个 review、merge，然后运行全量验证。

---

### Task 0：外部预检、项目骨架和共享契约（0–1 小时，串行）

**Files:**

- Create: `package.json`
- Create: `pnpm-lock.yaml`
- Create: `next.config.ts`
- Create: `tsconfig.json`
- Create: `eslint.config.mjs`
- Create: `postcss.config.mjs`
- Create: `components.json`
- Create: `.env.example`
- Create: `public/`
- Create: `src/app/layout.tsx`
- Create: `src/app/page.tsx`
- Create: `src/types/contracts.ts`
- Create: `src/lib/env.ts`
- Create: `src/lib/env.test.ts`
- Create: `vitest.config.ts`

**Produces:** 所有后续窗口使用的唯一项目骨架、依赖、测试命令和公共类型。

- [ ] **Step 1: 确认运行环境并启用 pnpm**

```bash
node --version
corepack enable
pnpm --version
```

Expected：Node ≥ 20.9；pnpm 可运行。

- [ ] **Step 2: 在临时目录生成 Next.js，再复制到仓库根目录**

```bash
scaffold_dir=$(mktemp -d)
pnpm dlx create-next-app@latest "$scaffold_dir/watch-anything" \
  --ts --tailwind --eslint --app --src-dir \
  --import-alias "@/*" --use-pnpm --yes
rsync -a --exclude='.git' "$scaffold_dir/watch-anything/" ./
task_root=$(pwd -P)
test "$(git rev-parse --show-toplevel)" = "$task_root"
```

Expected：临时项目的 `.git` 不会进入当前仓库；最后一条命令退出码为 0，证明当前 Git 根目录没有被脚手架覆盖。

- [ ] **Step 3: 安装全部依赖，之后并行窗口禁止修改依赖**

```bash
pnpm add @supabase/supabase-js @supabase/ssr groq-sdk zod \
  react-hook-form @hookform/resolvers lucide-react rss-parser server-only
pnpm add -D vitest jsdom @testing-library/react @testing-library/jest-dom tsx
pnpm dlx shadcn@latest init -d
pnpm dlx shadcn@latest add button input card badge tabs alert skeleton sheet form dropdown-menu
pnpm pkg set scripts.test="vitest run"
pnpm pkg set scripts.test:watch="vitest"
pnpm pkg set scripts.smoke:telegram="tsx scripts/smoke-telegram-notification.ts"
```

- [ ] **Step 4: 创建环境变量 Schema 的失败测试**

```ts
import { describe, expect, it } from "vitest";
import { parseServerEnv } from "@/lib/env";

describe("parseServerEnv", () => {
  it("reports a missing server secret by name", () => {
    expect(() => parseServerEnv({})).toThrow("SUPABASE_SERVICE_ROLE_KEY");
  });
});
```

Run：`pnpm vitest run src/lib/env.test.ts`
Expected：FAIL，因为 `parseServerEnv` 尚不存在。

- [ ] **Step 5: 实现环境变量 Schema 和公共类型**

`.env.example` 必须包含技术设计列出的 12 个变量。`src/lib/env.ts` 导出 `parsePublicEnv()` 和 `parseServerEnv()`；服务端变量缺失时抛出包含变量名的错误。`src/types/contracts.ts` 使用本计划第 1 节的准确名称和字段。

- [ ] **Step 6: 做真实外部服务预检**

逐一验证 Supabase、Tavily Basic Search、Groq `openai/gpt-oss-20b` 严格 JSON Schema、Telegram `getMe`、固定 RSS 和 Vercel 登录状态。运行 `pnpm dlx vercel@latest whoami` 必须返回当前账号。任一失败必须在第一小时解决，不把风险留到业务实现阶段。

- [ ] **Step 7: 验证并提交**

```bash
pnpm test
pnpm lint
pnpm build
git diff --check
git add package.json pnpm-lock.yaml next.config.ts tsconfig.json \
  eslint.config.mjs postcss.config.mjs components.json \
  .env.example public src vitest.config.ts
git commit -m "chore: scaffold Watch Anything app"
```

Expected：全部命令退出码 0。

---

### Task 1：数据库、RLS 与 Supabase Auth（Wave 1，可并行）

**Files:**

- Create: `supabase/migrations/202608060001_initial_schema.sql`
- Create: `src/lib/supabase/client.ts`
- Create: `src/lib/supabase/server.ts`
- Create: `src/lib/supabase/admin.ts`
- Create: `src/lib/validation/auth.ts`
- Create: `src/lib/validation/auth.test.ts`
- Create: `src/lib/auth/service.ts`
- Create: `src/proxy.ts`

**Consumes:** `src/types/contracts.ts`、Task 0 的环境变量解析器。
**Produces:** Cookie Session、核心表、RLS、受保护路由、`authSchema` 和 Auth 服务函数。

- [ ] **Step 1: 写 Auth Schema 失败测试**

```ts
expect(authSchema.safeParse({
  email: "chawei@example.com",
  password: "12345678",
  next: "dashboard",
}).success).toBe(true);

expect(authSchema.safeParse({
  email: "bad-email",
  password: "123",
  next: "https://evil.example",
}).success).toBe(false);
```

Run：`pnpm vitest run src/lib/validation/auth.test.ts`
Expected：FAIL，因为 `authSchema` 尚不存在。

- [ ] **Step 2: 建立完整数据库 Migration**

创建 `profiles`、`guest_ai_requests`、`pending_radar_setups`、`telegram_connections`、`telegram_binding_tokens`、`radars`、`radar_runs`、`findings`、`notifications`。字段、状态约束和唯一约束严格使用技术设计第 6 节；`radars` 与 `radar_runs` 都包含 `lease_owner` 和 `lease_expires_at`。同时创建固定 `search_path` 的 `handle_new_user()` 与 `after insert on auth.users` Trigger，为每个新 Auth 用户幂等插入 `profiles(id, locale)`；注册测试必须断言 profile 已存在，否则后续原子锁没有可锁定的用户行。

- [ ] **Step 3: 启用 RLS**

不能把同一条 `user_id = auth.uid()` 策略复制到所有表。逐表建立以下策略：

```sql
-- profiles 使用主键归属；浏览器只获得 locale 列的 UPDATE 权限
using (id = auth.uid())
with check (id = auth.uid())

-- pending_radar_setups、telegram_connections、radars、notifications
using (user_id = auth.uid())

-- radar_runs、findings 通过父 Radar 判断归属
using (
  exists (
    select 1 from public.radars r
    where r.id = radar_id and r.user_id = auth.uid()
  )
)
```

`guest_ai_requests` 与 `telegram_binding_tokens` 启用 RLS 但不创建浏览器策略；pending setup、Telegram connection、Radar、Run、Finding、Notification 的新增和修改只由服务端 service role 完成。对 `profiles` 撤销整行 UPDATE，只授予 `locale` 列 UPDATE。每个 API 仍要检查所有权，不能只依赖 RLS。

- [ ] **Step 3.1: 将 Migration 应用到演示 Supabase 项目**

```bash
pnpm dlx supabase@latest login
pnpm dlx supabase@latest link --project-ref "$SUPABASE_PROJECT_REF"
pnpm dlx supabase@latest db push
```

Expected：migration 成功；Supabase Table Editor 能看到 9 张业务表且 RLS 为 enabled。

- [ ] **Step 4: 实现三个 Supabase 客户端和 Session 刷新**

Browser Client 用 publishable key；Server Client 读写 Cookie；Admin Client 导入 `server-only` 并使用 service role。`src/proxy.ts` 负责刷新 Session 和保护 `/dashboard`、`/radars`、`/connect-telegram`。

- [ ] **Step 5: 实现 Auth 服务函数**

`src/lib/auth/service.ts` 导出 `signInWithPassword()`、`signUpWithPassword()` 和 `resolveSafeNext()`。`next` 只允许 `dashboard`、`connect-telegram`；未知值和站外地址统一映射到 `/dashboard`。演示环境关闭 Confirm Email。该 Task 不创建或修改 Auth 页面，避免与 Task 2 冲突。

- [ ] **Step 6: 验证两个用户和子表的数据隔离**

使用 A、B 两个真实 Session 创建各自 Radar、Run、Finding 和 Notification。A 查询 B 的 Radar、Run、Finding、Notification 必须返回零行；A 修改 B 的 Radar 必须失败；A 只能修改自己的 `profiles.locale`，不能修改 profile id。测试失败时不得用 service role 代替用户 Session，因为 service role 会绕过 RLS。

- [ ] **Step 7: 验证并提交**

```bash
pnpm vitest run src/lib/validation/auth.test.ts
pnpm lint
pnpm build
git add supabase src/lib/supabase src/lib/validation src/lib/auth src/proxy.ts
git commit -m "feat: add Supabase auth and data model"
```

---

### Task 2：UI 基础、双语与公开流程页面（Wave 1，可并行）

**Files:**

- Create: `src/lib/i18n/messages/en.ts`
- Create: `src/lib/i18n/messages/zh-CN.ts`
- Create: `src/lib/i18n/index.ts`
- Create: `src/components/layout/site-header.tsx`
- Create: `src/components/layout/app-sidebar.tsx`
- Create: `src/components/landing/hero.tsx`
- Create: `src/components/radar/rules-form.tsx`
- Create: `src/components/auth/auth-form.tsx`
- Create: `src/components/telegram/connect-card.tsx`
- Modify: `src/app/page.tsx`
- Create: `src/app/rules/page.tsx`
- Create: `src/app/auth/page.tsx`
- Create: `src/app/connect-telegram/page.tsx`

**Consumes:** Task 0 的类型；只创建 UI callback props，不调用数据库或第三方服务。
**Produces:** 与 canonical 原型一致的页面壳和静态词典。

- [ ] **Step 1: 写 Rules Form 交互测试**

```tsx
render(<RulesForm initialRules={rules} onSubmit={onSubmit} />);
await user.click(screen.getByRole("button", { name: /添加关注项/i }));
await user.type(screen.getByLabelText(/新的关注项/i), "Official interviews");
await user.click(screen.getByRole("button", { name: /确认规则/i }));
expect(onSubmit).toHaveBeenCalledWith(
  expect.objectContaining({ includeTopics: expect.arrayContaining(["Official interviews"]) }),
);
```

- [ ] **Step 2: 建立人工编写的中英文词典**

导出 `Locale = "en" | "zh-CN"`、`messages` 和 `getMessages(locale)`；禁止 DOM 遍历替换文本，禁止翻译 LISA、OpenAI、Telegram、Radar。

- [ ] **Step 3: 实现 Landing、Rules、Auth、Telegram 页面壳**

只实现真实表单状态和 callback props：`onParseRequest`、`onConfirmRules`、`onAuthenticate`、`onConnectTelegram`。不在 UI 分支伪造 API、localStorage 业务对象或假数据库结果。

- [ ] **Step 4: 实现响应式导航**

850px 以下单栏；390 × 844 无横向滚动；App 页面移动导航固定保留 Dashboard、Radars、Telegram。

- [ ] **Step 5: 验证并提交**

```bash
pnpm vitest run src/components
pnpm lint
pnpm build
git add src/app src/components src/lib/i18n
git commit -m "feat: add bilingual product UI shell"
```

---

### Task 3：Groq、Tavily、RSS 与 Telegram Client（Wave 1，可并行）

**Files:**

- Create: `src/lib/ai/parse-rules.ts`
- Create: `src/lib/ai/evaluate-candidates.ts`
- Create: `src/lib/ai/schemas.ts`
- Create: `src/lib/sources/tavily.ts`
- Create: `src/lib/sources/music-news-rss.ts`
- Create: `src/lib/sources/normalize.ts`
- Create: `src/lib/sources/normalize.test.ts`
- Create: `src/lib/telegram/client.ts`

**Consumes:** Task 0 的 `RadarRules`、`Candidate`。
**Produces:** `parseRules()`、`evaluateCandidates()`、`searchTavily()`、`fetchMusicNewsRss()`、`sendTelegramMessage()`。

- [ ] **Step 1: 写 Candidate 标准化测试**

```ts
expect(normalizeUrl("https://example.com/news?utm_source=x&id=1"))
  .toBe("https://example.com/news?id=1");
expect(normalizeCandidate(tavilyFixture).sourceType).toBe("tavily");
expect(normalizeCandidate(rssFixture).sourceType).toBe("rss");
```

- [ ] **Step 2: 实现 Groq 严格输出**

模型固定从 `GROQ_MODEL` 读取，默认 `openai/gpt-oss-20b`；JSON Schema 所有字段 required、所有对象 `additionalProperties: false`；返回后再用 Zod 校验，只允许一次修复重试。

- [ ] **Step 3: 实现来源适配器**

Tavily 每次 Basic Search 最多 5 条、8 秒超时；RSS 只请求技术设计指定的 Music-News.com 固定地址，不接受参数 URL；每条 excerpt 最多约 800 字符。

- [ ] **Step 4: 实现 Telegram Client**

只封装 `getMe()`、`setWebhook()`、`getWebhookInfo()`、`sendMessage()`；超时使用可识别错误 `TELEGRAM_RESULT_UNKNOWN`，不得在 Client 内自动重试消息。

- [ ] **Step 5: 验证并提交**

```bash
pnpm vitest run src/lib/sources src/lib/ai
pnpm lint
pnpm build
git add src/lib/ai src/lib/sources src/lib/telegram/client.ts
git commit -m "feat: add monitoring service adapters"
```

---

### Wave 1 合并检查（串行）

- [ ] 主窗口依次 review 并 merge `feat/data-auth`、`feat/integrations`、`feat/ui-shell`。
- [ ] 执行合并：

```bash
git merge --no-ff feat/data-auth
git merge --no-ff feat/integrations
git merge --no-ff feat/ui-shell
```

- [ ] 只在主窗口解决依赖和 lockfile 变化。
- [ ] 执行：

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm lint
pnpm build
git diff --check
```

Expected：全部退出码 0 后才能开始 Wave 2。

---

### Task 4：安全规则创建与 pending setup（Wave 2，可并行）

**Files:**

- Create: `src/lib/validation/radar-rules.ts`
- Create: `src/lib/security/rule-token.ts`
- Create: `src/lib/security/rule-token.test.ts`
- Create: `src/app/api/rules/parse/route.ts`
- Create: `src/app/api/pending-setups/route.ts`
- Create: `src/app/api/pending-setups/current/route.ts`
- Create: `src/app/auth/actions.ts`
- Create: `src/app/auth/actions.test.ts`
- Modify: `src/app/page.tsx`
- Modify: `src/app/rules/page.tsx`
- Modify: `src/app/auth/page.tsx`
- Modify: `src/components/auth/auth-form.tsx`

**Consumes:** Task 1 Auth/数据库、Task 2 页面、Task 3 `parseRules()`。
**Produces:** 签名 `ruleToken`、匿名限流、登录前恢复和 pending setup；不创建 Radar。

- [ ] **Step 1: 写 Token 安全测试**

```ts
const token = signRuleToken(validRules, now);
expect(verifyRuleToken(token, now + 60_000)).toMatchObject(validRules);
expect(() => verifyRuleToken(`${token}x`, now)).toThrow("INVALID_RULE_TOKEN");
expect(() => verifyRuleToken(token, now + 7_200_001)).toThrow("EXPIRED_RULE_TOKEN");
```

- [ ] **Step 2: 实现规则 Zod Schema**

名称 2–80 字符；关注项 1–8 条；忽略项 0–8 条；每项 1–60 字符；阈值 0–100；频率固定 360。

- [ ] **Step 3: 实现 `/api/rules/parse`**

匿名 Cookie/IP 哈希限流：单个匿名身份每天 3 次、全站每天 20 次。返回结构化规则和 2 小时 HMAC Token。

- [ ] **Step 4: 实现浏览器恢复**

只保存 `originalPrompt`、`ruleToken` 和 `EditableRuleDelta`；不保存密码、Session 或服务密钥。用户界面只说“规则不会丢失”，不展示“草稿”。

- [ ] **Step 5: 接通真实登录、注册和安全跳转**

`src/app/auth/actions.ts` 提供 `authenticateAction()`，用 Task 1 的 Server Client 调用登录或注册并写回官方 Supabase SSR Cookie。返回值只允许 `{ ok: true, next: "/dashboard" | "/connect-telegram" }` 或稳定表单错误；不得接收完整 URL。右上角 Login 没有规则恢复数据时进入 Dashboard；从 Rules 进入 Auth 时，客户端在 Auth 成功后立即提交本机保存的 `ruleToken + editableDelta` 到 pending setup API，再依据 API 返回值进入 Telegram 或已创建 Radar。密码、JWT 和 service role 不得写入 localStorage。

增加测试：刷新 Auth 页面后规则恢复数据仍存在；登录失败不清除规则；签名 Token 过期时提示重新整理；`next=https://evil.example` 最终只能进入 `/dashboard`。

- [ ] **Step 6: 实现 pending setup**

登录后服务端验证 Token、过期时间和 editable delta，写入 24 小时 setup，并设置 HttpOnly、Secure、SameSite=Lax 的 `wa_setup` Cookie。该 Task 总是返回 `connect-telegram` 或已存在 setup 状态，不调用尚未整合的 Radar 创建服务。

- [ ] **Step 7: 验证并提交**

```bash
pnpm vitest run src/lib/security src/lib/validation
pnpm lint
pnpm build
git add src
git commit -m "feat: add secure radar rule flow"
```

---

### Task 5：监控引擎、去重与通知状态（Wave 2，可并行）

**Files:**

- Create: `supabase/migrations/202608060002_monitoring_functions.sql`
- Create: `src/lib/monitoring/fingerprint.ts`
- Create: `src/lib/monitoring/run-status.ts`
- Create: `src/lib/monitoring/run-radar.ts`
- Create: `src/lib/monitoring/create-radar.ts`
- Create: `src/lib/monitoring/notifications.ts`
- Create: `src/lib/monitoring/run-radar.test.ts`
- Create: `src/lib/monitoring/monitoring-rpc.integration.test.ts`
- Create: `src/lib/validation/radar-update.ts`
- Create: `src/lib/validation/radar-update.test.ts`
- Create: `src/app/api/radars/route.ts`
- Create: `src/app/api/radars/[id]/route.ts`
- Create: `src/app/api/radars/[id]/run/route.ts`

**Consumes:** Task 1 数据库、Task 3 适配器。
**Produces:** `createRadarFromSetup(setupId, userId)`、`runRadar(radarId, trigger)`、`executeClaimedRun(runId, leaseOwner)`、`createPendingNotification(findingId, destinationId)`、`sendPendingNotification(notificationId)` 和可靠 Notification 状态机。

- [ ] **Step 1: 写 Run 状态测试**

```ts
expect(resolveRunStatus([success, failure])).toBe("success");
expect(resolveRunStatus([failure, failure])).toBe("failed");
expect(resolveRunStatus([success], { aiFailed: true })).toBe("success");
expect(resolveRunStatus([success], { telegramFailed: true })).toBe("success");
```

- [ ] **Step 2: 写 fingerprint 测试**

带 `utm_*` 和不带追踪参数的同一 URL 必须得到相同 fingerprint；没有稳定 URL 时使用规范化标题与来源域名。

- [ ] **Step 3: 实现数据库原子函数**

`202608060002_monitoring_functions.sql` 至少创建以下只能由 service role 调用的函数：

- `create_radar_from_setup(setup_id, user_id)`：锁定该用户的 profile 行，校验 setup 为 pending 且未过期、Telegram 已连接、active Radar 少于 3 个；同一事务内插入 Radar 并把 setup 改为 consumed。
- `set_radar_status(radar_id, user_id, next_status)`：暂停直接更新；恢复时锁定用户并重新检查 active 数量，达到上限返回 `ACTIVE_RADAR_LIMIT_REACHED`。
- `claim_radar_run(radar_id, user_id, trigger, lease_owner, lease_expires_at)`：校验所有权、状态、冷却和有效 lease，在同一事务内写入 Radar lease 与 running Run。
- `claim_notification(notification_id)`：只有 `status=pending` 的一行能原子更新为 sending 并返回；其他调用返回空。

函数使用固定 `search_path`、参数化 SQL 和明确授权；不得接受调用方传入任意表名。`monitoring-rpc.integration.test.ts` 对演示 Supabase 的测试用户执行并发验证：4 个同时创建请求最多 3 个成功；两个同时 Run 只有一个领取成功；两个相同 Notification 领取只有一个成功。测试结束只删除该测试用户命名空间内的数据。

- [ ] **Step 4: 实现创建事务的服务层**

`createRadarFromSetup()` 调用上述数据库函数；成功后由 Route Handler 清除 `wa_setup` Cookie，并在当前请求内 `await runRadar(..., "baseline")`。不得使用 Vercel 请求结束后可能被中止的 fire-and-forget；Tavily/RSS 各自约 8 秒超时并行执行，整个 Route 最大执行时间设为 60 秒。

- [ ] **Step 5: 实现 Run 管线**

`runRadar(radarId, trigger)` 只负责调用 `claim_radar_run()` 并取得 `{ runId, leaseOwner }`，随后调用 `executeClaimedRun(runId, leaseOwner)`。`executeClaimedRun()` 首先条件校验该 Run 仍为 running 且 lease owner 匹配，然后并行获取 Tavily/RSS、逐来源持久化 outcome；至少一个来源成功即 success，两个来源都失败才 failed，最多 8 条候选进入 AI。baseline、manual 和 schedule 都必须复用这个执行器，任何调用方都不能在执行器内再次创建 Run。

- [ ] **Step 6: 实现首次基线与去重**

每个来源第一次成功只保存不通知；fingerprint 为必需底线；合法 event_key 用于同事件去重，缺失时回退 fingerprint。

- [ ] **Step 7: 实现 at-most-once Notification**

`createPendingNotification(findingId, destinationId)` 使用数据库唯一约束创建或返回唯一 pending；`sendPendingNotification(notificationId)` 通过 `claim_notification()` 条件更新 `pending → sending`，只有领取成功者可以调用 Telegram。明确成功写 sent；明确未发送写 failed；结果不确定写 unknown 且绝不自动重发。

- [ ] **Step 8: 实现 Radar 详情、暂停、恢复和规则编辑 API**

`GET /api/radars/[id]` 只返回当前用户的 Radar、Findings 和 Runs。`PATCH` 用 `radar-update.ts` 限制 action 为 `pause | resume | update_rules`；pause/resume 调用 `set_radar_status()`，恢复第 4 个 active Radar 时返回 409 + `ACTIVE_RADAR_LIMIT_REACHED`；规则编辑只允许名称、关注项和忽略项，不能修改 subject、search query、频率或 user_id。动态 id 在调用 service role 前必须先按 Session user id 校验所有权。

- [ ] **Step 9: 实现手动检查限制**

同一 Radar 30 分钟冷却，每个用户每天最多 3 次；所有动态 id 验证所有权。

- [ ] **Step 10: 应用 Migration、验证并提交**

```bash
pnpm vitest run src/lib/monitoring
pnpm vitest run src/lib/validation/radar-update.test.ts
pnpm lint
pnpm build
git add supabase/migrations/202608060002_monitoring_functions.sql \
  src/lib/monitoring src/lib/validation/radar-update* src/app/api/radars
git commit -m "feat: add radar monitoring engine"
```

---

### Task 6：Dashboard、多 Radar 与详情页面（Wave 2，可并行）

**Files:**

- Create: `src/app/dashboard/page.tsx`
- Create: `src/app/radars/page.tsx`
- Create: `src/app/radars/[id]/page.tsx`
- Create: `src/components/radar/radar-card.tsx`
- Create: `src/components/radar/findings-list.tsx`
- Create: `src/components/radar/run-history.tsx`
- Create: `src/components/radar/radar-actions.tsx`
- Test: `src/components/radar/radar-card.test.tsx`

**Consumes:** Task 1 的 Supabase Server Client、Task 2 的布局和词典、技术设计中的表结构。
**Produces:** 读取真实数据库的 Dashboard、My Radars 和 `/radars/[id]`。

- [ ] **Step 1: 写 Radar 卡片测试**

```tsx
render(<RadarCard radar={openAiRadar} locale="zh-CN" />);
expect(screen.getByText("OpenAI Releases")).toBeInTheDocument();
expect(screen.getByText("已暂停")).toBeInTheDocument();
expect(screen.getByRole("link")).toHaveAttribute("href", `/radars/${openAiRadar.id}`);
```

- [ ] **Step 2: 实现精简 Dashboard**

只显示 Telegram 状态、Needs attention、跨 Radar 最新 3 条 Finding 和进入 `/radars` 的入口；不添加 KPI 大屏或完整 Radar 列表。

- [ ] **Step 3: 实现 My Radars**

显示完整列表、状态、最近检查、下次检查、新发现数量和创建入口；卡片使用 id 跳转，不用名称定位。

- [ ] **Step 4: 实现 Radar 详情**

按动态路由 id 查询规则、Finding 和 Run；验证当前用户所有权；按钮调用约定的 PATCH/POST API，不在页面中模拟状态成功。

- [ ] **Step 5: 验证第二 Radar 与响应式**

fixture 测试使用 LISA 和 OpenAI 两个不同 id；390 × 844 不横向滚动，移动三入口始终可见。语言选择写入 Cookie；用户登录后同时更新 `profiles.locale`。

- [ ] **Step 6: 验证并提交**

```bash
pnpm vitest run src/components/radar
pnpm lint
pnpm build
git add src/app/dashboard src/app/radars src/components/radar
git commit -m "feat: add multi-radar workspace"
```

---

### Wave 2 闭环合并检查（串行，不等待 Task 6）

- [ ] Task 4 和 Task 5 完成后，主窗口先 merge `feat/monitoring`，再 merge `feat/rule-flow`。Task 6 可以继续在原 worktree 开发，不阻塞真实闭环。
- [ ] 执行合并：

```bash
git merge --no-ff feat/monitoring
git merge --no-ff feat/rule-flow
pnpm dlx supabase@latest db push
```

- [ ] 解决接口差异时以第 1 节冻结类型和 API 表为准，不临时发明新字段。
- [ ] 执行：

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm lint
pnpm build
git diff --check
```

---

### Task 7：Telegram 绑定与 Radar 激活整合（8 小时前必须完成，串行）

**Files:**

- Create: `supabase/migrations/202608060003_telegram_binding.sql`
- Create: `src/lib/telegram/binding-token.ts`
- Create: `src/lib/telegram/binding-token.test.ts`
- Create: `src/lib/monitoring/pipeline.integration.test.ts`
- Create: `src/app/api/telegram/binding-token/route.ts`
- Create: `src/app/api/telegram/status/route.ts`
- Create: `src/app/api/telegram/webhook/route.ts`
- Create: `src/app/api/telegram/webhook/route.test.ts`
- Modify: `src/app/connect-telegram/page.tsx`
- Modify: `src/app/api/pending-setups/route.ts`
- Modify: `src/app/api/radars/route.ts`
- Create: `scripts/configure-telegram-webhook.mjs`
- Create: `scripts/smoke-telegram-notification.ts`

**Consumes:** Task 4 pending setup、Task 5 `createRadarFromSetup()`、Task 3 Telegram Client。
**Produces:** 已部署的 Auth、Telegram Webhook、Radar 创建与 baseline 技术闭环；Task 7.1 合并页面后完成最终用户可见闭环。已绑定用户可直接创建第二 Radar。

- [ ] **Step 1: 写绑定 Token、Webhook 和纵向集成测试**

```ts
expect(await consumeBindingToken(rawToken)).toMatchObject({ userId });
await expect(consumeBindingToken(rawToken))
  .rejects.toThrow("TOKEN_ALREADY_USED");
expect((await POST(requestWithoutSecret)).status).toBe(401);
```

`pipeline.integration.test.ts` 使用真实测试数据库事务和可注入的来源/AI/Telegram adapters，覆盖：setup 原子消费并创建 Radar；baseline 保存 Finding 但不调用 Telegram；后续新候选经过 AI 后只创建一条 Notification；两个并发发送者只有一个能把 pending 领取为 sending；第二个 Radar 拥有独立 Run 和 Finding。外部 adapters 在该自动测试中使用确定性 fixture，真实网络在 Step 8 的部署 Smoke Test 单独验证。

- [ ] **Step 2: 实现一次性 Token 的数据库原子消费**

生成 32 字节随机值，数据库只保存 SHA-256 哈希，10 分钟过期。`202608060003_telegram_binding.sql` 创建只能由 service role 调用的 `consume_telegram_binding_token(token_hash, chat_id, username)`：条件匹配未使用且未过期的 Token、锁定该行、写入 `used_at`，并在同一事务内 upsert 唯一 `telegram_connections`；如果 chat_id 已属于另一个网站用户则返回稳定冲突错误，绝不能转移绑定；重复调用返回空，不能先 SELECT 再 UPDATE。实现后执行 `pnpm dlx supabase@latest db push`。

- [ ] **Step 3: 实现 Webhook**

先验证 `X-Telegram-Bot-Api-Secret-Token`，失败立即 401 且不读写业务数据；只接受 private chat 的 `/start <token>` 与 `/help`。

- [ ] **Step 4: 实现连接页真实状态**

打开 Bot 后每 2 秒轮询，最多 60 秒；连接成功后调用 `POST /api/radars` 消费当前 setup、创建 Radar 并进入 `/radars/[id]`。

- [ ] **Step 5: 实现已绑定用户快捷分支**

Rules/Auth 恢复 pending setup 后，如果已有 `telegram_connections`，直接调用相同 `createRadarFromSetup()`；不得要求重复绑定。第二 Radar 必须同样同步等待 baseline 完成后才进入详情，不能只插入一张 Radar 卡片。

- [ ] **Step 6: 配置 Vercel 生产环境并首次部署**

先用 `vercel link` 创建/连接项目，采用 Vercel 分配的稳定 `https://<project>.vercel.app` 域名作为 `NEXT_PUBLIC_APP_URL`；再在 Vercel 项目中配置 `.env.example` 列出的全部 12 个生产变量并部署。不得把变量值写进命令历史、README 或构建日志。

```bash
pnpm dlx vercel@latest link
pnpm dlx vercel@latest env ls
pnpm test
pnpm lint
pnpm build
pnpm dlx vercel@latest --prod
```

Expected：得到公开 `https://*.vercel.app` 地址；从无登录浏览器访问 Landing 成功，`/api/telegram/webhook` 已存在且缺少 secret header 时返回 401，而不是 404 或 500。

- [ ] **Step 7: 注册并核验真实 Telegram Webhook**

`scripts/configure-telegram-webhook.mjs` 接收部署 URL，调用 `setWebhook`，设置 `secret_token`、`allowed_updates=["message"]` 和首次演示的 `drop_pending_updates=true`，随后调用 `getWebhookInfo` 校验 URL 且无 `last_error_message`。脚本只能输出 URL 和成功/失败状态，不能输出 Bot Token 或 Webhook Secret。

```bash
node scripts/configure-telegram-webhook.mjs https://YOUR-PROJECT.vercel.app
```

- [ ] **Step 8: 运行部署态技术闭环 Smoke Test**

1. 未登录输入 LISA 需求。
2. Groq 返回规则。
3. 登录/注册后规则仍在。
4. 真实 Telegram `/start` 完成绑定。
5. 创建 LISA Radar。
6. Tavily/RSS 至少一个真实来源成功，Groq 完成判断，baseline 保存真实 Run/Finding 且不通知旧闻。
7. 手动 Run 再次调用真实来源并保存 Run；如果没有自然出现的新事件，不伪装成“已发现新事件”。
8. 对已绑定的真实 Radar 执行下方脚本。脚本用 Admin Client 插入标题带 `[SMOKE TEST]`、URL/dedupe key 使用随机 UUID 的唯一 Finding，然后调用与生产管线相同的 `createPendingNotification()` 和 `sendPendingNotification()`；它再次处理相同 dedupe key，最后查询并断言数据库只有一条 sent/unknown Notification。脚本不是 HTTP Route，不会部署成公开测试入口，且 `--radar-id` 必须经过 UUID Zod 校验。

```bash
pnpm smoke:telegram -- --radar-id YOUR_REAL_RADAR_UUID
```

Expected：真实 Telegram 只收到一条明确标记为 Smoke Test 的消息；数据库只有一个相同 dedupe key 的 Notification。Telegram 请求结果为 unknown 时脚本必须报告“状态未确认”并停止，不能自动重发。
9. 通过真实 API 创建第二 Radar，不重复绑定 Telegram；第二 Radar 必须完成自己的 baseline，两者的 Run/Finding 不串数据。

第 6–7 项证明真实 Tavily/RSS/Groq 管线；第 8 项证明真实 Notification/Telegram 管线。MVP 不要求等待互联网上自然出现一条全新的消息，但演示时必须如实说明这两个验证证据。

- [ ] **Step 9: 验证并提交**

```bash
pnpm test
pnpm lint
pnpm build
git add supabase/migrations/202608060003_telegram_binding.sql \
  src scripts/configure-telegram-webhook.mjs scripts/smoke-telegram-notification.ts
git commit -m "feat: complete Telegram radar activation"
```

**第 8 小时硬闸门：** 真实部署地址仍未完成上述闭环时，停止 Cron、动画、非核心错误翻译和语义 event_key，只修闭环。

---

### Task 7.1：合并后台页面并验证可见流程（串行）

Task 7 闭环通过且 `feat/workspace` 完成后，主窗口合并 Task 6。若 Task 6 基于旧接口实现，以第 1 节 API 和 Task 5 Route Handler 为准修正调用方，不能改回 mock 成功。

```bash
git merge --no-ff feat/workspace
pnpm test
pnpm lint
pnpm build
git diff --check
pnpm dlx vercel@latest --prod
```

重新部署合并后的版本，然后从 Landing 开始执行一次用户可见 Smoke Test：Rules → Auth → Telegram → `/radars/[id]` 不得出现 404 或中断。人工验证 Dashboard、My Radars、两个 Radar 详情均读取真实数据库；暂停、恢复、编辑规则和立即检查均请求真实 API。完成后才进入 Task 8。

---

### Task 8：Cron、故障恢复、部署与最终验收（串行）

**Files:**

- Create: `src/lib/monitoring/recover-stale-run.ts`
- Create: `src/lib/monitoring/recover-stale-run.test.ts`
- Create: `src/app/api/cron/run-due/route.ts`
- Create: `supabase/migrations/202608060004_cron.sql`
- Create: `README.md`

**Consumes:** 所有前置任务。
**Produces:** 自动调度、过期 Run 恢复、Vercel 部署和 GitHub 交付物。

- [ ] **Step 1: 写 stale Run 恢复测试**

```ts
const staleRun = runFixture({
  status: "running",
  sourceSuccessCount: 1,
  leaseExpired: true,
});

expect(await recoverStaleRun(staleRun)).toMatchObject({ status: "success" });
expect(searchSource).not.toHaveBeenCalled();
expect(sendTelegramMessage).not.toHaveBeenCalled();
```

- [ ] **Step 2: 实现恢复 CAS**

Cron 先扫描一个过期 running Run，按 `id + status=running + lease_owner` 条件更新；有成功来源恢复 success；来源全失败恢复 failed；清除 Radar/Run lease；绝不再次调用搜索、AI 或 Telegram。

- [ ] **Step 3: 实现到期领取**

在 `202608060004_cron.sql` 中创建仅限 service role 的 `recover_stale_run()` 和 `claim_due_radar()`。恢复完成后，`claim_due_radar()` 用 PostgreSQL `FOR UPDATE SKIP LOCKED` 领取最多一个到期 active Radar，在同一事务内设置 Radar lease，并创建带相同随机 lease owner 的 Run，返回 `{ radarId, runId, leaseOwner }`。Route 提交事务后直接调用 Task 5 的 `executeClaimedRun(runId, leaseOwner)`；绝不能再调用 `runRadar()` 或 `claim_radar_run()`，否则会重复创建 Run。并发集成测试同时请求两次 Cron，断言同一个到期 Radar 只产生一个 Run，且执行器只调用一次。

- [ ] **Step 4: 配置 Supabase Cron**

`POST /api/cron/run-due` 必须先用常量时间比较验证 `Authorization: Bearer <CRON_SECRET>`；缺失或错误时立即返回 401 且不读取或修改业务数据。验证通过后才调用恢复与领取函数，Route 最大执行时间为 60 秒。每 15 分钟通过 pg_cron + pg_net 请求该接口；Vercel URL 与 `CRON_SECRET` 放入 Supabase Vault，SQL 文件中只引用 Vault secret，不包含真实值。增加测试断言错误 Secret 不会调用恢复、领取或外部来源。

- [ ] **Step 5: 应用 Cron Migration 并最终自动验证**

```bash
pnpm dlx supabase@latest db push
pnpm test
pnpm lint
pnpm build
git diff --check
```

Expected：全部退出码 0。

- [ ] **Step 6: 最终部署并重新核验 Webhook**

```bash
pnpm dlx vercel@latest --prod
node scripts/configure-telegram-webhook.mjs https://YOUR-PROJECT.vercel.app
```

Expected：返回可公开访问的 `https://*.vercel.app` 地址；`getWebhookInfo` 仍指向最终 URL 且无 `last_error_message`。

- [ ] **Step 7: 最终人工验收**

1. Landing → Rules → Auth → Telegram → Radar 详情完整可用。
2. 首次基线不发送旧闻。
3. 至少一条真实 Telegram 通知。
4. 创建第二 Radar 不重复绑定且数据不串。
5. Dashboard、My Radars、详情读取真实数据库。
6. 暂停、恢复、立即检查、编辑规则工作。
7. Run 只出现运行中、成功、失败。
8. 中文与英文核心流程可切换。
9. 390 × 844 无横向滚动。
10. Vercel URL 可从无登录浏览器打开。

- [ ] **Step 8: README 与推送**

README 包含产品说明、架构图、环境变量名称、本地启动、数据库迁移、Webhook 配置、演示步骤、已知 MVP 限制和 Vercel 地址。

```bash
git add .
git commit -m "feat: deploy Watch Anything MVP"
git push -u origin HEAD
```

---

## 3. 任务依赖摘要

| Task | 可否并行 | 必须等待 | 原因 |
|---|---|---|---|
| Task 0 骨架/契约 | 否 | 无 | 所有任务共享依赖、配置和类型 |
| Task 1 数据/Auth | 是，Wave 1 | Task 0 | 独占数据库/Auth 文件 |
| Task 2 UI/双语 | 是，Wave 1 | Task 0 | 只做页面和组件，不接后端 |
| Task 3 第三方适配器 | 是，Wave 1 | Task 0 | 只做独立服务模块 |
| Wave 1 合并 | 否 | Tasks 1–3 | 必须统一依赖并跑全量测试 |
| Task 4 规则创建 | 是，Wave 2 | Wave 1 | 依赖 Auth、UI 与 Groq |
| Task 5 监控引擎/Radar API | 是，Wave 2 | Wave 1 | 依赖数据库与来源适配器，独占 monitoring Migration |
| Task 6 后台页面 | 是，Wave 2 | Wave 1 | 按冻结 API 开发；真实数据验收等待 Task 5 |
| 闭环合并 | 否 | Tasks 4–5 | 先应用 monitoring Migration，不等待 Task 6 |
| Task 7 Telegram 激活/首次部署 | 否 | Tasks 4–5 | 同时连接 Auth、setup、Webhook 和 Radar 创建 |
| Task 7.1 后台合并 | 否 | Tasks 6–7 | 把已验证的闭环接到完整可见页面 |
| Task 8 Cron/最终部署 | 否 | Task 7.1 | 需要完整真实闭环和后台操作 |

## 4. 审核检查表

### 需求覆盖矩阵

| 需求 | 实施任务 |
|---|---|
| FR-01 Landing 输入与 AI 整理状态 | Tasks 2、4 |
| FR-02 规则展示、增删和确认 | Tasks 2、4 |
| FR-03 登录、注册、规则恢复和安全跳转 | Tasks 1、2、4 |
| FR-04 Telegram 账号级连接 | Task 7 |
| FR-05 创建多个 Radar 与 active 上限 | Tasks 5、7 |
| FR-06 Tavily、RSS、AI、去重和 Run 状态 | Tasks 3、5 |
| FR-07 精简 Dashboard | Task 6 |
| FR-08 My Radars、详情、操作和 Run history | Tasks 5、6 |
| FR-09 Telegram at-most-once 通知 | Tasks 5、7 |
| FR-10 中英文和移动端 | Tasks 2、6 |

### 每轮自检

计划执行前和每次 Wave 合并后检查：

- [ ] 需求文档 FR-01 至 FR-10 均能映射到至少一个 Task。
- [ ] 没有任务实现支付、团队、任意 URL、复杂队列、第三个演示 Radar 或 KPI 大屏。
- [ ] 所有后续接口名称与第 1 节公共接口一致。
- [ ] 并行窗口没有修改同一个文件或 lockfile。
- [ ] 每个实现任务都先写失败测试，再实现，再运行局部测试。
- [ ] 每次 Wave 合并后运行完整 test、lint、build、diff check。
- [ ] 第 8 小时仍未跑通真实闭环时，立即执行止损规则。

## 5. 执行方式

推荐使用多窗口 + git worktree，但只在 Wave 1 和 Wave 2 并行。每个窗口使用一个聚焦任务和独立分支，完成后交回主窗口审核；主窗口是唯一允许 merge、修改依赖、更新 lockfile 和执行最终部署的窗口。
