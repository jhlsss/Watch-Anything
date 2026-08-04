# Watch Anything MVP Design

## 1. Goal and success criteria

Watch Anything is a small SaaS product that turns a user's natural-language monitoring request into explicit rules, checks public information on a schedule, and sends important new findings through Telegram.

The four-day MVP succeeds when a reviewer can complete this real loop:

1. Enter a monitoring request without signing in.
2. Let AI generate an editable rules draft.
3. Register, save the draft, and activate a Radar.
4. Connect one shared Telegram bot.
5. Trigger or wait for a real monitoring run.
6. See the run history and receive a relevant, deduplicated Telegram alert.

The reference demo is a “LISA Official Radar.” It includes new music, tours, important brand partnerships, and official announcements. It excludes rumours, fan speculation, old news, and repeated reports.

## 2. Deliberate MVP boundaries

The MVP does not promise direct or complete coverage of Instagram, X, WeChat, or other closed platforms. It uses Tavily web search plus at most three public RSS feeds per Radar. User-specified arbitrary web-page scraping is excluded because safely handling private-network URLs, redirects, anti-bot pages, large responses, and prompt injection is not realistic in four days. Direct social-platform integrations, billing, teams, exports, complex bot conversations, custom domains, Redis, and a separate job queue are also out of scope.

Starter templates are lightweight. Selecting one only prefills the initial monitoring request; it does not create a separate backend workflow.

One Telegram bot serves every user. The four-day build supports `/start` account binding and outbound alerts only; management stays on the website. The demo limits each account to one active Radar and the deployment to three active Radars overall.

## 3. User experience

### 3.1 Landing page

The hero keeps the approved two-column composition: a clear promise and request input on the left, and a crisp HTML/CSS Telegram phone mockup on the right. The logo is an SVG shared by the header and footer. Functional icons use one outline SVG family; emojis are not used as interface icons.

All landing calls to action converge on the same creation Step 1. Template cards prefill that input. Below the hero, the page shows operational proof, a four-step explanation, templates, and a concise closing call to action.

### 3.2 Creation flow

The creation flow contains three steps:

- **Describe:** A guest enters a natural-language request. The page shows generating, failure, and retry states. Failure never clears the user's text. One guest preview is allowed before authentication and protected by rate limiting.
- **Review rules:** The original request remains visible. Subject, included topics, exclusions, one generated search query, optional RSS feeds, and importance threshold are editable. Source-trust policy and the six-hour interval are fixed MVP defaults and are labelled as such.
- **Activate:** Authentication is required only after the user has seen the preview. The draft is preserved locally during sign-up and restored after redirect. A Radar may be active without Telegram: it monitors and stores findings but cannot deliver alerts. The UI therefore distinguishes `Active · alerts off` from `Active · Telegram connected`. The first manual action is “Build baseline now,” not “Check now.”

### 3.3 Dashboard and Radar detail

The four-day UI combines the one-Radar overview and Radar detail rather than maintaining two overlapping information architectures. It answers whether monitoring is active, whether Telegram can receive alerts, what the latest run found, and what requires attention. A first-time state shows the restored Radar, baseline progress, zero notifications, and the next action.

The Radar detail page exposes its current rules, next run, recent findings, and run history. A run records sources checked, candidates found, relevant findings, notifications sent, duration, and per-source failures. “Partial success” lists the specific failed source and reason while preserving successful results from other sources.

“Check now” has idle, loading, success, failure, and cooldown states. Pause/resume gives immediate visible confirmation.

### 3.4 Telegram behavior

The bot supports only `/start`, `/help`, and outbound notification delivery. Radar creation, editing, pausing, and resuming remain on the website.

The connection flow clearly shows unconnected, connecting, connected, and failed states. A signed-in user requests a one-time opaque binding token. The database stores only its hash, owner, expiration, and `used_at`. The website opens `https://t.me/<bot>?start=<token>`; the webhook atomically consumes the token and binds that private-chat `chat_id`. Tokens expire, cannot be replayed, and a `chat_id` belongs to only one website account. The webhook validates Telegram's secret-token header. Group binding is unsupported.

### 3.5 Language and responsive behavior

English and simplified Chinese use translation keys rather than runtime text replacement. Locale is persisted and applies to navigation, forms, errors, and Telegram notifications. Proper names and standard technical terms such as Watch Anything, LISA, OpenAI, AI, API, RSS, and Telegram remain unchanged where natural.

Below 850 px, cards become one column, action groups wrap, the creation stepper becomes “Step N of 3,” and all containers remain within the viewport. A compact menu provides the same core destinations as desktop; a dedicated bottom navigation is optional. No core action may disappear without a mobile alternative. The acceptance size is 390 × 844 with no horizontal scrolling.

## 4. Technical architecture

Use a TypeScript modular monolith:

- Next.js App Router for pages and server endpoints.
- Tailwind CSS and a small component layer for the approved UI.
- Supabase Auth and PostgreSQL for authentication and persistence.
- Supabase Cron for the global scheduler.
- Tavily basic search plus public RSS feeds. Arbitrary web-page fetching is excluded.
- Groq `openai/gpt-oss-20b` as the primary structured-output model.
- A small provider interface permits a deployment-time switch to OpenRouter, but there is no automatic runtime fallback.
- Telegram Bot API webhook for one-time binding and notifications.
- Vercel for deployment using the free `vercel.app` address.

Internal modules have narrow responsibilities: authentication, Radar rules, source adapters, AI parsing/evaluation, monitoring pipeline, scheduler/run locking, and Telegram delivery. They remain in one deployable application to keep the MVP understandable and fast to ship.

## 5. Data model

Ordinary fields that the program frequently filters or updates remain normal PostgreSQL columns. Flexible AI-generated rule content lives in one validated `JSONB` field.

Core tables:

- `profiles`: user profile and locale.
- `radars`: owner, name, original prompt, status, interval, baseline cutoff, last/next check, lease expiry, attempt count, timestamps, and validated `rules JSONB`.
- `radar_sources`: RSS URL, normalized URL, validation/baseline state, and last error. `(radar_id, normalized_url)` is unique.
- `radar_runs`: Radar, trigger, start/end, status, stable error code, counts, `rules_snapshot JSONB`, and scheduler invocation id.
- `findings`: Radar, source/canonical URL, deterministic fingerprint, title, excerpt, published time, first/last seen, and source evidence. `(radar_id, fingerprint)` is unique.
- `run_findings`: links a finding to each run and stores that run's relevance, confidence, importance, decision, and explanation.
- `telegram_binding_tokens`: owner, token hash, expiry, and `used_at`.
- `telegram_connections`: user and Telegram private-chat `chat_id`; both are unique.
- `notifications`: finding, channel, destination, delivery state, provider message id, and timestamps. `(finding_id, channel, destination_id)` is unique.

The `rules` object stores subject, aliases, included topics, exclusions, one generated query, and evaluation threshold. The server validates it with Zod before saving. Database checks enforce valid statuses, score ranges, a minimum interval, required foreign keys, and deletion behavior. Due-Radar, Radar/run time, and finding-fingerprint indexes support the core queries. JSONB is used for rules iteration, not as a place to put the entire database.

## 6. Monitoring pipeline

One Supabase Cron job runs every 15 minutes and calls a secured Next.js endpoint using a secret stored in Supabase Vault. Each invocation atomically claims at most one due Radar with `FOR UPDATE SKIP LOCKED`, writes a 60-second `lease_expires_at`, and commits immediately; it never holds a database transaction while calling external services. Cron and manual runs use the same claim operation. Expired leases are reclaimable, attempts are capped, and every terminal outcome computes the next check. Each Radar defaults to six hours, with up to 15 minutes of scheduler delay.

For every claimed Radar:

1. Load and validate its rules and sources.
2. Run one Tavily basic query and fetch validated RSS feeds independently, with short per-source and total-run timeouts.
3. Normalize candidates into one finding format.
4. Deduplicate deterministically using normalized canonical URL, or a hash of normalized title plus source domain when no URL exists. Semantic/embedding deduplication is excluded.
5. Apply deterministic checks for recency, exclusions, source trust, and prior notification.
6. Batch the remaining candidates for AI relevance, confidence, importance, and short explanation.
7. Save all decisions and evidence.
8. Notify only findings that pass the configured threshold and have not been delivered before.
9. Record the run as success, partial success, or failure, then schedule the next check.

Activation sets `baseline_cutoff_at = activated_at`. The first run saves observations and sends zero alerts, regardless of Telegram state. Each RSS source records its own `baseline_completed_at`; a newly added source silently establishes its own baseline. A partial first run completes the baseline only for successful sources, while failed sources retry later. Items with no published time are silent during baseline; later novelty is based on `first_seen_at`. After baseline, “Check now” uses the same database claim and an atomic cooldown.

## 7. AI responsibilities and safeguards

AI performs two bounded tasks:

- Convert the user's request into a strict structured rules draft.
- Evaluate a batch of normalized candidates against those rules.

The application, not the model, owns scheduling, fetching, deduplication, validation, thresholds, persistence, and delivery. Groq uses strict JSON Schema output: every field is required, nullable values are explicit, and objects reject additional properties. Zod adds runtime and business validation. Repair retry is reserved for semantic validation failure or a manually selected fallback provider, not blindly repeated schema failures. Candidate evaluation is capped at 10 items per run and 1,500 input characters per item.

Prompt inputs include only the monitoring rules and the minimum candidate text required for evaluation. API keys remain server-side. Model/provider limits and failures are logged without exposing secrets.

## 8. Error handling and trust

Source adapters fail independently. One broken RSS feed produces partial success rather than discarding other results. If every source fails, the run fails. AI failure saves candidates as `evaluation_failed` and never notifies. Telegram failure does not fail the monitoring run; it creates a failed notification that may be retried without refetching. A database failure does not advance the schedule and is recovered after the lease expires. Stable error codes accompany human-readable messages.

Before sending Telegram, the server inserts the unique notification as `pending`, then updates it to `sent` or `failed`. A retry reuses that record and cannot create a second logical delivery.

RSS inputs are validated before activation and show valid, unsupported, or unreachable states. Postgres-backed fixed-window limits protect guest AI previews and manual checks; guest keys combine a hashed IP with an anonymous cookie. Limits are enforced server-side. Daily hard caps cover Tavily searches, model calls, active Radars, and manual checks; exceeding a cap stops external calls and returns a clear quota state. Service-role credentials exist only in the scheduler module, while user CRUD uses session identity and row-level security.

Every notification links back to its source and to the finding detail. Importance and confidence are explained in plain language; they are decision aids, not claims that AI is infallible.

## 9. Verification strategy

Testing focuses on the core loop and expensive failure points:

- Unit tests for Zod validation, RSS/URL normalization, fingerprinting, thresholds, first/partial baseline, and new-source baseline behavior.
- Adapter tests using fixed Tavily/RSS fixtures rather than repeatedly spending external quota.
- Integration tests for concurrent Cron/Check-now claims, expired-lease recovery, repeated findings, and idempotent notifications.
- One end-to-end happy-path test from guest input through activation using mocked external providers.
- Telegram webhook tests cover missing secrets, expired/replayed binding tokens, and already-bound chats. RLS tests use two users and every user-owned table.
- Manual deployed smoke test covers registration, draft restoration, one real Tavily query, one RSS feed, baseline, one new finding, and one real Telegram message.
- Responsive checks at desktop and 390 px, plus English/Chinese copy checks on the core flow.

## 10. Four-day implementation priority

1. **Vertical deployment probe:** deploy Next.js/Supabase immediately; verify one hard-coded LISA Tavily/RSS request and one Telegram webhook message on the real `vercel.app` URL. Choose email/password Auth, configure production/local callbacks, and explicitly decide whether email confirmation is disabled for the demo.
2. **Creation and persistence:** implement guest preview, draft recovery, strict AI rules, one-Radar CRUD, responsive bilingual core flow, RLS, and database constraints.
3. **Monitoring:** implement one-Radar claim/lease, Tavily + RSS, deterministic fingerprints, baseline, evaluation, run history, and notification idempotency.
4. **Stabilize and present:** complete Telegram one-time binding, deployed smoke test, failure states, quota caps, README, environment template, architecture/data-flow/state diagrams, three-minute demo script, and GitHub upload.

If time becomes constrained, retain the real end-to-end LISA path and cut secondary polish. Do not replace the working pipeline with fake results. Before any interview, run the smoke checklist within 24 hours and keep a short recording as evidence if a free external service is temporarily unavailable.

## 11. Operational contracts

- The deployment is a personal portfolio/demo, not a commercial production service.
- Each run has a 45-second application budget; individual external calls target 5–8 seconds.
- One active Radar per user, three active Radars globally, one Tavily basic query per run, and explicit daily caps keep the service within free quotas. Automatic paid overage is disabled.
- Supabase policies default to deny. Clients may not directly write runs, findings, observations, binding tokens, or notifications. The implementation plan must contain a per-table SELECT/INSERT/UPDATE/DELETE policy matrix.
- The scheduler records an invocation id; duplicate Cron calls are safe. Pause/resume recalculates `next_check_at`. Failed attempts use bounded retry/backoff.
- Telegram alerts state that importance/confidence indicate rule match, not guaranteed factual truth, and always link to source evidence.
- The README must document environment variables, provider selection, limits, known gaps, deployment steps, smoke test, and the demonstration script.

## 12. Prototype references

- Canonical implementation reference: `.superpowers/brainstorm/72782-1785830353/content/watch-anything-canonical-v1.html`
- Earlier HTML files are exploration artifacts only. If they conflict with the canonical prototype or this document, they are not requirements.
