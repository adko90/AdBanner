/**
 * Site Mapper Engine
 *
 * Analyzes any webpage's DOM to discover viable ad placement opportunities.
 * Runs inside a Playwright page context via page.evaluate() or standalone
 * in a browser environment.
 *
 * Output: PlacementOpportunity[] — ranked, device-aware slot descriptors
 * that the placement guide overlay consumes.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LANDMARK_ROLES = ['banner', 'navigation', 'main', 'contentinfo', 'complementary', 'form', 'search', 'region'];

const SEMANTIC_TAGS = {
  HEADER:     'navigation',
  NAV:        'navigation',
  MAIN:       'content',
  ARTICLE:    'content',
  SECTION:    'content',
  ASIDE:      'sidebar',
  FOOTER:     'footer',
  FORM:       'form',
  DIALOG:     'dialog',
};

const PROTECTED_SELECTORS = [
  { kind: 'navigation', selectors: ['header', 'nav', '[role="navigation"]', '[role="banner"]'] },
  { kind: 'form',       selectors: ['form', '[role="form"]', '[role="search"]', 'input', 'textarea', 'select'] },
  { kind: 'consent',    selectors: ['[id*="cookie"]', '[class*="cookie"]', '[id*="consent"]', '[class*="consent"]', '[id*="gdpr"]', '[class*="gdpr"]'] },
  { kind: 'chat',       selectors: ['[id*="chat"]', '[class*="chat"]', '[id*="intercom"]', '[class*="intercom"]', '[id*="drift"]', '[class*="drift"]', '[id*="crisp"]'] },
  { kind: 'dialog',     selectors: ['dialog[open]', '[role="dialog"]', '[aria-modal="true"]'] },
  { kind: 'video',      selectors: ['video', '[id*="player"]', '[class*="player"]', 'iframe[src*="youtube"]', 'iframe[src*="vimeo"]'] },
  { kind: 'iframe',     selectors: ['iframe:not([src*="youtube"]):not([src*="vimeo"])'] },
  { kind: 'existing-ad', selectors: [
    '[id*="ad-"]', '[id*="ad_"]', '[class*="ad-"]', '[class*="ad_"]',
    '[data-ad]', '[data-ad-slot]', '[data-ad-unit]',
    'div[id^="google_ads"]', 'div[id^="div-gpt-ad"]', 'ins.adsbygoogle',
    '[id*="taboola"]', '[id*="outbrain"]', '[class*="sponsored"]',
  ]},
  { kind: 'sticky-ui',  selectors: [] },
];

const FORMAT_BY_REGION = {
  'above-fold-gap':  ['leaderboard', 'banner'],
  'below-nav-gap':   ['leaderboard', 'banner'],
  'sidebar-gap':     ['skyscraper', 'medium-rectangle'],
  'content-break':   ['inline', 'native'],
  'between-sections':'inline',
  'footer-zone':     ['banner', 'leaderboard'],
  'rail-zone':       ['skyscraper', 'medium-rectangle', 'half-page'],
  'left-rail-zone':  ['skyscraper', 'medium-rectangle', 'half-page'],
  'top-sticky-zone': ['leaderboard', 'banner'],
};

const MIN_SLOT_WIDTH  = 200;
const MIN_SLOT_HEIGHT = 50;
const TOUCH_CLEARANCE = 48;

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function cssPath(el) {
  const parts = [];
  let node = el;
  while (node && node !== document.body && node !== document.documentElement) {
    let selector = node.tagName.toLowerCase();
    if (node.id) {
      selector += `#${CSS.escape(node.id)}`;
      parts.unshift(selector);
      break;
    }
    const parent = node.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(c => c.tagName === node.tagName);
      if (siblings.length > 1) {
        const idx = siblings.indexOf(node) + 1;
        selector += `:nth-of-type(${idx})`;
      }
    }
    parts.unshift(selector);
    node = node.parentElement;
  }
  return parts.join(' > ');
}

function rectToObj(rect) {
  return {
    x: Math.round(rect.left),
    y: Math.round(rect.top + window.scrollY),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    left: Math.round(rect.left),
    top: Math.round(rect.top + window.scrollY),
    right: Math.round(rect.right),
    bottom: Math.round(rect.bottom + window.scrollY),
  };
}

function isVisible(el) {
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function rectsOverlap(a, b, padding = 0) {
  return !(a.right <= (b.left - padding) || a.left >= (b.right + padding) ||
           a.bottom <= (b.top - padding) || a.top >= (b.bottom + padding));
}

function textDensity(el) {
  const text = (el.textContent || '').trim();
  const html = el.innerHTML || '';
  if (!html.length) return 0;
  return text.length / html.length;
}

function getDeviceClass() {
  if (window.innerWidth < 768) return 'mobile';
  if (window.innerWidth < 1100) return 'tablet';
  return 'desktop';
}

// ---------------------------------------------------------------------------
// Step 1: DOM Topology Scanner
// ---------------------------------------------------------------------------

function scanTopology() {
  const regions = [];

  function classifyElement(el) {
    const tag = el.tagName;
    const role = el.getAttribute('role');

    // ARIA role takes priority
    if (role && LANDMARK_ROLES.includes(role)) {
      return role === 'banner' ? 'navigation' :
             role === 'contentinfo' ? 'footer' :
             role === 'complementary' ? 'sidebar' :
             role === 'main' ? 'content' : role;
    }

    // Semantic HTML tag
    if (SEMANTIC_TAGS[tag]) return SEMANTIC_TAGS[tag];

    // Heuristic: high text density in a large block = content
    const rect = el.getBoundingClientRect();
    if (rect.width > 400 && rect.height > 200 && textDensity(el) > 0.4) {
      return 'content';
    }

    return null;
  }

  // Walk top-level and second-level children of body
  const candidates = [];
  for (const child of document.body.children) {
    if (!isVisible(child)) continue;
    candidates.push(child);
    // Also check one level deeper for semantic wrappers
    for (const grandchild of child.children) {
      if (!isVisible(grandchild)) continue;
      candidates.push(grandchild);
    }
  }

  for (const el of candidates) {
    const region = classifyElement(el);
    if (!region) continue;
    const rect = el.getBoundingClientRect();
    regions.push({
      region,
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role') || null,
      selector: cssPath(el),
      rect: rectToObj(rect),
      textDensity: Math.round(textDensity(el) * 100) / 100,
    });
  }

  return regions;
}

// ---------------------------------------------------------------------------
// Step 2: Protected Region Collection
// ---------------------------------------------------------------------------

function collectProtected() {
  const seen = new Set();
  const regions = [];

  function push(node, kind) {
    if (!node || seen.has(node)) return;
    if (!isVisible(node)) return;
    seen.add(node);
    const rect = node.getBoundingClientRect();
    regions.push({
      kind,
      selector: cssPath(node),
      rect: rectToObj(rect),
    });
  }

  // Selector-based protected regions
  for (const spec of PROTECTED_SELECTORS) {
    for (const sel of spec.selectors) {
      try {
        document.querySelectorAll(sel).forEach(n => push(n, spec.kind));
      } catch { /* invalid selector in this document */ }
    }
  }

  // Fixed/sticky elements
  for (const el of document.body.children) {
    if (seen.has(el)) continue;
    const style = window.getComputedStyle(el);
    if (!['fixed', 'sticky'].includes(style.position)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 44 || rect.height < 44) continue;
    push(el, 'sticky-ui');
  }

  return regions;
}

// ---------------------------------------------------------------------------
// Step 3: Content Zone Analysis (Readability-informed)
// ---------------------------------------------------------------------------

function analyzeContentZones(readabilitySelector) {
  const zones = [];

  // If Readability identified a content root, use it as the primary container
  const baseSelectors = 'article, [role="main"], main, .article, .post, .entry-content, .post-content';
  const selectorStr = readabilitySelector
    ? `${readabilitySelector}, ${baseSelectors}`
    : baseSelectors;
  const contentContainers = document.querySelectorAll(selectorStr);

  for (const container of contentContainers) {
    if (!isVisible(container)) continue;
    const rect = container.getBoundingClientRect();
    const paragraphs = container.querySelectorAll('p');
    const headings = container.querySelectorAll('h1, h2, h3, h4, h5, h6');
    const images = container.querySelectorAll('img, figure, picture');

    zones.push({
      selector: cssPath(container),
      rect: rectToObj(rect),
      paragraphCount: paragraphs.length,
      headingCount: headings.length,
      imageCount: images.length,
      textDensity: Math.round(textDensity(container) * 100) / 100,
      wordCount: (container.textContent || '').trim().split(/\s+/).length,
    });
  }

  return zones;
}

// ---------------------------------------------------------------------------
// Step 4: Gap & Slot Discovery
// ---------------------------------------------------------------------------

function discoverSlots(topologyRegions, protectedRegions, contentZones) {
  const device = getDeviceClass();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const docHeight = document.documentElement.scrollHeight;
  const slots = [];
  let slotIdCounter = 0;

  function nextSlotId(type) {
    return `slot-${type}-${++slotIdCounter}`;
  }

  function isProtected(rect, padding = 8) {
    return protectedRegions.some(p => rectsOverlap(rect, p.rect, padding));
  }

  // --- Footer sticky zone ---
  const footerHeight = device === 'mobile' ? 100 : 148;
  const footerRect = {
    left: Math.round(vw * 0.06),
    top: docHeight - footerHeight - 8 + window.scrollY,
    right: Math.round(vw * 0.94),
    bottom: docHeight - 8 + window.scrollY,
    x: Math.round(vw * 0.06),
    y: docHeight - footerHeight - 8,
    width: Math.round(vw * 0.88),
    height: footerHeight,
  };
  // For fixed footer, use viewport-relative
  const footerFixedRect = {
    left: Math.round(vw * 0.06),
    top: vh - footerHeight - 8,
    right: Math.round(vw * 0.94),
    bottom: vh - 8,
    x: Math.round(vw * 0.06),
    y: vh - footerHeight - 8,
    width: Math.round(vw * 0.88),
    height: footerHeight,
  };
  if (!isProtected(footerFixedRect, 18)) {
    slots.push({
      slotId: nextSlotId('footer'),
      region: 'footer-zone',
      anchorSelector: 'body',
      rect: footerFixedRect,
      confidence: 0.95,
      supportedFormats: ['banner', 'leaderboard'],
      deviceApplicability: ['desktop', 'tablet', 'mobile'],
      behavior: 'sticky-edge',
      risks: [],
    });
  }

  // --- Right rail zone (desktop only) ---
  if (device === 'desktop') {
    const contentRegion = topologyRegions.find(r => r.region === 'content');
    const railWidth = 300;
    const railHeight = 400;
    const railX = vw - railWidth - 16;
    const railY = contentRegion ? contentRegion.rect.top : 120;
    const railRect = {
      left: railX, top: railY,
      right: railX + railWidth, bottom: railY + railHeight,
      x: railX, y: railY,
      width: railWidth, height: railHeight,
    };
    if (railX > vw * 0.52 && !isProtected(railRect, 14)) {
      // Check we're not overlapping the content
      const contentOverlap = contentZones.some(z =>
        rectsOverlap(railRect, z.rect, 20)
      );
      slots.push({
        slotId: nextSlotId('rail'),
        region: 'rail-zone',
        anchorSelector: contentRegion ? contentRegion.selector : 'body',
        rect: railRect,
        confidence: contentOverlap ? 0.55 : 0.90,
        supportedFormats: ['skyscraper', 'medium-rectangle', 'half-page'],
        deviceApplicability: ['desktop'],
        behavior: 'desktop-edge',
        risks: contentOverlap ? ['content-overlap'] : [],
      });
    }
  }

  // --- Inline content breaks ---
  for (const zone of contentZones) {
    if (zone.paragraphCount < 3) continue;
    const container = document.querySelector(zone.selector);
    if (!container) continue;

    const paragraphs = container.querySelectorAll('p');
    // Place after every 3rd paragraph (or after midpoint for short articles)
    const interval = Math.max(3, Math.floor(paragraphs.length / 3));
    let placed = 0;

    for (let i = interval - 1; i < paragraphs.length - 1 && placed < 3; i += interval) {
      const p = paragraphs[i];
      const pRect = p.getBoundingClientRect();
      const slotWidth = Math.min(Math.round(zone.rect.width * 0.92), vw - 48);
      const slotHeight = device === 'mobile' ? 120 : 168;
      const slotRect = {
        left: zone.rect.left,
        top: Math.round(pRect.bottom + window.scrollY + 16),
        right: zone.rect.left + slotWidth,
        bottom: Math.round(pRect.bottom + window.scrollY + 16 + slotHeight),
        x: zone.rect.left,
        y: Math.round(pRect.bottom + window.scrollY + 16),
        width: slotWidth,
        height: slotHeight,
      };

      if (isProtected(slotRect, 8)) continue;

      const nearImage = Array.from(container.querySelectorAll('img, figure')).some(img => {
        const imgRect = img.getBoundingClientRect();
        return Math.abs(imgRect.bottom - pRect.bottom) < 80;
      });

      slots.push({
        slotId: nextSlotId('inline'),
        region: 'content-break',
        anchorSelector: cssPath(p),
        anchorPosition: 'after',
        rect: slotRect,
        confidence: nearImage ? 0.65 : 0.82,
        supportedFormats: ['inline', 'native'],
        deviceApplicability: ['desktop', 'tablet', 'mobile'],
        behavior: 'in-flow',
        risks: nearImage ? ['near-media'] : [],
      });
      placed++;
    }
  }

  // --- Between-section gaps ---
  const sections = document.querySelectorAll('section, [role="region"]');
  for (let i = 0; i < sections.length - 1; i++) {
    const current = sections[i];
    const next = sections[i + 1];
    if (!isVisible(current) || !isVisible(next)) continue;

    const currentRect = current.getBoundingClientRect();
    const nextRect = next.getBoundingClientRect();
    const gap = nextRect.top - currentRect.bottom;

    if (gap < 40) continue; // Not enough visual separation

    const slotWidth = Math.min(Math.round(vw * 0.88), 1200);
    const slotHeight = Math.min(Math.max(gap - 16, MIN_SLOT_HEIGHT), 200);
    const slotRect = {
      left: Math.round((vw - slotWidth) / 2),
      top: Math.round(currentRect.bottom + window.scrollY + 8),
      right: Math.round((vw - slotWidth) / 2 + slotWidth),
      bottom: Math.round(currentRect.bottom + window.scrollY + 8 + slotHeight),
      x: Math.round((vw - slotWidth) / 2),
      y: Math.round(currentRect.bottom + window.scrollY + 8),
      width: slotWidth,
      height: slotHeight,
    };

    if (isProtected(slotRect, 8)) continue;

    slots.push({
      slotId: nextSlotId('section-gap'),
      region: 'between-sections',
      anchorSelector: cssPath(current),
      anchorPosition: 'after',
      rect: slotRect,
      confidence: 0.72,
      supportedFormats: ['banner', 'inline'],
      deviceApplicability: ['desktop', 'tablet', 'mobile'],
      behavior: 'in-flow',
      risks: [],
    });
  }

  // --- Left rail zone (desktop only) ---
  if (device === 'desktop') {
    const contentRegion = topologyRegions.find(r => r.region === 'content');
    const leftRailWidth = 300;
    const leftRailHeight = 400;
    const leftRailX = 16;
    const leftRailY = contentRegion ? contentRegion.rect.top : 120;
    const leftRailRect = {
      left: leftRailX, top: leftRailY,
      right: leftRailX + leftRailWidth, bottom: leftRailY + leftRailHeight,
      x: leftRailX, y: leftRailY,
      width: leftRailWidth, height: leftRailHeight,
    };
    const contentLeftEdge = contentZones.length > 0
      ? Math.min(...contentZones.map(z => z.rect.left))
      : vw * 0.15;
    if (leftRailX + leftRailWidth < contentLeftEdge && !isProtected(leftRailRect, 14)) {
      const contentOverlap = contentZones.some(z =>
        rectsOverlap(leftRailRect, z.rect, 20)
      );
      slots.push({
        slotId: nextSlotId('left-rail'),
        region: 'left-rail-zone',
        anchorSelector: contentRegion ? contentRegion.selector : 'body',
        rect: leftRailRect,
        confidence: contentOverlap ? 0.50 : 0.85,
        supportedFormats: ['skyscraper', 'medium-rectangle', 'half-page'],
        deviceApplicability: ['desktop'],
        behavior: 'desktop-edge',
        risks: contentOverlap ? ['content-overlap'] : [],
      });
    }
  }

  // --- Top sticky edge slot ---
  {
    const navEl = document.querySelector('header, nav, [role="banner"], [role="navigation"]');
    const topY = navEl && isVisible(navEl) ? navEl.getBoundingClientRect().bottom : 0;
    const stickyHeight = device === 'mobile' ? 60 : 90;
    const stickyRect = {
      left: Math.round(vw * 0.06),
      top: Math.round(topY),
      right: Math.round(vw * 0.94),
      bottom: Math.round(topY + stickyHeight),
      x: Math.round(vw * 0.06),
      y: Math.round(topY),
      width: Math.round(vw * 0.88),
      height: stickyHeight,
    };
    if (!isProtected(stickyRect, 12)) {
      slots.push({
        slotId: nextSlotId('top-sticky'),
        region: 'top-sticky-zone',
        anchorSelector: navEl ? cssPath(navEl) : 'body',
        anchorPosition: 'after',
        rect: stickyRect,
        confidence: 0.88,
        supportedFormats: ['leaderboard', 'banner'],
        deviceApplicability: ['desktop', 'tablet', 'mobile'],
        behavior: 'sticky-edge',
        risks: [],
      });
    }
  }

  // --- Below-navigation gap ---
  const nav = document.querySelector('header, nav, [role="banner"], [role="navigation"]');
  if (nav && isVisible(nav)) {
    const navRect = nav.getBoundingClientRect();
    const nextSibling = nav.nextElementSibling;
    const nextTop = nextSibling ? nextSibling.getBoundingClientRect().top : navRect.bottom + 100;
    const gap = nextTop - navRect.bottom;

    if (gap >= 20) {
      const slotWidth = Math.min(Math.round(vw * 0.92), 1200);
      const slotHeight = Math.min(Math.max(Math.round(gap * 0.7), 50), 120);
      const slotRect = {
        left: Math.round((vw - slotWidth) / 2),
        top: Math.round(navRect.bottom + window.scrollY + 4),
        right: Math.round((vw - slotWidth) / 2 + slotWidth),
        bottom: Math.round(navRect.bottom + window.scrollY + 4 + slotHeight),
        x: Math.round((vw - slotWidth) / 2),
        y: Math.round(navRect.bottom + window.scrollY + 4),
        width: slotWidth,
        height: slotHeight,
      };
      if (!isProtected(slotRect, 12)) {
        slots.push({
          slotId: nextSlotId('below-nav'),
          region: 'below-nav-gap',
          anchorSelector: cssPath(nav),
          anchorPosition: 'after',
          rect: slotRect,
          confidence: 0.88,
          supportedFormats: ['leaderboard', 'banner'],
          deviceApplicability: ['desktop', 'tablet', 'mobile'],
          behavior: 'in-flow',
          risks: [],
        });
      }
    }
  }

  return slots;
}

// ---------------------------------------------------------------------------
// Step 5: Scoring & Ranking
// ---------------------------------------------------------------------------

function scoreSlots(slots) {
  const vh = window.innerHeight;
  const device = getDeviceClass();

  return slots.map(slot => {
    let score = slot.confidence;

    // Boost above-fold slots
    if (slot.rect.y < vh) {
      score += 0.05;
    }

    // Penalize near-media / overlap risks
    if (slot.risks.includes('near-media')) score -= 0.10;
    if (slot.risks.includes('content-overlap')) score -= 0.20;
    if (slot.risks.includes('viewport-edge')) score -= 0.08;

    // Boost sticky/fixed slots (high viewability)
    if (slot.behavior === 'sticky-edge') score += 0.03;

    // Penalize very small slots
    if (slot.rect.width < MIN_SLOT_WIDTH || slot.rect.height < MIN_SLOT_HEIGHT) {
      score -= 0.25;
    }

    // Mobile touch clearance check
    if (device === 'mobile') {
      if (slot.rect.height < TOUCH_CLEARANCE) {
        slot.risks.push('touch-target-small');
        score -= 0.15;
      }
    }

    score = Math.round(Math.min(1, Math.max(0, score)) * 100) / 100;

    return { ...slot, score };
  }).sort((a, b) => b.score - a.score);
}

// ---------------------------------------------------------------------------
// Step 6: DOM Outline (2-level deep)
// ---------------------------------------------------------------------------

function buildDomOutline() {
  function describeNode(el) {
    return {
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      className: el.className && typeof el.className === 'string'
        ? el.className.trim() || null
        : null,
    };
  }

  const outline = [];
  for (const child of document.body.children) {
    if (child.nodeType !== 1) continue;
    const node = describeNode(child);
    const children = [];
    for (const grandchild of child.children) {
      if (grandchild.nodeType !== 1) continue;
      children.push(describeNode(grandchild));
    }
    if (children.length > 0) node.children = children;
    outline.push(node);
  }
  return outline;
}

// ---------------------------------------------------------------------------
// Main: mapSite()
// ---------------------------------------------------------------------------

function mapSite(options) {
  const opts = options || {};
  const device = getDeviceClass();
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const docHeight = document.documentElement.scrollHeight;
  const pageTitle = document.title;
  const pageUrl = window.location.href;

  // Step 1: Topology
  const topology = scanTopology();

  // Step 2: Protected regions
  const protectedRegions = collectProtected();

  // Step 3: Content zones (with Readability hint if provided)
  const contentZones = analyzeContentZones(opts.readabilitySelector);

  // Step 4: Slot discovery
  const rawSlots = discoverSlots(topology, protectedRegions, contentZones);

  // Step 5: Score & rank
  const opportunities = scoreSlots(rawSlots);

  // Step 6: DOM outline (2-level deep)
  const domOutline = buildDomOutline();

  return {
    version: 1,
    mappedAt: new Date().toISOString(),
    page: {
      url: pageUrl,
      title: pageTitle,
      docHeight,
      device,
      viewport,
    },
    topology,
    protectedRegions,
    contentZones,
    opportunities,
    domOutline,
    summary: {
      totalSlots: opportunities.length,
      highConfidence: opportunities.filter(s => s.score >= 0.8).length,
      mediumConfidence: opportunities.filter(s => s.score >= 0.6 && s.score < 0.8).length,
      lowConfidence: opportunities.filter(s => s.score < 0.6).length,
      regions: [...new Set(opportunities.map(s => s.region))],
    },
  };
}

// Export for both browser and Node (Playwright evaluate) contexts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { mapSite };
} else if (typeof window !== 'undefined') {
  window.__FF_SiteMapper = { mapSite };
}
