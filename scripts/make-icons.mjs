// Generates the PWA icons as real PNGs with no image dependencies, so the
// repo stays free of binary assets that nobody can diff.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

function crc32(buf) {
  let c, table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function render(size) {
  const px = Buffer.alloc(size * size * 4);
  const set = (x, y, r, g, b, a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    const na = a / 255, ia = 1 - na;
    px[i] = px[i] * ia + r * na;
    px[i + 1] = px[i + 1] * ia + g * na;
    px[i + 2] = px[i + 2] * ia + b * na;
    px[i + 3] = Math.max(px[i + 3], a);
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Subtle vertical gradient so the icon is not a flat block.
      const t = y / size;
      set(x, y, 5 + t * 6, 7 + t * 10, 13 + t * 18, 255);
    }
  }

  const cx = size / 2, cy = size / 2, s = size * 0.30;
  // Filled triangle: the jet silhouette, pointing right.
  const pts = [[cx + s * 1.15, cy], [cx - s * 0.72, cy - s * 0.92], [cx - s * 0.30, cy], [cx - s * 0.72, cy + s * 0.92]];
  const inside = (x, y) => {
    let hit = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
    }
    return hit;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (inside(x + 0.5, y + 0.5)) set(x, y, 0x35, 0xe0, 0xc8, 255);
    }
  }
  // Glow ring.
  const rr = size * 0.42;
  for (let a = 0; a < 3600; a++) {
    const th = (a / 3600) * Math.PI * 2;
    for (let w = 0; w < size * 0.02; w++) {
      set(Math.round(cx + Math.cos(th) * (rr + w)), Math.round(cy + Math.sin(th) * (rr + w)),
        0x35, 0xe0, 0xc8, 90);
    }
  }
  return px;
}

for (const size of [180, 192, 512]) {
  writeFileSync(`public/icon-${size}.png`, png(size, render(size)));
  console.log(`public/icon-${size}.png`);
}
