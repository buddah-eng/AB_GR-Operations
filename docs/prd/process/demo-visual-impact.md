# Demo Visual Impact

> The demo must make a non-technical convention director say "I want this" within 30 seconds.
> Not "this is technically impressive" — "I want this for my convention." Visual polish,
> mobile responsiveness, AB branding authenticity, and the canvas "wow" moment are the
> difference between a prototype and a product.

---

## Overview

The demo audience is convention staff, not developers. They judge by: Does it look professional?
Can I use it on my phone? Does it feel like it was made for MY convention? The visual impact
protocol verifies these subjective qualities with concrete checks.

---

## Verification Steps

### 1. First Impression (30-Second Test)

Open the demo cold. In 30 seconds, can you answer:
- [ ] What is this? (Convention operations platform)
- [ ] Who is it for? (Anime Boston staff)
- [ ] What can I do here? (Manage guests, schedule, prep, staff)

If any answer is unclear, the hero/dashboard needs work.

### 2. AB Branding Authenticity

- [ ] Blue (#4A90C4) + orange (#E8962D) palette is visible and dominant
- [ ] M PLUS 1 headers feel Japanese-inspired without being kitschy
- [ ] Convention name ("Anime Boston 2026") appears naturally, not forced
- [ ] Logo is present and appropriately sized
- [ ] The overall feel: professional anime convention, not generic SaaS
- [ ] Japanese guest names are culturally appropriate (not stereotypical)
- [ ] Event types match real anime convention activities

### 3. Mobile Responsiveness

Test at 375px (iPhone) and 390px (modern Android):
- [ ] Sidebar collapses to hamburger menu
- [ ] Dashboard cards stack vertically
- [ ] Tables scroll horizontally or switch to card layout
- [ ] Guest hub tabs are touch-friendly
- [ ] Schedule timeline is usable (scrollable, not squished)
- [ ] DemoBar tabs don't overflow
- [ ] Canvas view has mobile fallback or "best on desktop" message
- [ ] All touch targets are 44px minimum
- [ ] Text is readable without zooming

### 4. Navigation Completeness

Click every sidebar link and verify:
- [ ] Every page has data (no empty views with just "No records found")
- [ ] Every page has the AB branding applied
- [ ] Every page title uses M PLUS 1
- [ ] Back navigation works (breadcrumbs or browser back)
- [ ] Deep links work (guest hub, schedule event detail, etc.)
- [ ] Demo mode indicator is visible but unobtrusive

### 5. Dashboard Visual Quality

- [ ] Stat cards have clear hierarchy (number is dominant, label secondary)
- [ ] Status badges use consistent colors (green=good, amber=warning, red=critical)
- [ ] Progress bars show meaningful progress (not all 0% or all 100%)
- [ ] Action alerts draw attention without being alarming
- [ ] Schedule timeline is scannable (colored blocks, time labels, venue labels)

### 6. Canvas "Wow" Moment

The canvas walkthrough must be visually distinctive:
- [ ] Concept nodes are clean, labeled, color-coded by department
- [ ] Relationship edges are smooth bezier curves, not straight lines
- [ ] Workflow overlay animations are subtle (pulse, not flash)
- [ ] Data flow edges show direction (animated particles or arrows)
- [ ] PII indicators are visible (lock icons)
- [ ] Zooming in/out is smooth
- [ ] The graph layout is not a mess — nodes are grouped logically

### 7. Interaction Polish

- [ ] Hover states on all clickable elements
- [ ] Transitions between pages are smooth (not jarring full-reload)
- [ ] Loading states show skeleton or spinner (not blank page)
- [ ] Write operations show "Demo Mode" toast clearly
- [ ] Tab switching between time states animates the data change
- [ ] Form fields have focus rings

### 8. Typography Check

- [ ] M PLUS 1 is rendering (not falling back to system font)
- [ ] Lato is rendering for body text
- [ ] Headers are visibly different weight from body (Black vs Regular)
- [ ] No text is too small to read on mobile (<14px)
- [ ] No orphaned words or awkward line breaks on key headlines

---

## Acceptance Criteria

- [ ] 30-second test passes with a non-technical reviewer
- [ ] Mobile layout is usable at 375px width
- [ ] Every page has data and branding
- [ ] Canvas produces a visible positive reaction
- [ ] No loading jank, no unstyled flashes, no broken layouts
- [ ] Fonts are rendering correctly (M PLUS 1 + Lato)
- [ ] AB branding feels authentic, not generic
