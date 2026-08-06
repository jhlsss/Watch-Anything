# Landing UI Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the landing page with the approved `landing-combined-v3` prototype at desktop and 390px mobile widths without changing backend flows.

**Architecture:** Keep `Home` responsible for page composition and request persistence, `Hero` responsible for the interactive hero request and phone preview, and `SiteHeader` responsible for shared responsive navigation. Add only localized preview copy and use existing Lucide icons; keep all Rules/Auth/API boundaries untouched.

**Tech Stack:** Next.js 16.3 App Router, React 19, TypeScript, Tailwind CSS v4, Lucide React, Vitest, Testing Library, in-app browser QA.

## Global Constraints

- Preserve existing `request` query encoding and localStorage flow from Landing to Rules.
- Keep the empty hero CTA on `/` and show the existing localized required-field alert.
- Use the existing `en.ts` and `zh-CN.ts` message modules for visible copy.
- Do not modify Rules, Auth, Supabase, monitoring, Telegram API, or unrelated existing working-tree changes.
- Use existing Lucide icons and Tailwind classes; add no dependencies and do not copy prototype JavaScript.
- Verify at `1280 × 900` and `390 × 844`; the mobile page must not overflow horizontally.

---

### Task 1: Add landing UI regression assertions first

**Files:**
- Modify: `src/components/landing/hero.test.tsx`
- Modify: `src/app/page.test.tsx`

**Interfaces:**
- Consumes: current `Hero` and `Home` render contracts.
- Produces: failing assertions for the portrait preview, highlighted headline, compact Proof row, home anchor CTA, bottom CTA validation, and locale attribute.

- [ ] **Step 1: Add Hero structure assertions**

Extend the existing Hero test render with the current English landing copy and assert the rendered page contains `matters.`, `Watch Anything`, `bot`, both preview finding messages, and the green-reply copy. Assert the `matters.` node has the violet text class. Update the page-test import to include `fireEvent` before using the bottom CTA interaction.

```tsx
it("renders the prototype phone preview and highlighted headline", () => {
  render(
    <Hero
      locale="en"
      title="Never miss what matters."
      kicker="Your AI radar"
      description="Track useful updates."
      inputPlaceholder="What would you like to monitor?"
      primaryCta="Build my radar"
      helper="Preview first."
      examples={[]}
    />,
  );

  expect(screen.getByText("matters.")).toHaveClass("text-violet-600");
  expect(screen.getByText("Watch Anything")).toBeTruthy();
  expect(screen.getByText("bot")).toBeTruthy();
  expect(screen.getByText("LISA announced a new single releasing this September.")).toBeTruthy();
  expect(screen.getByText("A new API model was added to the official documentation.")).toBeTruthy();
  expect(screen.getByText("No other important updates today.")).toBeTruthy();
});
```

- [ ] **Step 2: Add Home structure and CTA assertions**

Keep the existing distinct-template and footer assertions, then assert the Proof section renders one compact `New single announcement` row, the home header's `Get started` href contains `#hero-request`, and the bottom `Preview my radar` stays invalid when its input is empty but includes an encoded request after typing.

```tsx
it("keeps the bottom CTA on the same request contract as the hero", () => {
  render(<Home searchParams={fulfilledSearchParams as never} />);

  const previewLink = screen.getByRole("link", { name: "Preview my radar" });
  fireEvent.click(previewLink);
  expect(screen.getAllByRole("alert").at(-1)?.textContent).toContain(
    "Tell us what you would like to monitor.",
  );

  fireEvent.change(screen.getAllByRole("textbox")[1], {
    target: { value: "Track official OpenAI model releases" },
  });
  expect(previewLink.getAttribute("href")).toContain(
    "request=Track%20official%20OpenAI%20model%20releases",
  );
});
```

- [ ] **Step 3: Run the focused tests and confirm the new assertions fail for the current UI**

Run:

```bash
pnpm vitest run src/components/landing/hero.test.tsx src/app/page.test.tsx
```

Expected: FAIL because the current Hero has a horizontal preview and no Telegram content, the headline has no highlighted span, the Proof section has no compact title row, and the bottom CTA has no validation state.

### Task 2: Implement the portrait Hero and localized preview data

**Files:**
- Modify: `src/components/landing/hero.tsx`
- Modify: `src/lib/i18n/messages/en.ts`
- Modify: `src/lib/i18n/messages/zh-CN.ts`

**Interfaces:**
- Consumes: `Locale`, `getMessages`, existing `HeroProps`, and localized `proofFindings`.
- Produces: a responsive portrait preview with the same existing Hero CTA behavior.

- [ ] **Step 1: Add only the missing preview copy to both message modules**

Add `previewBotLabel`, `proofFindingTitle`, `proofFindingMeta`, and `proofFindingScore` under `landing`. Use English values `bot`, `New single announcement`, `Official source · Found 8 minutes ago`, and `91 / 100`; use Chinese equivalents under `zh-CN`.

- [ ] **Step 2: Replace the horizontal Hero preview with a portrait phone**

Keep the existing input/error/link block. Render the title with a line break and violet second phrase, then render a `310px × 525px` desktop phone that becomes `285px` wide below 560px. Use `Signal`, `Wifi`, `BatteryFull`, `Send`, `Bell`, `Building2`, and `ArrowUpRight` with `aria-hidden` where decorative. Map the two localized `proofFindings` into Telegram-style messages and finish with the localized bot reply.

- [ ] **Step 3: Match the prototype hero geometry**

Set the desktop grid to two columns with a `610px` minimum section height, `52px` column gap, and the existing violet orb. Keep a single-column mobile layout and constrain all children with `min-w-0` so the 390px viewport cannot create horizontal overflow.

- [ ] **Step 4: Run the Hero tests and confirm they pass**

Run:

```bash
pnpm vitest run src/components/landing/hero.test.tsx
```

Expected: all Hero tests PASS with no console warnings.

### Task 3: Align page sections, CTA behavior, and document locale

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/app/page.test.tsx`

**Interfaces:**
- Consumes: the updated `Hero`, `getMessages`, and current template request tuples.
- Produces: prototype-aligned Proof/Flow/Templates/CTA sections and a consistent request link contract.

- [ ] **Step 1: Add compact Proof finding presentation**

Render the localized `proofFindingTitle`, `proofFindingMeta`, and `proofFindingScore` in one icon row. Keep the four metric tiles and light violet section background; remove the two large article cards from this section.

- [ ] **Step 2: Add flow connector circles and template icons**

Keep three stages and two connector icons. Give each connector a circular border/background treatment and keep it hidden below the desktop breakpoint. Map the four template indexes to `Sparkles`, `Building2`, `Radio`, and `BriefcaseBusiness`, while preserving the four encoded `request` values.

- [ ] **Step 3: Make the home header and bottom CTA match the prototype contract**

Pass `/#hero-request` as the home `primaryAction` href. Add `id="hero-request"` to the Hero request wrapper. Track the bottom CTA input and error state in `Home`; prevent an empty link click, render the same localized required message, and include the trimmed request in the `/rules?lang=...&request=...` href when present.

- [ ] **Step 4: Use the prototype content rail and update the document language**

Replace the page's repeated `max-w-6xl`/`max-w-5xl` wrappers with a 1160px rail and 28px mobile/44px desktop gutters. Add a client effect that sets `document.documentElement.lang` to `zh-CN` or `en` from the resolved landing locale.

- [ ] **Step 5: Make the new page assertions pass**

Run:

```bash
pnpm vitest run src/app/page.test.tsx src/components/landing/hero.test.tsx
```

Expected: all landing tests PASS, including compact Proof, bottom CTA validation, template requests, footer, and Hero preview behavior.

### Task 4: Fix shared header mobile geometry and run the focused regression suite

**Files:**
- Modify: `src/components/layout/site-header.tsx`
- Modify: `src/components/layout/site-header.test.tsx` only if the responsive contract needs a stable assertion.

**Interfaces:**
- Consumes: existing `SiteHeaderProps` and locale-aware link helper.
- Produces: one-row mobile brand/locale/primary-action layout without changing route generation.

- [ ] **Step 1: Reduce mobile header spacing without changing desktop navigation**

Use `flex-nowrap`, smaller mobile padding/gaps, and a smaller brand mark/font below the `sm` breakpoint; retain the current desktop nav visibility breakpoint and all link hrefs.

- [ ] **Step 2: Run the shared header and landing tests**

Run:

```bash
pnpm vitest run src/components/layout/site-header.test.tsx src/components/landing/hero.test.tsx src/app/page.test.tsx
```

Expected: PASS with the locale-before-hash assertion unchanged.

### Task 5: Browser visual QA and repository verification

**Files:**
- No additional production files unless a fresh verification failure maps directly to the acceptance criteria above.

- [ ] **Step 1: Run the full automated verification**

Run each command and inspect its exit code/output:

```bash
pnpm test
pnpm lint
pnpm build
git diff --check
```

- [ ] **Step 2: Re-run the browser QA at desktop size**

At `http://localhost:3000/?lang=en` with a `1280 × 900` viewport, verify the portrait phone, title accent, compact Proof row, circular flow connectors, template icons, full-width CTA, anchor links, empty/non-empty hero CTA, empty/non-empty bottom CTA, and zero console errors.

- [ ] **Step 3: Re-run the browser QA at mobile size**

At `390 × 844`, verify the header stays on one row, the portrait phone is contained, all section cards fit the viewport, `document.documentElement.scrollWidth === document.body.scrollWidth`, and no horizontal scrollbar appears.

- [ ] **Step 4: Review scope and working tree**

Confirm the production diff is limited to landing/header/i18n files, the committed design document, and the implementation plan; preserve all pre-existing unrelated modifications and untracked artifacts.
