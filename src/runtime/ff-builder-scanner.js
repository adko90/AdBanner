/**
 * ff-builder-scanner.js — Site scanner integration.
 *
 * Handles "Paste URL → Scan" flow:
 * 1. POST /api/map-site → PlacementOpportunity[]
 * 2. GET /api/proxy-site → load proxied site into iframe
 * 3. Render slot overlays colour-coded by confidence
 * 4. Toggle protected region visualisation
 * 5. Cache per-device results for breakpoint switching
 */

const CONFIDENCE_COLORS = {
  high:   { border: '#22c55e', bg: 'rgba(34,197,94,0.08)',  label: '#16a34a' },
  medium: { border: '#f59e0b', bg: 'rgba(245,158,11,0.08)', label: '#d97706' },
  low:    { border: '#ef4444', bg: 'rgba(239,68,68,0.08)',   label: '#dc2626' },
};

/**
 * @param {{ shadow: ShadowRoot, shell: HTMLElement }} ctx
 */
export function initScanner({ shadow, shell }) {
  const refs = shell._ff;
  const cache = {}; // device → { mapResult, url }
  let currentResult = null;
  let showProtected = false;

  // ── Scan requested event ────────────────────────────────
  shadow.addEventListener('ff:scan:requested', async (e) => {
    const { url, device } = e.detail;
    const statusText = refs.statusText;

    // Check cache
    if (cache[device]?.url === url) {
      currentResult = cache[device].mapResult;
      renderOverlays(currentResult, refs);
      statusText.textContent = `Loaded cached ${device} scan`;
      return;
    }

    statusText.textContent = 'Scanning…';
    refs.toolbar.querySelector('.ff-btn-scan').disabled = true;

    try {
      // Load proxied site into iframe
      const proxyUrl = `/api/proxy-site?url=${encodeURIComponent(url)}`;
      refs.iframe.src = proxyUrl;

      // Map site
      const mapRes = await fetch('/api/map-site', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, device, browser: 'chromium' }),
      });

      if (!mapRes.ok) {
        throw new Error(`Scan failed: ${mapRes.status} ${mapRes.statusText}`);
      }

      const mapResult = await mapRes.json();
      currentResult = mapResult;
      cache[device] = { mapResult, url };

      // Wait for iframe to load before rendering overlays
      await new Promise((resolve) => {
        if (refs.iframe.contentDocument?.readyState === 'complete') {
          resolve();
        } else {
          refs.iframe.addEventListener('load', resolve, { once: true });
        }
      });

      renderOverlays(mapResult, refs);

      // Notify slot panel of scan data for safety assessment
      shadow.dispatchEvent(new CustomEvent('ff:scan:complete', {
        detail: {
          mapResult,
          alternatives: mapResult.opportunities || [],
        },
      }));

      const summary = mapResult.summary || {};
      statusText.textContent = `Found ${summary.totalSlots || 0} slots — `
        + `${summary.highConfidence || 0} safe, `
        + `${summary.mediumConfidence || 0} viable, `
        + `${summary.lowConfidence || 0} risky`;

    } catch (err) {
      statusText.textContent = `Scan error: ${err.message}`;
      console.error('[ff-scanner]', err);
    } finally {
      refs.toolbar.querySelector('.ff-btn-scan').disabled = false;
    }
  });

  // ── Device changed → re-render from cache or re-scan ───
  shadow.addEventListener('ff:device:changed', (e) => {
    const { device } = e.detail;
    const urlInput = refs.toolbar.querySelector('.ff-url-input');
    const url = urlInput.value.trim();
    if (!url) return;

    if (cache[device]?.url === url) {
      currentResult = cache[device].mapResult;
      renderOverlays(currentResult, refs);
      refs.statusText.textContent = `Loaded cached ${device} scan`;
    } else {
      shadow.dispatchEvent(new CustomEvent('ff:scan:requested', {
        detail: { url, device },
      }));
    }
  });

  // ── Protected region toggle ─────────────────────────────
  addProtectedToggle(refs, () => {
    showProtected = !showProtected;
    if (currentResult) renderOverlays(currentResult, refs);
    return showProtected;
  });

  // Expose for external modules
  return {
    getResult: () => currentResult,
    getCache: () => cache,
    isShowingProtected: () => showProtected,
  };
}

// ── Overlay rendering ─────────────────────────────────────────

function renderOverlays(mapResult, refs) {
  const layer = refs.overlayLayer;
  layer.innerHTML = '';

  const iframe = refs.iframe;
  const iframeRect = iframe.getBoundingClientRect();
  const parentRect = layer.getBoundingClientRect();
  const offsetX = iframeRect.left - parentRect.left;
  const offsetY = iframeRect.top - parentRect.top;

  // Scale factor (iframe may be CSS-scaled)
  const scaleX = iframeRect.width / (iframe.scrollWidth || iframe.offsetWidth || 1440);
  const scaleY = iframeRect.height / (iframe.scrollHeight || iframe.offsetHeight || 900);

  // Slot overlays
  const opportunities = mapResult.opportunities || [];
  for (const slot of opportunities) {
    const rect = slot.rect;
    const tier = slot.score >= 0.80 ? 'high' : slot.score >= 0.60 ? 'medium' : 'low';
    const colors = CONFIDENCE_COLORS[tier];

    const overlay = document.createElement('div');
    overlay.className = 'ff-slot-overlay';
    overlay.dataset.slotId = slot.slotId;
    overlay.dataset.region = slot.region;
    overlay.style.cssText = `
      position: absolute;
      left: ${offsetX + rect.left * scaleX}px;
      top: ${offsetY + rect.top * scaleY}px;
      width: ${rect.width * scaleX}px;
      height: ${rect.height * scaleY}px;
      border: 2px dashed ${colors.border};
      background: ${colors.bg};
      border-radius: 4px;
      pointer-events: auto;
      cursor: pointer;
      transition: background 0.15s;
    `;

    // Badge pill
    const badge = document.createElement('span');
    badge.className = 'ff-slot-badge';
    badge.textContent = `${formatRegion(slot.region)} · ${slot.score.toFixed(2)}`;
    badge.style.cssText = `
      position: absolute; top: 4px; left: 4px;
      padding: 2px 8px; border-radius: 10px;
      background: ${colors.border}; color: #fff;
      font: 600 10px/1.4 -apple-system, BlinkMacSystemFont, sans-serif;
      white-space: nowrap; pointer-events: none;
    `;
    overlay.appendChild(badge);

    // ARIA
    overlay.setAttribute('role', 'button');
    overlay.setAttribute('tabindex', '0');
    overlay.setAttribute('aria-label', `${formatRegion(slot.region)} slot, score ${slot.score.toFixed(2)}`);

    // Click → emit slot selected
    overlay.addEventListener('click', () => {
      layer.getRootNode().dispatchEvent(new CustomEvent('ff:slot:selected', {
        detail: { slot },
      }));
    });
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        overlay.click();
      }
    });

    // Hover effect
    overlay.addEventListener('mouseenter', () => {
      overlay.style.background = colors.bg.replace(/[\d.]+\)$/, '0.18)');
    });
    overlay.addEventListener('mouseleave', () => {
      overlay.style.background = colors.bg;
    });

    layer.appendChild(overlay);
  }

  // Protected regions (if toggled on)
  const protectedRegions = mapResult.protectedRegions || [];
  if (layer.getRootNode().__ffShowProtected) {
    for (const region of protectedRegions) {
      const rect = region.rect;
      const el = document.createElement('div');
      el.className = 'ff-protected-overlay';
      el.style.cssText = `
        position: absolute;
        left: ${offsetX + rect.left * scaleX}px;
        top: ${offsetY + rect.top * scaleY}px;
        width: ${rect.width * scaleX}px;
        height: ${rect.height * scaleY}px;
        background: rgba(239,68,68,0.12);
        border: 1px solid rgba(239,68,68,0.3);
        border-radius: 4px;
        pointer-events: none;
      `;

      const label = document.createElement('span');
      label.textContent = region.kind;
      label.style.cssText = `
        position: absolute; bottom: 4px; right: 4px;
        padding: 1px 6px; border-radius: 8px;
        background: rgba(239,68,68,0.8); color: #fff;
        font: 500 9px/1.4 -apple-system, BlinkMacSystemFont, sans-serif;
      `;
      el.appendChild(label);
      layer.appendChild(el);
    }
  }
}

function addProtectedToggle(refs, toggleFn) {
  const btn = document.createElement('button');
  btn.className = 'ff-btn ff-btn-secondary ff-btn-protected';
  btn.type = 'button';
  btn.textContent = 'Show Protected';
  btn.setAttribute('aria-label', 'Toggle protected region overlay');
  btn.setAttribute('aria-pressed', 'false');
  btn.style.cssText = 'margin-left: 8px;';

  btn.addEventListener('click', () => {
    const active = toggleFn();
    btn.textContent = active ? 'Hide Protected' : 'Show Protected';
    btn.setAttribute('aria-pressed', String(active));
    refs.overlayLayer.getRootNode().__ffShowProtected = active;
  });

  // Insert after device toggle
  const toolbarCenter = refs.toolbar.querySelector('.ff-toolbar-center');
  toolbarCenter.appendChild(btn);
}

function formatRegion(region) {
  return region.replace(/-/g, ' ').replace(/\bzone\b/gi, '').trim()
    .replace(/\b\w/g, c => c.toUpperCase());
}
