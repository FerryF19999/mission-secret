"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";

type AgentStatus = "active" | "busy" | "idle" | "offline";
type RosterKey = "yuri" | "friday" | "jarvis" | "glass" | "epstein";

type LiveAgent = { key: RosterKey; label: string; status: AgentStatus; task?: string };

type Dir = "down" | "left" | "right" | "up";

type SpriteSheets = {
  office?: HTMLImageElement;
  characters?: HTMLImageElement;
};

type AudioEngine = {
  ctx: AudioContext;
  master: GainNode;
  ambient: {
    gain: GainNode;
    stop: () => void;
  };
};

type CharacterMode = "spawn" | "walk" | "work" | "idle" | "sitting";

type CharacterRuntime = {
  // px in internal canvas space
  x: number;
  y: number;
  dir: Dir;

  mode: CharacterMode;

  // pathing (tile centers)
  path: Array<{ cx: number; cy: number }>; // in px
  targetX: number;
  targetY: number;
  nextDecisionMs: number;

  // anim
  walkFrame: 0 | 1 | 2 | 3;
  walkAcc: number;
  typingFrame: 0 | 1;
  typingAcc: number;

  // return to desk after task
  returnToDesk: boolean;

  // spawn vfx
  sparkleUntilMs: number;

  // audio cadence
  lastStepMs: number;
  lastTypeMs: number;
};

const TILE = 16;
const INTERNAL_W = 480;
const INTERNAL_H = 320;
const COLS = INTERNAL_W / TILE; // 30
const ROWS = INTERNAL_H / TILE; // 20

const FPS_CAP = 20;
const FRAME_MS = 1000 / FPS_CAP;

const ROSTER: Array<{ key: RosterKey; label: string; characterIndex: 0 | 1 | 2 | 3 | 4 }> = [
  { key: "yuri", label: "Yuri", characterIndex: 0 },
  { key: "jarvis", label: "Jarvis", characterIndex: 1 },
  { key: "friday", label: "Friday", characterIndex: 2 },
  { key: "glass", label: "Glass", characterIndex: 3 },
  { key: "epstein", label: "Epstein", characterIndex: 4 },
];

// --- Room layout ---
// Left side: Yuri office (top-left), Main office (bottom-left)
// Right side: Kitchen (top-right), Lounge (bottom-right)
const SPLIT_X = 15; // tiles
const SPLIT_Y = 10; // tiles

// Door / waypoints (tile centers)
const YURI_DOOR_TILE = { tx: 7, ty: SPLIT_Y - 1 }; // bottom wall of Yuri office
const MAIN_TO_RIGHT_DOOR_TILE = { tx: SPLIT_X, ty: 12 }; // doorway in vertical split wall
const KITCHEN_TO_LOUNGE_DOOR_TILE = { tx: 22, ty: SPLIT_Y }; // doorway in horizontal split

function tileCenterPx(tx: number, ty: number) {
  return { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 + 4 };
}

const YURI_DOOR_POS = tileCenterPx(YURI_DOOR_TILE.tx, YURI_DOOR_TILE.ty);

// Collaboration desk inside Yuri's office — where spawned agents work alongside Yuri
const YURI_OFFICE_COLLAB_SEAT: { x: number; y: number; face: Dir } = { ...tileCenterPx(10, 6), face: "down" };

// Desk seat positions (px) — where characters sit/work (their own desks in main office)
const SEATS: Record<RosterKey, { x: number; y: number; face: Dir }> = {
  yuri: { ...tileCenterPx(5, 6), face: "down" },
  jarvis: { ...tileCenterPx(4, 18), face: "down" },
  friday: { ...tileCenterPx(9, 18), face: "down" },
  glass: { ...tileCenterPx(4, 14), face: "down" },
  epstein: { ...tileCenterPx(9, 14), face: "down" },
};

// Casual idle destinations (tile centers)
const IDLE_DEST_TILES: Array<{ tx: number; ty: number; kind: "wander" | "kitchen" | "lounge" | "boss" | "peer" }> = [
  { tx: 3, ty: 13, kind: "peer" },
  { tx: 8, ty: 15, kind: "peer" },
  { tx: 12, ty: 16, kind: "wander" },
  { tx: 19, ty: 3, kind: "kitchen" }, // vending
  { tx: 26, ty: 3, kind: "kitchen" }, // water/fridge
  { tx: 22, ty: 16, kind: "lounge" }, // couch area
  { tx: 27, ty: 15, kind: "lounge" },
  { tx: YURI_DOOR_TILE.tx - 3, ty: YURI_DOOR_TILE.ty + 2, kind: "boss" },
];

// --- helpers ---

function pickAgentFromList(list: any[] | undefined, key: string, label: string) {
  if (!list) return undefined;
  const lowerKey = key.toLowerCase();
  const lowerLabel = label.toLowerCase();
  return (
    list.find((a: any) => (a.handle ?? "").toLowerCase() === lowerKey) ||
    list.find((a: any) => (a.name ?? "").toLowerCase() === lowerLabel)
  );
}

function statusColor(status: AgentStatus) {
  if (status === "active" || status === "busy") return "#22c55e";
  if (status === "idle") return "#f59e0b";
  return "#94a3b8";
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.src = src;
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
  });
}

function randBetween(a: number, b: number) {
  return a + Math.random() * (b - a);
}

const DOOR_TILES = [YURI_DOOR_TILE, MAIN_TO_RIGHT_DOOR_TILE, KITCHEN_TO_LOUNGE_DOOR_TILE];

function isNearDoor(px: number, py: number, radius = 1.5) {
  const tx = Math.floor(px / TILE);
  const ty = Math.floor((py - 4) / TILE);
  for (const d of DOOR_TILES) {
    if (Math.abs(tx - d.tx) <= radius && Math.abs(ty - d.ty) <= radius) return true;
  }
  return false;
}

function dirFromDelta(dx: number, dy: number): Dir {
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? "left" : "right";
  return dy < 0 ? "up" : "down";
}

function getDirIndex(d: Dir) {
  // must match generator order: down,left,right,up
  if (d === "down") return 0;
  if (d === "left") return 1;
  if (d === "right") return 2;
  return 3;
}

// --- Audio (Web Audio API, no external files) ---

function ensureAudioEngine(engineRef: React.MutableRefObject<AudioEngine | null>) {
  if (engineRef.current) return engineRef.current;
  const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  const master = ctx.createGain();
  master.gain.value = 0.22;
  master.connect(ctx.destination);

  const ambientGain = ctx.createGain();
  ambientGain.gain.value = 0.0;
  ambientGain.connect(master);

  const hum = ctx.createOscillator();
  hum.type = "sine";
  hum.frequency.value = 58;
  const humGain = ctx.createGain();
  humGain.gain.value = 0.025;
  hum.connect(humGain);
  humGain.connect(ambientGain);

  const noiseLen = Math.max(1, Math.floor(ctx.sampleRate * 1.5));
  const noiseBuf = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.35;
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuf;
  noise.loop = true;
  const noiseFilter = ctx.createBiquadFilter();
  noiseFilter.type = "bandpass";
  noiseFilter.frequency.value = 420;
  noiseFilter.Q.value = 0.7;
  const noiseGain = ctx.createGain();
  noiseGain.gain.value = 0.02;
  noise.connect(noiseFilter);
  noiseFilter.connect(noiseGain);
  noiseGain.connect(ambientGain);

  hum.start();
  noise.start();

  engineRef.current = {
    ctx,
    master,
    ambient: {
      gain: ambientGain,
      stop: () => {
        try {
          hum.stop();
          noise.stop();
        } catch {
          // ignore
        }
      },
    },
  };
  return engineRef.current;
}

function withAudio(
  engineRef: React.MutableRefObject<AudioEngine | null>,
  muted: boolean,
  fn: (ctx: AudioContext, master: GainNode) => void
) {
  if (muted) return;
  const eng = ensureAudioEngine(engineRef);
  if (eng.ctx.state === "suspended") eng.ctx.resume().catch(() => {});
  fn(eng.ctx, eng.master);
}

function playTyping(engineRef: React.MutableRefObject<AudioEngine | null>, muted: boolean, intensity01 = 0.6) {
  withAudio(engineRef, muted, (ctx, master) => {
    const t0 = ctx.currentTime;
    const dur = randBetween(0.008, 0.016);

    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) {
      const env = Math.exp(-i / (len * 0.22));
      d[i] = (Math.random() * 2 - 1) * env;
    }

    const src = ctx.createBufferSource();
    src.buffer = buf;

    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.setValueAtTime(900 + randBetween(-120, 180), t0);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.012 * intensity01, t0 + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    src.connect(hp);
    hp.connect(g);
    g.connect(master);
    src.start(t0);
    src.stop(t0 + dur);
  });
}

function playFootstep(engineRef: React.MutableRefObject<AudioEngine | null>, muted: boolean) {
  withAudio(engineRef, muted, (ctx, master) => {
    const t0 = ctx.currentTime;
    const dur = randBetween(0.025, 0.04);

    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) {
      const env = Math.exp(-i / (len * 0.28));
      d[i] = (Math.random() * 2 - 1) * env;
    }

    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(220 + randBetween(-35, 35), t0);
    bp.Q.value = 1.6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.008, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    src.connect(bp);
    bp.connect(g);
    g.connect(master);
    src.start(t0);
    src.stop(t0 + dur);
  });
}

function playSpawn(engineRef: React.MutableRefObject<AudioEngine | null>, muted: boolean) {
  withAudio(engineRef, muted, (ctx, master) => {
    const t0 = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.03, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
    g.connect(master);

    const o = ctx.createOscillator();
    o.type = "triangle";
    const f0 = randBetween(620, 740);
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(f0 * 1.5, t0 + 0.12);
    o.connect(g);
    o.start(t0);
    o.stop(t0 + 0.22);

    const o2 = ctx.createOscillator();
    o2.type = "sine";
    o2.frequency.setValueAtTime(f0 * 2.0, t0 + 0.02);
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.0001, t0);
    g2.gain.exponentialRampToValueAtTime(0.012, t0 + 0.03);
    g2.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
    o2.connect(g2);
    g2.connect(master);
    o2.start(t0 + 0.02);
    o2.stop(t0 + 0.18);
  });
}

function playComplete(engineRef: React.MutableRefObject<AudioEngine | null>, muted: boolean) {
  withAudio(engineRef, muted, (ctx, master) => {
    const t0 = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.035, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.28);
    g.connect(master);

    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(880, t0);
    o.frequency.setValueAtTime(1174.66, t0 + 0.12);
    o.connect(g);
    o.start(t0);
    o.stop(t0 + 0.28);
  });
}

// --- office sprite mapping (public/sprites/office.png) ---
// The generator provides these coordinates; keep them stable.
const officeSrc = {
  wood: { x: 0, y: 0, w: 16, h: 16 },
  beige: { x: 16, y: 0, w: 16, h: 16 },
  carpet: { x: 32, y: 0, w: 16, h: 16 },
  wallDark: { x: 48, y: 0, w: 16, h: 16 },
  wallLight: { x: 64, y: 0, w: 16, h: 16 },
  plant: { x: 0, y: 16, w: 16, h: 16 },
  boxes: { x: 16, y: 16, w: 16, h: 16 },
  chair: { x: 32, y: 16, w: 16, h: 16 },
  bookshelf2x2: { x: 0, y: 32, w: 32, h: 32 },
  desk2x2: { x: 32, y: 32, w: 32, h: 32 },
  vending2x2: { x: 64, y: 32, w: 32, h: 32 },
  couch2x1: { x: 96, y: 32, w: 32, h: 16 },
  painting2x1: { x: 128, y: 32, w: 32, h: 16 },
  counter2x1: { x: 160, y: 32, w: 32, h: 16 },
  fridge1x2: { x: 192, y: 32, w: 16, h: 32 },
  water1x2: { x: 208, y: 32, w: 16, h: 32 },
} as const;

type TileKind = "wood" | "beige" | "carpet";

function buildTilemap(): TileKind[][] {
  const map: TileKind[][] = [];
  for (let r = 0; r < ROWS; r++) {
    const row: TileKind[] = [];
    for (let c = 0; c < COLS; c++) {
      const right = c >= SPLIT_X;
      const top = r < SPLIT_Y;
      const inKitchen = right && top;
      const inLounge = right && !top;
      if (inKitchen) row.push("beige");
      else if (inLounge) row.push("carpet");
      else row.push("wood");
    }
    map.push(row);
  }
  return map;
}

type Prop =
  | { kind: "bookshelf"; tx: number; ty: number }
  | { kind: "desk"; tx: number; ty: number }
  | { kind: "chair"; tx: number; ty: number }
  | { kind: "plant"; tx: number; ty: number }
  | { kind: "boxes"; tx: number; ty: number }
  | { kind: "vending"; tx: number; ty: number }
  | { kind: "couch"; tx: number; ty: number }
  | { kind: "painting"; tx: number; ty: number }
  | { kind: "counter"; tx: number; ty: number }
  | { kind: "fridge"; tx: number; ty: number }
  | { kind: "water"; tx: number; ty: number };

function buildProps(): Prop[] {
  const p: Prop[] = [];

  // Yuri office (top-left)
  p.push({ kind: "bookshelf", tx: 1, ty: 1 });
  p.push({ kind: "plant", tx: 12, ty: 1 });
  // Yuri's big desk (hack: desk + counter extension)
  p.push({ kind: "desk", tx: 3, ty: 4 });
  p.push({ kind: "counter", tx: 5, ty: 4 });
  p.push({ kind: "chair", tx: 4, ty: 6 });

  // Collaboration desk in Yuri's office (for spawned agents)
  p.push({ kind: "desk", tx: 9, ty: 4 });
  p.push({ kind: "chair", tx: 10, ty: 6 });

  // Main office (bottom-left) 4 desks
  p.push({ kind: "desk", tx: 2, ty: 12 });
  p.push({ kind: "chair", tx: 3, ty: 14 });

  p.push({ kind: "desk", tx: 7, ty: 12 });
  p.push({ kind: "chair", tx: 8, ty: 14 });

  p.push({ kind: "desk", tx: 2, ty: 16 });
  p.push({ kind: "chair", tx: 3, ty: 18 });

  p.push({ kind: "desk", tx: 7, ty: 16 });
  p.push({ kind: "chair", tx: 8, ty: 18 });

  // main office decor
  p.push({ kind: "boxes", tx: 12, ty: 12 });
  p.push({ kind: "plant", tx: 13, ty: 18 });

  // Kitchen (top-right)
  p.push({ kind: "vending", tx: 18, ty: 2 });
  p.push({ kind: "counter", tx: 22, ty: 2 });
  p.push({ kind: "water", tx: 26, ty: 2 });
  p.push({ kind: "fridge", tx: 28, ty: 2 });

  // Lounge (bottom-right)
  p.push({ kind: "couch", tx: 19, ty: 15 });
  p.push({ kind: "painting", tx: 22, ty: 12 });
  p.push({ kind: "bookshelf", tx: 26, ty: 14 });
  p.push({ kind: "plant", tx: 28, ty: 18 });

  return p;
}

// Collision grid
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

  // vertical split wall, leave a doorway
  for (let y = 0; y < ROWS; y++) {
    if (y === MAIN_TO_RIGHT_DOOR_TILE.ty) continue;
    blocked[y][SPLIT_X] = true;
  }

  // horizontal split wall on right side (kitchen/lounge), doorway
  for (let x = SPLIT_X; x < COLS; x++) {
    if (x === KITCHEN_TO_LOUNGE_DOOR_TILE.tx) continue;
    blocked[SPLIT_Y][x] = true;
  }

  // Yuri office private wall: horizontal at splitY, left side; doorway at YURI_DOOR_TILE
  for (let x = 0; x < SPLIT_X; x++) {
    if (x === YURI_DOOR_TILE.tx) continue;
    blocked[SPLIT_Y - 1][x] = true;
  }

  // add some interior walls to make Yuri office feel enclosed (left + right + top)
  for (let y = 1; y < SPLIT_Y - 1; y++) blocked[y][SPLIT_X - 1] = true; // right wall of Yuri office
  for (let y = 1; y < SPLIT_Y - 1; y++) blocked[y][1] = true; // left wall
  for (let x = 1; x < SPLIT_X - 1; x++) blocked[1][x] = true; // top wall

  // props
  for (const pr of props) {
    if (pr.kind === "bookshelf") mark(pr.tx, pr.ty, 2, 2);
    if (pr.kind === "desk") mark(pr.tx, pr.ty, 2, 2);
    if (pr.kind === "vending") mark(pr.tx, pr.ty, 2, 2);
    if (pr.kind === "couch") mark(pr.tx, pr.ty, 2, 1);
    if (pr.kind === "painting") mark(pr.tx, pr.ty, 2, 1);
    if (pr.kind === "counter") mark(pr.tx, pr.ty, 2, 1);
    if (pr.kind === "fridge") mark(pr.tx, pr.ty, 1, 2);
    if (pr.kind === "water") mark(pr.tx, pr.ty, 1, 2);
    if (pr.kind === "plant") mark(pr.tx, pr.ty, 1, 1);
    if (pr.kind === "boxes") mark(pr.tx, pr.ty, 1, 1);
    if (pr.kind === "chair") mark(pr.tx, pr.ty, 1, 1);
  }

  // allow doors
  blocked[YURI_DOOR_TILE.ty][YURI_DOOR_TILE.tx] = false;
  blocked[MAIN_TO_RIGHT_DOOR_TILE.ty][MAIN_TO_RIGHT_DOOR_TILE.tx] = false;
  blocked[KITCHEN_TO_LOUNGE_DOOR_TILE.ty][KITCHEN_TO_LOUNGE_DOOR_TILE.tx] = false;

  return blocked;
}

// A* pathfind on tiles; return list of centers (px)
function aStar(blocked: boolean[][], fromPx: { x: number; y: number }, toPx: { x: number; y: number }) {
  const from = { tx: clamp(Math.floor(fromPx.x / TILE), 0, COLS - 1), ty: clamp(Math.floor((fromPx.y - 4) / TILE), 0, ROWS - 1) };
  const to = { tx: clamp(Math.floor(toPx.x / TILE), 0, COLS - 1), ty: clamp(Math.floor((toPx.y - 4) / TILE), 0, ROWS - 1) };

  const key = (tx: number, ty: number) => `${tx},${ty}`;
  const h = (tx: number, ty: number) => Math.abs(tx - to.tx) + Math.abs(ty - to.ty);

  const open: Array<{ tx: number; ty: number; f: number; g: number }> = [{ tx: from.tx, ty: from.ty, f: h(from.tx, from.ty), g: 0 }];
  const came = new Map<string, string>();
  const gScore = new Map<string, number>();
  gScore.set(key(from.tx, from.ty), 0);

  const dirs = [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
  ];

  const inBounds = (tx: number, ty: number) => tx >= 0 && tx < COLS && ty >= 0 && ty < ROWS;

  while (open.length) {
    open.sort((a, b) => a.f - b.f);
    const cur = open.shift()!;
    if (cur.tx === to.tx && cur.ty === to.ty) {
      const pathTiles: Array<{ tx: number; ty: number }> = [{ tx: cur.tx, ty: cur.ty }];
      let ck = key(cur.tx, cur.ty);
      while (came.has(ck)) {
        const prev = came.get(ck)!;
        const [px, py] = prev.split(",").map((n) => parseInt(n, 10));
        pathTiles.push({ tx: px, ty: py });
        ck = prev;
      }
      pathTiles.reverse();
      return pathTiles.map((t) => {
        const c = tileCenterPx(t.tx, t.ty);
        return { cx: c.x, cy: c.y };
      });
    }

    for (const { dx, dy } of dirs) {
      const nx = cur.tx + dx;
      const ny = cur.ty + dy;
      if (!inBounds(nx, ny)) continue;
      if (blocked[ny][nx]) continue;

      const nk = key(nx, ny);
      const tentativeG = cur.g + 1;
      const prevG = gScore.get(nk);
      if (prevG == null || tentativeG < prevG) {
        came.set(nk, key(cur.tx, cur.ty));
        gScore.set(nk, tentativeG);
        const f = tentativeG + h(nx, ny);
        if (!open.find((n) => n.tx === nx && n.ty === ny)) open.push({ tx: nx, ty: ny, g: tentativeG, f });
      }
    }
  }

  return [];
}

function drawOffice(ctx: CanvasRenderingContext2D, officeImg: HTMLImageElement, tilemap: TileKind[][], props: Prop[]) {
  // base tiles
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const kind = tilemap[r][c];
      const src = kind === "wood" ? officeSrc.wood : kind === "beige" ? officeSrc.beige : officeSrc.carpet;
      ctx.drawImage(officeImg, src.x, src.y, src.w, src.h, c * TILE, r * TILE, TILE, TILE);
    }
  }

  // walls/borders
  const wall = (tx: number, ty: number, dark = false) => {
    const src = dark ? officeSrc.wallDark : officeSrc.wallLight;
    ctx.drawImage(officeImg, src.x, src.y, 16, 16, tx * TILE, ty * TILE, TILE, TILE);
  };

  // outer
  for (let x = 0; x < COLS; x++) {
    wall(x, 0, true);
    wall(x, ROWS - 1, true);
  }
  for (let y = 0; y < ROWS; y++) {
    wall(0, y, true);
    wall(COLS - 1, y, true);
  }

  // vertical split wall (between left/right)
  for (let y = 0; y < ROWS; y++) {
    if (y === MAIN_TO_RIGHT_DOOR_TILE.ty) continue;
    wall(SPLIT_X, y, true);
  }

  // horizontal split on right (kitchen/lounge)
  for (let x = SPLIT_X; x < COLS; x++) {
    if (x === KITCHEN_TO_LOUNGE_DOOR_TILE.tx) continue;
    wall(x, SPLIT_Y, true);
  }

  // Yuri office private wall (bottom of top-left)
  for (let x = 0; x < SPLIT_X; x++) {
    if (x === YURI_DOOR_TILE.tx) continue;
    wall(x, SPLIT_Y - 1, false);
  }
  // Yuri office enclosure
  for (let y = 1; y < SPLIT_Y - 1; y++) {
    wall(1, y, false);
    wall(SPLIT_X - 1, y, false);
  }
  for (let x = 1; x < SPLIT_X - 1; x++) wall(x, 1, false);

  // props (painterly)
  const drawProp = (src: { x: number; y: number; w: number; h: number }, tx: number, ty: number) => {
    ctx.drawImage(officeImg, src.x, src.y, src.w, src.h, tx * TILE, ty * TILE, src.w, src.h);
  };

  for (const pr of props) {
    if (pr.kind === "bookshelf") drawProp(officeSrc.bookshelf2x2, pr.tx, pr.ty);
    if (pr.kind === "desk") drawProp(officeSrc.desk2x2, pr.tx, pr.ty);
    if (pr.kind === "vending") drawProp(officeSrc.vending2x2, pr.tx, pr.ty);
    if (pr.kind === "couch") drawProp(officeSrc.couch2x1, pr.tx, pr.ty);
    if (pr.kind === "painting") drawProp(officeSrc.painting2x1, pr.tx, pr.ty);
    if (pr.kind === "counter") drawProp(officeSrc.counter2x1, pr.tx, pr.ty);
    if (pr.kind === "fridge") drawProp(officeSrc.fridge1x2, pr.tx, pr.ty);
    if (pr.kind === "water") drawProp(officeSrc.water1x2, pr.tx, pr.ty);
  }
  for (const pr of props) {
    if (pr.kind === "plant") drawProp(officeSrc.plant, pr.tx, pr.ty);
    if (pr.kind === "boxes") drawProp(officeSrc.boxes, pr.tx, pr.ty);
    if (pr.kind === "chair") drawProp(officeSrc.chair, pr.tx, pr.ty);
  }

  // room labels (subtle)
  ctx.font = "8px ui-sans-serif, system-ui";
  ctx.fillStyle = "rgba(255,255,255,0.25)";
  ctx.fillText("YURI", 3 * TILE, 2 * TILE + 2);
  ctx.fillText("MAIN", 2 * TILE, 11 * TILE + 2);
  ctx.fillText("KITCHEN", 17 * TILE, 2 * TILE + 2);
  ctx.fillText("LOUNGE", 18 * TILE, 12 * TILE + 2);
}

function drawLabel(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, color: string, dot: string) {
  ctx.font = "7px ui-sans-serif, system-ui, -apple-system, Segoe UI";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";

  // shadow
  ctx.fillStyle = "rgba(0,0,0,0.65)";
  ctx.fillText(text, x + 1, y + 1);

  // dot
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.beginPath();
  ctx.arc(x - Math.ceil(ctx.measureText(text).width / 2) - 5, y - 3, 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = dot;
  ctx.beginPath();
  ctx.arc(x - Math.ceil(ctx.measureText(text).width / 2) - 5, y - 3, 2, 0, Math.PI * 2);
  ctx.fill();

  // text
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function drawSparkle(ctx: CanvasRenderingContext2D, x: number, y: number, t01: number) {
  const a = 1 - t01;
  const r = 2 + t01 * 6;
  ctx.save();
  ctx.globalAlpha = 0.85 * a;
  ctx.fillStyle = "rgba(255,255,255,0.9)";
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

  ctx.globalAlpha = 0.55 * a;
  ctx.fillStyle = "rgba(56,189,248,0.9)";
  ctx.beginPath();
  ctx.arc(x, y, 1.5 + t01 * 2.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawCharacter(
  ctx: CanvasRenderingContext2D,
  charactersImg: HTMLImageElement,
  characterIndex: number,
  runtime: CharacterRuntime,
  status: AgentStatus,
  label: string,
  selected: boolean
) {
  const CHAR_W = 16;
  const CHAR_H = 20;
  const WALK_COL0 = 0;
  const IDLE_COL = 4;
  const TYPE_COL0 = 5;
  const TYPE_COL1 = 6;

  const dirIndex = getDirIndex(runtime.dir);
  const row = characterIndex * 4 + dirIndex;

  let col = IDLE_COL;
  if (runtime.mode === "work" && (status === "active" || status === "busy")) {
    col = runtime.typingFrame === 0 ? TYPE_COL0 : TYPE_COL1;
  } else {
    const moving = runtime.mode === "walk" || runtime.mode === "spawn";
    col = moving ? WALK_COL0 + runtime.walkFrame : IDLE_COL;
  }

  const srcX = col * CHAR_W;
  const srcY = row * CHAR_H;

  const drawX = Math.round(runtime.x - CHAR_W / 2);
  const drawY = Math.round(runtime.y - CHAR_H);

  // shadow
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath();
  ctx.ellipse(runtime.x, runtime.y - 4, 7, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  if (selected) {
    ctx.fillStyle = "rgba(56,189,248,0.18)";
    ctx.beginPath();
    ctx.ellipse(runtime.x, runtime.y - 4, 11, 6, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.drawImage(charactersImg, srcX, srcY, CHAR_W, CHAR_H, drawX, drawY, CHAR_W, CHAR_H);

  drawLabel(
    ctx,
    runtime.x,
    drawY - 2,
    label,
    selected ? "#38bdf8" : "rgba(255,255,255,0.9)",
    statusColor(status)
  );
}

function isPointInCharacter(px: number, py: number, runtime: CharacterRuntime) {
  const CHAR_W = 16;
  const CHAR_H = 20;
  const x0 = runtime.x - CHAR_W / 2;
  const y0 = runtime.y - CHAR_H;
  return px >= x0 && px <= x0 + CHAR_W && py >= y0 && py <= y0 + CHAR_H;
}

function wibNowParts(date = new Date()) {
  const wib = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  const hh = wib.getUTCHours();
  const mm = wib.getUTCMinutes();
  const ss = wib.getUTCSeconds();
  return { hh, mm, ss };
}

function dayNightOverlayAlpha(hh: number) {
  // Brightest ~11-15, darkest at night.
  if (hh >= 6 && hh <= 17) {
    // daytime 0.05..0.18
    const t = Math.abs(12 - hh) / 6;
    return 0.05 + t * 0.13;
  }
  // night 0.25..0.45
  const dist = hh >= 18 ? hh - 18 : hh + 6; // 0..11
  const t = clamp(dist / 11, 0, 1);
  return 0.28 + t * 0.17;
}

function drawKitchenClock(ctx: CanvasRenderingContext2D, ms: number) {
  const { hh, mm } = wibNowParts();
  const text = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")} WIB`;
  // place on kitchen wall
  const x = 24 * TILE + 8;
  const y = 2 * TILE + 8;
  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(x - 18, y - 8, 36, 14);
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.strokeRect(x - 18.5, y - 8.5, 37, 15);
  ctx.font = "7px ui-monospace, SFMono-Regular, Menlo, Monaco";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(226,232,240,0.95)";
  ctx.fillText(text, x, y);
  ctx.restore();
}

function drawMonitorsAndMugs(ctx: CanvasRenderingContext2D, ms: number, live: LiveAgent[]) {
  // monitor rectangles anchored near desks; glow when active/busy
  type Mon = { key: RosterKey; x: number; y: number; w: number; h: number; dual?: boolean };
  const mons: Mon[] = [
    { key: "yuri", x: 4 * TILE + 6, y: 4 * TILE + 3, w: 10, h: 6, dual: true },
    { key: "glass", x: 3 * TILE + 6, y: 12 * TILE + 3, w: 10, h: 6 },
    { key: "epstein", x: 8 * TILE + 6, y: 12 * TILE + 3, w: 10, h: 6 },
    { key: "jarvis", x: 3 * TILE + 6, y: 16 * TILE + 3, w: 10, h: 6 },
    { key: "friday", x: 8 * TILE + 6, y: 16 * TILE + 3, w: 10, h: 6 },
  ];

  const liveBy = new Map(live.map((a) => [a.key, a] as const));

  for (const m of mons) {
    const a = liveBy.get(m.key);
    const on = a && (a.status === "active" || a.status === "busy");

    // screen
    ctx.save();
    if (on) {
      // glow
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = "rgba(56,189,248,1)";
      ctx.fillRect(m.x - 3, m.y - 3, m.w + 6, m.h + 6);
      ctx.globalAlpha = 1;
    }

    ctx.fillStyle = on ? "rgba(15,23,42,0.92)" : "rgba(2,6,23,0.75)";
    ctx.fillRect(m.x, m.y, m.w, m.h);
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.strokeRect(m.x + 0.5, m.y + 0.5, m.w - 1, m.h - 1);

    // scrolling code lines when on
    if (on) {
      const t = (ms / 1000) * (a!.status === "busy" ? 2.0 : 1.1);
      const off = Math.floor(t * 6) % 12;
      for (let i = 0; i < 7; i++) {
        const yy = m.y + 1 + i;
        const w = 2 + ((i * 11 + off + m.key.length) % (m.w - 3));
        ctx.fillStyle = i % 3 === 0 ? "rgba(34,197,94,0.75)" : "rgba(226,232,240,0.7)";
        ctx.fillRect(m.x + 1, yy, w, 1);
      }
    }

    // dual monitor for Yuri
    if (m.dual) {
      const dx = m.w + 4;
      ctx.fillStyle = on ? "rgba(15,23,42,0.92)" : "rgba(2,6,23,0.75)";
      ctx.fillRect(m.x + dx, m.y, m.w, m.h);
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.strokeRect(m.x + dx + 0.5, m.y + 0.5, m.w - 1, m.h - 1);
      if (on) {
        const t = (ms / 1000) * (a!.status === "busy" ? 2.2 : 1.2);
        const off = Math.floor(t * 7) % 12;
        for (let i = 0; i < 7; i++) {
          const yy = m.y + 1 + i;
          const w = 2 + ((i * 13 + off + 3) % (m.w - 3));
          ctx.fillStyle = i % 3 === 1 ? "rgba(251,146,60,0.75)" : "rgba(226,232,240,0.7)";
          ctx.fillRect(m.x + dx + 1, yy, w, 1);
        }
      }
    }

    ctx.restore();

    // coffee mug near each desk (tiny)
    const mugX = m.x + m.w - 2;
    const mugY = m.y + m.h + 6;
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(mugX - 1, mugY - 1, 4, 4);
    ctx.fillStyle = "rgba(248,250,252,0.85)";
    ctx.fillRect(mugX, mugY, 3, 3);
    ctx.fillStyle = "rgba(15,23,42,0.65)";
    ctx.fillRect(mugX + 1, mugY + 1, 1, 1);
  }
}

export default function OfficePage() {
  const agents = useQuery(api.agents.getAll, {});
  const running = useQuery(api.agentRuns.getRecent, { status: "running", limit: 100 });

  const live = useMemo(() => {
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

  const [muted, setMuted] = useState(true);
  const audioRef = useRef<AudioEngine | null>(null);
  const prevRunningByAgentRef = useRef<Record<string, boolean>>({});

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sheetsRef = useRef<SpriteSheets>({});

  const tilemap = useMemo(() => buildTilemap(), []);
  const props = useMemo(() => buildProps(), []);
  const blocked = useMemo(() => buildBlocked(props), [props]);

  const runtimeRef = useRef<Record<RosterKey, CharacterRuntime>>({} as any);
  const rafRef = useRef<number>(0);
  const lastTickMsRef = useRef<number>(0);
  const lastFrameMsRef = useRef<number>(0);

  // init + load sprites
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [officeImg, charactersImg] = await Promise.all([loadImage("/sprites/office.png"), loadImage("/sprites/characters.png")]);
      if (cancelled) return;
      sheetsRef.current = { office: officeImg, characters: charactersImg };
    })().catch(() => {
      // ignore
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // audio: create only after unmute
  useEffect(() => {
    if (muted) {
      const eng = audioRef.current;
      if (eng) eng.ambient.gain.gain.setTargetAtTime(0.0, eng.ctx.currentTime, 0.05);
      return;
    }
    const eng = ensureAudioEngine(audioRef);
    if (eng.ctx.state === "suspended") eng.ctx.resume().catch(() => {});
    eng.ambient.gain.gain.setTargetAtTime(0.12, eng.ctx.currentTime, 0.08);
  }, [muted]);

  // init character runtimes at their seat (Yuri) / near main office door
  useEffect(() => {
    for (const r of ROSTER) {
      if (runtimeRef.current[r.key]) continue;
      const seat = SEATS[r.key];
      runtimeRef.current[r.key] = {
        x: seat.x,
        y: seat.y,
        dir: seat.face,
        mode: r.key === "yuri" ? "work" : "idle",
        path: [],
        targetX: seat.x,
        targetY: seat.y,
        nextDecisionMs: 0,
        walkFrame: 0,
        walkAcc: 0,
        typingFrame: 0,
        typingAcc: 0,
        returnToDesk: false,
        sparkleUntilMs: 0,
        lastStepMs: 0,
        lastTypeMs: 0,
      };
    }
  }, []);

  // observe running agent runs for spawn/complete transitions
  useEffect(() => {
    const runSet = new Set<string>();
    for (const r of running ?? []) {
      const id = String((r as any).agentId ?? "").toLowerCase();
      const nm = String((r as any).agentName ?? "").toLowerCase();
      for (const rr of ROSTER) {
        if (id === rr.key || nm === rr.label.toLowerCase()) runSet.add(rr.key);
      }
    }

    for (const rr of ROSTER) {
      if (rr.key === "yuri") continue;
      const prev = !!prevRunningByAgentRef.current[rr.key];
      const now = runSet.has(rr.key);

      if (!prev && now) {
        // spawn at Yuri door with sparkle, then path to own desk
        const rt = runtimeRef.current[rr.key];
        if (rt) {
          rt.x = YURI_DOOR_POS.x;
          rt.y = YURI_DOOR_POS.y;
          rt.mode = "spawn";
          rt.sparkleUntilMs = performance.now() + 520;
          rt.path = [];
        }
        playSpawn(audioRef, muted);
      }

      if (prev && !now) {
        // completion ding; agent walks back to desk and sits
        const rt = runtimeRef.current[rr.key];
        if (rt) {
          const ws = SEATS[rr.key as keyof typeof SEATS];
          if (ws) {
            const path = aStar(blocked, { x: rt.x, y: rt.y }, { x: ws.x, y: ws.y });
            rt.path = path;
            rt.mode = "walk";
            rt.returnToDesk = true;
          } else {
            rt.mode = "idle";
          }
          rt.nextDecisionMs = 0;
        }
        playComplete(audioRef, muted);
      }

      prevRunningByAgentRef.current[rr.key] = now;
    }
  }, [running, muted]);

  // resize backing store (internal resolution), scale with CSS
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      canvas.width = INTERNAL_W;
      canvas.height = INTERNAL_H;
      const scale = Math.floor(Math.min(rect.width / INTERNAL_W, rect.height / INTERNAL_H) * 1000) / 1000;
      const w = Math.max(1, INTERNAL_W * scale);
      const h = Math.max(1, INTERNAL_H * scale);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // main loop (capped)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true })!;
    ctx.imageSmoothingEnabled = false;

    const tick = (ms: number) => {
      rafRef.current = requestAnimationFrame(tick);
      if (ms - (lastFrameMsRef.current || 0) < FRAME_MS) return;

      const last = lastTickMsRef.current || ms;
      const dt = clamp((ms - last) / 1000, 0, 0.08);
      lastTickMsRef.current = ms;
      lastFrameMsRef.current = ms;

      const { office, characters } = sheetsRef.current;
      ctx.clearRect(0, 0, INTERNAL_W, INTERNAL_H);

      if (!office || !characters) {
        ctx.fillStyle = "#0b1020";
        ctx.fillRect(0, 0, INTERNAL_W, INTERNAL_H);
        ctx.fillStyle = "#e2e8f0";
        ctx.font = "12px ui-sans-serif, system-ui";
        ctx.fillText("Loading sprites…", 12, 20);
        return;
      }

      const now = ms;

      // Update logic
      const runningSet = new Set<string>();
      for (const r of running ?? []) {
        const id = String((r as any).agentId ?? "").toLowerCase();
        const nm = String((r as any).agentName ?? "").toLowerCase();
        for (const rr of ROSTER) {
          if (id === rr.key || nm === rr.label.toLowerCase()) runningSet.add(rr.key);
        }
      }

      for (const a of live) {
        const rt = runtimeRef.current[a.key];
        if (!rt) continue;

        // Offline: not shown, but keep them parked at desk for when they come back.
        if (a.status === "offline" && a.key !== "yuri") {
          rt.mode = "idle";
          continue;
        }

        const isWorking = a.key === "yuri" ? true : runningSet.has(a.key) || a.status === "active" || a.status === "busy";
        // Yuri works at his desk, spawned agents work at collab desk in Yuri's office
        const workSeat = a.key === "yuri" ? SEATS.yuri : (isWorking ? YURI_OFFICE_COLLAB_SEAT : SEATS[a.key]);

        // Decide next target + path
        if (isWorking) {
          rt.mode = "work";
          rt.targetX = workSeat.x;
          rt.targetY = workSeat.y;
          rt.path = [];
          rt.dir = workSeat.face;
        } else {
          // idle behaviors
          if (rt.mode === "spawn") {
            // after sparkle, path to own desk
            if (now > rt.sparkleUntilMs) {
              const ws = SEATS[a.key as keyof typeof SEATS];
              if (ws) {
                const path = aStar(blocked, { x: rt.x, y: rt.y }, { x: ws.x, y: ws.y });
                rt.path = path;
                rt.mode = "walk";
                rt.returnToDesk = true;
              } else {
                rt.mode = "idle";
              }
            }
          }

          const nearTarget = Math.hypot(rt.targetX - rt.x, rt.targetY - rt.y) < 2.0;
          // sitting at desk — stay until next decision time, then maybe wander
          if (rt.mode === "sitting") {
            if (rt.nextDecisionMs === 0) rt.nextDecisionMs = now + randBetween(5000, 12000);
            if (now >= rt.nextDecisionMs) {
              rt.mode = "idle";
              rt.nextDecisionMs = 0;
            }
          }

          // If idle near a door, immediately go to desk
          if (rt.mode === "idle" && isNearDoor(rt.x, rt.y)) {
            const ws = SEATS[a.key as keyof typeof SEATS];
            if (ws) {
              const path = aStar(blocked, { x: rt.x, y: rt.y }, { x: ws.x, y: ws.y });
              rt.path = path;
              rt.mode = "walk";
              rt.returnToDesk = true;
            }
          }

          if (rt.mode === "idle" && (rt.nextDecisionMs === 0 || now >= rt.nextDecisionMs) && nearTarget) {
            // 70% chance to go back to desk and sit, 30% wander
            if (Math.random() < 0.7) {
              const ws = SEATS[a.key as keyof typeof SEATS];
              if (ws) {
                const path = aStar(blocked, { x: rt.x, y: rt.y }, { x: ws.x, y: ws.y });
                rt.path = path;
                rt.mode = "walk";
                rt.returnToDesk = true;
                rt.nextDecisionMs = now + randBetween(3000, 7000);
              }
            } else {
            // pick an idle destination: bias kitchen/lounges and sometimes report to Yuri's door
            const biasBoss = a.key !== "yuri" && Math.random() < 0.18;
            const pick = biasBoss
              ? { tx: YURI_DOOR_TILE.tx - 2, ty: YURI_DOOR_TILE.ty + 2 }
              : IDLE_DEST_TILES[Math.floor(Math.random() * IDLE_DEST_TILES.length)];

            const destPx = tileCenterPx(pick.tx, pick.ty);
            const path = aStar(blocked, { x: rt.x, y: rt.y }, destPx);
            rt.path = path;
            rt.mode = "walk";
            rt.nextDecisionMs = now + randBetween(2500, 5200);
            }
          }

          if (rt.mode === "walk" || rt.mode === "spawn") {
            // follow path
            if (!rt.path.length) {
              // make sure we have a target if none
              rt.mode = "idle";
            } else {
              const next = rt.path[0];
              rt.targetX = next.cx;
              rt.targetY = next.cy;
              const dx = rt.targetX - rt.x;
              const dy = rt.targetY - rt.y;
              const dist = Math.hypot(dx, dy);

              const speed = 22; // casual strolling
              if (dist > 0.001) {
                const step = Math.min(dist, speed * dt);
                rt.x += (dx / dist) * step;
                rt.y += (dy / dist) * step;
                rt.dir = dirFromDelta(dx, dy);
              }

              if (dist < 1.2) rt.path.shift();
              if (!rt.path.length) {
                // Never stop near a door — if near one, reroute to own desk
                if (isNearDoor(rt.x, rt.y)) {
                  const ws = SEATS[a.key as keyof typeof SEATS];
                  if (ws) {
                    const path = aStar(blocked, { x: rt.x, y: rt.y }, { x: ws.x, y: ws.y });
                    rt.path = path;
                    rt.returnToDesk = true;
                  }
                } else if (rt.returnToDesk) {
                  rt.mode = "sitting";
                  rt.returnToDesk = false;
                } else {
                  rt.mode = "idle";
                }
              }
            }
          }

          // keep inside
          rt.x = clamp(rt.x, 8, INTERNAL_W - 8);
          rt.y = clamp(rt.y, 24, INTERNAL_H - 8);
        }

        // Animation + sounds
        const moving = rt.mode === "walk" || rt.mode === "spawn";
        if (moving) {
          rt.walkAcc += dt;
          if (rt.walkAcc >= 0.15) {
            rt.walkAcc = 0;
            rt.walkFrame = (((rt.walkFrame + 1) % 4) as 0 | 1 | 2 | 3);

            if (rt.walkFrame % 2 === 0 && now - rt.lastStepMs > 120) {
              playFootstep(audioRef, muted);
              rt.lastStepMs = now;
            }
          }
        } else {
          rt.walkFrame = 0;
          rt.walkAcc = 0;
        }

        if (rt.mode === "work" || rt.mode === "sitting") {
          if (rt.mode === "work") {
            const busy = a.status === "busy";
            const cadence = busy ? 0.085 : 0.12;
            rt.typingAcc += dt;
            if (rt.typingAcc >= cadence) {
              rt.typingAcc = 0;
              rt.typingFrame = rt.typingFrame === 0 ? 1 : 0;
              if (now - rt.lastTypeMs > 60 && Math.random() < 0.9) {
                playTyping(audioRef, muted, busy ? 0.85 : 0.6);
                rt.lastTypeMs = now;
              }
            }
          } else {
            // sitting — no typing, just seated still
            rt.typingFrame = 0;
            rt.typingAcc = 0;
          }
        } else {
          rt.typingAcc = 0;
          rt.typingFrame = 0;
        }
      }

      // Render
      drawOffice(ctx, office, tilemap, props);

      // Details layer: clock + monitors + mugs
      drawKitchenClock(ctx, now);
      drawMonitorsAndMugs(ctx, now, live);

      // Characters (by y)
      const toDraw = live
        .filter((a) => a.status !== "offline" || a.key === "yuri")
        .map((a) => ({ a, rt: runtimeRef.current[a.key] }))
        .filter((x) => !!x.rt)
        .sort((l, r) => l.rt!.y - r.rt!.y);

      for (const { a, rt } of toDraw) {
        if (a.status === "offline" && a.key !== "yuri") continue;
        drawCharacter(ctx, characters, ROSTER.find((x) => x.key === a.key)!.characterIndex, rt!, a.status, a.label, a.key === selected);
      }

      // Spawn sparkle
      for (const a of live) {
        const rt = runtimeRef.current[a.key];
        if (!rt) continue;
        if (rt.sparkleUntilMs > now) {
          const t01 = clamp(1 - (rt.sparkleUntilMs - now) / 520, 0, 1);
          drawSparkle(ctx, rt.x, rt.y - 16, t01);
          drawSparkle(ctx, rt.x + 6, rt.y - 10, clamp(t01 + 0.12, 0, 1));
        }
      }

      // Day/night tint (WIB)
      const { hh } = wibNowParts();
      const alpha = dayNightOverlayAlpha(hh);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = hh >= 6 && hh <= 17 ? "rgba(2,6,23,1)" : "rgba(2,6,23,1)";
      ctx.fillRect(0, 0, INTERNAL_W, INTERNAL_H);
      // slight blue moonlight at night
      if (hh < 6 || hh > 17) {
        ctx.globalAlpha = alpha * 0.55;
        ctx.fillStyle = "rgba(56,189,248,1)";
        ctx.fillRect(0, 0, INTERNAL_W, INTERNAL_H);
      }
      ctx.restore();
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [blocked, live, muted, props, running, selected, tilemap]);

  // click hit-testing
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onClick = (ev: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const sx = INTERNAL_W / rect.width;
      const sy = INTERNAL_H / rect.height;
      const px = (ev.clientX - rect.left) * sx;
      const py = (ev.clientY - rect.top) * sy;

      const liveSorted = [...live]
        .filter((a) => a.status !== "offline" || a.key === "yuri")
        .map((a) => ({ a, rt: runtimeRef.current[a.key] }))
        .filter((x) => !!x.rt)
        .sort((l, r) => r.rt!.y - l.rt!.y);

      for (const { a, rt } of liveSorted) {
        if (rt && isPointInCharacter(px, py, rt)) {
          setSelected(a.key);
          return;
        }
      }
    };

    canvas.addEventListener("click", onClick);
    return () => canvas.removeEventListener("click", onClick);
  }, [live]);

  return (
    <div className="min-h-[calc(100vh-64px)] w-full bg-slate-950 text-slate-100">
      <div className="mx-auto flex max-w-6xl gap-4 px-4 py-6">
        <div className="flex-1 rounded-xl border border-slate-800 bg-slate-900/30 p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-semibold">Office</div>
            <div className="text-xs text-slate-300">4 rooms · A* pathing · 20fps canvas · sprite sheets</div>
          </div>

          <div ref={containerRef} className="relative flex h-[560px] w-full items-center justify-center overflow-hidden rounded-lg bg-black/40">
            <button
              type="button"
              onClick={() => {
                setMuted((m) => {
                  const next = !m;
                  if (!next) {
                    const eng = ensureAudioEngine(audioRef);
                    if (eng.ctx.state === "suspended") eng.ctx.resume().catch(() => {});
                  }
                  return next;
                });
              }}
              className="absolute right-2 top-2 z-10 rounded-md border border-slate-700 bg-slate-950/60 px-2 py-1 text-xs text-slate-100 hover:bg-slate-950/80"
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
                    <span className="text-slate-200">Active/Busy</span>: seated at desk, typing (faster when busy)
                  </li>
                  <li>
                    <span className="text-slate-200">Idle</span>: casual strolling (kitchen, lounge, peers) + sometimes reports to Yuri’s door
                  </li>
                  <li>
                    <span className="text-slate-200">Offline</span>: character hidden, monitors off
                  </li>
                  <li>
                    <span className="text-slate-200">New run</span>: spawns at Yuri’s door with sparkle, walks to desk
                  </li>
                </ul>
              </div>

              <div className="text-xs text-slate-400">
                <div className="font-semibold text-slate-300">Details</div>
                <ul className="mt-1 list-disc space-y-1 pl-4">
                  <li>Kitchen clock shows real WIB time</li>
                  <li>Day/night tint based on WIB hour</li>
                  <li>Monitor glow + scrolling code when working</li>
                  <li>WebAudio: typing, footsteps, spawn chime, completion ding (muted by default)</li>
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
