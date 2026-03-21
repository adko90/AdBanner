# Feature File — v2 (Enhanced)

## Metadata
- **Feature ID:** FF-MVP-FOOTER-SHAPE-001
- **Product:** Smart Banner Web App
- **Feature:** Footer Banner Shape System
- **Version:** v2.0
- **Status:** Implementation-ready
- **Audience:** Product, architecture, design, frontend, runtime engineering
- **Changelog:** v2 incorporates architect + engineer review findings (17 new requirements)

## Summary
Build a credible, testable footer-banner system that allows a publisher to configure visually distinctive banner shells in the UI and render them safely on real webpages. The MVP supports both **solid** and **liquid-glass** visual modes, allows **shape customization beyond a plain rectangle**, and preserves a disciplined **content safe zone** so the banner stays readable, tappable, and responsive on iPhone and MacBook browsers.

---

## Scope

### SCO-001 In Scope
- Footer-anchored banner system
- Shape-customizable visual shell
- Two visual modes: solid and liquid glass
- Shape presets configurable in UI
- Responsive rendering across iPhone and MacBook browsers
- Safe-area support for mobile footer placement
- Content safe zone for image, title, CTA, label, dismiss
- Preview inside the builder UI
- Live runtime rendering on a test page
- Toggle support for enable/disable
- Shadow DOM CSS isolation
- Accessibility (ARIA, keyboard, reduced motion)
- Dismiss persistence (localStorage)

### SCO-002 Out of Scope
- Freehand shape drawing in MVP
- Full page-overlay editor for all page elements
- Header/sidebar/inline shape system beyond basic placeholders
- 3D animation or video creative rendering
- Full campaign optimization engine
- Multi-banner concurrent layout orchestration

---

## Requirements (Original)

### REQ-001 Footer anchor
The system shall render the banner anchored to the footer region of the viewport while allowing the shell to extend visually beyond a plain rectangle.

### REQ-002 Two-layer structure
The system shall separate shell rendering from content rendering.

### REQ-003 SVG shell support
The system shall support SVG-based shell rendering for precise, scalable shape outlines.

### REQ-004 HTML content zone
The system shall render headline, label, CTA, and dismiss actions in a stable HTML content zone layered over or within the shell.

### REQ-005 Solid mode
The system shall support a solid background shell mode.

### REQ-006 Liquid-glass mode
The system shall support a liquid-glass shell mode using translucency, blur, and visual edge treatment where supported.

### REQ-007 Preset control
The system shall allow the publisher to select one of the approved MVP shape presets.

### REQ-008 Safe zone enforcement
The system shall preserve readable spacing and tappable CTA/dismiss targets regardless of shell choice.

### REQ-009 Mobile safe-area support
The system shall respect iPhone safe-area constraints and avoid collisions with browser chrome or home-indicator regions.

### REQ-010 Responsive simplification
The system shall simplify shell complexity on smaller screens rather than shrinking all details equally.

### REQ-011 Performance
The runtime banner shall load asynchronously and avoid visibly blocking page rendering.

### REQ-012 Visual quality
The shell shall support premium visual treatments including radius, border, shadow, image emphasis, and subtle motion.

### REQ-013 Label clarity
The system shall support a visible sponsored/ad disclosure label.

### REQ-014 Toggle support
The publisher shall be able to enable or disable the banner from the UI.

### REQ-015 Preview support
The UI shall provide mobile and desktop preview modes for all enabled presets and visual modes.

### REQ-016 Runtime testability
The banner shall be deployable to a real webpage and testable on iPhone and MacBook browsers.

---

## Requirements (v2 Additions — Architect + Engineer Review)

### REQ-017 Shadow DOM encapsulation
The runtime banner shall render inside a Shadow DOM root attached to a single host element appended to `document.documentElement`. All banner CSS and SVG assets shall be encapsulated within the shadow root. No banner styles shall leak to the host page, and no host-page styles shall affect banner rendering.

### REQ-018 Z-index policy
The banner host element shall use `z-index: 2147483647` (maximum 32-bit signed integer).

### REQ-019 Dismissal persistence
Banner dismissal shall be persisted in `localStorage` under key `ff_banner_dismissed_{config_id}`. A dismissed banner shall not re-appear for 24 hours (configurable). If `localStorage` is unavailable, dismissal shall be session-scoped only.

### REQ-020 Backdrop-filter fallback
When CSS `backdrop-filter` is not supported (detected via `CSS.supports`), the system shall automatically fall back to solid mode. No broken or un-blurred translucent state shall be visible.

### REQ-021 Compositor-only animations
All banner animations shall use only `transform` and `opacity` properties. Entrance animation duration shall not exceed 400ms.

### REQ-022 Bundle size budget
The total runtime payload (JS + CSS + inline SVG, gzipped) shall not exceed 30KB. SVG path data for any single preset shall not exceed 2KB uncompressed.

### REQ-023 Breakpoint strategy
The banner shall use two responsive tiers: mobile (viewport width < 768px) and desktop (viewport width >= 768px). Maximum banner height shall be 25% of viewport height or 160px, whichever is smaller. In landscape orientation on viewports shorter than 500px, the banner shall collapse to a single-line mini-bar.

### REQ-024 Contrast guarantee
In liquid-glass mode, all text and interactive elements shall be rendered over a semi-opaque backing layer to guarantee WCAG 2.1 AA contrast regardless of page background content.

### REQ-025 Accessibility baseline
The banner shall include `role="complementary"` and `aria-label="Advertisement"`. The dismiss control shall have `aria-label="Dismiss advertisement"` and respond to both click/tap and Escape key. The CTA shall be a focusable `<button>` or `<a>` element with visible focus indicator. Tab order: CTA then Dismiss.

### REQ-026 Event contract
The runtime shall emit CustomEvents on the host `window`: `ff:banner:loaded`, `ff:banner:impression`, `ff:banner:click`, `ff:banner:dismiss`. Each event detail shall include `{ presetId, mode, timestamp }`.

### REQ-027 Safe zone insets per preset
Each shape preset configuration shall include explicit safe-zone inset values (top, right, bottom, left in CSS pixels) that define the content-safe rectangle relative to the shell bounding box.

### REQ-028 Container insertion point
The runtime shall append the banner container to `document.documentElement` (not `document.body`) to mitigate Safari `position: fixed` bugs when `body` has `overflow: hidden`.

### REQ-029 Reduced motion support
The banner shall respect `prefers-reduced-motion: reduce` by disabling all entrance, exit, and interaction animations.

### REQ-030 Touch target minimums
The CTA button and dismiss control shall each have a minimum touch target of 44x44 CSS pixels.

### REQ-031 Webkit backdrop-filter prefix
The system shall include both `-webkit-backdrop-filter` and `backdrop-filter` declarations for Safari compatibility.

### REQ-032 Safe-area fallback
The system shall use `env(safe-area-inset-bottom)` with a fallback value of `34px` for browsers that do not support `env()`.

### REQ-033 SVG path complexity limit
Each shape preset SVG path shall contain no more than 40 path commands. The shell shape must fully contain the content safe zone rectangle at all breakpoints.

---

## MVP Shape Presets

### SHP-001 Glass Capsule
**Intent:** premium safe baseline
- `border-radius: 24px` on rectangular div
- Ideal for liquid-glass mode
- Responsive: reduce padding, stack content vertically on mobile

### SHP-002 Angled Promo Shell
**Intent:** more commercial and expressive
- `clip-path: polygon(...)` for angled/stepped edges
- Stronger directional feel toward CTA
- Responsive: flatten angle from 8% to 2% on mobile

### SHP-003 Signature Shape Banner
**Intent:** prove custom shape system value
- Inline SVG `<path>` as mask-image
- Vehicle/tool silhouette-inspired shell
- Responsive: swap to simplified path (<20 commands) on mobile

---

## Acceptance Criteria (unchanged from v1, plus)

### AC-011 Shadow DOM isolation verified
Given the banner rendered on a page with aggressive CSS resets, then the banner appearance is unaffected.

### AC-012 Keyboard dismissal works
Given a focused banner, when the visitor presses Escape, then the banner dismisses cleanly.

### AC-013 Glass fallback works
Given a browser without backdrop-filter support, then the banner renders in solid mode automatically.

### AC-014 Reduced motion respected
Given a system with reduced motion enabled, then no animations play.

### AC-015 Dismiss persists across reloads
Given a dismissed banner, when the page is reloaded within 24 hours, then the banner does not reappear.
