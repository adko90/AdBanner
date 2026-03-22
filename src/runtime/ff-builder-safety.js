/**
 * ff-builder-safety.js — Injection confirmation + safety assessment (F8+F9).
 *
 * F8: DOM tree view showing injection point, method, surrounding elements.
 * F9: Per-slot safety verdicts gating the Publish button.
 */

import { getRecommendations } from './ff-builder-recommendations.js';

/**
 * Renders injection confirmation and safety assessment for a slot.
 *
 * @param {{ slot: object, mapResult: object, collisionPadding: object, alternatives: object[] }} params
 * @returns {HTMLElement}
 */
export function createSafetyPanel({ slot, mapResult, collisionPadding, alternatives }) {
  const el = document.createElement('div');
  el.className = 'ff-safety-panel';

  const style = document.createElement('style');
  style.textContent = safetyStyles();
  el.appendChild(style);

  // ── F8: Injection Confirmation ──────────────────────────
  const injectionSection = document.createElement('div');
  injectionSection.className = 'ff-injection-section';

  const method = getInjectionMethod(slot);
  const domOutline = mapResult?.domOutline || [];

  injectionSection.innerHTML = `
    <h4 class="ff-safety-heading">Injection Point</h4>
    <div class="ff-injection-detail">
      <span class="ff-injection-label">Method</span>
      <code class="ff-injection-code">${method}</code>
    </div>
    <div class="ff-injection-detail">
      <span class="ff-injection-label">Target</span>
      <code class="ff-injection-code">${esc(slot.anchorSelector || 'document.body')}</code>
    </div>
    <div class="ff-injection-detail">
      <span class="ff-injection-label">Position</span>
      <span>${slot.anchorPosition || 'append'}</span>
    </div>
    <div class="ff-dom-tree">
      <h5 class="ff-dom-tree-title">DOM Context</h5>
      ${renderDomOutline(domOutline, slot.anchorSelector)}
    </div>
    <div class="ff-injection-guarantees">
      <div class="ff-guarantee ff-guarantee-safe">Shadow DOM isolated — no host CSS leakage</div>
      <div class="ff-guarantee ff-guarantee-safe">No existing DOM elements modified</div>
      <div class="ff-guarantee ff-guarantee-safe">Layout impact: ${getLayoutImpact(slot)}</div>
    </div>
  `;
  el.appendChild(injectionSection);

  // ── F9: Safety Assessment ───────────────────────────────
  const safetySection = document.createElement('div');
  safetySection.className = 'ff-assessment-section';

  const protectedRegions = mapResult?.protectedRegions || [];
  const conflicts = findConflicts(slot, protectedRegions, collisionPadding);
  const { recommendations, verdict } = getRecommendations(
    slot, conflicts, collisionPadding, alternatives || []
  );

  const checks = buildChecks(slot, conflicts, mapResult);

  safetySection.innerHTML = `
    <h4 class="ff-safety-heading">Safety Assessment</h4>
    <div class="ff-checks">
      ${checks.map(c => `
        <div class="ff-check ff-check-${c.status.toLowerCase()}">
          <span class="ff-check-icon">${statusIcon(c.status)}</span>
          <span class="ff-check-label">${c.label}</span>
          <span class="ff-check-detail">${c.detail || ''}</span>
        </div>
      `).join('')}
    </div>
    <div class="ff-verdict ff-verdict-${verdict.toLowerCase()}">
      ${verdict === 'SAFE' ? 'SAFE TO PUBLISH' : 'BLOCKED — resolve conflicts before publishing'}
    </div>
  `;

  // Recommendations (if any conflicts)
  if (recommendations.length > 0) {
    const recsEl = document.createElement('div');
    recsEl.className = 'ff-recommendations';
    recsEl.innerHTML = `<h4 class="ff-safety-heading">Recommendations</h4>`;
    for (const rec of recommendations) {
      const item = document.createElement('div');
      item.className = 'ff-rec-item';
      item.innerHTML = `
        <span class="ff-rec-severity ff-rec-${rec.severity}">${rec.severity.toUpperCase()}</span>
        <span class="ff-rec-desc">${rec.description}</span>
        <button class="ff-rec-apply ff-btn-tiny" data-action='${JSON.stringify(rec.action)}'>Apply Fix</button>
      `;
      recsEl.appendChild(item);
    }
    safetySection.appendChild(recsEl);
  }

  el.appendChild(safetySection);

  // Expose verdict for publish gating
  el._ffVerdict = verdict;
  el._ffConflicts = conflicts;

  return el;
}

// ── Helpers ───────────────────────────────────────────────────

function getInjectionMethod(slot) {
  if (slot.behavior === 'sticky-edge' || slot.behavior === 'desktop-edge') {
    return 'document.body.appendChild(shadowHost)';
  }
  if (slot.anchorPosition === 'after') {
    return `anchor.insertAdjacentElement('afterend', shadowHost)`;
  }
  return 'document.body.appendChild(shadowHost)';
}

function getLayoutImpact(slot) {
  if (slot.behavior === 'sticky-edge') return 'position:fixed — no reflow';
  if (slot.behavior === 'desktop-edge') return 'position:fixed — no reflow';
  return 'display:block — standard flow insertion';
}

function findConflicts(slot, protectedRegions, padding) {
  const p = padding || { footer: 18, side: 14, inline: 8 };
  const pad = slot.region.includes('footer') ? p.footer
    : slot.region.includes('rail') ? p.side
    : p.inline;

  return protectedRegions.filter(region => {
    return rectsOverlap(slot.rect, region.rect, pad);
  });
}

function rectsOverlap(a, b, padding) {
  return !(a.right <= (b.left - padding) || a.left >= (b.right + padding) ||
           a.bottom <= (b.top - padding) || a.top >= (b.bottom + padding));
}

function buildChecks(slot, conflicts, mapResult) {
  const checks = [];

  // Protected region collision
  if (conflicts.length === 0) {
    checks.push({ label: 'Protected region collision', status: 'SAFE', detail: 'No overlaps detected' });
  } else {
    for (const c of conflicts) {
      checks.push({ label: `${c.kind} collision`, status: 'BLOCKED', detail: `Overlaps ${c.kind} region` });
    }
  }

  // Shadow DOM isolation (always safe — architectural guarantee)
  checks.push({ label: 'Shadow DOM isolation', status: 'SAFE', detail: 'Closed shadow root' });

  // Layout impact
  checks.push({ label: 'Layout impact', status: 'SAFE', detail: getLayoutImpact(slot) });

  // Form proximity
  const formConflicts = conflicts.filter(c => c.kind === 'form');
  if (formConflicts.length > 0) {
    checks.push({ label: 'Form proximity', status: 'WARNING', detail: 'Form within collision padding' });
  } else {
    checks.push({ label: 'Form proximity', status: 'SAFE' });
  }

  // Navigation obscured
  const navConflicts = conflicts.filter(c => c.kind === 'navigation');
  if (navConflicts.length > 0) {
    checks.push({ label: 'Navigation visibility', status: 'WARNING', detail: 'May obscure navigation' });
  } else {
    checks.push({ label: 'Navigation visibility', status: 'SAFE' });
  }

  // Advisory notes
  const contentZones = mapResult?.contentZones || [];
  const shortArticle = contentZones.some(z => z.wordCount < 200);
  if (shortArticle && slot.region === 'content-break') {
    checks.push({ label: 'Short article', status: 'WARNING', detail: 'Article < 200 words — inline ad may feel intrusive' });
  }

  if (slot.risks?.includes('near-media')) {
    checks.push({ label: 'Media proximity', status: 'WARNING', detail: 'Near image or media — may feel cluttered' });
  }

  if (slot.risks?.includes('touch-target-small')) {
    checks.push({ label: 'Touch target', status: 'WARNING', detail: 'Below 48px minimum on mobile' });
  }

  return checks;
}

function renderDomOutline(outline, anchorSelector) {
  if (!outline || outline.length === 0) return '<div class="ff-dom-empty">No DOM outline available</div>';

  const anchorTag = anchorSelector
    ? anchorSelector.split(' > ').pop()?.split(':')[0]?.split('#')[0]?.split('.')[0]
    : null;

  let html = '<div class="ff-dom-nodes">';
  for (const node of outline) {
    const isTarget = anchorTag && node.tag === anchorTag;
    html += renderNode(node, 0, isTarget, anchorSelector);
  }
  html += '</div>';
  return html;
}

function renderNode(node, depth, isTarget, anchorSelector) {
  const indent = '  '.repeat(depth);
  const cls = isTarget ? ' ff-dom-target' : '';
  const idStr = node.id ? `#${node.id}` : '';
  const classStr = node.className ? `.${node.className.split(' ').join('.')}` : '';
  let html = `<div class="ff-dom-node${cls}" style="padding-left:${depth * 16}px">`;
  html += `${indent}&lt;${node.tag}${idStr}${classStr}&gt;`;
  if (isTarget) html += ' <span class="ff-dom-inject-marker">← injection point</span>';
  html += '</div>';

  if (node.children) {
    for (const child of node.children) {
      html += renderNode(child, depth + 1, false, anchorSelector);
    }
  }
  return html;
}

function statusIcon(status) {
  if (status === 'SAFE') return '&#x2714;';
  if (status === 'WARNING') return '&#x26A0;';
  return '&#x2718;';
}

function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function safetyStyles() {
  return `
    .ff-safety-panel { display: flex; flex-direction: column; gap: 16px; }

    .ff-safety-heading {
      font: 600 11px/1 inherit; color: #94a3b8;
      text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px;
    }

    /* Injection */
    .ff-injection-section { display: flex; flex-direction: column; gap: 8px; }
    .ff-injection-detail { display: flex; gap: 8px; font-size: 12px; align-items: baseline; }
    .ff-injection-label { color: #64748b; min-width: 56px; flex-shrink: 0; }
    .ff-injection-code {
      font: 11px/1.3 'SF Mono', Monaco, monospace;
      background: rgba(255,255,255,0.06); padding: 2px 6px;
      border-radius: 4px; color: #a5b4fc; word-break: break-all;
    }

    .ff-injection-guarantees { display: flex; flex-direction: column; gap: 4px; margin-top: 4px; }
    .ff-guarantee {
      padding: 4px 8px; border-radius: 6px; font-size: 11px;
    }
    .ff-guarantee-safe { background: rgba(34,197,94,0.1); color: #4ade80; }

    /* DOM tree */
    .ff-dom-tree { margin-top: 8px; }
    .ff-dom-tree-title { font: 600 11px/1 inherit; color: #64748b; margin-bottom: 6px; }
    .ff-dom-nodes {
      font: 11px/1.6 'SF Mono', Monaco, monospace;
      background: rgba(0,0,0,0.3); border-radius: 6px; padding: 8px;
      max-height: 180px; overflow-y: auto; color: #94a3b8;
    }
    .ff-dom-node { white-space: nowrap; }
    .ff-dom-target { color: #22c55e; font-weight: 600; }
    .ff-dom-inject-marker {
      color: #3b82f6; font-weight: 700; font-size: 10px;
    }
    .ff-dom-empty { color: #475569; font-size: 11px; font-style: italic; }

    /* Safety checks */
    .ff-checks { display: flex; flex-direction: column; gap: 4px; }
    .ff-check {
      display: flex; align-items: center; gap: 6px;
      padding: 5px 8px; border-radius: 6px; font-size: 12px;
    }
    .ff-check-safe { background: rgba(34,197,94,0.08); }
    .ff-check-warning { background: rgba(245,158,11,0.08); }
    .ff-check-blocked { background: rgba(239,68,68,0.08); }
    .ff-check-icon { font-size: 13px; flex-shrink: 0; }
    .ff-check-safe .ff-check-icon { color: #22c55e; }
    .ff-check-warning .ff-check-icon { color: #f59e0b; }
    .ff-check-blocked .ff-check-icon { color: #ef4444; }
    .ff-check-label { color: #cbd5e1; font-weight: 500; }
    .ff-check-detail { color: #64748b; margin-left: auto; }

    /* Verdict */
    .ff-verdict {
      padding: 8px 12px; border-radius: 8px;
      font: 700 13px/1 inherit; text-align: center;
    }
    .ff-verdict-safe { background: rgba(34,197,94,0.15); color: #22c55e; }
    .ff-verdict-blocked { background: rgba(239,68,68,0.15); color: #ef4444; }

    /* Recommendations */
    .ff-recommendations { margin-top: 8px; }
    .ff-rec-item {
      display: flex; align-items: center; gap: 6px;
      padding: 6px 8px; margin-bottom: 4px;
      background: rgba(255,255,255,0.04); border-radius: 6px;
      font-size: 12px;
    }
    .ff-rec-severity {
      font: 600 9px/1 inherit; padding: 2px 6px; border-radius: 4px;
      text-transform: uppercase; letter-spacing: 0.04em; flex-shrink: 0;
    }
    .ff-rec-high { background: rgba(239,68,68,0.2); color: #ef4444; }
    .ff-rec-medium { background: rgba(245,158,11,0.2); color: #f59e0b; }
    .ff-rec-low { background: rgba(59,130,246,0.2); color: #3b82f6; }
    .ff-rec-desc { flex: 1; color: #cbd5e1; }
    .ff-btn-tiny {
      background: rgba(255,255,255,0.06); border: none; border-radius: 4px;
      color: #94a3b8; font: 600 10px/1 inherit; padding: 3px 8px;
      cursor: pointer; min-height: 24px;
    }
    .ff-btn-tiny:hover { background: rgba(255,255,255,0.12); color: #e2e8f0; }
    .ff-btn-tiny:focus-visible { outline: 2px solid #3b82f6; outline-offset: 1px; }
  `;
}
