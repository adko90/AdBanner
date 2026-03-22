/**
 * ff-builder-configurator.js — Banner design controls panel.
 *
 * Controls: visualMode, shapePreset, accent, content fields, image upload.
 * All changes update reactive state (ff-builder-state.js) immediately.
 */

const SWATCH_PALETTE = [
  '#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#007aff',
  '#5856d6', '#af52de', '#ff2d55', '#1e293b', '#f1f5f9',
];

const SHAPE_PRESETS = [
  { value: 'capsule', label: 'Capsule' },
  { value: 'angled',  label: 'Angled' },
  { value: 'wave',    label: 'Wave' },
];

/**
 * @param {{ store: object, shadow: ShadowRoot }} ctx
 * @returns {HTMLElement}
 */
export function createConfigurator({ store, shadow }) {
  const el = document.createElement('div');
  el.className = 'ff-configurator';
  el.setAttribute('role', 'form');
  el.setAttribute('aria-label', 'Banner design controls');

  el.innerHTML = `
    <style>${configuratorStyles()}</style>

    <h3 class="ff-cfg-heading">Design</h3>

    <!-- Visual Mode -->
    <fieldset class="ff-cfg-fieldset">
      <legend class="ff-cfg-legend">Visual Mode</legend>
      <div class="ff-cfg-toggle-group" role="radiogroup" aria-label="Visual mode">
        <button class="ff-cfg-toggle ${store.state.visualMode === 'solid' ? 'active' : ''}"
                data-field="visualMode" data-value="solid" role="radio"
                aria-checked="${store.state.visualMode === 'solid'}">Solid</button>
        <button class="ff-cfg-toggle ${store.state.visualMode === 'glass' ? 'active' : ''}"
                data-field="visualMode" data-value="glass" role="radio"
                aria-checked="${store.state.visualMode === 'glass'}">Glass</button>
      </div>
    </fieldset>

    <!-- Shape Preset -->
    <fieldset class="ff-cfg-fieldset">
      <legend class="ff-cfg-legend">Shape</legend>
      <div class="ff-cfg-toggle-group" role="radiogroup" aria-label="Shape preset">
        ${SHAPE_PRESETS.map(p => `
          <button class="ff-cfg-toggle ${store.state.shapePreset === p.value ? 'active' : ''}"
                  data-field="shapePreset" data-value="${p.value}" role="radio"
                  aria-checked="${store.state.shapePreset === p.value}">${p.label}</button>
        `).join('')}
      </div>
    </fieldset>

    <!-- Accent Colour -->
    <fieldset class="ff-cfg-fieldset">
      <legend class="ff-cfg-legend">Accent Colour</legend>
      <div class="ff-cfg-color-row">
        <input type="color" class="ff-cfg-color-picker" data-field="accent"
               value="${store.state.accent}" aria-label="Accent colour picker" />
        <div class="ff-cfg-swatches" role="group" aria-label="Colour swatches">
          ${SWATCH_PALETTE.map(c => `
            <button class="ff-cfg-swatch ${store.state.accent === c ? 'active' : ''}"
                    data-field="accent" data-value="${c}"
                    style="background:${c}" aria-label="Set accent to ${c}"
                    title="${c}"></button>
          `).join('')}
        </div>
      </div>
    </fieldset>

    <!-- Content Fields -->
    <fieldset class="ff-cfg-fieldset">
      <legend class="ff-cfg-legend">Content</legend>
      <label class="ff-cfg-label">Headline
        <input class="ff-cfg-input" data-field="headline" value="${esc(store.state.headline)}" /></label>
      <label class="ff-cfg-label">Emphasis
        <input class="ff-cfg-input" data-field="headlineEmphasis" value="${esc(store.state.headlineEmphasis)}" /></label>
      <label class="ff-cfg-label">Subtext
        <input class="ff-cfg-input" data-field="subtext" value="${esc(store.state.subtext)}" /></label>
      <label class="ff-cfg-label">Brand
        <input class="ff-cfg-input" data-field="brand" value="${esc(store.state.brand)}" /></label>
      <label class="ff-cfg-label">CTA Text
        <input class="ff-cfg-input" data-field="ctaText" value="${esc(store.state.ctaText)}" /></label>
      <label class="ff-cfg-label">CTA URL
        <input class="ff-cfg-input" data-field="ctaUrl" type="url" value="${esc(store.state.ctaUrl)}" /></label>
    </fieldset>

    <!-- Side Banner Content -->
    <fieldset class="ff-cfg-fieldset">
      <legend class="ff-cfg-legend">Side Banner</legend>
      <label class="ff-cfg-label">Headline
        <input class="ff-cfg-input" data-field="sideHeadline" value="${esc(store.state.sideHeadline)}" /></label>
      <label class="ff-cfg-label">Emphasis
        <input class="ff-cfg-input" data-field="sideHeadlineEmphasis" value="${esc(store.state.sideHeadlineEmphasis)}" /></label>
      <label class="ff-cfg-label">Subtext
        <textarea class="ff-cfg-textarea" data-field="sideSubtext" rows="2">${esc(store.state.sideSubtext)}</textarea></label>
    </fieldset>

    <!-- Image -->
    <fieldset class="ff-cfg-fieldset">
      <legend class="ff-cfg-legend">Image</legend>
      <div class="ff-cfg-image-row">
        <input class="ff-cfg-input" data-field="imageUrl" placeholder="Image URL…"
               value="${esc(store.state.imageUrl || '')}" aria-label="Image URL" />
        <label class="ff-btn ff-btn-upload" tabindex="0" aria-label="Upload image">
          Upload
          <input type="file" class="ff-cfg-file" accept="image/*" hidden />
        </label>
      </div>
      <div class="ff-cfg-image-preview"></div>
    </fieldset>
  `;

  // ── Toggle buttons (visualMode, shapePreset) ────────────
  el.querySelectorAll('.ff-cfg-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const field = btn.dataset.field;
      const value = btn.dataset.value;
      store.state[field] = value;
      const group = btn.closest('.ff-cfg-toggle-group');
      group.querySelectorAll('.ff-cfg-toggle').forEach(b => {
        const isActive = b.dataset.value === value;
        b.classList.toggle('active', isActive);
        b.setAttribute('aria-checked', String(isActive));
      });
    });
  });

  // ── Colour picker ───────────────────────────────────────
  el.querySelector('.ff-cfg-color-picker').addEventListener('input', (e) => {
    store.state.accent = e.target.value;
    el.querySelectorAll('.ff-cfg-swatch').forEach(s => {
      s.classList.toggle('active', s.dataset.value === e.target.value);
    });
  });

  // ── Colour swatches ─────────────────────────────────────
  el.querySelectorAll('.ff-cfg-swatch').forEach(swatch => {
    swatch.addEventListener('click', () => {
      const color = swatch.dataset.value;
      store.state.accent = color;
      el.querySelector('.ff-cfg-color-picker').value = color;
      el.querySelectorAll('.ff-cfg-swatch').forEach(s => {
        s.classList.toggle('active', s.dataset.value === color);
      });
    });
  });

  // ── Text inputs ─────────────────────────────────────────
  el.querySelectorAll('.ff-cfg-input, .ff-cfg-textarea').forEach(input => {
    const field = input.dataset.field;
    if (!field) return;
    input.addEventListener('input', () => {
      store.state[field] = input.value;
    });
  });

  // ── Image upload ────────────────────────────────────────
  el.querySelector('.ff-cfg-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxW = 800, maxH = 600;
        let w = img.width, h = img.height;
        if (w > maxW) { h = (h * maxW) / w; w = maxW; }
        if (h > maxH) { w = (w * maxH) / h; h = maxH; }
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        store.state.imageUrl = dataUrl;
        updateImagePreview(el, dataUrl);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });

  // ── Image URL input ─────────────────────────────────────
  const imgUrlInput = el.querySelector('[data-field="imageUrl"]');
  imgUrlInput.addEventListener('change', () => {
    const url = imgUrlInput.value.trim();
    store.state.imageUrl = url || null;
    updateImagePreview(el, url);
  });

  // Initial image preview
  if (store.state.imageUrl) {
    updateImagePreview(el, store.state.imageUrl);
  }

  return el;
}

function updateImagePreview(root, url) {
  const preview = root.querySelector('.ff-cfg-image-preview');
  if (url) {
    preview.innerHTML = `<img src="${esc(url)}" alt="Banner image preview" style="max-width:100%;border-radius:6px;margin-top:8px;" />`;
  } else {
    preview.innerHTML = '';
  }
}

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function configuratorStyles() {
  return `
    .ff-configurator { display: flex; flex-direction: column; gap: 16px; }

    .ff-cfg-heading {
      font: 700 15px/1 inherit; color: #f1f5f9;
      padding-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.08);
    }

    .ff-cfg-fieldset {
      border: none; padding: 0;
      display: flex; flex-direction: column; gap: 8px;
    }
    .ff-cfg-legend { font: 600 11px/1 inherit; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; }

    /* Toggle group */
    .ff-cfg-toggle-group {
      display: flex; gap: 2px; padding: 2px;
      background: rgba(255,255,255,0.04); border-radius: 8px;
    }
    .ff-cfg-toggle {
      flex: 1; padding: 6px 10px; border: none; border-radius: 6px;
      background: transparent; color: #94a3b8;
      font: 600 12px/1 inherit; cursor: pointer;
      min-height: 32px;
      transition: background 0.12s, color 0.12s;
    }
    .ff-cfg-toggle:hover { color: #e2e8f0; }
    .ff-cfg-toggle.active { background: #3b82f6; color: #fff; }
    .ff-cfg-toggle:focus-visible { outline: 2px solid #3b82f6; outline-offset: 1px; }

    /* Colour */
    .ff-cfg-color-row { display: flex; align-items: center; gap: 10px; }
    .ff-cfg-color-picker {
      width: 36px; height: 36px; border: 2px solid rgba(255,255,255,0.12);
      border-radius: 8px; cursor: pointer; padding: 0;
      background: none;
    }
    .ff-cfg-color-picker::-webkit-color-swatch-wrapper { padding: 2px; }
    .ff-cfg-color-picker::-webkit-color-swatch { border-radius: 4px; border: none; }
    .ff-cfg-swatches { display: flex; flex-wrap: wrap; gap: 4px; }
    .ff-cfg-swatch {
      width: 24px; height: 24px; border: 2px solid transparent;
      border-radius: 6px; cursor: pointer; padding: 0;
      transition: border-color 0.12s;
    }
    .ff-cfg-swatch:hover { border-color: rgba(255,255,255,0.3); }
    .ff-cfg-swatch.active { border-color: #fff; }
    .ff-cfg-swatch:focus-visible { outline: 2px solid #3b82f6; outline-offset: 1px; }

    /* Text inputs */
    .ff-cfg-label {
      display: flex; flex-direction: column; gap: 3px;
      font: 500 11px/1.2 inherit; color: #94a3b8;
    }
    .ff-cfg-input, .ff-cfg-textarea {
      padding: 6px 10px; border: 1px solid rgba(255,255,255,0.1);
      border-radius: 6px; background: rgba(255,255,255,0.04);
      color: #f1f5f9; font: 13px/1.4 inherit; outline: none;
    }
    .ff-cfg-input:focus, .ff-cfg-textarea:focus {
      border-color: #3b82f6; box-shadow: 0 0 0 2px rgba(59,130,246,0.2);
    }
    .ff-cfg-textarea { resize: vertical; min-height: 48px; }

    /* Image */
    .ff-cfg-image-row { display: flex; gap: 8px; }
    .ff-cfg-image-row .ff-cfg-input { flex: 1; }
    .ff-btn-upload {
      display: inline-flex; align-items: center; padding: 6px 12px;
      border-radius: 6px; background: rgba(255,255,255,0.08);
      color: #cbd5e1; font: 600 12px/1 inherit; cursor: pointer;
      min-height: 32px;
    }
    .ff-btn-upload:hover { background: rgba(255,255,255,0.14); }
    .ff-btn-upload:focus-visible { outline: 2px solid #3b82f6; outline-offset: 1px; }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { transition: none !important; }
    }
  `;
}
