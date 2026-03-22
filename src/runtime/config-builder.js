/**
 * Config Builder
 *
 * Converts selected PlacementOpportunity[] from the site mapper
 * into a publishable site_config.json matching the runtime loader schema.
 */

const REGION_TO_ANCHOR = {
  'footer-zone':       'footer',
  'rail-zone':         'floating-right',
  'left-rail-zone':    'floating-left',
  'top-sticky-zone':   'top-sticky',
  'content-break':     'inline-article',
  'between-sections':  'inline-article',
  'below-nav-gap':     'inline-article',
};

const REGION_TO_PRIORITY = {
  'footer-zone':       20,
  'rail-zone':         10,
  'left-rail-zone':    10,
  'top-sticky-zone':   19,
  'content-break':     18,
  'between-sections':  15,
  'below-nav-gap':     16,
};

const REGION_TO_SURFACE_LABEL = {
  'footer-zone':       'Footer safe zone',
  'rail-zone':         'Right rail safe zone',
  'left-rail-zone':    'Left rail safe zone',
  'top-sticky-zone':   'Top sticky safe zone',
  'content-break':     'Inline article safe zone',
  'between-sections':  'Between-section safe zone',
  'below-nav-gap':     'Below-navigation safe zone',
};

const REGION_TO_AREA_KEY = {
  'footer-zone':       'footer',
  'rail-zone':         'side',
  'left-rail-zone':    'side',
  'top-sticky-zone':   'top',
  'content-break':     'inline',
  'between-sections':  'inline',
  'below-nav-gap':     'inline',
};

export function buildConfig({ siteId, selectedSlots, opportunities, runtime }) {
  const accent = runtime?.accent || '#ff3b30';
  const selected = opportunities.filter(o => selectedSlots.includes(o.slotId));

  const placements = selected.map((opp, idx) => ({
    enabled: true,
    environment: 'live',
    placementId: `placement-${opp.region.replace('-zone', '').replace('-break', '').replace('-gap', '')}-${idx + 1}`,
    anchorType: REGION_TO_ANCHOR[opp.region] || 'inline-article',
    deviceTargets: opp.deviceApplicability || ['desktop', 'tablet', 'mobile'],
    priority: REGION_TO_PRIORITY[opp.region] || 15,
  }));

  // Build areaOverrides from slot rects
  const areaOverrides = {};
  for (const opp of selected) {
    const key = REGION_TO_AREA_KEY[opp.region] || 'inline';
    if (areaOverrides[key]) continue; // first wins per area
    const rect = opp.rects?.desktop || opp.rect;
    if (key === 'footer') {
      areaOverrides.footer = {
        widthRatio: Math.round((rect.width / 1440) * 100) / 100,
        height: rect.height,
        bottomInset: 8,
        centerOffset: 0,
      };
    } else if (key === 'side') {
      areaOverrides.side = {
        width: rect.width,
        height: rect.height,
        topOffset: rect.y,
        rightInset: 8,
      };
    } else if (key === 'top') {
      areaOverrides.top = {
        widthRatio: Math.round((rect.width / 1440) * 100) / 100,
        height: rect.height,
        topInset: rect.y,
        centerOffset: 0,
      };
    } else {
      areaOverrides.inline = {
        widthRatio: Math.round((rect.width / 1440) * 100) / 100,
        height: rect.height,
        columnOffset: 0,
        anchorOffset: 112,
      };
    }
  }

  // Build surfaces from selected slots
  const surfaces = selected.map(opp => ({
    surfaceId: opp.slotId,
    label: REGION_TO_SURFACE_LABEL[opp.region] || opp.region,
    region: REGION_TO_AREA_KEY[opp.region] || 'content',
    category: 'allowed',
    anchorType: REGION_TO_ANCHOR[opp.region] || 'inline-article',
    behavior: opp.behavior,
  }));

  // Collect unique protected region kinds from the mapper output
  const protectedRegions = [
    { kind: 'navigation', label: 'navigation or header', selectors: ['header', 'nav', '[role="navigation"]'] },
    { kind: 'form', label: 'form or input surface', selectors: ['form', '[role="form"]', 'input', 'textarea', 'select'] },
    { kind: 'consent', label: 'cookie or consent manager', selectors: ['[id*="cookie"]', '[class*="cookie"]', '[id*="consent"]', '[class*="consent"]'] },
    { kind: 'chat', label: 'chat launcher or support widget', selectors: ['[id*="chat"]', '[class*="chat"]', '[id*="intercom"]', '[class*="intercom"]'] },
    { kind: 'dialog', label: 'modal or dialog', selectors: ['dialog[open]', '[role="dialog"]', '[aria-modal="true"]'] },
  ];

  const config = {
    version: 1,
    siteId,
    publishedAt: new Date().toISOString(),
    runtime: {
      placementPreset: 'autopilot',
      accent,
      visualMode: runtime?.visualMode || 'solid',
      shapePreset: runtime?.shapePreset || 'capsule',
      confidenceFloor: 0.7,
      killSwitch: false,
      liveEnabled: true,
      failClosed: true,
      isolationMode: 'shadow-dom',
    },
    placements,
    areaOverrides,
    policy: {
      schemaVersion: 1,
      collisionPadding: { footer: 18, side: 14, inline: 8 },
      surfaces,
      protectedRegions,
      constraints: {
        failClosed: true,
        noSelectorEditing: true,
        noProtectedRegionRendering: true,
      },
    },
    installSnippet: `<script>window.FF_AD_SITE = "${siteId}";</script>\n<script async src="/runtime/ad-placement-loader.js" data-config="/api/published/${siteId}.json"></script>`,
  };

  return config;
}
