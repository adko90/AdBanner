/**
 * ff-builder-recommendations.js — Smart conflict resolution engine (F5).
 *
 * Pure function: takes a slot, its conflicts with protected regions,
 * collision padding, and available alternative slots. Returns ranked
 * fix suggestions per conflict kind.
 */

const STRATEGIES = {
  consent: [
    { desc: 'Increase bottom inset to clear consent banner', action: { adjustInset: { bottom: 80 } } },
    { desc: 'Reduce slot height to avoid overlap', action: { reduceHeight: 0.6 } },
    { desc: 'Delay render until consent banner is dismissed', action: { delayUntilDismissed: 'consent' } },
  ],
  navigation: [
    { desc: 'Move slot below navigation', action: { moveBelowNav: true } },
    { desc: 'Use sticky-below-nav behavior', action: { setBehavior: 'sticky-below-nav' } },
  ],
  form: [
    { desc: 'Shift to adjacent column', action: { shiftColumn: 'right' } },
    { desc: 'Reduce slot width to avoid form overlap', action: { reduceWidth: 0.7 } },
  ],
  chat: [
    { desc: 'Offset slot from chat widget corner', action: { adjustInset: { right: 80, bottom: 80 } } },
    { desc: 'Render below chat widget z-index', action: { adjustZIndex: -1 } },
  ],
  'sticky-ui': [
    { desc: 'Adjust edge inset to clear sticky element', action: { adjustInset: { top: 60 } } },
    { desc: 'Switch to opposite screen edge', action: { switchEdge: true } },
  ],
  'existing-ad': [
    { desc: 'Prioritize this slot over the lower-priority one', action: { prioritize: true } },
    { desc: 'Disable this slot — existing ad takes precedence', action: { disable: true } },
  ],
  iframe: [
    { desc: 'Increase collision padding around iframe', action: { adjustInset: { all: 20 } } },
  ],
  video: [
    { desc: 'Move slot away from video player', action: { adjustInset: { top: 40 } } },
  ],
  dialog: [
    { desc: 'Delay render until dialog is closed', action: { delayUntilDismissed: 'dialog' } },
  ],
};

/**
 * Generate recommendations for a slot's conflicts.
 *
 * @param {object} slot - PlacementOpportunity from site-mapper
 * @param {object[]} conflicts - Protected regions that overlap this slot
 * @param {{ footer: number, side: number, inline: number }} collisionPadding
 * @param {object[]} alternatives - Other available slots to suggest
 * @returns {{ recommendations: object[], verdict: string }}
 */
export function getRecommendations(slot, conflicts, collisionPadding, alternatives) {
  const recommendations = [];

  // Per-conflict recommendations
  for (const conflict of conflicts) {
    const kind = conflict.kind || 'unknown';
    const strategies = STRATEGIES[kind] || [];

    for (const strategy of strategies) {
      recommendations.push({
        conflictKind: kind,
        description: strategy.desc,
        action: strategy.action,
        severity: kind === 'consent' || kind === 'navigation' ? 'high' : 'medium',
        before: { status: 'BLOCKED', conflictKind: kind },
        after: { status: 'SAFE', conflictKind: kind },
      });
    }
  }

  // Low confidence → suggest alternatives
  if (slot.score < 0.60 && alternatives.length > 0) {
    const better = alternatives
      .filter(a => a.slotId !== slot.slotId && a.score > slot.score)
      .sort((a, b) => b.score - a.score)
      .slice(0, 2);

    for (const alt of better) {
      recommendations.push({
        conflictKind: 'low-confidence',
        description: `Use ${formatRegion(alt.region)} instead (score ${alt.score.toFixed(2)})`,
        action: { switchToSlot: alt.slotId },
        severity: 'low',
        before: { status: 'RISKY', score: slot.score },
        after: { status: 'SAFE', score: alt.score },
      });
    }
  }

  // Sort: high severity first, then medium, then low
  const order = { high: 0, medium: 1, low: 2 };
  recommendations.sort((a, b) => (order[a.severity] || 2) - (order[b.severity] || 2));

  return {
    recommendations,
    verdict: conflicts.length === 0 ? 'SAFE' : 'BLOCKED',
  };
}

/**
 * Apply a recommendation action to a slot config, returning the updated slot.
 */
export function applyFix(slot, action) {
  const updated = JSON.parse(JSON.stringify(slot));

  if (action.adjustInset) {
    const inset = action.adjustInset;
    if (inset.bottom) updated.rect.top -= inset.bottom;
    if (inset.top) updated.rect.top += inset.top;
    if (inset.right) { updated.rect.left -= inset.right; updated.rect.width -= inset.right; }
    if (inset.all) {
      updated.rect.left += inset.all;
      updated.rect.top += inset.all;
      updated.rect.width -= inset.all * 2;
      updated.rect.height -= inset.all * 2;
    }
  }
  if (action.reduceHeight) {
    updated.rect.height = Math.round(updated.rect.height * action.reduceHeight);
  }
  if (action.reduceWidth) {
    updated.rect.width = Math.round(updated.rect.width * action.reduceWidth);
  }
  if (action.setBehavior) {
    updated.behavior = action.setBehavior;
  }
  if (action.disable) {
    updated.disabled = true;
  }

  return updated;
}

function formatRegion(region) {
  return region.replace(/-/g, ' ').replace(/\bzone\b/gi, '').trim()
    .replace(/\b\w/g, c => c.toUpperCase());
}
