# Backend Workspace UI Design

**Status:** Approved

**Date:** 2026-08-07

## Goal

把 Dashboard、My Radars、Radar 详情和 Telegram 连接页整理成一套统一、克制、适合真实数据的工作台 UI。原型用于确定信息层级和视觉方向，现有真实数据、认证状态、Telegram 绑定和 Radar 操作保持可用。

## Scope

In scope:

- 统一四个后台页面的桌面侧栏、移动底部导航、品牌、激活态和中文导航文案。
- 保留 Dashboard 的 Telegram 状态、运行统计、需要处理和重要发现区域，并改善响应式层级。
- 将 Radars 列表从展示型卡片网格调整为更像工作台的紧凑列表，同时保留整卡进入详情。
- 保留详情页当前真实 KPI、发现列表、运行历史、规则和 Telegram 状态；明确最近一次运行指标的语义，并让规则面板在桌面端更容易跟随查看。
- 整理 Telegram 连接页的按钮层级和等待状态，只有用户进入确认阶段后才显示等待提示，避免暴露 callback 等技术术语。
- 打通首页和后台的往返导航：后台左上角品牌回到首页；首页检测到已登录用户时显示账户入口和进入工作区入口。
- 保持英语和简体中文，保留已有链接、API、认证、Radar 状态操作、规则编辑和 Telegram 轮询行为。

Out of scope:

- 不新增原型中没有的 Overview 或 request 页面。
- 不重做 Supabase 认证、登录状态判断、Radar 创建流程或 Telegram 后端协议。
- 不改变首页未登录用户的登录、开始使用和模板流程。
- 不伪造原型中的 Candidates / Relevant 数据；详情 KPI 使用项目实际拥有的检查时间、运行结果和通知数据。
- 不增加与当前最多 3 个运行中 Radar 约束无关的筛选、批量操作或复杂菜单。

## Design direction

### One workspace shell

`AppSidebar` 是四个后台页面共用的壳层：桌面端使用深色侧栏，移动端使用固定底部导航。品牌入口回到公开首页，Radars 详情路径仍高亮“我的 Radars”。中文导航统一为“工作台 / 我的 Radars / Telegram”，产品名 `Radar` 和 `Telegram` 保持不翻译。

现有 `WorkspaceNavigation` 保留作为兼容适配器，内部复用 `AppSidebar`，避免重复维护两套导航样式。页面顶部的语言切换和当前页面操作继续留在页面内容中，避免导航组件承担业务操作。

### Dashboard

Dashboard 继续以真实工作区数据为中心：

1. 顶部显示问候语、语言切换、退出登录和新建 Radar。
2. Telegram 连接状态作为全宽状态条，未连接时使用连接 CTA，已连接时显示账号和管理入口。
3. 运行中 / 已暂停 / 需要处理使用轻量摘要条，不扩展成装饰性 KPI 矩阵。
4. 桌面端用“需要处理 + 最新重要发现”两栏，移动端按 Telegram 状态、需要处理、重要发现顺序堆叠。
5. 空状态和错误状态都保留明确下一步，不增加无实际信息的插画或渐变。

首页继续使用公开站点头部，但根据当前 Supabase 浏览器会话显示认证态：未登录显示登录 / 开始使用，已登录显示账户邮箱和“进入工作区”，两者都带当前语言参数并指向 `/dashboard`。

### My Radars

Radars 列表使用单列紧凑工作台列表。每个 Radar 保留名称、运行状态、关注主题、上次检查、下次检查和重要发现数；整行仍然是进入详情的链接。减少悬浮位移和装饰，让 1–3 个 Radar 更容易快速扫读。

### Radar detail

详情页保留当前页面结构，但提高语义和阅读顺序：

- 顶部保留返回、Radar 名称、创建时间、检查频率、状态和 Pause / Resume、Check now、Edit rules 操作。
- KPI 保留上次检查、下次检查、最近一次运行、已通知；最近一次运行显示为“相关 X / 候选 Y”，避免只显示 `X / Y`。
- 最新发现是主内容，运行历史是次级入口。
- 桌面端规则面板固定在视口上方附近，移动端仍排在最新发现之后并收紧间距，避免规则信息抢占首屏。
- Telegram 状态保留在规则面板下方，并根据已连接、未连接、查询失败显示对应 CTA 或错误信息。

### Telegram connection

Telegram 页使用统一工作台壳层，但内容保持聚焦式设置：

- 先说明官方 Bot 和三步操作。
- 首要操作是打开 Bot；确认按钮只负责进入等待确认。
- 初始准备状态不显示“等待验证”文案。
- 进入等待状态后显示“等待 Telegram 连接确认”类用户语言；隐藏 callback 等内部实现词。
- 继续保留返回规则页和真实轮询、激活 Radar 行为。

## Visual system

- 工作区背景使用浅灰 `slate-50`，内容面板使用白色、细边框和轻阴影。
- 深色侧栏保持 `slate-950`，激活态使用低对比度白色背景；移动底部导航保持白色并用淡紫色激活态。
- 紫色只用于主操作、激活态、状态链接和 Telegram 强调，不扩散到所有文字。
- 运行使用 emerald，暂停使用 slate，需处理使用 amber，错误使用 rose。
- 页面主操作和移动触控控件至少保持约 40–44px 高度。
- 使用现有 Tailwind utility，不新增依赖，不引入大面积渐变、装饰性图标墙或无功能卡片。

## Testing and acceptance

- 组件测试覆盖统一导航中文文案、嵌套路由激活态和 Telegram 初始/等待状态。
- 保持现有 Radar、Dashboard、认证、规则、Telegram API 测试通过。
- `pnpm exec vitest run`、`pnpm lint` 和 `pnpm build` 通过。
- 浏览器回归四个页面的英文/中文桌面端和 390px 左右移动端，确认无横向滚动、底部导航不遮挡内容、链接与 CTA 仍指向正确路由。

## Planned file changes

| File | Responsibility |
| --- | --- |
| `src/components/layout/app-sidebar.tsx` | 统一后台桌面侧栏、移动底部导航、品牌和激活态，品牌回首页。 |
| `src/components/radar/radar-actions.tsx` | 复用统一侧栏并调整语言切换控件尺寸，不改变 Radar API 行为。 |
| `src/lib/i18n/messages/en.ts` | 更新 Telegram 等待提示的用户语言。 |
| `src/lib/i18n/messages/zh-CN.ts` | 统一中文后台导航和 Telegram 等待提示。 |
| `src/components/radar/radar-card.tsx` | 将 Radar 卡片调整为紧凑工作台列表样式。 |
| `src/app/radars/page.tsx` | 使用单列列表布局并保留真实 Radar 数据。 |
| `src/app/radars/[id]/page.tsx` | 明确最近一次运行指标、优化规则面板和响应式层级。 |
| `src/components/telegram/connect-card.tsx` | 根据页面状态显示连接反馈，避免初始状态误导。 |
| `src/app/connect-telegram/page.tsx` | 传递真实连接状态文案并统一后台壳层。 |
| `src/components/layout/site-header.tsx` | 支持首页认证态账户入口和工作区 CTA。 |
| `src/app/page.tsx` | 读取当前浏览器 Supabase 会话并切换首页头部操作。 |
| `src/components/layout/page-props.test.tsx` | 覆盖统一壳层链接和嵌套 Radars 激活态。 |
| `src/components/layout/site-header.test.tsx` | 覆盖账户入口和工作区入口的语言化链接。 |
| `src/app/page.test.tsx` | 覆盖已登录首页头部状态。 |
| `src/components/radar/radar-card.test.tsx` | 更新中文导航断言并保持 Radar / Dashboard / detail 行为覆盖。 |
| `src/components/telegram/connect-card.test.tsx` | 覆盖 Telegram 初始不显示等待、等待状态显示反馈。 |
