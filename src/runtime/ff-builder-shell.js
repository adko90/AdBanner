/**
 * ff-builder-shell.js — Three-panel builder layout.
 *
 * Layout: toolbar (top) + iframe preview (left) + config panel (right, 320px) + status bar (bottom)
 * All rendered inside the closed Shadow DOM created by ff-builder-app.js.
 */

import { createConfigurator } from './ff-builder-configurator.js';

const DEVICE_PRESETS = {
  desktop: { width: 1440, height: 900, label: 'Desktop' },
  tablet:  { width: 820,  height: 1180, label: 'Tablet' },
  mobile:  { width: 390,  height: 844,  label: 'Mobile' },
};

/**
 * @param {{ store: object, shadow: ShadowRoot, siteId: string }} ctx
 * @returns {HTMLElement}
 */
export function createShell({ store, shadow, siteId }) {
  const wrapper = document.createElement('div');
  wrapper.className = 'ff-shell';
  wrapper.setAttribute('role', 'application');
  wrapper.setAttribute('aria-label', 'Banner Builder');

  // ── Styles ──────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = shellStyles();
  wrapper.appendChild(style);

  // ── Toolbar ─────────────────────────────────────────────
  const toolbar = document.createElement('div');
  toolbar.className = 'ff-toolbar';
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', 'Builder toolbar');
  toolbar.innerHTML = `
    <div class="ff-toolbar-left">
      <input class="ff-url-input" type="url" placeholder="Paste site URL to scan…"
             aria-label="Site URL" autocomplete="url" />
      <button class="ff-btn ff-btn-scan" type="button" aria-label="Scan site">Scan</button>
    </div>
    <div class="ff-toolbar-center">
      <div class="ff-device-toggle" role="radiogroup" aria-label="Device preview">
        <button class="ff-device-btn active" data-device="desktop" role="radio" aria-checked="true">Desktop</button>
        <button class="ff-device-btn" data-device="tablet" role="radio" aria-checked="false">Tablet</button>
        <button class="ff-device-btn" data-device="mobile" role="radio" aria-checked="false">Mobile</button>
      </div>
    </div>
    <div class="ff-toolbar-right">
      <button class="ff-btn ff-btn-icon" type="button" aria-label="Help" title="Help">?</button>
    </div>
  `;
  wrapper.appendChild(toolbar);

  // ── Main area: iframe + config panel ────────────────────
  const main = document.createElement('div');
  main.className = 'ff-main';

  // Preview container
  const previewArea = document.createElement('div');
  previewArea.className = 'ff-preview-area';

  const iframe = document.createElement('iframe');
  iframe.className = 'ff-preview-iframe';
  iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
  iframe.setAttribute('title', 'Site preview');
  iframe.setAttribute('aria-label', 'Site preview');
  previewArea.appendChild(iframe);

  // Slot overlay container (positioned over iframe)
  const overlayLayer = document.createElement('div');
  overlayLayer.className = 'ff-overlay-layer';
  overlayLayer.setAttribute('aria-hidden', 'true');
  previewArea.appendChild(overlayLayer);

  main.appendChild(previewArea);

  // Config panel (right side, 320px)
  const configPanel = document.createElement('div');
  configPanel.className = 'ff-config-panel';
  configPanel.setAttribute('role', 'complementary');
  configPanel.setAttribute('aria-label', 'Configuration panel');

  // Inject the design configurator (F6)
  const configurator = createConfigurator({ store, shadow });
  configPanel.appendChild(configurator);

  main.appendChild(configPanel);
  wrapper.appendChild(main);

  // ── Status bar ──────────────────────────────────────────
  const statusBar = document.createElement('div');
  statusBar.className = 'ff-status-bar';
  statusBar.innerHTML = `
    <span class="ff-status-text">Ready</span>
    <div class="ff-status-actions">
      <button class="ff-btn ff-btn-secondary" type="button" aria-label="Preview all placements">Preview All</button>
      <button class="ff-btn ff-btn-primary" type="button" aria-label="Publish configuration">Publish</button>
      <button class="ff-btn ff-btn-secondary" type="button" aria-label="Export install snippet">Export Snippet</button>
    </div>
  `;
  wrapper.appendChild(statusBar);

  // ── Device toggle wiring ────────────────────────────────
  let activeDevice = 'desktop';

  toolbar.querySelector('.ff-device-toggle').addEventListener('click', (e) => {
    const btn = e.target.closest('.ff-device-btn');
    if (!btn) return;
    const device = btn.dataset.device;
    if (device === activeDevice) return;

    activeDevice = device;
    toolbar.querySelectorAll('.ff-device-btn').forEach(b => {
      const isActive = b.dataset.device === device;
      b.classList.toggle('active', isActive);
      b.setAttribute('aria-checked', String(isActive));
    });

    const preset = DEVICE_PRESETS[device];
    iframe.style.width = preset.width + 'px';
    iframe.style.height = preset.height + 'px';

    shadow.dispatchEvent(new CustomEvent('ff:device:changed', {
      detail: { device, preset },
    }));
  });

  // ── Scan button wiring (event-driven, scanner module handles API) ──
  toolbar.querySelector('.ff-btn-scan').addEventListener('click', () => {
    const url = toolbar.querySelector('.ff-url-input').value.trim();
    if (!url) return;
    shadow.dispatchEvent(new CustomEvent('ff:scan:requested', {
      detail: { url, device: activeDevice },
    }));
  });

  // URL input: Enter key triggers scan
  toolbar.querySelector('.ff-url-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      toolbar.querySelector('.ff-btn-scan').click();
    }
  });

  // ── Status bar wiring (publish/preview events) ─────────
  statusBar.querySelector('[aria-label="Publish configuration"]').addEventListener('click', () => {
    shadow.dispatchEvent(new CustomEvent('ff:publish:requested'));
  });

  statusBar.querySelector('[aria-label="Preview all placements"]').addEventListener('click', () => {
    shadow.dispatchEvent(new CustomEvent('ff:preview-all:requested'));
  });

  statusBar.querySelector('[aria-label="Export install snippet"]').addEventListener('click', () => {
    shadow.dispatchEvent(new CustomEvent('ff:export:requested'));
  });

  // ── Draft save indicator ───────────────────────────────
  const statusText = statusBar.querySelector('.ff-status-text');
  window.addEventListener('ff:config:changed', () => {
    statusText.textContent = 'Draft saved just now';
  });

  // Expose refs for other modules
  wrapper._ff = { iframe, overlayLayer, configPanel, statusText, toolbar };

  return wrapper;
}

// ── Styles ────────────────────────────────────────────────────

function shellStyles() {
  return `
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    .ff-shell {
      position: fixed; inset: 0; z-index: 1;
      display: flex; flex-direction: column;
      background: #0f172a; color: #e2e8f0;
      font: 13px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      pointer-events: auto;
    }

    /* Toolbar */
    .ff-toolbar {
      display: flex; align-items: center; gap: 12px;
      padding: 8px 16px; background: #1e293b;
      border-bottom: 1px solid rgba(255,255,255,0.06);
      min-height: 48px;
    }
    .ff-toolbar-left { display: flex; gap: 8px; flex: 1; }
    .ff-toolbar-center { display: flex; }
    .ff-toolbar-right { display: flex; }

    .ff-url-input {
      flex: 1; max-width: 480px; padding: 6px 12px;
      border: 1px solid rgba(255,255,255,0.12); border-radius: 6px;
      background: rgba(255,255,255,0.06); color: #f1f5f9;
      font: inherit; outline: none;
    }
    .ff-url-input:focus { border-color: #3b82f6; box-shadow: 0 0 0 2px rgba(59,130,246,0.25); }
    .ff-url-input::placeholder { color: #64748b; }

    /* Buttons */
    .ff-btn {
      padding: 6px 14px; border: none; border-radius: 6px;
      font: 600 12px/1 inherit; cursor: pointer;
      min-height: 32px; min-width: 44px;
      transition: background 0.15s, opacity 0.15s;
    }
    .ff-btn:focus-visible { outline: 2px solid #3b82f6; outline-offset: 2px; }
    .ff-btn-scan { background: #3b82f6; color: #fff; }
    .ff-btn-scan:hover { background: #2563eb; }
    .ff-btn-primary { background: #22c55e; color: #0f172a; }
    .ff-btn-primary:hover { background: #16a34a; }
    .ff-btn-secondary { background: rgba(255,255,255,0.08); color: #cbd5e1; }
    .ff-btn-secondary:hover { background: rgba(255,255,255,0.14); }
    .ff-btn-icon {
      width: 32px; height: 32px; padding: 0;
      background: rgba(255,255,255,0.06); color: #94a3b8;
      font-weight: 700; font-size: 14px; border-radius: 50%;
    }
    .ff-btn-icon:hover { background: rgba(255,255,255,0.12); }

    /* Device toggle */
    .ff-device-toggle {
      display: flex; gap: 2px; padding: 2px;
      background: rgba(255,255,255,0.06); border-radius: 8px;
    }
    .ff-device-btn {
      padding: 5px 12px; border: none; border-radius: 6px;
      background: transparent; color: #94a3b8;
      font: 600 11px/1 inherit; cursor: pointer;
      min-height: 28px;
      transition: background 0.15s, color 0.15s;
    }
    .ff-device-btn:hover { color: #e2e8f0; }
    .ff-device-btn.active { background: #3b82f6; color: #fff; }
    .ff-device-btn:focus-visible { outline: 2px solid #3b82f6; outline-offset: 1px; }

    /* Main area */
    .ff-main {
      flex: 1; display: flex; overflow: hidden;
    }

    /* Preview area */
    .ff-preview-area {
      flex: 1; position: relative; overflow: auto;
      display: flex; align-items: flex-start; justify-content: center;
      padding: 16px; background: #111827;
    }
    .ff-preview-iframe {
      width: 1440px; height: 900px; border: none;
      border-radius: 8px; background: #fff;
      box-shadow: 0 4px 24px rgba(0,0,0,0.4);
      transform-origin: top center;
    }
    .ff-overlay-layer {
      position: absolute; inset: 0;
      pointer-events: none;
    }

    /* Config panel */
    .ff-config-panel {
      width: 320px; min-width: 320px;
      background: #1e293b; border-left: 1px solid rgba(255,255,255,0.06);
      overflow-y: auto; padding: 16px;
    }

    /* Status bar */
    .ff-status-bar {
      display: flex; align-items: center; justify-content: space-between;
      padding: 8px 16px; background: #1e293b;
      border-top: 1px solid rgba(255,255,255,0.06);
      min-height: 44px;
    }
    .ff-status-text { color: #64748b; font-size: 12px; }
    .ff-status-actions { display: flex; gap: 8px; }

    /* Publish button disabled state */
    .ff-btn-primary[aria-disabled="true"] {
      opacity: 0.5; cursor: not-allowed;
      pointer-events: none;
    }

    /* Toast animation */
    @keyframes ff-toast-in {
      from { opacity: 0; transform: translateX(-50%) translateY(8px); }
      to { opacity: 1; transform: translateX(-50%) translateY(0); }
    }

    /* Reduced motion */
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { transition: none !important; animation: none !important; }
    }
  `;
}
