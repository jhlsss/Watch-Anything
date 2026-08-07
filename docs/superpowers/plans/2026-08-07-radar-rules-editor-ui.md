# Radar Rules Editor UI Implementation Plan

> **For agentic workers:** Implement this plan task-by-task in the current checkout. Do not create a branch.

**Goal:** Move Radar rule editing into the monitoring-rules card so users edit the same rule context they are viewing.

**Architecture:** Keep the existing `RadarActions` client component and PATCH API. Split its rendered UI into top-level Radar actions plus an in-card rule editor/summary, using the existing validation and request state. `RadarDetailPage` continues to provide real rule data; no API or database changes are needed.

**Tech Stack:** Next.js 16 App Router, React, TypeScript, Tailwind CSS, Vitest, Testing Library.

## Global Constraints

- Do not change the Radar API contract or Supabase authentication.
- Preserve English and Simplified Chinese copy.
- Keep desktop rules sticky and mobile rules stacked after findings.
- Preserve validation: name 2–80 characters, include 1–8 topics, exclude 0–8 topics, each topic 1–60 characters.
- Use existing Tailwind utilities and no new dependencies.

### Task 1: Lock the in-card editor behavior with tests

**Files:**
- Create: `src/components/radar/radar-rules-card.test.tsx`

- [x] **Step 1: Add failing tests** for the default rule summary, in-card `编辑规则/Edit rules` entry, opening the editor with current values, validation errors, save payload/success, save failure retention, and cancel without a request.
- [x] **Step 2: Run `pnpm exec vitest run src/components/radar/radar-rules-card.test.tsx`** and confirm failure is caused by the missing in-card editor behavior.

### Task 2: Move rule editing into the rules card

**Files:**
- Modify: `src/components/radar/radar-actions.tsx`
- Create: `src/components/radar/radar-rules-card.tsx`
- Modify: `src/app/radars/[id]/page.tsx`

- [x] **Step 1: Create `RadarRulesCard` with props for locale, `radarId`, `rules`, and the localized summary labels; it owns editing state, initializes from the provided rules, and renders summary vs edit mode.
- [x] **Step 2: Move the existing validation and PATCH payload into `RadarRulesCard`, preserving `update_rules`, `radarName`, `includeTopics`, and `excludeTopics`.
- [x] **Step 3: Remove the top-level edit button, edit state, and inline form** from `RadarActions`; keep only pause/resume and check-now actions there.
- [x] **Step 4: Add `RadarRulesCard` to the detail page's sticky rules aside and pass the existing `rules` values plus localized summary labels.
- [x] **Step 5: Reuse the existing PATCH request, validation, loading state, error handling, and router refresh behavior.** Successful saves close the editor; failed saves keep it open.
- [x] **Step 6: Keep the rules card responsive** with 40px-plus controls and wrapped action buttons on narrow screens.
- [x] **Step 7: Run `pnpm exec vitest run src/components/radar/radar-rules-card.test.tsx src/components/radar/radar-card.test.tsx`** and confirm all editor and detail tests pass.

### Task 3: Full verification and commit

**Files:**
- No additional source files unless verification exposes a regression.

- [x] **Step 1: Run `pnpm exec vitest run --exclude '.worktrees/**'` and confirm all project test files pass.**
- [x] **Step 2: Run `pnpm exec eslint --ignore-pattern '.worktrees/**'` and `pnpm build`.**
- [x] **Step 3: Run `git diff --check` and inspect the final diff for unrelated changes.**
- [x] **Step 4: Commit the implementation on `main`:**

```bash
git add src docs/superpowers/plans/2026-08-07-radar-rules-editor-ui.md
git commit -m "feat: move radar rules editing into card"
```
