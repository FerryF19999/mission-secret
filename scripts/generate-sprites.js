/* eslint-disable no-console */
// Generates real pixel-art sprite sheets used by /office.
// Run: node scripts/generate-sprites.js

const fs = require("fs");
const path = require("path");
const { createCanvas } = require("canvas");

const OUT_DIR = path.join(process.cwd(), "public", "sprites");

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function hexToRgba(hex, a = 255) {
  const h = hex.replace("#", "");
  const n = parseInt(h, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${a / 255})`;
}

function px(ctx, x, y, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, 1, 1);
}

function rect(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

function outlineBox(ctx, x, y, w, h, c) {
  rect(ctx, x, y, w, 1, c);
  rect(ctx, x, y + h - 1, w, 1, c);
  rect(ctx, x, y, 1, h, c);
  rect(ctx, x + w - 1, y, 1, h, c);
}

function dither2(ctx, x, y, w, h, c1, c2) {
  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < w; xx++) {
      const c = (xx + yy) % 2 === 0 ? c1 : c2;
      px(ctx, x + xx, y + yy, c);
    }
  }
}

// --- Character Sprites ---

const CHAR_W = 16;
const CHAR_H = 20;
const WALK_FRAMES = 4;
const IDLE_COL = 4; // after 0..3
const TYPE_COL0 = 5;
const TYPE_COL1 = 6;
const COLS_PER_ROW = 7; // 4 walk + idle + 2 typing
const DIRS = ["down", "left", "right", "up"]; // order matters

/**
 * Draws a 16x20 RPG-ish character with small shaded details.
 * dir: down/left/right/up
 * frame: 0..3 walk, or 'idle', or 'type0'/'type1'
 */
function drawCharacterFrame(ctx, x0, y0, spec, dir, frameKind) {
  // palette
  const skin = spec.skin;
  const skin2 = spec.skin2;
  const hair = spec.hair;
  const hair2 = spec.hair2;
  const shirt = spec.shirt;
  const shirt2 = spec.shirt2;
  const pants = spec.pants;
  const pants2 = spec.pants2;
  const shoes = spec.shoes;
  const shadow = hexToRgba("#000000", 80);
  const line = hexToRgba("#0b0f1a", 255);

  // Clear
  ctx.clearRect(x0, y0, CHAR_W, CHAR_H);

  // soft ground shadow
  rect(ctx, x0 + 4, y0 + 18, 8, 1, shadow);

  // walk offsets
  const f = frameKind;
  const walkFrame = typeof f === "number" ? f : 0;
  const bob = typeof f === "number" ? (walkFrame % 2 === 1 ? 1 : 0) : 0;

  // legs swap
  const legAForward = typeof f === "number" ? walkFrame === 1 || walkFrame === 2 : false;

  // typing: arms up
  const typing = f === "type0" || f === "type1";
  const typeWiggle = f === "type1" ? 1 : 0;

  // base body anchor
  const ax = x0;
  const ay = y0 + bob;

  // head
  // shape: 8x6-ish with shading
  rect(ctx, ax + 5, ay + 2, 6, 6, skin);
  rect(ctx, ax + 5, ay + 7, 6, 1, skin2);
  // cheeks/outline
  px(ctx, ax + 5, ay + 2, skin2);
  px(ctx, ax + 10, ay + 2, skin2);

  // hair (varies slightly per char)
  if (dir === "up") {
    // more hair visible from back
    rect(ctx, ax + 4, ay + 1, 8, 5, hair);
    rect(ctx, ax + 4, ay + 1, 8, 1, hair2);
  } else {
    rect(ctx, ax + 4, ay + 1, 8, 3, hair);
    rect(ctx, ax + 4, ay + 1, 8, 1, hair2);
    // bangs
    px(ctx, ax + 5, ay + 4, hair);
    px(ctx, ax + 6, ay + 4, hair);
    px(ctx, ax + 9, ay + 4, hair);
  }

  // eyes (not for up)
  if (dir !== "up") {
    const eyeY = ay + 5;
    const eyeX1 = ax + 6;
    const eyeX2 = ax + 9;
    const eye = hexToRgba(spec.eye, 255);
    px(ctx, eyeX1, eyeY, eye);
    px(ctx, eyeX2, eyeY, eye);
  }

  // torso
  rect(ctx, ax + 4, ay + 8, 8, 6, shirt);
  rect(ctx, ax + 4, ay + 13, 8, 1, shirt2);
  // collar detail / suit stripe
  if (spec.detail === "tie") {
    px(ctx, ax + 7, ay + 8, hexToRgba("#f8fafc", 255));
    px(ctx, ax + 8, ay + 8, hexToRgba("#f8fafc", 255));
    px(ctx, ax + 7, ay + 9, hexToRgba("#94a3b8", 255));
  }
  if (spec.detail === "stripe") {
    for (let yy = 8; yy <= 13; yy += 2) px(ctx, ax + 6, ay + yy, hexToRgba("#e2e8f0", 220));
  }

  // arms
  // left/right based on dir
  const armY = ay + (typing ? 9 : 10);
  const armLen = typing ? 3 : 4;
  const armOffset = typing ? typeWiggle : 0;
  if (dir === "left") {
    rect(ctx, ax + 3, armY, 1, armLen, shirt2);
    rect(ctx, ax + 12, armY, 1, armLen, shirt2);
    px(ctx, ax + 3, armY + armLen, skin);
  } else if (dir === "right") {
    rect(ctx, ax + 3, armY, 1, armLen, shirt2);
    rect(ctx, ax + 12, armY, 1, armLen, shirt2);
    px(ctx, ax + 12, armY + armLen, skin);
  } else if (dir === "up") {
    rect(ctx, ax + 4, armY, 1, armLen, shirt2);
    rect(ctx, ax + 11, armY, 1, armLen, shirt2);
  } else {
    // down
    rect(ctx, ax + 3, armY, 1, armLen, shirt2);
    rect(ctx, ax + 12, armY, 1, armLen, shirt2);
    // hands
    px(ctx, ax + 3, armY + armLen, skin);
    px(ctx, ax + 12, armY + armLen, skin);
  }

  // legs
  rect(ctx, ax + 5, ay + 14, 3, 3, pants);
  rect(ctx, ax + 8, ay + 14, 3, 3, pants);
  // step
  if (legAForward) {
    rect(ctx, ax + 5, ay + 16, 3, 2, pants2);
    rect(ctx, ax + 8, ay + 16, 3, 1, pants);
  } else {
    rect(ctx, ax + 5, ay + 16, 3, 1, pants);
    rect(ctx, ax + 8, ay + 16, 3, 2, pants2);
  }

  // shoes
  rect(ctx, ax + 5, ay + 18, 3, 1, shoes);
  rect(ctx, ax + 8, ay + 18, 3, 1, shoes);

  // direction hint: subtle shoulder shading
  if (dir === "left") {
    px(ctx, ax + 4, ay + 9, shirt2);
    px(ctx, ax + 4, ay + 10, shirt2);
  } else if (dir === "right") {
    px(ctx, ax + 11, ay + 9, shirt2);
    px(ctx, ax + 11, ay + 10, shirt2);
  } else if (dir === "up") {
    // darker back
    rect(ctx, ax + 4, ay + 9, 8, 1, shirt2);
  }

  // outline
  // minimal outline points for readability
  for (let xx = 4; xx <= 11; xx++) {
    px(ctx, ax + xx, ay + 8, line);
    px(ctx, ax + xx, ay + 18, line);
  }
  for (let yy = 2; yy <= 18; yy++) {
    px(ctx, ax + 4, ay + yy, line);
    px(ctx, ax + 11, ay + yy, line);
  }

  // accessory (hair highlight / glasses)
  if (spec.accessory === "glasses" && dir !== "up") {
    const g = hexToRgba("#111827", 255);
    px(ctx, ax + 6, ay + 5, g);
    px(ctx, ax + 7, ay + 5, g);
    px(ctx, ax + 8, ay + 5, g);
    px(ctx, ax + 9, ay + 5, g);
  }
  if (spec.accessory === "afro") {
    // extra hair volume
    rect(ctx, ax + 3, ay + 0, 10, 3, hair);
    px(ctx, ax + 3, ay + 1, hair2);
    px(ctx, ax + 12, ay + 1, hair2);
  }
}

function generateCharactersPng(outPath) {
  const characters = [
    {
      key: "yuri",
      skin: hexToRgba("#f1c7a5"),
      skin2: hexToRgba("#e0ad86"),
      hair: hexToRgba("#6b3f2a"),
      hair2: hexToRgba("#8b5a3c"),
      shirt: hexToRgba("#2563eb"),
      shirt2: hexToRgba("#1d4ed8"),
      pants: hexToRgba("#334155"),
      pants2: hexToRgba("#1f2937"),
      shoes: hexToRgba("#0f172a"),
      eye: "#0b1020",
      detail: "none",
      accessory: "none",
    },
    {
      key: "jarvis",
      skin: hexToRgba("#f0caa8"),
      skin2: hexToRgba("#dfaf87"),
      hair: hexToRgba("#1f2937"),
      hair2: hexToRgba("#374151"),
      shirt: hexToRgba("#0f172a"),
      shirt2: hexToRgba("#1e293b"),
      pants: hexToRgba("#111827"),
      pants2: hexToRgba("#0b1220"),
      shoes: hexToRgba("#030712"),
      eye: "#0b1020",
      detail: "stripe",
      accessory: "none",
    },
    {
      key: "friday",
      skin: hexToRgba("#6b4a32"),
      skin2: hexToRgba("#543827"),
      hair: hexToRgba("#0b0f1a"),
      hair2: hexToRgba("#111827"),
      shirt: hexToRgba("#f97316"),
      shirt2: hexToRgba("#ea580c"),
      pants: hexToRgba("#1f2937"),
      pants2: hexToRgba("#111827"),
      shoes: hexToRgba("#0b1220"),
      eye: "#0b1020",
      detail: "none",
      accessory: "afro",
    },
    {
      key: "glass",
      skin: hexToRgba("#eac3a1"),
      skin2: hexToRgba("#d7a883"),
      hair: hexToRgba("#111827"),
      hair2: hexToRgba("#374151"),
      shirt: hexToRgba("#6d28d9"),
      shirt2: hexToRgba("#5b21b6"),
      pants: hexToRgba("#374151"),
      pants2: hexToRgba("#1f2937"),
      shoes: hexToRgba("#111827"),
      eye: "#0b1020",
      detail: "tie",
      accessory: "glasses",
    },
    {
      key: "epstein",
      skin: hexToRgba("#e9c7aa"),
      skin2: hexToRgba("#d8ab86"),
      hair: hexToRgba("#cbd5e1"),
      hair2: hexToRgba("#94a3b8"),
      shirt: hexToRgba("#111827"),
      shirt2: hexToRgba("#0f172a"),
      pants: hexToRgba("#0b1020"),
      pants2: hexToRgba("#030712"),
      shoes: hexToRgba("#030712"),
      eye: "#0b1020",
      detail: "none",
      accessory: "none",
    },
  ];

  const rows = characters.length * DIRS.length;
  const canvas = createCanvas(COLS_PER_ROW * CHAR_W, rows * CHAR_H);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;

  for (let ci = 0; ci < characters.length; ci++) {
    const spec = characters[ci];
    for (let di = 0; di < DIRS.length; di++) {
      const dir = DIRS[di];
      const row = ci * DIRS.length + di;
      const y = row * CHAR_H;

      // walk
      for (let f = 0; f < WALK_FRAMES; f++) {
        const x = f * CHAR_W;
        drawCharacterFrame(ctx, x, y, spec, dir, f);
      }
      // idle
      drawCharacterFrame(ctx, IDLE_COL * CHAR_W, y, spec, dir, "idle");
      // typing (down direction is most used; still generate per-dir)
      drawCharacterFrame(ctx, TYPE_COL0 * CHAR_W, y, spec, dir, "type0");
      drawCharacterFrame(ctx, TYPE_COL1 * CHAR_W, y, spec, dir, "type1");
    }
  }

  ensureDir(path.dirname(outPath));
  fs.writeFileSync(outPath, canvas.toBuffer("image/png"));
  console.log("wrote", path.relative(process.cwd(), outPath));
}

// --- Office Tileset ---

const TILE = 16;

function drawWood(ctx, x, y) {
  const a = hexToRgba("#9a6b3f");
  const b = hexToRgba("#8a5f39");
  const c = hexToRgba("#b07a49");
  rect(ctx, x, y, TILE, TILE, a);
  // planks
  for (let i = 0; i < TILE; i += 4) {
    rect(ctx, x + i, y, 1, TILE, b);
  }
  // grain
  for (let yy = 1; yy < TILE; yy += 5) {
    rect(ctx, x + 1, y + yy, TILE - 2, 1, c);
  }
}

function drawBeigeTile(ctx, x, y) {
  const a = hexToRgba("#e7d7c3");
  const b = hexToRgba("#d9c7b1");
  rect(ctx, x, y, TILE, TILE, a);
  rect(ctx, x, y, TILE, 1, b);
  rect(ctx, x, y, 1, TILE, b);
  rect(ctx, x + TILE - 1, y, 1, TILE, b);
  rect(ctx, x, y + TILE - 1, TILE, 1, b);
  // speckles
  px(ctx, x + 4, y + 6, b);
  px(ctx, x + 11, y + 10, b);
}

function drawCarpet(ctx, x, y) {
  const a = hexToRgba("#2b5d7c");
  const b = hexToRgba("#244d67");
  dither2(ctx, x, y, TILE, TILE, a, b);
}

function drawWall(ctx, x, y, kind) {
  const a = kind === "dark" ? hexToRgba("#1f2937") : hexToRgba("#334155");
  const b = kind === "dark" ? hexToRgba("#111827") : hexToRgba("#1f2937");
  rect(ctx, x, y, TILE, TILE, a);
  rect(ctx, x, y, TILE, 3, b);
  rect(ctx, x, y + TILE - 1, TILE, 1, b);
}

function drawPlant(ctx, x, y) {
  // 16x16 icon
  const pot = hexToRgba("#7c4a2f");
  const pot2 = hexToRgba("#5b341f");
  const g1 = hexToRgba("#22c55e");
  const g2 = hexToRgba("#16a34a");
  rect(ctx, x + 6, y + 10, 4, 4, pot);
  rect(ctx, x + 6, y + 13, 4, 1, pot2);
  // leaves
  rect(ctx, x + 7, y + 5, 2, 5, g2);
  px(ctx, x + 6, y + 6, g1);
  px(ctx, x + 9, y + 6, g1);
  px(ctx, x + 5, y + 7, g2);
  px(ctx, x + 10, y + 7, g2);
}

function drawBoxes(ctx, x, y) {
  const a = hexToRgba("#c9a26b");
  const b = hexToRgba("#a97c3f");
  rect(ctx, x + 2, y + 7, 12, 7, a);
  outlineBox(ctx, x + 2, y + 7, 12, 7, b);
  rect(ctx, x + 7, y + 7, 1, 7, b);
}

function drawBookshelf(ctx, x, y) {
  // 32x32 in a 2x2 tile block
  const wood = hexToRgba("#7a4b2b");
  const wood2 = hexToRgba("#5b341f");
  rect(ctx, x, y, 32, 32, wood);
  outlineBox(ctx, x, y, 32, 32, wood2);
  // shelves
  rect(ctx, x + 2, y + 10, 28, 2, wood2);
  rect(ctx, x + 2, y + 20, 28, 2, wood2);
  // books
  const colors = ["#ef4444", "#22c55e", "#3b82f6", "#f59e0b", "#a855f7", "#06b6d4"];
  for (let i = 0; i < 12; i++) {
    const cx = x + 3 + (i * 2);
    const c = hexToRgba(colors[i % colors.length]);
    rect(ctx, cx, y + 3 + (i % 2), 1, 6, c);
    rect(ctx, cx, y + 13 + ((i + 1) % 2), 1, 6, c);
    rect(ctx, cx, y + 23 + (i % 2), 1, 6, c);
  }
}

function drawDesk(ctx, x, y) {
  // 32x32
  const wood = hexToRgba("#9a6b3f");
  const wood2 = hexToRgba("#7a4b2b");
  const metal = hexToRgba("#475569");
  rect(ctx, x, y + 10, 32, 10, wood);
  outlineBox(ctx, x, y + 10, 32, 10, wood2);
  // legs
  rect(ctx, x + 3, y + 20, 4, 10, metal);
  rect(ctx, x + 25, y + 20, 4, 10, metal);
  // monitor
  rect(ctx, x + 12, y + 2, 10, 7, hexToRgba("#111827"));
  rect(ctx, x + 13, y + 3, 8, 5, hexToRgba("#0ea5e9"));
  rect(ctx, x + 16, y + 9, 2, 2, metal);
  // keyboard
  rect(ctx, x + 10, y + 14, 12, 3, hexToRgba("#e2e8f0"));
  // mug
  rect(ctx, x + 6, y + 12, 3, 4, hexToRgba("#f8fafc"));
  px(ctx, x + 9, y + 13, hexToRgba("#94a3b8"));
}

function drawChair(ctx, x, y) {
  // 16x16 chair top-down
  const c1 = hexToRgba("#a855f7");
  const c2 = hexToRgba("#7c3aed");
  const metal = hexToRgba("#475569");
  rect(ctx, x + 5, y + 4, 6, 6, c1);
  outlineBox(ctx, x + 5, y + 4, 6, 6, c2);
  rect(ctx, x + 7, y + 10, 2, 4, metal);
  rect(ctx, x + 5, y + 13, 6, 1, metal);
}

function drawVending(ctx, x, y) {
  // 32x32
  const body = hexToRgba("#94a3b8");
  const edge = hexToRgba("#64748b");
  rect(ctx, x, y, 32, 32, body);
  outlineBox(ctx, x, y, 32, 32, edge);
  // window
  rect(ctx, x + 6, y + 6, 14, 18, hexToRgba("#0b1020"));
  dither2(ctx, x + 7, y + 7, 12, 16, hexToRgba("#1f2937"), hexToRgba("#111827"));
  // buttons
  for (let i = 0; i < 6; i++) px(ctx, x + 24, y + 8 + i * 3, hexToRgba("#ef4444"));
  rect(ctx, x + 22, y + 26, 8, 4, hexToRgba("#334155"));
}

function drawCouch(ctx, x, y) {
  // 32x16 (2x1 tiles)
  const c1 = hexToRgba("#f472b6");
  const c2 = hexToRgba("#db2777");
  rect(ctx, x, y + 4, 32, 10, c1);
  outlineBox(ctx, x, y + 4, 32, 10, c2);
  // cushions
  rect(ctx, x + 4, y + 6, 10, 6, hexToRgba("#fb7185"));
  rect(ctx, x + 18, y + 6, 10, 6, hexToRgba("#fb7185"));
}

function drawPainting(ctx, x, y) {
  // 32x16
  const frame = hexToRgba("#a16207");
  const frame2 = hexToRgba("#713f12");
  rect(ctx, x, y, 32, 16, frame);
  outlineBox(ctx, x, y, 32, 16, frame2);
  // scene
  rect(ctx, x + 2, y + 2, 28, 12, hexToRgba("#38bdf8"));
  rect(ctx, x + 2, y + 9, 28, 5, hexToRgba("#22c55e"));
  // mountain
  for (let i = 0; i < 10; i++) px(ctx, x + 10 + i, y + 8 - Math.floor(i / 2), hexToRgba("#94a3b8"));
}

function drawCounter(ctx, x, y) {
  // 32x16
  const top = hexToRgba("#e2e8f0");
  const base = hexToRgba("#cbd5e1");
  const edge = hexToRgba("#64748b");
  rect(ctx, x, y + 4, 32, 12, base);
  rect(ctx, x, y + 4, 32, 2, edge);
  rect(ctx, x, y + 2, 32, 2, top);
}

function drawFridge(ctx, x, y) {
  // 16x32 (1x2 tiles)
  const a = hexToRgba("#e5e7eb");
  const b = hexToRgba("#9ca3af");
  rect(ctx, x, y, 16, 32, a);
  outlineBox(ctx, x, y, 16, 32, b);
  rect(ctx, x + 2, y + 15, 12, 1, b);
  px(ctx, x + 13, y + 8, b);
  px(ctx, x + 13, y + 23, b);
}

function drawWaterCooler(ctx, x, y) {
  // 16x32
  const base = hexToRgba("#cbd5e1");
  const edge = hexToRgba("#64748b");
  const water = hexToRgba("#60a5fa", 180);
  rect(ctx, x + 3, y + 10, 10, 20, base);
  outlineBox(ctx, x + 3, y + 10, 10, 20, edge);
  rect(ctx, x + 4, y + 1, 8, 10, water);
  outlineBox(ctx, x + 4, y + 1, 8, 10, edge);
}

function generateOfficePng(outPath) {
  // 16x16 cell grid
  const GRID = 16;
  const canvas = createCanvas(GRID * TILE, GRID * TILE);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // helper place at tile coords
  const at = (tx, ty) => ({ x: tx * TILE, y: ty * TILE });

  // tiles row 0
  drawWood(ctx, ...Object.values(at(0, 0)));
  drawBeigeTile(ctx, ...Object.values(at(1, 0)));
  drawCarpet(ctx, ...Object.values(at(2, 0)));
  drawWall(ctx, ...Object.values(at(3, 0)), "dark");
  drawWall(ctx, ...Object.values(at(4, 0)), "light");

  // props/icons
  drawPlant(ctx, ...Object.values(at(0, 1)));
  drawBoxes(ctx, ...Object.values(at(1, 1)));
  drawChair(ctx, ...Object.values(at(2, 1)));

  // furniture blocks (draw across multiple cells)
  // bookshelf at (0,2) size 2x2
  {
    const p = at(0, 2);
    drawBookshelf(ctx, p.x, p.y);
  }
  // desk at (2,2) size 2x2
  {
    const p = at(2, 2);
    drawDesk(ctx, p.x, p.y);
  }
  // vending at (4,2) size 2x2
  {
    const p = at(4, 2);
    drawVending(ctx, p.x, p.y);
  }
  // couch at (6,2) size 2x1 (32x16)
  {
    const p = at(6, 2);
    drawCouch(ctx, p.x, p.y);
  }
  // painting at (8,2) size 2x1
  {
    const p = at(8, 2);
    drawPainting(ctx, p.x, p.y);
  }
  // counter at (10,2) size 2x1
  {
    const p = at(10, 2);
    drawCounter(ctx, p.x, p.y);
  }
  // fridge at (12,2) size 1x2
  {
    const p = at(12, 2);
    drawFridge(ctx, p.x, p.y);
  }
  // water cooler at (13,2) size 1x2
  {
    const p = at(13, 2);
    drawWaterCooler(ctx, p.x, p.y);
  }

  ensureDir(path.dirname(outPath));
  fs.writeFileSync(outPath, canvas.toBuffer("image/png"));
  console.log("wrote", path.relative(process.cwd(), outPath));
}

function main() {
  ensureDir(OUT_DIR);
  generateCharactersPng(path.join(OUT_DIR, "characters.png"));
  generateOfficePng(path.join(OUT_DIR, "office.png"));
}

main();
