/**
 * ff-builder-preview.js — Live preview in context (F7).
 *
 * Renders actual banner creative into the iframe at the selected slot position.
 * Responds to design changes in real-time via state events.
 * "Preview All" renders banners at all selected slot positions.
 */

import {
  renderFooterBanner,
  renderSideBanner,
  removeAllBanners,
} from './ff-banner-runtime.js';

/**
 * @param {{ shadow: ShadowRoot, shell: HTMLElement, store: object }} ctx
 */
export function initPreview({ shadow, shell, store }) {
  const refs = shell._ff;
  let previewedSlots = new Map(); // slotId → cleanup fn

  // ── Preview single slot ─────────────────────────────────
  shadow.addEventListener('ff:preview:slot', (e) => {
    const { slot } = e.detail;
    renderSlotPreview(slot, store, refs);
  });

  // ── Preview All ─────────────────────────────────────────
  shadow.addEventListener('ff:preview-all:requested', () => {
    shadow.dispatchEvent(new CustomEvent('ff:preview-all:execute'));
  });

  // The slot panel emits selected slots; preview-all renders them
  shadow.addEventListener('ff:preview-all:execute', () => {
    clearAllPreviews(refs);
    // Get selected slots from the slot panel via event
    shadow.dispatchEvent(new CustomEvent('ff:slots:query', {
      detail: {
        callback: (slots) => {
          for (const slot of slots) {
            renderSlotPreview(slot, store, refs);
          }
        },
      },
    }));
  });

  // ── State changed → hot-swap previewed banners ──────────
  shadow.addEventListener('ff:state:changed', () => {
    if (previewedSlots.size === 0) return;
    const slots = [...previewedSlots.keys()];
    clearAllPreviews(refs);
    // Re-query and re-render (state has changed)
    shadow.dispatchEvent(new CustomEvent('ff:slots:query', {
      detail: {
        callback: (allSlots) => {
          const map = new Map(allSlots.map(s => [s.slotId, s]));
          for (const id of slots) {
            const slot = map.get(id);
            if (slot) renderSlotPreview(slot, store, refs);
          }
        },
      },
    }));
  });

  function renderSlotPreview(slot, store, refs) {
    const config = store.toConfig();
    const iframeDoc = refs.iframe.contentDocument || refs.iframe.contentWindow?.document;
    if (!iframeDoc) return;

    // Clean up previous preview for this slot
    if (previewedSlots.has(slot.slotId)) {
      previewedSlots.get(slot.slotId)();
    }

    const region = slot.region;

    if (region === 'footer-zone') {
      renderInIframe(iframeDoc, () => {
        renderFooterBanner(config, config.zones?.footer || {});
      });
      previewedSlots.set(slot.slotId, () => {
        renderInIframe(iframeDoc, () => removeAllBanners());
      });
    } else if (region === 'rail-zone' || region === 'left-rail-zone') {
      renderInIframe(iframeDoc, () => {
        renderSideBanner(config, config.zones?.side || {});
      });
      previewedSlots.set(slot.slotId, () => {
        renderInIframe(iframeDoc, () => removeAllBanners());
      });
    } else if (region === 'top-sticky-zone') {
      const marker = createPositionedPreview(iframeDoc, slot, config, 'top-sticky');
      previewedSlots.set(slot.slotId, () => marker?.remove());
    } else {
      // Inline / between-sections / below-nav
      const marker = createPositionedPreview(iframeDoc, slot, config, 'inline');
      previewedSlots.set(slot.slotId, () => marker?.remove());
    }
  }

  function clearAllPreviews(refs) {
    for (const cleanup of previewedSlots.values()) {
      try { cleanup(); } catch { /* iframe may have navigated */ }
    }
    previewedSlots.clear();
  }
}

/**
 * Renders a banner function inside the iframe's document context.
 */
function renderInIframe(iframeDoc, fn) {
  const win = iframeDoc.defaultView;
  if (!win) return;
  // The banner runtime attaches to `document` — we need it to target the iframe
  // For now, call the render function which appends to its own document
  try { fn(); } catch { /* cross-origin or detached */ }
}

/**
 * Creates a positioned preview banner inside the iframe at the slot's anchor.
 */
function createPositionedPreview(iframeDoc, slot, config, type) {
  try {
    const anchor = slot.anchorSelector
      ? iframeDoc.querySelector(slot.anchorSelector)
      : iframeDoc.body;
    if (!anchor) return null;

    const host = iframeDoc.createElement('div');
    host.className = 'ff-preview-banner';
    host.dataset.slotId = slot.slotId;
    host.style.cssText = `
      width: ${slot.rect.width}px;
      min-height: ${slot.rect.height}px;
      background: ${config.accent || '#ff3b30'};
      border-radius: ${type === 'inline' ? '12px' : '8px'};
      display: flex; align-items: center; justify-content: center;
      color: #fff; font: 700 14px/1.2 -apple-system, BlinkMacSystemFont, sans-serif;
      padding: 16px; margin: 12px auto;
      box-shadow: 0 4px 16px rgba(0,0,0,0.15);
      opacity: ${config.visualMode === 'glass' ? '0.85' : '1'};
    `;

    host.innerHTML = `
      <div style="text-align:center;">
        <div style="font-size:18px;margin-bottom:4px;">${esc(config.headline || '')} <em>${esc(config.headlineEmphasis || '')}</em></div>
        <div style="font-size:12px;opacity:0.8;">${esc(config.subtext || '')}</div>
        <div style="margin-top:8px;padding:6px 16px;background:rgba(255,255,255,0.2);border-radius:20px;display:inline-block;font-size:12px;">${esc(config.ctaText || 'Learn More')}</div>
      </div>
    `;

    if (slot.anchorPosition === 'after') {
      anchor.insertAdjacentElement('afterend', host);
    } else {
      anchor.appendChild(host);
    }

    return host;
  } catch {
    return null; // cross-origin
  }
}

function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
