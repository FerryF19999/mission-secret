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

type ActivityKind =
  | "desk"
  | "coffee"
  | "gaming"
  | "watching_tv"
  | "reading"
  | "chatting"
  | "wandering";

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

  // social / activity
  activity: ActivityKind | null;
  activityBubble: string | null;
  activityUntilMs: number;
  chatWith: RosterKey | null;

  // stuck detection
  lastMoveMs: number;
  lastPos: { x: number; y: number };
};

const TILE = 16;
// Cozy office size (smaller grid, less warehouse-y)
const INTERNAL_W = 320; // 20 cols * 16px
const INTERNAL_H = 240; // 15 rows * 16px
const COLS = INTERNAL_W / TILE; // 20
const ROWS = INTERNAL_H / TILE; // 15

const FPS_CAP = 20;
const FRAME_MS = 1000 / FPS_CAP;

const PALETTE = {
  woodA: "#C89840",
  woodB: "#B08530",
  beigeA: "#E8DCC0",
  beigeB: "#DDD0B0",
  carpetA: "#6A9AAE",
  carpetB: "#5888A0",
  wall: "#4A4A60",
  wallHi: "#5C5C78",
  ink: "#1a2030",
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
// 20x15 grid: left side = main office + boss room, right side = kitchen + lounge
const SPLIT_X = 10; // vertical wall between left/right
const SPLIT_Y = 7;  // horizontal wall on right side between kitchen/lounge

// Doorways (tiles)
const DOOR_MAIN_RIGHT = { tx: SPLIT_X, ty: 9 };
const DOOR_KITCHEN_LOUNGE = { tx: 15, ty: SPLIT_Y };

// We model a small private office area at top-left ("boss room") separated by a wall with a door.
const BOSS_WALL_Y = SPLIT_Y - 1;
const DOOR_BOSS = { tx: 5, ty: BOSS_WALL_Y };

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
  // very bright office — minimal overlay
  if (hh >= 6 && hh <= 17) {
    return 0.0; // no overlay during daytime
  }
  // gentle evening/night tint
  const dist = hh >= 18 ? hh - 18 : hh + 6; // 0..11
  const t = clamp(dist / 11, 0, 1);
  return 0.05 + t * 0.10; // max 0.15 at darkest
}

function isNearDoor(px: number, py: number, radiusTiles = 1.5) {
  const { tx, ty } = toTile(px, py);
  for (const d of DOOR_TILES) {
    if (Math.abs(tx - d.tx) <= radiusTiles && Math.abs(ty - d.ty) <= radiusTiles) return true;
  }
  return false;
}

function isWalkableTile(blocked: boolean[][], tx: number, ty: number) {
  return ty >= 0 && ty < ROWS && tx >= 0 && tx < COLS && !blocked[ty]?.[tx];
}

function pickNearbyWalkable(
  blocked: boolean[][],
  base: { tx: number; ty: number },
  radius = 2,
  avoidDoors = true
): { tx: number; ty: number } {
  const candidates: Array<{ tx: number; ty: number; d: number }> = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const tx = base.tx + dx;
      const ty = base.ty + dy;
      if (!isWalkableTile(blocked, tx, ty)) continue;
      const p = tileCenter(tx, ty);
      if (avoidDoors && isNearDoor(p.x, p.y, 1.2)) continue;
      const d = Math.abs(dx) + Math.abs(dy);
      candidates.push({ tx, ty, d });
    }
  }
  candidates.sort((a, b) => a.d - b.d);
  // pick among the closest few to add variety
  const slice = candidates.slice(0, Math.min(10, candidates.length));
  const pick = slice[Math.floor(Math.random() * slice.length)] ?? candidates[0];
  return pick ? { tx: pick.tx, ty: pick.ty } : base;
}

function pickRandomWalkable(blocked: boolean[][], tries = 240) {
  for (let i = 0; i < tries; i++) {
    const tx = 1 + Math.floor(Math.random() * (COLS - 2));
    const ty = 2 + Math.floor(Math.random() * (ROWS - 3));
    if (!isWalkableTile(blocked, tx, ty)) continue;
    const p = tileCenter(tx, ty);
    if (isNearDoor(p.x, p.y, 1.3)) continue;
    return { tx, ty };
  }
  // fallback: somewhere safe-ish
  return { tx: 10, ty: 14 };
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

type Pix = string | "";

function makePixels(w: number, h: number, fill: Pix = ""): Pix[][] {
  return Array.from({ length: h }, () => Array.from({ length: w }, () => fill));
}

function setPx(px: Pix[][], x: number, y: number, c: Pix) {
  if (y < 0 || y >= px.length) return;
  if (x < 0 || x >= (px[0]?.length ?? 0)) return;
  px[y]![x] = c;
}

function fillRect(px: Pix[][], x: number, y: number, w: number, h: number, c: Pix) {
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) setPx(px, x + xx, y + yy, c);
}

function strokeRect(px: Pix[][], x: number, y: number, w: number, h: number, c: Pix) {
  for (let i = 0; i < w; i++) {
    setPx(px, x + i, y, c);
    setPx(px, x + i, y + h - 1, c);
  }
  for (let j = 0; j < h; j++) {
    setPx(px, x, y + j, c);
    setPx(px, x + w - 1, y + j, c);
  }
}

function hatchNoise(x: number, y: number) {
  // deterministic 0..1
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

function woodFloorTileSprite(): Sprite {
  // 16x16 — warm planks w/ grain + top-left highlight, bottom-right wear
  const px = makePixels(16, 16, "");
  const A = "#C89A44"; // mid
  const B = "#B4832F"; // dark
  const C = "#D9B05A"; // light
  const G1 = "#A36F24"; // grain dark
  const G2 = "#E2BE73"; // grain light
  const EDGE = "#7A4E12";

  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      // plank segmentation (irregular widths)
      const plank = x < 5 ? 0 : x < 10 ? 1 : 2;
      let base = plank === 1 ? A : B;
      if (plank === 0) base = (y % 6 < 3) ? A : B;
      if (plank === 2) base = (y % 7 < 3) ? A : B;

      // subtle lighting gradient: top-left brighter, bottom-right darker
      const lit = (x + y) < 10;
      const sh = (x + y) > 22;
      let c = lit ? C : base;
      if (sh) c = B;

      // plank seams
      if (x === 5 || x === 10) c = EDGE;
      if (y % 8 === 0 && hatchNoise(x, y) > 0.35) c = EDGE;

      // grain lines
      const n = hatchNoise(x + plank * 13, y * 2);
      if (n > 0.92) c = G1;
      if (n < 0.06) c = G2;

      // tiny knots
      if ((x === 3 && y === 11) || (x === 13 && y === 5)) c = "#8A5B1A";

      px[y]![x] = c;
    }
  }

  return spriteFromPixels(px as any, 1);
}

function kitchenTileSprite(): Sprite {
  // 16x16 — cream tiles with grout + slight sheen
  const px = makePixels(16, 16, "");
  const T0 = "#EEE6D6";
  const T1 = "#E2D8C6";
  const HI = "#F7F2E7";
  const GR = "#CFC4B1";

  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const gx = x % 4 === 0;
      const gy = y % 4 === 0;
      let c = ((x + y) % 2 === 0) ? T0 : T1;
      if (gx || gy) c = GR;

      // soft specular hits
      const n = hatchNoise(x * 2, y * 2);
      if (!gx && !gy && n > 0.96 && x < 10 && y < 10) c = HI;

      px[y]![x] = c;
    }
  }

  return spriteFromPixels(px as any, 1);
}

function carpetTileSprite(): Sprite {
  // 16x16 — blue weave w/ subtle mottling
  const px = makePixels(16, 16, "");
  const B0 = "#5E8EA6";
  const B1 = "#507F97";
  const B2 = "#6FA6BD";
  const D = "#3F667B";

  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      // weave pattern (checker + diagonals)
      let c = ((x ^ y) & 1) === 0 ? B0 : B1;
      if ((x + y) % 7 === 0) c = D;
      const n = hatchNoise(x * 3, y * 3);
      if (n > 0.93) c = B2;
      if (n < 0.05) c = D;
      px[y]![x] = c;
    }
  }

  return spriteFromPixels(px as any, 1);
}

function wallTileSprite(): Sprite {
  // 16x16 — dark navy/charcoal wall w/ panel + depth (top-left light)
  const px = makePixels(16, 16, "");
  const BASE = "#2A2E3E";
  const MID = "#34384B";
  const HI = "#434862";
  const LO = "#1D2030";
  const EDGE = "#111425";

  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      let c = MID;
      // global lighting
      if (x + y < 8) c = HI;
      if (x + y > 22) c = BASE;

      // panel seams (subtle)
      if (x % 4 === 0) c = BASE;
      if (y % 6 === 0) c = BASE;

      // occasional brick/panel texture
      const n = hatchNoise(x * 2, y * 2);
      if (n > 0.965) c = "#4B5170";
      if (n < 0.035) c = LO;

      // depth edges
      if (x === 0 || y === 0) c = EDGE;
      if (x === 15 || y === 15) c = LO;

      // little top bevel highlight
      if (y === 1 && x > 1 && x < 14) c = "#4A5070";

      px[y]![x] = c;
    }
  }

  return spriteFromPixels(px as any, 1);
}

function deskSprite(): Sprite {
  // 48x32 (3x2 tiles) — dark wood, drawers, grain, top-left light
  const W = 48;
  const H = 32;
  const px = makePixels(W, H, "");

  const OUT = "#2A1A10";
  const TOP0 = "#7A4B23";
  const TOP1 = "#8C5A2A";
  const TOP2 = "#A66D34";
  const APRON0 = "#5A341A";
  const APRON1 = "#4A2A16";
  const G0 = "#6A3E1D";
  const G1 = "#B97B3C";
  const MET = "#C9D1DA";
  const METD = "#8C97A6";

  // body silhouette
  fillRect(px, 1, 6, W - 2, 22, APRON0);
  fillRect(px, 1, 4, W - 2, 6, TOP1);
  strokeRect(px, 1, 4, W - 2, 24, OUT);

  // top bevel highlight (left + top)
  for (let x = 2; x < W - 3; x++) setPx(px, x, 5, TOP2);
  for (let y = 5; y < 24; y++) setPx(px, 2, y, TOP2);

  // top surface subtle gradient + grain
  for (let y = 6; y <= 9; y++) {
    for (let x = 3; x <= W - 4; x++) {
      let c = (x + y < 18) ? TOP2 : TOP1;
      const n = hatchNoise(x * 2, y * 3);
      if (n > 0.92) c = G1;
      if (n < 0.07) c = G0;
      setPx(px, x, y, c);
    }
  }

  // apron shading
  for (let y = 10; y < 27; y++) {
    for (let x = 3; x < W - 3; x++) {
      let c = APRON0;
      if (x + y > 60) c = APRON1;
      const n = hatchNoise(x, y);
      if (n > 0.975) c = "#6B4021";
      setPx(px, x, y, c);
    }
  }

  // drawer block on right
  const dx0 = 30;
  fillRect(px, dx0, 12, 15, 12, "#4C2B17");
  strokeRect(px, dx0, 12, 15, 12, "#2A1A10");
  // drawer splits
  for (let x = dx0 + 1; x < dx0 + 14; x++) setPx(px, x, 16, "#2A1A10");
  for (let x = dx0 + 1; x < dx0 + 14; x++) setPx(px, x, 20, "#2A1A10");
  // handles
  for (let x = dx0 + 5; x <= dx0 + 9; x++) {
    setPx(px, x, 14, METD);
    setPx(px, x, 18, METD);
    setPx(px, x, 22, METD);
  }
  setPx(px, dx0 + 5, 14, MET);
  setPx(px, dx0 + 5, 18, MET);
  setPx(px, dx0 + 5, 22, MET);

  // knee space shadow in middle
  fillRect(px, 18, 14, 10, 10, "#3A1F12");

  // legs (dark, with light on left)
  fillRect(px, 4, 24, 6, 7, "#2D1A10");
  fillRect(px, W - 10, 24, 6, 7, "#2D1A10");
  for (let y = 24; y < 31; y++) {
    setPx(px, 4, y, "#3D2416");
    setPx(px, W - 10, y, "#3D2416");
  }


  return spriteFromPixels(px as any, 1);
}

function chairSprite(): Sprite {
  // 16x16 — beige office chair (rounded back), top-left light
  const px = makePixels(16, 16, "");
  const OUT = "#3B2C1E";
  const C0 = "#D9C6A4";
  const C1 = "#CBB48E";
  const HI = "#EFE2C8";
  const SH = "#A88E68";
  const MET = "#6B7280";

  // backrest
  fillRect(px, 4, 2, 8, 6, C1);
  strokeRect(px, 4, 2, 8, 6, OUT);
  // rounded corners
  setPx(px, 4, 2, "");
  setPx(px, 11, 2, "");
  setPx(px, 4, 7, "");
  setPx(px, 11, 7, "");

  // seat
  fillRect(px, 3, 8, 10, 4, C0);
  strokeRect(px, 3, 8, 10, 4, OUT);
  // highlight strip
  for (let x = 4; x <= 11; x++) setPx(px, x, 9, HI);
  // shadow on right/bottom
  for (let y = 3; y <= 10; y++) setPx(px, 12, y, SH);
  for (let x = 4; x <= 11; x++) setPx(px, x, 11, SH);

  // legs
  fillRect(px, 7, 12, 2, 3, MET);
  fillRect(px, 5, 14, 6, 1, MET);
  setPx(px, 5, 14, "#9CA3AF");

  return spriteFromPixels(px as any, 1);
}

function filingCabinetSprite(): Sprite {
  // 16x32 — gray metal cabinet w/ reflections, handles
  const px = makePixels(16, 32, "");
  const OUT = "#0B1220";
  const G0 = "#9AA3AF";
  const G1 = "#CBD5E1";
  const G2 = "#E2E8F0";
  const SH = "#64748B";

  fillRect(px, 2, 2, 12, 28, G0);
  strokeRect(px, 2, 2, 12, 28, OUT);

  // vertical reflection band (top-left light)
  for (let y = 3; y < 29; y++) {
    setPx(px, 3, y, G1);
    if (y % 7 === 0) setPx(px, 4, y, G2);
    setPx(px, 13, y, SH);
  }

  // drawers (3)
  const ys = [5, 13, 21];
  for (const y of ys) {
    strokeRect(px, 3, y, 10, 7, "#1F2937");
    // handle
    fillRect(px, 6, y + 3, 4, 1, "#374151");
    setPx(px, 6, y + 3, G2);
  }

  // feet
  fillRect(px, 3, 30, 3, 1, OUT);
  fillRect(px, 10, 30, 3, 1, OUT);

  return spriteFromPixels(px as any, 1);
}

function fridgeSprite(): Sprite {
  // 16x32 — silver fridge w/ handle + specular highlights
  const px = makePixels(16, 32, "");
  const OUT = "#0B1220";
  const S0 = "#AAB4C3";
  const S1 = "#D1D5DB";
  const S2 = "#F1F5F9";
  const SH = "#6B7280";

  fillRect(px, 2, 1, 12, 30, S0);
  strokeRect(px, 2, 1, 12, 30, OUT);

  // door split
  for (let x = 3; x < 13; x++) setPx(px, x, 11, "#374151");

  // reflection band
  for (let y = 2; y < 30; y++) {
    setPx(px, 3, y, S1);
    if (y % 8 === 0) setPx(px, 4, y, S2);
    setPx(px, 12, y, SH);
  }

  // handle (right side)
  fillRect(px, 11, 4, 1, 6, "#475569");
  fillRect(px, 11, 14, 1, 10, "#475569");
  setPx(px, 11, 4, S2);
  setPx(px, 11, 14, S2);

  // small logo dot
  setPx(px, 6, 6, S2);

  return spriteFromPixels(px as any, 1);
}

function bookshelfSprite(): Sprite {
  // 32x32 (2x2 tiles) — wooden frame w/ grain, deep shelves, lots of book colors
  const W = 32;
  const H = 32;
  const px = makePixels(W, H, "");

  const OUT = "#1F140C";
  const WO0 = "#6A431F";
  const WO1 = "#7D5125";
  const WO2 = "#97612D";
  const WO3 = "#B47A3A";
  const SH0 = "#2A1B11";

  // outer frame
  fillRect(px, 0, 0, W, H, WO1);
  strokeRect(px, 0, 0, W, H, OUT);
  // inner cavity
  fillRect(px, 2, 2, W - 4, H - 4, SH0);

  // shelves
  const shelfYs = [10, 19, 28];
  for (const sy of shelfYs) {
    fillRect(px, 2, sy, W - 4, 2, WO0);
    for (let x = 3; x < W - 3; x++) setPx(px, x, sy, WO2);
    // highlight on left
    setPx(px, 2, sy, WO3);
    setPx(px, 2, sy + 1, WO2);
  }

  // vertical frame posts + lighting
  fillRect(px, 1, 1, 2, H - 2, WO0);
  fillRect(px, W - 3, 1, 2, H - 2, WO0);
  for (let y = 2; y < H - 2; y++) {
    // left highlight, right shadow
    setPx(px, 1, y, WO3);
    setPx(px, W - 2, y, WO0);
  }

  // wood grain on frame
  for (let y = 1; y < H - 1; y++) {
    for (let x = 0; x < W; x++) {
      if (x > 2 && x < W - 3 && y > 2 && y < H - 3) continue; // skip cavity
      const n = hatchNoise(x * 2, y * 2);
      if (n > 0.975) setPx(px, x, y, WO3);
      else if (n < 0.02) setPx(px, x, y, WO0);
    }
  }

  // books (more variation)
  const bookColors = [
    ["#D14B4B", "#A23535", "#F2B8B8"],
    ["#4B86D1", "#2F5E9F", "#B9D6FF"],
    ["#4BD17A", "#2E9B55", "#B9FFD4"],
    ["#E0B43B", "#B88B22", "#FFF1B3"],
    ["#A46BE0", "#7B47B5", "#EAD6FF"],
    ["#D17A4B", "#A35633", "#FFD6C4"],
    ["#46C6D1", "#2A8E99", "#C7F6FF"],
    ["#D14BC7", "#A23596", "#FFD1F6"],
  ];

  const shelfBands: Array<{ y0: number; y1: number }> = [
    { y0: 3, y1: 9 },
    { y0: 12, y1: 18 },
    { y0: 21, y1: 27 },
  ];

  for (let band = 0; band < shelfBands.length; band++) {
    const { y0, y1 } = shelfBands[band]!;
    let x = 3;
    while (x < W - 4) {
      const w = 2 + (Math.floor(hatchNoise(x * 9, band * 33) * 2)); // 2..3
      const idx = Math.floor(hatchNoise(x * 11, band * 17) * bookColors.length);
      const [c0, c1, cHi] = bookColors[idx]!;
      // gap
      setPx(px, x - 1, y0, "#0B1220");
      // book fill
      for (let yy = y0; yy <= y1; yy++) {
        for (let xx = 0; xx < w; xx++) {
          let c = ((xx === 0) ? c1 : c0);
          // top-left highlight
          if (yy === y0 && xx > 0 && hatchNoise(xx + x, yy) > 0.55) c = cHi;
          // bottom-right shade
          if (yy === y1 && xx === w - 1) c = "#0B1220";
          setPx(px, x + xx, yy, c);
        }
      }
      // spine label line
      if (w >= 3) {
        for (let yy = y0 + 1; yy <= y1 - 1; yy += 2) setPx(px, x + 1, yy, "rgba(255,255,255,0.0)" as any);
      }
      // small title dot
      setPx(px, x + 1, y0 + 2, "#E2E8F0");

      x += w + 1;
    }
  }

  return spriteFromPixels(px as any, 1);
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
  // 32x48 (2x3 tiles) — metallic body, glass, products, reflections
  const W = 32;
  const H = 48;
  const px = makePixels(W, H, "");

  const OUT = "#0B1220";
  const M0 = "#1F2937";
  const M1 = "#334155";
  const M2 = "#475569";
  const HI = "#E2E8F0";
  const GL0 = "#0A1628";
  const GL1 = "#0F253F";

  // body
  fillRect(px, 3, 1, 26, 46, M1);
  strokeRect(px, 3, 1, 26, 46, OUT);
  // metallic gradient strip on left
  for (let y = 2; y < 46; y++) {
    setPx(px, 4, y, M2);
    setPx(px, 5, y, (y % 6 === 0) ? HI : M2);
  }
  // darker right edge
  for (let y = 2; y < 46; y++) setPx(px, 28, y, M0);

  // glass window
  fillRect(px, 6, 4, 15, 28, GL0);
  strokeRect(px, 6, 4, 15, 28, OUT);
  // inner glass pattern + reflections
  for (let y = 5; y < 31; y++) {
    for (let x = 7; x < 20; x++) {
      let c = ((x + y) % 3 === 0) ? GL1 : GL0;
      if (x < 10 && (y % 7 === 0)) c = "#173A60";
      setPx(px, x, y, c);
    }
  }
  // reflection streaks
  for (let y = 6; y < 30; y++) {
    if (y % 5 === 0) {
      setPx(px, 8, y, "#4CC9F0");
      setPx(px, 9, y, "#A5F3FC");
    }
  }

  // products in rows
  const prod = [
    "#FB7185",
    "#F59E0B",
    "#22C55E",
    "#38BDF8",
    "#A78BFA",
    "#F472B6",
    "#FDE047",
  ];
  for (let ry = 0; ry < 5; ry++) {
    for (let rx = 0; rx < 4; rx++) {
      const bx = 7 + rx * 3;
      const by = 7 + ry * 5;
      const c = prod[(rx + ry * 2) % prod.length]!;
      // tiny box/item
      setPx(px, bx, by, c);
      setPx(px, bx + 1, by, c);
      setPx(px, bx, by + 1, c);
      setPx(px, bx + 1, by + 1, c);
      // highlight
      setPx(px, bx, by, "#FFFFFF");
    }
  }
  // spiral hints
  for (let y = 8; y < 30; y += 5) {
    for (let x = 7; x < 20; x += 3) {
      setPx(px, x + 1, y + 2, "#111827");
      setPx(px, x, y + 3, "#111827");
    }
  }

  // keypad/coin area
  fillRect(px, 22, 10, 5, 18, M2);
  strokeRect(px, 22, 10, 5, 18, OUT);
  for (let y = 12; y < 26; y += 3) {
    for (let x = 23; x < 26; x++) setPx(px, x, y, "#CBD5E1");
  }
  // display
  fillRect(px, 23, 7, 3, 2, "#22C55E");
  setPx(px, 23, 7, "#86EFAC");

  // delivery slot
  fillRect(px, 8, 36, 16, 6, "#111827");
  strokeRect(px, 8, 36, 16, 6, OUT);
  // tray lip highlight
  for (let x = 9; x < 23; x++) setPx(px, x, 36, "#374151");

  // base feet
  fillRect(px, 5, 45, 6, 2, OUT);
  fillRect(px, 21, 45, 6, 2, OUT);

  return spriteFromPixels(px as any, 1);
}

function couchSprite(): Sprite {
  // 48x32 (3x2 tiles) — cozy fabric w/ seams, cushions, top-left light
  const W = 48;
  const H = 32;
  const px = makePixels(W, H, "");

  const OUT = "#24140F";
  const F0 = "#4A2A24"; // deep maroon-brown
  const F1 = "#5C342D";
  const F2 = "#704038";
  const HI = "#8A5A4F";
  const SH = "#2A1613";

  // base + back
  fillRect(px, 2, 14, W - 4, 14, F1); // seat
  fillRect(px, 3, 6, W - 6, 10, F2); // back
  // arms
  fillRect(px, 2, 10, 6, 18, F0);
  fillRect(px, W - 8, 10, 6, 18, F0);

  // outline
  strokeRect(px, 2, 6, W - 4, 22, OUT);

  // shading + fabric texture (dither)
  for (let y = 7; y < 27; y++) {
    for (let x = 3; x < W - 3; x++) {
      const cur = px[y]![x];
      if (!cur) continue;
      const n = hatchNoise(x * 3, y * 3);
      let c = cur;
      if (x + y < 18 && n > 0.4) c = HI; // light
      if (x + y > 60 && n > 0.35) c = SH; // shadow
      if (n > 0.985) c = "#9A6B60"; // bright fleck
      if (n < 0.02) c = "#3B201C"; // dark fleck
      setPx(px, x, y, c as any);
    }
  }

  // cushions (3) with seams
  const cushions = [
    { x: 9, w: 10 },
    { x: 19, w: 10 },
    { x: 29, w: 10 },
  ];
  for (const cu of cushions) {
    fillRect(px, cu.x, 15, cu.w, 9, F2);
    strokeRect(px, cu.x, 15, cu.w, 9, "#2B1714");
    // seam curve
    for (let yy = 17; yy <= 22; yy++) {
      setPx(px, cu.x + 1, yy, "#2B1714");
      setPx(px, cu.x + cu.w - 2, yy, "#2B1714");
    }
    // highlight patch
    for (let xx = cu.x + 2; xx < cu.x + cu.w - 2; xx++) setPx(px, xx, 16, HI);
  }

  // bottom shadow ridge
  for (let x = 4; x < W - 4; x++) setPx(px, x, 27, SH);

  // little feet
  fillRect(px, 6, 28, 4, 2, OUT);
  fillRect(px, W - 10, 28, 4, 2, OUT);

  return spriteFromPixels(px as any, 1);
}

function coolerSprite(): Sprite {
  // 16x32 — water bottle w/ translucency + reflections
  const W = 16;
  const H = 32;
  const px = makePixels(W, H, "");

  const OUT = "#1F2937";
  const BD0 = "#D1D5DB";
  const BD1 = "#BFC7D2";
  const BD2 = "#9AA3B2";
  const GL0 = "#7DD3FC";
  const GL1 = "#38BDF8";
  const WTR0 = "#60A5FA";
  const WTR1 = "#93C5FD";

  // bottle silhouette
  fillRect(px, 4, 1, 8, 10, GL0);
  strokeRect(px, 4, 1, 8, 10, OUT);
  // water inside (lower part darker)
  for (let y = 4; y <= 9; y++) {
    for (let x = 5; x <= 10; x++) {
      let c = y < 7 ? WTR1 : WTR0;
      const n = hatchNoise(x * 3, y * 3);
      if (n > 0.93) c = "#A5F3FC";
      setPx(px, x, y, c);
    }
  }
  // glass reflections
  for (let y = 2; y <= 9; y++) {
    if (y % 3 === 0) setPx(px, 5, y, "#E0F2FE");
    setPx(px, 10, y, GL1);
  }
  // cap
  fillRect(px, 6, 0, 4, 2, "#64748B");

  // dispenser body
  fillRect(px, 3, 11, 10, 18, BD0);
  strokeRect(px, 3, 11, 10, 18, OUT);
  // metallic gradient
  for (let y = 12; y <= 27; y++) {
    setPx(px, 4, y, BD1);
    setPx(px, 5, y, (y % 6 === 0) ? "#F8FAFC" : BD0);
    setPx(px, 11, y, BD2);
  }

  // spout + drip tray
  fillRect(px, 7, 18, 2, 3, OUT);
  fillRect(px, 6, 22, 4, 2, "#64748B");
  setPx(px, 6, 22, "#F8FAFC");

  // base
  fillRect(px, 4, 29, 8, 3, "#475569");
  strokeRect(px, 4, 29, 8, 3, OUT);

  return spriteFromPixels(px as any, 1);
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
  // 12x10 — framed monitor w/ bright blue/purple glow + corner highlight
  const W = 12;
  const H = 10;
  const px = makePixels(W, H, "");

  const OUT = "#0B1220";
  const FR0 = "#263041";
  const FR1 = "#334155";
  const ST = "#111827";
  const S0 = "#0A1022";
  const G0 = "#38BDF8";
  const G1 = "#8B5CF6";
  const G2 = "#C084FC";

  // stand/base (top)
  fillRect(px, 3, 0, 6, 2, FR1);
  fillRect(px, 5, 2, 2, 1, ST);

  // body
  fillRect(px, 0, 2, 12, 8, FR0);
  strokeRect(px, 0, 2, 12, 8, OUT);

  // screen inset
  fillRect(px, 1, 3, 10, 6, S0);
  strokeRect(px, 1, 3, 10, 6, "#111827");

  // glow pixels
  for (let y = 4; y <= 7; y++) {
    for (let x = 2; x <= 9; x++) {
      const n = hatchNoise(x * 4, y * 4);
      let c = n > 0.55 ? G1 : G0;
      if (x + y < 8) c = G2;
      if (n > 0.96) c = "#FFFFFF";
      setPx(px, x, y, c);
    }
  }

  // specular highlight on top-left corner
  setPx(px, 2, 4, "#FFFFFF");
  setPx(px, 3, 4, "#E2E8F0");

  // slight dark on bottom-right
  setPx(px, 10, 8, "#111827");
  setPx(px, 9, 8, "#111827");

  return spriteFromPixels(px as any, 1);
}

function whiteboardSprite(): Sprite {
  // 32x16 — clean board with marker scribbles
  const _ = "";
  const FR = "#cbd5e1";
  const SH = "#94a3b8";
  const W = "#f8fafc";
  const px: string[][] = [];
  for (let y = 0; y < 16; y++) {
    const row: string[] = [];
    for (let x = 0; x < 32; x++) {
      if (x === 0 || y === 0 || x === 31 || y === 15) { row.push(SH); continue; }
      if (x === 1 || y === 1 || x === 30 || y === 14) { row.push(FR); continue; }
      let c = W;
      // a little grime/texture
      if ((x * 11 + y * 17) % 67 === 0) c = "#e2e8f0";
      // marker lines
      if (y === 5 && x > 4 && x < 26 && x % 3 !== 0) c = "#22c55e";
      if (y === 7 && x > 6 && x < 28 && x % 4 !== 0) c = "#38bdf8";
      if (y === 10 && x > 5 && x < 18 && x % 2 === 0) c = "#f59e0b";
      if (x === 8 && y > 3 && y < 12) c = "#ef4444";
      row.push(c);
    }
    px.push(row);
  }
  return spriteFromPixels(px, 1);
}

function waterDispenserSprite(): Sprite {
  // 16x32 — blue bottle on white base
  const _ = "";
  const B1 = "#93c5fd";
  const B2 = "#60a5fa";
  const W1 = "#e2e8f0";
  const W2 = "#cbd5e1";
  const D = "#64748b";
  const px: string[][] = Array.from({ length: 32 }, () => Array.from({ length: 16 }, () => _));

  // bottle
  for (let y = 1; y <= 12; y++) for (let x = 5; x <= 10; x++) px[y][x] = (x + y) % 3 === 0 ? B2 : B1;
  for (let x = 6; x <= 9; x++) px[0 + 1][x] = D;
  // base
  for (let y = 13; y <= 29; y++) for (let x = 3; x <= 12; x++) px[y][x] = W1;
  for (let y = 14; y <= 28; y++) for (let x = 4; x <= 11; x++) px[y][x] = W2;
  // outline
  for (let y = 13; y <= 29; y++) { px[y][3] = D; px[y][12] = D; }
  for (let x = 3; x <= 12; x++) { px[13][x] = D; px[29][x] = D; }
  // taps
  px[20][6] = "#0f172a";
  px[20][9] = "#0f172a";
  px[21][6] = "#0f172a";
  px[21][9] = "#0f172a";
  // drip tray
  for (let x = 5; x <= 10; x++) px[24][x] = "#94a3b8";

  // feet
  for (let y = 30; y <= 31; y++) for (let x = 4; x <= 11; x++) px[y][x] = D;

  return spriteFromPixels(px, 1);
}

function rugSprite(): Sprite {
  // 48x32 — warm lounge rug, soft border
  const _ = "";
  const A = "#c08457";
  const B = "#b36a45";
  const EDGE = "#8f4c32";
  const px: string[][] = Array.from({ length: 32 }, () => Array.from({ length: 48 }, () => _));
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 48; x++) {
      const inR = x >= 1 && x <= 46 && y >= 1 && y <= 30;
      if (!inR) continue;
      const onEdge = x === 1 || x === 46 || y === 1 || y === 30;
      let c = (x + y) % 2 === 0 ? A : B;
      if ((x * 9 + y * 13) % 53 === 0) c = "#d6a274";
      if (onEdge) c = EDGE;
      px[y][x] = c;
    }
  }
  // small center motif
  for (let y = 12; y <= 19; y++) for (let x = 20; x <= 27; x++) px[y][x] = (x + y) % 3 === 0 ? "#fbbf24" : "#fde68a";
  return spriteFromPixels(px, 1);
}

function ceilingLightSprite(): Sprite {
  // 16x16 — tiny fixture
  const _ = "";
  const R = "#1a2030";
  const W = "#f8fafc";
  const Y = "#fde68a";
  const px: string[][] = Array.from({ length: 16 }, () => Array.from({ length: 16 }, () => _));
  // outer ring
  for (let y = 5; y <= 10; y++) for (let x = 4; x <= 11; x++) px[y][x] = R;
  for (let y = 6; y <= 9; y++) for (let x = 5; x <= 10; x++) px[y][x] = W;
  for (let y = 7; y <= 8; y++) for (let x = 6; x <= 9; x++) px[y][x] = Y;
  return spriteFromPixels(px, 1);
}

function frameSprite(accent = "#60a5fa"): Sprite {
  // 16x16 — little wall frame
  const _ = "";
  const FR = "#6b4e14";
  const SH = "#5a3e0a";
  const BG = "#0b1220";
  const px: string[][] = Array.from({ length: 16 }, () => Array.from({ length: 16 }, () => _));
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      if (x === 0 || y === 0 || x === 15 || y === 15) { px[y][x] = SH; continue; }
      if (x === 1 || y === 1 || x === 14 || y === 14) { px[y][x] = FR; continue; }
      let c = BG;
      if ((x + y) % 5 === 0) c = accent;
      if (y > 9 && x > 3 && x < 12) c = "#22c55e";
      px[y][x] = c;
    }
  }
  return spriteFromPixels(px, 1);
}

function wallClockSprite(): Sprite {
  // 16x16 — analog clock face
  const _ = "";
  const R = "#1a2030";
  const W = "#f8fafc";
  const G = "#94a3b8";
  const px: string[][] = Array.from({ length: 16 }, () => Array.from({ length: 16 }, () => _));
  for (let y = 2; y <= 13; y++) {
    for (let x = 2; x <= 13; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5);
      if (d <= 6.5) px[y][x] = W;
      if (d >= 6.0 && d <= 6.8) px[y][x] = R;
      if (d <= 1.2) px[y][x] = G;
    }
  }
  // hands (static-ish)
  for (let y = 5; y <= 7; y++) px[y][8] = R;
  for (let x = 8; x <= 11; x++) px[8][x] = R;
  return spriteFromPixels(px, 1);
}

function trashSprite(): Sprite {
  // 16x16 — small bin
  const _ = "";
  const D = "#1f2937";
  const M = "#334155";
  const HI = "#475569";
  const px: string[][] = Array.from({ length: 16 }, () => Array.from({ length: 16 }, () => _));
  for (let y = 4; y <= 13; y++) {
    for (let x = 4; x <= 11; x++) {
      let c = (x + y) % 7 === 0 ? HI : M;
      if (y === 4 || y === 13 || x === 4 || x === 11) c = D;
      px[y][x] = c;
    }
  }
  for (let x = 5; x <= 10; x++) px[3][x] = D;
  return spriteFromPixels(px, 1);
}

// --- World model ---

type FloorKind = "wood" | "beige" | "carpet";

type Prop =
  | { kind: "desk"; tx: number; ty: number; owner?: RosterKey }
  | { kind: "filingCabinet"; tx: number; ty: number }
  | { kind: "fridge"; tx: number; ty: number }
  | { kind: "bookshelf"; tx: number; ty: number }
  | { kind: "plant"; tx: number; ty: number }
  | { kind: "plantDeco"; tx: number; ty: number }
  | { kind: "vending"; tx: number; ty: number }
  | { kind: "couch"; tx: number; ty: number }
  | { kind: "cooler"; tx: number; ty: number }
  | { kind: "painting"; tx: number; ty: number }
  | { kind: "whiteboard"; tx: number; ty: number }
  | { kind: "waterDispenser"; tx: number; ty: number }
  | { kind: "rug"; tx: number; ty: number }
  | { kind: "ceilingLight"; tx: number; ty: number }
  | { kind: "frame"; tx: number; ty: number }
  | { kind: "wallClock"; tx: number; ty: number }
  | { kind: "trash"; tx: number; ty: number }
  | { kind: "coffeeTable"; tx: number; ty: number }
  | { kind: "counter"; tx: number; ty: number }
  | { kind: "tv"; tx: number; ty: number }
  | { kind: "playstation"; tx: number; ty: number }
  // visual-only / decorative
  | { kind: "neonSign"; tx: number; ty: number; text?: string }
  | { kind: "galleryFrame"; tx: number; ty: number; w: number; h: number }
  | { kind: "shelfDecor"; tx: number; ty: number; variant: "globe" | "trophy" }
  | { kind: "execDesk"; tx: number; ty: number }
  | { kind: "execChair"; tx: number; ty: number }
  | { kind: "standingLamp"; tx: number; ty: number }
  | { kind: "visitorSeat"; tx: number; ty: number }
  | { kind: "plaqueSign"; tx: number; ty: number; text: string };

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

// Character ABOVE desk, facing DOWN. Desk directly below, centered on char.
const SEATS: Record<RosterKey, { tx: number; ty: number; face: Dir }> = {
  // boss room
  yuri: { tx: 4, ty: 3, face: "down" },

  // main office (bottom-left)
  // Spread desks into a roomy 2x2 grid with clear aisles.
  // Seat tile is 1 tile above the desk (character faces down toward the desk).
  glass: { tx: 3, ty: 8, face: "down" },
  epstein: { tx: 7, ty: 8, face: "down" },
  jarvis: { tx: 3, ty: 11, face: "down" },
  friday: { tx: 7, ty: 11, face: "down" },
};

// Desk 2x2: placed so character tile is centered on desk top edge
const DESK_POS: Record<RosterKey, { tx: number; ty: number }> = {
  yuri: { tx: 3, ty: 4 },

  // Main office desks (2x2 grid) with generous gaps between stations.
  // Example target: desks at tx=2 and tx=6 on two rows.
  glass: { tx: 2, ty: 9 },
  epstein: { tx: 6, ty: 9 },
  jarvis: { tx: 2, ty: 12 },
  friday: { tx: 6, ty: 12 },
};

function buildProps(): Prop[] {
  // Minimal, clean layout: keep only essentials so the office reads uncluttered.
  const p: Prop[] = [];

  // Desks (functional for seating/pathing)
  p.push({ kind: "desk", tx: DESK_POS.yuri.tx, ty: DESK_POS.yuri.ty, owner: "yuri" });
  p.push({ kind: "desk", tx: DESK_POS.glass.tx, ty: DESK_POS.glass.ty, owner: "glass" });
  p.push({ kind: "desk", tx: DESK_POS.epstein.tx, ty: DESK_POS.epstein.ty, owner: "epstein" });
  p.push({ kind: "desk", tx: DESK_POS.jarvis.tx, ty: DESK_POS.jarvis.ty, owner: "jarvis" });
  p.push({ kind: "desk", tx: DESK_POS.friday.tx, ty: DESK_POS.friday.ty, owner: "friday" });

  // Bookshelves (simple + visible)
  p.push({ kind: "bookshelf", tx: 1, ty: 7 });
  p.push({ kind: "bookshelf", tx: 17, ty: 9 });

  // Lounge essentials: TV on the wall + couch below it
  p.push({ kind: "tv", tx: 12, ty: SPLIT_Y });
  p.push({ kind: "couch", tx: 11, ty: 12 });

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

  // main vertical wall split (3-tile wide door)
  for (let y = 0; y < ROWS; y++) {
    if (Math.abs(y - DOOR_MAIN_RIGHT.ty) <= 1) continue; // 3-tile door
    blocked[y][SPLIT_X] = true;
  }

  // right horizontal split (3-tile wide door)
  for (let x = SPLIT_X; x < COLS; x++) {
    if (Math.abs(x - DOOR_KITCHEN_LOUNGE.tx) <= 1) continue; // 3-tile door
    blocked[SPLIT_Y][x] = true;
  }

  // boss room separation wall (3-tile wide door)
  for (let x = 0; x < SPLIT_X; x++) {
    if (Math.abs(x - DOOR_BOSS.tx) <= 1) continue; // 3-tile door
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

    // visual-only props
    if (pr.kind === "plantDeco") {}
    if (pr.kind === "neonSign") {}
    if (pr.kind === "galleryFrame") {}
    if (pr.kind === "shelfDecor") {}
    if (pr.kind === "execDesk") {}
    if (pr.kind === "execChair") {}
    if (pr.kind === "standingLamp") {}
    if (pr.kind === "visitorSeat") {}
    if (pr.kind === "plaqueSign") {}
  }

  // doors are passable — ensure all 3 tiles of each door are clear
  for (const d of DOOR_TILES) {
    blocked[d.ty][d.tx] = false;
    // vertical doors: clear ±1 in Y
    if (d === DOOR_MAIN_RIGHT || d === DOOR_BOSS) {
      if (d.ty - 1 >= 0) blocked[d.ty - 1][d.tx] = false;
      if (d.ty + 1 < ROWS) blocked[d.ty + 1][d.tx] = false;
    }
    // horizontal doors: clear ±1 in X
    if (d === DOOR_KITCHEN_LOUNGE) {
      if (d.tx - 1 >= 0) blocked[d.ty][d.tx - 1] = false;
      if (d.tx + 1 < COLS) blocked[d.ty][d.tx + 1] = false;
    }
  }

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

function drawDustMotes(ctx: CanvasRenderingContext2D, props: Prop[], ms: number) {
  // soft floating dust in light beams (purely cosmetic)
  const t = ms / 1000;
  for (const pr of props) {
    if (pr.kind !== "ceilingLight") continue;
    const cx = pr.tx * TILE + 8;
    const cy = pr.ty * TILE + 10;
    for (let i = 0; i < 6; i++) {
      const ph = i * 1.7 + pr.tx * 0.3 + pr.ty * 0.2;
      const x = cx + Math.sin(t * 0.35 + ph) * (10 + i * 2.2);
      const y = cy + Math.cos(t * 0.28 + ph * 1.3) * (7 + i * 1.6);
      const a = 0.10 + 0.08 * (0.5 + 0.5 * Math.sin(t * 0.9 + ph));
      ctx.save();
      ctx.globalAlpha = a;
      ctx.fillStyle = "rgba(255,255,255,1)";
      ctx.beginPath();
      ctx.arc(x, y, 0.8 + (i % 2) * 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
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
  const x = 15 * TILE;
  const y = 1 * TILE + 10;
  ctx.save();
  ctx.globalAlpha = 0.92;
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  // Wider box so "01:30 WIB" never clips
  ctx.fillRect(x - 30, y - 7, 60, 14);
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.strokeRect(x - 30.5, y - 7.5, 61, 15);
  ctx.font = "bold 7px ui-monospace, SFMono-Regular, Menlo, Monaco";
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
  chair: Sprite;
  filingCabinet: Sprite;
  fridge: Sprite;
  bookshelf: Sprite;
  plant: Sprite;
  vending: Sprite;
  couch: Sprite;
  cooler: Sprite;
  monitor: Sprite;
  painting: Sprite;
  whiteboard: Sprite;
  waterDispenser: Sprite;
  rug: Sprite;
  ceilingLight: Sprite;
  frame: Sprite;
  wallClock: Sprite;
  trash: Sprite;
  coffeeTable: Sprite;
  counter: Sprite;
  tv: Sprite;
  playstation: Sprite;
};

function buildSprites(): Sprites {
  return {
    floorWood: woodFloorTileSprite(),
    floorBeige: kitchenTileSprite(),
    floorCarpet: carpetTileSprite(),
    wall: wallTileSprite(),
    desk: deskSprite(),
    chair: chairSprite(),
    filingCabinet: filingCabinetSprite(),
    fridge: fridgeSprite(),
    bookshelf: bookshelfSprite(),
    plant: plantSprite(),
    vending: vendingSprite(),
    couch: couchSprite(),
    cooler: coolerSprite(),
    monitor: monitorSprite(),
    painting: paintingSprite(),
    whiteboard: whiteboardSprite(),
    waterDispenser: waterDispenserSprite(),
    rug: rugSprite(),
    ceilingLight: ceilingLightSprite(),
    frame: frameSprite(),
    wallClock: wallClockSprite(),
    trash: trashSprite(),
    coffeeTable: coffeeTableSprite(),
    counter: counterSprite(),
    tv: tvSprite(),
    playstation: playstationSprite(),
  };
}

function drawFloorWoodTile(ctx: CanvasRenderingContext2D, x: number, y: number, tx: number, ty: number) {
  // Wood planks (AGGRESSIVE): distinct plank strips w/ per-plank gradients, cracks, knots, and grain curves.
  // plank seams (vary with tile coord so it doesn't look tiled)
  const seamA = ((tx * 3 + ty) % 3) + 4; // 4..6
  const seamB = seamA + 5 + ((tx + ty) % 2); // ~10..12

  const planks: Array<{ x0: number; x1: number; tint: number }> = [
    { x0: 0, x1: seamA, tint: ((tx + ty) % 3) - 1 },
    { x0: seamA, x1: seamB, tint: ((tx * 2 + ty) % 3) - 1 },
    { x0: seamB, x1: 16, tint: ((tx + ty * 2) % 3) - 1 },
  ];

  // paint planks as separate rectangles with subtle shade differences + 3D lighting
  for (let i = 0; i < planks.length; i++) {
    const p = planks[i]!;
    const w = p.x1 - p.x0;
    const base0 = p.tint === -1 ? "#C68F3F" : p.tint === 0 ? "#B98635" : "#AE7B2E";
    const base1 = p.tint === -1 ? "#A77027" : p.tint === 0 ? "#8E5B1F" : "#7C4D17";
    const g = ctx.createLinearGradient(x + p.x0, y, x + p.x0 + w, y + 16);
    g.addColorStop(0, "#E1B260");
    g.addColorStop(0.18, base0);
    g.addColorStop(1, base1);
    ctx.fillStyle = g;
    ctx.fillRect(x + p.x0, y, w, 16);

    // plank highlight on top-left edge
    ctx.save();
    ctx.globalAlpha = 0.14;
    ctx.fillStyle = "rgba(255,255,255,0.65)";
    ctx.fillRect(x + p.x0, y, w, 1);
    ctx.fillRect(x + p.x0, y, 1, 16);

    // plank shadow on bottom-right edge
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(x + p.x0, y + 15, w, 1);
    ctx.fillRect(x + p.x0 + w - 1, y, 1, 16);
    ctx.restore();

    // grain curves (wavy, not straight)
    ctx.save();
    ctx.lineWidth = 0.65;
    ctx.globalAlpha = 0.18;
    ctx.strokeStyle = "rgba(255, 241, 205, 0.45)";
    for (let k = 0; k < 3; k++) {
      const yy = y + 3 + k * 4 + (((tx + ty + i + k) % 3) - 1) * 0.25;
      ctx.beginPath();
      ctx.moveTo(x + p.x0 + 1, yy);
      ctx.bezierCurveTo(x + p.x0 + 2 + w * 0.35, yy + 0.9, x + p.x0 + 2 + w * 0.7, yy - 0.7, x + p.x0 + w - 1, yy + 0.2);
      ctx.stroke();
    }
    ctx.globalAlpha = 0.14;
    ctx.strokeStyle = "rgba(44, 24, 8, 0.40)";
    for (let k = 0; k < 2; k++) {
      const yy = y + 5 + k * 5;
      ctx.beginPath();
      ctx.moveTo(x + p.x0 + 1, yy);
      ctx.bezierCurveTo(x + p.x0 + 2 + w * 0.4, yy - 0.4, x + p.x0 + 2 + w * 0.75, yy + 1.0, x + p.x0 + w - 1, yy);
      ctx.stroke();
    }

    // knots (deterministic per plank)
    const knot = hatchNoise(tx * 19 + i * 7, ty * 11 + i * 13);
    if (knot > 0.80) {
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = "rgba(60, 32, 12, 0.60)";
      const kx = x + p.x0 + 2 + Math.floor((knot * 100) % Math.max(1, w - 4));
      const ky = y + 7 + Math.floor(((knot * 1000) % 6));
      ctx.fillRect(kx, ky, 2, 1);
      ctx.fillRect(kx - 1, ky + 1, 3, 1);
    }
    ctx.restore();
  }

  // cracks/seams between planks (dark) + tiny chips
  ctx.save();
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = "rgba(44, 24, 8, 0.75)";
  ctx.beginPath();
  for (const s of [seamA, seamB]) {
    ctx.moveTo(x + s + 0.5, y + 0.5);
    ctx.lineTo(x + s + 0.5, y + 15.5);
  }
  ctx.stroke();

  // extra micro-cracks across the tile
  ctx.globalAlpha = 0.12;
  ctx.strokeStyle = "rgba(20, 12, 6, 0.70)";
  for (let yy = 2; yy <= 14; yy += 4) {
    if (hatchNoise(tx * 7 + yy, ty * 11 + yy) < 0.55) continue;
    ctx.beginPath();
    ctx.moveTo(x + 1.5, y + yy + 0.5);
    ctx.lineTo(x + 14.5, y + yy + 0.5);
    ctx.stroke();
  }
  ctx.restore();

  // tile bevel to keep the whole room crisp
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.fillRect(x, y, 16, 1);
  ctx.fillRect(x, y, 1, 16);
  ctx.globalAlpha = 0.14;
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fillRect(x, y + 15, 16, 1);
  ctx.fillRect(x + 15, y, 1, 16);
  ctx.restore();
}

function drawFloorKitchenTile(ctx: CanvasRenderingContext2D, x: number, y: number, tx: number, ty: number) {
  // light tile with grout grid + mild sheen
  const g = ctx.createLinearGradient(x, y, x, y + 16);
  g.addColorStop(0, "#F1E9DA");
  g.addColorStop(1, "#E2D6C2");
  ctx.fillStyle = g;
  ctx.fillRect(x, y, 16, 16);

  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = "rgba(120, 112, 100, 0.35)";
  ctx.lineWidth = 1;
  // 4x4 sub-tiles
  for (let i = 4; i <= 12; i += 4) {
    ctx.beginPath();
    ctx.moveTo(x + i + 0.5, y + 0.5);
    ctx.lineTo(x + i + 0.5, y + 15.5);
    ctx.moveTo(x + 0.5, y + i + 0.5);
    ctx.lineTo(x + 15.5, y + i + 0.5);
    ctx.stroke();
  }
  // sheen (top-left)
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.fillRect(x + 2, y + 2, 6, 2);
  ctx.fillRect(x + 2, y + 4, 3, 1);
  ctx.restore();

  // tiny speckle
  if (((tx * 13 + ty * 7) % 23) === 0) {
    ctx.save();
    ctx.globalAlpha = 0.10;
    ctx.fillStyle = "rgba(15,23,42,0.8)";
    ctx.fillRect(x + 11, y + 9, 1, 1);
    ctx.fillRect(x + 6, y + 12, 1, 1);
    ctx.restore();
  }
}

function drawFloorCarpetTile(ctx: CanvasRenderingContext2D, x: number, y: number, tx: number, ty: number) {
  // Lounge carpet: avoid flat blue — add weave + mottled variation.
  const g = ctx.createLinearGradient(x, y, x + 16, y + 16);
  g.addColorStop(0, "#6AA4B7");
  g.addColorStop(1, "#2F6078");
  ctx.fillStyle = g;
  ctx.fillRect(x, y, 16, 16);

  // mottled patches (deterministic-ish from coords)
  ctx.save();
  const n0 = hatchNoise(tx * 37 + ty * 19, ty * 13 + tx * 7);
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = n0 > 0.55 ? "rgba(255,255,255,0.25)" : "rgba(2,6,23,0.35)";
  ctx.fillRect(x + 1, y + 1, 14, 14);

  // weave: alternating dots + tiny dashes
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = "rgba(15,23,42,0.85)";
  for (let yy = 0; yy < 16; yy += 2) {
    for (let xx = (yy + tx + ty) % 4; xx < 16; xx += 4) {
      ctx.fillRect(x + xx, y + yy, 1, 1);
      if (((xx + yy + tx) % 7) === 0) ctx.fillRect(x + xx + 1, y + yy, 1, 1);
    }
  }

  // subtle light direction
  ctx.globalAlpha = 0.10;
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.fillRect(x, y, 16, 1);
  ctx.fillRect(x, y, 1, 16);
  ctx.globalAlpha = 0.10;
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fillRect(x, y + 15, 16, 1);
  ctx.fillRect(x + 15, y, 1, 16);

  ctx.restore();
}

function drawWallTile(ctx: CanvasRenderingContext2D, x: number, y: number, tx: number, ty: number) {
  // Dark navy/charcoal wall with visible panel/brick texture + vertical depth shading.
  // Depth: top slightly lighter, bottom slightly darker.
  const tY = clamp(ty / (ROWS - 1), 0, 1);

  // Base gradient (navy → charcoal)
  const g = ctx.createLinearGradient(x, y, x, y + 16);
  g.addColorStop(0, "#2d2d44");
  g.addColorStop(0.55, "#202037");
  g.addColorStop(1, "#1a1a2e");
  ctx.fillStyle = g;
  ctx.fillRect(x, y, 16, 16);

  // Global depth shading (scene-level): subtle lift near top, heavier near bottom.
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = "rgba(255,255,255,0.20)";
  ctx.fillRect(x, y, 16, 2);
  ctx.globalAlpha = 0.12 + tY * 0.16;
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(x, y + 13, 16, 3);

  // Brick/panel texture (AGGRESSIVE): dense horizontal + vertical mortar lines + speckle.
  // Horizontal mortar every ~2–3px
  ctx.lineWidth = 1;
  for (let yy = 2; yy <= 14; yy += 2) {
    const wob = ((tx * 13 + ty * 9 + yy) % 3) - 1; // -1..1
    ctx.globalAlpha = yy % 4 === 0 ? 0.34 : 0.26;
    ctx.strokeStyle = "rgba(2,6,23,0.78)";
    ctx.beginPath();
    ctx.moveTo(x + 0.5, y + yy + 0.5 + wob * 0.15);
    ctx.lineTo(x + 15.5, y + yy + 0.5 + wob * 0.15);
    ctx.stroke();

    // highlight just above mortar line for relief
    ctx.globalAlpha = 0.12;
    ctx.strokeStyle = "rgba(226,232,240,0.30)";
    ctx.beginPath();
    ctx.moveTo(x + 0.5, y + yy - 1 + 0.5);
    ctx.lineTo(x + 15.5, y + yy - 1 + 0.5);
    ctx.stroke();
  }

  // Vertical joints every ~3–5px (staggered by tile coords)
  ctx.globalAlpha = 0.22;
  ctx.strokeStyle = "rgba(2,6,23,0.70)";
  const joints = [2 + ((tx + ty) % 2), 7 + ((tx * 2 + ty) % 2), 12 - ((tx + ty) % 2)];
  for (const vx of joints) {
    ctx.beginPath();
    ctx.moveTo(x + vx + 0.5, y + 1.5);
    ctx.lineTo(x + vx + 0.5, y + 14.5);
    ctx.stroke();

    ctx.globalAlpha = 0.10;
    ctx.strokeStyle = "rgba(226,232,240,0.22)";
    ctx.beginPath();
    ctx.moveTo(x + vx - 1 + 0.5, y + 1.5);
    ctx.lineTo(x + vx - 1 + 0.5, y + 14.5);
    ctx.stroke();

    ctx.globalAlpha = 0.22;
    ctx.strokeStyle = "rgba(2,6,23,0.70)";
  }

  // Speckle/noise texture (deterministic): tiny chips + soot
  for (let i = 0; i < 10; i++) {
    const nx = (i * 7 + tx * 11 + ty * 3) % 16;
    const ny = (i * 5 + tx * 2 + ty * 13) % 16;
    const n = hatchNoise(tx * 31 + nx * 3, ty * 17 + ny * 5);
    if (n > 0.82) {
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = "rgba(226,232,240,0.55)";
      ctx.fillRect(x + nx, y + ny, 1, 1);
    } else if (n < 0.14) {
      ctx.globalAlpha = 0.10;
      ctx.fillStyle = "rgba(2,6,23,0.85)";
      ctx.fillRect(x + nx, y + ny, 1, 1);
    }
  }

  // Corner shadow vibes (where walls meet floor / adjacent walls):
  // strong bottom band + slight right band. (We can't cheaply detect neighbors here; stylize per-tile.)
  ctx.globalAlpha = 0.10 + tY * 0.10;
  const bottom = ctx.createLinearGradient(x, y + 10, x, y + 16);
  bottom.addColorStop(0, "rgba(2,6,23,0.0)");
  bottom.addColorStop(1, "rgba(2,6,23,0.55)");
  ctx.fillStyle = bottom;
  ctx.fillRect(x, y + 10, 16, 6);

  const side = ctx.createLinearGradient(x + 10, y, x + 16, y);
  side.addColorStop(0, "rgba(2,6,23,0.0)");
  side.addColorStop(1, "rgba(2,6,23,0.35)");
  ctx.fillStyle = side;
  ctx.fillRect(x + 10, y, 6, 16);

  // Bevel highlight (top-left)
  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = "rgba(226,232,240,0.25)";
  ctx.beginPath();
  ctx.moveTo(x + 0.5, y + 0.5);
  ctx.lineTo(x + 15.5, y + 0.5);
  ctx.moveTo(x + 0.5, y + 0.5);
  ctx.lineTo(x + 0.5, y + 15.5);
  ctx.stroke();

  ctx.restore();
}

function drawDesk(ctx: CanvasRenderingContext2D, x: number, y: number) {
  // 48x32 — simplified desk + simple monitor
  ctx.save();

  // soft ground shadow
  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = "rgba(2,6,23,0.55)";
  ctx.beginPath();
  ctx.ellipse(x + 24, y + 30, 22, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // desk (clean blocks)
  ctx.fillStyle = PALETTE.woodA;
  ctx.fillRect(x + 2, y + 8, 44, 6); // top

  ctx.fillStyle = PALETTE.woodB;
  ctx.fillRect(x + 2, y + 14, 44, 14); // front

  // legs
  ctx.fillStyle = "#3b2a1a";
  ctx.fillRect(x + 6, y + 26, 4, 6);
  ctx.fillRect(x + 38, y + 26, 4, 6);

  // monitor: simple rectangle screen (no gradients/details)
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(x + 18, y + 2, 14, 9);
  ctx.strokeStyle = "rgba(226,232,240,0.20)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 18.5, y + 2.5, 13, 8);

  // simple stand
  ctx.fillStyle = "#0b1020";
  ctx.fillRect(x + 23, y + 11, 4, 2);
  ctx.fillRect(x + 21, y + 13, 8, 1);

  ctx.restore();
}

function drawChair(ctx: CanvasRenderingContext2D, x: number, y: number) {
  // 16x16 beige/tan with rounded back
  ctx.save();
  const base = ctx.createLinearGradient(x, y, x + 16, y + 16);
  base.addColorStop(0, "#F1E2C8");
  base.addColorStop(1, "#CDBB9D");
  ctx.fillStyle = base;

  // backrest
  ctx.beginPath();
  ctx.roundRect(x + 3, y + 2, 10, 8, 4);
  ctx.fill();
  // seat
  ctx.fillStyle = "#D8C5A8";
  ctx.beginPath();
  ctx.roundRect(x + 2, y + 9, 12, 5, 3);
  ctx.fill();

  // seam + depth
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = "rgba(15,23,42,0.35)";
  ctx.beginPath();
  ctx.moveTo(x + 4.5, y + 11.5);
  ctx.lineTo(x + 11.5, y + 11.5);
  ctx.stroke();

  // legs
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = "#3B2A1A";
  ctx.fillRect(x + 4, y + 13, 2, 3);
  ctx.fillRect(x + 10, y + 13, 2, 3);

  ctx.restore();
}

function drawBookshelf(ctx: CanvasRenderingContext2D, x: number, y: number, seed: number) {
  // 32x32 — wooden frame + 4 shelves + colorful books (varying widths, some tilted) + a few decor gaps.
  // Make it pop against dark walls with a subtle halo/backplate, and crisp book edges + labels.
  ctx.save();

  // subtle wall-separation halo (so the shelf doesn't blend into the wall)
  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = "rgba(226,232,240,0.10)";
  ctx.fillRect(x, y, 32, 32);
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = "rgba(56,189,248,0.20)";
  ctx.fillRect(x + 1, y + 1, 30, 30);
  ctx.restore();

  // shadow under bookshelf
  ctx.save();
  ctx.globalAlpha = 0.30;
  const sh = ctx.createRadialGradient(x + 16, y + 31, 4, x + 16, y + 31, 18);
  sh.addColorStop(0, "rgba(2,6,23,0.55)");
  sh.addColorStop(1, "rgba(2,6,23,0.0)");
  ctx.fillStyle = sh;
  ctx.beginPath();
  ctx.ellipse(x + 16, y + 31, 14, 4.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // outer frame (3D depth)
  const frame = ctx.createLinearGradient(x, y, x + 32, y + 32);
  frame.addColorStop(0, "#8A5528");
  frame.addColorStop(0.55, "#6A3C1B");
  frame.addColorStop(1, "#3F200D");
  ctx.fillStyle = frame;
  ctx.fillRect(x + 1, y + 1, 30, 30);

  // inner cavity (slightly brighter + bluish tint so books pop against the wall)
  const inner = ctx.createLinearGradient(x, y + 4, x, y + 28);
  inner.addColorStop(0, "rgba(30,41,59,0.22)");
  inner.addColorStop(0.55, "rgba(2,6,23,0.32)");
  inner.addColorStop(1, "rgba(2,6,23,0.42)");
  ctx.fillStyle = inner;
  ctx.fillRect(x + 4, y + 4, 24, 24);
  // subtle inset edge for separation
  ctx.globalAlpha = 0.45;
  ctx.strokeStyle = "rgba(226,232,240,0.10)";
  ctx.strokeRect(x + 4.5, y + 4.5, 23, 23);
  ctx.globalAlpha = 1;

  // shelves (4 rows => 4-6 feel in small sprite)
  ctx.globalAlpha = 0.95;
  ctx.fillStyle = "rgba(123,74,34,0.92)";
  for (const sy of [10, 16, 22, 28]) {
    ctx.fillRect(x + 4, y + sy, 24, 2);
    // tiny shelf highlight
    ctx.globalAlpha = 0.20;
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.fillRect(x + 4, y + sy, 24, 1);
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = "rgba(123,74,34,0.92)";
  }

  // books
  const colors = ["#ef4444", "#3b82f6", "#22c55e", "#eab308", "#a855f7", "#f97316", "#14b8a6", "#f43f5e"];
  const drawRow = (shelfY: number, rowSeed: number) => {
    let xx = x + 5;
    while (xx < x + 27) {
      const n = hatchNoise(Math.floor(xx) + rowSeed * 17, Math.floor(shelfY) * 3);
      const w = 2 + Math.floor(n * 5); // 2..6

      // occasional empty gap for decor/air
      const gap = hatchNoise(rowSeed * 31, Math.floor(xx) * 5) > 0.92;
      if (gap) {
        xx += 3;
        // tiny decor item sometimes
        if (hatchNoise(rowSeed * 29, Math.floor(xx) * 7) > 0.70) {
          ctx.save();
          ctx.globalAlpha = 0.9;
          const dx = xx;
          const dy = shelfY - 6;
          // vase/plant-ish
          ctx.fillStyle = "rgba(226,232,240,0.55)";
          ctx.beginPath();
          ctx.roundRect(dx, dy, 3, 5, 1.2);
          ctx.fill();
          ctx.globalAlpha = 0.35;
          ctx.fillStyle = "rgba(34,197,94,0.55)";
          ctx.fillRect(dx + 1, dy - 2, 1, 2);
          ctx.restore();
        }
        continue;
      }

      const h = 6 + Math.floor(hatchNoise(rowSeed * 9, Math.floor(xx) * 2) * 5); // 6..10
      const tilt = hatchNoise(rowSeed * 11, Math.floor(xx) * 4) > 0.86;
      const c = colors[Math.floor(hatchNoise(rowSeed * 7, Math.floor(xx)) * colors.length)]!;

      ctx.save();
      ctx.fillStyle = c;

      // deterministic per-book “label” decision
      const label = hatchNoise(rowSeed * 19, Math.floor(xx) * 13) > 0.55;
      const darkLabel = hatchNoise(rowSeed * 23, Math.floor(xx) * 9) > 0.72;

      if (tilt) {
        ctx.translate(xx + w / 2, shelfY);
        ctx.rotate(-0.14);
        ctx.fillRect(-w / 2, -h + 1, w, h);

        // crisp edge so individual books read at a glance
        ctx.globalAlpha = 0.40;
        ctx.strokeStyle = "rgba(2,6,23,0.55)";
        ctx.strokeRect(-w / 2 + 0.5, -h + 1.5, w - 1, h - 2);

        // spine highlight
        ctx.globalAlpha = 0.34;
        ctx.fillStyle = "rgba(255,255,255,0.78)";
        ctx.fillRect(-w / 2 + 0.6, -h + 2, 1, h - 2);

        // tiny title marks / label band (higher contrast so books read clearly)
        if (label && w >= 3) {
          ctx.globalAlpha = 0.92;
          ctx.fillStyle = darkLabel ? "rgba(15,23,42,0.72)" : "rgba(226,232,240,0.90)";
          ctx.fillRect(-w / 2 + 1, -h + 3, w - 2, 2);

          // faux text lines
          ctx.globalAlpha = 0.75;
          ctx.fillStyle = darkLabel ? "rgba(226,232,240,0.92)" : "rgba(15,23,42,0.55)";
          ctx.fillRect(-w / 2 + 1, -h + 6, w - 2, 1);
          if (h > 8) ctx.fillRect(-w / 2 + 1, -h + 8, w - 2, 1);
          if (h > 9 && w > 3) ctx.fillRect(-w / 2 + 1, -h + 9, w - 3, 1);
        }
      } else {
        ctx.fillRect(xx, shelfY - h + 1, w, h);

        // crisp edge so individual books read at a glance
        ctx.globalAlpha = 0.40;
        ctx.strokeStyle = "rgba(2,6,23,0.55)";
        ctx.strokeRect(xx + 0.5, shelfY - h + 1.5, w - 1, h - 2);

        // spine highlight
        ctx.globalAlpha = 0.34;
        ctx.fillStyle = "rgba(255,255,255,0.78)";
        ctx.fillRect(xx + 0.6, shelfY - h + 2, 1, h - 2);

        // tiny title marks / label band (higher contrast so books read clearly)
        if (label && w >= 3) {
          ctx.globalAlpha = 0.92;
          ctx.fillStyle = darkLabel ? "rgba(15,23,42,0.72)" : "rgba(226,232,240,0.90)";
          ctx.fillRect(xx + 1, shelfY - h + 3, w - 2, 2);

          // faux text lines
          ctx.globalAlpha = 0.75;
          ctx.fillStyle = darkLabel ? "rgba(226,232,240,0.92)" : "rgba(15,23,42,0.55)";
          ctx.fillRect(xx + 1, shelfY - h + 6, w - 2, 1);
          if (h > 8) ctx.fillRect(xx + 1, shelfY - h + 8, w - 2, 1);
          if (h > 9 && w > 3) ctx.fillRect(xx + 1, shelfY - h + 9, w - 3, 1);
        }
      }
      ctx.restore();

      xx += w + 1;
    }
  };

  drawRow(y + 12, seed + 1);
  drawRow(y + 18, seed + 2);
  drawRow(y + 24, seed + 3);
  drawRow(y + 30, seed + 4);

  // frame outline + highlights (3D)
  ctx.globalAlpha = 0.70;
  ctx.strokeStyle = "rgba(2,6,23,0.60)";
  ctx.strokeRect(x + 1.5, y + 1.5, 29, 29);
  ctx.globalAlpha = 0.28;
  ctx.strokeStyle = "rgba(253,230,138,0.30)";
  ctx.beginPath();
  ctx.moveTo(x + 2.5, y + 2.5);
  ctx.lineTo(x + 29.5, y + 2.5);
  ctx.moveTo(x + 2.5, y + 2.5);
  ctx.lineTo(x + 2.5, y + 29.5);
  ctx.stroke();

  ctx.restore();
}

function drawVendingMachine(ctx: CanvasRenderingContext2D, x: number, y: number) {
  // 32x48 — metallic body, glass, colorful rows
  ctx.save();

  // shadow under
  ctx.save();
  ctx.globalAlpha = 0.35;
  const sh = ctx.createRadialGradient(x + 16, y + 46, 4, x + 16, y + 46, 18);
  sh.addColorStop(0, "rgba(2,6,23,0.55)");
  sh.addColorStop(1, "rgba(2,6,23,0.0)");
  ctx.fillStyle = sh;
  ctx.beginPath();
  ctx.ellipse(x + 16, y + 46, 14, 4.4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const body = ctx.createLinearGradient(x, y, x + 32, y + 48);
  body.addColorStop(0, "#6B7280");
  body.addColorStop(0.5, "#4B5563");
  body.addColorStop(1, "#374151");
  ctx.fillStyle = body;
  ctx.fillRect(x + 2, y + 2, 28, 44);

  // metallic sheen bands
  ctx.save();
  const sheen = ctx.createLinearGradient(x + 2, y, x + 30, y);
  sheen.addColorStop(0, "rgba(255,255,255,0.05)");
  sheen.addColorStop(0.35, "rgba(255,255,255,0.18)");
  sheen.addColorStop(0.55, "rgba(255,255,255,0.06)");
  sheen.addColorStop(1, "rgba(0,0,0,0.10)");
  ctx.fillStyle = sheen;
  ctx.fillRect(x + 2, y + 2, 28, 44);
  ctx.restore();

  // brand panel
  ctx.fillStyle = "rgba(15,23,42,0.65)";
  ctx.fillRect(x + 4, y + 4, 24, 6);
  ctx.fillStyle = "rgba(56,189,248,0.75)";
  ctx.font = "6px ui-monospace, SFMono-Regular, Menlo, Monaco";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("SODA", x + 16, y + 7);

  // glass window
  ctx.fillStyle = "rgba(2,6,23,0.35)";
  ctx.fillRect(x + 5, y + 12, 18, 26);
  ctx.strokeStyle = "rgba(226,232,240,0.35)";
  ctx.strokeRect(x + 5.5, y + 12.5, 17, 25);

  // products
  const rows = 4;
  const cols = 3;
  const colors = ["#ef4444", "#22c55e", "#3b82f6", "#eab308", "#a855f7", "#f97316", "#14b8a6"];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cx = x + 7 + c * 5;
      const cy = y + 15 + r * 6;
      const col = colors[(r * 3 + c) % colors.length]!;
      ctx.fillStyle = col;
      ctx.fillRect(cx, cy, 4, 3);
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      ctx.fillRect(cx, cy, 1, 3);
      ctx.globalAlpha = 1;
    }
    // shelf line
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = "rgba(226,232,240,0.25)";
    ctx.beginPath();
    ctx.moveTo(x + 6.5, y + 18 + r * 6 + 3.5);
    ctx.lineTo(x + 22.5, y + 18 + r * 6 + 3.5);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // coin slot / keypad
  ctx.fillStyle = "rgba(15,23,42,0.55)";
  ctx.fillRect(x + 24, y + 14, 4, 10);
  ctx.fillStyle = "rgba(226,232,240,0.75)";
  ctx.fillRect(x + 25, y + 16, 2, 1);
  ctx.globalAlpha = 0.65;
  for (let i = 0; i < 6; i++) ctx.fillRect(x + 25, y + 18 + i, 2, 0.5);
  ctx.globalAlpha = 1;

  // glass shine
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.fillRect(x + 6, y + 13, 2, 24);

  // outline + highlight
  ctx.globalAlpha = 0.7;
  ctx.strokeStyle = "rgba(2,6,23,0.55)";
  ctx.strokeRect(x + 2.5, y + 2.5, 27, 43);
  ctx.globalAlpha = 0.25;
  ctx.strokeStyle = "rgba(253,230,138,0.30)";
  ctx.beginPath();
  ctx.moveTo(x + 2.5, y + 2.5);
  ctx.lineTo(x + 29.5, y + 2.5);
  ctx.moveTo(x + 2.5, y + 2.5);
  ctx.lineTo(x + 2.5, y + 45.5);
  ctx.stroke();

  ctx.restore();
}

function drawCouch(ctx: CanvasRenderingContext2D, x: number, y: number) {
  // 48x32 — cozy maroon/brown with seams
  ctx.save();

  // shadow under couch
  ctx.save();
  ctx.globalAlpha = 0.32;
  const sh = ctx.createRadialGradient(x + 24, y + 30, 6, x + 24, y + 30, 26);
  sh.addColorStop(0, "rgba(2,6,23,0.55)");
  sh.addColorStop(1, "rgba(2,6,23,0.0)");
  ctx.fillStyle = sh;
  ctx.beginPath();
  ctx.ellipse(x + 24, y + 30, 20, 5.8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const base = ctx.createLinearGradient(x, y + 10, x + 48, y + 32);
  base.addColorStop(0, "#5B1B22");
  base.addColorStop(0.6, "#3F1218");
  base.addColorStop(1, "#2A0A10");
  ctx.fillStyle = base;
  ctx.beginPath();
  ctx.roundRect(x + 2, y + 12, 44, 18, 6);
  ctx.fill();

  // back cushion
  ctx.fillStyle = "rgba(120, 32, 40, 0.85)";
  ctx.beginPath();
  ctx.roundRect(x + 4, y + 6, 40, 10, 6);
  ctx.fill();

  // seat cushions (2) + seams
  ctx.fillStyle = "rgba(70, 18, 25, 0.92)";
  ctx.beginPath();
  ctx.roundRect(x + 6, y + 16, 18, 10, 5);
  ctx.roundRect(x + 24, y + 16, 18, 10, 5);
  ctx.fill();

  // cushion separation seam (middle)
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = "rgba(226,232,240,0.18)";
  ctx.beginPath();
  ctx.moveTo(x + 24.5, y + 16.5);
  ctx.lineTo(x + 24.5, y + 26.5);
  ctx.stroke();

  // horizontal cushion stitch lines
  ctx.globalAlpha = 0.22;
  ctx.strokeStyle = "rgba(2,6,23,0.35)";
  for (const cx of [x + 6, x + 24]) {
    ctx.beginPath();
    ctx.moveTo(cx + 2.5, y + 20.5);
    ctx.lineTo(cx + 15.5, y + 20.5);
    ctx.stroke();
    ctx.globalAlpha = 0.14;
    ctx.strokeStyle = "rgba(226,232,240,0.18)";
    ctx.beginPath();
    ctx.moveTo(cx + 2.5, y + 19.5);
    ctx.lineTo(cx + 15.5, y + 19.5);
    ctx.stroke();
    ctx.globalAlpha = 0.22;
    ctx.strokeStyle = "rgba(2,6,23,0.35)";
  }

  // armrests
  ctx.globalAlpha = 1;
  ctx.fillStyle = "rgba(45, 10, 14, 0.9)";
  ctx.beginPath();
  ctx.roundRect(x + 1, y + 12, 7, 14, 6);
  ctx.roundRect(x + 40, y + 12, 7, 14, 6);
  ctx.fill();

  // fabric texture speckles
  ctx.save();
  ctx.globalAlpha = 0.10;
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  for (let i = 0; i < 22; i++) {
    const xx = x + 4 + (i * 37) % 40;
    const yy = y + 10 + (i * 19) % 18;
    ctx.fillRect(xx, yy, 1, 1);
  }
  ctx.restore();

  // edge highlight/shadow
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = "rgba(253,230,138,0.18)";
  ctx.fillRect(x + 3, y + 12, 42, 1);
  ctx.globalAlpha = 0.20;
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fillRect(x + 3, y + 29, 42, 1);

  ctx.restore();
}

function drawFridge(ctx: CanvasRenderingContext2D, x: number, y: number) {
  // 16x32 — metallic
  ctx.save();
  const g = ctx.createLinearGradient(x, y, x + 16, y + 32);
  g.addColorStop(0, "#E5E7EB");
  g.addColorStop(0.5, "#BFC7D1");
  g.addColorStop(1, "#8B95A3");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.roundRect(x + 2, y + 2, 12, 28, 3);
  ctx.fill();

  // door split
  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = "rgba(15,23,42,0.25)";
  ctx.beginPath();
  ctx.moveTo(x + 3.5, y + 14.5);
  ctx.lineTo(x + 12.5, y + 14.5);
  ctx.stroke();

  // handle
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = "rgba(15,23,42,0.35)";
  ctx.fillRect(x + 11, y + 6, 1, 10);
  ctx.fillRect(x + 11, y + 18, 1, 8);

  // highlight
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.fillRect(x + 3, y + 4, 1, 24);

  ctx.restore();
}

function drawFilingCabinet(ctx: CanvasRenderingContext2D, x: number, y: number) {
  // 16x32 — gray cabinet next to desks
  ctx.save();
  const g = ctx.createLinearGradient(x, y, x + 16, y + 32);
  g.addColorStop(0, "#AEB7C3");
  g.addColorStop(1, "#6B7280");
  ctx.fillStyle = g;
  ctx.fillRect(x + 2, y + 6, 12, 24);

  ctx.globalAlpha = 0.65;
  ctx.strokeStyle = "rgba(15,23,42,0.45)";
  ctx.strokeRect(x + 2.5, y + 6.5, 11, 23);
  for (let i = 0; i < 3; i++) {
    const yy = y + 8 + i * 7;
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.moveTo(x + 3.5, yy + 6.5);
    ctx.lineTo(x + 12.5, yy + 6.5);
    ctx.stroke();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = "rgba(226,232,240,0.75)";
    ctx.fillRect(x + 7, yy + 5, 2, 1);
  }

  // top-left highlight
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.fillRect(x + 2, y + 6, 1, 24);
  ctx.restore();
}

function drawWaterCooler(ctx: CanvasRenderingContext2D, x: number, y: number) {
  // 16x32 — transparent blue bottle + silver base unit
  ctx.save();

  // shadow under
  ctx.save();
  ctx.globalAlpha = 0.28;
  const sh = ctx.createRadialGradient(x + 8, y + 30, 2, x + 8, y + 30, 12);
  sh.addColorStop(0, "rgba(2,6,23,0.50)");
  sh.addColorStop(1, "rgba(2,6,23,0.0)");
  ctx.fillStyle = sh;
  ctx.beginPath();
  ctx.ellipse(x + 8, y + 30, 7.2, 2.4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // base (metallic)
  const baseG = ctx.createLinearGradient(x + 3, y + 14, x + 13, y + 30);
  baseG.addColorStop(0, "#E2E8F0");
  baseG.addColorStop(0.5, "#B7C0CD");
  baseG.addColorStop(1, "#8892A0");
  ctx.fillStyle = baseG;
  ctx.beginPath();
  ctx.roundRect(x + 3, y + 14, 10, 16, 3);
  ctx.fill();

  // dispenser slot
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = "rgba(15,23,42,0.45)";
  ctx.fillRect(x + 6, y + 18, 4, 2);

  // base highlights
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.fillRect(x + 4, y + 16, 1, 12);
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = "rgba(2,6,23,0.45)";
  ctx.strokeRect(x + 3.5, y + 14.5, 9, 15);
  ctx.globalAlpha = 1;

  // bottle (transparent/blue gradient with outline)
  ctx.save();
  const bottleG = ctx.createLinearGradient(x + 4, y + 3, x + 12, y + 15);
  bottleG.addColorStop(0, "rgba(186, 230, 253, 0.55)");
  bottleG.addColorStop(0.55, "rgba(56, 189, 248, 0.28)");
  bottleG.addColorStop(1, "rgba(37, 99, 235, 0.30)");
  ctx.fillStyle = bottleG;
  ctx.beginPath();
  ctx.roundRect(x + 4, y + 3, 8, 12, 4);
  ctx.fill();

  // inner water level (darker)
  ctx.globalAlpha = 0.55;
  const waterG = ctx.createLinearGradient(x, y + 8, x, y + 15);
  waterG.addColorStop(0, "rgba(59,130,246,0.10)");
  waterG.addColorStop(1, "rgba(59,130,246,0.35)");
  ctx.fillStyle = waterG;
  ctx.fillRect(x + 5, y + 9, 6, 5);

  // bottle outline + rim
  ctx.globalAlpha = 0.40;
  ctx.strokeStyle = "rgba(15,23,42,0.35)";
  ctx.strokeRect(x + 4.5, y + 3.5, 7, 11);
  ctx.globalAlpha = 0.28;
  ctx.strokeStyle = "rgba(226,232,240,0.35)";
  ctx.beginPath();
  ctx.arc(x + 8, y + 5, 3.2, 0, Math.PI * 2);
  ctx.stroke();

  // shine
  ctx.globalAlpha = 0.30;
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.fillRect(x + 5, y + 5, 1, 9);
  ctx.restore();

  ctx.restore();
}

function drawPainting(ctx: CanvasRenderingContext2D, x: number, y: number) {
  // 32x16 — landscape in wooden frame
  ctx.save();
  const frame = ctx.createLinearGradient(x, y, x, y + 16);
  frame.addColorStop(0, "#7B4A22");
  frame.addColorStop(1, "#4E2B12");
  ctx.fillStyle = frame;
  ctx.fillRect(x + 1, y + 1, 30, 14);

  // matte
  ctx.fillStyle = "rgba(226,232,240,0.12)";
  ctx.fillRect(x + 3, y + 3, 26, 10);

  // sky
  const sky = ctx.createLinearGradient(x, y + 3, x, y + 13);
  sky.addColorStop(0, "#60A5FA");
  sky.addColorStop(1, "#1E3A8A");
  ctx.fillStyle = sky;
  ctx.fillRect(x + 4, y + 4, 24, 4);
  // hills
  ctx.fillStyle = "#14532D";
  ctx.beginPath();
  ctx.moveTo(x + 4, y + 13);
  ctx.quadraticCurveTo(x + 12, y + 8, x + 20, y + 13);
  ctx.quadraticCurveTo(x + 24, y + 10, x + 28, y + 13);
  ctx.closePath();
  ctx.fill();
  // sun
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = "rgba(253,230,138,0.9)";
  ctx.beginPath();
  ctx.arc(x + 9, y + 6, 1.6, 0, Math.PI * 2);
  ctx.fill();

  // frame highlight
  ctx.globalAlpha = 0.25;
  ctx.strokeStyle = "rgba(253,230,138,0.35)";
  ctx.strokeRect(x + 1.5, y + 1.5, 29, 13);
  ctx.restore();
}

function drawWallClock(ctx: CanvasRenderingContext2D, x: number, y: number) {
  // 16x16 — analog
  ctx.save();
  const now = new Date();
  const hh = now.getHours() % 12;
  const mm = now.getMinutes();

  // face
  ctx.fillStyle = "rgba(226,232,240,0.85)";
  ctx.beginPath();
  ctx.arc(x + 8, y + 8, 6.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(15,23,42,0.55)";
  ctx.lineWidth = 1;
  ctx.stroke();

  // ticks
  ctx.globalAlpha = 0.65;
  ctx.strokeStyle = "rgba(15,23,42,0.45)";
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
    const r0 = 5.0;
    const r1 = i % 3 === 0 ? 6.0 : 5.7;
    ctx.beginPath();
    ctx.moveTo(x + 8 + Math.cos(a) * r0, y + 8 + Math.sin(a) * r0);
    ctx.lineTo(x + 8 + Math.cos(a) * r1, y + 8 + Math.sin(a) * r1);
    ctx.stroke();
  }

  // hands
  const aM = (mm / 60) * Math.PI * 2 - Math.PI / 2;
  const aH = ((hh + mm / 60) / 12) * Math.PI * 2 - Math.PI / 2;
  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = "rgba(15,23,42,0.75)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(x + 8, y + 8);
  ctx.lineTo(x + 8 + Math.cos(aH) * 3.2, y + 8 + Math.sin(aH) * 3.2);
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + 8, y + 8);
  ctx.lineTo(x + 8 + Math.cos(aM) * 4.7, y + 8 + Math.sin(aM) * 4.7);
  ctx.stroke();

  // center
  ctx.fillStyle = "rgba(15,23,42,0.75)";
  ctx.beginPath();
  ctx.arc(x + 8, y + 8, 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawWorldStatic(
  ctx: CanvasRenderingContext2D,
  sprites: Sprites,
  floor: FloorKind[][],
  props: Prop[]
) {
  // floors (canvas API — richer detail than 16x16 pixel sprites)
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const kind = floor[r][c];
      const x = c * TILE;
      const y = r * TILE;
      if (kind === "wood") drawFloorWoodTile(ctx, x, y, c, r);
      else if (kind === "beige") drawFloorKitchenTile(ctx, x, y, c, r);
      else drawFloorCarpetTile(ctx, x, y, c, r);
    }
  }

  // floor details (subtle borders, welcome mats, speckles)
  const isWallTile = (tx: number, ty: number) => {
    if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) return false;
    if (tx === 0 || ty === 0 || tx === COLS - 1 || ty === ROWS - 1) return true;
    if (tx === SPLIT_X && Math.abs(ty - DOOR_MAIN_RIGHT.ty) > 1) return true;
    if (ty === SPLIT_Y && tx >= SPLIT_X && Math.abs(tx - DOOR_KITCHEN_LOUNGE.tx) > 1) return true;
    if (ty === BOSS_WALL_Y && tx < SPLIT_X && Math.abs(tx - DOOR_BOSS.tx) > 1) return true;
    // boss room enclosure
    if (tx === 1 && ty > 0 && ty < BOSS_WALL_Y) return true;
    if (tx === SPLIT_X - 1 && ty > 0 && ty < BOSS_WALL_Y) return true;
    if (ty === 1 && tx > 0 && tx < SPLIT_X - 1) return true;
    return false;
  };

  // depth shading along walls
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (isWallTile(c, r)) continue;
      const x = c * TILE;
      const y = r * TILE;
      // speckles (tiny floor clutter)
      const h = (c * 37 + r * 19) % 97;
      if (h === 0 || h === 1) {
        ctx.save();
        ctx.globalAlpha = 0.10;
        ctx.fillStyle = "#0b1220";
        ctx.fillRect(x + 3, y + 10, 1, 1);
        ctx.fillRect(x + 11, y + 5, 1, 1);
        ctx.restore();
      }

      // border shadow
      if (isWallTile(c, r - 1)) {
        ctx.save();
        ctx.globalAlpha = 0.12;
        ctx.fillStyle = "#0b1220";
        ctx.fillRect(x, y, 16, 3);
        ctx.restore();
      }
      if (isWallTile(c - 1, r)) {
        ctx.save();
        ctx.globalAlpha = 0.10;
        ctx.fillStyle = "#0b1220";
        ctx.fillRect(x, y, 3, 16);
        ctx.restore();
      }
    }
  }

  // welcome mats near doors (inside tiles)
  const drawMat = (tx: number, ty: number, label: string) => {
    const x = tx * TILE;
    const y = ty * TILE;
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = "rgba(15,23,42,0.65)";
    ctx.fillRect(x + 2, y + 5, 12, 9);
    ctx.strokeStyle = "rgba(253,230,138,0.35)";
    ctx.strokeRect(x + 2.5, y + 5.5, 11, 8);
    ctx.font = "6px ui-monospace, SFMono-Regular, Menlo, Monaco";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(226,232,240,0.9)";
    ctx.fillText(label, x + 8, y + 10);
    ctx.restore();
  };
  drawMat(DOOR_MAIN_RIGHT.tx - 1, DOOR_MAIN_RIGHT.ty, "HI");
  drawMat(DOOR_MAIN_RIGHT.tx + 1, DOOR_MAIN_RIGHT.ty, "YO");
  drawMat(DOOR_BOSS.tx, DOOR_BOSS.ty + 1, "B");
  // entrance mat (bottom wall)
  // Welcome mat removed - placed plaque on wall instead to avoid floor furniture overlap

  // walls (canvas API: charcoal/navy with panel lines + depth)
  const wall = (tx: number, ty: number) => {
    drawWallTile(ctx, tx * TILE, ty * TILE, tx, ty);
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
    if (Math.abs(y - DOOR_MAIN_RIGHT.ty) <= 1) continue;
    wall(SPLIT_X, y);
  }
  for (let x = SPLIT_X; x < COLS; x++) {
    if (Math.abs(x - DOOR_KITCHEN_LOUNGE.tx) <= 1) continue;
    wall(x, SPLIT_Y);
  }
  for (let x = 0; x < SPLIT_X; x++) {
    if (Math.abs(x - DOOR_BOSS.tx) <= 1) continue;
    wall(x, BOSS_WALL_Y);
  }
  // boss room enclosure
  for (let y = 1; y < BOSS_WALL_Y; y++) {
    wall(1, y);
    wall(SPLIT_X - 1, y);
  }
  for (let x = 1; x < SPLIT_X - 1; x++) wall(x, 1);

  // baseboards (a thin highlight at wall/floor junction)
  for (let ty = 0; ty < ROWS; ty++) {
    for (let tx = 0; tx < COLS; tx++) {
      if (!isWallTile(tx, ty)) continue;
      // bottom edge when open floor below
      if (!isWallTile(tx, ty + 1)) {
        ctx.save();
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = "#94a3b8";
        ctx.fillRect(tx * TILE, ty * TILE + 15, 16, 1);
        ctx.restore();
      }
    }
  }

  // --- Wallpaper / accent walls (visual overlays on wall tiles) ---
  // Boss room: dark wood paneling stripes on enclosure walls
  ctx.save();
  for (let y = 1; y < BOSS_WALL_Y; y++) {
    const stripe = y % 2 === 0;
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = stripe ? "rgba(74,44,20,0.75)" : "rgba(48,28,14,0.75)";
    // left wall
    ctx.fillRect(1 * TILE, y * TILE, 16, 16);
    // right wall
    ctx.fillRect((SPLIT_X - 1) * TILE, y * TILE, 16, 16);
  }
  for (let x = 1; x < SPLIT_X - 1; x++) {
    const stripe = x % 2 === 0;
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = stripe ? "rgba(74,44,20,0.75)" : "rgba(48,28,14,0.75)";
    ctx.fillRect(x * TILE, 1 * TILE, 16, 16);
  }
  ctx.restore();

  // Kitchen: subway tile grid on top wall section behind counter
  ctx.save();
  for (let x = 12; x <= 18; x++) {
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.fillRect(x * TILE, 0, 16, 16);
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = "rgba(148,163,184,0.35)";
    ctx.lineWidth = 1;
    // small grid
    ctx.beginPath();
    ctx.moveTo(x * TILE + 0.5, 0.5);
    ctx.lineTo(x * TILE + 15.5, 0.5);
    ctx.moveTo(x * TILE + 0.5, 8.5);
    ctx.lineTo(x * TILE + 15.5, 8.5);
    ctx.moveTo(x * TILE + 8.5, 0.5);
    ctx.lineTo(x * TILE + 8.5, 15.5);
    ctx.stroke();
  }
  ctx.restore();

  // Lounge: feature wall behind TV (navy band)
  // TV is mounted on the lounge split wall (y=SPLIT_Y) at tx=12.
  ctx.save();
  ctx.globalAlpha = 0.65;
  ctx.fillStyle = "rgba(30,41,59,0.82)";
  // a slightly wider panel around the TV so it reads as a dedicated media wall
  ctx.fillRect(11 * TILE, SPLIT_Y * TILE, 6 * TILE, 5 * TILE);
  ctx.restore();

  // Main office: minimal two-tone stripe on bottom wall area
  ctx.save();
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = "rgba(148,163,184,0.18)";
  ctx.fillRect(1 * TILE, (ROWS - 1) * TILE, (SPLIT_X - 2) * TILE, 16);
  ctx.restore();

  // --- Entrance (bottom wall): glass door + frame ---
  {
    const doorTx = 7;
    const x = doorTx * TILE;
    const y = (ROWS - 1) * TILE;
    ctx.save();
    // frame
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = "rgba(15,23,42,0.85)";
    ctx.fillRect(x - 1, y - 16, 18, 32);
    // glass
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = "rgba(34,211,238,0.55)";
    ctx.fillRect(x + 2, y - 13, 12, 26);
    // shine
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.fillRect(x + 4, y - 12, 2, 24);
    // handle
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = "rgba(226,232,240,0.9)";
    ctx.fillRect(x + 11, y + 1, 1, 5);
    ctx.restore();
  }

  // props (big first)
  const drawAt = (spr: Sprite, tx: number, ty: number) => {
    ctx.drawImage(spr.canvas, tx * TILE, ty * TILE);
  };

  // furniture shadows (subtle, consistent light from top-left)
  for (const pr of props) {
    const x = pr.tx * TILE;
    const y = pr.ty * TILE;
    let w = 16;
    let h = 10;
    let ox = 2;
    let oy = 10;

    if (pr.kind === "desk") { w = 48; h = 16; ox = 6; oy = 18; }
    if (pr.kind === "bookshelf") { w = 32; h = 14; ox = 4; oy = 18; }
    if (pr.kind === "vending") { w = 32; h = 16; ox = 6; oy = 30; }
    if (pr.kind === "couch") { w = 48; h = 16; ox = 8; oy = 22; }
    if (pr.kind === "cooler" || pr.kind === "waterDispenser" || pr.kind === "fridge") { w = 16; h = 12; ox = 4; oy = 20; }
    if (pr.kind === "coffeeTable" || pr.kind === "trash" || pr.kind === "plant" || pr.kind === "plantDeco" || pr.kind === "playstation") { w = 16; h = 9; ox = 4; oy = 10; }
    if (pr.kind === "counter") { w = 32; h = 10; ox = 6; oy = 12; }
    if (pr.kind === "filingCabinet") { w = 16; h = 12; ox = 4; oy = 20; }

    // only cast shadow for floor-standing props
    const casts = [
      "desk",
      "bookshelf",
      "plant",
      "plantDeco",
      "vending",
      "couch",
      "cooler",
      "waterDispenser",
      "fridge",
      "trash",
      "coffeeTable",
      "counter",
      "playstation",
      "filingCabinet",
    ].includes(pr.kind as any);

    if (!casts) continue;

    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = "rgba(2,6,23,0.9)";
    ctx.beginPath();
    ctx.ellipse(x + ox + w / 2, y + oy + h / 2, w / 2, h / 2.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // rugs first (sit under furniture)
  for (const pr of props) {
    if (pr.kind === "rug") drawAt(sprites.rug, pr.tx, pr.ty);
  }

  // main furniture / floor props
  for (const pr of props) {
    if (pr.kind === "execDesk") {
      const x = pr.tx * TILE;
      const y = pr.ty * TILE;
      ctx.save();
      ctx.globalAlpha = 0.95;
      // dark walnut top (3x2 tiles)
      ctx.fillStyle = "#5b3a1e";
      ctx.fillRect(x, y, 48, 32);
      // edge highlight
      ctx.globalAlpha = 0.65;
      ctx.fillStyle = "rgba(253,230,138,0.18)";
      ctx.fillRect(x, y, 48, 3);
      // inset leather blotter
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = "rgba(15,23,42,0.45)";
      ctx.fillRect(x + 10, y + 10, 28, 12);
      // legs
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = "#3b2a1a";
      ctx.fillRect(x + 2, y + 26, 6, 6);
      ctx.fillRect(x + 40, y + 26, 6, 6);
      ctx.restore();
    }
    if (pr.kind === "visitorSeat") {
      const x = pr.tx * TILE;
      const y = pr.ty * TILE;
      ctx.save();
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = "rgba(30,41,59,0.65)";
      ctx.fillRect(x + 3, y + 7, 10, 7);
      ctx.fillStyle = "rgba(226,232,240,0.35)";
      ctx.fillRect(x + 3, y + 5, 10, 2);
      ctx.fillStyle = "rgba(15,23,42,0.75)";
      ctx.fillRect(x + 4, y + 13, 2, 2);
      ctx.fillRect(x + 10, y + 13, 2, 2);
      ctx.restore();
    }

    if (pr.kind === "desk") {
      // chair sits behind desk (except boss desk which has its own exec chair)
      if (pr.owner !== "yuri") drawChair(ctx, (pr.tx + 1) * TILE, (pr.ty - 1) * TILE);
      drawDesk(ctx, pr.tx * TILE, pr.ty * TILE);
    }
    if (pr.kind === "filingCabinet") drawFilingCabinet(ctx, pr.tx * TILE, pr.ty * TILE);
    if (pr.kind === "bookshelf") drawBookshelf(ctx, pr.tx * TILE, pr.ty * TILE, pr.tx * 31 + pr.ty * 17);
    if (pr.kind === "vending") drawVendingMachine(ctx, pr.tx * TILE, pr.ty * TILE);
    if (pr.kind === "couch") drawCouch(ctx, pr.tx * TILE, pr.ty * TILE);
    if (pr.kind === "fridge") drawFridge(ctx, pr.tx * TILE, pr.ty * TILE);
    if (pr.kind === "cooler") drawWaterCooler(ctx, pr.tx * TILE, pr.ty * TILE);
    if (pr.kind === "waterDispenser") drawWaterCooler(ctx, pr.tx * TILE, pr.ty * TILE);

    // smaller props can stay as sprite-based
    if (pr.kind === "coffeeTable") drawAt(sprites.coffeeTable, pr.tx, pr.ty);
    if (pr.kind === "counter") drawAt(sprites.counter, pr.tx, pr.ty);
    if (pr.kind === "tv") drawAt(sprites.tv, pr.tx, pr.ty);
    if (pr.kind === "playstation") drawAt(sprites.playstation, pr.tx, pr.ty);
    if (pr.kind === "trash") drawAt(sprites.trash, pr.tx, pr.ty);
  }

  // plants on top
  for (const pr of props) {
    if (pr.kind === "plant") drawAt(sprites.plant, pr.tx, pr.ty);
    if (pr.kind === "plantDeco") {
      const x = pr.tx * TILE;
      const y = pr.ty * TILE;
      ctx.save();
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = "rgba(15,23,42,0.65)";
      ctx.fillRect(x + 5, y + 11, 6, 4); // pot
      ctx.fillStyle = "rgba(34,197,94,0.85)";
      ctx.fillRect(x + 6, y + 6, 1, 6);
      ctx.fillRect(x + 8, y + 5, 1, 7);
      ctx.fillRect(x + 10, y + 7, 1, 5);
      ctx.fillStyle = "rgba(34,197,94,0.55)";
      ctx.fillRect(x + 7, y + 8, 1, 5);
      ctx.restore();
    }
    if (pr.kind === "execChair") {
      const x = pr.tx * TILE;
      const y = pr.ty * TILE;
      ctx.save();
      ctx.globalAlpha = 0.95;
      // backrest
      ctx.fillStyle = "rgba(51,33,24,0.9)";
      ctx.fillRect(x + 4, y + 2, 8, 8);
      // seat
      ctx.fillStyle = "rgba(71,44,32,0.9)";
      ctx.fillRect(x + 3, y + 10, 10, 5);
      // small studs highlight
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = "rgba(253,230,138,0.35)";
      ctx.fillRect(x + 5, y + 4, 1, 1);
      ctx.fillRect(x + 10, y + 4, 1, 1);
      ctx.restore();
    }
  }

  // wall decor / ceiling fixtures
  for (const pr of props) {
    if (pr.kind === "painting") drawPainting(ctx, pr.tx * TILE, pr.ty * TILE);
    if (pr.kind === "whiteboard") drawAt(sprites.whiteboard, pr.tx, pr.ty);
    if (pr.kind === "frame") drawAt(sprites.frame, pr.tx, pr.ty);
    // wallClock is dynamic (hands move) and is drawn in drawWorldDynamic()
    if (pr.kind === "ceilingLight") drawAt(sprites.ceilingLight, pr.tx, pr.ty);

    if (pr.kind === "galleryFrame") {
      const x = pr.tx * TILE;
      const y = pr.ty * TILE;
      ctx.save();
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = "rgba(2,6,23,0.65)";
      ctx.fillRect(x + 1, y + 1, pr.w, pr.h);
      ctx.strokeStyle = "rgba(226,232,240,0.35)";
      ctx.strokeRect(x + 1.5, y + 1.5, pr.w - 1, pr.h - 1);
      // matte
      ctx.globalAlpha = 0.75;
      ctx.fillStyle = "rgba(226,232,240,0.10)";
      ctx.fillRect(x + 3, y + 3, pr.w - 4, pr.h - 4);
      ctx.restore();
    }

    if (pr.kind === "shelfDecor") {
      const x = pr.tx * TILE;
      const y = pr.ty * TILE;
      ctx.save();
      ctx.globalAlpha = 0.95;
      if (pr.variant === "globe") {
        ctx.fillStyle = "rgba(56,189,248,0.35)";
        ctx.beginPath();
        ctx.arc(x + 6, y + 7, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(226,232,240,0.35)";
        ctx.stroke();
        ctx.fillStyle = "rgba(15,23,42,0.75)";
        ctx.fillRect(x + 4, y + 12, 6, 2);
      } else {
        // trophy
        ctx.fillStyle = "rgba(253,230,138,0.75)";
        ctx.fillRect(x + 10, y + 6, 4, 4);
        ctx.fillRect(x + 11, y + 10, 2, 3);
        ctx.fillStyle = "rgba(15,23,42,0.75)";
        ctx.fillRect(x + 10, y + 13, 4, 2);
      }
      ctx.restore();
    }

    if (pr.kind === "standingLamp") {
      const x = pr.tx * TILE;
      const y = pr.ty * TILE;
      ctx.save();
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = "rgba(15,23,42,0.75)";
      ctx.fillRect(x + 7, y + 3, 2, 11);
      ctx.fillStyle = "rgba(226,232,240,0.75)";
      ctx.fillRect(x + 4, y + 2, 8, 3);
      // glow
      ctx.globalAlpha = 0.35;
      ctx.shadowBlur = 10;
      ctx.shadowColor = "rgba(253,230,138,0.8)";
      ctx.fillStyle = "rgba(253,230,138,0.25)";
      ctx.beginPath();
      ctx.arc(x + 8, y + 4, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    if (pr.kind === "plaqueSign") {
      const x = pr.tx * TILE;
      const y = pr.ty * TILE;
      ctx.save();
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = "rgba(2,6,23,0.75)";
      ctx.strokeStyle = "rgba(56,189,248,0.35)";
      ctx.lineWidth = 1;
      const w = Math.max(80, Math.ceil(pr.text.length * 5.5) + 20);
      const h = 14;
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, 6);
      ctx.fill();
      ctx.stroke();
      ctx.font = "8px ui-monospace, SFMono-Regular, Menlo, Monaco";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(226,232,240,0.9)";
      ctx.fillText(pr.text, x + 10, y + h / 2 + 0.5);
      ctx.restore();
    }
  }

  // neon sign (after feature wall, before characters)
  for (const pr of props) {
    if (pr.kind !== "neonSign") continue;
    const x = pr.tx * TILE;
    const y = pr.ty * TILE;
    const text = pr.text ?? "GAME ON";
    ctx.save();
    ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, Monaco";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.globalCompositeOperation = "lighter";
    // glow layers
    ctx.shadowBlur = 12;
    ctx.shadowColor = "rgba(168,85,247,0.9)";
    ctx.fillStyle = "rgba(168,85,247,0.9)";
    ctx.globalAlpha = 0.55;
    ctx.fillText(text, x + 2, y + 2);
    ctx.shadowBlur = 6;
    ctx.shadowColor = "rgba(34,211,238,0.9)";
    ctx.fillStyle = "rgba(34,211,238,0.95)";
    ctx.globalAlpha = 0.85;
    ctx.fillText(text, x + 1, y + 1);
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(226,232,240,0.95)";
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  // warm light pools near ceiling lights
  for (const pr of props) {
    if (pr.kind !== "ceilingLight") continue;
    const cx = pr.tx * TILE + 8;
    const cy = pr.ty * TILE + 10;
    const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, 34);
    g.addColorStop(0, "rgba(253,230,138,0.20)");
    g.addColorStop(1, "rgba(253,230,138,0.0)");
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, 34, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // monitors are dynamic (online glow + scrolling code) and are drawn in drawWorldDynamic()

  // Room plaques intentionally removed — keep the scene minimal/clean.
}

function drawWorldDynamic(
  ctx: CanvasRenderingContext2D,
  sprites: Sprites,
  props: Prop[],
  live: LiveAgent[],
  ms: number
) {
  // monitors (glow + tiny scrolling code when active/busy)
  const liveBy = new Map(live.map((a) => [a.key, a] as const));
  for (const pr of props) {
    if (pr.kind !== "desk" || !pr.owner) continue;
    const a = liveBy.get(pr.owner);
    const on = a && (a.status === "active" || a.status === "busy");

    const seat = SEATS[pr.owner];
    const px = seat.tx * TILE + 2;
    const py = pr.ty * TILE + 2;

    if (on) {
      ctx.save();
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = "rgba(56,189,248,1)";
      ctx.fillRect(px - 3, py - 3, 18, 14);
      ctx.restore();
    }

    ctx.drawImage(sprites.monitor.canvas, px, py);

    if (on && a) {
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

  // wall clocks (hands depend on current time)
  for (const pr of props) {
    if (pr.kind === "wallClock") drawWallClock(ctx, pr.tx * TILE, pr.ty * TILE);
  }
}

function buildStaticLayer(sprites: Sprites, floor: FloorKind[][], props: Prop[]) {
  const canvas = document.createElement("canvas");
  canvas.width = INTERNAL_W;
  canvas.height = INTERNAL_H;
  const ctx = canvas.getContext("2d", { alpha: true })!;
  ctx.imageSmoothingEnabled = false;
  drawWorldStatic(ctx, sprites, floor, props);
  return canvas;
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

  // ambient audio
  const [muted, setMuted] = useState(true);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const spritesRef = useRef<Sprites | null>(null);
  const charImgsRef = useRef<Record<RosterKey, HTMLImageElement> | null>(null);
  const staticLayerRef = useRef<HTMLCanvasElement | null>(null);

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
        activity: null,
        activityBubble: null,
        activityUntilMs: 0,
        chatWith: null,
        lastMoveMs: 0,
        lastPos: { x: 0, y: 0 },
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

    // Background is static; cache it to avoid redrawing every tile every frame.
    staticLayerRef.current = null;

    const tick = (ms: number) => {
      rafRef.current = requestAnimationFrame(tick);
      if (ms - (lastFrameRef.current || 0) < FRAME_MS) return;

      const last = lastTickRef.current || ms;
      const dt = clamp((ms - last) / 1000, 0, 0.08);
      lastTickRef.current = ms;
      lastFrameRef.current = ms;

      // (background drawn from cached layer)

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

      if (!staticLayerRef.current) {
        staticLayerRef.current = buildStaticLayer(sprites, floor, props);
      }
      // Draw cached background
      ctx.drawImage(staticLayerRef.current, 0, 0);

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
          rt.activity = null;
          rt.activityBubble = null;
          rt.activityUntilMs = 0;
          rt.chatWith = null;
          continue;
        }

        // Only type at desk when there's an actual running task, not just "active" (online)
        const wantsWork = runningSet.has(a.key) || a.status === "busy";

        // target selection (do not let agents choose a rest point near doors)
        if (wantsWork) {
          // working agents always return to desk; cancel any idle activity
          rt.activity = null;
          rt.chatWith = null;
          rt.activityBubble = null;
          rt.activityUntilMs = 0;

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
          // idle: ~40% at desk, ~60% doing small activities around the office.
          const nearTarget = Math.hypot(rt.target.x - rt.x, rt.target.y - rt.y) < 2.0;

          // finish an activity
          if (rt.activity && rt.activityUntilMs > 0 && ms >= rt.activityUntilMs) {
            rt.activity = null;
            rt.chatWith = null;
            rt.activityBubble = null;
            rt.activityUntilMs = 0;
            rt.nextDecisionMs = ms + randBetween(1200, 3800); // stagger so agents don't sync up
          }

          // (door-shove removed — agents are allowed to pass through doors freely)

          // decide a new idle activity only when we are not already doing one
          if (
            !rt.activity &&
            rt.path.length === 0 &&
            (rt.nextDecisionMs === 0 || ms >= rt.nextDecisionMs) &&
            nearTarget
          ) {
            const doActivity = Math.random() < 0.6;
            const kind: ActivityKind =
              !doActivity || Math.random() < 0.4
                ? "desk"
                : (() => {
                    const r = Math.random();
                    if (r < 0.18) return "coffee";
                    if (r < 0.33) return "reading";
                    if (r < 0.48) return "gaming";
                    if (r < 0.62) return "watching_tv";
                    if (r < 0.78) return "chatting";
                    return "wandering";
                  })();

            rt.activity = kind;
            rt.activityBubble = null;
            rt.activityUntilMs = 0;
            rt.chatWith = null;

            // choose a destination tile
            let destTile: { tx: number; ty: number } | null = null;

            if (kind === "desk") {
              const seat = SEATS[a.key];
              destTile = { tx: seat.tx, ty: seat.ty };
              rt.goingToSeat = true;
            }

            // ☕ Coffee: stand in front of cooler (28,2) or counter (22,2) or vending (18,2)
            if (kind === "coffee") {
              // ☕ Stand directly at the counter/cooler/vending
              const spots = [
                { tx: 18, ty: 4 },  // below cooler
                { tx: 15, ty: 3 },  // below counter
                { tx: 13, ty: 4 },  // below vending
              ];
              destTile = spots[Math.floor(Math.random() * spots.length)];
            }
            // 🎮 Gaming / 📺 Watching TV: stand on the walkable tiles in FRONT of the couch, facing the wall-mounted TV.
            // (Couch tiles are blocked for pathing, so we target the row in front of it.)
            if (kind === "gaming") destTile = { tx: 12, ty: 13 };
            if (kind === "watching_tv") destTile = { tx: 11, ty: 13 };
            // 📖 Reading: stand in front of a bookshelf
            if (kind === "reading") {
              const spots = [
                { tx: 1, ty: 9 },   // in front of main-office bookshelf (1,7)
                { tx: 17, ty: 11 }, // in front of lounge bookshelf (17,9)
              ];
              const spot = spots[Math.floor(Math.random() * spots.length)];
              destTile = pickNearbyWalkable(blocked, spot, 1, false);
            }
            if (kind === "wandering") destTile = pickRandomWalkable(blocked);

            if (kind === "chatting") {
              const candidates = live
                .filter((b) => b.key !== a.key)
                .filter((b) => b.status !== "offline" || b.key === "yuri")
                .filter((b) => {
                  const brt = runtimeRef.current[b.key];
                  if (!brt) return false;
                  const bWantsWork = runningSet.has(b.key) || b.status === "busy";
                  if (bWantsWork) return false;
                  if (brt.anim === "walk" || brt.path.length) return false;
                  if (brt.activity === "chatting") return false;
                  return true;
                });

              const partner = candidates[Math.floor(Math.random() * candidates.length)];
              const prt = partner ? runtimeRef.current[partner.key] : null;

              if (partner && prt) {
                const endMs = ms + randBetween(6500, 11000);

                // partner stays put and joins chat
                prt.activity = "chatting";
                prt.chatWith = a.key;
                prt.activityBubble = null;
                prt.activityUntilMs = endMs;
                prt.nextDecisionMs = endMs + randBetween(1200, 3200);

                rt.chatWith = partner.key;
                rt.activityUntilMs = endMs;
                rt.nextDecisionMs = endMs + randBetween(1200, 3200);

                const bTile = toTile(prt.x, prt.y);
                destTile = pickNearbyWalkable(blocked, bTile, 1);
              } else {
                // no partner available; fallback
                rt.activity = "wandering";
                destTile = pickRandomWalkable(blocked);
              }
            }

            if (destTile) {
              const dest = tileCenter(destTile.tx, destTile.ty);
              rt.path = aStar(blocked, { x: rt.x, y: rt.y }, dest);
              rt.target = dest;
              rt.anim = rt.path.length ? "walk" : "idle";

              // fallback: if path not found, cancel activity and go back to desk
              if (rt.path.length === 0) {
                rt.activity = "desk";
                rt.chatWith = null;
                const seat = SEATS[a.key];
                if (seat) {
                  const seatDest = tileCenter(seat.tx, seat.ty);
                  rt.path = aStar(blocked, { x: rt.x, y: rt.y }, seatDest);
                  rt.target = seatDest;
                  rt.goingToSeat = true;
                  rt.anim = rt.path.length ? "walk" : "idle";
                }
              }
            }

            // next decision only after completing an activity (or if we fail to path)
            if (!rt.path.length) {
              rt.nextDecisionMs = ms + randBetween(2500, 7000);
            }
          }

          // if not moving and not working, idle anim
          if (rt.path.length === 0) {
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
            // arrived at final destination
            if (rt.goingToSeat) {
              // reached desk/seat during idle
              const seat = SEATS[a.key];
              rt.dir = seat.face;
              rt.anim = "idle";

              if (rt.activity === "desk" && rt.activityUntilMs === 0) {
                // hang at desk (no bubble)
                rt.activityBubble = null;
                rt.activityUntilMs = ms + randBetween(4500, 11000);
              }

              rt.nextDecisionMs = ms + randBetween(5500, 12000);
              rt.goingToSeat = false;
            } else {
              // arrived at an activity spot
              rt.anim = "idle";

              if (rt.activity && rt.activityUntilMs === 0) {
                let bubble: string | null = null;
                let dur = 0;

                if (rt.activity === "coffee") {
                  bubble = "☕";
                  dur = randBetween(3000, 5000);
                  rt.dir = "up"; // face the counter/cooler
                }
                if (rt.activity === "gaming") {
                  bubble = "🎮";
                  dur = randBetween(5000, 10000);
                  rt.dir = "up"; // face the TV/PlayStation
                }
                if (rt.activity === "watching_tv") {
                  bubble = "📺";
                  dur = randBetween(5000, 9000);
                  rt.dir = "up"; // face the TV
                }
                if (rt.activity === "reading") {
                  bubble = "📖";
                  dur = randBetween(4000, 8000);
                  rt.dir = "up"; // face the bookshelf
                }
                if (rt.activity === "wandering") {
                  bubble = null;
                  dur = randBetween(1000, 2400);
                }
                if (rt.activity === "chatting") {
                  bubble = null; // handled by chat alternation below
                  dur = 0;
                }

                rt.activityBubble = bubble;
                if (dur > 0) {
                  rt.activityUntilMs = ms + dur;
                }
                // If dur === 0 (chatting), it was pre-seeded.
              }
            }
          }
        }

        // keep in bounds
        rt.x = clamp(rt.x, 8, INTERNAL_W - 8);
        rt.y = clamp(rt.y, 24, INTERNAL_H - 8);

        // Track movement
        const movedDist = Math.hypot(rt.x - rt.lastPos.x, rt.y - rt.lastPos.y);
        if (movedDist > 2) {
          rt.lastMoveMs = ms;
          rt.lastPos = { x: rt.x, y: rt.y };
        }

        // chatting: face partner + alternate 💬 bubbles
        if (rt.activity === "chatting" && rt.chatWith && rt.activityUntilMs > ms) {
          const other = runtimeRef.current[rt.chatWith];
          if (!other || other.activity !== "chatting" || other.chatWith !== a.key) {
            rt.activity = null;
            rt.chatWith = null;
            rt.activityBubble = null;
            rt.activityUntilMs = 0;
          } else if (rt.path.length === 0 && other.path.length === 0) {
            const dx = other.x - rt.x;
            const dy = other.y - rt.y;
            if (Math.hypot(dx, dy) > 1.5 && Math.hypot(dx, dy) < 42) {
              rt.dir = dirFromDelta(dx, dy);
              other.dir = dirFromDelta(-dx, -dy);
            }

            const phase = Math.floor(ms / 900) % 2;
            const aIsFirst = a.key < rt.chatWith; // stable tie-breaker
            const aSpeaks = (phase === 0) === aIsFirst;
            rt.activityBubble = aSpeaks ? "💬" : null;
            other.activityBubble = aSpeaks ? null : "💬";

            // keep bubbles alive until the chat ends
            rt.activityUntilMs = Math.max(rt.activityUntilMs, other.activityUntilMs);
            other.activityUntilMs = rt.activityUntilMs;
          }
        }

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

      // dynamic overlays (monitors, wall clocks)
      drawWorldDynamic(ctx, sprites, props, live, ms);
      drawKitchenClock(ctx);
      drawDustMotes(ctx, props, ms);

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

      // Social interaction: when 2 idle agents are close, show chat bubbles
      for (let i = 0; i < drawList.length; i++) {
        for (let j = i + 1; j < drawList.length; j++) {
          const a = drawList[i], b = drawList[j];
          if (!a.rt || !b.rt) continue;
          if (a.rt.anim === "work" || b.rt.anim === "work") continue;
          if (a.rt.anim === "walk" || b.rt.anim === "walk") continue;
          if (a.rt.activity || b.rt.activity) continue;
          const dist = Math.hypot(a.rt.x - b.rt.x, a.rt.y - b.rt.y);
          if (dist < 28 && dist > 3) {
            // Close and both idle — trigger chat
            if (!a.rt.activityBubble && ms > a.rt.activityUntilMs) {
              a.rt.activityBubble = "💬";
              a.rt.activityUntilMs = ms + randBetween(3000, 6000);
            }
            if (!b.rt.activityBubble && ms > b.rt.activityUntilMs) {
              b.rt.activityBubble = "💬";
              b.rt.activityUntilMs = ms + randBetween(3000, 6000);
            }
          }
        }
      }

      // Draw activity/chat bubbles
      for (const { rt } of drawList) {
        if (!rt || !rt.activityBubble) continue;
        if (ms > rt.activityUntilMs) {
          rt.activityBubble = null;
          continue;
        }
        // Small rounded bubble above character
        const bx = Math.round(rt.x);
        const by = Math.round(rt.y - 34);
        ctx.save();
        ctx.font = "10px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        // bubble background
        const tw = ctx.measureText(rt.activityBubble).width + 6;
        ctx.fillStyle = "rgba(255,255,255,0.85)";
        ctx.beginPath();
        ctx.roundRect(bx - tw / 2, by - 6, tw, 13, 3);
        ctx.fill();
        ctx.strokeStyle = "rgba(0,0,0,0.2)";
        ctx.lineWidth = 0.5;
        ctx.stroke();
        // emoji
        ctx.fillStyle = "#000";
        ctx.fillText(rt.activityBubble, bx, by + 1);
        ctx.restore();
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
            <div className="text-xs text-slate-300">Canvas 320×240 · 16px tiles · A* pathing · pixel-art props from code</div>
          </div>

          <div ref={containerRef} className="relative flex h-[560px] w-full items-center justify-center overflow-hidden rounded-lg bg-black/40">
            <audio
              ref={audioRef}
              loop
              muted={muted}
              preload="auto"
              src="https://cdn.pixabay.com/audio/2024/11/28/audio_3a6a32ffc4.mp3"
            />
            <button
              onClick={() => {
                const a = audioRef.current;
                if (!a) return;
                const next = !muted;
                a.volume = 1.0;
                a.muted = next;
                if (!next) {
                  // ensure playing when unmuted
                  a.play().catch(() => {});
                }
                setMuted(next);
              }}
              style={{
                position: "absolute",
                top: 8,
                right: 8,
                zIndex: 10,
                background: "rgba(0,0,0,0.5)",
                color: "white",
                border: "none",
                borderRadius: 8,
                padding: "4px 8px",
                cursor: "pointer",
                fontSize: 16,
              }}
              aria-label={muted ? "Unmute ambient audio" : "Mute ambient audio"}
              title={muted ? "Unmute" : "Mute"}
            >
              {muted ? "🔇" : "🔊"}
            </button>
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
