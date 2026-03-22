# Ad Placement Framework — Session Handoff

## Repo & Branch State

- **Repo**: `adko90/AdBanner`
- **Worktree**: `/private/tmp/codex-agents/agent-Ken-ad-placement-platform-implementation`
- **Branch**: `codex/agent-Ken/ad-placement-platform-implementation`
- **Base commit (prior work)**: `1c8ba4c` — ad placement editor, verification host, runtime loader
- **Latest commit (this session)**: `4a575b2` — site mapper engine + API endpoints
- **Verification server**: `http://127.0.0.1:4183` (existing), port `4173` also configured in scripts

---

## What Exists Today

### Runtime Loader (`src/runtime/ad-placement-loader.js`)
- Loads a published JSON site config, resolves placements against 3 anchor types (footer, side rail, inline)
- Renders ads via Shadow DOM isolation — no style leakage
- Collision avoidance against protected regions (nav, forms, consent banners, chat widgets, dialogs)
- Resize-aware, device-gated, kill-switch capable
- One-line install snippet: user drops a `<script>` tag, everything else is config-driven

### Editor UI (`src/index.html`)
- Visual placement editor with drag/resize handles for 3 zones
- Config panel: preset selector, visual mode, shape, accent color, ad toggle, preview/live toggle
- Publish/rollback/emergency-stop controls
- Placement status dashboard showing render/skip decisions with reason codes
- Image optimiser panel (ThumbHash, AVIF/WebP cascade)

### Verification Host (`src/verify-host.html`)
- Simulates a third-party site with the install snippet embedded
- Proves placements work outside the editor — publish from editor, reload here to verify

### Server (`scripts/serve-verification.mjs`)
- Static file server for `src/`
- `POST /api/publish/:siteId` — saves runtime config with backup for rollback
- `GET /api/published/:siteId` — serves published config (falls back to `site-configs/`)
- `GET /api/published-backup/:siteId` — serves previous config for rollback
- **NEW** `POST /api/map-site` — Playwright-powered site mapping (see below)
- **NEW** `GET /api/proxy-site?url=...` — fetches and snapshots any URL as sandboxed HTML

### Site Mapper (`src/runtime/site-mapper.js`) — NEW
5-step DOM analysis pipeline that runs inside Playwright's page context:

1. **Topology Scanner** — walks body children, classifies by ARIA roles + semantic HTML + text density heuristics. Outputs region type (navigation, content, sidebar, footer, form, dialog)
2. **Protected Region Collector** — finds all elements matching protected selectors (nav, forms, consent, chat, video, dialogs) plus any fixed/sticky elements. These are no-go zones
3. **Content Zone Analyzer** — finds article/main containers, counts paragraphs/headings/images, measures text density and word count
4. **Slot Discovery** — computes candidate placement rectangles for 5 region types:
   - `footer-zone` (sticky-edge, all devices)
   - `rail-zone` (desktop-edge, desktop only)
   - `content-break` (inline after every 3rd paragraph, all devices)
   - `between-sections` (gaps between `<section>` elements)
   - `below-nav-gap` (space between navigation and first content)
5. **Scoring** — ranks slots by confidence (0–1) factoring in: above-fold boost, risk penalties (near-media, content-overlap, viewport-edge, touch-target-small), slot size, behavior type

Output: `PlacementOpportunity[]` with `slotId`, `region`, `anchorSelector`, `rect`, `confidence`, `score`, `supportedFormats`, `deviceApplicability`, `behavior`, `risks`

### Tech Stack Added This Session

| Package | Version | Purpose |
|---------|---------|---------|
| `playwright` | ^1.58 | Headless browser — fetches any URL, renders at any viewport, extracts element rects, screenshots |
| `jsdom` | ^26.0 | Lightweight server-side DOM parsing, host for Readability.js |
| `@mozilla/readability` | ^0.6 | Content-region extraction — identifies article boundaries for inline placement |

### Verified Working

- Desktop mapping (1440x900): topology detection, protected region collection, inline slot discovery (score 0.82)
- Mobile mapping (390x844): adapted slot dimensions, no rail slot, taller document
- Proxy endpoint: returns sandboxed HTML with scripts stripped, CSP headers set
- Existing ad placements correctly detected as sticky-ui protected regions (prevents double-placement)

---

## Work Split: Two Sessions

### Session 1: Framework Engine (Backend + Runtime)

**Goal**: Complete the site-mapping and analysis framework so it reliably maps any website across Safari and Chrome on desktop and mobile.

**Scope**:

#### 1A. Browser Coverage — Safari + Chrome
- Current: Playwright installs Chromium only
- **Add**: `npx playwright install webkit` for Safari engine coverage
- **Add**: device parameter in `/api/map-site` should select the correct browser engine:
  - `browser: "chromium"` (default) or `browser: "webkit"` (Safari)
- **Test**: run mapper against 5+ real-world sites in both engines, compare output consistency
- Safari-specific: handle safe area insets (`env(safe-area-inset-*)`) for notch/dynamic island avoidance

#### 1B. Mapper Hardening
- **Readability integration**: use `@mozilla/readability` via jsdom to pre-extract content boundaries before Playwright runs the mapper. Feed Readability's `content` element selector into the mapper for higher-confidence content zone detection
- **Scroll-triggered lazy content**: some sites lazy-load content. After initial render, scroll to bottom and wait for additional content to load before mapping
- **iframe content**: detect embedded iframes (YouTube, embeds) and add them to protected regions
- **Existing ad slot detection**: identify existing ad containers (`[id*="ad-"]`, `[class*="ad-"]`, `[data-ad]`, Google GPT slots `div[id^="google_ads"]`) and mark as protected
- **Multi-breakpoint mapping**: run the mapper at 3 viewports (390/820/1440) in a single API call, return a unified slot map with per-breakpoint rects
- **Confidence calibration**: test against 10+ real sites, tune scoring weights so high-confidence slots are genuinely safe

#### 1C. Proxy Hardening
- **Asset resolution**: currently uses `<base>` tag for relative URLs. Improve by rewriting `src`, `href`, `srcset` attributes to absolute URLs
- **CSS inlining**: capture computed styles for critical above-fold elements to prevent layout shift in snapshot
- **Image handling**: proxy images through the server or convert to data URIs for fully offline snapshots
- **Security**: validate URL against allowlist patterns, rate-limit requests, add timeout handling

#### 1D. Site Config Generation
- **Auto-config builder**: function that takes selected `PlacementOpportunity[]` and generates a complete `site_config.json` matching the schema in `src/runtime/site-configs/site_demo.json`
- Maps slot regions to the loader's anchor types (footer → footer, rail-zone → floating-right, content-break → inline-article)
- Generates `areaOverrides` from the slot rects
- Generates `policy.surfaces` and `policy.protectedRegions` from the mapper's protected region data
- Produces the `installSnippet` with the correct site ID

**Key files**:
- `src/runtime/site-mapper.js` — extend
- `scripts/serve-verification.mjs` — extend endpoints
- `src/runtime/config-builder.js` — new
- `package.json` — no new deps expected

**Done when**: `POST /api/map-site` returns consistent, high-quality results for any public URL in both Chromium and WebKit, across desktop/tablet/mobile viewports, and `POST /api/build-config` converts selected slots into a publishable site config.

---

### Session 2: Placement Guide Overlay (Frontend)

**Goal**: Build the no-code visual overlay where users select discovered slots, preview ads in context, and export a ready-to-publish config.

**Depends on**: Session 1's `/api/map-site` and `/api/build-config` endpoints.

**Scope**:

#### 2A. Guide Layer — Slot Overlay
- New file: `src/runtime/placement-guide.js`
- Renders on top of an iframe containing the proxied site (from `/api/proxy-site`)
- For each `PlacementOpportunity` from the mapper, draw a translucent rectangle:
  - **Green border** (score >= 0.80) — safe
  - **Amber border** (0.60–0.79) — viable with risks
  - **Red border** (< 0.60) — risky
- Each slot shows a badge pill (region name + score) and dimensions pill
- Optional toggle: "Show protected regions" — renders red-tinted no-go zones with kind labels
- Slots are non-interactive by default (discovery view), become interactive when user enters placement mode

#### 2B. Guide Toolbar
- Fixed top bar above the iframe preview
- **URL input**: user pastes any website URL
- **Device toggle**: Desktop / Tablet / Mobile (re-runs mapper at that viewport, resizes iframe)
- **Browser toggle**: Chrome / Safari (selects engine for mapping)
- **Scan button**: triggers `/api/map-site`, populates overlay
- **Export Plan button**: generates config from all planned slots
- Styled using existing `.config-panel`, `.tg`, `.btn-sm` CSS patterns from index.html

#### 2C. Slot Selection & Config Panel
- Click a slot → it enters "selected" state (solid border, highlighted)
- Config panel slides in from right edge:
  - **Format picker**: dropdown populated from the slot's `supportedFormats`
  - **Device targets**: checkboxes pre-filled from `deviceApplicability`
  - **Priority**: number input (default based on region: footer=20, rail=10, inline=18)
  - **Creative template**: reuse existing `#editorTemplate` dropdown options
  - **Risks display**: lists any risk flags from the mapper
  - **"Preview in Slot"** button: renders the actual ad creative (from our existing `createFooter`/`createSide`/`createInline` functions) inside the slot rect in the iframe
  - **"Add to Plan"** button: marks slot as planned (checkmark badge, solid fill)
  - **"Remove"** button: unplans the slot
- Panel uses existing design tokens: `--panel-text`, `--panel-muted`, `--panel-border`

#### 2D. Live Preview
- When user clicks "Preview in Slot", inject our ad-placement-loader.js into the proxied iframe with a draft config built from the planned slots
- This renders the actual ad creative in context — user sees exactly what visitors will see
- Device toggle re-renders at that viewport width
- Hot-swap: changing the creative template or accent color in the config panel updates the preview live

#### 2E. Export Flow
- "Export Plan" button calls Session 1's `/api/build-config` with the planned slots
- Displays:
  - Generated `site_config.json` (editable textarea)
  - Install snippet (`<script>` tag)
  - Publish button → `POST /api/publish/:siteId`
  - Link to verification host to confirm
- Reuses existing `.install-panel` section styling from index.html

#### Design Language Reference
All new CSS uses the `guide-` prefix. Pattern reference from existing code:

```css
/* Slot rectangle — mirrors .editor-area */
.guide-slot {
  position: absolute; pointer-events: auto; border-radius: 18px;
  border: 2px dashed rgba(34,197,94,0.7); /* green for high confidence */
  background: rgba(34,197,94,0.06);
  transition: all 0.15s;
}
.guide-slot.medium { border-color: rgba(251,191,36,0.6); background: rgba(251,191,36,0.06); }
.guide-slot.low    { border-color: rgba(248,113,113,0.5); background: rgba(248,113,113,0.06); }
.guide-slot.selected { border-style: solid; background: rgba(59,130,246,0.1); }
.guide-slot.planned  { border-style: solid; background: rgba(34,197,94,0.1); }

/* Badge — mirrors .editor-badge */
.guide-badge {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 9px; border-radius: 999px;
  background: rgba(15,23,42,0.78); color: #f8fafc;
  font-size: 10px; font-weight: 700;
}

/* Config panel — mirrors .config-panel pattern */
.guide-config-panel {
  position: fixed; right: 0; top: 48px; bottom: 0; width: 320px;
  background: rgba(248,248,250,0.98); border-left: 1px solid var(--panel-border);
  padding: 16px; overflow-y: auto;
  transform: translateX(100%); transition: transform 0.2s;
}
.guide-config-panel.open { transform: translateX(0); }
```

**Key files**:
- `src/runtime/placement-guide.js` — new (overlay logic)
- `src/index.html` — add guide mode toggle, toolbar section, iframe container
- `src/runtime/ad-placement-loader.js` — no changes expected (consumed as-is in preview iframe)

**Done when**: user can paste any URL, scan it, see discovered slots color-coded by confidence, click to select and configure each slot, preview actual ad creatives in context, and export a publishable site config + install snippet.

---

## File Map

```
src/
  runtime/
    ad-placement-loader.js    ← existing runtime (no changes needed)
    site-mapper.js            ← Session 1 extends (browser compat, lazy content, existing ad detection)
    site-configs/
      site_demo.json          ← existing reference config
    config-builder.js         ← Session 1 creates (opportunity[] → site config)
    placement-guide.js        ← Session 2 creates (overlay + interaction)
  index.html                  ← Session 2 extends (guide mode UI)
  verify-host.html            ← existing (no changes)
scripts/
  serve-verification.mjs      ← Session 1 extends (multi-browser, /api/build-config)
package.json                  ← Session 1 may add webkit browser install script
```

## API Contract Between Sessions

Session 2 depends on Session 1 providing these endpoints:

### `POST /api/map-site`
**Request**:
```json
{
  "url": "https://example.com/page",
  "device": "desktop" | "tablet" | "mobile",
  "browser": "chromium" | "webkit",
  "multiBreakpoint": false
}
```
**Response**:
```json
{
  "version": 1,
  "mappedAt": "ISO timestamp",
  "page": { "url", "title", "docHeight", "device", "viewport": { "width", "height" } },
  "topology": [{ "region", "tag", "selector", "rect", "textDensity" }],
  "protectedRegions": [{ "kind", "selector", "rect" }],
  "contentZones": [{ "selector", "rect", "paragraphCount", "wordCount" }],
  "opportunities": [{
    "slotId", "region", "anchorSelector", "anchorPosition",
    "rect": { "x", "y", "width", "height", "left", "top", "right", "bottom" },
    "confidence", "score",
    "supportedFormats": ["inline", "banner", ...],
    "deviceApplicability": ["desktop", "tablet", "mobile"],
    "behavior": "in-flow" | "sticky-edge" | "desktop-edge",
    "risks": ["near-media", "content-overlap", ...]
  }],
  "summary": { "totalSlots", "highConfidence", "mediumConfidence", "lowConfidence", "regions" },
  "screenshot": "data:image/png;base64,..."
}
```

### `GET /api/proxy-site?url=...&width=1440&height=900`
**Response**: self-contained HTML document (scripts stripped, CSP enforced, `<base>` tag set)

### `POST /api/build-config` (Session 1 creates)
**Request**:
```json
{
  "siteId": "my_site",
  "selectedSlots": ["slot-inline-1", "slot-footer-1"],
  "opportunities": [/* full opportunity objects from map-site */],
  "runtime": { "accent": "#ff3b30" }
}
```
**Response**: complete `site_config.json` matching the schema in `site_demo.json`, plus `installSnippet`
