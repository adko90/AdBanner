/**
 * AI-Aware Image Optimization Pipeline
 *
 * Processes source images into optimized AVIF/WebP/JPEG at multiple
 * resolution tiers, with perceptual quality floor detection (SSIM >= 0.95)
 * and ThumbHash placeholder generation.
 *
 * Usage: node scripts/optimize-images.mjs
 * Input:  src/images/source/*.{jpg,jpeg,png,webp}
 * Output: src/images/optimized/<name>-<width>.<format>
 *         src/images/optimized/manifest.json
 */
import sharp from 'sharp';
import { rgbaToThumbHash } from 'thumbhash';
import { readdir, stat, writeFile } from 'fs/promises';
import { join, dirname, parse } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE_DIR = join(__dirname, '..', 'src', 'images', 'source');
const OUTPUT_DIR = join(__dirname, '..', 'src', 'images', 'optimized');

// Resolution tiers: [label, maxWidth]
const TIERS = [
  ['mobile', 400],
  ['desktop', 760],
];

// Quality search range for SSIM floor detection
const QUALITY_RANGE = { min: 40, max: 85, step: 5 };

// Target SSIM threshold
const SSIM_TARGET = 0.95;

// Max file size in bytes
const MAX_SIZE = 102400; // 100KB

/**
 * Compute a simplified SSIM between two raw pixel buffers.
 * Uses luminance channel only for speed. Not a full SSIM implementation
 * but sufficient for quality-floor binary search.
 */
function computeSSIM(refBuf, testBuf, width, height, channels) {
  const N = width * height;
  let muRef = 0, muTest = 0;

  // Extract luminance (0.299R + 0.587G + 0.114B) from RGBA/RGB
  const refLum = new Float32Array(N);
  const testLum = new Float32Array(N);

  for (let i = 0; i < N; i++) {
    const off = i * channels;
    refLum[i] = 0.299 * refBuf[off] + 0.587 * refBuf[off + 1] + 0.114 * refBuf[off + 2];
    testLum[i] = 0.299 * testBuf[off] + 0.587 * testBuf[off + 1] + 0.114 * testBuf[off + 2];
    muRef += refLum[i];
    muTest += testLum[i];
  }

  muRef /= N;
  muTest /= N;

  let sigmaRef2 = 0, sigmaTest2 = 0, sigmaRefTest = 0;
  for (let i = 0; i < N; i++) {
    const dr = refLum[i] - muRef;
    const dt = testLum[i] - muTest;
    sigmaRef2 += dr * dr;
    sigmaTest2 += dt * dt;
    sigmaRefTest += dr * dt;
  }
  sigmaRef2 /= N;
  sigmaTest2 /= N;
  sigmaRefTest /= N;

  const C1 = (0.01 * 255) ** 2;
  const C2 = (0.03 * 255) ** 2;

  const num = (2 * muRef * muTest + C1) * (2 * sigmaRefTest + C2);
  const den = (muRef ** 2 + muTest ** 2 + C1) * (sigmaRef2 + sigmaTest2 + C2);

  return num / den;
}

/**
 * Find the lowest quality where SSIM >= target for a given format.
 * Returns { quality, ssim, size }.
 */
async function findQualityFloor(sourceSharp, width, height, format, refPixels, channels) {
  const formatOpts = {
    avif: (q) => sourceSharp.clone().resize(width).avif({ quality: q, effort: 4 }),
    webp: (q) => sourceSharp.clone().resize(width).webp({ quality: q }),
    jpeg: (q) => sourceSharp.clone().resize(width).jpeg({ quality: q, mozjpeg: true }),
  };

  let bestQ = QUALITY_RANGE.max;
  let bestSSIM = 1.0;
  let bestSize = 0;

  // Search from low quality upward, stop at first passing SSIM
  for (let q = QUALITY_RANGE.min; q <= QUALITY_RANGE.max; q += QUALITY_RANGE.step) {
    const encoded = await formatOpts[format](q).toBuffer();
    const size = encoded.length;

    // Decode back for SSIM comparison
    const decoded = sharp(encoded).resize(width);
    const { data: testPixels } = await decoded.ensureAlpha().raw().toBuffer({ resolveWithObject: true });

    // Compare at encoded resolution
    const resizedRef = await sourceSharp.clone().resize(width).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const ssim = computeSSIM(resizedRef.data, testPixels, width, resizedRef.info.height, 4);

    if (ssim >= SSIM_TARGET) {
      bestQ = q;
      bestSSIM = ssim;
      bestSize = size;
      break;
    }

    // Track the highest quality as fallback
    bestQ = q;
    bestSSIM = ssim;
    bestSize = size;
  }

  // If we never hit target, use max quality
  if (bestSSIM < SSIM_TARGET) {
    const encoded = await formatOpts[format](QUALITY_RANGE.max).toBuffer();
    bestQ = QUALITY_RANGE.max;
    bestSize = encoded.length;

    const decoded = sharp(encoded).resize(width);
    const { data: testPixels } = await decoded.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const resizedRef = await sourceSharp.clone().resize(width).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    bestSSIM = computeSSIM(resizedRef.data, testPixels, width, resizedRef.info.height, 4);
  }

  return { quality: bestQ, ssim: bestSSIM, size: bestSize };
}

/**
 * Generate ThumbHash from source image.
 * Returns base64-encoded ThumbHash string.
 */
async function generateThumbHash(sourceSharp) {
  // ThumbHash works best at ~100px max dimension
  const thumbSize = 100;
  const resized = sourceSharp.clone().resize(thumbSize, thumbSize, { fit: 'inside' });
  const { data, info } = await resized.ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  const hash = rgbaToThumbHash(info.width, info.height, data);
  return Buffer.from(hash).toString('base64');
}

/**
 * Process a single source image through the full pipeline.
 */
async function processImage(filePath, fileName) {
  const { name } = parse(fileName);
  const source = sharp(filePath);
  const metadata = await source.metadata();
  console.log(`\n  Processing: ${fileName} (${metadata.width}x${metadata.height})`);

  const result = {
    name,
    source: fileName,
    originalSize: (await stat(filePath)).size,
    width: metadata.width,
    height: metadata.height,
    thumbhash: null,
    variants: [],
  };

  // Generate ThumbHash
  result.thumbhash = await generateThumbHash(source);
  console.log(`    ThumbHash: ${result.thumbhash} (${result.thumbhash.length} chars)`);

  // Get reference pixels for SSIM at source resolution
  const { data: refPixels } = await source.clone().ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  // Process each tier x format
  for (const [tierName, maxWidth] of TIERS) {
    const tierWidth = Math.min(maxWidth, metadata.width);
    const tierHeight = Math.round(metadata.height * (tierWidth / metadata.width));

    for (const format of ['avif', 'webp', 'jpeg']) {
      const { quality, ssim, size } = await findQualityFloor(source, tierWidth, tierHeight, format, refPixels, 4);

      const ext = format === 'jpeg' ? 'jpg' : format;
      const outName = `${name}-${tierWidth}w.${ext}`;
      const outPath = join(OUTPUT_DIR, outName);

      // Encode at chosen quality
      const encodeOpts = {
        avif: () => source.clone().resize(tierWidth).avif({ quality, effort: 4 }),
        webp: () => source.clone().resize(tierWidth).webp({ quality }),
        jpeg: () => source.clone().resize(tierWidth).jpeg({ quality, mozjpeg: true }),
      };

      await encodeOpts[format]().toFile(outPath);
      const finalSize = (await stat(outPath)).size;

      const sizeKB = (finalSize / 1024).toFixed(1);
      const passed = finalSize <= MAX_SIZE ? 'PASS' : 'OVER';
      console.log(`    ${outName}: q=${quality}, SSIM=${ssim.toFixed(4)}, ${sizeKB}KB [${passed}]`);

      result.variants.push({
        tier: tierName,
        format,
        file: outName,
        width: tierWidth,
        height: tierHeight,
        quality,
        ssim: parseFloat(ssim.toFixed(4)),
        size: finalSize,
        under100KB: finalSize <= MAX_SIZE,
      });
    }
  }

  return result;
}

// Main
console.log('=== AI Image Optimization Pipeline ===');
console.log(`Source: ${SOURCE_DIR}`);
console.log(`Output: ${OUTPUT_DIR}`);

const files = (await readdir(SOURCE_DIR)).filter(f => /\.(jpe?g|png|webp)$/i.test(f));

if (files.length === 0) {
  console.log('\nNo source images found. Add images to src/images/source/');
  process.exit(1);
}

console.log(`Found ${files.length} source image(s)`);

const manifest = { generated: new Date().toISOString(), images: [] };

for (const file of files) {
  const result = await processImage(join(SOURCE_DIR, file), file);
  manifest.images.push(result);
}

// Write manifest
const manifestPath = join(OUTPUT_DIR, 'manifest.json');
await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

// Summary
console.log('\n=== Summary ===');
for (const img of manifest.images) {
  console.log(`\n${img.name}:`);
  console.log(`  Original: ${(img.originalSize / 1024).toFixed(1)}KB`);
  console.log(`  ThumbHash: ${img.thumbhash.length} chars (base64)`);

  const avifDesktop = img.variants.find(v => v.tier === 'desktop' && v.format === 'avif');
  if (avifDesktop) {
    const ratio = ((1 - avifDesktop.size / img.originalSize) * 100).toFixed(0);
    console.log(`  Best AVIF (desktop): ${(avifDesktop.size / 1024).toFixed(1)}KB (${ratio}% reduction), SSIM=${avifDesktop.ssim}`);
  }

  const allPass = img.variants.every(v => v.under100KB);
  console.log(`  All variants < 100KB: ${allPass ? 'YES' : 'NO'}`);
}

console.log('\nManifest written to:', manifestPath);
console.log('Pipeline complete.');
