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

The MVP does not promise direct or complete coverage of Instagram, X, WeChat, or other closed platforms. It uses web search, RSS feeds, and up to three user-specified public URLs. Direct social-platform integrations, billing, teams, exports, complex bot conversations, custom domains, Redis, and a separate job queue are out of scope.

Starter templates are lightweight. Selecting one only prefills the initial monitoring request; it does not create a separate backend workflow.

One Telegram bot serves every user and every Radar. Each website account is mapped to its Telegram `chat_id`; messages identify the Radar that produced the finding.

## 3. User experience

### 3.1 Landing page

The hero keeps the approved two-column composition: a clear promise and request input on the left, and a crisp HTML/CSS Telegram phone mockup on the right. The logo is an SVG shared by the header and footer. Functional icons use one outline SVG family; emojis are not used as interface icons.

All landing calls to action converge on the same creation Step 1. Template cards prefill that input. Below the hero, the page shows operational proof, a four-step explanation, templates, and a concise closing call to action.

### 3.2 Creation flow

The creation flow contains three steps:

- **Describe:** A guest enters a natural-language request. The page shows generating, failure, and retry states. Failure never clears the user's text. One guest preview is allowed before authentication and protected by rate limiting.
- **Review rules:** The original request remains visible. AI-generated subject, included topics, exclusions, trust preferences, search terms, optional URLs/RSS sources, interval, and importance threshold are editable. Plain-language help explains unfamiliar settings.
- **Activate:** Authentication is required only after the user has seen the preview. The draft is preserved locally during sign-up. The user may connect Telegram now or later, then activates the Radar. The first run is described as a baseline that will not flood Telegram with old news.

### 3.3 Dashboard and Radar detail

The Dashboard answers four questions quickly: which Radars exist, which are running, what they found, and whether Telegram can receive alerts. It includes a useful empty state for first-time users.

The Radar detail page exposes its current rules, next run, recent findings, and run history. A run records sources checked, candidates found, relevant findings, notifications sent, duration, and per-source failures. “Partial success” lists the specific failed source and reason while preserving successful results from other sources.

“Check now” has idle, loading, success, failure, and cooldown states. Pause/resume gives immediate visible confirmation.

### 3.4 Telegram behavior

The bot's main responsibility is delivery. It also supports a small command set: list Radars, pause a Radar, resume a Radar, and open the website to create a new Radar. Ordinary free-form requests are redirected to a prefilled website creation flow rather than starting a multi-turn bot conversation.

The connection flow clearly shows unconnected, connecting, connected, and failed states. It explains that the shared bot uses the chat only to deliver and control the user's Radars.

### 3.5 Language and responsive behavior

English and simplified Chinese use translation keys rather than runtime text replacement. Locale is persisted and applies to navigation, forms, errors, and Telegram notifications. Proper names and standard technical terms such as Watch Anything, LISA, OpenAI, AI, API, RSS, and Telegram remain unchanged where natural.

Below 850 px, desktop sidebars become a compact bottom navigation for Overview, Radars, and Settings. Secondary destinations appear in the header menu. Cards become one column and the creation stepper becomes a short “Step N of 3” label. No action may disappear without a mobile alternative.

## 4. Technical architecture

Use a TypeScript modular monolith:

- Next.js App Router for pages and server endpoints.
- Tailwind CSS and a small component layer for the approved UI.
- Supabase Auth and PostgreSQL for authentication and persistence.
- Supabase Cron for the global scheduler.
- Tavily for open-web search, plus RSS and public-page adapters.
- Groq `openai/gpt-oss-20b` as the primary structured-output model.
- OpenRouter `openai/gpt-oss-20b:free` as a manually configured fallback, not automatic multi-provider orchestration.
- Telegram Bot API for account binding, commands, and notifications.
- Vercel for deployment using the free `vercel.app` address.

Internal modules have narrow responsibilities: authentication, Radar rules, source adapters, AI parsing/evaluation, monitoring pipeline, scheduler/run locking, and Telegram delivery. They remain in one deployable application to keep the MVP understandable and fast to ship.

## 5. Data model

Ordinary fields that the program frequently filters or updates remain normal PostgreSQL columns. Flexible AI-generated rule content lives in one validated `JSONB` field.

Core tables:

- `profiles`: user profile and locale.
- `radars`: owner, name, original prompt, status, interval, last/next check times, timestamps, and `rules JSONB`.
- `radar_sources`: optional RSS feeds and public URLs, validation state, and last error.
- `radar_runs`: start/end times, status, counts, and error summary.
- `findings`: source URL, canonical URL/hash, title, excerpt, published time, relevance, confidence, importance score, decision, and linked run.
- `telegram_connections`: user, Telegram `chat_id`, connection state, and timestamps.
- `notifications`: finding, channel, delivery status, provider message id, and timestamps.

The `rules` object stores fields that may evolve together: subject, aliases, included topics, exclusions, generated queries, trust preferences, and evaluation threshold. The server validates this object with Zod before saving it. JSONB is used for iteration speed, not as a place to put the entire database.

## 6. Monitoring pipeline

One Supabase Cron job runs every 15 minutes and calls a secured Next.js endpoint. The endpoint claims due active Radars using a database lock so overlapping invocations cannot run the same Radar twice. Each Radar defaults to a six-hour interval.

For every claimed Radar:

1. Load and validate its rules and sources.
2. Query Tavily, fetch RSS feeds, and check selected public pages independently.
3. Normalize candidates into one finding format.
4. Canonicalize URLs and deduplicate by URL/hash and semantic similarity where needed.
5. Apply deterministic checks for recency, exclusions, source trust, and prior notification.
6. Batch the remaining candidates for AI relevance, confidence, importance, and short explanation.
7. Save all decisions and evidence.
8. Notify only findings that pass the configured threshold and have not been delivered before.
9. Record the run as success, partial success, or failure, then schedule the next check.

The first successful run establishes a baseline. It saves findings but does not automatically notify historical items. Manual “Check now” uses the same pipeline and respects a cooldown.

## 7. AI responsibilities and safeguards

AI performs two bounded tasks:

- Convert the user's request into a strict structured rules draft.
- Evaluate a batch of normalized candidates against those rules.

The application, not the model, owns scheduling, fetching, deduplication, validation, thresholds, persistence, and delivery. Every model response must match a strict JSON schema and pass Zod validation. Invalid output receives one repair attempt; a second failure produces a clear retryable error and keeps the user's draft.

Prompt inputs include only the monitoring rules and the minimum candidate text required for evaluation. API keys remain server-side. Model/provider limits and failures are logged without exposing secrets.

## 8. Error handling and trust

Source adapters fail independently. One broken RSS feed or blocked page produces partial success rather than discarding other results. A source detail shows the target, time, and failure reason.

Telegram delivery failures are saved and visible. They do not mark the finding as delivered. Retrying cannot create duplicate notifications because notification creation uses an idempotency constraint.

URL/RSS inputs are validated before activation and show actionable errors. Rate limits protect guest AI previews, manual checks, and bot commands. Database row-level security ensures users can access only their own Radars and associated records.

Every notification links back to its source and to the finding detail. Importance and confidence are explained in plain language; they are decision aids, not claims that AI is infallible.

## 9. Verification strategy

Testing focuses on the core loop and expensive failure points:

- Unit tests for Zod rule validation, URL normalization, deduplication, threshold decisions, and first-run baseline behavior.
- Adapter tests using fixed Tavily/RSS/page fixtures rather than repeatedly spending external quota.
- Integration tests for creating a Radar, claiming a due run, saving findings, and idempotent notification creation.
- One end-to-end happy-path test from guest input through activation using mocked external providers.
- Manual deployed smoke test with one real Tavily query, one RSS feed, one public URL, and one real Telegram message.
- Responsive checks at desktop and 390 px, plus English/Chinese copy checks on the core flow.

## 10. Four-day implementation priority

1. **Foundation:** Next.js, approved visual system, Supabase project, Auth, schema, bilingual shell, and guest draft preservation.
2. **Creation:** AI rule generation, validation, editable three-step flow, Radar CRUD, and Dashboard empty/active states.
3. **Monitoring:** source adapters, normalization, deduplication, AI evaluation, run history, global scheduler, and baseline behavior.
4. **Delivery and ship:** Telegram binding/delivery, deployed end-to-end test, responsive polish, failure states, README, environment template, and GitHub upload.

If time becomes constrained, retain the real end-to-end LISA path and cut secondary polish or commands. Do not replace the working pipeline with fake results.

## 11. Prototype references

- Landing page V3: `.superpowers/brainstorm/62653-1785776069/content/landing-combined-v3.html`
- Dashboard and rules review: `.superpowers/brainstorm/72782-1785830353/content/dashboard-create-flow-v1.html`
- Radar detail and run history: `.superpowers/brainstorm/72782-1785830353/content/radar-detail-runs-v1.html`
- Revised creation, activation, and mobile flow: `.superpowers/brainstorm/72782-1785830353/content/create-activation-flow-v2.html`
