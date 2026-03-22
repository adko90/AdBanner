import http from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { buildConfig } from '../src/runtime/config-builder.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', 'src');
const publishedRoot = path.resolve(__dirname, '..', '.verification-data');
const port = Number(process.env.PORT || 4173);
const mapperScript = await readFile(path.resolve(root, 'runtime', 'site-mapper.js'), 'utf8');

// Lazy-init Playwright browsers (shared across requests)
const _browsers = { chromium: null, webkit: null };
async function getBrowser(engine = 'chromium') {
  const key = engine === 'webkit' ? 'webkit' : 'chromium';
  if (!_browsers[key]) {
    const launcher = key === 'webkit' ? webkit : chromium;
    _browsers[key] = await launcher.launch({ headless: true });
  }
  return _browsers[key];
}

async function mapSiteHandler(req, res) {
  const body = await readRequestBody(req);
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid JSON body' }));
    return;
  }

  const targetUrl = payload.url;
  if (!targetUrl || typeof targetUrl !== 'string') {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing required "url" field' }));
    return;
  }

  const viewportWidth = payload.viewportWidth || 1440;
  const viewportHeight = payload.viewportHeight || 900;
  const device = payload.device; // 'mobile' | 'tablet' | 'desktop' | undefined
  const browserEngine = payload.browser || 'chromium'; // 'chromium' | 'webkit'
  const multiBreakpoint = payload.multiBreakpoint === true;

  const VIEWPORTS = {
    mobile:  { width: 390,  height: 844 },
    tablet:  { width: 820,  height: 1180 },
    desktop: { width: viewportWidth, height: viewportHeight },
  };
  const vp = VIEWPORTS[device] || { width: viewportWidth, height: viewportHeight };

  // Helper: run mapper at a single viewport
  async function runAtViewport(vpSpec, deviceName) {
    let context;
    try {
      const browser = await getBrowser(browserEngine);
      context = await browser.newContext({
        viewport: vpSpec,
        userAgent: deviceName === 'mobile'
          ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
          : undefined,
      });
      const page = await context.newPage();
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(800);

      // Lazy-content scroll: scroll to bottom to trigger lazy loads, then back to top
      await page.evaluate(async () => {
        const step = Math.max(window.innerHeight, 600);
        const maxY = document.documentElement.scrollHeight;
        for (let y = 0; y < maxY; y += step) {
          window.scrollTo(0, y);
          await new Promise(r => setTimeout(r, 200));
        }
        window.scrollTo(0, 0);
        await new Promise(r => setTimeout(r, 300));
      });

      // Readability pre-extraction: fetch page HTML, parse with jsdom, extract content selector
      let readabilitySelector = null;
      try {
        const html = await page.content();
        const dom = new JSDOM(html, { url: targetUrl });
        const reader = new Readability(dom.window.document, { charThreshold: 100 });
        const article = reader.parse();
        if (article) {
          // Re-query the live page to find the content root
          readabilitySelector = await page.evaluate(() => {
            const main = document.querySelector('article') || document.querySelector('[role="main"]') || document.querySelector('main');
            if (!main) return null;
            if (main.id) return `#${CSS.escape(main.id)}`;
            return main.tagName.toLowerCase();
          });
        }
      } catch { /* Readability is best-effort */ }

      const mapperOpts = { readabilitySelector };

      const result = await page.evaluate(({ script, opts }) => {
        const fn = new Function('options', script + '\nreturn mapSite(options);');
        return fn(opts);
      }, { script: mapperScript, opts: mapperOpts });

      const screenshot = await page.screenshot({ fullPage: true, type: 'png' });
      const screenshotB64 = screenshot.toString('base64');

      return {
        ...result,
        screenshot: `data:image/png;base64,${screenshotB64}`,
      };
    } finally {
      if (context) await context.close().catch(() => {});
    }
  }

  try {
    if (multiBreakpoint) {
      // Run at all 3 breakpoints, return unified result
      const [mobile, tablet, desktop] = await Promise.all([
        runAtViewport(VIEWPORTS.mobile, 'mobile'),
        runAtViewport(VIEWPORTS.tablet, 'tablet'),
        runAtViewport(VIEWPORTS.desktop, 'desktop'),
      ]);

      // Merge: dedupe slots by region, keep per-breakpoint rects
      const merged = mergeBreakpointResults({ mobile, tablet, desktop });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(merged));
    } else {
      const result = await runAtViewport(vp, device);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    }
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

function mergeBreakpointResults(byDevice) {
  // Use desktop as the primary result, augment opportunities with per-breakpoint rects
  const primary = byDevice.desktop;
  const seenRegions = new Map();

  for (const [deviceName, result] of Object.entries(byDevice)) {
    for (const opp of result.opportunities) {
      const key = `${opp.region}-${opp.anchorSelector}`;
      if (!seenRegions.has(key)) {
        seenRegions.set(key, {
          ...opp,
          rects: { [deviceName]: opp.rect },
          deviceApplicability: [deviceName],
        });
      } else {
        const existing = seenRegions.get(key);
        existing.rects[deviceName] = opp.rect;
        if (!existing.deviceApplicability.includes(deviceName)) {
          existing.deviceApplicability.push(deviceName);
        }
        // Keep higher score
        if (opp.score > existing.score) {
          existing.score = opp.score;
          existing.confidence = opp.confidence;
        }
      }
    }
  }

  const opportunities = Array.from(seenRegions.values()).sort((a, b) => b.score - a.score);

  return {
    version: 1,
    multiBreakpoint: true,
    mappedAt: primary.mappedAt,
    page: primary.page,
    topology: primary.topology,
    protectedRegions: primary.protectedRegions,
    contentZones: primary.contentZones,
    opportunities,
    summary: {
      totalSlots: opportunities.length,
      highConfidence: opportunities.filter(s => s.score >= 0.8).length,
      mediumConfidence: opportunities.filter(s => s.score >= 0.6 && s.score < 0.8).length,
      lowConfidence: opportunities.filter(s => s.score < 0.6).length,
      regions: [...new Set(opportunities.map(s => s.region))],
    },
    screenshots: {
      mobile: byDevice.mobile.screenshot,
      tablet: byDevice.tablet.screenshot,
      desktop: byDevice.desktop.screenshot,
    },
  };
}

// Rate limiter: max 10 proxy requests per minute
const _proxyTimestamps = [];
const PROXY_RATE_LIMIT = 10;
const PROXY_RATE_WINDOW_MS = 60_000;

function isValidProxyUrl(urlStr) {
  try {
    const parsed = new URL(urlStr);
    return ['http:', 'https:'].includes(parsed.protocol) && !parsed.hostname.match(/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/);
  } catch { return false; }
}

async function proxySiteHandler(req, res, url) {
  const targetUrl = url.searchParams.get('url');
  if (!targetUrl) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing required "url" query parameter' }));
    return;
  }

  if (!isValidProxyUrl(targetUrl)) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'URL must be a public http/https address' }));
    return;
  }

  // Rate limiting
  const now = Date.now();
  while (_proxyTimestamps.length && _proxyTimestamps[0] < now - PROXY_RATE_WINDOW_MS) _proxyTimestamps.shift();
  if (_proxyTimestamps.length >= PROXY_RATE_LIMIT) {
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Rate limit exceeded. Try again in a minute.' }));
    return;
  }
  _proxyTimestamps.push(now);

  const viewportWidth = parseInt(url.searchParams.get('width') || '1440', 10);
  const viewportHeight = parseInt(url.searchParams.get('height') || '900', 10);
  const browserEngine = url.searchParams.get('browser') || 'chromium';

  let context;
  try {
    const browser = await getBrowser(browserEngine);
    context = await browser.newContext({
      viewport: { width: viewportWidth, height: viewportHeight },
    });
    const page = await context.newPage();
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(800);

    // Capture self-contained HTML with absolute URL rewriting
    const origin = new URL(targetUrl).origin;
    const snapshotHtml = await page.evaluate((pageOrigin) => {
      const clone = document.documentElement.cloneNode(true);

      // Remove scripts for safety
      clone.querySelectorAll('script, noscript').forEach(s => s.remove());

      // Rewrite relative URLs to absolute for src, href, srcset, poster, action
      const rewriteAttr = (el, attr) => {
        const val = el.getAttribute(attr);
        if (!val || val.startsWith('data:') || val.startsWith('blob:') || val.startsWith('http')) return;
        try {
          el.setAttribute(attr, new URL(val, pageOrigin).href);
        } catch { /* malformed URL, skip */ }
      };

      clone.querySelectorAll('[src]').forEach(el => rewriteAttr(el, 'src'));
      clone.querySelectorAll('[href]').forEach(el => rewriteAttr(el, 'href'));
      clone.querySelectorAll('[poster]').forEach(el => rewriteAttr(el, 'poster'));
      clone.querySelectorAll('[action]').forEach(el => rewriteAttr(el, 'action'));

      // Rewrite srcset (each entry is "url size")
      clone.querySelectorAll('[srcset]').forEach(el => {
        const srcset = el.getAttribute('srcset');
        const rewritten = srcset.split(',').map(entry => {
          const parts = entry.trim().split(/\s+/);
          if (parts[0] && !parts[0].startsWith('http') && !parts[0].startsWith('data:')) {
            try { parts[0] = new URL(parts[0], pageOrigin).href; } catch {}
          }
          return parts.join(' ');
        }).join(', ');
        el.setAttribute('srcset', rewritten);
      });

      // Inline critical above-fold computed styles
      const aboveFold = document.querySelectorAll('header, nav, [role="banner"], main > *:first-child, body > *:first-child');
      const styleMap = [];
      aboveFold.forEach(el => {
        const cs = window.getComputedStyle(el);
        const key = ['background', 'color', 'font-size', 'font-family', 'padding', 'margin', 'display', 'flex-direction', 'gap', 'max-width']
          .map(p => `${p}:${cs.getPropertyValue(p)}`).join(';');
        const selector = el.id ? `#${CSS.escape(el.id)}` : el.tagName.toLowerCase();
        styleMap.push(`${selector}{${key}}`);
      });
      if (styleMap.length) {
        const styleEl = document.createElement('style');
        styleEl.textContent = styleMap.join('\n');
        const head = clone.querySelector('head');
        if (head) head.appendChild(styleEl);
      }

      // Set base tag to page origin for any remaining relative refs
      let base = clone.querySelector('base');
      if (!base) {
        base = document.createElement('base');
        const head = clone.querySelector('head');
        if (head) head.prepend(base);
      }
      base.href = pageOrigin;

      return '<!DOCTYPE html>' + clone.outerHTML;
    }, origin);

    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "default-src * 'unsafe-inline' data: blob:; script-src 'none'; object-src 'none';",
      'X-Frame-Options': 'SAMEORIGIN',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(snapshotHtml);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  } finally {
    if (context) await context.close().catch(() => {});
  }
}

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif'
};

function resolvePath(urlPathname) {
  const decoded = decodeURIComponent(urlPathname === '/' ? '/index.html' : urlPathname);
  const fullPath = path.resolve(root, `.${decoded}`);
  if (!fullPath.startsWith(root)) return null;
  return fullPath;
}

function resolvePublishedPath(siteId) {
  const safeSiteId = siteId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.resolve(publishedRoot, `${safeSiteId}.json`);
}

function resolvePublishedBackupPath(siteId) {
  const safeSiteId = siteId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.resolve(publishedRoot, `${safeSiteId}.previous.json`);
}

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    // --- Site Mapper API ---
    if (req.method === 'POST' && url.pathname === '/api/map-site') {
      await mapSiteHandler(req, res);
      return;
    }

    // --- Site Proxy API ---
    if (req.method === 'GET' && url.pathname === '/api/proxy-site') {
      await proxySiteHandler(req, res, url);
      return;
    }

    // --- Build Config API ---
    if (req.method === 'POST' && url.pathname === '/api/build-config') {
      const body = await readRequestBody(req);
      let payload;
      try {
        payload = JSON.parse(body);
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON body' }));
        return;
      }
      const { siteId, selectedSlots, opportunities, runtime } = payload;
      if (!siteId || !selectedSlots?.length || !opportunities?.length) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing required fields: siteId, selectedSlots, opportunities' }));
        return;
      }
      const config = buildConfig({ siteId, selectedSlots, opportunities, runtime });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(config));
      return;
    }

    if (req.method === 'POST' && url.pathname.startsWith('/api/publish/')) {
      const siteId = url.pathname.replace('/api/publish/', '');
      const fullPath = resolvePublishedPath(siteId);
      const backupPath = resolvePublishedBackupPath(siteId);
      const payload = await readRequestBody(req);
      JSON.parse(payload);
      await mkdir(publishedRoot, { recursive: true });
      try {
        const current = await readFile(fullPath, 'utf8');
        if (current && current !== payload) {
          await writeFile(backupPath, current, 'utf8');
        }
      } catch {}
      await writeFile(fullPath, payload, 'utf8');
      res.writeHead(204);
      res.end();
      return;
    }

    if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname.startsWith('/api/published-backup/')) {
      const siteId = url.pathname.replace('/api/published-backup/', '').replace(/\.json$/, '');
      const backupPath = resolvePublishedBackupPath(siteId);
      const body = await readFile(backupPath);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      res.end(body);
      return;
    }

    if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname.startsWith('/api/published/')) {
      const siteId = url.pathname.replace('/api/published/', '').replace(/\.json$/, '');
      const publishedPath = resolvePublishedPath(siteId);
      const fallbackPath = path.resolve(root, 'runtime', 'site-configs', `${siteId}.json`);
      let body;
      try {
        body = await readFile(publishedPath);
      } catch {
        body = await readFile(fallbackPath);
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      res.end(body);
      return;
    }

    const fullPath = resolvePath(url.pathname);
    if (!fullPath) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    const body = await readFile(fullPath);
    const ext = path.extname(fullPath).toLowerCase();
    res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'application/octet-stream' });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Verification server running at http://127.0.0.1:${port}`);
  console.log(`  POST /api/map-site     — analyze any URL for placement opportunities`);
  console.log(`  POST /api/build-config — convert selected slots into publishable config`);
  console.log(`  GET  /api/proxy-site   — fetch & snapshot any URL for iframe preview`);
});

// Graceful shutdown: close Playwright browsers
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    for (const b of Object.values(_browsers)) {
      if (b) await b.close().catch(() => {});
    }
    process.exit(0);
  });
}
