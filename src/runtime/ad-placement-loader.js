const SITE_KEY_PREFIX = 'ff_published_site_';
const DEFAULT_SITE_ID = 'site_demo';
const DEFAULT_CONFIG_ROOT = '/api/published';
let activeConfig = null;
let resizeFrame = 0;

function clamp(value, min, max) {
  const safeMin = Number.isFinite(min) ? min : value;
  const safeMax = Number.isFinite(max) ? max : value;
  if (safeMax < safeMin) return safeMin;
  return Math.min(Math.max(value, safeMin), safeMax);
}

function currentScriptRef() {
  return document.currentScript || Array.from(document.scripts).find((script) => script.src && script.src.includes('ad-placement-loader.js'));
}

function getSiteId(script) {
  return (script && script.dataset.site) || window.FF_AD_SITE || DEFAULT_SITE_ID;
}

function getConfigUrl(script, siteId) {
  return (script && script.dataset.config) || `${DEFAULT_CONFIG_ROOT}/${siteId}.json`;
}

function getStoredConfig(siteId) {
  try {
    const raw = localStorage.getItem(`${SITE_KEY_PREFIX}${siteId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function loadConfig(siteId, configUrl) {
  const stored = getStoredConfig(siteId);
  if (configUrl) {
    try {
      const response = await fetch(configUrl, { credentials: 'same-origin' });
      if (!response.ok) throw new Error(`Config request failed: ${response.status}`);
      return response.json();
    } catch (error) {
      if (stored) return stored;
      throw error;
    }
  }
  if (stored) return stored;
  throw new Error('No published config source available');
}

function getDeviceClass() {
  if (window.innerWidth < 768) return 'mobile';
  if (window.innerWidth < 1100) return 'tablet';
  return 'desktop';
}

function getPageType() {
  const article = document.querySelector('article, .article, main article');
  if (article && article.querySelectorAll('p').length >= 4) return 'article';
  const hero = document.querySelector('.hero, .hero-img-wrap, [data-page-type="landing"]');
  if (hero) return 'landing';
  return 'generic';
}

function detectAnchors() {
  const anchors = [];
  const article = document.querySelector('article, .article, main article');
  if (article) {
    anchors.push({
      zone: 'footer',
      anchorType: 'footer',
      label: 'Footer safe zone',
      confidence: 0.96
    });
  }
  if (getDeviceClass() === 'desktop') {
    anchors.push({
      zone: 'side',
      anchorType: 'floating-right',
      label: 'Right rail anchor',
      confidence: 0.92
    });
  }
  if (article) {
    const paragraphs = article.querySelectorAll('p');
    if (paragraphs.length >= 3) {
      anchors.push({
        zone: 'inline',
        anchorType: 'inline-article',
        label: 'Inline article break',
        node: paragraphs[2],
        confidence: 0.8
      });
    }
  }
  return anchors;
}

function evaluatePlacement(placement, anchor, config) {
  if (!placement) return { eligible: false, reasonCode: 'no_matching_placement' };
  if (anchor.confidence < (config.runtime && config.runtime.confidenceFloor || 0.7)) {
    return { eligible: false, reasonCode: 'anchor_low_confidence' };
  }
  if (placement.environment === 'preview') return { eligible: false, reasonCode: 'preview_only' };
  if (placement.deviceTargets && !placement.deviceTargets.includes(getDeviceClass())) return { eligible: false, reasonCode: 'device_mismatch' };
  if (placement.pageTypes && !placement.pageTypes.includes(getPageType())) return { eligible: false, reasonCode: 'page_type_mismatch' };
  return { eligible: true, reasonCode: 'eligible' };
}

function resolvePlacements(config) {
  const placements = Array.isArray(config.placements) ? config.placements : [];
  return detectAnchors().map((anchor) => {
    const candidates = placements
      .filter((placement) => placement.anchorType === anchor.anchorType)
      .sort((a, b) => (b.priority || 0) - (a.priority || 0));
    for (const placement of candidates) {
      const evaluation = evaluatePlacement(placement, anchor, config);
      if (evaluation.eligible) {
        return { render: true, anchor, placement, reasonCode: evaluation.reasonCode };
      }
    }
    const firstCandidate = candidates[0] || null;
    return {
      render: false,
      anchor,
      placement: firstCandidate,
      reasonCode: firstCandidate ? evaluatePlacement(firstCandidate, anchor, config).reasonCode : 'no_matching_placement'
    };
  });
}

function clearExisting() {
  document.getElementById('ff-loader-footer-host')?.remove();
  document.getElementById('ff-loader-side-host')?.remove();
  document.getElementById('ff-loader-inline-host')?.remove();
}

function computeFooterArea(config) {
  const override = config.areaOverrides && config.areaOverrides.footer || {};
  const width = clamp(Math.round((override.widthRatio ?? 0.88) * window.innerWidth), 280, window.innerWidth - 24);
  const height = clamp(override.height ?? 148, 132, 170);
  const centerOffset = override.centerOffset ?? 0;
  const x = clamp(Math.round((window.innerWidth - width) / 2 + centerOffset), 12, window.innerWidth - width - 12);
  const y = clamp(window.innerHeight - height - (override.bottomInset ?? 8), 24, window.innerHeight - height - 8);
  return { x, y, width, height };
}

function computeSideArea(config) {
  const override = config.areaOverrides && config.areaOverrides.side || {};
  const width = clamp(override.width ?? 300, 286, 340);
  const height = clamp(override.height ?? 400, 360, 460);
  const x = clamp(window.innerWidth - width - (override.rightInset ?? 8), Math.max(window.innerWidth * 0.52, window.innerWidth - 348), window.innerWidth - width - 8);
  const y = clamp(override.topOffset ?? 112, 80, window.innerHeight - height - 20);
  return { x, y, width, height };
}

function computeInlineArea(config, anchorNode) {
  const article = anchorNode.closest('article, .article, main article');
  const articleRect = article ? article.getBoundingClientRect() : { left: 24, width: window.innerWidth - 48 };
  const anchorRect = anchorNode.getBoundingClientRect();
  const override = config.areaOverrides && config.areaOverrides.inline || {};
  const width = clamp(Math.round((override.widthRatio ?? 0.92) * articleRect.width), 280, articleRect.width);
  const height = clamp(override.height ?? 168, 132, 220);
  const xOffset = clamp(override.columnOffset ?? 0, 0, Math.max(0, articleRect.width - width));
  const yOffset = Math.max(48, override.anchorOffset ?? 112);
  return { width, height, xOffset, yOffset };
}

function createFooter(config) {
  const area = computeFooterArea(config);
  const host = document.createElement('div');
  host.id = 'ff-loader-footer-host';
  host.style.cssText = `position:fixed;left:${area.x}px;top:${area.y}px;width:${area.width}px;height:${area.height}px;z-index:2147483000;pointer-events:none;`;
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });
  const accent = config.runtime && config.runtime.accent || '#ff3b30';
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; }
      .banner {
        position: absolute; inset: 0; overflow: hidden; pointer-events: auto;
        border-radius: 24px 24px 0 0;
        background: linear-gradient(105deg, #06060e 0%, ${accent} 54%, #170b24 100%);
        box-shadow: 0 -8px 40px rgba(15,23,42,0.35);
        color: #fff; font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif;
      }
      .shell {
        position: absolute; inset: 0;
        clip-path: polygon(1% 15%, 4% 0%, 97% 0%, 100% 18%, 100% 100%, 0% 100%);
        background: linear-gradient(105deg, #06060e 0%, ${accent} 54%, #170b24 100%);
      }
      .content {
        position: relative; z-index: 1; height: 100%;
        display: flex; align-items: center; justify-content: space-between;
        gap: 20px; padding: 18px 22px 22px 170px;
      }
      .shoe {
        position: absolute; left: 34px; bottom: 18px; width: 132px; height: 92px;
        border-radius: 50% 50% 34% 34%; background: linear-gradient(135deg, ${accent}, #fff);
        transform: rotate(-14deg);
        box-shadow: 0 -8px 24px rgba(0,0,0,0.3);
      }
      .text strong { display: block; font-size: 26px; line-height: 1.02; text-transform: uppercase; }
      .text span { display: block; margin-top: 4px; font-size: 12px; color: rgba(255,255,255,0.72); }
      .cta {
        border: none; background: #fff; color: #0f172a; border-radius: 999px;
        min-width: 44px; min-height: 44px; padding: 0 18px; font: 700 12px/44px -apple-system, sans-serif;
      }
    </style>
    <div class="banner" role="complementary" aria-label="Advertisement">
      <div class="shell"></div>
      <div class="shoe"></div>
      <div class="content">
        <div class="text">
          <strong>Break Every Limit</strong>
          <span>Published through the managed ad placement loader.</span>
        </div>
        <button class="cta" type="button">Shop</button>
      </div>
    </div>`;
}

function createSide(config) {
  const area = computeSideArea(config);
  const host = document.createElement('div');
  host.id = 'ff-loader-side-host';
  host.style.cssText = `position:fixed;left:${area.x}px;top:${area.y}px;width:${area.width}px;height:${area.height}px;z-index:2147483001;pointer-events:none;`;
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });
  const accent = config.runtime && config.runtime.accent || '#ff3b30';
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; }
      .panel {
        position: absolute; inset: 0; pointer-events: auto; overflow: hidden;
        clip-path: polygon(18% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 90%);
        background: linear-gradient(180deg, #06060e 0%, ${accent} 62%, #14061f 100%);
        box-shadow: -12px 0 36px rgba(15,23,42,0.35);
        color: #fff; font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif;
      }
      .athlete {
        position: absolute; left: -46px; top: 18px; width: 156px; height: 210px;
        border-radius: 46% 54% 40% 60%; background: linear-gradient(170deg, ${accent}, #2b1535);
        box-shadow: 0 18px 34px rgba(0,0,0,0.28);
      }
      .content {
        position: absolute; inset: auto 18px 18px 92px; display: flex; flex-direction: column; gap: 10px;
      }
      .eyebrow { font: 700 10px/1 -apple-system, sans-serif; letter-spacing: 0.18em; text-transform: uppercase; color: rgba(255,255,255,0.55); }
      .headline { font: 900 26px/0.96 -apple-system, sans-serif; text-transform: uppercase; }
      .copy { font: 500 12px/1.4 -apple-system, sans-serif; color: rgba(255,255,255,0.72); }
      .cta {
        border: none; background: #fff; color: #0f172a; border-radius: 999px;
        min-width: 44px; min-height: 44px; padding: 0 16px; font: 700 12px/44px -apple-system, sans-serif; align-self: flex-start;
      }
    </style>
    <div class="panel" role="complementary" aria-label="Advertisement">
      <div class="athlete"></div>
      <div class="content">
        <span class="eyebrow">Sponsored</span>
        <strong class="headline">Unleash The Power</strong>
        <span class="copy">This right-rail unit was resolved from the published site config.</span>
        <button class="cta" type="button">Explore</button>
      </div>
    </div>`;
}

function createInline(config, anchorNode) {
  const area = computeInlineArea(config, anchorNode);
  const host = document.createElement('div');
  host.id = 'ff-loader-inline-host';
  host.style.cssText = `display:block;margin:${area.yOffset}px 0 24px;max-width:100%;width:${area.width}px;transform:translateX(${area.xOffset}px);`;
  const shadow = host.attachShadow({ mode: 'open' });
  const accent = config.runtime && config.runtime.accent || '#ff3b30';
  shadow.innerHTML = `
    <style>
      :host { display: block; }
      * { box-sizing: border-box; }
      .inline {
        position: relative; min-height: ${area.height}px; padding: 18px 20px; border-radius: 18px;
        background: linear-gradient(135deg, ${accent}, #16081d); color: #fff;
        box-shadow: 0 18px 48px rgba(15,23,42,0.16);
        font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif;
      }
      .label { display: inline-flex; align-items: center; gap: 6px; font: 700 9px/1 -apple-system, sans-serif; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(255,255,255,0.7); }
      .label::before { content: ''; width: 8px; height: 8px; border-radius: 999px; background: #fff; opacity: 0.9; }
      .title { display: block; margin-top: 10px; font: 800 22px/1.08 -apple-system, sans-serif; }
      .copy { display: block; margin-top: 6px; font: 500 13px/1.5 -apple-system, sans-serif; color: rgba(255,255,255,0.76); }
      .cta {
        margin-top: 14px; border: none; background: #fff; color: #0f172a; border-radius: 999px;
        min-width: 44px; min-height: 44px; padding: 0 16px; font: 700 12px/44px -apple-system, sans-serif;
      }
    </style>
    <section class="inline" role="complementary" aria-label="Advertisement">
      <span class="label">Sponsored Placement</span>
      <strong class="title">Deploy AI agents without rebuilding your stack</strong>
      <span class="copy">This inline unit is rendered by the site loader from the published placement config, without the creator touching page markup.</span>
      <button class="cta" type="button">See Demo</button>
    </section>`;
  anchorNode.insertAdjacentElement('afterend', host);
}

function renderResolvedPlacements(config) {
  clearExisting();
  activeConfig = config;
  resolvePlacements(config).forEach((resolution) => {
    if (!resolution.render) return;
    if (resolution.anchor.zone === 'footer') createFooter(config);
    if (resolution.anchor.zone === 'side') createSide(config);
    if (resolution.anchor.zone === 'inline' && resolution.anchor.node) createInline(config, resolution.anchor.node);
  });
}

async function boot() {
  const script = currentScriptRef();
  const siteId = getSiteId(script);
  const configUrl = getConfigUrl(script, siteId);
  try {
    const config = await loadConfig(siteId, configUrl);
    renderResolvedPlacements(config);
  } catch (error) {
    console.warn('Ad placement loader failed safely:', error);
  }
}

window.addEventListener('resize', () => {
  if (!activeConfig) return;
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => renderResolvedPlacements(activeConfig));
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
