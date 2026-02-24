"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";

// Pixel Office v6 — single-file canvas scene.

type AgentStatus = "active" | "busy" | "idle" | "offline";
type RosterKey = "yuri" | "jarvis" | "friday" | "glass" | "epstein";
type Dir = "down" | "left" | "right" | "up";

type LiveAgent = {
  key: RosterKey;
  label: string;
  status: AgentStatus;
  task?: string;
};

type CharAnim = "walk" | "idle" | "work";

type CharacterRuntime = {
  x: number; // px (internal canvas)
  y: number; // px (feet)
  dir: Dir;

  anim: CharAnim;

  // pathing
  path: Array<{ tx: number; ty: number }>;
  target: { x: number; y: number };
  nextDecisionMs: number;
  goingToSeat: boolean;

  // anim clocks
  walkFrame: 0 | 1 | 2 | 3;
  walkAcc: number;
  typingFrame: 0 | 1;
  typingAcc: number;

  // sparkle on new run
  sparkleUntilMs: number;
};

const TILE = 16;
const INTERNAL_W = 480;
const INTERNAL_H = 320;
const COLS = INTERNAL_W / TILE; // 30
const ROWS = INTERNAL_H / TILE; // 20

const FPS_CAP = 20;
const FRAME_MS = 1000 / FPS_CAP;

const PALETTE = {
  woodA: "#A07828",
  woodB: "#8B6914",
  beigeA: "#D4C4A0",
  beigeB: "#C4B490",
  carpetA: "#4A6B7A",
  carpetB: "#3D5A68",
  wall: "#2D2D3D",
  wallHi: "#3A3A52",
  ink: "#0b1020",
  uiText: "#e2e8f0",
} as const;

const ROSTER: Array<{ key: RosterKey; label: string; charIndex: 0 | 1 | 2 | 3 | 4 }> = [
  { key: "yuri", label: "Yuri", charIndex: 0 },
  { key: "jarvis", label: "Jarvis", charIndex: 1 },
  { key: "friday", label: "Friday", charIndex: 2 },
  { key: "glass", label: "Glass", charIndex: 3 },
  { key: "epstein", label: "Epstein", charIndex: 4 },
];

// Layout splits (tiles)
const SPLIT_X = 15; // vertical wall between left/right
const SPLIT_Y = 10; // horizontal wall on right side between kitchen/lounge

// Doorways (tiles)
const DOOR_MAIN_RIGHT = { tx: SPLIT_X, ty: 12 };
const DOOR_KITCHEN_LOUNGE = { tx: 22, ty: SPLIT_Y };

// We model a small private office area at top-left ("boss room") separated by a wall with a door.
const BOSS_WALL_Y = SPLIT_Y - 1;
const DOOR_BOSS = { tx: 7, ty: BOSS_WALL_Y };

const DOOR_TILES = [DOOR_BOSS, DOOR_MAIN_RIGHT, DOOR_KITCHEN_LOUNGE];

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function randBetween(a: number, b: number) {
  return a + Math.random() * (b - a);
}

function tileCenter(tx: number, ty: number) {
  // center of tile — character drawn upward from feet at this y
  return { x: tx * TILE + TILE / 2, y: ty * TILE + TILE };
}

function toTile(px: number, py: number) {
  const tx = clamp(Math.floor(px / TILE), 0, COLS - 1);
  const ty = clamp(Math.floor((py - 4) / TILE), 0, ROWS - 1);
  return { tx, ty };
}

function dirFromDelta(dx: number, dy: number): Dir {
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? "left" : "right";
  return dy < 0 ? "up" : "down";
}

// PNG rows: down(0), up(1), right(2). Left = flip right horizontally.
function dirRowIndex(d: Dir) {
  if (d === "down") return 0;
  if (d === "up") return 1;
  if (d === "right") return 2;
  if (d === "left") return 2; // same row as right, but we flip horizontally when drawing
  return 0;
}

function statusColor(status: AgentStatus) {
  if (status === "active" || status === "busy") return "#22c55e";
  if (status === "idle") return "#f59e0b";
  return "#94a3b8";
}

function pickAgentFromList(list: any[] | undefined, key: string, label: string) {
  if (!list) return undefined;
  const lowerKey = key.toLowerCase();
  const lowerLabel = label.toLowerCase();
  return (
    list.find((a: any) => String(a.handle ?? "").toLowerCase() === lowerKey) ||
    list.find((a: any) => String(a.name ?? "").toLowerCase() === lowerLabel)
  );
}

function wibNowParts(date = new Date()) {
  const wib = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  const hh = wib.getUTCHours();
  const mm = wib.getUTCMinutes();
  const ss = wib.getUTCSeconds();
  return { hh, mm, ss };
}

function dayNightAlpha(hh: number) {
  // brighter midday, darker nights
  if (hh >= 6 && hh <= 17) {
    const t = Math.abs(12 - hh) / 6; // 0..1
    return 0.06 + t * 0.12;
  }
  const dist = hh >= 18 ? hh - 18 : hh + 6; // 0..11
  const t = clamp(dist / 11, 0, 1);
  return 0.28 + t * 0.16;
}

function isNearDoor(px: number, py: number, radiusTiles = 1.5) {
  const { tx, ty } = toTile(px, py);
  for (const d of DOOR_TILES) {
    if (Math.abs(tx - d.tx) <= radiusTiles && Math.abs(ty - d.ty) <= radiusTiles) return true;
  }
  return false;
}

// --- Sprite helpers (code-generated) ---

type Sprite = { canvas: HTMLCanvasElement; w: number; h: number };

function spriteFromPixels(pixels: string[][], scale = 1): Sprite {
  const h = pixels.length;
  const w = pixels[0]?.length ?? 0;
  const canvas = document.createElement("canvas");
  canvas.width = w * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;

  for (let y = 0; y < h; y++) {
    const row = pixels[y];
    for (let x = 0; x < w; x++) {
      const c = row[x] ?? "";
      if (!c) continue;
      ctx.fillStyle = c;
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  }

  return { canvas, w: canvas.width, h: canvas.height };
}

function tilePatternSprite(a: string, b: string, accent?: string): Sprite {
  const px: string[][] = [];
  for (let y = 0; y < 16; y++) {
    const row: string[] = [];
    for (let x = 0; x < 16; x++) {
      const base = (x + y) % 2 === 0 ? a : b;
      // add a little texture
      let c = base;
      if (accent && (x * 7 + y * 11) % 31 === 0) c = accent;
      row.push(c);
    }
    px.push(row);
  }
  return spriteFromPixels(px, 1);
}

function wallTileSprite(): Sprite {
  const W = PALETTE.wall;
  const H = PALETTE.wallHi;
  const px: string[][] = [];
  for (let y = 0; y < 16; y++) {
    const row: string[] = [];
    for (let x = 0; x < 16; x++) {
      let c: string = W;
      if ((x + y) % 9 === 0) c = H;
      if (y === 0 || y === 15 || x === 0 || x === 15) c = "#1f1f2a";
      row.push(c);
    }
    px.push(row);
  }
  return spriteFromPixels(px, 1);
}

function deskSprite(): Sprite {
  // 32x32, warm wood, with a subtle front edge highlight
  const _ = "";
  const EDGE = "#6B4E0A";
  const WOOD = "#8B6914";
  const TOP = "#A07828";
  const HI = "#B8922E";
  const px: string[][] = [];
  for (let y = 0; y < 32; y++) {
    const row: string[] = [];
    for (let x = 0; x < 32; x++) {
      // rounded-ish silhouette
      const inRect = x >= 1 && x <= 30 && y >= 1 && y <= 26;
      if (!inRect) {
        row.push(_);
        continue;
      }
      let c = TOP;
      if (y === 1 || y === 26 || x === 1 || x === 30) c = WOOD;
      if (y === 13) c = WOOD;
      if ((x + y) % 13 === 0) c = HI;
      if (y === 26) c = EDGE;
      row.push(c);
    }
    px.push(row);
  }
  // legs
  for (let y = 27; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const leg = (x >= 2 && x <= 4) || (x >= 27 && x <= 29);
      if (leg && y <= 29) px[y][x] = EDGE;
    }
  }
  return spriteFromPixels(px, 1);
}

function bookshelfSprite(): Sprite {
  // 32x32 — warm wood with varied book spines
  const _ = "";
  const WOOD = "#7A5C1A";
  const WOOD_L = "#967028";
  const EDGE = "#5A3E0A";
  const SHELF = "#6B4E14";
  const px: string[][] = [];
  const books = [
    ["#CC4444", "#AA3333"], // red
    ["#4477AA", "#335588"], // blue
    ["#44AA66", "#338855"], // green
    ["#CCAA33", "#AA8822"], // yellow
    ["#9955AA", "#774488"], // purple
    ["#CC7744", "#AA5533"], // orange
  ];
  for (let y = 0; y < 32; y++) {
    const row: string[] = [];
    for (let x = 0; x < 32; x++) {
      // frame
      if (x === 0 || x === 31) { row.push(EDGE); continue; }
      if (y === 0 || y === 31) { row.push(EDGE); continue; }
      if (x === 1 || x === 30) { row.push(WOOD); continue; }
      // shelves (horizontal planks)
      if (y === 1 || y === 10 || y === 19 || y === 28) { row.push(SHELF); continue; }
      if (y === 29 || y === 30) { row.push(WOOD_L); continue; } // base
      // books — each book is 2-3px wide, full shelf height
      const shelfZone = y < 10 ? 0 : y < 19 ? 1 : 2;
      const bookIdx = (Math.floor((x - 2) / 4) + shelfZone * 3) % books.length;
      const bookPair = books[bookIdx];
      const inBook = (x - 2) % 4;
      if (inBook === 0) { row.push("#1a1a2a"); continue; } // gap between books
      row.push(inBook === 1 ? bookPair[1] : bookPair[0]);
    }
    px.push(row);
  }
  return spriteFromPixels(px, 1);
}

function plantSprite(): Sprite {
  // 16x16: pot + leaves
  const _ = "";
  const G1 = "#3D8B37";
  const G2 = "#2D6B27";
  const POT = "#f8fafc";
  const SH = "#cbd5e1";
  const px: string[][] = Array.from({ length: 16 }, () => Array.from({ length: 16 }, () => _));
  // leaves
  const dots = [
    [7, 2],
    [6, 3],
    [8, 3],
    [5, 4],
    [7, 4],
    [9, 4],
    [6, 5],
    [8, 5],
    [7, 6],
    [6, 6],
    [8, 6],
  ];
  for (const [x, y] of dots) px[y][x] = (x + y) % 2 ? G1 : G2;
  // pot
  for (let y = 10; y <= 14; y++) {
    for (let x = 5; x <= 10; x++) px[y][x] = POT;
  }
  for (let x = 4; x <= 11; x++) px[10][x] = SH;
  for (let x = 5; x <= 10; x++) px[14][x] = SH;
  return spriteFromPixels(px, 1);
}

function vendingSprite(): Sprite {
  // 32x32
  const _ = "";
  const D = "#111827";
  const M = "#334155";
  const H = "#475569";
  const G = "#22c55e";
  const B = "#38bdf8";
  const R = "#fb7185";
  const px: string[][] = Array.from({ length: 32 }, () => Array.from({ length: 32 }, () => _));
  // body
  for (let y = 1; y <= 30; y++) {
    for (let x = 6; x <= 25; x++) px[y][x] = M;
  }
  // outline
  for (let x = 6; x <= 25; x++) {
    px[1][x] = D;
    px[30][x] = D;
  }
  for (let y = 1; y <= 30; y++) {
    px[y][6] = D;
    px[y][25] = D;
  }
  // glass window
  for (let y = 4; y <= 22; y++) {
    for (let x = 8; x <= 18; x++) px[y][x] = "#0b1220";
  }
  for (let y = 5; y <= 21; y++) {
    for (let x = 9; x <= 17; x++) px[y][x] = (x + y) % 3 === 0 ? "#0f172a" : "#111827";
  }
  // snacks
  const snackCols = [G, B, R, "#f59e0b", "#a78bfa"];
  for (let i = 0; i < 18; i++) {
    const x = 9 + (i % 3) * 3;
    const y = 6 + Math.floor(i / 3) * 3;
    const c = snackCols[i % snackCols.length];
    px[y][x] = c;
    px[y][x + 1] = c;
  }
  // keypad
  for (let y = 8; y <= 20; y++) {
    for (let x = 20; x <= 23; x++) px[y][x] = H;
  }
  px[10][21] = "#e2e8f0";
  px[12][22] = "#e2e8f0";
  // slot
  for (let x = 10; x <= 22; x++) px[26][x] = D;

  return spriteFromPixels(px, 1);
}

function couchSprite(): Sprite {
  // 32x16
  const _ = "";
  const S = "#1f2937";
  const C = "#334155";
  const H = "#475569";
  const px: string[][] = Array.from({ length: 16 }, () => Array.from({ length: 32 }, () => _));
  for (let y = 3; y <= 14; y++) {
    for (let x = 2; x <= 29; x++) px[y][x] = C;
  }
  // back
  for (let y = 1; y <= 4; y++) for (let x = 2; x <= 29; x++) px[y][x] = H;
  // outline
  for (let x = 2; x <= 29; x++) {
    px[1][x] = S;
    px[14][x] = S;
  }
  for (let y = 1; y <= 14; y++) {
    px[y][2] = S;
    px[y][29] = S;
  }
  // cushions
  for (let y = 6; y <= 12; y++) {
    px[y][10] = S;
    px[y][20] = S;
  }
  return spriteFromPixels(px, 1);
}

function coolerSprite(): Sprite {
  // 16x32
  const _ = "";
  const F = "#cbd5e1";
  const W = "#93c5fd";
  const D = "#64748b";
  const B = "#0f172a";
  const px: string[][] = Array.from({ length: 32 }, () => Array.from({ length: 16 }, () => _));
  // bottle
  for (let y = 1; y <= 10; y++) for (let x = 4; x <= 11; x++) px[y][x] = W;
  for (let x = 5; x <= 10; x++) px[0 + 1][x] = D;
  // dispenser body
  for (let y = 11; y <= 29; y++) for (let x = 3; x <= 12; x++) px[y][x] = F;
  // outline
  for (let y = 11; y <= 29; y++) {
    px[y][3] = D;
    px[y][12] = D;
  }
  for (let x = 3; x <= 12; x++) {
    px[11][x] = D;
    px[29][x] = D;
  }
  // tap
  px[18][7] = B;
  px[19][7] = B;
  px[20][7] = B;
  // base
  for (let y = 30; y <= 31; y++) for (let x = 4; x <= 11; x++) px[y][x] = D;
  return spriteFromPixels(px, 1);
}

function paintingSprite(): Sprite {
  // 32x16 — landscape painting with frame
  const _ = "";
  const FR = "#6B4E14"; // brown frame
  const SKY = "#6BA4D4";
  const SKY2 = "#87BADC";
  const HILL = "#5A9A4A";
  const HILL2 = "#4A8A3A";
  const GRS = "#6AAA5A";
  const px: string[][] = [];
  for (let y = 0; y < 16; y++) {
    const row: string[] = [];
    for (let x = 0; x < 32; x++) {
      if (x <= 1 || x >= 30 || y <= 1 || y >= 14) { row.push(FR); continue; }
      if (y < 6) row.push((x + y) % 3 === 0 ? SKY2 : SKY);
      else if (y < 9) row.push(((x + y) % 5 < 2) ? HILL2 : HILL);
      else row.push((x + y) % 4 === 0 ? GRS : HILL);
    }
    px.push(row);
  }
  return spriteFromPixels(px, 1);
}

function coffeeTableSprite(): Sprite {
  // 16x16 — small round table
  const _ = "";
  const W = "#967028";
  const D = "#7A5C1A";
  const L = "#B08832";
  const px: string[][] = Array.from({ length: 16 }, () => Array.from({ length: 16 }, () => _));
  for (let y = 4; y <= 11; y++) {
    for (let x = 3; x <= 12; x++) {
      const dist = Math.hypot(x - 7.5, y - 7.5);
      if (dist < 5) px[y][x] = y < 7 ? L : W;
    }
  }
  // legs
  px[12][4] = D; px[12][11] = D; px[13][4] = D; px[13][11] = D;
  return spriteFromPixels(px, 1);
}

function counterSprite(): Sprite {
  // 32x16 — kitchen counter
  const _ = "";
  const TOP = "#d4c4a0";
  const BODY = "#a09070";
  const EDGE = "#786850";
  const px: string[][] = [];
  for (let y = 0; y < 16; y++) {
    const row: string[] = [];
    for (let x = 0; x < 32; x++) {
      if (y < 2) row.push(TOP);
      else if (y === 2) row.push(EDGE);
      else if (x === 0 || x === 31) row.push(EDGE);
      else row.push(BODY);
    }
    px.push(row);
  }
  return spriteFromPixels(px, 1);
}

function tvSprite(): Sprite {
  // 32x16 — flat screen TV on wall
  const _ = "";
  const FR = "#1a1a2a"; // bezel
  const SC = "#0a1628"; // screen dark
  const GL = "#1a3050"; // screen glow
  const px: string[][] = [];
  for (let y = 0; y < 16; y++) {
    const row: string[] = [];
    for (let x = 0; x < 32; x++) {
      if (y <= 1 || y >= 14 || x <= 1 || x >= 30) { row.push(FR); continue; }
      row.push((x + y) % 7 < 2 ? GL : SC);
    }
    px.push(row);
  }
  return spriteFromPixels(px, 1);
}

function playstationSprite(): Sprite {
  // 16x16 — game console
  const _ = "";
  const BODY = "#1a1a2e";
  const DETAIL = "#2a2a4e";
  const LED = "#22c55e";
  const px: string[][] = Array.from({ length: 16 }, () => Array.from({ length: 16 }, () => _));
  // console body
  for (let y = 6; y <= 12; y++) for (let x = 2; x <= 13; x++) px[y][x] = BODY;
  for (let y = 7; y <= 11; y++) for (let x = 3; x <= 12; x++) px[y][x] = DETAIL;
  // stripe
  for (let x = 3; x <= 12; x++) px[9][x] = BODY;
  // LED light
  px[8][4] = LED;
  // disc slot line
  for (let x = 6; x <= 11; x++) px[8][x] = "#0a0a1a";
  return spriteFromPixels(px, 1);
}

function monitorSprite(): Sprite {
  // 12x10 tiny monitor
  const _ = "";
  const B = "#0b1220";
  const F = "#334155";
  const px: string[][] = Array.from({ length: 10 }, () => Array.from({ length: 12 }, () => _));
  for (let y = 0; y < 7; y++) for (let x = 0; x < 12; x++) px[y][x] = F;
  for (let y = 1; y < 6; y++) for (let x = 1; x < 11; x++) px[y][x] = B;
  // stand
  for (let y = 7; y < 10; y++) for (let x = 4; x < 8; x++) px[y][x] = F;
  px[9][3] = F;
  px[9][8] = F;
  return spriteFromPixels(px, 1);
}

// --- World model ---

type FloorKind = "wood" | "beige" | "carpet";

type Prop =
  | { kind: "desk"; tx: number; ty: number; owner?: RosterKey }
  | { kind: "bookshelf"; tx: number; ty: number }
  | { kind: "plant"; tx: number; ty: number }
  | { kind: "vending"; tx: number; ty: number }
  | { kind: "couch"; tx: number; ty: number }
  | { kind: "cooler"; tx: number; ty: number }
  | { kind: "painting"; tx: number; ty: number }
  | { kind: "coffeeTable"; tx: number; ty: number }
  | { kind: "counter"; tx: number; ty: number }
  | { kind: "tv"; tx: number; ty: number }
  | { kind: "playstation"; tx: number; ty: number };

function buildFloor(): FloorKind[][] {
  const map: FloorKind[][] = [];
  for (let r = 0; r < ROWS; r++) {
    const row: FloorKind[] = [];
    for (let c = 0; c < COLS; c++) {
      const right = c >= SPLIT_X;
      const top = r < SPLIT_Y;
      if (right && top) row.push("beige");
      else if (right && !top) row.push("carpet");
      else row.push("wood");
    }
    map.push(row);
  }
  return map;
}

const SITTING_OFFSET_Y = 4; // px: nudge character down into desk when sitting

// Character ABOVE desk, facing DOWN so you see their face typing
const DESK_POS: Record<RosterKey, { tx: number; ty: number }> = {
  yuri: { tx: 3, ty: 5 },
  glass: { tx: 2, ty: 13 },
  epstein: { tx: 7, ty: 13 },
  jarvis: { tx: 2, ty: 17 },
  friday: { tx: 7, ty: 17 },
};

const SEATS: Record<RosterKey, { tx: number; ty: number; face: Dir }> = {
  yuri: { tx: 4, ty: 4, face: "down" },
  glass: { tx: 3, ty: 12, face: "down" },
  epstein: { tx: 8, ty: 12, face: "down" },
  jarvis: { tx: 3, ty: 16, face: "down" },
  friday: { tx: 8, ty: 16, face: "down" },
};

function buildProps(): Prop[] {
  const p: Prop[] = [];

  // boss room (top-left)
  p.push({ kind: "bookshelf", tx: 2, ty: 2 });
  p.push({ kind: "plant", tx: 12, ty: 2 });
  p.push({ kind: "plant", tx: 8, ty: 2 });
  p.push({ kind: "desk", tx: DESK_POS.yuri.tx, ty: DESK_POS.yuri.ty, owner: "yuri" });

  // main office desks
  p.push({ kind: "desk", tx: DESK_POS.glass.tx, ty: DESK_POS.glass.ty, owner: "glass" });
  p.push({ kind: "desk", tx: DESK_POS.epstein.tx, ty: DESK_POS.epstein.ty, owner: "epstein" });
  p.push({ kind: "desk", tx: DESK_POS.jarvis.tx, ty: DESK_POS.jarvis.ty, owner: "jarvis" });
  p.push({ kind: "desk", tx: DESK_POS.friday.tx, ty: DESK_POS.friday.ty, owner: "friday" });

  // decor main office
  p.push({ kind: "bookshelf", tx: 11, ty: 11 });
  p.push({ kind: "plant", tx: 13, ty: 11 });
  p.push({ kind: "plant", tx: 13, ty: 18 });
  p.push({ kind: "plant", tx: 1, ty: 15 });

  // kitchen (top-right)
  p.push({ kind: "vending", tx: 18, ty: 2 });
  p.push({ kind: "counter", tx: 22, ty: 2 });
  p.push({ kind: "cooler", tx: 28, ty: 2 });
  p.push({ kind: "plant", tx: 25, ty: 2 });
  p.push({ kind: "coffeeTable", tx: 20, ty: 6 });
  p.push({ kind: "plant", tx: 17, ty: 7 });

  // lounge (bottom-right) — TV + PlayStation + couch
  p.push({ kind: "tv", tx: 22, ty: 11 });         // TV on wall
  p.push({ kind: "playstation", tx: 23, ty: 12 }); // PS under TV
  p.push({ kind: "couch", tx: 20, ty: 15 });       // couch facing TV
  p.push({ kind: "coffeeTable", tx: 22, ty: 15 }); // table between couch and TV
  p.push({ kind: "bookshelf", tx: 26, ty: 12 });
  p.push({ kind: "plant", tx: 28, ty: 18 });
  p.push({ kind: "plant", tx: 17, ty: 18 });

  return p;
}

function buildBlocked(props: Prop[]) {
  const blocked: boolean[][] = Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => false));

  const mark = (tx: number, ty: number, w: number, h: number) => {
    for (let y = ty; y < ty + h; y++) {
      for (let x = tx; x < tx + w; x++) {
        if (x >= 0 && x < COLS && y >= 0 && y < ROWS) blocked[y][x] = true;
      }
    }
  };

  // outer walls
  for (let x = 0; x < COLS; x++) {
    blocked[0][x] = true;
    blocked[ROWS - 1][x] = true;
  }
  for (let y = 0; y < ROWS; y++) {
    blocked[y][0] = true;
    blocked[y][COLS - 1] = true;
  }

  // main vertical wall split
  for (let y = 0; y < ROWS; y++) {
    if (y === DOOR_MAIN_RIGHT.ty) continue;
    blocked[y][SPLIT_X] = true;
  }

  // right horizontal split
  for (let x = SPLIT_X; x < COLS; x++) {
    if (x === DOOR_KITCHEN_LOUNGE.tx) continue;
    blocked[SPLIT_Y][x] = true;
  }

  // boss room separation wall (horizontal)
  for (let x = 0; x < SPLIT_X; x++) {
    if (x === DOOR_BOSS.tx) continue;
    blocked[BOSS_WALL_Y][x] = true;
  }

  // boss room enclosure (top and side walls as collision)
  for (let y = 1; y < BOSS_WALL_Y; y++) blocked[y][1] = true;
  for (let y = 1; y < BOSS_WALL_Y; y++) blocked[y][SPLIT_X - 1] = true;
  for (let x = 1; x < SPLIT_X - 1; x++) blocked[1][x] = true;

  // props collision
  for (const pr of props) {
    if (pr.kind === "desk") mark(pr.tx, pr.ty, 2, 2);
    if (pr.kind === "bookshelf") mark(pr.tx, pr.ty, 2, 2);
    if (pr.kind === "vending") mark(pr.tx, pr.ty, 2, 2);
    if (pr.kind === "couch") mark(pr.tx, pr.ty, 2, 1);
    if (pr.kind === "cooler") mark(pr.tx, pr.ty, 1, 2);
    if (pr.kind === "painting") {} // wall decor, no collision
    if (pr.kind === "coffeeTable") mark(pr.tx, pr.ty, 1, 1);
    if (pr.kind === "counter") mark(pr.tx, pr.ty, 2, 1);
    if (pr.kind === "tv") {} // wall mounted
    if (pr.kind === "playstation") mark(pr.tx, pr.ty, 1, 1);
    if (pr.kind === "plant") mark(pr.tx, pr.ty, 1, 1);
  }

  // doors are passable
  blocked[DOOR_MAIN_RIGHT.ty][DOOR_MAIN_RIGHT.tx] = false;
  blocked[DOOR_KITCHEN_LOUNGE.ty][DOOR_KITCHEN_LOUNGE.tx] = false;
  blocked[DOOR_BOSS.ty][DOOR_BOSS.tx] = false;

  // seat tiles must be passable
  for (const s of Object.values(SEATS)) blocked[s.ty][s.tx] = false;

  return blocked;
}

// A* pathfinding on tiles
function aStar(blocked: boolean[][], from: { x: number; y: number }, to: { x: number; y: number }) {
  const s = toTile(from.x, from.y);
  const g = toTile(to.x, to.y);

  const key = (tx: number, ty: number) => `${tx},${ty}`;
  const h = (tx: number, ty: number) => Math.abs(tx - g.tx) + Math.abs(ty - g.ty);

  const open: Array<{ tx: number; ty: number; f: number; g: number }> = [{ tx: s.tx, ty: s.ty, g: 0, f: h(s.tx, s.ty) }];
  const came = new Map<string, string>();
  const gScore = new Map<string, number>();
  gScore.set(key(s.tx, s.ty), 0);

  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const;

  const inBounds = (tx: number, ty: number) => tx >= 0 && tx < COLS && ty >= 0 && ty < ROWS;

  while (open.length) {
    open.sort((a, b) => a.f - b.f);
    const cur = open.shift()!;

    if (cur.tx === g.tx && cur.ty === g.ty) {
      const path: Array<{ tx: number; ty: number }> = [{ tx: cur.tx, ty: cur.ty }];
      let ck = key(cur.tx, cur.ty);
      while (came.has(ck)) {
        const prev = came.get(ck)!;
        const [px, py] = prev.split(",").map((n) => parseInt(n, 10));
        path.push({ tx: px, ty: py });
        ck = prev;
      }
      path.reverse();
      return path;
    }

    for (const [dx, dy] of dirs) {
      const nx = cur.tx + dx;
      const ny = cur.ty + dy;
      if (!inBounds(nx, ny)) continue;
      if (blocked[ny][nx]) continue;

      const nk = key(nx, ny);
      const tentative = cur.g + 1;
      const prev = gScore.get(nk);
      if (prev == null || tentative < prev) {
        came.set(nk, key(cur.tx, cur.ty));
        gScore.set(nk, tentative);
        const f = tentative + h(nx, ny);
        if (!open.find((n) => n.tx === nx && n.ty === ny)) open.push({ tx: nx, ty: ny, g: tentative, f });
      }
    }
  }

  return [];
}

function drawSparkle(ctx: CanvasRenderingContext2D, x: number, y: number, t01: number) {
  const a = 1 - t01;
  const r = 2 + t01 * 6;
  ctx.save();
  ctx.globalAlpha = 0.9 * a;
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + 1.5, y - 1.5);
  ctx.lineTo(x + r, y);
  ctx.lineTo(x + 1.5, y + 1.5);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - 1.5, y + 1.5);
  ctx.lineTo(x - r, y);
  ctx.lineTo(x - 1.5, y - 1.5);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 0.5 * a;
  ctx.fillStyle = "rgba(56,189,248,0.9)";
  ctx.beginPath();
  ctx.arc(x, y, 1.5 + t01 * 2.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawLabel(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, color: string, dot: string) {
  ctx.font = "7px ui-sans-serif, system-ui, -apple-system, Segoe UI";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";

  ctx.fillStyle = "rgba(0,0,0,0.65)";
  ctx.fillText(text, x + 1, y + 1);

  const half = Math.ceil(ctx.measureText(text).width / 2);
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.beginPath();
  ctx.arc(x - half - 5, y - 3, 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = dot;
  ctx.beginPath();
  ctx.arc(x - half - 5, y - 3, 2.0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function isPointInCharacter(px: number, py: number, rt: CharacterRuntime) {
  const W = 16;
  const H = 24;
  const x0 = rt.x - W / 2;
  const y0 = rt.y - H;
  return px >= x0 && px <= x0 + W && py >= y0 && py <= y0 + H;
}

function drawKitchenClock(ctx: CanvasRenderingContext2D) {
  const { hh, mm } = wibNowParts();
  const text = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")} WIB`;
  const x = 24 * TILE + 8;
  const y = 2 * TILE + 8;
  ctx.save();
  ctx.globalAlpha = 0.92;
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(x - 18, y - 8, 36, 14);
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.strokeRect(x - 18.5, y - 8.5, 37, 15);
  ctx.font = "7px ui-monospace, SFMono-Regular, Menlo, Monaco";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(226,232,240,0.95)";
  ctx.fillText(text, x, y);
  ctx.restore();
}

type Sprites = {
  floorWood: Sprite;
  floorBeige: Sprite;
  floorCarpet: Sprite;
  wall: Sprite;
  desk: Sprite;
  bookshelf: Sprite;
  plant: Sprite;
  vending: Sprite;
  couch: Sprite;
  cooler: Sprite;
  monitor: Sprite;
  painting: Sprite;
  coffeeTable: Sprite;
  counter: Sprite;
  tv: Sprite;
  playstation: Sprite;
};

function buildSprites(): Sprites {
  return {
    floorWood: tilePatternSprite(PALETTE.woodA, PALETTE.woodB, "#b8922e"),
    floorBeige: tilePatternSprite(PALETTE.beigeA, PALETTE.beigeB, "#e8ddc3"),
    floorCarpet: tilePatternSprite(PALETTE.carpetA, PALETTE.carpetB, "#5aa3b7"),
    wall: wallTileSprite(),
    desk: deskSprite(),
    bookshelf: bookshelfSprite(),
    plant: plantSprite(),
    vending: vendingSprite(),
    couch: couchSprite(),
    cooler: coolerSprite(),
    monitor: monitorSprite(),
    painting: paintingSprite(),
    coffeeTable: coffeeTableSprite(),
    counter: counterSprite(),
    tv: tvSprite(),
    playstation: playstationSprite(),
  };
}

function drawWorld(
  ctx: CanvasRenderingContext2D,
  sprites: Sprites,
  floor: FloorKind[][],
  props: Prop[],
  live: LiveAgent[],
  ms: number
) {
  // floors
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const kind = floor[r][c];
      const spr = kind === "wood" ? sprites.floorWood : kind === "beige" ? sprites.floorBeige : sprites.floorCarpet;
      ctx.drawImage(spr.canvas, 0, 0, 16, 16, c * TILE, r * TILE, 16, 16);
    }
  }

  // walls
  const wall = (tx: number, ty: number) => {
    ctx.drawImage(sprites.wall.canvas, 0, 0, 16, 16, tx * TILE, ty * TILE, 16, 16);
  };
  for (let x = 0; x < COLS; x++) {
    wall(x, 0);
    wall(x, ROWS - 1);
  }
  for (let y = 0; y < ROWS; y++) {
    wall(0, y);
    wall(COLS - 1, y);
  }
  for (let y = 0; y < ROWS; y++) {
    if (y === DOOR_MAIN_RIGHT.ty) continue;
    wall(SPLIT_X, y);
  }
  for (let x = SPLIT_X; x < COLS; x++) {
    if (x === DOOR_KITCHEN_LOUNGE.tx) continue;
    wall(x, SPLIT_Y);
  }
  for (let x = 0; x < SPLIT_X; x++) {
    if (x === DOOR_BOSS.tx) continue;
    wall(x, BOSS_WALL_Y);
  }
  // boss room enclosure
  for (let y = 1; y < BOSS_WALL_Y; y++) {
    wall(1, y);
    wall(SPLIT_X - 1, y);
  }
  for (let x = 1; x < SPLIT_X - 1; x++) wall(x, 1);

  // props (big first)
  const drawAt = (spr: Sprite, tx: number, ty: number) => {
    ctx.drawImage(spr.canvas, tx * TILE, ty * TILE);
  };

  for (const pr of props) {
    if (pr.kind === "desk") drawAt(sprites.desk, pr.tx, pr.ty);
    if (pr.kind === "bookshelf") drawAt(sprites.bookshelf, pr.tx, pr.ty);
    if (pr.kind === "vending") drawAt(sprites.vending, pr.tx, pr.ty);
    if (pr.kind === "couch") drawAt(sprites.couch, pr.tx, pr.ty);
    if (pr.kind === "cooler") drawAt(sprites.cooler, pr.tx, pr.ty);
    if (pr.kind === "painting") drawAt(sprites.painting, pr.tx, pr.ty);
    if (pr.kind === "coffeeTable") drawAt(sprites.coffeeTable, pr.tx, pr.ty);
    if (pr.kind === "counter") drawAt(sprites.counter, pr.tx, pr.ty);
    if (pr.kind === "tv") drawAt(sprites.tv, pr.tx, pr.ty);
    if (pr.kind === "playstation") drawAt(sprites.playstation, pr.tx, pr.ty);
  }
  for (const pr of props) {
    if (pr.kind === "plant") drawAt(sprites.plant, pr.tx, pr.ty);
  }

  // monitors (glow when active/busy)
  const liveBy = new Map(live.map((a) => [a.key, a] as const));
  for (const pr of props) {
    if (pr.kind !== "desk" || !pr.owner) continue;
    const a = liveBy.get(pr.owner);
    const on = a && (a.status === "active" || a.status === "busy");

    // place on top of desk
    const px = pr.tx * TILE + 8;
    const py = pr.ty * TILE + 6;

    if (on) {
      ctx.save();
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = "rgba(56,189,248,1)";
      ctx.fillRect(px - 3, py - 3, 18, 14);
      ctx.restore();
    }

    ctx.drawImage(sprites.monitor.canvas, px, py);

    if (on) {
      // tiny scrolling code
      const t = (ms / 1000) * (a.status === "busy" ? 2.0 : 1.0);
      const off = Math.floor(t * 6) % 12;
      ctx.save();
      ctx.globalAlpha = 0.9;
      for (let i = 0; i < 5; i++) {
        const yy = py + 2 + i;
        const w = 2 + ((i * 7 + off) % 8);
        ctx.fillStyle = i % 2 ? "rgba(226,232,240,0.75)" : "rgba(34,197,94,0.75)";
        ctx.fillRect(px + 2, yy, w, 1);
      }
      ctx.restore();
    }
  }

  // subtle labels
  ctx.font = "8px ui-sans-serif, system-ui";
  ctx.fillStyle = "rgba(255,255,255,0.22)";
  ctx.fillText("OFFICE", 2 * TILE, 11 * TILE + 2);
  ctx.fillText("KITCHEN", 17 * TILE, 2 * TILE + 2);
  ctx.fillText("LOUNGE", 18 * TILE, 12 * TILE + 2);
  ctx.fillText("BOSS", 3 * TILE, 2 * TILE + 2);
}

function drawCharacter(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  rt: CharacterRuntime,
  status: AgentStatus,
  label: string,
  selected: boolean
) {
  const FRAME_W = 16;
  const FRAME_H = 32; // 24px sprite + 8px top padding in PNG

  // Sprite sheet columns: 0-2 walk, 3-4 typing, 5-6 reading. Idle = col 1.
  let col = 1;
  if (rt.anim === "work" && (status === "active" || status === "busy")) {
    col = 3 + (rt.typingFrame % 2);
  } else if (rt.anim === "walk") {
    col = rt.walkFrame % 3;
  }

  const row = dirRowIndex(rt.dir);
  const sx = col * FRAME_W;
  const sy = row * FRAME_H;
  const isLeft = rt.dir === "left";

  const isSitting = rt.anim === "work" && (status === "active" || status === "busy");
  const sittingOff = isSitting ? SITTING_OFFSET_Y : 0;

  // Character sprite is bottom-aligned in 16x32 frame (8px padding on top)
  // Feet at rt.y, so draw from rt.y - 32 (but 8px is padding, so visible at rt.y - 24)
  const dx = Math.round(rt.x - FRAME_W / 2);
  const dy = Math.round(rt.y - FRAME_H + sittingOff);

  // shadow
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath();
  ctx.ellipse(rt.x, rt.y - 2 + sittingOff, 6, 3, 0, 0, Math.PI * 2);
  ctx.fill();

  if (selected) {
    ctx.fillStyle = "rgba(56,189,248,0.18)";
    ctx.beginPath();
    ctx.ellipse(rt.x, rt.y - 2 + sittingOff, 10, 5, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Draw sprite — flip horizontally for left direction
  if (isLeft) {
    ctx.save();
    ctx.translate(dx + FRAME_W, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(img, sx, sy, FRAME_W, FRAME_H, 0, dy, FRAME_W, FRAME_H);
    ctx.restore();
  } else {
    ctx.drawImage(img, sx, sy, FRAME_W, FRAME_H, dx, dy, FRAME_W, FRAME_H);
  }

  drawLabel(ctx, rt.x, dy + 6, label, selected ? "#38bdf8" : "rgba(255,255,255,0.9)", statusColor(status));
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.src = src;
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
  });
}

export default function OfficePage() {
  const agents = useQuery(api.agents.getAll, {});
  const running = useQuery(api.agentRuns.getRecent, { status: "running", limit: 100 });

  const live: LiveAgent[] = useMemo(() => {
    return ROSTER.map((r): LiveAgent => {
      const agent = pickAgentFromList(agents as any, r.key, r.label);
      const status: AgentStatus = (agent?.status as AgentStatus) ?? "offline";
      const run = (running ?? []).find((x: any) => {
        const id = String(x.agentId ?? "").toLowerCase();
        const nm = String(x.agentName ?? "").toLowerCase();
        return id === r.key || nm === r.label.toLowerCase();
      });
      return { key: r.key, label: r.label, status, task: (run?.task as string | undefined) ?? agent?.currentTask };
    });
  }, [agents, running]);

  const [selected, setSelected] = useState<RosterKey>("friday");
  const selectedLive = live.find((a) => a.key === selected);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const spritesRef = useRef<Sprites | null>(null);
  const charImgsRef = useRef<Record<RosterKey, HTMLImageElement> | null>(null);

  const floor = useMemo(() => buildFloor(), []);
  const props = useMemo(() => buildProps(), []);
  const blocked = useMemo(() => buildBlocked(props), [props]);

  const runtimeRef = useRef<Record<RosterKey, CharacterRuntime>>({} as any);
  const prevRunningRef = useRef<Record<RosterKey, boolean>>({} as any);

  const rafRef = useRef<number>(0);
  const lastTickRef = useRef(0);
  const lastFrameRef = useRef(0);

  // Init sprites + character sheets
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // sprites are generated in code
      const sprites = buildSprites();

      const imgs = await Promise.all([
        loadImage("/char_0.png"),
        loadImage("/char_1.png"),
        loadImage("/char_2.png"),
        loadImage("/char_3.png"),
        loadImage("/char_4.png"),
      ]);

      if (cancelled) return;
      spritesRef.current = sprites;
      charImgsRef.current = {
        yuri: imgs[0],
        jarvis: imgs[1],
        friday: imgs[2],
        glass: imgs[3],
        epstein: imgs[4],
      };
    })().catch(() => {
      // ignore
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // init runtimes at their seats
  useEffect(() => {
    for (const r of ROSTER) {
      if (runtimeRef.current[r.key]) continue;
      const seat = SEATS[r.key];
      const p = tileCenter(seat.tx, seat.ty);
      runtimeRef.current[r.key] = {
        x: p.x,
        y: p.y,
        dir: seat.face,
        anim: r.key === "yuri" ? "work" : "idle",
        path: [],
        target: { x: p.x, y: p.y },
        nextDecisionMs: 0,
        goingToSeat: false,
        walkFrame: 0,
        walkAcc: 0,
        typingFrame: 0,
        typingAcc: 0,
        sparkleUntilMs: 0,
      };
      prevRunningRef.current[r.key] = false;
    }
  }, []);

  // resize CSS size (internal canvas is fixed)
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      canvas.width = INTERNAL_W;
      canvas.height = INTERNAL_H;
      const scale = Math.floor(Math.min(rect.width / INTERNAL_W, rect.height / INTERNAL_H) * 1000) / 1000;
      canvas.style.width = `${Math.max(1, INTERNAL_W * scale)}px`;
      canvas.style.height = `${Math.max(1, INTERNAL_H * scale)}px`;
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // click hit test selection
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onClick = (ev: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const sx = INTERNAL_W / rect.width;
      const sy = INTERNAL_H / rect.height;
      const px = (ev.clientX - rect.left) * sx;
      const py = (ev.clientY - rect.top) * sy;

      const ordered = [...live]
        .filter((a) => a.status !== "offline" || a.key === "yuri")
        .map((a) => ({ a, rt: runtimeRef.current[a.key] }))
        .filter((x) => !!x.rt)
        .sort((l, r) => r.rt!.y - l.rt!.y);

      for (const { a, rt } of ordered) {
        if (rt && isPointInCharacter(px, py, rt)) {
          setSelected(a.key);
          return;
        }
      }
    };

    canvas.addEventListener("click", onClick);
    return () => canvas.removeEventListener("click", onClick);
  }, [live]);

  // main loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true })!;
    ctx.imageSmoothingEnabled = false;

    const tick = (ms: number) => {
      rafRef.current = requestAnimationFrame(tick);
      if (ms - (lastFrameRef.current || 0) < FRAME_MS) return;

      const last = lastTickRef.current || ms;
      const dt = clamp((ms - last) / 1000, 0, 0.08);
      lastTickRef.current = ms;
      lastFrameRef.current = ms;

      ctx.clearRect(0, 0, INTERNAL_W, INTERNAL_H);

      const sprites = spritesRef.current;
      const charImgs = charImgsRef.current;
      if (!sprites || !charImgs) {
        ctx.fillStyle = PALETTE.ink;
        ctx.fillRect(0, 0, INTERNAL_W, INTERNAL_H);
        ctx.fillStyle = PALETTE.uiText;
        ctx.font = "12px ui-sans-serif, system-ui";
        ctx.fillText("Loading pixel office…", 12, 20);
        return;
      }

      // running set
      const runningSet = new Set<RosterKey>();
      for (const r of running ?? []) {
        const id = String((r as any).agentId ?? "").toLowerCase();
        const nm = String((r as any).agentName ?? "").toLowerCase();
        for (const rr of ROSTER) {
          if (id === rr.key || nm === rr.label.toLowerCase()) runningSet.add(rr.key);
        }
      }

      // detect transitions (spawn sparkle + reposition near boss door)
      const bossDoorPx = tileCenter(DOOR_BOSS.tx, DOOR_BOSS.ty);
      for (const rr of ROSTER) {
        if (rr.key === "yuri") continue;
        const prev = !!prevRunningRef.current[rr.key];
        const now = runningSet.has(rr.key);
        if (!prev && now) {
          const rt = runtimeRef.current[rr.key];
          if (rt) {
            rt.x = bossDoorPx.x;
            rt.y = bossDoorPx.y;
            rt.sparkleUntilMs = ms + 520;
            rt.path = [];
            rt.target = { x: rt.x, y: rt.y };
            rt.anim = "idle";
            rt.goingToSeat = true;
            rt.nextDecisionMs = 0;
          }
        }
        prevRunningRef.current[rr.key] = now;
      }

      // update logic
      for (const a of live) {
        const rt = runtimeRef.current[a.key];
        if (!rt) continue;

        // offline agents are hidden, but keep their runtime at seat for instant return.
        if (a.status === "offline" && a.key !== "yuri") {
          const seat = SEATS[a.key];
          const p = tileCenter(seat.tx, seat.ty);
          rt.x = p.x;
          rt.y = p.y;
          rt.dir = seat.face;
          rt.anim = "idle";
          rt.path = [];
          rt.target = { x: p.x, y: p.y };
          rt.nextDecisionMs = 0;
          rt.goingToSeat = false;
          continue;
        }

        const wantsWork = a.key === "yuri" || runningSet.has(a.key) || a.status === "active" || a.status === "busy";

        // target selection (do not let agents choose a rest point near doors)
        if (wantsWork) {
          const seat = SEATS[a.key];
          const dest = tileCenter(seat.tx, seat.ty);
          const dist = Math.hypot(dest.x - rt.x, dest.y - rt.y);

          if (dist < 2.5) {
            // snap to seat
            rt.x = dest.x;
            rt.y = dest.y;
            rt.dir = seat.face;
            rt.anim = "work";
            rt.path = [];
            rt.target = dest;
          } else {
            // walk to seat
            if (rt.path.length === 0) {
              rt.path = aStar(blocked, { x: rt.x, y: rt.y }, dest);
            }
            rt.goingToSeat = true;
            rt.anim = rt.path.length ? "walk" : "idle";
          }
        } else {
          // idle: if we reached a seat, sometimes sit (idle anim but face desk), or wander.
          const nearTarget = Math.hypot(rt.target.x - rt.x, rt.target.y - rt.y) < 2.0;

          // never idle near doorways
          if (nearTarget && isNearDoor(rt.x, rt.y)) {
            const seat = SEATS[a.key];
            const dest = tileCenter(seat.tx, seat.ty);
            rt.path = aStar(blocked, { x: rt.x, y: rt.y }, dest);
            rt.goingToSeat = true;
            rt.anim = "walk";
          }

          if (rt.path.length === 0 && (rt.nextDecisionMs === 0 || ms >= rt.nextDecisionMs) && nearTarget) {
            const roll = Math.random();
            if (roll < 0.35) {
              // Go back to desk
              const seat = SEATS[a.key];
              const dest = tileCenter(seat.tx, seat.ty);
              rt.path = aStar(blocked, { x: rt.x, y: rt.y }, dest);
              rt.goingToSeat = true;
              rt.anim = rt.path.length ? "walk" : "idle";
              rt.nextDecisionMs = ms + randBetween(5000, 10000);
            } else if (roll < 0.55) {
              // Go to lounge — watch TV / play PlayStation
              const loungeDests = [
                { tx: 21, ty: 16 }, // in front of TV on couch
                { tx: 20, ty: 16 }, // couch left
                { tx: 24, ty: 14 }, // near PlayStation
                { tx: 19, ty: 17 }, // lounge corner
              ];
              const pick = loungeDests[Math.floor(Math.random() * loungeDests.length)];
              const dest = tileCenter(pick.tx, pick.ty);
              rt.path = aStar(blocked, { x: rt.x, y: rt.y }, dest);
              rt.goingToSeat = false;
              rt.anim = rt.path.length ? "walk" : "idle";
              rt.nextDecisionMs = ms + randBetween(6000, 12000); // hang out longer
            } else if (roll < 0.70) {
              // Go to kitchen — get coffee/snack
              const kitchenDests = [
                { tx: 20, ty: 4 },  // near vending
                { tx: 24, ty: 4 },  // near counter
                { tx: 27, ty: 4 },  // near cooler
                { tx: 21, ty: 7 },  // coffee table
              ];
              const pick = kitchenDests[Math.floor(Math.random() * kitchenDests.length)];
              const dest = tileCenter(pick.tx, pick.ty);
              rt.path = aStar(blocked, { x: rt.x, y: rt.y }, dest);
              rt.goingToSeat = false;
              rt.anim = rt.path.length ? "walk" : "idle";
              rt.nextDecisionMs = ms + randBetween(4000, 8000);
            } else {
              // Wander around office randomly
              const officeDests = [
                { tx: 6, ty: 14 },  // between desks
                { tx: 11, ty: 15 }, // near bookshelf
                { tx: 5, ty: 18 },  // hallway
                { tx: 10, ty: 11 }, // upper office
              ];
              const pick = officeDests[Math.floor(Math.random() * officeDests.length)];
              const dest = tileCenter(pick.tx, pick.ty);
              rt.path = aStar(blocked, { x: rt.x, y: rt.y }, dest);
              rt.goingToSeat = false;
              rt.anim = rt.path.length ? "walk" : "idle";
              rt.nextDecisionMs = ms + randBetween(3000, 6000);
            }
          }

          // if at own seat and not moving, face down (desk)
          if (rt.path.length === 0 && !wantsWork) {
            rt.anim = "idle";
          }
        }

        // === Walk movement (runs regardless of work/idle state; only depends on having a path) ===
        if (rt.path.length) {
          const next = rt.path[0];
          const c = tileCenter(next.tx, next.ty);
          rt.target = c;

          const dx = c.x - rt.x;
          const dy = c.y - rt.y;
          const dist = Math.hypot(dx, dy);
          const speed = 22; // px/sec

          if (dist > 0.001) {
            const step = Math.min(dist, speed * dt);
            rt.x += (dx / dist) * step;
            rt.y += (dy / dist) * step;
            const newDir = dirFromDelta(dx, dy);
            if (newDir !== rt.dir) {
              rt.walkFrame = 0; // reset walk cycle on direction change
              rt.walkAcc = 0;
            }
            rt.dir = newDir;
          }

          if (dist < 1.2) rt.path.shift();
          rt.anim = rt.path.length ? "walk" : rt.anim;

          if (!rt.path.length) {
            // arrived
            if (isNearDoor(rt.x, rt.y)) {
              // shove away from doors: go to seat
              const seat = SEATS[a.key];
              const dest = tileCenter(seat.tx, seat.ty);
              rt.path = aStar(blocked, { x: rt.x, y: rt.y }, dest);
              rt.goingToSeat = true;
            } else if (rt.goingToSeat) {
              // sit/idle at seat for a bit
              rt.anim = "idle";
              rt.nextDecisionMs = ms + randBetween(5500, 12000);
              rt.goingToSeat = false;
            } else {
              rt.anim = "idle";
            }
          }
        }

        // keep in bounds
        rt.x = clamp(rt.x, 8, INTERNAL_W - 8);
        rt.y = clamp(rt.y, 24, INTERNAL_H - 8);

        // anim clocks
        if (rt.anim === "walk") {
          rt.walkAcc += dt;
          if (rt.walkAcc >= 0.14) {
            rt.walkAcc = 0;
            rt.walkFrame = (((rt.walkFrame + 1) % 3) as 0 | 1 | 2 | 3);
          }
        } else {
          rt.walkFrame = 0;
          rt.walkAcc = 0;
        }

        if (rt.anim === "work") {
          const cadence = a.status === "busy" ? 0.08 : 0.12;
          rt.typingAcc += dt;
          if (rt.typingAcc >= cadence) {
            rt.typingAcc = 0;
            rt.typingFrame = rt.typingFrame === 0 ? 1 : 0;
          }
        } else {
          rt.typingAcc = 0;
          rt.typingFrame = 0;
        }
      }

      // draw world
      drawWorld(ctx, sprites, floor, props, live, ms);
      drawKitchenClock(ctx);

      // draw characters by y
      const drawList = live
        .filter((a) => a.status !== "offline" || a.key === "yuri")
        .map((a) => ({ a, rt: runtimeRef.current[a.key] }))
        .filter((x) => !!x.rt)
        .sort((l, r) => l.rt!.y - r.rt!.y);

      for (const { a, rt } of drawList) {
        if (a.status === "offline" && a.key !== "yuri") continue;
        drawCharacter(ctx, charImgs[a.key], rt!, a.status, a.label, a.key === selected);
      }

      // sparkles
      for (const a of live) {
        const rt = runtimeRef.current[a.key];
        if (!rt) continue;
        if (rt.sparkleUntilMs > ms) {
          const t01 = clamp(1 - (rt.sparkleUntilMs - ms) / 520, 0, 1);
          drawSparkle(ctx, rt.x, rt.y - 16, t01);
          drawSparkle(ctx, rt.x + 6, rt.y - 10, clamp(t01 + 0.12, 0, 1));
        }
      }

      // day/night overlay
      const { hh } = wibNowParts();
      const alpha = dayNightAlpha(hh);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "rgba(2,6,23,1)";
      ctx.fillRect(0, 0, INTERNAL_W, INTERNAL_H);
      if (hh < 6 || hh > 17) {
        ctx.globalAlpha = alpha * 0.55;
        ctx.fillStyle = "rgba(56,189,248,1)";
        ctx.fillRect(0, 0, INTERNAL_W, INTERNAL_H);
      }
      ctx.restore();
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [blocked, floor, live, props, running, selected]);

  return (
    <div className="min-h-[calc(100vh-64px)] w-full bg-slate-950 text-slate-100">
      <div className="mx-auto flex max-w-6xl gap-4 px-4 py-6">
        <div className="flex-1 rounded-xl border border-slate-800 bg-slate-900/30 p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-semibold">Office</div>
            <div className="text-xs text-slate-300">Canvas 480×320 · 16px tiles · A* pathing · pixel-art props from code</div>
          </div>

          <div ref={containerRef} className="relative flex h-[560px] w-full items-center justify-center overflow-hidden rounded-lg bg-black/40">
            <canvas ref={canvasRef} width={INTERNAL_W} height={INTERNAL_H} className="select-none" style={{ imageRendering: "pixelated" as any }} />
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {live.map((a) => (
              <button
                key={a.key}
                onClick={() => setSelected(a.key)}
                className={`rounded-full border px-3 py-1 text-xs transition ${
                  selected === a.key ? "border-sky-400 bg-sky-500/10" : "border-slate-700 bg-slate-900/30 hover:bg-slate-900/60"
                }`}
              >
                <span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ background: statusColor(a.status) }} />
                {a.label}
              </button>
            ))}
          </div>
        </div>

        <aside className="w-[340px] shrink-0 rounded-xl border border-slate-800 bg-slate-900/30 p-4">
          <div className="mb-2 text-sm font-semibold">Agent</div>
          {selectedLive ? (
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-lg font-semibold leading-tight">{selectedLive.label}</div>
                  <div className="mt-1 text-xs text-slate-300">Click a character in the office to inspect.</div>
                </div>
                <div className="rounded-full border border-slate-700 px-3 py-1 text-xs" style={{ color: statusColor(selectedLive.status) }}>
                  {selectedLive.status}
                </div>
              </div>

              <div className="rounded-lg border border-slate-800 bg-slate-950/30 p-3">
                <div className="text-xs font-semibold text-slate-200">Current task</div>
                <div className="mt-1 text-sm text-slate-100">{selectedLive.task ?? "—"}</div>
              </div>

              <div className="text-xs text-slate-400">
                <div className="font-semibold text-slate-300">Behaviors</div>
                <ul className="mt-1 list-disc space-y-1 pl-4">
                  <li>
                    <span className="text-slate-200">Active/Busy</span>: walks to desk and types (frames 5–6)
                  </li>
                  <li>
                    <span className="text-slate-200">Idle</span>: wanders (kitchen/lounge/peers), sometimes returns to desk
                  </li>
                  <li>
                    <span className="text-slate-200">Offline</span>: hidden (parked at desk)
                  </li>
                  <li>
                    <span className="text-slate-200">Door safety</span>: agents never stop near doorways
                  </li>
                </ul>
              </div>

              <div className="text-xs text-slate-400">
                <div className="font-semibold text-slate-300">Details</div>
                <ul className="mt-1 list-disc space-y-1 pl-4">
                  <li>Day/night tint based on WIB time</li>
                  <li>Kitchen clock displays WIB</li>
                  <li>All furniture sprites are code-generated (no external office sprite sheet)</li>
                  <li>Characters use /public/char_*.png sheets</li>
                </ul>
              </div>
            </div>
          ) : (
            <div className="text-sm text-slate-300">No agent selected.</div>
          )}
        </aside>
      </div>
    </div>
  );
}
