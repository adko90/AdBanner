/**
 * ff-builder-slot-panel.js — Slot selection and conflict display (F4).
 *
 * When a slot overlay is clicked, this panel opens in the config panel showing:
 * - Region, confidence score, device applicability
 * - Risks and any conflicts with exact collision geometry
 * - Multi-selection tracking for publish
 */

/**
 * @param {{ shadow: ShadowRoot, shell: HTMLElement, store: object }} ctx
 */
export function initSlotPanel({ shadow, shell, store }) {
  const configPanel = shell._ff.configPanel;
  const selectedSlots = new Map(); // slotId → slot
  let activeSlot = null;

  // Container for slot details (inserted above the design configurator)
  const slotSection = document.createElement('div');
  slotSection.className = 'ff-slot-section';
  slotSection.style.display = 'none';

  const style = document.createElement('style');
  style.textContent = slotPanelStyles();
  slotSection.appendChild(style);

  configPanel.insertBefore(slotSection, configPanel.firstChild);

  // ── Slot selected event ─────────────────────────────────
  shadow.addEventListener('ff:slot:selected', (e) => {
    const { slot } = e.detail;
    activeSlot = slot;

    // Toggle selection
    if (selectedSlots.has(slot.slotId)) {
      selectedSlots.delete(slot.slotId);
    } else {
      selectedSlots.set(slot.slotId, slot);
    }

    renderSlotDetails(slotSection, slot, selectedSlots);
    slotSection.style.display = '';

    shadow.dispatchEvent(new CustomEvent('ff:slot:active', {
      detail: { slot, selectedSlots: [...selectedSlots.values()] },
    }));
  });

  // ── Close slot panel ────────────────────────────────────
  slotSection.addEventListener('click', (e) => {
    if (e.target.closest('.ff-slot-close')) {
      slotSection.style.display = 'none';
      activeSlot = null;
    }
    if (e.target.closest('.ff-slot-deselect')) {
      const id = e.target.closest('.ff-slot-deselect').dataset.slotId;
      selectedSlots.delete(id);
      if (activeSlot?.slotId === id) activeSlot = null;
      if (selectedSlots.size === 0) {
        slotSection.style.display = 'none';
      } else {
        renderSlotDetails(slotSection, activeSlot || [...selectedSlots.values()][0], selectedSlots);
      }
      shadow.dispatchEvent(new CustomEvent('ff:slots:changed', {
        detail: { selectedSlots: [...selectedSlots.values()] },
      }));
    }
    if (e.target.closest('.ff-slot-preview')) {
      const id = e.target.closest('.ff-slot-preview').dataset.slotId;
      const slot = selectedSlots.get(id);
      if (slot) {
        shadow.dispatchEvent(new CustomEvent('ff:preview:slot', { detail: { slot } }));
      }
    }
  });

  return {
    getSelectedSlots: () => [...selectedSlots.values()],
    getActiveSlot: () => activeSlot,
  };
}

// ── Render ─────────────────────────────────────────────────────

function renderSlotDetails(container, slot, selectedSlots) {
  // Keep the style element
  const styleEl = container.querySelector('style');
  container.innerHTML = '';
  if (styleEl) container.appendChild(styleEl);

  // Header
  const header = document.createElement('div');
  header.className = 'ff-slot-header';
  header.innerHTML = `
    <h3 class="ff-slot-title">${formatRegion(slot.region)}</h3>
    <button class="ff-slot-close" aria-label="Close slot panel" title="Close">&times;</button>
  `;
  container.appendChild(header);

  // Score badge
  const tier = slot.score >= 0.80 ? 'safe' : slot.score >= 0.60 ? 'viable' : 'risky';
  const scoreBadge = document.createElement('div');
  scoreBadge.className = `ff-slot-score ff-slot-score-${tier}`;
  scoreBadge.innerHTML = `
    <span class="ff-slot-score-value">${slot.score.toFixed(2)}</span>
    <span class="ff-slot-score-label">${tier.toUpperCase()}</span>
  `;
  container.appendChild(scoreBadge);

  // Details grid
  const details = document.createElement('div');
  details.className = 'ff-slot-details';
  details.innerHTML = `
    <div class="ff-slot-detail">
      <span class="ff-slot-detail-label">Region</span>
      <span class="ff-slot-detail-value">${slot.region}</span>
    </div>
    <div class="ff-slot-detail">
      <span class="ff-slot-detail-label">Behavior</span>
      <span class="ff-slot-detail-value">${slot.behavior || '—'}</span>
    </div>
    <div class="ff-slot-detail">
      <span class="ff-slot-detail-label">Devices</span>
      <span class="ff-slot-detail-value">${(slot.deviceApplicability || []).join(', ')}</span>
    </div>
    <div class="ff-slot-detail">
      <span class="ff-slot-detail-label">Formats</span>
      <span class="ff-slot-detail-value">${(slot.supportedFormats || []).join(', ')}</span>
    </div>
    <div class="ff-slot-detail">
      <span class="ff-slot-detail-label">Anchor</span>
      <span class="ff-slot-detail-value ff-slot-anchor">${esc(slot.anchorSelector || '—')}</span>
    </div>
    <div class="ff-slot-detail">
      <span class="ff-slot-detail-label">Rect</span>
      <span class="ff-slot-detail-value">${slot.rect.width}×${slot.rect.height} @ (${slot.rect.left}, ${slot.rect.top})</span>
    </div>
  `;
  container.appendChild(details);

  // Risks / Conflicts
  if (slot.risks && slot.risks.length > 0) {
    const conflicts = document.createElement('div');
    conflicts.className = 'ff-slot-conflicts';
    conflicts.innerHTML = `<h4 class="ff-slot-conflicts-title">Conflicts</h4>`;
    for (const risk of slot.risks) {
      const item = document.createElement('div');
      item.className = 'ff-slot-conflict-item';
      item.innerHTML = `
        <span class="ff-slot-conflict-kind">${risk}</span>
        <span class="ff-slot-conflict-desc">${conflictDescription(risk)}</span>
      `;
      conflicts.appendChild(item);
    }
    container.appendChild(conflicts);
  }

  // Selected slots list
  if (selectedSlots.size > 0) {
    const list = document.createElement('div');
    list.className = 'ff-slot-selection';
    list.innerHTML = `<h4 class="ff-slot-selection-title">Selected (${selectedSlots.size})</h4>`;
    for (const [id, s] of selectedSlots) {
      const row = document.createElement('div');
      row.className = 'ff-slot-selection-row';
      row.innerHTML = `
        <span class="ff-slot-selection-name">${formatRegion(s.region)} · ${s.score.toFixed(2)}</span>
        <button class="ff-slot-preview ff-btn-tiny" data-slot-id="${id}" aria-label="Preview ${formatRegion(s.region)}">Preview</button>
        <button class="ff-slot-deselect ff-btn-tiny" data-slot-id="${id}" aria-label="Deselect ${formatRegion(s.region)}">&times;</button>
      `;
      list.appendChild(row);
    }
    container.appendChild(list);
  }
}

function conflictDescription(risk) {
  const descs = {
    'content-overlap': 'Slot overlaps main content area — may obscure text',
    'near-media': 'Close to an image or media element — may feel cluttered',
    'viewport-edge': 'Too close to viewport edge — risk of clipping',
    'touch-target-small': 'Height below 48px minimum touch target on mobile',
  };
  return descs[risk] || risk;
}

function formatRegion(region) {
  return region.replace(/-/g, ' ').replace(/\bzone\b/gi, '').trim()
    .replace(/\b\w/g, c => c.toUpperCase());
}

function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function slotPanelStyles() {
  return `
    .ff-slot-section {
      padding-bottom: 16px;
      margin-bottom: 16px;
      border-bottom: 1px solid rgba(255,255,255,0.08);
    }
    .ff-slot-header {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 10px;
    }
    .ff-slot-title { font: 700 15px/1 inherit; color: #f1f5f9; }
    .ff-slot-close {
      background: none; border: none; color: #94a3b8; font-size: 18px;
      cursor: pointer; padding: 4px 8px; line-height: 1;
    }
    .ff-slot-close:hover { color: #f1f5f9; }

    .ff-slot-score {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 4px 10px; border-radius: 8px; margin-bottom: 12px;
      font: 600 12px/1 inherit;
    }
    .ff-slot-score-safe { background: rgba(34,197,94,0.15); color: #22c55e; }
    .ff-slot-score-viable { background: rgba(245,158,11,0.15); color: #f59e0b; }
    .ff-slot-score-risky { background: rgba(239,68,68,0.15); color: #ef4444; }
    .ff-slot-score-value { font-size: 16px; }
    .ff-slot-score-label { font-size: 10px; letter-spacing: 0.05em; }

    .ff-slot-details { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
    .ff-slot-detail { display: flex; gap: 8px; font-size: 12px; }
    .ff-slot-detail-label { color: #64748b; min-width: 60px; flex-shrink: 0; }
    .ff-slot-detail-value { color: #cbd5e1; word-break: break-all; }
    .ff-slot-anchor { font-family: monospace; font-size: 11px; }

    .ff-slot-conflicts { margin-bottom: 12px; }
    .ff-slot-conflicts-title { font: 600 11px/1 inherit; color: #ef4444; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px; }
    .ff-slot-conflict-item {
      padding: 6px 8px; margin-bottom: 4px;
      background: rgba(239,68,68,0.08); border-radius: 6px;
      font-size: 12px;
    }
    .ff-slot-conflict-kind { color: #ef4444; font-weight: 600; display: block; }
    .ff-slot-conflict-desc { color: #94a3b8; display: block; margin-top: 2px; }

    .ff-slot-selection { margin-top: 12px; }
    .ff-slot-selection-title { font: 600 11px/1 inherit; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px; }
    .ff-slot-selection-row {
      display: flex; align-items: center; gap: 6px;
      padding: 4px 0; font-size: 12px; color: #cbd5e1;
    }
    .ff-slot-selection-name { flex: 1; }
    .ff-btn-tiny {
      background: rgba(255,255,255,0.06); border: none; border-radius: 4px;
      color: #94a3b8; font: 600 10px/1 inherit; padding: 3px 8px;
      cursor: pointer; min-height: 24px;
    }
    .ff-btn-tiny:hover { background: rgba(255,255,255,0.12); color: #e2e8f0; }
    .ff-btn-tiny:focus-visible { outline: 2px solid #3b82f6; outline-offset: 1px; }
  `;
}
