# Watch Anything MVP 技术设计

- **版本：** v1.0
- **状态：** 已确认，待实施计划
- **需求基线：** [Watch Anything MVP 需求文档](./2026-08-05-watch-anything-mvp-requirements.md)
- **时间约束：** 剩余约 12 个有效工作小时
- **预算约束：** 额外现金支出不超过 50 元，目标为 0 元
- **用途：** 个人作品集与面试演示，不作为商业生产服务

## 1. 这份文档解决什么问题

需求文档说明“用户要看到什么”，这份技术文档说明“程序如何把它实现出来”。

实现目标只有一条：

> 用户输入需求 → AI 整理规则 → 登录或注册 → 连接 Telegram → 创建 Radar → 获取公开信息 → AI 筛选 → 保存结果 → Telegram 通知

技术方案优先保证这条真实链路可以部署和演示。支付、团队、任意网站爬取、复杂消息队列、商业级监控和大规模并发不进入本次实现。

## 2. 最终技术选型

| 能力 | 最终选择 | 为什么适合本项目 |
|---|---|---|
| Web 框架 | Next.js App Router + TypeScript | 页面和服务端接口放在一个项目里，适合 12 小时 MVP |
| UI | shadcn/ui + Tailwind CSS + Lucide 图标 | 用可访问、可修改的基础组件快速还原原型，并避免 Emoji 图标 |
| 表单与校验 | React Hook Form + Zod | 表单交互轻量；同一套 Zod 规则可在浏览器和服务端复用 |
| 部署 | Vercel Hobby | 免费提供 HTTPS 和 vercel.app 地址，不需要购买服务器或域名 |
| 数据库 | Supabase PostgreSQL | 免费额度足够，同时支持 SQL、JSONB 和 RLS |
| 登录注册 | Supabase Auth 邮箱密码 | Supabase 负责密码哈希、Session 和 JWT，不自建认证系统 |
| 定时任务 | Supabase Cron | 免费计划可高频执行；Vercel Hobby Cron 只能每天运行一次，不满足每 6 小时检查 |
| 搜索来源 | Tavily Basic Search | 每次基础搜索消耗 1 credit，免费额度适合低频演示 |
| RSS 来源 | Music-News.com 官方新闻 RSS | 免费、固定、条款明确；只读取标题、第一句话和原文链接 |
| AI | Groq + openai/gpt-oss-20b | 免费计划额度适合低频 MVP，并支持严格的结构化输出 |
| 通知 | Telegram Bot API Webhook | 一个 Bot 可以服务所有用户和所有 Radar |
| 多语言 | 项目内中英文词典 | 比引入大型国际化框架更快，且不会出现运行时生硬替换 |

### 2.1 为什么不自建 JWT 登录

Supabase Auth 本身就使用 JWT。区别是密码哈希、刷新 Token、Cookie、Session 过期和安全修复由 Supabase 处理。

如果自建认证，需要额外完成密码加密、登录接口、刷新 Token、忘记密码、Cookie 安全、邮件验证和数据库权限。这些工作不会增强核心信息监控能力，却很容易在 12 小时内产生安全漏洞，因此本次不采用。

### 2.2 为什么不拆分独立后端

本次采用“模块化单体”：

- 页面、API 和业务逻辑都在一个 Next.js 项目中。
- 数据库、Auth 和 Cron 由 Supabase 托管。
- 外部服务通过独立模块封装，但不单独部署。

这样仍然有清楚的代码边界，却不需要维护前端、后端和消息队列三个项目。

### 2.3 shadcn/ui 如何使用

shadcn/ui 不是只能套默认主题的成品 UI 库。安装组件时，组件源码会进入项目的 `src/components/ui/`，可以直接修改样式。

本项目使用 Button、Input、Card、Badge、Tabs、Alert、Skeleton、DropdownMenu、Sheet、Form/Field 等基础组件，但必须遵守两条规则：

- 颜色、圆角、间距、字体层级和页面布局以已确认原型为准，不能为了使用 shadcn/ui 而把页面改成默认模板风格。
- Radar 创建流程继续使用独立页面；不因为 shadcn/ui 提供 Dialog 就改回弹窗。

表单统一使用 React Hook Form 管理输入状态，使用 Zod 描述输入规则，并通过 `zodResolver` 显示字段级错误。浏览器校验是为了及时提醒用户；服务端必须用同一个 Zod Schema 再校验一次，因为浏览器请求可以被绕过或伪造。

## 3. 总体架构

~~~mermaid
flowchart LR
    U[浏览器] --> N[Next.js on Vercel]
    N --> A[Supabase Auth]
    N --> D[Supabase PostgreSQL]
    C[Supabase Cron] --> N
    N --> T[Tavily Search]
    N --> R[Music-News.com RSS]
    N --> O[Groq]
    N --> B[Telegram Bot API]
    B --> W[Telegram Webhook]
    W --> N
~~~

### 3.1 各部分职责

**浏览器**

- 展示 Landing、Rules、Auth、Telegram、Dashboard 和 Radar 详情。
- 保存登录前的已确认规则。
- 不保存任何 API Key、Bot Token 或 service role key。

**Next.js 服务端**

- 验证用户身份和输入。
- 调用 Tavily、RSS、Groq 和 Telegram。
- 创建 Radar、执行监控、写入 Run 和 Finding。
- 接收 Telegram Webhook 和 Supabase Cron 请求。

**Supabase**

- Auth 管理用户和 Session。
- PostgreSQL 保存业务数据。
- RLS 确保用户只能读取自己的数据。
- Cron 每 15 分钟触发一次到期 Radar 检查。

## 4. 页面路由和真实流程

| 页面 | 路由 | 主要职责 |
|---|---|---|
| Landing | / | 输入关注需求，显示 AI 正在整理 |
| Rules | /rules | 展示并编辑 Radar 名称、关注项、忽略项 |
| Auth | /auth | 登录为默认，注册为次入口 |
| Telegram | /connect-telegram | 生成一次性 Bot 链接并等待绑定 |
| Dashboard | /dashboard | 展示全局健康状态、Telegram 和跨 Radar 最新发现 |
| My Radars | /radars | 展示并管理完整 Radar 列表 |
| Radar 详情 | /radars/[id] | 展示规则、发现、运行记录和操作 |

### 4.1 登录前如何保证规则不丢失

“草稿”只属于程序内部，不出现在用户界面。

具体流程：

1. Landing 把原始需求保存在浏览器 localStorage。
2. `/api/rules/parse` 返回两部分：用于 Rules 页面展示的结构化规则，以及一个由服务端 HMAC 签名、2 小时过期的 `rule_token`。
3. `rule_token` 保存 subject、aliases、search_query、importance_threshold 和固定频率等不可编辑字段；浏览器不能伪造或修改签名内容。
4. Rules 页面只保存 `rule_token`、原始需求，以及用户允许编辑的 Radar 名称、关注项和忽略项。登录失败、刷新或返回时继续恢复这些内容。
5. Auth 成功后，客户端提交 `rule_token + editable_delta`。服务端验证签名、过期时间和 Zod Schema，再合并固定字段，写入 pending_radar_setups。
6. Telegram 尚未连接时，服务端设置 `wa_setup=<setup_id>` 的 HttpOnly、Secure、SameSite=Lax Cookie，有效期 24 小时，然后进入 Telegram 页面；已经连接时在同一服务端流程中直接消费 setup 并创建 Radar。
7. Telegram 页面刷新或从 Bot 返回时，只通过 Cookie 恢复当前用户自己的 pending setup；Cookie 缺失、setup 过期或不属于当前用户时显示“本次创建已过期”，并提供返回首页重新开始的入口。
8. Radar 创建成功后，把 setup 标记为 consumed，服务端清除 `wa_setup` Cookie，浏览器清除临时需求和规则数据，并进入新 Radar 的 `/radars/[id]` 详情页查看首次检查。

浏览器只保存关注需求、允许编辑的字段和签名 token，不保存密码、Supabase Session、Telegram Token 或 service role key。同一浏览器同时开始第二个创建流程时，新的 setup 会取代 Cookie 中的旧 setup；旧记录仍按 24 小时自动过期，避免多标签串单。

### 4.2 两种登录入口

**从右上角 Log in 进入**

- Auth 成功后进入 Dashboard。
- 不创建 Radar。

**从 Rules 页面进入**

- Auth 成功后由服务端验证签名规则并创建 pending setup。
- 如果 Telegram 未连接，进入 /connect-telegram。
- 如果 Telegram 已连接，直接创建 Radar。

Auth 页面不接受任意跳转路径，只接受有限的场景值：

| next 值 | 登录成功后的实际目标 |
|---|---|
| dashboard | /dashboard |
| connect-telegram | 创建 pending setup；未绑定时设置 HttpOnly Cookie 并进入 /connect-telegram，已绑定时直接创建并进入 /radars/[id] |

服务端负责把场景值映射成真实地址。未知值一律回到 `/dashboard`；`http://`、`https://`、`//` 和任意自定义路径都不允许作为 next 值。

通俗地说，`next` 就是“登录成功后去哪”。如果允许别人传入任意网址，攻击者可以制作一个登录链接，让用户在本网站登录后被送到仿冒网站。这叫开放重定向。使用上面的 allowlist（允许列表）后，程序只认自己提前写死的两个目的地。

## 5. 推荐项目结构

下面是计划中的目录，不代表当前已经存在代码：

    src/
      app/
        page.tsx
        rules/page.tsx
        auth/page.tsx
        connect-telegram/page.tsx
        dashboard/page.tsx
        radars/page.tsx
        radars/[id]/page.tsx
        api/
          rules/parse/route.ts
          pending-setups/route.ts
          telegram/binding-token/route.ts
          telegram/status/route.ts
          telegram/webhook/route.ts
          radars/route.ts
          radars/[id]/route.ts
          radars/[id]/run/route.ts
          cron/run-due/route.ts
      components/
        ui/
        landing/
        radar/
      lib/
        supabase/
        ai/
        sources/
        monitoring/
        telegram/
        i18n/
        validation/
      types/
    supabase/
      migrations/
    docs/

模块边界：

- lib/ai 只负责模型请求和结构验证。
- lib/sources 只负责获取和标准化候选信息。
- lib/monitoring 负责把来源、AI、数据库和通知串成一次 Run。
- lib/telegram 只负责绑定和发送消息。
- 页面组件不直接持有第三方密钥。

## 6. 数据模型

### 6.1 状态必须分开

不同对象使用不同状态，不能混成一个字段：

| 对象 | 允许状态 |
|---|---|
| Radar 生命周期 | active、paused |
| Run 运行记录 | running、success、failed |
| Notification 内部状态 | pending、sending、sent、failed、unknown |
| Pending setup | pending、consumed、expired |

用户看到的 Run 状态永远只有：运行中、成功、失败。不存在 partial success 或“结果可能不完整”。

### 6.2 核心表

#### profiles

保存用户设置。

- id：对应 Supabase auth.users.id
- locale：en 或 zh-CN
- created_at、updated_at

#### guest_ai_requests

保护未登录的规则整理接口，避免公开部署被刷光免费额度。

- id
- identity_hash：IP 与匿名 Cookie 组合后的哈希
- created_at

首版限制为同一匿名身份每天 3 次、整个站点每天 20 次。表只允许服务端访问。

#### pending_radar_setups

保存登录后、Radar 创建前的已确认规则。

- id
- user_id
- original_prompt
- radar_name
- rules JSONB
- status
- expires_at
- created_at、updated_at

记录默认 24 小时过期。它不是 Radar，不能运行。

#### telegram_connections

一个用户只能有一个 Telegram 私聊连接。

- user_id，唯一
- chat_id，唯一
- telegram_username
- connected_at

#### telegram_binding_tokens

保存一次性绑定 Token。

- id
- user_id
- token_hash
- expires_at
- used_at

数据库只保存 Token 的 SHA-256 哈希，不保存原始 Token。

#### radars

保存一个真正可以运行的 Radar。

- id
- user_id
- name
- original_prompt
- rules JSONB
- source_state JSONB
- status：active 或 paused
- interval_minutes：MVP 固定 360
- baseline_cutoff_at
- last_checked_at
- next_check_at
- lease_owner
- lease_expires_at
- created_at、updated_at

创建或恢复 Radar 必须通过同一个 PostgreSQL 事务完成：锁定该用户的创建操作、统计 `status=active` 的 Radar，少于 3 个才允许写入或恢复；达到 3 个时返回稳定错误 `ACTIVE_RADAR_LIMIT_REACHED`。不能只在前端数卡片，否则两个同时到达的请求可能一起创建出第 4 个 active Radar。暂停操作不受这个上限影响。

#### radar_runs

保存每次检查。

- id
- radar_id
- trigger：baseline、schedule、manual
- status：running、success、failed
- started_at、finished_at
- candidate_count
- relevant_count
- notification_count
- source_outcomes JSONB：每个来源完成后立即持久化成功或失败结果
- source_success_count：已持久化的成功来源数，用于恢复公开终态
- lease_owner：本次 Run 的随机执行者 ID，用于恢复时做条件更新
- lease_expires_at：本次 Run 的执行租约过期时间
- error_code：用户可映射的稳定错误码
- internal_errors JSONB：只写日志，不直接显示给用户
- created_at

#### findings

保存候选信息和 AI 判断。

- id
- radar_id
- first_run_id
- source_type
- source_domain
- source_url
- canonical_url
- fingerprint
- event_key：可为空；AI 未返回合法值时使用确定性 fallback
- title
- summary
- published_at
- first_seen_at、last_seen_at
- relevance_score
- importance_score
- match_reason
- notification_eligible

radar_id + fingerprint 必须唯一。

#### notifications

保存 Telegram 发送结果。

- id
- finding_id
- radar_id
- user_id
- destination_id
- dedupe_key：优先使用 event_key，否则使用 fingerprint
- status：pending、sending、sent、failed、unknown
- telegram_message_id
- error_code
- claimed_at
- sent_at

`radar_id + dedupe_key + destination_id` 必须唯一，防止同一 Radar 把同一事件重复通知到同一个 Telegram。`finding_id + destination_id` 也保持唯一，防止同一条 Finding 因重试被重复发送。

进入通知流程的 Finding 必须有最终去重键。AI 返回合法 event_key 时使用它；缺失或不合法时，回退到 `fingerprint`，不会因此把来源获取成功的 Run 改成 failed。语义去重是加分项，确定性 fingerprint 是 12 小时 MVP 的可靠底线。

### 6.3 通知的 at-most-once 策略

Telegram Bot API 不接收客户端幂等键。如果 Telegram 已经收到消息，而 Vercel 在更新数据库前崩溃，自动重试可能产生第二条消息。因此 MVP 明确选择 at-most-once：优先避免重复通知，接受极端网络异常下可能漏掉一次。

1. 先插入具有唯一约束的 pending Notification。
2. 发送前用条件更新原子地把 `pending → sending`，只有成功领取的请求可以调用 Telegram。
3. Telegram 明确返回成功时写入 sent 和 message_id。
4. Telegram 明确拒绝且确认消息未发送时写入 failed。
5. 请求超时或进程在发送后中断、无法判断 Telegram 是否收到时写入 unknown，绝不自动重发。
6. 只有能够证明请求尚未送达 Telegram 的“发送前失败”，才允许人工或程序把记录重置为 pending。

用户界面把 unknown 显示为“通知状态未确认”，但不改变 Run 的 success/failed。12 小时 MVP 不实现通知补偿队列。

### 6.4 为什么规则使用 JSONB

规则对象会随着 AI 输出逐步调整，而用户、Radar、Run 等关系相对稳定。

rules JSONB 只保存这一小块可变化内容：

    {
      "version": 1,
      "subject": "LISA",
      "aliases": ["Lalisa Manobal", "BLACKPINK LISA"],
      "include_topics": [
        "music releases",
        "tours",
        "official announcements",
        "brand partnerships"
      ],
      "exclude_topics": [
        "rumours",
        "fan speculation",
        "old news",
        "repeated coverage"
      ],
      "search_query": "LISA official music release tour partnership",
      "importance_threshold": 75
    }

Radar 名称仍然是普通数据库列。JSONB 不是用来把整个数据库塞进一个字段，而是为了让规则结构可以低成本迭代。

保存前必须经过 Zod 校验：

- subject：1 到 100 字符。
- include_topics：1 到 8 项。
- exclude_topics：最多 8 项。
- search_query：1 到 240 字符。
- importance_threshold：固定为 75，首版不允许用户修改。
- 不允许 AI 返回未定义字段。

用户首版只编辑 Radar 名称、关注项和忽略项。subject、search_query、importance_threshold 和检查频率只读。

“只读”必须由服务端强制，而不只是把输入框设为 disabled：`rule_token` 使用 `RULE_TOKEN_SECRET` 做 HMAC 签名；创建 pending setup 时，服务端只从签名内容恢复 subject、aliases、search_query、threshold 和频率，只从 editable_delta 接收名称、关注项和忽略项。签名错误、过期或字段不合法时拒绝创建，并要求重新整理规则。

## 7. 数据权限和 RLS

RLS 是 Row Level Security（行级安全），意思是数据库在返回或修改每一行之前，都检查“这一行是否属于当前登录用户”。它可以理解为数据库最后一道上锁的门。

例如，用户 A 在浏览器里手动伪造请求，尝试读取用户 B 的 Radar。即使某个 API 忘记检查所有权，只要数据库策略要求 `user_id = auth.uid()`，数据库也会返回零行，而不是把 B 的数据交给 A。

这里说的“启用 RLS”不是让我们修改 Supabase 管理的 `auth.users` 表。我们要在自己创建、包含用户业务数据的 public schema 表上启用 RLS，例如 profiles、pending_radar_setups、telegram_connections、radars、radar_runs、findings 和 notifications。guest_ai_requests、telegram_binding_tokens 也启用 RLS，但不开放给浏览器直接读取。

| 表 | 用户可读 | 浏览器直接新增/修改 | 服务端可写 |
|---|---|---|---|
| profiles | 自己 | 仅 locale | 是 |
| guest_ai_requests | 否 | 否 | 是 |
| pending_radar_setups | 自己 | 否 | 是 |
| telegram_connections | 自己 | 否 | 是 |
| telegram_binding_tokens | 否 | 否 | 是 |
| radars | 自己 | 否 | 是 |
| radar_runs | 自己 Radar 下的数据 | 否 | 是 |
| findings | 自己 Radar 下的数据 | 否 | 是 |
| notifications | 自己的数据 | 否 | 是 |

关键原则：

- 浏览器使用 Supabase publishable/anon key 和用户 Session。
- service role key 只存在于 Vercel 服务端环境变量。
- 外部来源、Run、Finding、Notification 只能由可信服务端写入。
- 每个 API 都再次校验 user_id，不只依赖页面隐藏按钮。
- RLS 和 API 所有权校验都要做：API 校验负责尽早拒绝错误请求，RLS 负责在代码遗漏时兜底。
- service role 可以绕过 RLS，因此绝不能发送到浏览器，也不能写入 `NEXT_PUBLIC_` 环境变量。

## 8. AI 设计

AI 只做两个有明确输入输出的任务。

### 8.1 任务一：把自然语言整理成规则

输入：

- 用户原始需求。
- 当前语言。

输出：

- radar_name
- subject
- aliases
- include_topics
- exclude_topics
- search_query
- importance_threshold

Groq 请求使用严格 JSON Schema，设置 `strict: true`。Schema 中所有字段标记为 required，对象设置 `additionalProperties: false`。返回结果再用 Zod 做防御性校验；校验失败只允许修复重试一次。

### 8.2 任务二：筛选候选信息

一次最多发送 8 条候选，每条 excerpt 最多保留约 800 个字符。这样给规则、提示词和模型输出留出空间，避免轻易撞到 Groq 免费计划每分钟 Token 上限。

AI 为每条候选返回：

- relevant：是否符合规则
- relevance_score
- importance_score
- confidence
- event_key：同一事件的稳定短标识
- duplicate_of_event_key
- reason：给用户看的简短原因

应用程序根据阈值决定是否通知。AI 不负责定时、抓取、数据库写入和 Telegram 发送。

### 8.3 模型与额度

默认模型：

    openai/gpt-oss-20b

使用官方 `groq-sdk` 调用。模型名放在 `GROQ_MODEL` 环境变量里，默认值是 `openai/gpt-oss-20b`，以后更换模型不需要改业务流程。该模型支持严格的 JSON Schema Structured Outputs，适合把用户需求稳定地整理成程序能读取的规则。

截至文档编写时，Groq 官方 Free Plan 对该模型列出的限制是 30 RPM、1,000 RPD、8,000 TPM、200,000 TPD；账号实际限制以 Groq Console 为准。按照当前产品限制，正常演示预计不超过 30 次模型请求/天：

- 创建 3 个 Radar：约 3 次规则整理。
- 3 个 Radar 每 6 小时运行：约 12 次筛选/天。
- 剩余额度用于手动检查、重试和演示。

未登录规则整理使用 guest_ai_requests 做简单限流；手动检查通过查询当天的 radar_runs，限制每个用户每天 3 次。首版不开发运营配额后台。规则整理阶段 Groq 达到免费限制时，当前操作失败并允许稍后重试；监控阶段如果至少一个信息来源已经成功，AI 配额错误只写入 Run 的 internal_errors，不把 Run 改成 failed，也不发送未经判断的通知。项目不绑定自动付费，也不使用自动运行时模型回退；如默认模型以后不可用，开发者可以通过环境变量手动切换到另一个支持严格结构化输出的 Groq 模型。

## 9. 信息来源

### 9.1 Tavily

每个 Run 最多执行一次 Basic Search：

- search_depth：basic
- max_results：5
- 不使用 Tavily Extract、Crawl 或 Research
- 查询词只来自已校验的 rules.search_query

Tavily 当前免费提供每月 1,000 credits，Basic Search 每次消耗 1 credit。3 个 Radar 每 6 小时检查，理论上每月约 360 次定时搜索，仍在免费额度内。

### 9.2 Music-News.com RSS

服务端只允许请求一个固定地址：

    https://www.music-news.com/rss/c5RAS2tkYoRTvbRq/UK/news

用户不能输入或修改 RSS URL，因此不存在任意 URL 抓取。

根据 Music-News.com 的 RSS 说明，本项目只读取并展示标题、第一句话和清晰可见的原文链接，不使用来源图片，也不重新发布全文。这个固定 feed 主要用于证明 RSS 接入和独立来源容错；不同 Radar 的主题覆盖主要由 Tavily 完成。

### 9.3 统一候选格式

Tavily 和 RSS 都转换为同一种 Candidate：

    {
      "source_type": "tavily | rss",
      "source_domain": "example.com",
      "source_url": "https://...",
      "title": "...",
      "excerpt": "...",
      "published_at": "..."
    }

后续去重和 AI 不需要知道原始来源返回了什么字段。

## 10. 去重和首次基线

### 10.1 两层去重

“去重”只是避免用户反复收到同一内容，不是删除所有相似文章。MVP 分两层处理。

**第一层：同一篇内容，由程序精确判断。**

1. 规范化 URL，去掉常见追踪参数。
2. 如果有稳定 URL，使用 URL 哈希作为 fingerprint。
3. 没有稳定 URL 时，使用规范化标题 + 来源域名生成 fingerprint。
4. 数据库唯一约束阻止同一个 fingerprint 重复写入。

例如 Tavily 和 RSS 都返回同一个 Billboard 链接，只是一个链接后面带了 `utm_source`。去掉追踪参数后两个 URL 相同，因此只保存一次。这一层结果稳定，不需要 AI 猜。

**第二层：不同文章讲同一件事，由 AI 辅助判断。**

- 同一批候选生成 event_key。
- 把最近已通知事件的标题和 event_key 一起提供给 AI。
- 同一个 event_key 只选择分数最高的一条通知。

例如 Billboard 和 Variety 使用不同链接报道“LISA 9 月发行新单曲”。两篇文章的 fingerprint 不同，但 AI 可以把它们归为同一个 `event_key`，例如 `lisa-new-single-2026-09`。两篇 Finding 都可以留在数据库供详情页查看，但 Telegram 只选分数最高的一篇发送。

跨 Run 时，程序把该 Radar 最近已经通知的 event_key 和标题提供给 AI，再通过 notifications 上的唯一约束做最后拦截。AI 生成的 event_key 不是绝对可靠，所以这套方案的目标是“明显减少重复通知”，不承诺商业级语义去重完全准确。

### 10.2 首次基线

创建 Radar 后立即执行第一次 Run，但不发送任何通知。

radars.source_state 为每个来源保存是否完成首次基线：

    {
      "tavily": { "baseline_completed": true },
      "music_news_rss": { "baseline_completed": false }
    }

如果 Tavily 成功、RSS 失败：

- 整体 Run 显示成功。
- Tavily 结果保存但不通知，因为这是它的首次基线。
- RSS 仍保持未完成基线。
- RSS 下次首次成功时，它自己的旧结果仍只保存、不通知。

这样既符合“任一来源成功即整体成功”，也不会在失败来源恢复后突然推送旧闻。

## 11. Run 执行流程

### 11.1 触发方式

- baseline：Radar 创建后立即触发。
- manual：用户点击“立即检查”，同一 Radar 冷却 30 分钟，每个用户每天最多 3 次。
- schedule：Supabase Cron 找到到期 Radar。

### 11.2 防止重复运行

Cron 和手动检查可能同时触发同一个 Radar，因此需要数据库原子领取：

1. 只领取 active、已到期且没有有效 lease 的 Radar。
2. 使用 PostgreSQL 函数和 FOR UPDATE SKIP LOCKED。
3. 生成随机 `lease_owner`，同时写入 Radar 和 Run 的 `lease_owner`、`lease_expires_at`。
4. 提交事务后再调用外部 API。
5. Run 完成后清除 lease 并更新 next_check_at。

同一个 Radar 同一时间只允许一个 running Run。新建 Run 前必须先处理该 Radar 的过期 running Run，不能用新 Run 掩盖旧的 running 状态。

### 11.3 完整管线

1. 创建 status=running 的 radar_runs。
2. 读取并校验 Radar rules。
3. 并行调用 Tavily 和 RSS，各自设置约 8 秒超时。
4. 判断来源成功数量。
5. 标准化候选并执行确定性去重。
6. 过滤明显旧闻、排除词和已通知内容。
7. 最多取 8 条交给 Groq 批量判断。
8. 保存 Findings。
9. 对符合阈值且不重复的 Finding 创建 pending Notification。
10. 原子领取 Notification，写入 sending 后调用 Telegram sendMessage；超时或结果不确定时写入 unknown 且不自动重发。
11. 根据成功来源数量更新 Run；AI 和 Telegram 错误只写 internal_errors/Notification，不覆盖来源决定的 Run 状态。
12. 设置下次检查时间为当前时间后 6 小时。

单次 Run 目标在 30 秒内结束。Vercel 函数设置最大 60 秒，避免请求无限挂住。

## 12. 运行状态和错误映射

| 情况 | Run 状态 | 用户看到什么 | 内部记录 |
|---|---|---|---|
| 正在获取或判断 | running | 正在检查 | 当前步骤和开始时间 |
| Tavily 和 RSS 都成功 | success | 检查成功 | 每个来源耗时 |
| Tavily/RSS 任意一个成功，另一个失败 | success | 检查成功 | 失败来源和错误码 |
| 两个来源全部失败 | failed | 本次检查失败，请重试 | 各来源错误 |
| 至少一个来源成功，但 AI 无法完成判断 | success | 检查成功；本次没有新的重要发现 | AI 错误，只写 internal_errors |
| 来源调用前或领取 Run 时数据库发生致命错误 | failed | 本次检查失败 | 数据库错误 |
| 已持久化至少一个成功来源，后续数据库终态写入暂时失败 | success（恢复任务补写） | 检查成功 | 数据库错误和恢复次数 |
| Telegram 明确发送失败 | success | 检查成功；通知发送失败 | Notification=failed |
| Telegram 发送结果无法确认 | success | 检查成功；通知状态未确认 | Notification=unknown，不自动重发 |
| 监控阶段 AI 免费额度耗尽，且来源已成功 | success | 检查成功；本次没有新的重要发现 | AI_QUOTA_EXCEEDED |
| 所有来源因免费额度或网络问题失败 | failed | 本次检查失败，请稍后再试 | SOURCE_QUOTA_EXCEEDED 或来源错误 |

重点：

- 不显示“部分成功”。
- 不显示“结果可能不完整”。
- 不把 Tavily、RSS、HTTP 状态码或模型名称暴露给用户。
- Run 的公开终态由来源获取结果决定：至少一个来源成功即 success，只有全部来源失败或在来源调用前发生致命数据库/编排错误才 failed。
- AI、event_key 和 Telegram 发送状态不改变已经由来源确定的 Run 状态。
- 每个来源完成后，必须先把结果写入 `source_outcomes` 并更新 `source_success_count`，再进入 AI 判断。终态更新使用 `status=running` 的条件更新，失败时立即重试两次。
- lease 恢复任务不能只把超时 Run 粗暴标记为 failed：`source_success_count >= 1` 时补写 success；所有来源均已有失败记录时补写 failed；没有可靠来源记录时才按基础设施失败处理。这样即使终态写入短暂失败，Run 也不会永久卡在 running，更不会把已经成功的来源改成失败。

## 13. Telegram 绑定和通知

### 13.1 一个 Bot 服务所有 Radar

用户只绑定一次 Telegram。之后该用户的全部 Radar 都向同一个私聊发送通知。

Bot 首版只支持：

- /start <token>：完成绑定。
- /help：说明 Radar 管理在网站进行。
- 服务端主动发送通知。

不支持用户在 Bot 中创建、编辑、暂停或删除 Radar。

### 13.2 绑定流程

1. 已登录用户请求一次性随机 Token。
2. 服务端保存 Token 哈希、user_id 和 10 分钟过期时间。
3. 网站打开 https://t.me/<bot_username>?start=<raw_token>。
4. 用户在私聊点击 Start。
5. Telegram 请求 /api/telegram/webhook。
6. 服务端验证 X-Telegram-Bot-Api-Secret-Token。
7. 对 raw_token 做 SHA-256，并原子消费数据库记录。
8. 保存 chat_id 到 telegram_connections。
9. 网站轮询连接状态，成功后允许创建 Radar。

只接受 private chat。一个 chat_id 只能绑定一个网站账号。

### 13.3 为什么 Webhook 要验证 secret header

Webhook 路由部署在公网，任何人都能尝试向它发送 POST 请求。如果只相信请求正文，攻击者可以伪造 Telegram 的 `/start` 消息，尝试绑定错误账号或制造垃圾数据。

配置 Telegram `setWebhook` 时同时设置 `secret_token`。之后 Telegram 会在每次合法 Webhook 请求中携带请求头：

    X-Telegram-Bot-Api-Secret-Token: <约定的秘密值>

服务端把它与 `TELEGRAM_WEBHOOK_SECRET` 比较；缺失或不一致时立即返回 401，并且不读写业务数据。这个 Secret 只存服务端环境变量。HTTPS 仍然必须使用：HTTPS 保护传输过程，secret header 用来确认请求方知道双方约定的秘密。

### 13.4 部署后必须注册 Webhook

拿到 Bot Token 并不会自动连接网站。Vercel 部署完成后必须执行一次受控脚本调用 Telegram `setWebhook`：

- url：`https://<vercel-domain>/api/telegram/webhook`
- secret_token：与 Vercel 的 `TELEGRAM_WEBHOOK_SECRET` 相同
- allowed_updates：只保留 message
- drop_pending_updates：首次演示环境设为 true，避免历史测试消息干扰

脚本不得把 Bot Token 或 Secret 输出到日志。随后调用 `getWebhookInfo`，确认 URL 正确且没有 last_error_message；再从真实 Telegram 私聊发送一次 `/start <token>`，验证 Vercel 收到 HTTPS 回调、secret header 校验通过，并成功写入 telegram_connections。这个步骤是部署 Smoke Test 的一部分，不完成就不能认为 Telegram 绑定已上线。

### 13.5 通知格式

    [LISA Official Radar]
    LISA announces a new single for September

    匹配原因：官方来源发布新的音乐作品
    匹配度：91 / 100
    来源：billboard.com
    查看原文：https://...

同一个 Finding 在同一个 chat_id 上只能存在一条 Notification；同一个 Radar 的同一 event_key 在同一个 chat_id 上也只能通知一次。

## 14. 定时任务

Supabase Cron 使用 pg_cron + pg_net，每 15 分钟向以下接口发送 POST。Vercel 地址和 CRON_SECRET 保存在 Supabase Vault，不直接写进 SQL 文件：

    /api/cron/run-due

请求携带 CRON_SECRET。接口：

1. 验证 Secret。
2. 在事务中先扫描最多一个 `lease_expires_at < now()` 的 running Run，并按 `id + status=running + lease_owner` 做 CAS 恢复：`source_success_count >= 1` 补写 success；来源均已完成且全部失败时补写 failed；没有可靠来源记录时写入基础设施失败。
3. 恢复旧 Run 时同时清除对应 Radar/Run 的 lease，并更新 `next_check_at`；恢复过程只整理已持久化状态，绝不再次调用搜索、AI 或 Telegram。
4. 完成恢复后，再原子领取最多一个到期且没有 running Run 的 Radar。
5. 没有到期任务时立即返回 204；有任务时执行一次 Run。

如果数据库暂时不可用，本次 Cron 直接失败，下一次 Cron 继续执行同一恢复 CAS。CAS 保证多个 Cron 同时到达时只有一个能完成恢复；在旧 Run 进入终态前，任何入口都不能为同一个 Radar 新建 Run。

3 个 active Radar 最坏可能产生约 30 分钟排队延迟。对默认每 6 小时检查的个人演示可以接受。

不用 Vercel Cron，因为 Vercel Hobby 当前只允许每天一次，不满足需求。

## 15. API 设计

| 方法与路径 | 是否登录 | 作用 |
|---|---|---|
| POST /api/rules/parse | 否，有限流 | 把自然语言转成规则并返回签名 rule_token |
| POST /api/pending-setups | 是 | 验证 rule_token、合并 editable_delta、设置 wa_setup Cookie |
| GET /api/pending-setups/current | 是 | 通过 Cookie 恢复当前用户未过期的 setup |
| POST /api/telegram/binding-token | 是 | 创建一次性 Bot 链接 |
| GET /api/telegram/status | 是 | 查询是否绑定成功 |
| POST /api/telegram/webhook | Telegram Secret | 接收 /start |
| GET /api/radars | 是 | 获取当前用户 Radar |
| POST /api/radars | 是 | 校验 setup 和 Telegram 后创建 |
| GET /api/radars/[id] | 是 | 获取详情 |
| PATCH /api/radars/[id] | 是 | 暂停、恢复或编辑规则 |
| POST /api/radars/[id]/run | 是 | 立即检查 |
| POST /api/cron/run-due | Cron Secret | 执行到期 Radar |

所有输入都使用 Zod 校验。所有动态 id 都必须验证资源属于当前用户。

## 16. 多语言和响应式实现

### 16.1 多语言

使用静态词典：

    src/lib/i18n/messages/en.ts
    src/lib/i18n/messages/zh-CN.ts

语言保存在 Cookie；登录后同时写入 profiles.locale。

禁止：

- 用 DOM 遍历替换整页文本。
- 把英文直接机器翻译后当作最终中文。
- 翻译 LISA、OpenAI、Telegram、Radar 等专有名词。

### 16.2 响应式

- 850px 以下从双栏变为单栏。
- 390 × 844 不出现横向滚动。
- Dashboard 卡片改为纵向。
- 移动端菜单保留 Dashboard、Radars、Telegram。
- 所有功能图标使用 Lucide SVG，不使用 Emoji。

### 16.3 表单校验

Landing 需求、Rules 编辑和 Auth 表单使用 React Hook Form。每个表单都有对应的 Zod Schema：

- 浏览器先校验必填项、长度、邮箱格式和数组数量，让用户立即看到容易理解的中文或英文错误。
- API 收到请求后使用同一个 Schema 再校验，失败返回稳定的字段错误，不信任浏览器已经校验过。
- Zod Schema 同时生成 TypeScript 类型，避免“页面认为字段存在，服务端却使用另一种结构”。
- AI 输出、URL 参数、动态路由 id 和环境变量也分别使用 Zod 校验，但不和用户表单混成一个超大 Schema。

## 17. 安全最低要求

- SUPABASE_SERVICE_ROLE_KEY、RULE_TOKEN_SECRET、TAVILY_API_KEY、GROQ_API_KEY、TELEGRAM_BOT_TOKEN 只在服务端。
- Supabase Auth Session 使用官方 SSR Cookie 方案，不手动把 JWT 放进 localStorage。
- 所有包含用户业务数据的 public schema 表启用 RLS；`auth.users` 由 Supabase 管理，不由本项目手动修改。
- Telegram Webhook 必须验证 `X-Telegram-Bot-Api-Secret-Token`；缺失或错误返回 401，且不写数据库。
- Telegram binding token 随机、短期、单次使用、数据库只存哈希。
- RSS 域名和路径由服务端固定，拒绝任意 URL。
- Auth 的 next 只接受 `dashboard`、`connect-telegram` 两个场景值，再由服务端映射真实地址；未知值回到 `/dashboard`。
- 原始第三方错误写入服务端日志，前端只收到稳定错误码。
- AI 输出不直接执行，必须经过 JSON Schema 和 Zod。

## 18. 环境变量

    NEXT_PUBLIC_APP_URL
    NEXT_PUBLIC_SUPABASE_URL
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    SUPABASE_SERVICE_ROLE_KEY
    CRON_SECRET
    RULE_TOKEN_SECRET
    TAVILY_API_KEY
    GROQ_API_KEY
    GROQ_MODEL
    TELEGRAM_BOT_TOKEN
    TELEGRAM_BOT_USERNAME
    TELEGRAM_WEBHOOK_SECRET

真实值只能放在 .env.local、Vercel Environment Variables 和 Supabase Vault。GitHub 只提交 .env.example 占位符。

## 19. 费用、额度和风险

| 服务 | 当前免费能力 | MVP 预计使用 | 风险与处理 |
|---|---|---|---|
| Vercel Hobby | 个人项目免费部署和 HTTPS | 一个站点 | 仅用于非商业作品集 |
| Supabase Free | 500 MB 数据库、50,000 MAU | 少量用户和文本 | 项目长期不活跃可能暂停，演示前检查 |
| Tavily Free | 1,000 credits/月 | 约 360 次基础搜索/月上限 | 关闭付费超额 |
| Groq Free Plan | openai/gpt-oss-20b 当前为 1,000 RPD、8,000 TPM、200,000 TPD | 正常演示预计低于 30 次/天 | 账号实际限制以 Console 为准；演示前预检 |
| Telegram Bot API | 免费 | 少量通知 | Webhook 配置错误会导致无法绑定 |
| Music-News.com RSS | 免费个人用途 | 一个固定新闻 feed | 只使用标题、第一句话并链接原文 |

预计额外支出：0 元。

如果默认 Groq 模型在演示前不可用，可通过 `GROQ_MODEL` 手动切换到另一个支持严格结构化输出的 Groq 模型；任何付费操作都必须再次获得用户同意。

## 20. 12 小时范围冻结

### 按小时设置硬闸门

12 小时不能同时铺开所有页面。实施按下面的时间盒推进，每个时间盒以“可演示结果”为退出条件：

1. **0–1 小时，外部预检与骨架：** Supabase、Tavily、Groq、Telegram 和 Vercel 均通过最小调用；Next.js 骨架能部署。任何服务失败都在这一小时内换方案，不把风险留到最后。
2. **1–4 小时，账号与安全创建链：** 数据表、RLS、Supabase Auth、签名规则 Token 和 pending setup 跑通。退出条件是登录前后的规则不丢失，且不能篡改不可编辑规则。
3. **4–8 小时，LISA 真实垂直闭环：** 真实来源、Groq 判断、Radar 创建、首次基线、手动检查和 Telegram 通知在部署地址跑通。第 8 小时前必须得到一条真实端到端结果。
4. **8–10 小时，多 Radar 与核心后台：** 创建第二个 Radar，证明数据隔离；完成最低限度 Dashboard、`/radars`、`/radars/[id]`、详情操作、移动三入口和核心中英文。
5. **10–12 小时，调度与收尾：** 接入 Cron，再按剩余时间补自动测试、视觉润色和非核心错误文案翻译。

任何闸门未跑通时，不得先做装饰性动画、完整模板库、复杂语义去重或第三个演示 Radar。最多 3 个 active Radar 仍是产品约束，但演示只要求真实创建两个。

如果第 8 小时仍未部署真实闭环，立即停止非核心工作，按以下顺序延后：Dashboard 视觉润色、非核心错误文案翻译、语义 event_key、自动 Cron。演示可暂时用“立即检查”触发 Run，但 Auth、真实 Telegram、LISA 真实来源、部署地址、第二个 Radar 的数据隔离、最低限度 Dashboard、详情操作、移动三入口和核心中英文不能延后。Cron 仍是目标功能，只在保住真实闭环时才允许降级。

### 演示不可降级

- Next.js 可以本地运行并部署到 Vercel。
- Supabase Auth 登录和注册。
- 登录流程中规则不丢失。
- Telegram 真实绑定。
- 真实创建多个 Radar。
- My Radars 和 Radar 详情读取真实数据库。
- Tavily + RSS 获取真实信息。
- Groq 生成规则并筛选候选。
- 首次基线不发送旧闻。
- Run 三种状态。
- 至少一条真实 Telegram 通知。
- 第二个 Radar 不覆盖第一个。
- 最低限度 Dashboard：Telegram 状态、需要处理事项、跨 Radar 最新 3 条发现，以及进入 `/radars` 的入口。
- Radar 详情的暂停/恢复、立即检查和编辑规则入口。
- Landing、Rules、Auth、Telegram、Dashboard、My Radars 和详情的核心中英文，以及移动端 Dashboard/Radars/Telegram 三入口。

### 可以降级或延后

- 自动 Cron 调度；未完成时保留“立即检查”作为演示触发方式。
- Dashboard 视觉润色和装饰性状态。
- 非核心错误、空状态和帮助文案的完整双语翻译。
- 语义 event_key；继续使用确定性 fingerprint 去重。

### 只做最低限度

- 自动测试只覆盖规则校验、去重、状态映射、RLS 所有权和通知幂等。
- 手动检查设置冷却时间，但不做复杂运营后台。
- 每次 Cron 只领取一个 Radar。
- 忘记密码保留入口和说明，完整邮件流程延后。

### 不进入实现

- 第三个 Radar 的独立演示脚本。
- 强制 OpenAI Radar 完整跑通通知。
- 任意 RSS 或 URL 管理。
- 复杂重试队列、Redis、消息队列。
- 商业级语义去重。
- 支付、团队、统计大屏、自定义域名。

## 21. 开发前外部服务预检

开始写业务代码前先完成这些只需几分钟的检查：

1. Supabase 项目可以创建表并使用 Auth。
2. 演示环境关闭 Confirm Email，避免默认邮件服务阻塞测试者注册。
3. Tavily API Key 能执行一次 Basic Search。
4. Groq API Key 能让 `openai/gpt-oss-20b` 返回符合严格 JSON Schema 的结果。
5. Telegram Bot 已由 BotFather 创建，拿到 username 和 token。
6. Vercel 可以从 GitHub 部署一个最小 Next.js 页面。
7. 部署后执行 setWebhook，并通过 getWebhookInfo 确认 HTTPS URL 和 secret_token 配置正常。
8. 使用真实 `/start <token>` 完成一次回调和数据库绑定。
9. Music-News.com 固定 RSS 返回 HTTP 200 和有效 XML。

任意一个外部服务预检失败，都应先换方案或修复配置，再继续构建依赖它的页面。

## 22. 验证策略

### 自动验证

- rules JSONB 的 Zod Schema。
- URL 标准化和 fingerprint。
- Run 状态映射，确保不会产生第四种状态。
- 任一来源成功时 Run=success；全部失败时 Run=failed。
- 模拟来源成功已持久化但终态写入失败：下一次 Cron 必须恢复旧 Run 为 success、清除 lease、不重复调用外部服务，且同一 Radar 不留下永久 running。
- 来源成功但 AI 配额、event_key 或 Telegram 失败时仍保持 Run=success，并记录内部错误。
- Telegram binding token 过期和重复使用。
- 同一个 Finding 不重复创建 Notification；不同文章属于同一 event_key 时也不重复通知。
- Notification 只有 pending 能原子进入 sending；unknown 不自动重发。
- rule_token 签名错误、过期或固定字段被篡改时不能创建 pending setup。
- wa_setup Cookie 只能恢复当前用户、pending 且未过期的 setup。
- 两个用户无法读取彼此 Radar。
- Telegram Webhook secret 缺失或错误时返回 401 且不写数据。
- Auth next 遇到站外 URL 或未知值时回到 `/dashboard`。

### 部署后手动 Smoke Test

1. 未登录输入 LISA 需求。
2. AI 返回规则并允许编辑三类字段。
3. 注册或登录，确认规则仍在。
4. 连接真实 Telegram Bot。
5. 创建 LISA Radar，首次基线不通知。
6. 点击立即检查或等待 Cron。
7. Dashboard、My Radars 和详情出现真实 Run 与 Finding。
8. 触发一条符合条件的新 Finding，Telegram 收到真实消息。
9. 创建第二个 Radar，确认两个 Radar 数据互不覆盖。
10. 切换中文并检查 390 × 844 页面。

## 23. 原型基准

是的，正式开发必须参照原型。这样可以避免写代码时重新设计页面，也是 12 小时内最高效的做法。但三类材料解决的问题不同，发生冲突时按以下优先级判断：

1. 需求文档决定产品范围、用户规则和可见状态。
2. 本技术文档决定数据、API、安全和第三方服务如何实现。
3. 原型决定页面布局、颜色、字体层级、间距、响应式方式和点击流程。

也就是说，开发时要用 React、shadcn/ui 和 Tailwind 重新实现原型的视觉与流程，不能直接复制原型里的内联 JavaScript、localStorage 模拟接口或过期文案。

生产实现只参考以下目录：

    .superpowers/brainstorm/79724-1785854240/content/

包含：

- landing-combined-v3.html
- radar-rules-v1.html
- auth-v1.html
- connect-telegram-v1.html
- dashboard-create-flow-v1.html
- radar-detail-runs-v1.html

页面映射：

| 原型文件 | 生产路由 |
|---|---|
| landing-combined-v3.html | / |
| radar-rules-v1.html | /rules |
| auth-v1.html | /auth |
| connect-telegram-v1.html | /connect-telegram |
| dashboard-create-flow-v1.html | /dashboard 和 /radars；原型内用导航切换两个视图 |
| radar-detail-runs-v1.html | /radars/[id] |

这些 HTML 是可点击原型，不是生产代码。canonical 原型必须清除 Rule draft、Partial success、Results may be incomplete、`next=telegram` 和面向用户的 Tavily/RSS 技术文案；生产实现还必须把 `/files/*.html` 的原型跳转换成上表中的 Next.js 路由。

最终产品规则以需求文档和本技术文档为准：

- 用户只知道已确认规则不会丢失。
- Run 只有运行中、成功、失败。
- 任一来源成功即整体成功。
- Telegram 未连接不能创建 Radar。
- 不实现 Activity、KPI 大屏或 Active 但未连接通知的状态。

## 24. 官方资料

- [Next.js App Router](https://nextjs.org/docs/app)
- [Supabase Auth 邮箱密码](https://supabase.com/docs/guides/auth/passwords)
- [Supabase Cron](https://supabase.com/docs/guides/cron)
- [Supabase Pricing](https://supabase.com/pricing)
- [Tavily Credits & Pricing](https://docs.tavily.com/documentation/api-credits)
- [Music-News.com RSS 使用说明](https://www.music-news.com/rss-feeds)
- [Groq GPT-OSS 20B 模型](https://console.groq.com/docs/model/openai/gpt-oss-20b)
- [Groq Rate Limits](https://console.groq.com/docs/rate-limits)
- [Groq Structured Outputs](https://console.groq.com/docs/structured-outputs)
- [shadcn/ui + React Hook Form](https://ui.shadcn.com/docs/forms/react-hook-form)
- [Zod](https://zod.dev/)
- [Telegram Bot API setWebhook](https://core.telegram.org/bots/api#setwebhook)
- [Vercel Hobby Plan](https://vercel.com/docs/plans/hobby)
- [Vercel Cron 免费计划限制](https://vercel.com/docs/cron-jobs/usage-and-pricing)

## 25. 实施计划基线

本技术文档锁定了以下决定：

1. 使用 Supabase Auth，不自建 JWT。
2. 使用 Supabase Cron，不使用 Vercel Hobby Cron。
3. 使用 Tavily Basic + 固定 Music-News.com RSS。
4. 使用 Groq 和 `openai/gpt-oss-20b` 作为 AI 运行时服务。
5. 登录前保存签名 rule_token 和可编辑字段，登录后由服务端验证并写入 pending_radar_setups，再用 HttpOnly Cookie 传递 setup_id。
6. Run 只有 running、success、failed。
7. 任一来源成功即 Run success，来源错误留在内部。
8. Telegram 失败只影响 Notification，不把成功 Run 改成失败。
9. UI 使用 shadcn/ui + Tailwind + Lucide，并严格参照已确认原型。
10. 表单使用 React Hook Form + Zod，服务端对所有输入再次校验。
11. Dashboard 是跨 Radar 概览，`/radars` 是完整列表，`/radars/[id]` 是单个 Radar 详情。
12. Telegram 通知采用 at-most-once；unknown 状态不自动重发。
13. Vercel 部署后必须真实执行 setWebhook 和 `/start` 回调 Smoke Test。

下一步根据这份已确认的技术设计编写按任务和时间拆分的实施计划；仍不会在计划完成前写正式应用代码。
