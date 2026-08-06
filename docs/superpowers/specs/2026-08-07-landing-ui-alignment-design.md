# Landing UI Alignment Design

**Date:** 2026-08-07  
**Status:** Approved for implementation  
**Reference:** `.superpowers/brainstorm/79724-1785854240/content/landing-combined-v3.html`

## Goal

Bring the `/` landing page back in line with the approved `landing-combined-v3` prototype at desktop and 390px mobile widths while preserving the existing request-to-Rules navigation, empty-request validation, bilingual copy, and footer/template behavior.

## Scope

### Hero

- Keep the current `Hero` client component and its serializable props.
- Render the English headline as two lines with `matters.` in violet; render the Chinese headline as two lines with the second line emphasized.
- Replace the horizontal device card with the prototype's portrait phone: status row, Telegram bot header, two finding messages, source/score metadata, and the green bot reply.
- Reuse localized `proofFindings` data for the phone messages and add only the missing bot/header copy to the landing translations.
- Keep the existing input, example buttons, empty-request alert, and encoded `/rules?lang=...&request=...` link.

### Header and responsive shell

- Reduce mobile header spacing and disable wrapping so the brand, locale switcher, and primary CTA remain on one row at 390px.
- Point the home-page `Get started` action at the hero request area instead of an empty Rules page.
- Use a 1160px content rail with the prototype's narrow mobile gutters; retain the current header API for other routes.
- Synchronize the document language attribute when the landing locale changes.

### Proof section

- Preserve the existing light violet section and four metrics.
- Render one compact finding row matching the prototype, with an icon, short title/meta, and score; do not render two large article cards in this section.
- Keep detailed two-finding content in the phone preview so the product evidence remains visible above the fold.

### How it works and templates

- Keep the existing three-stage data and links.
- Give desktop stage connectors a circular border/background treatment; hide them on mobile.
- Add data-free Lucide icons to the four template cards while preserving each card's distinct request URL.

### Final CTA and verification

- Expand the CTA to the same 1160px rail as the other landing sections.
- Give the bottom request field the same required-field behavior and Rules link contract as the hero field.
- Verify desktop at `1280 × 900`, mobile at `390 × 844`, horizontal overflow, anchor navigation, empty/non-empty CTA behavior, locale copy, and browser console errors.

## Implementation boundaries

- Modify only landing/header/i18n tests and production files needed for the above behavior.
- Do not change Rules, Auth, Supabase, monitoring, Telegram APIs, or the pre-existing unrelated working-tree changes.
- Use Tailwind utility classes and existing Lucide icons; do not add dependencies or copy prototype JavaScript.
- Keep all visible English and Chinese text in the existing message modules.

## Alternatives considered

1. **Targeted Tailwind/i18n alignment (selected):** keeps the current component boundaries and request flow, minimizes regression surface, and directly maps each QA finding to a small change.
2. **Extract a new generic landing-section system:** would improve reuse but introduces a refactor unrelated to the visual QA and increases regression risk across the already-working flow.
3. **Embed or copy the prototype HTML:** would match pixels quickly but would duplicate behavior, bypass the app's i18n/router boundaries, and violate the project's implementation constraints.

## Acceptance criteria

- The hero uses a portrait phone preview with two findings and a bot reply at desktop and mobile widths.
- The hero headline, Proof row, flow connectors, template icons, CTA width, and mobile header match the approved prototype's visual hierarchy.
- Home-page primary and bottom CTAs stay on `/` with a localized required-field alert when empty and navigate to `/rules` with the entered request when non-empty.
- All four template cards retain distinct encoded requests.
- Chinese landing navigation updates the document language to `zh-CN`.
- Focused tests, full tests, lint, build, and browser screenshot QA provide fresh passing evidence.
