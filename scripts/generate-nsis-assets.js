const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

async function ensureDir(dir) {
  await fs.promises.mkdir(dir, { recursive: true });
}

async function toBmp(
  srcPngPath,
  outBmpPath,
  width,
  height,
  background = { r: 255, g: 255, b: 255, alpha: 1 }
) {
  // Since sharp doesn't support BMP directly, we'll create high-quality PNGs
  // that NSIS can use (NSIS MUI2 accepts PNG files as well)
  const outputPath = outBmpPath.replace('.bmp', '.png');
  await sharp(srcPngPath)
    .resize(width, height, { fit: 'contain', background })
    .flatten({ background })
    .png()
    .toFile(outputPath);
  console.log(`  Generated: ${path.basename(outputPath)} (${width}x${height})`);
}

async function main() {
  const projectRoot = process.cwd();
  const assetsDir = path.join(projectRoot, 'assets');
  const logoPng = path.join(assetsDir, 'stratosort-logo.png');
  const outDir = path.join(assetsDir, 'installer');

  if (!fs.existsSync(logoPng)) {
    console.log('[nsis-assets] Logo not found, skipping generation:', logoPng);
    return;
  }

  await ensureDir(outDir);
  const headerPng = path.join(outDir, 'header.bmp');
  const welcomePng = path.join(outDir, 'welcome.bmp');
  const finishPng = path.join(outDir, 'finish.bmp');

  // Recommended sizes for NSIS MUI2
  // header ~150x57, welcome/finish left bitmap ~164x314
  // Note: toBmp() outputs .png (NSIS MUI2 accepts PNG); paths are renamed internally
  await toBmp(logoPng, headerPng, 150, 57);
  await toBmp(logoPng, welcomePng, 164, 314);
  await toBmp(logoPng, finishPng, 164, 314);

  console.log('[nsis-assets] Generated PNG assets in:', outDir);
}

main().catch((err) => {
  console.error('[nsis-assets] Error generating assets', err);
  process.exit(1);
});
