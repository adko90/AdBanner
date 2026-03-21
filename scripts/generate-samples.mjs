/**
 * Generate sample source images for pipeline testing.
 * Creates gradient-based hero images that simulate athlete/product photography.
 */
import sharp from 'sharp';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'src', 'images', 'source');

async function createSample(name, width, height, svg) {
  await sharp(Buffer.from(svg))
    .resize(width, height)
    .jpeg({ quality: 95 })
    .toFile(join(OUT, name));
  const stat = (await sharp(join(OUT, name)).metadata());
  console.log(`  ${name}: ${width}x${height}, ${stat.format}`);
}

// Athlete hero — dramatic dark gradient with silhouette-like shapes
const athleteSvg = `<svg width="1200" height="1600" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0.3" y2="1">
      <stop offset="0%" stop-color="#1a1a2e"/>
      <stop offset="50%" stop-color="#16213e"/>
      <stop offset="100%" stop-color="#0f3460"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.4" r="0.5">
      <stop offset="0%" stop-color="#e94560" stop-opacity="0.6"/>
      <stop offset="100%" stop-color="#e94560" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#e94560"/>
      <stop offset="100%" stop-color="#ff6b6b"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="1600" fill="url(#bg)"/>
  <ellipse cx="600" cy="640" rx="400" ry="500" fill="url(#glow)"/>
  <rect x="480" y="200" width="240" height="240" rx="120" fill="#e94560" opacity="0.85"/>
  <rect x="520" y="480" width="160" height="600" rx="30" fill="#16213e" opacity="0.9"/>
  <rect x="440" y="520" width="320" height="80" rx="20" fill="url(#accent)" opacity="0.7"/>
  <rect x="480" y="1080" width="100" height="400" rx="20" fill="#16213e" opacity="0.8" transform="rotate(-5 530 1280)"/>
  <rect x="620" y="1080" width="100" height="400" rx="20" fill="#16213e" opacity="0.8" transform="rotate(5 670 1280)"/>
  <circle cx="200" cy="300" r="80" fill="#e94560" opacity="0.15"/>
  <circle cx="1000" cy="200" r="120" fill="#0f3460" opacity="0.3"/>
  <rect x="100" y="1400" width="1000" height="4" fill="#e94560" opacity="0.3"/>
</svg>`;

// Product hero — shoe/sneaker style with dynamic background
const productSvg = `<svg width="1200" height="800" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="pbg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0c0c0c"/>
      <stop offset="40%" stop-color="#1a1a1a"/>
      <stop offset="100%" stop-color="#2d2d2d"/>
    </linearGradient>
    <radialGradient id="pglow" cx="0.5" cy="0.5" r="0.6">
      <stop offset="0%" stop-color="#ff6b35" stop-opacity="0.4"/>
      <stop offset="100%" stop-color="#ff6b35" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="shoe" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#ff4444"/>
      <stop offset="50%" stop-color="#ff6b35"/>
      <stop offset="100%" stop-color="#ffaa00"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="800" fill="url(#pbg)"/>
  <ellipse cx="600" cy="450" rx="500" ry="300" fill="url(#pglow)"/>
  <ellipse cx="600" cy="420" rx="320" ry="100" fill="url(#shoe)" opacity="0.9"/>
  <rect x="300" y="380" width="500" height="60" rx="30" fill="url(#shoe)" opacity="0.85"/>
  <polygon points="280,420 350,350 400,380 300,440" fill="#ff4444" opacity="0.8"/>
  <polygon points="800,400 850,340 900,380 820,430" fill="#ffaa00" opacity="0.7"/>
  <rect x="400" y="440" width="350" height="30" rx="15" fill="#222" opacity="0.6"/>
  <ellipse cx="600" cy="520" rx="350" ry="40" fill="#000" opacity="0.3"/>
  <rect x="0" y="700" width="1200" height="100" fill="#111"/>
  <circle cx="150" cy="150" r="60" fill="#ff6b35" opacity="0.1"/>
  <circle cx="1050" cy="100" r="90" fill="#ff4444" opacity="0.08"/>
  <rect x="50" y="750" width="200" height="3" fill="#ff6b35" opacity="0.4"/>
  <rect x="950" y="750" width="200" height="3" fill="#ff4444" opacity="0.4"/>
</svg>`;

console.log('Generating sample source images...');
await createSample('athlete-hero.jpg', 1200, 1600, athleteSvg);
await createSample('product-hero.jpg', 1200, 800, productSvg);
console.log('Done.');
