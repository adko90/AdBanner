import http from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', 'src');
const publishedRoot = path.resolve(__dirname, '..', '.verification-data');
const port = Number(process.env.PORT || 4173);

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

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === 'POST' && url.pathname.startsWith('/api/publish/')) {
      const siteId = url.pathname.replace('/api/publish/', '');
      const fullPath = resolvePublishedPath(siteId);
      const payload = await readRequestBody(req);
      JSON.parse(payload);
      await mkdir(publishedRoot, { recursive: true });
      await writeFile(fullPath, payload, 'utf8');
      res.writeHead(204);
      res.end();
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
});
