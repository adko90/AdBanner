/**
 * ff-builder-state.js — Reactive state management for the visual builder
 *
 * Proxy-based reactivity with localStorage persistence.
 * Draft config auto-saves as you edit; published config saved on explicit action.
 */

const DRAFT_PREFIX = 'ff_draft_site_';
const PUBLISHED_PREFIX = 'ff_published_site_';
const DEBOUNCE_MS = 300;

/**
 * Default builder config — the shape that the builder produces.
 */
export const DEFAULT_BUILDER_CONFIG = {
  siteId: 'site_demo',
  visualMode: 'solid',
  shapePreset: 'capsule',
  accent: '#ff3b30',
  headline: 'Break',
  headlineEmphasis: 'Every Limit',
  subtext: 'Performance engineered. Style redefined.',
  brand: 'Performance Lab',
  ctaText: 'Shop Now',
  ctaUrl: '#',
  sideHeadline: 'Unleash',
  sideHeadlineEmphasis: 'The Power',
  sideSubtext: 'Next-gen performance gear.\nBuilt for boundary breakers.',
  optimizedLayers: null,
  zones: {
    footer: { enabled: true },
    side: { enabled: true }
  },
  dismissTTL: 86400000
};

/**
 * Creates a reactive state store.
 * @param {string} siteId - The site identifier for localStorage keys
 * @param {Function} onChange - Called on every state change with (key, value, fullState)
 * @returns {{ state: Proxy, publish: Function, loadPublished: Function, reset: Function, getSiteId: Function }}
 */
export function createBuilderState(siteId, onChange) {
  let _siteId = siteId || 'site_demo';
  let _saveTimer = null;

  // Load draft from localStorage or use defaults
  const initial = loadDraft(_siteId);

  // Deep clone to avoid shared references
  const _state = JSON.parse(JSON.stringify(initial));

  function draftKey() { return DRAFT_PREFIX + _siteId; }
  function publishedKey() { return PUBLISHED_PREFIX + _siteId; }

  function saveDraft() {
    try {
      localStorage.setItem(draftKey(), JSON.stringify(_state));
    } catch { /* quota exceeded — silent */ }
  }

  function scheduleSave() {
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(saveDraft, DEBOUNCE_MS);
  }

  function notify(key, value) {
    scheduleSave();
    if (onChange) onChange(key, value, _state);
    window.dispatchEvent(new CustomEvent('ff:config:changed', {
      detail: { key, value, siteId: _siteId }
    }));
  }

  // Create reactive proxy with nested support for `zones`
  const proxy = new Proxy(_state, {
    get(target, prop) {
      if (prop === 'zones' && target.zones) {
        return new Proxy(target.zones, {
          get(zt, zp) {
            if (typeof zt[zp] === 'object' && zt[zp] !== null) {
              return new Proxy(zt[zp], {
                set(innerTarget, innerProp, innerVal) {
                  innerTarget[innerProp] = innerVal;
                  notify('zones.' + zp + '.' + innerProp, innerVal);
                  return true;
                }
              });
            }
            return zt[zp];
          },
          set(zt, zp, zv) {
            zt[zp] = zv;
            notify('zones.' + zp, zv);
            return true;
          }
        });
      }
      return target[prop];
    },
    set(target, prop, value) {
      target[prop] = value;
      notify(prop, value);
      return true;
    }
  });

  return {
    state: proxy,

    /**
     * Publish the current draft as the live config.
     */
    publish() {
      const config = {
        ...JSON.parse(JSON.stringify(_state)),
        publishedAt: new Date().toISOString()
      };
      try {
        localStorage.setItem(publishedKey(), JSON.stringify(config));
      } catch { /* quota exceeded */ }
      window.dispatchEvent(new CustomEvent('ff:config:published', {
        detail: { siteId: _siteId, config }
      }));
      return config;
    },

    /**
     * Load the published config (if any).
     */
    loadPublished() {
      try {
        const raw = localStorage.getItem(publishedKey());
        return raw ? JSON.parse(raw) : null;
      } catch { return null; }
    },

    /**
     * Reset state to defaults (clears draft).
     */
    reset() {
      const defaults = JSON.parse(JSON.stringify(DEFAULT_BUILDER_CONFIG));
      defaults.siteId = _siteId;
      Object.keys(defaults).forEach(k => { _state[k] = defaults[k]; });
      saveDraft();
      if (onChange) onChange('*', null, _state);
      window.dispatchEvent(new CustomEvent('ff:config:changed', {
        detail: { key: '*', value: null, siteId: _siteId }
      }));
    },

    getSiteId() { return _siteId; },

    /**
     * Export the current state as a plain object (for rendering).
     */
    toConfig() {
      return JSON.parse(JSON.stringify(_state));
    }
  };
}

/**
 * Load draft config from localStorage, falling back to defaults.
 */
function loadDraft(siteId) {
  try {
    const raw = localStorage.getItem(DRAFT_PREFIX + siteId);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_BUILDER_CONFIG, ...parsed, siteId };
    }
  } catch { /* corrupt data — use defaults */ }
  return { ...DEFAULT_BUILDER_CONFIG, siteId };
}

/**
 * Get published config for a site (used by live mode).
 */
export function getPublishedConfig(siteId) {
  try {
    const raw = localStorage.getItem(PUBLISHED_PREFIX + siteId);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
