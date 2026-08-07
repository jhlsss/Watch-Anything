# Remove Fixed Music RSS and Restore Finding Consistency

## Context

The generic Radar creation flow stores a `music_news_rss` source for every Radar. The runtime then decides whether to fetch that source by searching the generated rules for music keywords. An OpenAI Radar whose search query contains the exclusion term `-music` therefore still fetched 50 records from `www.music-news.com`.

The same run persisted 55 candidates. Its two relevant OpenAI findings ranked 51 and 54 by `first_seen_at`, while the Radar detail page fetched only the first 20 rows before filtering zero-score findings. This produced a successful run showing `Notified 2` while `Latest findings` appeared empty.

## Approved Scope

- Remove the fixed Music News RSS source from the generic monitoring pipeline.
- Keep Tavily as the monitoring source; do not add RSS discovery or topic classification.
- Add a forward-only migration that stops new Radar creation from inserting `music_news_rss` rows.
- In the same migration, remove existing fixed Music News source rows and findings originating from that fixed feed. Associated non-user-authored dependent rows may be removed through existing foreign-key cascades.
- Change finding queries so their limits apply after selecting positive relevance and importance scores. Keep the component-level filter as a defensive rendering guard.
- Do not alter run counters or fabricate findings. A run reporting notifications must expose those persisted positive-score findings in `Latest findings`.

## Implementation Shape

1. Write failing tests proving that a Radar run never invokes the fixed RSS fetcher and that the detail query cannot let zero-score rows consume the visible-result limit.
2. Simplify `runRadar` to fetch Tavily only and remove fixed-RSS baseline bookkeeping from the active path.
3. Add a new Supabase migration that redefines `create_radar_from_setup` without the fixed source insertion and cleans existing fixed-feed rows.
4. Filter Dashboard and Radar detail finding queries by positive relevance and importance before applying their limits.
5. Run targeted tests, the full test suite, lint, build, and a read-only production verification after applying the migration.

## Non-goals

- Dynamic RSS discovery.
- A configurable source registry.
- Changes to AI evaluation, notification eligibility, Telegram delivery, or run-history counting.
- Rewriting prior migrations.

## Acceptance Criteria

- New and existing Radars no longer have a `music_news_rss` source row.
- A run does not call or report the fixed RSS source and cannot persist new `music-news.com` candidates.
- Existing fixed-feed candidates are removed.
- The two already-sent OpenAI findings remain visible as positive-score findings unless explicitly removed for another valid reason.
- `Notified N` and `Latest findings` are no longer contradictory because irrelevant rows cannot occupy the query limit.
