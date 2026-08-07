# Remove Fixed Music RSS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop every Radar from fetching the fixed Music News feed and ensure positive, notified findings cannot be hidden behind irrelevant rows.

**Architecture:** Keep Tavily as the only active candidate source in `runRadar`. Use a forward Supabase migration to redefine Radar activation without a fixed RSS row and to remove fixed-feed data already stored. Apply positive-score predicates in Supabase before UI query limits, while retaining the render filter as a defensive guard.

**Tech Stack:** Next.js App Router, TypeScript, Vitest, Supabase/PostgreSQL, pnpm.

## Global Constraints

- Write failing tests before implementation.
- Do not rewrite prior migrations; add one forward migration.
- Do not add dynamic RSS discovery, source registries, or AI/Telegram behavior changes.
- Preserve run counters; show the persisted findings that produced notifications.
- Keep the change narrowly scoped to fixed RSS removal and findings consistency.

---

### Task 1: Lock the regressions with failing tests

**Files:**
- Modify: `src/lib/monitoring/run-radar.test.ts`
- Modify: `src/components/radar/radar-card.test.tsx`
- Modify: `src/lib/monitoring/monitoring-rpc.integration.test.ts`

**Interfaces:**
- Consumes: `runRadar(radarId, trigger, dependencies)` and the Supabase fluent query builder used by `RadarDetailPage`.
- Produces: Regression contracts that fail while fixed RSS can run, positive-score filters are absent, or the forward migration is missing.

- [ ] **Step 1: Make the fixed-RSS runtime test reproduce the production rule**

Change the existing OpenAI test rules so the exclusion term itself contains `music`:

```ts
searchQuery:
  "site:openai.com/blog OR site:openai.com/news (GPT OR ChatGPT OR API OR Model) -career -jobs -hiring -music",
```

Keep the assertion:

```ts
expect(fetchRss).not.toHaveBeenCalled();
```

- [ ] **Step 2: Add tracked positive-score query methods**

Extend the test query builder with the method used by Supabase:

```ts
type QueryBuilder = {
  select: () => QueryBuilder;
  eq: () => QueryBuilder;
  gt: (column: string, value: number) => QueryBuilder;
  order: () => QueryBuilder;
  in: () => QueryBuilder;
  limit: () => Promise<QueryResult>;
  maybeSingle: () => Promise<QueryResult>;
  then: Promise<QueryResult>["then"];
};
```

Default it to chaining in `makeQuery`, then add a Radar detail test that replaces `gt` with a spy and asserts:

```ts
expect(gtMock).toHaveBeenNthCalledWith(1, "relevance_score", 0);
expect(gtMock).toHaveBeenNthCalledWith(2, "importance_score", 0);
```

- [ ] **Step 3: Add the forward-migration contract**

Read `supabase/migrations/202608070010_remove_fixed_music_rss.sql`, normalize comments/whitespace, isolate the `create_radar_from_setup` body, and assert:

```ts
expect(setupBody).toContain(
  "jsonb_build_object('tavily', jsonb_build_object('baselinecompletedat', null))",
);
expect(setupBody).not.toContain("insert into public.radar_sources");
expect(migration).toContain(
  "delete from public.findings as finding where finding.source_type = 'rss' and finding.source_domain in ('music-news.com', 'www.music-news.com')",
);
expect(migration).toContain(
  "delete from public.radar_sources as source where source.source_key = 'music_news_rss'",
);
```

- [ ] **Step 4: Run the focused tests and confirm RED**

Run:

```bash
pnpm exec vitest run src/lib/monitoring/run-radar.test.ts src/components/radar/radar-card.test.tsx src/lib/monitoring/monitoring-rpc.integration.test.ts --exclude '.worktrees/**'
```

Expected: the OpenAI RSS spy is called, the detail query has no `gt` calls, and the `202608070010` migration file is missing.

### Task 2: Remove fixed RSS from the active monitoring path

**Files:**
- Modify: `src/lib/monitoring/run-radar.ts`

**Interfaces:**
- Consumes: `searchTavily({ query })`, candidate evaluation, finding persistence, and notification delivery.
- Produces: `runRadar` results whose candidate and source counts contain only Tavily data.

- [ ] **Step 1: Remove fixed-RSS imports and reads**

Delete imports of `fetchMusicNewsRss` and `shouldFetchMusicNewsRss`, remove `readSourceRow`, and remove `music_news_rss` from `SourceBaselineState`. Retain the optional `fetchRss` dependency temporarily for compatibility, but never read or invoke it.

- [ ] **Step 2: Fetch only Tavily**

Replace the two-source `Promise.all` with:

```ts
const tavilyCandidates = await withRunDeadline(
  fetchSource(
    "tavily",
    tavilyFetcher,
    persistOutcomes,
    sourceOutcomes,
    internalErrors,
  ),
  deadlineAt,
);
await withRunDeadline(sourcePersistence, deadlineAt);
const uniqueCandidates = Array.from(
  new Map(
    tavilyCandidates.map((candidate) => [candidateKey(candidate), candidate]),
  ).values(),
);
const sourceBaselineState: SourceBaselineState = {
  tavily: isSourceBaselineComplete(radar, "tavily", null),
};
```

Pass `sourceBaselineState.tavily` to `saveFinding` and make `markSourceBaselineComplete` update only the Tavily baseline.

- [ ] **Step 3: Run the monitoring test and confirm GREEN**

Run:

```bash
pnpm exec vitest run src/lib/monitoring/run-radar.test.ts --exclude '.worktrees/**'
```

Expected: all tests pass, including the production-shaped `-music` OpenAI rule, and no RSS fetch spy is called.

### Task 3: Filter visible findings before limiting rows

**Files:**
- Modify: `src/app/dashboard/page.tsx`
- Modify: `src/app/radars/[id]/page.tsx`
- Modify: `src/components/radar/radar-card.test.tsx`

**Interfaces:**
- Consumes: persisted `findings.relevance_score` and `findings.importance_score`.
- Produces: at most 3 Dashboard findings and 20 Radar-detail findings, selected only after both scores are positive.

- [ ] **Step 1: Add server-side predicates before ordering and limit**

In both finding queries, add the predicates before `.order(...)` and `.limit(...)`:

```ts
.gt("relevance_score", 0)
.gt("importance_score", 0)
```

Keep `FindingsList`'s existing positive-score filter unchanged as defense in depth.

- [ ] **Step 2: Run the UI test and confirm GREEN**

Run:

```bash
pnpm exec vitest run src/components/radar/radar-card.test.tsx --exclude '.worktrees/**'
```

Expected: the query spy sees both score predicates and all rendering tests pass.

### Task 4: Add the forward migration and cleanup

**Files:**
- Create: `supabase/migrations/202608070010_remove_fixed_music_rss.sql`
- Modify: `src/lib/monitoring/monitoring-rpc.integration.test.ts`

**Interfaces:**
- Consumes: the current `public.create_radar_from_setup(uuid, uuid, timestamptz)` signature and existing cascade foreign keys.
- Produces: idempotent Radar activation without fixed source rows, with existing fixed-source rows and candidates removed.

- [ ] **Step 1: Redefine Radar activation**

Copy the current function body from `202608070007_radar_creation_idempotency.sql`, preserving all locking, deadline, capacity, Telegram, and idempotency behavior. Replace the source state with exactly:

```sql
jsonb_build_object(
  'tavily', jsonb_build_object('baselineCompletedAt', null)
)
```

Remove the entire `insert into public.radar_sources` statement and preserve the existing revoke/grant statements for the three-argument function.

- [ ] **Step 2: Remove existing fixed-feed records**

Append cleanup in dependency-safe order:

```sql
delete from public.findings as finding
 where finding.source_type = 'rss'
   and finding.source_domain in ('music-news.com', 'www.music-news.com');

delete from public.radar_sources as source
 where source.source_key = 'music_news_rss';

update public.radars as radar
   set source_state = radar.source_state - 'music_news_rss',
       updated_at = timezone('utc', now())
 where radar.source_state ? 'music_news_rss';
```

- [ ] **Step 3: Run the migration contract test and confirm GREEN**

Run:

```bash
pnpm exec vitest run src/lib/monitoring/monitoring-rpc.integration.test.ts --exclude '.worktrees/**'
```

Expected: the forward migration contract passes and existing monitoring RPC contracts remain green.

### Task 5: Verify, commit, migrate, and re-check production

**Files:**
- Verify all files changed in Tasks 1-4.

**Interfaces:**
- Consumes: local implementation plus the linked production Supabase project.
- Produces: a committed fix and production evidence that fixed RSS data is gone while sent OpenAI findings remain visible.

- [ ] **Step 1: Run repository verification**

Run:

```bash
pnpm exec vitest run --exclude '.worktrees/**'
pnpm exec eslint src
pnpm build
git diff --check
```

Expected: tests, lint, build, and whitespace validation all pass.

- [ ] **Step 2: Commit the implementation**

```bash
git add src/lib/monitoring/run-radar.ts src/lib/monitoring/run-radar.test.ts src/app/dashboard/page.tsx 'src/app/radars/[id]/page.tsx' src/components/radar/radar-card.test.tsx src/lib/monitoring/monitoring-rpc.integration.test.ts supabase/migrations/202608070010_remove_fixed_music_rss.sql docs/superpowers/plans/2026-08-07-remove-fixed-music-rss.md
git commit -m "fix: remove fixed music RSS source"
```

- [ ] **Step 3: Apply the linked migration**

Run:

```bash
pnpm dlx supabase db push --linked --yes
```

Expected: migration `202608070010_remove_fixed_music_rss.sql` is applied successfully.

- [ ] **Step 4: Verify production data read-only**

Query production and require all of the following:

```sql
select count(*) from public.radar_sources where source_key = 'music_news_rss';
select count(*) from public.findings where source_type = 'rss' and source_domain in ('music-news.com', 'www.music-news.com');
select id, source_domain, relevance_score, importance_score, notification_eligible
from public.findings
where radar_id = '5590f336-e56d-43dc-b37d-619bfcb7b0e3'
  and relevance_score > 0
  and importance_score > 0
order by first_seen_at desc;
```

Expected: both fixed-RSS counts are `0`, and the two positive OpenAI findings remain.
