# Watch Anything MVP Design

## 1. Goal and success criteria

Watch Anything is a small SaaS product that turns a user's natural-language monitoring request into explicit rules, checks public information on a schedule, and sends important new findings through Telegram. The delivery plan assumes one junior developer, four days, and a hard cash budget of no more than CNY 50.

The four-day MVP succeeds when a reviewer can complete this real loop:

1. Enter a monitoring request without signing in.
2. Let AI generate an editable rules draft.
3. Sign up or log in, then restore the confirmed draft.
4. Connect the shared Telegram bot.
5. Create the Radar only after both requirements are complete.
6. Trigger or wait for a real monitoring run.
7. See the run history and receive a relevant, deduplicated Telegram alert.

The reference demo is a “LISA Official Radar.” It includes new music, tours, important brand partnerships, and official announcements. It excludes rumours, fan speculation, old news, and repeated reports.

## 2. Deliberate MVP boundaries

The MVP does not promise direct or complete coverage of Instagram, X, WeChat, or other closed platforms. The must-ship LISA path uses Tavily web search plus one fixed RSS feed resolved from a small server-configured allowlist. Users cannot submit arbitrary RSS or webpage URLs in the four-day build. Direct social-platform integrations, arbitrary fetching, billing, teams, exports, complex bot conversations, custom domains, Redis, and a separate job queue are out of scope.

Starter templates are lightweight. Selecting one only prefills the initial monitoring request; it does not create a separate backend workflow.

One Telegram bot serves every user. The four-day build supports `/start` account binding, `/help`, and outbound alerts only; management stays on the website. The demo limits each account to one active Radar and the deployment to three active Radars overall.

## 3. User experience

### 3.1 Landing page

The hero keeps the approved two-column composition: a clear promise and request input on the left, and a crisp HTML/CSS Telegram phone mockup on the right. The logo is an SVG shared by the header and footer. Functional icons use one outline SVG family; emojis are not used as interface icons.

All landing calls to action converge on the same creation Step 1. `Get started` focuses the hero request input rather than forcing authentication. The header `Log in` button opens the shared Auth page in login mode and returns a successful user to the Radar workspace. After authentication, the header shows an account menu and Dashboard entry. Template cards prefill the hero input. Below the hero, the page shows operational proof, a four-step explanation, templates, and a concise closing call to action.

### 3.2 Creation flow

The landing hero input is the entry to the three-step creation flow, not a separate preliminary step. Its value is saved locally and carried into the creation experience, so the user never re-enters the same request.

- **Step 1 — AI understands:** Clicking the hero or final CTA carries the existing request into an AI-processing state. It shows the original text, generating progress, failure, and retry. Failure never clears the draft. Guest previews are allowed before authentication and protected by the limits in Section 8.
- **Step 2 — Review rules:** The original request remains visible. Subject, included topics, exclusions, one generated search query, and importance threshold are editable. The LISA must-ship Radar includes one fixed RSS source from the server-configured allowlist. Source-trust policy, RSS source, and the six-hour interval are fixed MVP defaults and are labelled as such.
- **Step 3 — Register and connect Telegram:** The requirement page contains two separate cards, not embedded forms. The account card opens a dedicated Auth page where a new user can switch between Sign up and Log in; either successful path restores the draft and returns to Step 3. Only then does the Telegram card unlock. It opens a dedicated connection page showing the Bot identity, the one-time-link flow, the required `Start` action, waiting/failure states, and return confirmation. The final “Create Radar” action remains disabled until both account authentication and Telegram binding are verified server-side.

The confirmed rule draft may exist locally or be temporarily associated with the authenticated user, but it is not a Radar and cannot run. Creating the Radar writes `baseline_cutoff_at` and immediately starts the first silent baseline. Telegram is mandatory for this MVP, so there is no `Active · alerts off` state and no “Not now” path.

### 3.3 Dashboard and Radar detail

The post-login product has three deliberately small views rather than stopping at the Landing page:

- **Dashboard:** one-Radar overview showing Telegram connection, Radar status, the latest counts, and recent activity.
- **Radar detail:** current rules, next run, recent findings, and primary controls.
- **Run history:** each scheduled/manual execution, its status, counts, source failures, and notification result.

The Dashboard answers whether monitoring is active, whether Telegram is connected, what the latest run found, and what requires attention. A first-time state appears only after the required account and Telegram checks pass; it shows baseline progress, zero notifications, and the next scheduled action. Dashboard navigation opens the Radar detail, and the detail opens Run history; both provide a clear route back.

The Radar detail page exposes its current rules, next run, recent findings, and run history. A run records sources checked, candidates found, relevant findings, notifications sent, duration, and per-source failures. “Partial success” lists the specific failed source and reason while preserving successful results from other sources.

“Check now” has idle, loading, success, failure, and cooldown states. Pause/resume gives immediate visible confirmation.

### 3.4 Telegram behavior

The bot supports only `/start`, `/help`, and outbound notification delivery. Radar creation, editing, pausing, and resuming remain on the website.

The connection flow clearly shows unconnected, connecting, connected, and failed states. A signed-in user requests a one-time opaque binding token. The database stores only its hash, owner, expiration, and `used_at`. The website opens `https://t.me/<bot>?start=<token>`; the webhook atomically consumes the token and binds that private-chat `chat_id`. Tokens expire, cannot be replayed, and a `chat_id` belongs to only one website account. The webhook validates Telegram's secret-token header. Group binding is unsupported.

### 3.5 Authentication pages

Auth is a separate page from Step 3. It contains Sign up and Log in tabs, email/password fields, loading and clear retryable errors, plus a password-recovery entry for returning users. When Auth was entered from Radar creation, success returns to the saved draft rather than the Dashboard. The server revalidates the restored draft before proceeding. The MVP may disable email confirmation for the portfolio demo only if that choice is explicit in Supabase configuration and the README; otherwise the callback flow must include a “check your email” state.

There is only one Auth implementation. Entry context supplies the initial tab and validated return target:

- Header login: `/auth?mode=login&next=/dashboard`.
- Radar creation: `/auth?mode=signup&next=%2Fcreate%3Fstep%3D3%26draft%3D<opaque-id>`.

The server accepts only allowlisted internal return targets. If a creation draft exists, both sign-up and login return to the same Step 3 draft; neither path creates a Radar automatically. Step 3 derives its cards from server state: unauthenticated users complete Auth first; authenticated users with no Telegram binding see the account card completed and Telegram unlocked; users with both requirements verified see both cards completed and may create the Radar.

### 3.6 Language and responsive behavior

English and simplified Chinese are required for the core flow and use translation keys rather than runtime text replacement. Locale is persisted and applies to Landing, creation, Auth, Telegram connection, Dashboard, Radar detail, Run history, forms, and errors. Proper names and standard technical terms such as Watch Anything, LISA, OpenAI, AI, API, RSS, Radar, and Telegram remain unchanged where natural. Telegram notification copy may use the account locale if time permits; bilingual website UI must not depend on that stretch item.

Below 850 px, cards become one column, action groups wrap, the creation stepper becomes “Step N of 3,” and all containers remain within the viewport. A compact menu provides the same core destinations as desktop; a dedicated bottom navigation is optional. No core action may disappear without a mobile alternative. The acceptance size is 390 × 844 with no horizontal scrolling.

## 4. Technical architecture

Use a TypeScript modular monolith:

- Next.js App Router for pages and server endpoints.
- Tailwind CSS and a small component layer for the approved UI.
- Supabase Auth and PostgreSQL for authentication and persistence.
- Supabase Cron for the global scheduler.
- Tavily basic search plus one RSS source from a server-configured allowlist. User-supplied URL fetching is excluded.
- Groq `openai/gpt-oss-20b` as the primary structured-output model.
- A small provider interface permits a deployment-time switch to OpenRouter, but there is no automatic runtime fallback.
- Telegram Bot API webhook for one-time binding and notifications.
- Vercel for deployment using the free `vercel.app` address.

Internal modules have narrow responsibilities: authentication, Radar rules, source adapters, AI parsing/evaluation, monitoring pipeline, scheduler/run locking, and Telegram delivery. They remain in one deployable application to keep the MVP understandable and fast to ship.

## 5. Data model

Ordinary fields that the program frequently filters or updates remain normal PostgreSQL columns. Flexible AI-generated rule content lives in one validated `JSONB` field.

Core tables:

- `profiles`: user profile and locale.
- `radars`: owner, name, original prompt, status, interval, baseline cutoff, Tavily baseline completion, last/next check, lease expiry, attempt count, timestamps, and validated `rules JSONB`.
- `radar_sources`: allowlisted RSS source key, canonical URL, validation/baseline state, and last error. `(radar_id, source_key)` is unique. The server resolves keys to URLs; clients never choose a fetch target.
- `radar_runs`: Radar, trigger, start/end, status, stable error code, counts, `rules_snapshot JSONB`, and scheduler invocation id.
- `findings`: Radar, source/canonical URL, deterministic fingerprint, title, excerpt, published time, first/last seen, immutable `first_seen_during_baseline`, and source evidence. `(radar_id, fingerprint)` is unique.
- `run_findings`: links a finding to each run and stores that run's relevance, confidence, importance, decision, and explanation.
- `telegram_binding_tokens`: owner, token hash, expiry, and `used_at`.
- `telegram_connections`: user and Telegram private-chat `chat_id`; both are unique.
- `notifications`: finding, channel, destination, delivery state, provider message id, and timestamps. `(finding_id, channel, destination_id)` is unique.

The `rules` object stores subject, aliases, included topics, exclusions, one generated query, and evaluation threshold. The server validates it with Zod before saving. Database checks enforce valid statuses, score ranges, a minimum interval, required foreign keys, and deletion behavior. Due-Radar, Radar/run time, and finding-fingerprint indexes support the core queries. JSONB is used for rules iteration, not as a place to put the entire database.

## 6. Monitoring pipeline

One Supabase Cron job runs every 15 minutes and calls a secured Next.js endpoint using a secret stored in Supabase Vault. Each invocation atomically claims at most one due Radar with `FOR UPDATE SKIP LOCKED`, writes a 60-second `lease_expires_at`, and commits immediately; it never holds a database transaction while calling external services. Cron and manual runs use the same claim operation. Expired leases are reclaimable, attempts are capped, and every terminal outcome computes the next check. Each Radar defaults to six hours, with up to 15 minutes of scheduler delay.

For every claimed Radar:

1. Load and validate its rules and sources.
2. Run one Tavily basic query and fetch the selected allowlisted RSS feed independently, with short per-source and total-run timeouts.
3. Normalize candidates into one finding format.
4. Deduplicate deterministically using normalized canonical URL, or a hash of normalized title plus source domain when no URL exists. Semantic/embedding deduplication is excluded.
5. Apply deterministic checks for recency, exclusions, source trust, and prior notification.
6. Batch the remaining candidates for AI relevance, confidence, importance, and short explanation.
7. Save all decisions and evidence.
8. Notify only findings that pass the configured threshold and have not been delivered before.
9. Record the run as success, partial success, or failure, then schedule the next check.

Radar creation sets `baseline_cutoff_at = created_at` and `next_check_at = now()`. After the creation transaction commits, the client immediately calls the same authenticated run endpoint used by “Check now”; that endpoint atomically claims the due Radar and builds the baseline. If the browser closes or that request fails, the global Cron sees the still-due Radar and recovers it within its normal scheduling window. No separate queue is required. The baseline saves observations and sends zero alerts even though Telegram is already connected.

Tavily and the fixed RSS source complete their baselines independently: `radars.tavily_baseline_completed_at` tracks Tavily, while `radar_sources.baseline_completed_at` tracks RSS. A partial first run marks only successful sources complete and retries the failed source later. Every finding first observed while its source is still establishing baseline is saved with immutable `first_seen_during_baseline = true` and can never become notification-eligible on a later run. Items with no published time follow the same rule; later novelty is based on `first_seen_at`. After baseline, “Check now” uses the same database claim and an atomic cooldown.

## 7. AI responsibilities and safeguards

AI performs two bounded tasks:

- Convert the user's request into a strict structured rules draft.
- Evaluate a batch of normalized candidates against those rules.

The application, not the model, owns scheduling, fetching, deduplication, validation, thresholds, persistence, and delivery. Groq uses strict JSON Schema output: every field is required, nullable values are explicit, and objects reject additional properties. Zod adds runtime and business validation. One repair retry is allowed only for semantic validation failure using the deployment-time configured provider; schema failures are not blindly repeated. Candidate evaluation is capped at 10 items per run and 1,500 input characters per item.

Prompt inputs include only the monitoring rules and the minimum candidate text required for evaluation. API keys remain server-side. Model/provider limits and failures are logged without exposing secrets. The provider is selected once through deployment configuration; there is no per-request or automatic runtime fallback.

## 8. Error handling and trust

Source adapters fail independently. One broken RSS feed produces partial success rather than discarding other results. If every source fails, the run fails. AI failure saves candidates as `evaluation_failed` and never notifies. Telegram failure does not fail the monitoring run; it creates a failed notification that may be retried without refetching. A database failure does not advance the schedule and is recovered after the lease expires. Stable error codes accompany human-readable messages.

Before sending Telegram, the server inserts the unique notification as `pending`, then updates it to `sent` or `failed`. A retry reuses that record and cannot create a second logical delivery.

The selected RSS source shows available or temporarily unreachable states. Postgres-backed fixed-window limits protect guest AI previews and manual checks; guest keys combine a hashed IP with an anonymous cookie. The default limits are three guest previews per anonymous identity per UTC day, twenty guest previews globally per UTC day, one manual check per Radar per 30 minutes, three manual checks per user per UTC day, and six manual checks globally per UTC day. Daily external-call caps are thirty Tavily queries and thirty model calls across the deployment. Active Radars remain capped at three globally.

A Postgres quota row keyed by UTC date and resource is atomically checked and incremented before each external call; a rejected reservation makes no provider request. Counters reset at 00:00 UTC. A failed scheduled run receives at most one retry after 15 minutes; after two total attempts it records failure and returns to its normal six-hour schedule. Exceeding any cap stops external calls and returns a clear quota state. Service-role credentials exist only inside trusted server-only modules: the scheduler, Telegram webhook, and authenticated monitoring commands. Browsers never receive them. Ordinary user CRUD uses session identity and row-level security; privileged routes validate their caller and operate on a narrowly scoped Radar or binding token.

Every notification links back to its source and to the finding detail. Importance and confidence are explained in plain language; they are decision aids, not claims that AI is infallible.

## 9. Verification strategy

Testing focuses on the core loop and expensive failure points:

- Unit tests for Zod validation, RSS/URL normalization, fingerprinting, thresholds, first/partial baseline, and new-source baseline behavior.
- Adapter tests using fixed Tavily/RSS fixtures rather than repeatedly spending external quota.
- Integration tests for concurrent Cron/Check-now claims, expired-lease recovery, repeated findings, and idempotent notifications.
- One end-to-end happy-path test from guest input through activation using mocked external providers.
- Telegram webhook tests cover missing secrets, expired/replayed binding tokens, and already-bound chats. RLS tests use two users and every user-owned table.
- Manual deployed smoke tests cover both sign-up and returning-user login, draft restoration, one real Tavily query, one RSS feed, baseline, one new finding, and one real Telegram message.
- Responsive checks at desktop and 390 px, plus English and simplified-Chinese copy checks across every core page.

## 10. Four-day scope freeze and implementation priority

The **must-ship freeze line** is one deployed LISA Radar: bilingual English/Chinese core UI, guest preview, email/password sign-up and login with draft restoration, one Tavily query plus one allowlisted RSS feed, deterministic deduplication, baseline, one-Radar Dashboard/detail/run history, Telegram one-time binding, one real notification, basic mobile usability, and the minimum RLS/idempotency/limit tests required to trust that path.

**Stretch only after the deployed loop passes:** localized Telegram notification copy, additional allowlisted RSS choices, templates beyond LISA, richer loading/error polish, extra automated tests, and presentation diagrams. Stretch work must never delay the real deployed smoke test.

1. **Vertical deployment probe:** deploy Next.js/Supabase immediately; verify one hard-coded LISA Tavily/RSS request and one Telegram webhook message on the real `vercel.app` URL. Choose email/password Auth, configure production/local callbacks, and explicitly decide whether email confirmation is disabled for the demo.
2. **Creation and persistence:** implement guest preview, draft recovery, strict AI rules, one-Radar CRUD, the responsive bilingual core flow, RLS, and database constraints.
3. **Monitoring:** implement one-Radar claim/lease, Tavily + RSS, deterministic fingerprints, baseline, evaluation, run history, and notification idempotency.
4. **Stabilize and present:** complete Telegram one-time binding, deployed smoke test, failure states, quota caps, README, environment template, three-minute demo script, and GitHub upload. Architecture/data-flow/state diagrams are stretch documentation.

If time becomes constrained, retain the real end-to-end LISA path and cut secondary polish. Do not replace the working pipeline with fake results. Before any interview, run the smoke checklist within 24 hours and keep a short recording as evidence if a free external service is temporarily unavailable.

## 11. Operational contracts

- The deployment is a personal portfolio/demo, not a commercial production service.
- Each run has a 45-second application budget; individual external calls target 5–8 seconds.
- One active Radar per user, three active Radars globally, one Tavily basic query and one fixed allowlisted RSS fetch per run, and explicit daily caps keep the service within free quotas. Automatic paid overage is disabled, and the implementation plan may not exceed the CNY 50 cash budget without new user approval.
- Supabase policies default to deny. Clients may not directly write Radar runs, sources, findings, observations, binding tokens, quota counters, or notifications. `radar_sources` insert/update/delete is server-only, and every write resolves a source key against the fixed server allowlist rather than accepting a client URL. The implementation plan must contain a per-table SELECT/INSERT/UPDATE/DELETE policy matrix.
- The scheduler records an invocation id; duplicate Cron calls are safe. Pause/resume recalculates `next_check_at`. Failed attempts use bounded retry/backoff.
- Telegram alerts state that importance/confidence indicate rule match, not guaranteed factual truth, and always link to source evidence.
- The README must document environment variables, provider selection, limits, known gaps, deployment steps, smoke test, and the demonstration script.

## 12. Prototype references

- Landing and three-step flow visual reference: `.superpowers/brainstorm/62653-1785776069/content/landing-combined-v3.html`
- The Landing reference also contains the shared Sign up / Log in Auth page and the dedicated Telegram connection page used by Step 3.
- Post-login Dashboard visual reference: `.superpowers/brainstorm/72782-1785830353/content/dashboard-create-flow-v1.html`
- Radar detail/run-history visual reference: `.superpowers/brainstorm/72782-1785830353/content/radar-detail-runs-v1.html`
- `.superpowers/brainstorm/72782-1785830353/content/watch-anything-canonical-v1.html` is a rejected exploration artifact. It may inform state logic but must not be used as a visual reference.
