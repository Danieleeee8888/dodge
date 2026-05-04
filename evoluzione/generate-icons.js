// Genera public/icons/icon-192.png e icon-512.png
// Eseguire con: node generate-icons.js

const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c;
  }
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(td));
  return Buffer.concat([lenBuf, td, crcBuf]);
}

function makePNG(size, pixelFn) {
  const channels = 4;
  const raw = Buffer.alloc(size * (1 + size * channels));
  for (let y = 0; y < size; y++) {
    raw[y * (1 + size * channels)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixelFn(x, y, size);
      const o = y * (1 + size * channels) + 1 + x * channels;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const compressed = zlib.deflateSync(raw, { level: 9 });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', compressed), chunk('IEND', Buffer.alloc(0))]);
}

function dodgePixel(x, y, size) {
  // Black background
  const bg = [0, 0, 0, 255];
  const white = [255, 255, 255, 255];

  // Padding: 18% per lato
  const pad = size * 0.18;
  const w = size - pad * 2;   // larghezza area D
  const h = size - pad * 2;   // altezza area D
  const ox = pad;              // origin x
  const oy = pad;              // origin y

  const t = w * 0.17;         // spessore barre

  // Barra verticale sinistra
  if (x >= ox && x < ox + t && y >= oy && y < oy + h) return white;

  // Barra orizzontale in alto
  if (x >= ox && x < ox + w * 0.68 && y >= oy && y < oy + t) return white;

  // Barra orizzontale in basso
  if (x >= ox && x < ox + w * 0.68 && y >= oy + h - t && y < oy + h) return white;

  // Curva destra — semicerchio cavo
  const cx = ox + w * 0.68;
  const cy = oy + h / 2;
  const outerR = h / 2;
  const innerR = outerR - t;
  const px = x - cx;
  const py = y - cy;
  const dist = Math.sqrt(px * px + py * py);
  if (px >= 0 && dist <= outerR && dist >= innerR && y >= oy && y <= oy + h) return white;

  return bg;
}

const outDir = path.join(__dirname, 'public', 'icons');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

for (const size of [192, 512]) {
  const png = makePNG(size, dodgePixel);
  const out = path.join(outDir, `icon-${size}.png`);
  fs.writeFileSync(out, png);
  console.log(`Creato: ${out}`);
}
console.log('Icone generate!');
