import http from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', 'src');
const publishedRoot = path.resolve(__dirname, '..', '.verification-data');
const port = Number(process.env.PORT || 4173);
const mapperScript = await readFile(path.resolve(root, 'runtime', 'site-mapper.js'), 'utf8');

// Lazy-init Playwright browser (shared across requests)
let _browser = null;
async function getBrowser() {
  if (!_browser) {
    _browser = await chromium.launch({ headless: true });
  }
  return _browser;
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

  const viewports = {
    mobile:  { width: 390,  height: 844 },
    tablet:  { width: 820,  height: 1180 },
    desktop: { width: viewportWidth, height: viewportHeight },
  };
  const vp = viewports[device] || { width: viewportWidth, height: viewportHeight };

  let browser;
  let context;
  try {
    browser = await getBrowser();
    context = await browser.newContext({
      viewport: vp,
      userAgent: device === 'mobile'
        ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
        : undefined,
    });
    const page = await context.newPage();
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    // Wait for layout to settle
    await page.waitForTimeout(800);

    // Inject and run mapper
    const result = await page.evaluate((script) => {
      const fn = new Function(script + '\nreturn mapSite();');
      return fn();
    }, mapperScript);

    // Take a screenshot for the preview
    const screenshot = await page.screenshot({ fullPage: true, type: 'png' });
    const screenshotB64 = screenshot.toString('base64');

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ...result,
      screenshot: `data:image/png;base64,${screenshotB64}`,
    }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  } finally {
    if (context) await context.close().catch(() => {});
  }
}

async function proxySiteHandler(req, res, url) {
  const targetUrl = url.searchParams.get('url');
  if (!targetUrl) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing required "url" query parameter' }));
    return;
  }

  const viewportWidth = parseInt(url.searchParams.get('width') || '1440', 10);
  const viewportHeight = parseInt(url.searchParams.get('height') || '900', 10);

  let browser;
  let context;
  try {
    browser = await getBrowser();
    context = await browser.newContext({
      viewport: { width: viewportWidth, height: viewportHeight },
    });
    const page = await context.newPage();
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(800);

    // Capture self-contained HTML snapshot
    const snapshotHtml = await page.evaluate(() => {
      // Inline all computed styles into a style block
      const clone = document.documentElement.cloneNode(true);
      // Remove scripts for safety
      clone.querySelectorAll('script').forEach(s => s.remove());
      // Add base tag so relative resources resolve
      const base = document.createElement('base');
      base.href = document.location.origin;
      const head = clone.querySelector('head');
      if (head) head.prepend(base);
      return '<!DOCTYPE html>' + clone.outerHTML;
    });

    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "default-src 'self' 'unsafe-inline' data: blob:; script-src 'none';",
      'X-Frame-Options': 'SAMEORIGIN',
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
  console.log(`  GET  /api/proxy-site   — fetch & snapshot any URL for iframe preview`);
});

// Graceful shutdown: close Playwright browser
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    if (_browser) await _browser.close().catch(() => {});
    process.exit(0);
  });
}
