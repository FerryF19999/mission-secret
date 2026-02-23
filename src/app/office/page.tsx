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

type CharacterRuntime = {
  x: number; // px in internal canvas space
  y: number;
  dir: Dir;
  // movement
  targetX: number;
  targetY: number;
  waitUntilMs: number;
  // anim
  walkFrame: 0 | 1 | 2 | 3;
  walkAcc: number;
  typingAcc: number;
};

const TILE = 16;
const INTERNAL_W = 384;
const INTERNAL_H = 256;
const COLS = INTERNAL_W / TILE; // 24
const ROWS = INTERNAL_H / TILE; // 16

const ROSTER: Array<{ key: RosterKey; label: string; characterIndex: 0 | 1 | 2 | 3 | 4 }> = [
  { key: "yuri", label: "Yuri", characterIndex: 0 },
  { key: "jarvis", label: "Jarvis", characterIndex: 1 },
  { key: "friday", label: "Friday", characterIndex: 2 },
  { key: "glass", label: "Glass", characterIndex: 3 },
  { key: "epstein", label: "Epstein", characterIndex: 4 },
];

// --- Layout (tile coords) ---
// Main office: left 15 cols (0..14)
// Right side split: kitchen (top-right) and lounge (bottom-right)
const MAIN_W = 15;

const DESKS: Record<RosterKey, { x: number; y: number }> = {
  // place them near desks in main office and lounge
  glass: { x: 5 * TILE + 8, y: 6 * TILE + 12 },
  friday: { x: 9 * TILE + 8, y: 6 * TILE + 12 },
  yuri: { x: 5 * TILE + 8, y: 11 * TILE + 12 },
  jarvis: { x: 9 * TILE + 8, y: 11 * TILE + 12 },
  epstein: { x: 19 * TILE + 8, y: 12 * TILE + 12 },
};

const IDLE_SPOTS: Array<{ x: number; y: number }> = [
  { x: 2 * TILE + 8, y: 3 * TILE + 12 }, // shelves
  { x: 7 * TILE + 8, y: 3 * TILE + 12 },
  { x: 12 * TILE + 8, y: 8 * TILE + 12 },
  { x: 17 * TILE + 8, y: 3 * TILE + 12 }, // kitchen
  { x: 21 * TILE + 8, y: 4 * TILE + 12 },
  { x: 18 * TILE + 8, y: 12 * TILE + 12 }, // lounge
  { x: 22 * TILE + 8, y: 13 * TILE + 12 },
];

const COUCH_SLEEP: { x: number; y: number } = { x: 20 * TILE + 8, y: 13 * TILE + 12 };

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

// --- office tileset mapping (public/sprites/office.png) ---
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
      // kitchen: top-right chunk
      const inRight = c >= MAIN_W;
      const inKitchen = inRight && r <= 6;
      const inLounge = inRight && r >= 7;

      if (!inRight) row.push("wood");
      else if (inKitchen) row.push("beige");
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

  // Bookshelves along top wall of main office
  p.push({ kind: "bookshelf", tx: 1, ty: 0 });
  p.push({ kind: "bookshelf", tx: 5, ty: 0 });
  p.push({ kind: "plant", tx: 0, ty: 2 });
  p.push({ kind: "boxes", tx: 3, ty: 2 });

  // Desks grid (main office)
  p.push({ kind: "desk", tx: 3, ty: 4 });
  p.push({ kind: "chair", tx: 4, ty: 6 });

  p.push({ kind: "desk", tx: 7, ty: 4 });
  p.push({ kind: "chair", tx: 8, ty: 6 });

  p.push({ kind: "desk", tx: 3, ty: 9 });
  p.push({ kind: "chair", tx: 4, ty: 11 });

  p.push({ kind: "desk", tx: 7, ty: 9 });
  p.push({ kind: "chair", tx: 8, ty: 11 });

  // extra decor
  p.push({ kind: "plant", tx: 13, ty: 13 });
  p.push({ kind: "boxes", tx: 12, ty: 2 });

  // Kitchen (top-right)
  p.push({ kind: "vending", tx: 16, ty: 1 });
  p.push({ kind: "counter", tx: 19, ty: 1 });
  p.push({ kind: "water", tx: 22, ty: 1 });
  p.push({ kind: "fridge", tx: 23, ty: 1 });

  // Lounge (bottom-right)
  p.push({ kind: "couch", tx: 17, ty: 11 });
  p.push({ kind: "painting", tx: 19, ty: 8 });
  p.push({ kind: "bookshelf", tx: 21, ty: 9 });
  p.push({ kind: "plant", tx: 23, ty: 14 });

  return p;
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

  // simple walls/borders
  // top border
  for (let c = 0; c < COLS; c++) {
    const src = c < MAIN_W ? officeSrc.wallLight : officeSrc.wallDark;
    ctx.drawImage(officeImg, src.x, src.y, src.w, src.h, c * TILE, 0, TILE, TILE);
  }
  // right border
  for (let r = 0; r < ROWS; r++) {
    ctx.drawImage(officeImg, officeSrc.wallDark.x, officeSrc.wallDark.y, 16, 16, (COLS - 1) * TILE, r * TILE, TILE, TILE);
  }
  // divider between kitchen and lounge
  for (let c = MAIN_W; c < COLS; c++) {
    ctx.drawImage(officeImg, officeSrc.wallDark.x, officeSrc.wallDark.y, 16, 16, c * TILE, 7 * TILE, TILE, TILE);
  }

  // props (draw in a painterly order; larger first, then small)
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
}

function drawLabel(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, color: string) {
  // tiny label with shadow
  ctx.font = "6px ui-sans-serif, system-ui, -apple-system, Segoe UI";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillStyle = "rgba(0,0,0,0.65)";
  ctx.fillText(text, x + 1, y + 1);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
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
  const COLS_PER_ROW = 7;
  const WALK_COL0 = 0;
  const IDLE_COL = 4;
  const TYPE_COL0 = 5;
  const TYPE_COL1 = 6;

  const dirIndex = getDirIndex(runtime.dir);
  const row = characterIndex * 4 + dirIndex;
  let col = IDLE_COL;

  if (status === "active" || status === "busy") {
    // typing at desk
    col = runtime.typingAcc % 2 === 0 ? TYPE_COL0 : TYPE_COL1;
  } else {
    // walk or idle
    const moving = Math.hypot(runtime.targetX - runtime.x, runtime.targetY - runtime.y) > 1.5;
    if (moving) col = WALK_COL0 + runtime.walkFrame;
    else col = IDLE_COL;
  }

  const srcX = col * CHAR_W;
  const srcY = row * CHAR_H;

  const drawX = Math.round(runtime.x - CHAR_W / 2);
  const drawY = Math.round(runtime.y - CHAR_H);

  // selection halo
  if (selected) {
    ctx.fillStyle = "rgba(56,189,248,0.25)";
    ctx.beginPath();
    ctx.ellipse(runtime.x, runtime.y - 4, 10, 6, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.drawImage(charactersImg, srcX, srcY, CHAR_W, CHAR_H, drawX, drawY, CHAR_W, CHAR_H);

  drawLabel(ctx, runtime.x, drawY - 2, label, selected ? "#38bdf8" : "rgba(255,255,255,0.9)");
}

function isPointInCharacter(px: number, py: number, runtime: CharacterRuntime) {
  const CHAR_W = 16;
  const CHAR_H = 20;
  const x0 = runtime.x - CHAR_W / 2;
  const y0 = runtime.y - CHAR_H;
  return px >= x0 && px <= x0 + CHAR_W && py >= y0 && py <= y0 + CHAR_H;
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

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sheetsRef = useRef<SpriteSheets>({});

  const tilemap = useMemo(() => buildTilemap(), []);
  const props = useMemo(() => buildProps(), []);

  const runtimeRef = useRef<Record<RosterKey, CharacterRuntime>>({} as any);
  const rafRef = useRef<number>(0);
  const lastMsRef = useRef<number>(0);

  // init + load sprites
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [officeImg, charactersImg] = await Promise.all([
        loadImage("/sprites/office.png"),
        loadImage("/sprites/characters.png"),
      ]);
      if (cancelled) return;
      sheetsRef.current = { office: officeImg, characters: charactersImg };
    })().catch(() => {
      // ignore; page will show fallback
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // init character runtimes at their desk
  useEffect(() => {
    for (const r of ROSTER) {
      if (runtimeRef.current[r.key]) continue;
      const d = DESKS[r.key];
      runtimeRef.current[r.key] = {
        x: d.x,
        y: d.y,
        dir: "down",
        targetX: d.x,
        targetY: d.y,
        waitUntilMs: 0,
        walkFrame: 0,
        walkAcc: 0,
        typingAcc: 0,
      };
    }
  }, []);

  // resize backing store to crisp pixels (no DPR scaling inside; we scale via CSS)
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      // canvas backing store stays INTERNAL_*, we scale via style
      canvas.width = INTERNAL_W;
      canvas.height = INTERNAL_H;
      // size to container while preserving aspect
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

  // main loop: update + render
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true })!;
    ctx.imageSmoothingEnabled = false;

    const tick = (ms: number) => {
      rafRef.current = requestAnimationFrame(tick);
      const last = lastMsRef.current || ms;
      const dt = clamp((ms - last) / 1000, 0, 0.05);
      lastMsRef.current = ms;

      const { office, characters } = sheetsRef.current;
      // clear
      ctx.clearRect(0, 0, INTERNAL_W, INTERNAL_H);

      if (!office || !characters) {
        // fallback background
        ctx.fillStyle = "#0b1020";
        ctx.fillRect(0, 0, INTERNAL_W, INTERNAL_H);
        ctx.fillStyle = "#e2e8f0";
        ctx.font = "12px ui-sans-serif, system-ui";
        ctx.fillText("Loading sprites…", 12, 20);
        return;
      }

      // update characters
      const now = ms;
      for (const a of live) {
        const rt = runtimeRef.current[a.key];
        if (!rt) continue;

        const isOffline = a.status === "offline";
        const isWorking = a.status === "active" || a.status === "busy";

        // choose target
        if (isOffline) {
          rt.targetX = COUCH_SLEEP.x;
          rt.targetY = COUCH_SLEEP.y;
        } else if (isWorking) {
          const d = DESKS[a.key];
          rt.targetX = d.x;
          rt.targetY = d.y;
        } else {
          // idle wander
          if (now >= rt.waitUntilMs && Math.hypot(rt.targetX - rt.x, rt.targetY - rt.y) < 2) {
            const pick = IDLE_SPOTS[(Math.floor((now / 1000 + a.key.length * 7) * 997) % IDLE_SPOTS.length + IDLE_SPOTS.length) % IDLE_SPOTS.length];
            rt.targetX = pick.x;
            rt.targetY = pick.y;
            rt.waitUntilMs = now + 1500 + (a.key.charCodeAt(0) % 5) * 450;
          }
        }

        // move towards target (slow stroll)
        const dx = rt.targetX - rt.x;
        const dy = rt.targetY - rt.y;
        const d = Math.hypot(dx, dy);
        const moving = d > 1.2 && !isWorking; // when working, stand+type

        if (!isWorking) {
          const speed = 18; // px/s
          if (d > 0.001) {
            const step = Math.min(d, speed * dt);
            rt.x += (dx / d) * step;
            rt.y += (dy / d) * step;
            rt.dir = dirFromDelta(dx, dy);
          }
        } else {
          // face down at desk (friendly)
          rt.dir = "down";
        }

        // keep inside bounds
        rt.x = clamp(rt.x, 8, INTERNAL_W - 8);
        rt.y = clamp(rt.y, 24, INTERNAL_H - 4);

        // animation
        if (moving) {
          rt.walkAcc += dt;
          if (rt.walkAcc >= 0.18) {
            rt.walkAcc = 0;
            rt.walkFrame = (((rt.walkFrame + 1) % 4) as 0 | 1 | 2 | 3);
          }
        } else {
          rt.walkFrame = 0;
          rt.walkAcc = 0;
        }
        if (isWorking) {
          rt.typingAcc += dt;
          if (rt.typingAcc >= 0.22) rt.typingAcc = 0;
        } else {
          rt.typingAcc = 0;
        }
      }

      // render office
      drawOffice(ctx, office, tilemap, props);

      // render characters sorted by y for depth
      const toDraw = live
        .filter((a) => a.status !== "offline") // disappear when offline
        .map((a) => ({ a, rt: runtimeRef.current[a.key] }))
        .filter((x) => !!x.rt)
        .sort((l, r) => (l.rt!.y - r.rt!.y));

      for (const { a, rt } of toDraw) {
        drawCharacter(ctx, characters, ROSTER.find((x) => x.key === a.key)!.characterIndex, rt!, a.status, a.label, a.key === selected);
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [live, props, selected, tilemap]);

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

      // topmost by y (reverse painter)
      const liveSorted = [...live]
        .filter((a) => a.status !== "offline")
        .map((a) => ({ a, rt: runtimeRef.current[a.key] }))
        .filter((x) => !!x.rt)
        .sort((l, r) => (r.rt!.y - l.rt!.y));

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
            <div className="text-xs text-slate-300">Canvas-rendered pixel art · real sprite sheets</div>
          </div>

          <div ref={containerRef} className="flex h-[520px] w-full items-center justify-center overflow-hidden rounded-lg bg-black/40">
            <canvas
              ref={canvasRef}
              width={INTERNAL_W}
              height={INTERNAL_H}
              className="select-none"
              style={{ imageRendering: "pixelated" as any }}
            />
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
                <div className="font-semibold text-slate-300">States</div>
                <ul className="mt-1 list-disc space-y-1 pl-4">
                  <li>
                    <span className="text-slate-200">Idle</span>: strolling around the office
                  </li>
                  <li>
                    <span className="text-slate-200">Active/Busy</span>: walks to desk and types
                  </li>
                  <li>
                    <span className="text-slate-200">Offline</span>: disappears (not rendered)
                  </li>
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
