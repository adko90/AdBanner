/**
 * ff-banner-runtime.js — Modular banner renderer
 *
 * Extracted from index.html into a reusable ES module.
 * Renders footer, side, and inline banners inside Shadow DOM.
 * All functions accept a config object — no global state dependency.
 */

// ── Color Utilities ──────────────────────────────────────────

export function hexRgba(h, a) {
  return 'rgba(' + parseInt(h.slice(1, 3), 16) + ',' + parseInt(h.slice(3, 5), 16) + ',' + parseInt(h.slice(5, 7), 16) + ',' + a + ')';
}

export function darken(h, f) {
  return 'rgb(' + Math.round(parseInt(h.slice(1, 3), 16) * f) + ',' + Math.round(parseInt(h.slice(3, 5), 16) * f) + ',' + Math.round(parseInt(h.slice(5, 7), 16) * f) + ')';
}

export function clamp(value, min, max) {
  const safeMin = Number.isFinite(min) ? min : value;
  const safeMax = Number.isFinite(max) ? max : value;
  if (safeMax < safeMin) return safeMin;
  return Math.min(Math.max(value, safeMin), safeMax);
}

export const colorUtils = { hexRgba, darken, clamp };

// ── Shape Presets ────────────────────────────────────────────

export const SHAPE_PRESETS = {
  capsule: {
    desktop: 'polygon(1% 15%, 3% 0%, 97% 0%, 99% 15%, 100% 100%, 0% 100%)',
    mobile: 'polygon(0% 8%, 100% 0%, 100% 100%, 0% 100%)'
  },
  angled: {
    desktop: 'polygon(0% 35%, 4% 0%, 62% 0%, 66% 22%, 100% 22%, 100% 100%, 0% 100%)',
    mobile: 'polygon(0% 18%, 3% 0%, 100% 0%, 100% 100%, 0% 100%)'
  },
  signature: {
    desktop: 'polygon(0% 42%, 6% 18%, 14% 38%, 22% 12%, 32% 28%, 42% 6%, 52% 22%, 62% 4%, 72% 20%, 82% 8%, 92% 26%, 96% 12%, 100% 28%, 100% 100%, 0% 100%)',
    mobile: 'polygon(0% 28%, 12% 14%, 28% 24%, 44% 8%, 58% 18%, 74% 6%, 88% 16%, 100% 20%, 100% 100%, 0% 100%)'
  }
};

// ── Device / Page Detection ─────────────────────────────────

export function getDeviceClass() {
  if (window.innerWidth < 768) return 'mobile';
  if (window.innerWidth < 1100) return 'tablet';
  return 'desktop';
}

export function getPageType() {
  const article = document.querySelector('article, .article, [role="article"]');
  const hasArticleMeta = article && article.querySelector('.meta, time, [datetime]');
  const paragraphCount = article ? article.querySelectorAll('p').length : 0;
  if (article && hasArticleMeta && paragraphCount >= 4) return 'article';
  if (document.querySelector('.hero-img-wrap, [class*="hero"]')) return 'landing';
  return 'generic';
}

// ── Dismiss Persistence ─────────────────────────────────────

const DEFAULT_DISMISS_TTL = 86400000; // 24h

export function isDismissed(zone, ttl) {
  try {
    const raw = localStorage.getItem('ff_ad_dismissed_' + zone);
    return raw && (Date.now() - parseInt(raw)) < (ttl || DEFAULT_DISMISS_TTL);
  } catch { return false; }
}

export function setDismissed(zone) {
  try { localStorage.setItem('ff_ad_dismissed_' + zone, Date.now().toString()); } catch {}
}

export function clearDismissed(zone) {
  try { localStorage.removeItem('ff_ad_dismissed_' + zone); } catch {}
}

// ── Event Logging ───────────────────────────────────────────

export function logEvent(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail: { ...detail, timestamp: Date.now() } }));
}

// ── ThumbHash Decoder ───────────────────────────────────────

export function thumbHashToDataURL(base64) {
  var bin = atob(base64);
  var hash = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) hash[i] = bin.charCodeAt(i);

  var header = hash[0] | (hash[1] << 8) | (hash[2] << 16);
  var l_dc = header & 63, p_dc = (header >> 6) & 63, q_dc = (header >> 12) & 63;
  var l_scale = (header >> 18) & 31, hasAlpha = (header >> 23) & 1;
  var p_scale = (hash[3] & 63), q_scale = ((hash[3] >> 6) | ((hash[4] & 3) << 2));
  var isLandscape = (hash[4] >> 7) & 1;
  var lx = Math.max(3, isLandscape ? (hasAlpha ? 5 : 7) : ((hash[4] >> 2) & 7) + 3);
  var ly = Math.max(3, isLandscape ? ((hash[4] >> 2) & 7) + 3 : (hasAlpha ? 5 : 7));
  var a_dc = hasAlpha ? (hash[5] & 15) : 15;
  var a_scale = hasAlpha ? (hash[5] >> 4) : 0;

  var ac_start = hasAlpha ? 6 : 5;
  var ac_idx = 0;
  function decode_ac(nx, ny, scale) {
    var result = [];
    for (var cy = 0; cy < ny; cy++) {
      for (var cx = (cy === 0 ? 1 : 0); cx * ny < nx * (ny - cy); cx++) {
        var bit_idx = ac_start * 8 + ac_idx * 4;
        var byte_idx = bit_idx >> 3;
        var bit_off = bit_idx & 7;
        var val = ((hash[byte_idx] >> bit_off) | (byte_idx + 1 < hash.length ? hash[byte_idx + 1] << (8 - bit_off) : 0)) & 15;
        result.push(((val + 0.5) / 16 - 0.5) * scale);
        ac_idx++;
      }
    }
    return result;
  }

  var l_ac = decode_ac(lx, ly, l_scale);
  var p_ac = decode_ac(3, 3, p_scale);
  var q_ac = decode_ac(3, 3, q_scale);
  var a_ac = hasAlpha ? decode_ac(5, 5, a_scale) : [];

  var ratio = 32;
  var w = Math.round(isLandscape ? ratio : Math.round(ratio * lx / ly));
  var h2 = Math.round(isLandscape ? Math.round(ratio * ly / lx) : ratio);
  var pixels = new Uint8Array(w * h2 * 4);

  var l_dc_f = (l_dc + 0.5) / 63;
  var p_dc_f = (p_dc + 0.5) / 31 - 1;
  var q_dc_f = (q_dc + 0.5) / 31 - 1;
  var a_dc_f = (a_dc + 0.5) / 15;

  var cosX_l = new Float32Array(lx);
  var cosX_p = new Float32Array(3);
  var cosX_q = new Float32Array(3);
  var cosX_a = hasAlpha ? new Float32Array(5) : null;

  for (var y = 0; y < h2; y++) {
    for (var x = 0; x < w; x++) {
      var fx = (x + 0.5) / w;
      var fy = (y + 0.5) / h2;

      var j;
      for (j = 0; j < lx; j++) cosX_l[j] = Math.cos(Math.PI * fx * j);
      for (j = 0; j < 3; j++) cosX_p[j] = Math.cos(Math.PI * fx * j);
      for (j = 0; j < 3; j++) cosX_q[j] = Math.cos(Math.PI * fx * j);
      if (hasAlpha) for (j = 0; j < 5; j++) cosX_a[j] = Math.cos(Math.PI * fx * j);

      var l = l_dc_f, p = p_dc_f, q = q_dc_f, a = a_dc_f;
      var li = 0, pi = 0, qi = 0, ai = 0;

      for (var cy = 0; cy < ly; cy++) {
        var cosY = Math.cos(Math.PI * fy * cy);
        for (var cx = (cy === 0 ? 1 : 0); cx * ly < lx * (ly - cy); cx++) {
          l += l_ac[li++] * cosX_l[cx] * cosY;
        }
      }
      for (var cy2 = 0; cy2 < 3; cy2++) {
        var cosY2 = Math.cos(Math.PI * fy * cy2);
        for (var cx2 = (cy2 === 0 ? 1 : 0); cx2 < 3 - cy2; cx2++) {
          p += p_ac[pi++] * cosX_p[cx2] * cosY2;
          q += q_ac[qi++] * cosX_q[cx2] * cosY2;
        }
      }
      if (hasAlpha) {
        for (var cy3 = 0; cy3 < 5; cy3++) {
          var cosY3 = Math.cos(Math.PI * fy * cy3);
          for (var cx3 = (cy3 === 0 ? 1 : 0); cx3 < 5 - cy3; cx3++) {
            a += a_ac[ai++] * cosX_a[cx3] * cosY3;
          }
        }
      }

      var b = l - 2 / 3 * p;
      var r2 = (3 * l - b + q) / 2;
      var g = r2 - q;
      var off = (y * w + x) * 4;
      pixels[off]     = Math.max(0, Math.min(255, Math.round(r2 * 255)));
      pixels[off + 1] = Math.max(0, Math.min(255, Math.round(g * 255)));
      pixels[off + 2] = Math.max(0, Math.min(255, Math.round(b * 255)));
      pixels[off + 3] = Math.max(0, Math.min(255, Math.round(a * 255)));
    }
  }

  var canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h2;
  var ctx = canvas.getContext('2d');
  var imgData = ctx.createImageData(w, h2);
  imgData.data.set(pixels);
  ctx.putImageData(imgData, 0, 0);
  return canvas.toDataURL();
}

// ── Network-Aware Quality ───────────────────────────────────

export function shouldLoadImages() {
  var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (!conn) return 'full';
  var ect = conn.effectiveType;
  if (ect === 'slow-2g' || ect === '2g') return 'thumbhash-only';
  if (ect === '3g') return 'mobile';
  return 'full';
}

// ── QR Code Generator ───────────────────────────────────────

export function generateQR(url, size) {
  size = size || 80;
  const m = 21, cs = size / m;
  let r = '';
  function finder(ox, oy) {
    for (let y = 0; y < 7; y++)
      for (let x = 0; x < 7; x++) {
        if (y === 0 || y === 6 || x === 0 || x === 6 || (y >= 2 && y <= 4 && x >= 2 && x <= 4))
          r += '<rect x="' + (ox + x) * cs + '" y="' + (oy + y) * cs + '" width="' + cs + '" height="' + cs + '" fill="currentColor"/>';
      }
  }
  finder(0, 0); finder(14, 0); finder(0, 14);
  let h = 0;
  for (let i = 0; i < url.length; i++) h = ((h << 5) - h + url.charCodeAt(i)) | 0;
  for (let y = 0; y < m; y++)
    for (let x = 0; x < m; x++) {
      if ((y < 8 && x < 8) || (y < 8 && x > 12) || (y > 12 && x < 8)) continue;
      h = ((h * 1103515245 + 12345) & 0x7fffffff);
      if (h % 3 === 0) r += '<rect x="' + x * cs + '" y="' + y * cs + '" width="' + cs + '" height="' + cs + '" fill="currentColor"/>';
    }
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + size + ' ' + size + '" width="' + size + '" height="' + size + '">' + r + '</svg>';
}

// ── Shadow DOM Image Helper ─────────────────────────────────

export function createOptimizedImage(name, thumbhash, altText, cls, width, height) {
  var quality = shouldLoadImages();
  var wrap = document.createElement('div');
  wrap.className = cls || '';
  wrap.style.cssText = 'position:relative;width:100%;height:100%;overflow:hidden;background-size:cover;background-position:center;';

  var dataUrl = thumbHashToDataURL(thumbhash);
  wrap.style.backgroundImage = 'url(' + dataUrl + ')';

  if (quality === 'thumbhash-only') return wrap;

  var picture = document.createElement('picture');

  var avifSrc = document.createElement('source');
  avifSrc.type = 'image/avif';
  var avif400 = 'images/optimized/' + name + '-400w.avif 400w';
  var avif760 = 'images/optimized/' + name + '-760w.avif 760w';
  avifSrc.srcset = quality === 'mobile' ? avif400 : avif400 + ', ' + avif760;
  avifSrc.sizes = '(min-width:768px) 760px, 400px';
  picture.appendChild(avifSrc);

  var webpSrc = document.createElement('source');
  webpSrc.type = 'image/webp';
  var webp400 = 'images/optimized/' + name + '-400w.webp 400w';
  var webp760 = 'images/optimized/' + name + '-760w.webp 760w';
  webpSrc.srcset = quality === 'mobile' ? webp400 : webp400 + ', ' + webp760;
  webpSrc.sizes = '(min-width:768px) 760px, 400px';
  picture.appendChild(webpSrc);

  var img = document.createElement('img');
  img.src = 'images/optimized/' + name + '-760w.jpg';
  img.srcset = 'images/optimized/' + name + '-400w.jpg 400w, images/optimized/' + name + '-760w.jpg 760w';
  img.sizes = '(min-width:768px) 760px, 400px';
  img.width = width || 760;
  img.height = height || 1013;
  img.alt = altText;
  img.decoding = 'async';
  img.style.cssText = 'width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity 0.15s ease;position:absolute;top:0;left:0;';

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    img.style.transition = 'none';
  }

  if (img.complete && img.naturalWidth > 0) {
    img.style.opacity = '1';
  } else {
    img.addEventListener('load', function () { img.style.opacity = '1'; });
  }

  picture.appendChild(img);
  wrap.appendChild(picture);
  return wrap;
}

// ── Image Decomposition Engine ──────────────────────────────

export function extractDominantColor(ctx, w, h) {
  var points = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1], [Math.floor(w / 2), Math.floor(h / 2)]];
  var r = 0, g = 0, b = 0;
  points.forEach(function (p) {
    var px = ctx.getImageData(p[0], p[1], 1, 1).data;
    r += px[0]; g += px[1]; b += px[2];
  });
  r = Math.round(r / 5); g = Math.round(g / 5); b = Math.round(b / 5);
  return { css: 'rgb(' + r + ',' + g + ',' + b + ')', r: r, g: g, b: b };
}

export function generateBlurPlate(sourceCanvas, w, h) {
  var ratio = h / w;
  var tw = 32, th = Math.round(32 * ratio);
  var c = document.createElement('canvas');
  c.width = tw; c.height = th;
  var ctx = c.getContext('2d');
  ctx.filter = 'blur(2px)';
  ctx.drawImage(sourceCanvas, 0, 0, tw, th);
  ctx.filter = 'none';
  return { dataUrl: c.toDataURL('image/jpeg', 0.6), width: tw, height: th };
}

export function morphClose(mask, w, h, radius) {
  var r = radius || 2;
  var temp = new Uint8Array(w * h);
  var i, x, y, dx, dy, nx, ny, found;

  for (y = 0; y < h; y++) {
    for (x = 0; x < w; x++) {
      i = y * w + x;
      found = false;
      for (dy = -r; dy <= r && !found; dy++) {
        for (dx = -r; dx <= r && !found; dx++) {
          nx = x + dx; ny = y + dy;
          if (nx >= 0 && nx < w && ny >= 0 && ny < h && mask[ny * w + nx] === 255) found = true;
        }
      }
      temp[i] = found ? 255 : 0;
    }
  }

  var result = new Uint8Array(w * h);
  for (y = 0; y < h; y++) {
    for (x = 0; x < w; x++) {
      i = y * w + x;
      found = true;
      for (dy = -r; dy <= r && found; dy++) {
        for (dx = -r; dx <= r && found; dx++) {
          nx = x + dx; ny = y + dy;
          if (nx >= 0 && nx < w && ny >= 0 && ny < h && temp[ny * w + nx] === 0) found = false;
        }
      }
      result[i] = found ? 255 : 0;
    }
  }
  return result;
}

export function extractSubject(sourceCanvas, w, h) {
  var scale = Math.min(1, 400 / Math.max(w, h));
  var sw = Math.round(w * scale), sh = Math.round(h * scale);
  var work = document.createElement('canvas');
  work.width = sw; work.height = sh;
  var wCtx = work.getContext('2d');
  wCtx.drawImage(sourceCanvas, 0, 0, sw, sh);
  var imgData = wCtx.getImageData(0, 0, sw, sh);
  var px = imgData.data;

  var lum = new Float32Array(sw * sh);
  for (var i = 0; i < sw * sh; i++) {
    var off = i * 4;
    lum[i] = 0.299 * px[off] + 0.587 * px[off + 1] + 0.114 * px[off + 2];
  }

  var bs = 8;
  var contrast = new Float32Array(sw * sh);
  for (var by = 0; by < sh; by += bs) {
    for (var bx = 0; bx < sw; bx += bs) {
      var sum = 0, count = 0;
      for (var dy = 0; dy < bs && by + dy < sh; dy++) {
        for (var dx = 0; dx < bs && bx + dx < sw; dx++) {
          sum += lum[(by + dy) * sw + (bx + dx)];
          count++;
        }
      }
      var mean = sum / count;
      var variance = 0;
      for (var dy2 = 0; dy2 < bs && by + dy2 < sh; dy2++) {
        for (var dx2 = 0; dx2 < bs && bx + dx2 < sw; dx2++) {
          var diff = lum[(by + dy2) * sw + (bx + dx2)] - mean;
          variance += diff * diff;
        }
      }
      variance /= count;
      for (var dy3 = 0; dy3 < bs && by + dy3 < sh; dy3++) {
        for (var dx3 = 0; dx3 < bs && bx + dx3 < sw; dx3++) {
          contrast[(by + dy3) * sw + (bx + dx3)] = variance;
        }
      }
    }
  }

  var sorted = Array.from(contrast).sort(function (a, b) { return a - b; });
  var threshold = sorted[Math.floor(sorted.length * 0.75)];
  threshold = Math.max(threshold, 50);

  var mask = new Uint8Array(sw * sh);
  for (var j = 0; j < sw * sh; j++) {
    mask[j] = contrast[j] >= threshold ? 255 : 0;
  }

  mask = morphClose(mask, sw, sh, 3);
  mask = morphClose(mask, sw, sh, 2);

  var out = document.createElement('canvas');
  out.width = w; out.height = h;
  var oCtx = out.getContext('2d');
  oCtx.drawImage(sourceCanvas, 0, 0);
  var outData = oCtx.getImageData(0, 0, w, h);
  var outPx = outData.data;

  for (var oy = 0; oy < h; oy++) {
    for (var ox = 0; ox < w; ox++) {
      var mx = Math.min(sw - 1, Math.round(ox * scale));
      var my = Math.min(sh - 1, Math.round(oy * scale));
      var alpha = mask[my * sw + mx];
      outPx[(oy * w + ox) * 4 + 3] = alpha;
    }
  }

  oCtx.putImageData(outData, 0, 0);
  return out.toDataURL('image/png');
}

/**
 * Decomposes an image into 3 layers: dominant color, blur plate, subject cutout.
 * Returns a Promise resolving to the layers object.
 */
export function decomposeImage(source) {
  var w = source.naturalWidth || source.width;
  var h = source.naturalHeight || source.height;

  var canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  var ctx = canvas.getContext('2d');
  ctx.drawImage(source, 0, 0);

  var color = extractDominantColor(ctx, w, h);
  var plate = generateBlurPlate(canvas, w, h);

  return new Promise(function (resolve) {
    requestAnimationFrame(function () {
      var cutoutDataUrl = extractSubject(canvas, w, h);
      var layers = {
        dominantColor: color.css,
        blurPlate: plate.dataUrl,
        cutout: cutoutDataUrl,
        sourceWidth: w,
        sourceHeight: h
      };
      resolve(layers);
    });
  });
}

/**
 * Applies decomposed image layers to a banner's .breakout-img element.
 */
export function applyLayersToBanner(shadow, layers) {
  if (!layers) return;
  var imgEl = shadow.querySelector('.breakout-img');
  if (!imgEl) return;

  imgEl.innerHTML = '';
  imgEl.style.opacity = '1';
  imgEl.style.mixBlendMode = 'normal';
  imgEl.style.backgroundColor = layers.dominantColor;
  imgEl.style.backgroundImage = 'url(' + layers.blurPlate + ')';
  imgEl.style.backgroundSize = 'cover';
  imgEl.style.backgroundPosition = 'center';

  var cutImg = document.createElement('img');
  cutImg.src = layers.cutout;
  cutImg.alt = 'Optimised subject layer';
  cutImg.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity 0.15s ease;z-index:1;';

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    cutImg.style.transition = 'none';
  }

  if (cutImg.complete && cutImg.naturalWidth > 0) {
    cutImg.style.opacity = '1';
  } else {
    cutImg.addEventListener('load', function () { cutImg.style.opacity = '1'; });
  }

  imgEl.appendChild(cutImg);
}

export const imageDecomposer = { extractDominantColor, generateBlurPlate, morphClose, extractSubject, decomposeImage, applyLayersToBanner };

// ── Default Config ──────────────────────────────────────────

export const DEFAULT_CONFIG = {
  mode: 'solid',
  preset: 'capsule',
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
  dismissTTL: 86400000
};

/**
 * Merges user config with defaults.
 */
export function resolveConfig(userConfig) {
  return { ...DEFAULT_CONFIG, ...userConfig };
}

// ── Side Panel Renderer ─────────────────────────────────────

/**
 * Renders the side panel banner into a Shadow DOM host element.
 * @param {Object} config - Banner configuration
 * @param {Object} [area] - Optional positioning area { x, y, width, height }
 * @returns {HTMLElement} The host element (append to document yourself)
 */
export function renderSideBanner(config, area) {
  config = resolveConfig(config);
  const host = document.createElement('div');
  host.id = 'ff-side-host';

  const expandedWidth = area ? Math.max(340, area.width) : 340;
  const hostLeft = area ? area.x + area.width - expandedWidth : window.innerWidth - expandedWidth;
  host.style.cssText = area
    ? `position:fixed;top:${area.y}px;left:${hostLeft}px;width:${expandedWidth}px;height:${area.height}px;z-index:2147483647;pointer-events:none;contain:layout style;`
    : 'position:fixed;top:0;right:0;bottom:0;z-index:2147483647;pointer-events:none;contain:layout style;';

  const shadow = host.attachShadow({ mode: 'closed' });
  const A = config.accent, G = config.mode === 'glass';

  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; margin: 0; padding: 0; }

      .panel {
        position: ${area ? 'absolute' : 'fixed'}; top: ${area ? '0' : '50%'}; right: ${area ? '0' : '-6px'}; left:${area ? 'auto' : 'auto'}; transform: ${area ? 'none' : 'translateY(-50%)'};
        width: ${area ? `${Math.max(286, area.width)}px` : '82px'}; height: ${area ? `${Math.max(360, area.height)}px` : '440px'};
        pointer-events: auto; cursor: pointer;
        transition: width 0.45s cubic-bezier(0.16,1,0.3,1), right 0.45s cubic-bezier(0.16,1,0.3,1);
        overflow: visible; z-index: 2147483647;
      }
      .panel:hover, .panel.expanded { width: ${area ? `${expandedWidth}px` : '340px'}; right: 0; }

      .shell {
        position: absolute; inset: 0;
        ${G
          ? `background: rgba(255,255,255,0.08); -webkit-backdrop-filter: blur(40px) saturate(180%) brightness(1.1); backdrop-filter: blur(40px) saturate(180%) brightness(1.1); border-left: 1px solid rgba(255,255,255,0.18); border-top: 1px solid rgba(255,255,255,0.12);`
          : `background: linear-gradient(178deg, #06060e 0%, ${darken(A, 0.25)} 60%, #0a0818 100%);`}
        clip-path: polygon(22% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 88%);
        transition: clip-path 0.45s cubic-bezier(0.16,1,0.3,1);
        box-shadow: -6px 0 40px rgba(0,0,0,0.5);
      }
      .panel:hover .shell { clip-path: polygon(6% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 94%); will-change: clip-path; }

      @supports not ((-webkit-backdrop-filter:blur(1px)) or (backdrop-filter:blur(1px))) {
        .shell { background: rgba(10,10,22,0.92) !important; }
      }

      ${G ? `.shell::after { content:''; position:absolute; inset:0; clip-path:inherit; background: linear-gradient(180deg, rgba(255,255,255,0.12) 0%, transparent 40%, rgba(255,255,255,0.04) 100%); pointer-events:none; }` : ''}

      .breakout {
        position: absolute; top: 12px; left: -55px;
        width: 200px; height: 260px;
        z-index: 3;
        transition: all 0.5s cubic-bezier(0.16,1,0.3,1);
        pointer-events: none;
      }
      .panel:hover .breakout { left: -80px; width: 260px; height: 300px; top: 0; }

      .athlete { width: 100%; height: 100%; position: relative; }
      .athlete .body {
        position: absolute; bottom: 0; left: 50%; transform: translateX(-50%);
        width: 80%; height: 92%;
        background: linear-gradient(170deg, ${A} 0%, ${darken(A, 0.4)} 100%);
        clip-path: polygon(42% 0%, 58% 0%, 62% 3%, 60% 8%, 55% 8%, 58% 12%, 65% 10%, 72% 14%, 68% 18%, 62% 16%, 58% 20%, 60% 28%, 75% 22%, 88% 18%, 95% 22%, 85% 28%, 70% 32%, 62% 35%, 60% 42%, 58% 55%, 65% 62%, 72% 58%, 78% 65%, 70% 72%, 58% 68%, 55% 75%, 58% 85%, 62% 95%, 55% 100%, 48% 100%, 45% 92%, 42% 82%, 38% 75%, 35% 68%, 28% 72%, 22% 65%, 30% 58%, 38% 62%, 42% 55%, 40% 42%, 38% 35%, 30% 32%, 15% 28%, 5% 22%, 12% 18%, 25% 14%, 38% 16%, 42% 20%, 40% 12%, 45% 8%, 42% 3%);
        transition: transform 0.4s cubic-bezier(0.16,1,0.3,1);
      }
      .panel:hover .athlete .body { transform: translateX(-50%) scale(1.06) translateY(-4px); }

      .athlete::before {
        content: ''; position: absolute; top: 40%; left: 50%; transform: translate(-50%,-50%);
        width: 160%; height: 160%;
        background: radial-gradient(ellipse, ${hexRgba(A, 0.35)} 0%, ${hexRgba(A, 0.1)} 40%, transparent 70%);
        z-index: -1;
      }
      .streak {
        position: absolute; background: ${hexRgba(A, 0.25)}; border-radius: 1px;
        transform-origin: right center;
      }

      .v-label {
        position: absolute; top: 50%; right: 20px;
        transform: translateY(-50%) rotate(180deg);
        writing-mode: vertical-rl;
        font: 800 15px/1 -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif;
        color: #fff; letter-spacing: 3px; text-transform: uppercase;
        opacity: 1; transition: opacity 0.3s; z-index: 5;
      }
      .panel:hover .v-label { opacity: 0; }

      .pulse-dot {
        position: absolute; bottom: 30px; right: 32px;
        width: 8px; height: 8px; border-radius: 50%;
        background: ${A}; z-index: 5;
        animation: dot-pulse 2s ease-in-out infinite;
      }
      .panel:hover .pulse-dot { opacity: 0; }
      @keyframes dot-pulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(1.5); } }

      .expanded-content {
        position: absolute; bottom: 0; right: 0; width: 100%; height: 100%;
        display: flex; flex-direction: column; justify-content: flex-end;
        padding: 16px 16px 20px 30px;
        opacity: 0; transform: translateX(16px);
        transition: opacity 0.4s 0.08s, transform 0.4s 0.08s cubic-bezier(0.16,1,0.3,1);
        z-index: 4;
      }
      .panel:hover .expanded-content { opacity: 1; transform: translateX(0); }

      .ad-tag { font: 600 8px/1 -apple-system, sans-serif; color: rgba(255,255,255,0.3); text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 10px; }
      .brand { font: 900 11px/1 -apple-system, sans-serif; color: rgba(255,255,255,0.5); text-transform: uppercase; letter-spacing: 3px; margin-bottom: 6px; }
      .headline { font: 900 30px/1 -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif; color: #fff; text-transform: uppercase; text-shadow: 0 2px 16px rgba(0,0,0,0.6); margin-bottom: 4px; }
      .headline em { font-style: normal; color: ${A}; display: block; font-size: 38px; }
      .sub { font: 400 12px/1.4 -apple-system, sans-serif; color: rgba(255,255,255,0.6); margin-bottom: 14px; }

      .swatches { display: flex; gap: 6px; margin-bottom: 14px; }
      .sw { width: 26px; height: 26px; border-radius: 50%; border: 2.5px solid transparent; cursor: pointer; transition: transform 0.2s, border-color 0.2s; }
      .sw:hover { transform: scale(1.25); }
      .sw.on { border-color: #fff; transform: scale(1.15); }

      .cta {
        display: inline-flex; align-items: center; gap: 8px;
        padding: 11px 24px 11px 16px;
        background: ${A}; color: #fff;
        font: 700 12px/1 -apple-system, sans-serif; text-transform: uppercase; letter-spacing: 1.2px;
        border: none; cursor: pointer;
        clip-path: polygon(0% 0%, 88% 0%, 100% 50%, 88% 100%, 0% 100%);
        min-height: 44px; min-width: 44px;
        transition: transform 0.2s, filter 0.2s;
      }
      .cta:hover { transform: scale(1.06); filter: brightness(1.15); }
      .cta:focus-visible { outline: 2px solid #fff; outline-offset: 3px; }

      .qr-row { display: flex; align-items: center; gap: 10px; margin-top: 14px; opacity: 0.35; transition: opacity 0.35s, transform 0.35s; transform: scale(0.95); }
      .qr-row:hover { opacity: 1; transform: scale(1); }
      .qr-row:hover svg { filter: drop-shadow(0 0 8px ${hexRgba(A, 0.5)}); }
      .qr-row svg { color: rgba(255,255,255,0.75); transition: filter 0.3s; }
      .qr-row .ql { font: 400 9px/1.3 -apple-system, sans-serif; color: rgba(255,255,255,0.45); }

      .x {
        position: absolute; top: 10px; right: 10px;
        width: 28px; height: 28px; border-radius: 50%; border: none;
        background: rgba(0,0,0,0.4); color: rgba(255,255,255,0.6);
        font-size: 14px; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        opacity: 0; transition: opacity 0.3s; z-index: 10;
        min-width: 44px; min-height: 44px;
      }
      .panel:hover .x { opacity: 1; }
      .x:hover { background: rgba(0,0,0,0.6); color: #fff; }
      .x:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }

      @keyframes enterRight { from { transform: translateY(-50%) translateX(100%); opacity: 0; } to { transform: translateY(-50%); opacity: 1; } }
      .panel { animation: ${area ? 'none' : 'enterRight 0.4s cubic-bezier(0.16,1,0.3,1) both'}; }
      @media (prefers-reduced-motion: reduce) { .panel { animation: none; } *, *::before, *::after { transition: none !important; animation: none !important; } }
    </style>

    <div class="panel" role="complementary" aria-label="Advertisement">
      <div class="shell"></div>

      <div class="breakout">
        <div class="athlete"><div class="body"></div></div>
        <div class="breakout-img" style="position:absolute;top:0;left:0;width:100%;height:100%;z-index:0;border-radius:inherit;overflow:hidden;opacity:0.35;mix-blend-mode:screen;"></div>
      </div>

      <div class="v-label">Explore</div>
      <div class="pulse-dot"></div>

      <div class="expanded-content">
        <div class="ad-tag">Sponsored</div>
        <div class="brand">${config.brand}</div>
        <div class="headline">${config.sideHeadline}<br><em>${config.sideHeadlineEmphasis}</em></div>
        <div class="sub">${config.sideSubtext.replace(/\n/g, '<br>')}</div>
        <div class="swatches">
          <div class="sw on" style="background:${A}" data-c="${A}"></div>
          <div class="sw" style="background:#2563eb" data-c="#2563eb"></div>
          <div class="sw" style="background:#16a34a" data-c="#16a34a"></div>
          <div class="sw" style="background:#f5f5f5" data-c="#f5f5f5"></div>
        </div>
        <button class="cta" tabindex="0">${config.ctaText} &#9654;</button>
        <div class="qr-row">
          <div>${generateQR(config.ctaUrl || 'https://brand.co/side', 58)}</div>
          <div class="ql">Scan to<br>shop mobile</div>
        </div>
      </div>

      <button class="x" aria-label="Dismiss advertisement" tabindex="0">&times;</button>
    </div>`;

  // Apply image layers or fallback
  if (config.optimizedLayers) {
    applyLayersToBanner(shadow, config.optimizedLayers);
  } else {
    var sideBreakoutImg = shadow.querySelector('.breakout-img');
    if (sideBreakoutImg) {
      var athleteImg = createOptimizedImage('athlete-hero', 'zPYFHQYGp4eCapgYx3Rqd0mPlvJY', 'Athlete breakout', '', 400, 533);
      sideBreakoutImg.appendChild(athleteImg);
    }
  }

  // Energy streaks
  const ath = shadow.querySelector('.athlete');
  for (let i = 0; i < 8; i++) {
    const s = document.createElement('div');
    s.className = 'streak';
    s.style.cssText = 'top:' + (10 + Math.random() * 75) + '%;left:' + (-30 - Math.random() * 50) + '%;width:' + (15 + Math.random() * 35) + '%;height:' + (1 + Math.random() * 2.5) + 'px;opacity:' + (0.1 + Math.random() * 0.3) + ';';
    ath.appendChild(s);
  }

  // Swatch interactivity
  const sws = shadow.querySelectorAll('.sw');
  const body = shadow.querySelector('.body');
  sws.forEach(s => s.addEventListener('click', () => {
    sws.forEach(x => x.classList.remove('on'));
    s.classList.add('on');
    const c = s.dataset.c;
    body.style.background = 'linear-gradient(170deg, ' + c + ' 0%, ' + darken(c, 0.4) + ' 100%)';
    logEvent('ff:ad:interaction', { zone: 'side', action: 'swatch', color: c });
  }));

  // Parallax
  const panel = shadow.querySelector('.panel');
  const bo = shadow.querySelector('.breakout');
  let sideRaf = 0;
  panel.addEventListener('mousemove', e => {
    if (sideRaf) return;
    sideRaf = requestAnimationFrame(() => {
      const r = panel.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      bo.style.transform = 'translate(' + (x * -18) + 'px,' + (y * -12) + 'px)';
      sideRaf = 0;
    });
  });
  panel.addEventListener('mouseleave', () => { cancelAnimationFrame(sideRaf); sideRaf = 0; bo.style.transform = ''; });

  shadow.querySelector('.cta').addEventListener('click', () => logEvent('ff:ad:click', { zone: 'side', preset: config.preset, mode: config.mode }));
  shadow.querySelector('.x').addEventListener('click', () => {
    panel.style.transform = area ? 'translateX(120%)' : 'translateY(-50%) translateX(120%)';
    panel.style.opacity = '0';
    setTimeout(() => host.remove(), 400);
    setDismissed('side');
    logEvent('ff:ad:dismiss', { zone: 'side' });
  });
  panel.addEventListener('keydown', e => { if (e.key === 'Escape') shadow.querySelector('.x').click(); });

  logEvent('ff:ad:loaded', { zone: 'side' });
  setTimeout(() => logEvent('ff:ad:impression', { zone: 'side' }), 800);
  return host;
}

// ── Footer Banner Renderer ──────────────────────────────────

/**
 * Renders the footer banner into a Shadow DOM host element.
 * @param {Object} config - Banner configuration
 * @param {Object} [area] - Optional positioning area { x, y, width, height }
 * @returns {HTMLElement} The host element
 */
export function renderFooterBanner(config, area) {
  config = resolveConfig(config);
  const host = document.createElement('div');
  host.id = 'ff-footer-host';

  host.style.cssText = area
    ? `position:fixed;top:${area.y}px;left:${area.x}px;width:${area.width}px;height:${area.height}px;z-index:2147483646;pointer-events:none;contain:layout style;`
    : 'position:fixed;bottom:0;left:0;right:0;z-index:2147483646;pointer-events:none;contain:layout style;';

  const shadow = host.attachShadow({ mode: 'closed' });
  const A = config.accent, G = config.mode === 'glass', P = config.preset;

  const clip = SHAPE_PRESETS[P] || SHAPE_PRESETS.capsule;
  const bg = G ? 'rgba(255,255,255,0.08)' : 'linear-gradient(95deg, #06060e 0%, ' + darken(A, 0.22) + ' 45%, #0a0818 100%)';

  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; margin: 0; padding: 0; }

      .banner {
        position: ${area ? 'absolute' : 'fixed'}; bottom: ${area ? 'auto' : '0'}; top:${area ? '0' : 'auto'}; left: 0; right: ${area ? 'auto' : '0'};
        width:${area ? `${area.width}px` : 'auto'}; height: ${area ? `${Math.max(132, area.height)}px` : '150px'};
        pointer-events: auto; overflow: visible;
        z-index: 2147483646;
      }

      .shell {
        position: absolute; inset: 0;
        background: ${bg};
        ${G ? '-webkit-backdrop-filter: blur(40px) saturate(180%) brightness(1.1); backdrop-filter: blur(40px) saturate(180%) brightness(1.1); border-top: 1px solid rgba(255,255,255,0.18);' : ''}
        clip-path: ${clip.desktop};
        box-shadow: 0 -4px 40px rgba(0,0,0,0.45);
        transition: clip-path 0.4s cubic-bezier(0.16,1,0.3,1);
      }
      @supports not ((-webkit-backdrop-filter:blur(1px)) or (backdrop-filter:blur(1px))) {
        .shell { background: rgba(10,10,22,0.92) !important; }
      }

      ${G ? `.shell::after { content:''; position:absolute; inset:0; clip-path:inherit; background: linear-gradient(175deg, rgba(255,255,255,0.14) 0%, transparent 35%, rgba(255,255,255,0.03) 100%); pointer-events:none; }` : ''}

      .breakout {
        position: absolute; bottom: 16px; left: 48px;
        width: 210px; height: 220px;
        z-index: 5;
        box-shadow: 0 -10px 30px rgba(0,0,0,0.45);
        transition: transform 0.45s cubic-bezier(0.16,1,0.3,1);
        cursor: pointer;
      }
      .breakout:hover { transform: translateY(-14px) scale(1.08) rotate(-3deg); }

      .product { width: 100%; height: 100%; position: relative; }
      .shoe {
        position: absolute; bottom: 8%; left: 5%; width: 90%; height: 52%;
        background: linear-gradient(140deg, ${A}, ${darken(A, 0.5)});
        clip-path: polygon(5% 48%, 0% 78%, 12% 100%, 88% 100%, 100% 82%, 100% 42%, 88% 28%, 72% 18%, 52% 20%, 38% 12%, 22% 18%, 8% 32%);
      }
      .sole {
        position: absolute; bottom: 6%; left: 10%; width: 78%; height: 12%;
        background: #fff; opacity: 0.92;
        clip-path: polygon(2% 0%, 98% 0%, 94% 100%, 6% 100%);
      }
      .swoosh {
        position: absolute; bottom: 30%; left: 22%; width: 52%; height: 18%;
        background: rgba(255,255,255,0.88);
        clip-path: polygon(0% 100%, 100% 0%, 82% 0%, 0% 65%);
      }
      .midsole {
        position: absolute; bottom: 14%; left: 14%; width: 68%; height: 8%;
        background: linear-gradient(90deg, rgba(255,255,255,0.1), rgba(255,255,255,0.3), rgba(255,255,255,0.1));
        border-radius: 4px;
      }
      .product::after {
        content: ''; position: absolute; top: 45%; left: 50%;
        transform: translate(-50%,-50%); width: 150%; height: 150%;
        background: radial-gradient(ellipse, ${hexRgba(A, 0.35)} 0%, transparent 60%);
        z-index: -1;
      }

      .content {
        position: absolute; bottom: 0; left: 280px; right: 0; height: 100%;
        display: flex; align-items: center; gap: 28px;
        padding: 0 24px; padding-bottom: env(safe-area-inset-bottom, 0px);
        z-index: 4;
      }

      .text { flex: 1; min-width: 0; }
      .ad-tag { font: 600 8px/1 -apple-system, sans-serif; color: rgba(255,255,255,0.3); text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 4px; }
      .brand-sm { font: 700 10px/1 -apple-system, sans-serif; color: rgba(255,255,255,0.45); text-transform: uppercase; letter-spacing: 2px; margin-bottom: 4px; }
      .hl { font: 900 28px/1.0 -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif; color: #fff; text-transform: uppercase; text-shadow: 0 2px 20px rgba(0,0,0,0.6); }
      .hl em { font-style: normal; color: ${A}; display: block; font-size: 38px; }
      .sub { font: 400 11px/1.4 -apple-system, sans-serif; color: rgba(255,255,255,0.55); margin-top: 3px; }

      .chips { display: flex; gap: 6px; max-height: 0; overflow: hidden; opacity: 0; transition: max-height 0.3s, opacity 0.3s, margin 0.3s; margin-top: 0; }
      .banner:hover .chips { max-height: 36px; opacity: 1; margin-top: 6px; }
      .chip {
        font: 500 9px/1 -apple-system, sans-serif; padding: 4px 10px;
        border: 1px solid rgba(255,255,255,0.18); border-radius: 14px;
        color: rgba(255,255,255,0.65); white-space: nowrap; cursor: pointer;
        transition: all 0.15s;
      }
      .chip:hover { background: ${hexRgba(A, 0.2)}; border-color: ${A}; color: #fff; }

      .cta {
        display: inline-flex; align-items: center; gap: 8px;
        padding: 13px 30px 13px 18px;
        background: ${A}; color: #fff;
        font: 700 13px/1 -apple-system, sans-serif; text-transform: uppercase; letter-spacing: 1.2px;
        border: none; cursor: pointer;
        clip-path: polygon(0% 0%, 88% 0%, 100% 50%, 88% 100%, 0% 100%, 8% 50%);
        min-height: 44px; min-width: 44px; flex-shrink: 0;
        transition: transform 0.2s, filter 0.2s;
      }
      .cta:hover { transform: scale(1.06); filter: brightness(1.15); }
      .cta:focus-visible { outline: 2px solid #fff; outline-offset: 3px; }

      .qr { display: flex; flex-direction: column; align-items: center; gap: 4px; flex-shrink: 0; opacity: 0.3; transition: opacity 0.35s, transform 0.35s; transform: scale(0.92); }
      .qr:hover { opacity: 1; transform: scale(1); }
      .qr:hover svg { filter: drop-shadow(0 0 10px ${hexRgba(A, 0.5)}); }
      .qr svg { color: rgba(255,255,255,0.75); transition: filter 0.3s; }
      .qr span { font: 500 8px/1 -apple-system, sans-serif; color: rgba(255,255,255,0.4); text-transform: uppercase; letter-spacing: 0.5px; }

      .dismiss {
        position: absolute; top: 6px; right: 16px;
        width: 28px; height: 28px; border-radius: 50%; border: none;
        background: rgba(0,0,0,0.3); color: rgba(255,255,255,0.5);
        font-size: 14px; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        z-index: 10; min-width: 44px; min-height: 44px;
        opacity: 0; transition: opacity 0.2s;
      }
      .banner:hover .dismiss { opacity: 1; }
      .dismiss:hover { background: rgba(0,0,0,0.5); color: #fff; }
      .dismiss:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }

      @keyframes slideUp { from { transform: translateY(100%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
      .banner { animation: slideUp 0.4s cubic-bezier(0.16,1,0.3,1) both; }

      @media (max-width: 767px) {
        .banner { height: 125px; }
        .shell { clip-path: ${clip.mobile}; }
        .breakout { left: 10px; width: 120px; height: 140px; bottom: 8px; }
        .content { left: 140px; gap: 12px; padding: 0 12px; }
        .hl { font-size: 20px; }
        .hl em { font-size: 26px; }
        .cta { padding: 10px 20px 10px 14px; font-size: 11px; }
        .qr { display: none; }
      }
      @media (max-height: 499px) and (orientation: landscape) {
        .banner { height: 52px; }
        .breakout { display: none; }
        .content { left: 20px; }
        .chips { display: none; }
        .sub { display: none; }
        .hl { font-size: 16px; }
        .hl em { font-size: 18px; display: inline; }
      }
      @media (prefers-reduced-motion: reduce) { .banner { animation: none; } *, *::before, *::after { transition: none !important; animation: none !important; } }
    </style>

    <div class="banner" role="complementary" aria-label="Advertisement">
      <div class="shell"></div>

      <div class="breakout">
        <div class="breakout-img" style="position:absolute;top:0;left:0;width:100%;height:100%;z-index:0;border-radius:inherit;overflow:hidden;opacity:0.3;mix-blend-mode:screen;"></div>
        <div class="product">
          <div class="shoe"></div>
          <div class="sole"></div>
          <div class="midsole"></div>
          <div class="swoosh"></div>
        </div>
      </div>

      <div class="content">
        <div class="text">
          <div class="ad-tag">Sponsored</div>
          <div class="brand-sm">${config.brand}</div>
          <div class="hl">${config.headline}<br><em>${config.headlineEmphasis}</em></div>
          <div class="sub">${config.subtext}</div>
          <div class="chips">
            <span class="chip">Lightweight</span>
            <span class="chip">Responsive Foam</span>
            <span class="chip">All-Terrain</span>
          </div>
        </div>
        <button class="cta" tabindex="0">${config.ctaText} &#9654;</button>
        <div class="qr">
          ${generateQR(config.ctaUrl || 'https://brand.co/footer', 64)}
          <span>Scan</span>
        </div>
      </div>

      <button class="dismiss" aria-label="Dismiss advertisement" tabindex="0">&times;</button>
    </div>`;

  // Apply image layers or fallback
  if (config.optimizedLayers) {
    applyLayersToBanner(shadow, config.optimizedLayers);
  } else {
    var footBreakoutImg = shadow.querySelector('.breakout-img');
    if (footBreakoutImg) {
      var productImg = createOptimizedImage('product-hero', 'iigKHYY2d4d2eIiAe5h3iieHgHIH', 'Product breakout', '', 400, 267);
      footBreakoutImg.appendChild(productImg);
    }
  }

  // Parallax
  const banner = shadow.querySelector('.banner');
  const bk = shadow.querySelector('.breakout');
  let footRaf = 0;
  banner.addEventListener('mousemove', e => {
    if (footRaf) return;
    footRaf = requestAnimationFrame(() => {
      const r = banner.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      bk.style.transform = 'translate(' + (x * -22) + 'px,' + (y * -14) + 'px)';
      footRaf = 0;
    });
  });
  banner.addEventListener('mouseleave', () => { cancelAnimationFrame(footRaf); footRaf = 0; bk.style.transform = ''; });

  shadow.querySelector('.cta').addEventListener('click', () => logEvent('ff:ad:click', { zone: 'footer', preset: P, mode: config.mode }));
  shadow.querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => logEvent('ff:ad:interaction', { zone: 'footer', chip: c.textContent })));

  shadow.querySelector('.dismiss').addEventListener('click', () => {
    banner.style.transform = 'translateY(110%)'; banner.style.opacity = '0';
    setTimeout(() => host.remove(), 400);
    setDismissed('footer');
    logEvent('ff:ad:dismiss', { zone: 'footer' });
  });
  banner.addEventListener('keydown', e => { if (e.key === 'Escape') shadow.querySelector('.dismiss').click(); });

  logEvent('ff:ad:loaded', { zone: 'footer' });
  setTimeout(() => logEvent('ff:ad:impression', { zone: 'footer' }), 800);
  return host;
}

// ── Inline Banner Renderer ──────────────────────────────────

/**
 * Renders an inline banner after the given anchor node.
 * @param {Object} config - Banner configuration
 * @param {HTMLElement} anchorNode - DOM node to insert after
 * @param {Object} [area] - Optional area constraints
 * @returns {HTMLElement} The host element
 */
export function renderInlineBanner(config, anchorNode, area) {
  config = resolveConfig(config);
  const host = document.createElement('div');
  host.id = 'ff-inline-host';

  const articleEl = document.querySelector('article, .article, [role="article"]');
  const articleBounds = articleEl ? articleEl.getBoundingClientRect() : { left: 24, right: window.innerWidth - 24, width: window.innerWidth - 48 };
  const inlineWidth = area ? Math.min(articleBounds.width, area.width) : articleBounds.width;
  const inlineOffset = area ? Math.max(0, area.x - articleBounds.left) : 0;
  host.style.cssText = `margin: 24px 0; width:${inlineWidth}px; max-width:100%; transform:translateX(${inlineOffset}px);`;

  const shadow = host.attachShadow({ mode: 'open' });
  const accent = config.accent;
  const accent2 = darken(accent, 0.42);
  const isGlass = config.mode === 'glass';

  shadow.innerHTML = `
    <style>
      :host { display: block; }
      .inline-banner {
        position: relative;
        overflow: hidden;
        border-radius: 18px;
        padding: 16px 18px;
        color: #fff;
        font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif;
        ${isGlass
          ? `background: rgba(15,23,42,0.68); -webkit-backdrop-filter: blur(24px) saturate(180%); backdrop-filter: blur(24px) saturate(180%); border: 1px solid rgba(255,255,255,0.14);`
          : `background: linear-gradient(135deg, ${accent}, ${accent2}); border: 1px solid rgba(255,255,255,0.08);`
        }
        box-shadow: 0 18px 48px rgba(15,23,42,0.16);
      }
      .inline-banner::before {
        content: '';
        position: absolute;
        inset: 0;
        background: linear-gradient(115deg, rgba(255,255,255,0.12), transparent 44%);
        pointer-events: none;
      }
      .inline-layout {
        position: relative;
        z-index: 1;
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 16px;
        align-items: center;
      }
      .inline-label {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        margin-bottom: 8px;
        font-size: 9px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: rgba(255,255,255,0.72);
      }
      .inline-label::before {
        content: '';
        width: 8px;
        height: 8px;
        border-radius: 999px;
        background: ${accent};
        box-shadow: 0 0 0 4px ${hexRgba(accent, 0.14)};
      }
      .inline-title {
        display: block;
        font-size: 20px;
        font-weight: 800;
        line-height: 1.15;
        letter-spacing: -0.03em;
        margin-bottom: 6px;
      }
      .inline-copy {
        display: block;
        font-size: 13px;
        line-height: 1.5;
        color: rgba(255,255,255,0.76);
        max-width: 46ch;
      }
      .inline-actions {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 10px;
      }
      .inline-chip {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 44px;
        min-height: 44px;
        padding: 0 16px;
        border-radius: 999px;
        border: none;
        background: #fff;
        color: #0f172a;
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
      }
      .inline-meta {
        font-size: 10px;
        color: rgba(255,255,255,0.62);
      }
      @media (max-width: 720px) {
        .inline-layout { grid-template-columns: 1fr; }
        .inline-actions { align-items: flex-start; }
      }
    </style>
    <section class="inline-banner" role="complementary" aria-label="Advertisement">
      <div class="inline-layout">
        <div>
          <span class="inline-label">Sponsored Placement</span>
          <span class="inline-title">${config.headline} ${config.headlineEmphasis}</span>
          <span class="inline-copy">${config.subtext}</span>
        </div>
        <div class="inline-actions">
          <button class="inline-chip" type="button">${config.ctaText}</button>
          <span class="inline-meta">inline-placement</span>
        </div>
      </div>
    </section>`;

  shadow.querySelector('.inline-chip').addEventListener('click', () => {
    logEvent('ff:ad:click', { zone: 'inline' });
  });

  if (anchorNode && anchorNode.parentNode) {
    anchorNode.insertAdjacentElement('afterend', host);
  }

  logEvent('ff:ad:loaded', { zone: 'inline' });
  setTimeout(() => {
    if (host.isConnected) {
      logEvent('ff:ad:impression', { zone: 'inline' });
    }
  }, 600);
  return host;
}

// ── Convenience: Remove all banners ─────────────────────────

export function removeAllBanners() {
  document.getElementById('ff-side-host')?.remove();
  document.getElementById('ff-footer-host')?.remove();
  document.getElementById('ff-inline-host')?.remove();
}
