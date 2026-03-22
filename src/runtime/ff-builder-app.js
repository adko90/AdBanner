/**
 * ff-builder-app.js — Entry point for the visual banner builder.
 *
 * Usage:
 *   <script type="module" src="ff-builder-app.js" data-mode="editor" data-site="site_demo"></script>
 *
 * Modes:
 *   editor — bootstraps three-panel builder UI in closed Shadow DOM
 *   live   — delegates to ad-placement-loader.js (no builder UI)
 */

import { createBuilderState, getPublishedConfig } from './ff-builder-state.js';
import { createShell } from './ff-builder-shell.js';
import { initScanner } from './ff-builder-scanner.js';
import {
  resolveConfig,
  renderFooterBanner,
  renderSideBanner,
  removeAllBanners,
  isDismissed,
} from './ff-banner-runtime.js';

const scriptTag = document.currentScript || document.querySelector('script[data-mode]');
const mode = scriptTag?.getAttribute('data-mode') || 'live';
const siteId = scriptTag?.getAttribute('data-site') || 'site_demo';

if (mode === 'editor') {
  launchEditor(siteId);
} else {
  launchLive(siteId);
}

// ── Editor mode ─────────────────────────────────────────────

function launchEditor(siteId) {
  const host = document.createElement('div');
  host.id = 'ff-builder-root';
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: 'closed' });

  const store = createBuilderState(siteId, (key, value, state) => {
    shadow.dispatchEvent(new CustomEvent('ff:state:changed', {
      detail: { key, value, state },
    }));
  });

  const shell = createShell({ store, shadow, siteId });
  shadow.appendChild(shell);

  // Initialize scanner (F3)
  initScanner({ shadow, shell });

  // Ctrl+Shift+B toggle
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'B') {
      e.preventDefault();
      const root = shadow.querySelector('.ff-shell');
      if (root) {
        root.style.display = root.style.display === 'none' ? '' : 'none';
      }
    }
  });
}

// ── Live mode ───────────────────────────────────────────────

function launchLive(siteId) {
  const published = getPublishedConfig(siteId);
  if (!published) return;

  const config = resolveConfig(published);
  if (isDismissed(siteId)) return;

  if (config.zones?.footer?.enabled !== false) {
    renderFooterBanner(config, config.zones?.footer || {});
  }
  if (config.zones?.side?.enabled !== false) {
    renderSideBanner(config, config.zones?.side || {});
  }

  window.addEventListener('storage', (e) => {
    if (e.key === `ff_published_site_${siteId}` && e.newValue) {
      removeAllBanners();
      const updated = resolveConfig(JSON.parse(e.newValue));
      if (updated.zones?.footer?.enabled !== false) {
        renderFooterBanner(updated, updated.zones?.footer || {});
      }
      if (updated.zones?.side?.enabled !== false) {
        renderSideBanner(updated, updated.zones?.side || {});
      }
    }
  });
}
