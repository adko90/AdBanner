/**
 * ff-builder-ui.js — Visual builder panel UI (Shadow DOM)
 *
 * Renders a draggable floating panel inside a closed Shadow DOM root.
 * All inputs update reactive state which triggers live banner preview.
 */

import { removeAllBanners, renderFooterBanner, renderSideBanner, isDismissed, clearDismissed } from './ff-banner-runtime.js';

/**
 * Creates and returns the builder panel host element.
 * @param {Object} store - The builder state store from createBuilderState()
 * @returns {HTMLElement} The shadow host element (append to document)
 */
export function createBuilderPanel(store) {
  const host = document.createElement('div');
  host.id = 'ff-builder-host';
  host.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;';

  const shadow = host.attachShadow({ mode: 'closed' });
  const state = store.state;

  let panelVisible = true;
  let panelX = window.innerWidth - 340;
  let panelY = 20;
  let dragging = false;
  let dragOffsetX = 0, dragOffsetY = 0;

  function renderPanel() {
    const s = store.toConfig();
    const published = store.loadPublished();
    const publishedLabel = published ? 'Published ' + new Date(published.publishedAt).toLocaleTimeString() : 'Not published';

    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif; }

        .panel {
          position: fixed;
          top: ${panelY}px;
          left: ${panelX}px;
          width: 310px;
          max-height: calc(100vh - 40px);
          background: rgba(18, 18, 24, 0.95);
          -webkit-backdrop-filter: blur(24px) saturate(180%);
          backdrop-filter: blur(24px) saturate(180%);
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 16px;
          box-shadow: 0 24px 80px rgba(0, 0, 0, 0.5);
          color: #e4e4e7;
          overflow: hidden;
          display: ${panelVisible ? 'flex' : 'none'};
          flex-direction: column;
          z-index: 2147483647;
        }

        .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 16px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
          cursor: grab;
          user-select: none;
          -webkit-user-select: none;
        }
        .header:active { cursor: grabbing; }
        .header-title {
          font-size: 13px;
          font-weight: 700;
          letter-spacing: 0.02em;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .header-title .logo {
          width: 20px; height: 20px;
          background: linear-gradient(135deg, #ff3b30, #ff6b35);
          border-radius: 5px;
          display: flex; align-items: center; justify-content: center;
          font-size: 10px; font-weight: 900; color: #fff;
        }
        .header-actions { display: flex; gap: 4px; }
        .header-btn {
          width: 28px; height: 28px; border-radius: 6px; border: none;
          background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.5);
          font-size: 14px; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          min-width: 28px; min-height: 28px;
        }
        .header-btn:hover { background: rgba(255,255,255,0.12); color: #fff; }
        .header-btn:focus-visible { outline: 2px solid #ff3b30; outline-offset: 1px; }

        .body {
          flex: 1;
          overflow-y: auto;
          padding: 12px 16px 16px;
        }
        .body::-webkit-scrollbar { width: 4px; }
        .body::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 2px; }

        .section {
          margin-bottom: 16px;
        }
        .section-label {
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: rgba(255,255,255,0.35);
          margin-bottom: 8px;
        }

        .toggle-group {
          display: flex;
          gap: 4px;
          background: rgba(255,255,255,0.04);
          border-radius: 8px;
          padding: 3px;
        }
        .toggle-btn {
          flex: 1;
          padding: 7px 0;
          border: none;
          border-radius: 6px;
          background: transparent;
          color: rgba(255,255,255,0.5);
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
          min-height: 32px;
          transition: all 0.15s;
        }
        .toggle-btn.active {
          background: rgba(255,255,255,0.12);
          color: #fff;
          box-shadow: 0 1px 3px rgba(0,0,0,0.3);
        }
        .toggle-btn:hover:not(.active) { color: rgba(255,255,255,0.75); }
        .toggle-btn:focus-visible { outline: 2px solid #ff3b30; outline-offset: -2px; }

        .input-group { margin-bottom: 10px; }
        .input-label {
          display: block;
          font-size: 10px;
          font-weight: 600;
          color: rgba(255,255,255,0.45);
          margin-bottom: 4px;
        }
        .input-field {
          width: 100%;
          padding: 8px 10px;
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 8px;
          background: rgba(255,255,255,0.04);
          color: #e4e4e7;
          font-size: 12px;
          outline: none;
        }
        .input-field:focus { border-color: rgba(255,255,255,0.25); }
        .input-field::placeholder { color: rgba(255,255,255,0.2); }

        .color-row {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .color-picker {
          width: 36px; height: 36px;
          border: 2px solid rgba(255,255,255,0.15);
          border-radius: 8px;
          padding: 0;
          cursor: pointer;
          background: none;
          -webkit-appearance: none;
        }
        .color-picker::-webkit-color-swatch-wrapper { padding: 2px; }
        .color-picker::-webkit-color-swatch { border: none; border-radius: 4px; }
        .color-hex {
          font-size: 12px;
          font-family: 'SF Mono', 'Menlo', monospace;
          color: rgba(255,255,255,0.6);
        }

        .checkbox-row {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 0;
        }
        .checkbox-row input[type="checkbox"] {
          width: 16px; height: 16px;
          accent-color: #ff3b30;
          cursor: pointer;
        }
        .checkbox-row label {
          font-size: 12px;
          color: rgba(255,255,255,0.7);
          cursor: pointer;
        }

        .footer-bar {
          display: flex;
          gap: 6px;
          padding: 12px 16px;
          border-top: 1px solid rgba(255,255,255,0.08);
        }
        .action-btn {
          flex: 1;
          padding: 10px 0;
          border: none;
          border-radius: 8px;
          font-size: 11px;
          font-weight: 700;
          cursor: pointer;
          min-height: 40px;
          transition: all 0.15s;
        }
        .btn-preview {
          background: rgba(255,255,255,0.08);
          color: rgba(255,255,255,0.75);
        }
        .btn-preview:hover { background: rgba(255,255,255,0.14); color: #fff; }
        .btn-publish {
          background: #ff3b30;
          color: #fff;
        }
        .btn-publish:hover { background: #ff5147; }
        .btn-snippet {
          background: rgba(255,255,255,0.06);
          color: rgba(255,255,255,0.6);
        }
        .btn-snippet:hover { background: rgba(255,255,255,0.1); color: #fff; }
        .action-btn:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }

        .status-bar {
          padding: 6px 16px;
          font-size: 9px;
          color: rgba(255,255,255,0.3);
          text-align: center;
          border-top: 1px solid rgba(255,255,255,0.04);
        }
        .status-live { color: #34d399; }
        .status-draft { color: #fbbf24; }

        @media (prefers-reduced-motion: reduce) {
          *, *::before, *::after { transition: none !important; }
        }
      </style>

      <div class="panel" role="dialog" aria-label="Banner Builder">
        <div class="header" data-action="drag">
          <div class="header-title">
            <div class="logo">FF</div>
            Banner Builder
          </div>
          <div class="header-actions">
            <button class="header-btn" data-action="minimize" aria-label="Minimize" tabindex="0">_</button>
            <button class="header-btn" data-action="close" aria-label="Close" tabindex="0">&times;</button>
          </div>
        </div>

        <div class="body">
          <!-- Visual Mode -->
          <div class="section">
            <div class="section-label">Visual Mode</div>
            <div class="toggle-group" data-field="mode">
              <button class="toggle-btn ${s.mode === 'solid' ? 'active' : ''}" data-val="solid" tabindex="0">Solid</button>
              <button class="toggle-btn ${s.mode === 'glass' ? 'active' : ''}" data-val="glass" tabindex="0">Glass</button>
            </div>
          </div>

          <!-- Shape Preset -->
          <div class="section">
            <div class="section-label">Shape Preset</div>
            <div class="toggle-group" data-field="preset">
              <button class="toggle-btn ${s.preset === 'capsule' ? 'active' : ''}" data-val="capsule" tabindex="0">Capsule</button>
              <button class="toggle-btn ${s.preset === 'angled' ? 'active' : ''}" data-val="angled" tabindex="0">Angled</button>
              <button class="toggle-btn ${s.preset === 'signature' ? 'active' : ''}" data-val="signature" tabindex="0">Wave</button>
            </div>
          </div>

          <!-- Accent Color -->
          <div class="section">
            <div class="section-label">Accent Color</div>
            <div class="color-row">
              <input type="color" class="color-picker" data-field="accent" value="${s.accent}">
              <span class="color-hex">${s.accent}</span>
            </div>
          </div>

          <!-- Content -->
          <div class="section">
            <div class="section-label">Content</div>
            <div class="input-group">
              <label class="input-label">Headline</label>
              <input class="input-field" data-field="headline" value="${escapeAttr(s.headline)}" placeholder="Headline">
            </div>
            <div class="input-group">
              <label class="input-label">Emphasis</label>
              <input class="input-field" data-field="headlineEmphasis" value="${escapeAttr(s.headlineEmphasis)}" placeholder="Emphasis text">
            </div>
            <div class="input-group">
              <label class="input-label">Subtext</label>
              <input class="input-field" data-field="subtext" value="${escapeAttr(s.subtext)}" placeholder="Subtext">
            </div>
            <div class="input-group">
              <label class="input-label">CTA Text</label>
              <input class="input-field" data-field="ctaText" value="${escapeAttr(s.ctaText)}" placeholder="Shop Now">
            </div>
            <div class="input-group">
              <label class="input-label">CTA URL</label>
              <input class="input-field" data-field="ctaUrl" value="${escapeAttr(s.ctaUrl)}" placeholder="https://...">
            </div>
            <div class="input-group">
              <label class="input-label">Brand Name</label>
              <input class="input-field" data-field="brand" value="${escapeAttr(s.brand)}" placeholder="Brand Name">
            </div>
          </div>

          <!-- Side Panel Content -->
          <div class="section">
            <div class="section-label">Side Panel Content</div>
            <div class="input-group">
              <label class="input-label">Side Headline</label>
              <input class="input-field" data-field="sideHeadline" value="${escapeAttr(s.sideHeadline)}" placeholder="Headline">
            </div>
            <div class="input-group">
              <label class="input-label">Side Emphasis</label>
              <input class="input-field" data-field="sideHeadlineEmphasis" value="${escapeAttr(s.sideHeadlineEmphasis)}" placeholder="Emphasis">
            </div>
            <div class="input-group">
              <label class="input-label">Side Subtext</label>
              <input class="input-field" data-field="sideSubtext" value="${escapeAttr(s.sideSubtext)}" placeholder="Subtext">
            </div>
          </div>

          <!-- Placement -->
          <div class="section">
            <div class="section-label">Placement</div>
            <div class="checkbox-row">
              <input type="checkbox" id="ff-zone-footer" ${s.zones.footer.enabled ? 'checked' : ''} data-zone="footer">
              <label for="ff-zone-footer">Footer Banner</label>
            </div>
            <div class="checkbox-row">
              <input type="checkbox" id="ff-zone-side" ${s.zones.side.enabled ? 'checked' : ''} data-zone="side">
              <label for="ff-zone-side">Side Panel</label>
            </div>
          </div>
        </div>

        <div class="footer-bar">
          <button class="action-btn btn-preview" data-action="preview" tabindex="0">Preview</button>
          <button class="action-btn btn-publish" data-action="publish" tabindex="0">Publish</button>
          <button class="action-btn btn-snippet" data-action="snippet" tabindex="0">Snippet</button>
        </div>

        <div class="status-bar ${published ? 'status-live' : 'status-draft'}">
          ${publishedLabel}
        </div>
      </div>`;

    wireEvents();
  }

  function wireEvents() {
    const panel = shadow.querySelector('.panel');
    if (!panel) return;

    // Drag
    const header = shadow.querySelector('.header');
    header.addEventListener('pointerdown', e => {
      if (e.target.closest('[data-action="minimize"]') || e.target.closest('[data-action="close"]')) return;
      dragging = true;
      dragOffsetX = e.clientX - panelX;
      dragOffsetY = e.clientY - panelY;
      header.style.cursor = 'grabbing';
      e.preventDefault();
    });

    // Toggle groups (mode, preset)
    shadow.querySelectorAll('.toggle-group').forEach(group => {
      const field = group.dataset.field;
      group.querySelectorAll('.toggle-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          state[field] = btn.dataset.val;
          renderPreview();
          renderPanel();
        });
      });
    });

    // Color picker
    const colorPicker = shadow.querySelector('[data-field="accent"]');
    if (colorPicker) {
      colorPicker.addEventListener('input', e => {
        state.accent = e.target.value;
        const hex = shadow.querySelector('.color-hex');
        if (hex) hex.textContent = e.target.value;
        renderPreview();
      });
    }

    // Text inputs
    shadow.querySelectorAll('.input-field').forEach(input => {
      const field = input.dataset.field;
      input.addEventListener('input', () => {
        state[field] = input.value;
        renderPreview();
      });
    });

    // Zone checkboxes
    shadow.querySelectorAll('[data-zone]').forEach(cb => {
      cb.addEventListener('change', () => {
        const zone = cb.dataset.zone;
        state.zones[zone].enabled = cb.checked;
        renderPreview();
      });
    });

    // Header actions
    shadow.querySelector('[data-action="minimize"]')?.addEventListener('click', () => {
      panelVisible = false;
      renderPanel();
    });
    shadow.querySelector('[data-action="close"]')?.addEventListener('click', () => {
      panelVisible = false;
      renderPanel();
    });

    // Footer actions
    shadow.querySelector('[data-action="preview"]')?.addEventListener('click', () => {
      renderPreview();
    });

    shadow.querySelector('[data-action="publish"]')?.addEventListener('click', () => {
      store.publish();
      renderPanel();
    });

    shadow.querySelector('[data-action="snippet"]')?.addEventListener('click', () => {
      const siteId = store.getSiteId();
      const snippet = `<script src="/runtime/ff-builder.js" data-site="${siteId}" data-mode="live"><\/script>`;
      navigator.clipboard.writeText(snippet).then(() => {
        const btn = shadow.querySelector('[data-action="snippet"]');
        if (btn) { btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = 'Snippet'; }, 1500); }
      }).catch(() => {
        window.prompt('Copy install snippet:', snippet);
      });
    });

    // Keyboard: Escape to close panel
    panel.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        panelVisible = false;
        renderPanel();
      }
    });
  }

  // Global pointer handlers for drag (attached to document)
  function onPointerMove(e) {
    if (!dragging) return;
    panelX = clampPos(e.clientX - dragOffsetX, 0, window.innerWidth - 320);
    panelY = clampPos(e.clientY - dragOffsetY, 0, window.innerHeight - 100);
    const panel = shadow.querySelector('.panel');
    if (panel) {
      panel.style.left = panelX + 'px';
      panel.style.top = panelY + 'px';
    }
  }

  function onPointerUp() {
    if (!dragging) return;
    dragging = false;
    const header = shadow.querySelector('.header');
    if (header) header.style.cursor = 'grab';
  }

  document.addEventListener('pointermove', onPointerMove);
  document.addEventListener('pointerup', onPointerUp);

  // Ctrl+Shift+B toggle
  document.addEventListener('keydown', e => {
    if (e.ctrlKey && e.shiftKey && e.key === 'B') {
      e.preventDefault();
      panelVisible = !panelVisible;
      renderPanel();
    }
  });

  function renderPreview() {
    removeAllBanners();
    clearDismissed('footer');
    clearDismissed('side');

    const cfg = store.toConfig();

    if (cfg.zones.footer.enabled) {
      const footerHost = renderFooterBanner(cfg);
      document.documentElement.appendChild(footerHost);
    }

    if (cfg.zones.side.enabled && getDeviceClass() === 'desktop') {
      const sideHost = renderSideBanner(cfg);
      document.documentElement.appendChild(sideHost);
    }
  }

  // Initial render
  renderPanel();
  renderPreview();

  // Cleanup function
  host._destroy = function () {
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);
    removeAllBanners();
    host.remove();
  };

  return host;
}

function clampPos(val, min, max) {
  return Math.min(Math.max(val, min), max);
}

function getDeviceClass() {
  if (window.innerWidth < 768) return 'mobile';
  if (window.innerWidth < 1100) return 'tablet';
  return 'desktop';
}

function escapeAttr(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
