// Turns each machine's official image into a small local thumbnail.
// Usage: npm run machines:thumbs [machine-id ...]
// Source files land in tmpcode/, which is gitignored, and are never executed.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC_DIR = join(ROOT, 'tmpcode/machine-src');
const OUT_DIR = join(ROOT, 'public/machines');
const MAX_BYTES = 40 * 1024 * 1024;

mkdirSync(SRC_DIR, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });

const { machines } = JSON.parse(readFileSync(join(ROOT, 'data/machines.json'), 'utf8'));
const only = process.argv.slice(2);
let failed = 0;

for (const machine of machines) {
  if (!machine.image || !machine.imageSource) continue;
  if (only.length && !only.includes(machine.id)) continue;
  try {
    const response = await fetch(machine.imageSource, {
      headers: { 'user-agent': 'Mozilla/5.0 (runrtxspark thumbnail builder)' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const type = response.headers.get('content-type') ?? '';
    if (!type.startsWith('image/')) throw new Error(`unexpected content-type ${type}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_BYTES) throw new Error(`too large: ${buffer.length}`);
    writeFileSync(join(SRC_DIR, machine.id), buffer);

    const output = join(OUT_DIR, machine.image);
    const crop = machine.imageCrop;
    // Crop in its own pass: sharp runs trim before extract within a single pipeline.
    const input = crop ? await sharp(buffer).extract(crop).png().toBuffer() : buffer;
    await sharp(input)
      .trim({ threshold: 12 })
      .resize(320, 240, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .webp({ quality: 82, alphaQuality: 90 })
      .toFile(output);
    console.log(`ok   ${machine.id} (${Math.round(readFileSync(output).length / 1024)} KB)`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${machine.id}: ${error.message}`);
  }
}

process.exit(failed ? 1 : 0);
