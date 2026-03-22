/**
 * ff-builder.js — Entry point for the visual banner builder overlay.
 *
 * Usage on creator's site:
 *   <script type="module" src="ff-builder.js" data-mode="editor" data-site="site_demo"></script>
 *
 * Modes:
 *   editor — injects the builder overlay (config panel + live preview)
 *   live   — renders published banners only (default)
 */

import { createBuilderState, getPublishedConfig } from './ff-builder-state.js';
import { createBuilderPanel } from './ff-builder-ui.js';
import {
  resolveConfig,
  renderFooterBanner,
  renderSideBanner,
  removeAllBanners,
  isDismissed
} from './ff-banner-runtime.js';

const scriptTag = document.currentScript || document.querySelector('script[data-mode]');
const mode = scriptTag?.getAttribute('data-mode') || 'live';
const siteId = scriptTag?.getAttribute('data-site') || 'site_demo';

if (mode === 'editor') {
  launchEditor(siteId);
} else {
  launchLive(siteId);
}

/**
 * Editor mode — inject builder overlay with live preview.
 */
function launchEditor(siteId) {
  const store = createBuilderState(siteId, () => {
    // Live preview on every state change is handled by the UI panel
  });

  const panel = createBuilderPanel(store);
  document.body.appendChild(panel);
}

/**
 * Live mode — render published banners for the site.
 */
function launchLive(siteId) {
  const published = getPublishedConfig(siteId);
  if (!published) return; // No published config — nothing to render

  const config = resolveConfig(published);

  if (isDismissed(siteId)) return;

  if (config.zones?.footer?.enabled !== false) {
    renderFooterBanner(config, config.zones?.footer || {});
  }

  if (config.zones?.side?.enabled !== false) {
    renderSideBanner(config, config.zones?.side || {});
  }

  // Listen for republish events (e.g. if editor is open in another tab)
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
