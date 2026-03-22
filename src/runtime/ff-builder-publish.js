/**
 * ff-builder-publish.js — Publish & export flow (F10).
 *
 * Handles:
 * - Publish: saves config to localStorage for live-mode pickup, gated by safety verdict
 * - Export Snippet: generates embeddable <script> tag
 * - Toast notifications for user feedback
 */

/**
 * @param {{ shadow: ShadowRoot, shell: HTMLElement, store: object }} ctx
 */
export function initPublish({ shadow, shell, store }) {
  const refs = shell._ff;

  // ── Publish ─────────────────────────────────────────────
  shadow.addEventListener('ff:publish:requested', () => {
    // Check for BLOCKED verdicts in the safety panels
    const safetyPanels = shell.querySelectorAll('.ff-safety-panel');
    let blocked = false;
    for (const panel of safetyPanels) {
      if (panel._ffVerdict === 'BLOCKED') {
        blocked = true;
        break;
      }
    }

    if (blocked) {
      showToast(refs, 'Publish blocked — resolve safety conflicts first', 'error');
      return;
    }

    const config = store.publish();
    showToast(refs, `Published for ${store.getSiteId()}`, 'success');
    refs.statusText.textContent = `Published at ${new Date().toLocaleTimeString()}`;

    // Trigger live mode refresh via storage event (same-tab)
    window.dispatchEvent(new StorageEvent('storage', {
      key: `ff_published_site_${store.getSiteId()}`,
      newValue: JSON.stringify(config),
    }));
  });

  // ── Export Snippet ──────────────────────────────────────
  shadow.addEventListener('ff:export:requested', () => {
    const siteId = store.getSiteId();
    const snippet = generateSnippet(siteId);

    copyToClipboard(snippet).then((ok) => {
      if (ok) {
        showToast(refs, 'Snippet copied to clipboard', 'success');
      } else {
        showSnippetModal(shadow, snippet);
      }
    });
  });
}

/**
 * Generates the embeddable script tag for a site.
 */
function generateSnippet(siteId) {
  return `<!-- FutureFit Ad Banner -->
<script type="module" src="ff-builder-app.js" data-mode="live" data-site="${esc(siteId)}"><\/script>`;
}

/**
 * Shows a toast notification in the status bar area.
 */
function showToast(refs, message, type) {
  const existing = refs.statusText.parentElement.querySelector('.ff-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `ff-toast ff-toast-${type}`;
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  toast.textContent = message;
  toast.style.cssText = `
    position: absolute; bottom: 52px; left: 50%; transform: translateX(-50%);
    padding: 8px 20px; border-radius: 8px;
    font: 600 12px/1.4 inherit; white-space: nowrap;
    z-index: 10; pointer-events: none;
    animation: ff-toast-in 0.25s ease-out;
    ${type === 'success'
      ? 'background: rgba(34,197,94,0.9); color: #fff;'
      : 'background: rgba(239,68,68,0.9); color: #fff;'}
  `;
  refs.statusText.parentElement.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

/**
 * Fallback: show snippet in a modal if clipboard API is unavailable.
 */
function showSnippetModal(shadow, snippet) {
  const overlay = document.createElement('div');
  overlay.className = 'ff-snippet-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', 'Export snippet');
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 100;
    background: rgba(0,0,0,0.6);
    display: flex; align-items: center; justify-content: center;
    pointer-events: auto;
  `;

  const modal = document.createElement('div');
  modal.style.cssText = `
    background: #1e293b; border-radius: 12px; padding: 20px;
    max-width: 560px; width: 90%;
    box-shadow: 0 8px 32px rgba(0,0,0,0.4);
  `;
  modal.innerHTML = `
    <h3 style="color:#f1f5f9;font:700 14px/1 inherit;margin-bottom:12px;">Install Snippet</h3>
    <p style="color:#94a3b8;font-size:12px;margin-bottom:12px;">Copy this snippet and paste it before the closing &lt;/body&gt; tag:</p>
    <textarea readonly style="
      width:100%;height:80px;resize:none;
      font:11px/1.5 'SF Mono',Monaco,monospace;
      background:rgba(0,0,0,0.3);color:#a5b4fc;
      border:1px solid rgba(255,255,255,0.1);border-radius:6px;
      padding:8px;
    " aria-label="Install snippet code">${esc(snippet)}</textarea>
    <div style="display:flex;justify-content:flex-end;margin-top:12px;">
      <button class="ff-snippet-close" style="
        padding:6px 14px;border:none;border-radius:6px;
        background:rgba(255,255,255,0.08);color:#cbd5e1;
        font:600 12px/1 inherit;cursor:pointer;min-height:32px;
      ">Close</button>
    </div>
  `;

  overlay.appendChild(modal);
  shadow.querySelector('.ff-shell').appendChild(overlay);

  // Focus the textarea for easy copy
  const textarea = modal.querySelector('textarea');
  textarea.focus();
  textarea.select();

  // Close handlers
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.closest('.ff-snippet-close')) {
      overlay.remove();
    }
  });
  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') overlay.remove();
  });
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
