"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";

// Pixel Office v4 — RPG-style top-down pixel art (canvas, pixel-perfect).

type AgentStatus = "active" | "busy" | "idle" | "offline";

type RosterKey = "yuri" | "jarvis" | "friday" | "glass" | "epstein";

type RosterAgent = {
  key: RosterKey;
  label: string;
};

const ROSTER: RosterAgent[] = [
  { key: "yuri", label: "Yuri" },
  { key: "jarvis", label: "Jarvis" },
  { key: "friday", label: "Friday" },
  { key: "glass", label: "Glass" },
  { key: "epstein", label: "Epstein" },
];

type LiveAgent = {
  key: RosterKey;
  name: string;
  status: AgentStatus;
  task?: string;
};

type Vec2 = { x: number; y: number };

type AnimState = {
  pos: Vec2;
  vel: Vec2;
  target: Vec2;
  facing: -1 | 1;
  phase: number;
  step: number;
  lastStatus: AgentStatus;
  lastTask?: string;
  speechStartMs: number;
  speechChars: number;
  lastClickMs: number;
};

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function nowMs() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function hashStr(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(next).width <= maxWidth) {
      cur = next;
    } else {
      if (cur) lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 2);
}

function pickAgentFromList(list: any[] | undefined, key: string, label: string) {
  if (!list) return undefined;
  const lowerKey = key.toLowerCase();
  const lowerLabel = label.toLowerCase();
  return (
    list.find((a: any) => (a.handle ?? "").toLowerCase() === lowerKey) ||
    list.find((a: any) => (a.name ?? "").toLowerCase() === lowerLabel)
  );
}

function statusDot(status: AgentStatus) {
  if (status === "active") return "#10b981";
  if (status === "busy") return "#f59e0b";
  if (status === "idle") return "#94a3b8";
  return "#6b7280";
}

type AgentLook = {
  skin: string;
  hair: string;
  outfitA: string;
  outfitB: string;
  shoes: string;
  accent: string;
  glasses?: boolean;
  hairKind: "short" | "side" | "afro" | "slick" | "white";
  suit?: boolean;
};

// Tuned to the reference: visible hair styles, diverse skin tones, distinct outfits.
const LOOK: Record<RosterKey, AgentLook> = {
  yuri: {
    skin: "#e9d2bb",
    hair: "#6b3f2a",
    outfitA: "#2b6ae6", // blue shirt
    outfitB: "#1f2a44",
    shoes: "#1b1f2a",
    accent: "#8ab5ff",
    hairKind: "side",
  },
  jarvis: {
    skin: "#e6d1bf",
    hair: "#161a22",
    outfitA: "#1d3559", // navy suit
    outfitB: "#0f1a30",
    shoes: "#0c0f16",
    accent: "#d1e4ff",
    suit: true,
    hairKind: "slick",
  },
  friday: {
    skin: "#7b4a3a",
    hair: "#111216",
    outfitA: "#d84b2a", // red/orange
    outfitB: "#1f2937",
    shoes: "#111216",
    accent: "#ff9c7a",
    hairKind: "afro",
  },
  glass: {
    skin: "#caa58f",
    hair: "#1a1c22",
    outfitA: "#1a1f2b", // dark outfit
    outfitB: "#0e121a",
    shoes: "#0c0f16",
    accent: "#a7b0c4",
    hairKind: "short",
  },
  epstein: {
    skin: "#ead5c2",
    hair: "#e6e6ea", // white hair
    outfitA: "#9b74c7", // muted purple
    outfitB: "#6b4b96",
    shoes: "#1b1f2a",
    accent: "#f3e8ff",
    glasses: true,
    hairKind: "white",
  },
};

type Palette = {
  wall: string;
  trim: string;
  shadow: string;
  wood1: string;
  wood2: string;
  wood3: string;
  tile1: string;
  tile2: string;
  carpet1: string;
  carpet2: string;
};

const PAL: Palette = {
  wall: "#1b2a3f", // dark blue
  trim: "#0f1a2a",
  shadow: "rgba(0,0,0,0.25)",
  wood1: "#7b5a2f",
  wood2: "#6b4c26",
  wood3: "#8b6a3a",
  tile1: "#d6d0c2",
  tile2: "#c9c2b2",
  carpet1: "#2b4f78",
  carpet2: "#244466",
};

export default function OfficePage() {
  const agents = useQuery(api.agents.getAll, {});
  const running = useQuery(api.agentRuns.getRecent, { status: "running", limit: 100 });

  const live: LiveAgent[] = useMemo(() => {
    const byAgentKey = new Map<string, any>();
    for (const r of running ?? []) {
      const k = String(r.agentId ?? "").toLowerCase();
      if (!k) continue;
      const prev = byAgentKey.get(k);
      if (!prev || (r.startedAt ?? 0) > (prev.startedAt ?? 0)) byAgentKey.set(k, r);
    }

    return ROSTER.map((r) => {
      const doc: any = pickAgentFromList(agents as any, r.key, r.label);
      const status: AgentStatus = (doc?.status as AgentStatus) ?? "offline";
      const run = byAgentKey.get(r.key);
      const task = run?.task || undefined;
      return { key: r.key, name: doc?.name ?? r.label, status, task };
    });
  }, [agents, running]);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-mono font-bold tracking-tight">Office</h1>
          <p className="text-sm text-muted-foreground">RPG-style pixel office (Canvas + Convex realtime). Click an agent.</p>
        </div>
        <div className="hidden md:flex items-center gap-3 text-xs font-mono text-muted-foreground">
          <LegendDot label="active" color={statusDot("active")} />
          <LegendDot label="busy" color={statusDot("busy")} />
          <LegendDot label="idle" color={statusDot("idle")} />
          <LegendDot label="offline" color={statusDot("offline")} />
        </div>
      </div>

      <OfficeCanvas agents={live} />

      <div className="text-xs text-muted-foreground font-mono">
        Pixel-perfect render: internal 384×256, scaled up with smoothing disabled. Agents shift rooms based on status.
      </div>
    </div>
  );
}

function LegendDot({ label, color }: { label: string; color: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

function OfficeCanvas({ agents }: { agents: LiveAgent[] }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Reference-like aspect: slightly taller than the previous version.
  const WORLD = useMemo(() => ({ w: 384, h: 256 }), []);

  const [ready, setReady] = useState(false);
  const [selected, setSelected] = useState<RosterKey | null>(null);

  const animRef = useRef<Record<string, AnimState>>({});

  const layout = useMemo(() => {
    // Rooms (approx match to reference)
    const main = { x: 0, y: 0, w: 248, h: 256 };
    const kitchen = { x: 248, y: 0, w: 136, h: 128 };
    const lounge = { x: 248, y: 128, w: 136, h: 128 };

    // Main office desk anchors (4 desks)
    const desks = {
      topLeft: { x: 64, y: 86 },
      topRight: { x: 144, y: 86 },
      botLeft: { x: 64, y: 164 },
      botRight: { x: 144, y: 164 },
    };

    const chairs = {
      topLeft: { x: 64, y: 108 },
      topRight: { x: 144, y: 108 },
      botLeft: { x: 64, y: 186 },
      botRight: { x: 144, y: 186 },
    };

    // Suggested positions for each agent by status.
    const stations: Record<RosterKey, { desk: Vec2; chair: Vec2; idle: Vec2; lounge: Vec2; kitchen: Vec2 }> = {
      yuri: {
        desk: desks.botLeft,
        chair: chairs.botLeft,
        idle: { x: 112, y: 130 },
        kitchen: { x: 318, y: 70 },
        lounge: { x: 300, y: 196 },
      },
      jarvis: {
        desk: desks.botRight,
        chair: chairs.botRight,
        idle: { x: 126, y: 126 },
        kitchen: { x: 318, y: 92 },
        lounge: { x: 336, y: 196 },
      },
      friday: {
        desk: desks.topRight,
        chair: chairs.topRight,
        idle: { x: 118, y: 128 }, // walking/standing in main
        kitchen: { x: 320, y: 78 },
        lounge: { x: 320, y: 172 },
      },
      glass: {
        desk: desks.topLeft,
        chair: chairs.topLeft,
        idle: { x: 88, y: 128 },
        kitchen: { x: 338, y: 78 },
        lounge: { x: 300, y: 198 }, // couch left
      },
      epstein: {
        desk: desks.topLeft,
        chair: chairs.topLeft,
        idle: { x: 96, y: 136 },
        kitchen: { x: 338, y: 92 },
        lounge: { x: 346, y: 198 }, // couch right
      },
    };

    // Bubble zones to reduce overlap.
    const zones: Record<RosterKey, { minX: number; maxX: number }> = {
      yuri: { minX: 8, maxX: 122 },
      jarvis: { minX: 122, maxX: 240 },
      friday: { minX: 92, maxX: 240 },
      glass: { minX: 248, maxX: 316 },
      epstein: { minX: 316, maxX: 384 },
    };

    return { main, kitchen, lounge, desks, chairs, stations, zones };
  }, []);

  // Resize canvas
  useEffect(() => {
    const el = containerRef.current;
    const c = canvasRef.current;
    if (!el || !c) return;

    const resize = () => {
      const rect = el.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;

      const cssW = Math.floor(rect.width);
      const cssH = Math.floor(Math.min(820, rect.width * (WORLD.h / WORLD.w)));

      c.style.width = `${cssW}px`;
      c.style.height = `${cssH}px`;
      c.width = Math.floor(cssW * dpr);
      c.height = Math.floor(cssH * dpr);
      setReady(true);
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    return () => ro.disconnect();
  }, [WORLD.h, WORLD.w]);

  // Pointer selection
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;

    const handle = (ev: PointerEvent) => {
      const rect = c.getBoundingClientRect();
      const cssX = ev.clientX - rect.left;
      const cssY = ev.clientY - rect.top;

      const scale = Math.min(rect.width / WORLD.w, rect.height / WORLD.h);
      const ox = (rect.width - WORLD.w * scale) / 2;
      const oy = (rect.height - WORLD.h * scale) / 2;

      const wx = (cssX - ox) / scale;
      const wy = (cssY - oy) / scale;

      let best: { key: RosterKey; d: number } | null = null;
      for (const a of agents) {
        const s = animRef.current[a.key];
        if (!s) continue;
        const d = Math.hypot(s.pos.x - wx, s.pos.y - wy);
        if (d < 14 && (!best || d < best.d)) best = { key: a.key, d };
      }

      if (best) {
        setSelected((prev) => (prev === best.key ? null : best.key));
        const s = animRef.current[best.key];
        if (s) s.lastClickMs = nowMs();
      } else {
        setSelected(null);
      }
    };

    c.addEventListener("pointerdown", handle);
    return () => c.removeEventListener("pointerdown", handle);
  }, [agents, WORLD.h, WORLD.w]);

  useEffect(() => {
    if (!ready) return;
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let lastT = nowMs();
    let lastRenderT = lastT;

    const tick = () => {
      const t = nowMs();
      // ~30fps cap
      if (t - lastRenderT < 33) {
        lastT = t;
        raf = requestAnimationFrame(tick);
        return;
      }

      const dt = clamp((t - lastT) / 1000, 0, 0.05);
      lastT = t;
      lastRenderT = t;

      const dpr = window.devicePixelRatio || 1;
      const cssW = c.clientWidth;
      const cssH = c.clientHeight;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.scale(dpr, dpr);

      const scale = Math.min(cssW / WORLD.w, cssH / WORLD.h);
      const ox = (cssW - WORLD.w * scale) / 2;
      const oy = (cssH - WORLD.h * scale) / 2;
      ctx.translate(ox, oy);
      ctx.scale(scale, scale);

      (ctx as any).imageSmoothingEnabled = false;

      // Draw world
      drawWorld(ctx, WORLD.w, WORLD.h, t, layout);

      // Agent anim/update/draw (sorted by y for top-down depth)
      const sorted = [...agents].sort((a, b) => {
        const sa = animRef.current[a.key];
        const sb = animRef.current[b.key];
        return (sa?.pos.y ?? 0) - (sb?.pos.y ?? 0);
      });

      for (const a of sorted) {
        const st = layout.stations[a.key];

        // Target selection based on status (matches reference intent)
        let target = st.idle;
        let typing = false;
        let sitting = false;
        let sleep = false;

        if (a.status === "active" || a.status === "busy") {
          // active/busy -> at desk typing
          target = st.chair;
          typing = true;
          sitting = true;
        } else if (a.status === "idle") {
          // idle -> stay at desk, no wandering
          target = st.chair;
        } else {
          // offline -> not visible; Glass/Epstein can "sleep" on couch (reference vibes)
          if (a.key === "glass" || a.key === "epstein") {
            target = st.lounge;
            sleep = true;
            sitting = true;
          } else {
            // hide offscreen
            target = { x: -40, y: -40 };
          }
        }

        const s = (animRef.current[a.key] ??= {
          pos: { ...target },
          vel: { x: 0, y: 0 },
          target: { ...target },
          facing: 1,
          phase: Math.random() * 10,
          step: Math.random() * 10,
          lastStatus: a.status,
          lastTask: a.task,
          speechStartMs: t,
          speechChars: 0,
          lastClickMs: 0,
        });

        // speech typing state when task changes
        if (s.lastTask !== a.task) {
          s.lastTask = a.task;
          s.speechStartMs = t;
          s.speechChars = 0;
        }

        s.target = target;

        const dx = s.target.x - s.pos.x;
        const dy = s.target.y - s.pos.y;
        const dist = Math.hypot(dx, dy);
        const walking = dist > 0.8;

        const desired = dist > 0.01 ? { x: dx / dist, y: dy / dist } : { x: 0, y: 0 };
        const speed = a.status === "busy" ? 54 : 44;

        const accel = 10;
        s.vel.x = lerp(s.vel.x, desired.x * speed, clamp(accel * dt, 0, 1));
        s.vel.y = lerp(s.vel.y, desired.y * speed, clamp(accel * dt, 0, 1));
        s.pos.x += s.vel.x * dt;
        s.pos.y += s.vel.y * dt;

        if (Math.abs(s.vel.x) > 1) s.facing = s.vel.x < 0 ? -1 : 1;

        s.phase += dt;
        if (walking) s.step += dt * (a.status === "busy" ? 10 : 8);

        // shadow (not for hidden offscreen)
        if (a.status !== "offline" || sleep) {
          ctx.save();
          ctx.globalAlpha = 0.25;
          ctx.fillStyle = "#000";
          ctx.beginPath();
          ctx.ellipse(s.pos.x, s.pos.y + 7, 8, 3, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }

        // selected ring
        if (selected === a.key && (a.status !== "offline" || sleep)) {
          ctx.save();
          ctx.globalAlpha = 0.85;
          ctx.strokeStyle = LOOK[a.key].accent;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.ellipse(s.pos.x, s.pos.y + 7, 12, 5, 0, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }

        // Draw agent (offline generally hidden; but couch sleepers visible)
        if (a.status !== "offline" || sleep) {
          drawAgent(ctx, {
            x: s.pos.x,
            y: s.pos.y,
            look: LOOK[a.key],
            status: a.status,
            phase: s.phase,
            step: s.step,
            walking,
            typing: typing && sitting,
            sitting,
            sleeping: sleep,
            facing: s.facing,
            clickedGlow: clamp(1 - (t - s.lastClickMs) / 220, 0, 1),
          });

          // label anchored above head (reference has no UI labels, keep tiny)
          drawTinyName(ctx, s.pos.x, s.pos.y - 22, a.name, a.status);

          // speech bubble disabled - task info only shown on click (via selected agent panel)
        }
      }

      // foreground overlay (subtle)
      drawForeground(ctx, WORLD.w, WORLD.h, t);

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [WORLD.h, WORLD.w, agents, layout, ready, selected]);

  const selectedAgent = selected ? agents.find((a) => a.key === selected) : null;

  return (
    <div className="space-y-3">
      <div
        ref={containerRef}
        className="w-full rounded-xl border border-border bg-card overflow-hidden relative"
        style={{ boxShadow: "0 0 0 1px rgba(0,0,0,0.25) inset" }}
      >
        <canvas ref={canvasRef} className="block" style={{ imageRendering: "pixelated" }} />

        <div className="absolute bottom-3 left-3 md:hidden text-[11px] font-mono text-muted-foreground bg-background/70 backdrop-blur border border-border rounded-md px-2 py-1">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: statusDot("active") }} />a
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: statusDot("busy") }} />b
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: statusDot("idle") }} />i
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: statusDot("offline") }} />o
            </span>
          </div>
        </div>
      </div>

      {selectedAgent ? (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: statusDot(selectedAgent.status) }} />
                <div className="font-mono font-semibold">{selectedAgent.name}</div>
              </div>
              <div className="text-xs text-muted-foreground font-mono mt-1">handle: {selectedAgent.key}</div>
            </div>
            <div className="text-xs font-mono text-muted-foreground">status: {selectedAgent.status}</div>
          </div>

          <div className="mt-3">
            <div className="text-xs font-mono text-muted-foreground">current task</div>
            <div className="text-sm font-mono mt-1">{selectedAgent.task ?? "—"}</div>
          </div>
        </div>
      ) : (
        <div className="text-xs font-mono text-muted-foreground">Tip: click an agent for details.</div>
      )}
    </div>
  );
}

// -----------------------------
// WORLD RENDERING (pixel art)
// -----------------------------

function drawWorld(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  t: number,
  layout: {
    main: { x: number; y: number; w: number; h: number };
    kitchen: { x: number; y: number; w: number; h: number };
    lounge: { x: number; y: number; w: number; h: number };
    desks: { topLeft: Vec2; topRight: Vec2; botLeft: Vec2; botRight: Vec2 };
  }
) {
  // Walls background
  ctx.fillStyle = PAL.wall;
  ctx.fillRect(0, 0, w, h);

  // Room floors
  drawWoodFloor(ctx, layout.main.x + 8, layout.main.y + 8, layout.main.w - 16, layout.main.h - 16);
  drawTileFloor(ctx, layout.kitchen.x + 8, layout.kitchen.y + 8, layout.kitchen.w - 16, layout.kitchen.h - 16);
  drawCarpet(ctx, layout.lounge.x + 8, layout.lounge.y + 8, layout.lounge.w - 16, layout.lounge.h - 16);

  // Room borders / trim
  drawRoomFrame(ctx, layout.main.x, layout.main.y, layout.main.w, layout.main.h);
  drawRoomFrame(ctx, layout.kitchen.x, layout.kitchen.y, layout.kitchen.w, layout.kitchen.h);
  drawRoomFrame(ctx, layout.lounge.x, layout.lounge.y, layout.lounge.w, layout.lounge.h);

  // Main office: bookshelves along top wall, boxes, plants
  drawBookshelfWide(ctx, 18, 18);
  drawBookshelfWide(ctx, 90, 18);
  drawPlantPot(ctx, 20, 58, t);
  drawBoxes(ctx, 64, 56);

  // Main office: 4 desks (reference-style)
  drawDesk(ctx, layout.desks.topLeft.x, layout.desks.topLeft.y, t);
  drawDesk(ctx, layout.desks.topRight.x, layout.desks.topRight.y, t);
  drawDesk(ctx, layout.desks.botLeft.x, layout.desks.botLeft.y, t);
  drawDesk(ctx, layout.desks.botRight.x, layout.desks.botRight.y, t);

  // office plants + CPU towers
  drawCpu(ctx, 38, 118, t);
  drawCpu(ctx, 196, 118, t + 200);
  drawPlantPot(ctx, 18, 210, t + 350);
  drawPlantPot(ctx, 208, 210, t + 900);

  // Kitchen: vending machine, clock, counter/cabinets, fridge, water cooler
  drawVending(ctx, 266, 20, t);
  drawWaterCooler(ctx, 320, 22, t);
  drawWallClock(ctx, 368 - 18, 18, t);
  drawCounter(ctx, 298, 76);
  drawFridge(ctx, 356, 20);
  drawTrash(ctx, 334, 66);

  // Lounge: couch, armchairs, table, painting, bookshelves, plants
  drawBookshelfSmall(ctx, 262, 144);
  drawBookshelfSmall(ctx, 352, 144);
  drawPainting(ctx, 302, 140);
  drawPlantTall(ctx, 300, 166, t);
  drawPlantTall(ctx, 340, 166, t + 420);
  drawCouchLounge(ctx, 292, 186);
  drawArmchair(ctx, 276, 184, -1);
  drawArmchair(ctx, 360, 184, 1);
  drawCoffeeTableLounge(ctx, 320, 196, t);

  // doorway hints (openings)
  drawDoorGap(ctx, 248, 116);
  drawDoorGap(ctx, 248, 148);
}

function drawRoomFrame(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  // Outer shadow
  ctx.save();
  ctx.globalAlpha = 0.45;
  ctx.fillStyle = "#000";
  ctx.fillRect(x + 2, y + 2, w, h);
  ctx.restore();

  // Frame
  ctx.fillStyle = PAL.trim;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = PAL.wall;
  ctx.fillRect(x + 6, y + 6, w - 12, h - 12);

  // inner edge highlight
  ctx.save();
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = "#9fb5d6";
  ctx.fillRect(x + 6, y + 6, w - 12, 1);
  ctx.fillRect(x + 6, y + 6, 1, h - 12);
  ctx.restore();
}

function drawDoorGap(ctx: CanvasRenderingContext2D, x: number, y: number) {
  // small opening in the partition wall between rooms
  ctx.fillStyle = "#0a0f18";
  ctx.fillRect(x - 1, y, 10, 14);
  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = "#000";
  ctx.fillRect(x + 6, y + 1, 2, 12);
  ctx.restore();
}

function drawWoodFloor(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  // base
  ctx.fillStyle = PAL.wood2;
  ctx.fillRect(x, y, w, h);
  // planks/tiles (8x8)
  for (let yy = y; yy < y + h; yy += 8) {
    for (let xx = x; xx < x + w; xx += 8) {
      const alt = (((xx >> 3) + (yy >> 3)) & 1) === 0;
      ctx.fillStyle = alt ? PAL.wood1 : PAL.wood3;
      ctx.fillRect(xx, yy, 8, 8);
      // grain
      ctx.save();
      ctx.globalAlpha = 0.08;
      ctx.fillStyle = "#000";
      ctx.fillRect(xx + 1, yy + 2, 6, 1);
      ctx.fillRect(xx + 2, yy + 5, 5, 1);
      ctx.restore();
    }
  }
}

function drawTileFloor(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = PAL.tile1;
  ctx.fillRect(x, y, w, h);
  for (let yy = y; yy < y + h; yy += 8) {
    for (let xx = x; xx < x + w; xx += 8) {
      const alt = (((xx >> 3) + (yy >> 3)) & 1) === 0;
      ctx.fillStyle = alt ? PAL.tile1 : PAL.tile2;
      ctx.fillRect(xx, yy, 8, 8);
    }
  }
  // grout lines
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = "#000";
  for (let yy = y; yy <= y + h; yy += 8) ctx.fillRect(x, yy, w, 1);
  for (let xx = x; xx <= x + w; xx += 8) ctx.fillRect(xx, y, 1, h);
  ctx.restore();
}

function drawCarpet(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = PAL.carpet2;
  ctx.fillRect(x, y, w, h);
  for (let yy = y; yy < y + h; yy += 8) {
    for (let xx = x; xx < x + w; xx += 8) {
      const alt = (((xx >> 3) + (yy >> 3)) & 1) === 0;
      ctx.fillStyle = alt ? PAL.carpet1 : PAL.carpet2;
      ctx.fillRect(xx, yy, 8, 8);
      // fibers
      ctx.save();
      ctx.globalAlpha = 0.06;
      ctx.fillStyle = "#fff";
      ctx.fillRect(xx + 2, yy + 1, 1, 1);
      ctx.fillRect(xx + 5, yy + 4, 1, 1);
      ctx.restore();
    }
  }
  // rug border
  ctx.save();
  ctx.globalAlpha = 0.30;
  ctx.strokeStyle = "#0b1624";
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 2, y + 2, w - 4, h - 4);
  ctx.restore();
}

// -----------------------------
// Furniture sprites
// -----------------------------

function drawBookshelfWide(ctx: CanvasRenderingContext2D, x: number, y: number) {
  // 60x30 bookshelf
  ctx.fillStyle = "#4b2f1f";
  ctx.fillRect(x, y, 64, 30);
  ctx.fillStyle = "#3b2418";
  ctx.fillRect(x + 2, y + 2, 60, 26);

  // shelves
  ctx.fillStyle = "#2a1a12";
  ctx.fillRect(x + 2, y + 10, 60, 1);
  ctx.fillRect(x + 2, y + 19, 60, 1);

  // books
  const colors = ["#ef4444", "#3b82f6", "#22c55e", "#eab308", "#a855f7", "#f97316"];
  for (let row = 0; row < 3; row++) {
    const by = y + 3 + row * 9;
    for (let i = 0; i < 12; i++) {
      const bx = x + 5 + i * 5;
      const c = colors[(i + row * 2) % colors.length];
      ctx.fillStyle = c;
      ctx.fillRect(bx, by + 1, 3, 7);
      ctx.save();
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = "#fff";
      ctx.fillRect(bx + 1, by + 2, 1, 4);
      ctx.restore();
    }
  }
}

function drawBookshelfSmall(ctx: CanvasRenderingContext2D, x: number, y: number) {
  // 30x24
  ctx.fillStyle = "#4b2f1f";
  ctx.fillRect(x, y, 30, 24);
  ctx.fillStyle = "#3b2418";
  ctx.fillRect(x + 2, y + 2, 26, 20);
  ctx.fillStyle = "#2a1a12";
  ctx.fillRect(x + 2, y + 9, 26, 1);
  ctx.fillRect(x + 2, y + 16, 26, 1);

  const colors = ["#ef4444", "#3b82f6", "#22c55e", "#eab308", "#a855f7", "#f97316"];
  for (let row = 0; row < 3; row++) {
    const by = y + 3 + row * 7;
    for (let i = 0; i < 5; i++) {
      const bx = x + 4 + i * 5;
      ctx.fillStyle = colors[(i + row) % colors.length];
      ctx.fillRect(bx, by + 1, 3, 5);
    }
  }
}

function drawBoxes(ctx: CanvasRenderingContext2D, x: number, y: number) {
  // two stacked boxes
  ctx.fillStyle = "#caa86b";
  ctx.fillRect(x, y, 20, 12);
  ctx.fillStyle = "#b89255";
  ctx.fillRect(x + 2, y + 2, 16, 8);
  ctx.save();
  ctx.globalAlpha = 0.2;
  ctx.fillStyle = "#000";
  ctx.fillRect(x, y + 11, 20, 1);
  ctx.restore();

  ctx.fillStyle = "#d7b97d";
  ctx.fillRect(x + 10, y - 10, 18, 10);
  ctx.fillStyle = "#caa86b";
  ctx.fillRect(x + 12, y - 8, 14, 6);
}

function drawDesk(ctx: CanvasRenderingContext2D, cx: number, cy: number, t: number) {
  // Desk centered at (cx, cy) ~ 52x24
  const x = Math.round(cx - 26);
  const y = Math.round(cy - 12);

  // shadow
  ctx.save();
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = "#000";
  ctx.fillRect(x + 2, y + 22, 52, 5);
  ctx.restore();

  // wood top
  ctx.fillStyle = "#5f3f22";
  ctx.fillRect(x, y, 52, 16);
  ctx.fillStyle = "#4d321c";
  ctx.fillRect(x, y + 14, 52, 2);

  // wood grain stripes
  ctx.save();
  ctx.globalAlpha = 0.20;
  ctx.fillStyle = "#000";
  for (let i = 0; i < 6; i++) ctx.fillRect(x + 3 + i * 8, y + 2, 1, 12);
  ctx.restore();

  // legs
  ctx.fillStyle = "#3b2418";
  ctx.fillRect(x + 6, y + 16, 6, 12);
  ctx.fillRect(x + 40, y + 16, 6, 12);

  // monitor
  ctx.fillStyle = "#1b1f2a";
  ctx.fillRect(x + 18, y + 2, 18, 10);
  ctx.fillStyle = "#111827";
  ctx.fillRect(x + 19, y + 3, 16, 8);
  // screen glow purple/pink
  const glow = 0.55 + 0.45 * ((Math.sin((t + cx * 11) / 350) + 1) / 2);
  ctx.save();
  ctx.globalAlpha = 0.20 + 0.22 * glow;
  ctx.fillStyle = glow > 0.8 ? "#ff4dd8" : "#a855f7";
  ctx.fillRect(x + 20, y + 4, 14, 6);
  ctx.restore();

  // stand
  ctx.fillStyle = "#111827";
  ctx.fillRect(x + 26, y + 12, 2, 3);

  // keyboard
  ctx.fillStyle = "#0b1220";
  ctx.fillRect(x + 16, y + 16, 22, 4);
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = "#fff";
  ctx.fillRect(x + 18, y + 17, 18, 1);
  ctx.restore();

  // mug
  ctx.fillStyle = "#e5e7eb";
  ctx.fillRect(x + 6, y + 7, 4, 5);
  ctx.fillStyle = "#cbd5e1";
  ctx.fillRect(x + 10, y + 8, 1, 3);

  // paper
  ctx.fillStyle = "#f1f5f9";
  ctx.fillRect(x + 38, y + 6, 6, 5);
  ctx.save();
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = "#0b1220";
  ctx.fillRect(x + 39, y + 8, 4, 1);
  ctx.restore();

  // chair (beige)
  drawChair(ctx, cx, cy + 22);
}

function drawChair(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
  const x = Math.round(cx - 7);
  const y = Math.round(cy - 6);

  // shadow
  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = "#000";
  ctx.fillRect(x + 1, y + 12, 14, 3);
  ctx.restore();

  // seat
  ctx.fillStyle = "#d7c4a1";
  ctx.fillRect(x, y + 6, 14, 5);
  ctx.fillStyle = "#c8b18f";
  ctx.fillRect(x, y + 10, 14, 1);

  // back
  ctx.fillStyle = "#d7c4a1";
  ctx.fillRect(x + 2, y - 2, 10, 8);
  ctx.fillStyle = "#c8b18f";
  ctx.fillRect(x + 2, y - 2, 10, 1);

  // legs
  ctx.fillStyle = "#2a1a12";
  ctx.fillRect(x + 3, y + 11, 2, 5);
  ctx.fillRect(x + 9, y + 11, 2, 5);
}

function drawCpu(ctx: CanvasRenderingContext2D, x: number, y: number, t: number) {
  ctx.fillStyle = "#101827";
  ctx.fillRect(x, y, 10, 16);
  ctx.fillStyle = "#0b1220";
  ctx.fillRect(x + 1, y + 1, 8, 14);
  // vents
  ctx.save();
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = "#94a3b8";
  for (let i = 0; i < 4; i++) ctx.fillRect(x + 2, y + 3 + i * 3, 6, 1);
  ctx.restore();
  // led
  const on = ((Math.sin((t + x * 10) / 260) + 1) / 2) > 0.65;
  ctx.fillStyle = on ? "#22c55e" : "#334155";
  ctx.fillRect(x + 7, y + 13, 1, 1);
}

function drawPlantPot(ctx: CanvasRenderingContext2D, x: number, y: number, t: number) {
  // pot (light)
  ctx.fillStyle = "#e7d9c4";
  ctx.fillRect(x, y + 10, 12, 8);
  ctx.fillStyle = "#d8c8b1";
  ctx.fillRect(x, y + 16, 12, 2);

  const sway = Math.sin((t + x * 13) / 900) * 1.2;
  ctx.fillStyle = "#22c55e";
  ctx.fillRect(x + 5 + sway, y + 2, 2, 9);
  ctx.fillRect(x + 2 - sway, y + 5, 2, 6);
  ctx.fillRect(x + 8 + sway, y + 5, 2, 6);

  ctx.fillStyle = "#16a34a";
  ctx.fillRect(x + 3, y + 4, 6, 2);
  ctx.fillRect(x + 2, y + 7, 8, 2);
}

function drawPlantTall(ctx: CanvasRenderingContext2D, x: number, y: number, t: number) {
  // white pot
  ctx.fillStyle = "#e7d9c4";
  ctx.fillRect(x, y + 18, 14, 9);
  ctx.fillStyle = "#d8c8b1";
  ctx.fillRect(x, y + 25, 14, 2);

  const sway = Math.sin((t + x * 9) / 1000) * 1.4;
  ctx.fillStyle = "#16a34a";
  ctx.fillRect(x + 6 + sway, y + 4, 2, 15);
  ctx.fillStyle = "#22c55e";
  ctx.fillRect(x + 2, y + 10, 4, 4);
  ctx.fillRect(x + 8, y + 9, 4, 4);
  ctx.fillRect(x + 4, y + 3, 6, 6);
}

function drawVending(ctx: CanvasRenderingContext2D, x: number, y: number, t: number) {
  // 32x46
  ctx.fillStyle = "#2b2f3a";
  ctx.fillRect(x, y, 32, 46);
  ctx.fillStyle = "#1f2937";
  ctx.fillRect(x + 2, y + 2, 28, 42);

  // display window
  ctx.fillStyle = "#0b1220";
  ctx.fillRect(x + 4, y + 6, 16, 26);
  ctx.fillStyle = "#111827";
  ctx.fillRect(x + 5, y + 7, 14, 24);
  // items
  const cols = ["#ef4444", "#22c55e", "#3b82f6", "#eab308", "#f97316", "#a855f7"];
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 2; c++) {
      const ix = x + 7 + c * 6;
      const iy = y + 9 + r * 5;
      ctx.fillStyle = cols[(r * 2 + c) % cols.length];
      ctx.fillRect(ix, iy, 4, 3);
    }
  }

  // keypad
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(x + 22, y + 10, 6, 10);
  ctx.save();
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = "#e5e7eb";
  for (let i = 0; i < 6; i++) ctx.fillRect(x + 23 + (i % 2) * 2, y + 11 + ((i / 2) | 0) * 2, 1, 1);
  ctx.restore();

  // coin slot + glow
  ctx.fillStyle = "#0b1220";
  ctx.fillRect(x + 22, y + 24, 6, 3);
  const on = ((Math.sin((t + x * 10) / 350) + 1) / 2) > 0.6;
  ctx.fillStyle = on ? "#22c55e" : "#334155";
  ctx.fillRect(x + 24, y + 26, 1, 1);

  // bottom tray
  ctx.fillStyle = "#111827";
  ctx.fillRect(x + 4, y + 35, 24, 7);
  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = "#000";
  ctx.fillRect(x + 4, y + 41, 24, 1);
  ctx.restore();
}

function drawWaterCooler(ctx: CanvasRenderingContext2D, x: number, y: number, t: number) {
  // 18x36
  ctx.fillStyle = "#cbd5e1";
  ctx.fillRect(x, y + 10, 18, 26);
  ctx.fillStyle = "#94a3b8";
  ctx.fillRect(x, y + 34, 18, 2);

  // bottle
  ctx.save();
  ctx.globalAlpha = 0.75;
  ctx.fillStyle = "#7dd3fc";
  ctx.fillRect(x + 4, y, 10, 12);
  ctx.restore();

  // spout
  ctx.fillStyle = "#0b1220";
  ctx.fillRect(x + 8, y + 22, 2, 2);

  // drip blink
  const on = ((Math.sin((t + y * 17) / 420) + 1) / 2) > 0.7;
  if (on) {
    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = "#38bdf8";
    ctx.fillRect(x + 9, y + 25, 1, 2);
    ctx.restore();
  }
}

function drawWallClock(ctx: CanvasRenderingContext2D, x: number, y: number, t: number) {
  // 14x14
  ctx.fillStyle = "#e5e7eb";
  ctx.fillRect(x, y, 14, 14);
  ctx.fillStyle = "#cbd5e1";
  ctx.fillRect(x + 1, y + 1, 12, 12);
  // hands
  const m = ((t / 1000) * 2) % (Math.PI * 2);
  ctx.fillStyle = "#0b1220";
  ctx.fillRect(x + 7, y + 7, 1, 1);
  // minute hand
  ctx.save();
  ctx.translate(x + 7, y + 7);
  ctx.rotate(m);
  ctx.fillRect(0, -5, 1, 5);
  ctx.restore();
  // hour hand
  ctx.save();
  ctx.translate(x + 7, y + 7);
  ctx.rotate(m * 0.4);
  ctx.fillRect(0, -3, 1, 3);
  ctx.restore();
}

function drawCounter(ctx: CanvasRenderingContext2D, x: number, y: number) {
  // long counter
  ctx.fillStyle = "#d6d0c2";
  ctx.fillRect(x, y, 76, 12);
  ctx.fillStyle = "#b8b2a4";
  ctx.fillRect(x, y + 10, 76, 2);
  // cabinets
  ctx.fillStyle = "#a89f90";
  ctx.fillRect(x, y + 12, 76, 16);
  ctx.fillStyle = "#8f887c";
  ctx.fillRect(x + 36, y + 12, 1, 16);
  // handles
  ctx.fillStyle = "#64748b";
  ctx.fillRect(x + 16, y + 20, 2, 1);
  ctx.fillRect(x + 56, y + 20, 2, 1);
}

function drawFridge(ctx: CanvasRenderingContext2D, x: number, y: number) {
  // 20x46
  ctx.fillStyle = "#e5e7eb";
  ctx.fillRect(x, y, 20, 46);
  ctx.fillStyle = "#cbd5e1";
  ctx.fillRect(x + 1, y + 1, 18, 44);
  // split door
  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = "#000";
  ctx.fillRect(x + 1, y + 22, 18, 1);
  ctx.restore();
  // handles
  ctx.fillStyle = "#94a3b8";
  ctx.fillRect(x + 16, y + 6, 2, 10);
  ctx.fillRect(x + 16, y + 28, 2, 10);
}

function drawTrash(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.fillStyle = "#9ca3af";
  ctx.fillRect(x, y, 10, 12);
  ctx.fillStyle = "#6b7280";
  ctx.fillRect(x, y, 10, 2);
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = "#000";
  ctx.fillRect(x, y + 11, 10, 1);
  ctx.restore();
}

function drawPainting(ctx: CanvasRenderingContext2D, x: number, y: number) {
  // 40x14
  ctx.fillStyle = "#3b2418";
  ctx.fillRect(x, y, 40, 14);
  ctx.fillStyle = "#111827";
  ctx.fillRect(x + 2, y + 2, 36, 10);
  // landscape
  ctx.fillStyle = "#38bdf8";
  ctx.fillRect(x + 2, y + 2, 36, 5);
  ctx.fillStyle = "#22c55e";
  ctx.fillRect(x + 2, y + 7, 36, 5);
  ctx.fillStyle = "#eab308";
  ctx.fillRect(x + 6, y + 5, 3, 2);
  ctx.fillStyle = "#0ea5e9";
  ctx.fillRect(x + 28, y + 4, 5, 2);
}

function drawCouchLounge(ctx: CanvasRenderingContext2D, x: number, y: number) {
  // 64x26
  ctx.save();
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = "#000";
  ctx.fillRect(x + 2, y + 22, 64, 5);
  ctx.restore();

  ctx.fillStyle = "#b7846a"; // brown couch
  ctx.fillRect(x, y, 64, 18);
  ctx.fillStyle = "#9a6b55";
  ctx.fillRect(x, y + 16, 64, 6);

  // cushions
  ctx.fillStyle = "#c8957a";
  ctx.fillRect(x + 6, y + 4, 18, 10);
  ctx.fillRect(x + 24, y + 4, 18, 10);
  ctx.fillRect(x + 42, y + 4, 16, 10);

  // arms
  ctx.fillStyle = "#8b5f4b";
  ctx.fillRect(x, y + 2, 6, 18);
  ctx.fillRect(x + 58, y + 2, 6, 18);
}

function drawArmchair(ctx: CanvasRenderingContext2D, x: number, y: number, facing: -1 | 1) {
  // 18x18
  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = "#000";
  ctx.fillRect(x + 1, y + 16, 18, 3);
  ctx.restore();

  ctx.fillStyle = "#b7846a";
  ctx.fillRect(x, y, 18, 12);
  ctx.fillStyle = "#9a6b55";
  ctx.fillRect(x, y + 10, 18, 6);
  ctx.fillStyle = "#8b5f4b";
  ctx.fillRect(x, y + 2, 4, 12);
  ctx.fillRect(x + 14, y + 2, 4, 12);

  // back cushion accent
  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = "#fff";
  ctx.fillRect(x + (facing === 1 ? 6 : 7), y + 3, 1, 6);
  ctx.restore();
}

function drawCoffeeTableLounge(ctx: CanvasRenderingContext2D, x: number, y: number, t: number) {
  // 26x16
  ctx.save();
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = "#000";
  ctx.fillRect(x - 12, y + 10, 26, 4);
  ctx.restore();

  ctx.fillStyle = "#6b4c26";
  ctx.fillRect(x - 12, y, 26, 10);
  ctx.fillStyle = "#5a3f22";
  ctx.fillRect(x - 12, y + 8, 26, 2);

  // legs
  ctx.fillStyle = "#3b2418";
  ctx.fillRect(x - 10, y + 10, 2, 6);
  ctx.fillRect(x + 10, y + 10, 2, 6);

  // mug on table
  ctx.fillStyle = "#e5e7eb";
  ctx.fillRect(x - 2, y + 2, 4, 4);
  ctx.fillStyle = "#cbd5e1";
  ctx.fillRect(x + 2, y + 3, 1, 2);

  // subtle shine
  ctx.save();
  ctx.globalAlpha = 0.10 + 0.06 * ((Math.sin(t / 700) + 1) / 2);
  ctx.fillStyle = "#fff";
  ctx.fillRect(x - 10, y + 2, 10, 1);
  ctx.restore();
}

// -----------------------------
// Agent sprite (RPG-like 16–20px)
// -----------------------------

function drawAgent(
  ctx: CanvasRenderingContext2D,
  p: {
    x: number;
    y: number;
    look: AgentLook;
    status: AgentStatus;
    phase: number;
    step: number;
    walking: boolean;
    typing: boolean;
    sitting: boolean;
    sleeping: boolean;
    facing: -1 | 1;
    clickedGlow: number;
  }
) {
  const { x, y, look, status, phase, step, walking, typing, sitting, sleeping, facing, clickedGlow } = p;

  const sx = Math.round(x);
  const sy = Math.round(y - 18);

  // click glow
  if (clickedGlow > 0) {
    ctx.save();
    ctx.globalAlpha = 0.16 * clickedGlow;
    ctx.fillStyle = look.accent;
    ctx.fillRect(sx - 10, sy - 6, 20, 26);
    ctx.restore();
  }

  const px = (dx: number) => sx + dx * facing;

  // idle blink
  const blink = !walking && !sleeping && ((Math.sin(phase * 1.6 + 1.9) + 1) / 2) > 0.965;

  // 4-frame walk
  const frame = walking ? (((step * 2) | 0) % 4) : 0;
  const legA = frame === 1 ? 1 : frame === 3 ? -1 : 0;
  const legB = -legA;

  // typing arm toggle
  const hand = typing ? ((((phase * 8) | 0) % 2 === 0) ? 1 : 0) : 0;

  // sitting offset
  const sit = sitting ? 3 : 0;
  const sleep = sleeping ? 2 : 0;

  ctx.save();
  ctx.globalAlpha = status === "offline" && !sleeping ? 0.75 : 1;

  // HEAD (8x7)
  ctx.fillStyle = look.skin;
  ctx.fillRect(px(-4), sy + 3 + sleep, 8, 6);

  // HAIR (varies)
  if (look.hairKind === "afro") {
    ctx.fillStyle = look.hair;
    ctx.fillRect(px(-5), sy + 1 + sleep, 10, 4);
    ctx.fillRect(px(-4), sy + 0 + sleep, 8, 2);
  } else if (look.hairKind === "white") {
    ctx.fillStyle = look.hair;
    ctx.fillRect(px(-4), sy + 1 + sleep, 8, 2);
    ctx.fillRect(px(-3), sy + 3 + sleep, 6, 1);
  } else if (look.hairKind === "slick") {
    ctx.fillStyle = look.hair;
    ctx.fillRect(px(-4), sy + 1 + sleep, 8, 2);
    ctx.fillRect(px(-2), sy + 3 + sleep, 6, 1);
  } else if (look.hairKind === "side") {
    ctx.fillStyle = look.hair;
    ctx.fillRect(px(-4), sy + 1 + sleep, 8, 2);
    ctx.fillRect(px(-4), sy + 3 + sleep, 2, 2);
  } else {
    ctx.fillStyle = look.hair;
    ctx.fillRect(px(-4), sy + 1 + sleep, 8, 2);
  }

  // EYES
  ctx.fillStyle = "rgba(15,23,42,0.85)";
  if (blink) {
    ctx.fillRect(px(-2), sy + 6 + sleep, 2, 1);
    ctx.fillRect(px(1), sy + 6 + sleep, 2, 1);
  } else {
    ctx.fillRect(px(-2), sy + 6 + sleep, 1, 1);
    ctx.fillRect(px(2), sy + 6 + sleep, 1, 1);
  }

  // glasses for Epstein
  if (look.glasses) {
    ctx.save();
    ctx.globalAlpha = 0.75;
    ctx.fillStyle = "#0b1220";
    ctx.fillRect(px(-3), sy + 5 + sleep, 3, 2);
    ctx.fillRect(px(0), sy + 5 + sleep, 3, 2);
    ctx.fillRect(px(-0), sy + 6 + sleep, 1, 1);
    ctx.restore();
  }

  // TORSO
  ctx.fillStyle = look.outfitA;
  ctx.fillRect(px(-5), sy + 9 + sit + sleep, 10, 7);

  // suit stripes (Jarvis)
  if (look.suit) {
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = "#e5e7eb";
    ctx.fillRect(px(-3), sy + 10 + sit + sleep, 1, 6);
    ctx.fillRect(px(-1), sy + 10 + sit + sleep, 1, 6);
    ctx.fillRect(px(1), sy + 10 + sit + sleep, 1, 6);
    ctx.restore();
  }

  // ARMS
  ctx.fillStyle = look.outfitB;
  const armY = sy + 10 + sit + sleep + (typing ? 2 : 0);
  ctx.fillRect(px(-7), armY + hand, 2, 5);
  ctx.fillRect(px(5), armY - hand, 2, 5);

  // HANDS
  ctx.fillStyle = look.skin;
  ctx.fillRect(px(-7), armY + 4 + hand, 2, 1);
  ctx.fillRect(px(5), armY + 4 - hand, 2, 1);

  // PANTS
  ctx.fillStyle = look.outfitB;
  ctx.fillRect(px(-4), sy + 16 + sit + sleep, 8, 4);

  // LEGS + SHOES
  if (!sitting) {
    ctx.fillStyle = look.outfitB;
    ctx.fillRect(px(-3), sy + 20 + sleep, 3, 3 + Math.max(0, legA));
    ctx.fillRect(px(0), sy + 20 + sleep, 3, 3 + Math.max(0, legB));
    ctx.fillStyle = look.shoes;
    ctx.fillRect(px(-3), sy + 23 + sleep + Math.max(0, legA), 3, 2);
    ctx.fillRect(px(0), sy + 23 + sleep + Math.max(0, legB), 3, 2);
  } else {
    // seated legs tucked
    ctx.fillStyle = look.outfitB;
    ctx.fillRect(px(-4), sy + 20 + sit + sleep, 8, 2);
    ctx.fillStyle = look.shoes;
    ctx.fillRect(px(-2), sy + 22 + sit + sleep, 4, 2);
  }

  // sleeping Z
  if (sleeping) {
    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = "#e5e7eb";
    ctx.font = "7px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillText("z", sx + 7, sy + 6);
    ctx.restore();
  }

  ctx.restore();
}

function drawTinyName(ctx: CanvasRenderingContext2D, x: number, y: number, name: string, status: AgentStatus) {
  const label = name.slice(0, 10);
  ctx.save();
  ctx.font = "7px ui-monospace, SFMono-Regular, Menlo, monospace";
  const tw = ctx.measureText(label).width;
  const w = clamp(Math.ceil(tw) + 10, 24, 64);
  const lx = Math.round(x - w / 2);
  const ly = Math.round(y - 8);

  ctx.globalAlpha = 0.72;
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  roundRect(ctx, lx, ly, w, 10, 4);
  ctx.fill();

  ctx.fillStyle = statusDot(status);
  ctx.fillRect(lx + 4, ly + 4, 2, 2);

  ctx.fillStyle = "#e5e7eb";
  ctx.fillText(label, lx + 9, ly + 8);
  ctx.restore();
}

function drawSpeechBubble(
  ctx: CanvasRenderingContext2D,
  p: { x: number; y: number; text: string; hot: boolean; bounds?: { minX: number; maxX: number } }
) {
  ctx.save();
  ctx.font = "7px ui-monospace, SFMono-Regular, Menlo, monospace";

  const maxW = 92;
  const lines = wrapText(ctx, p.text, maxW);
  const lineH = 9;
  const pad = 6;

  const bubbleW = Math.min(
    maxW + pad * 2,
    Math.max(56, ...lines.map((l) => ctx.measureText(l).width + pad * 2))
  );
  const bubbleH = lines.length * lineH + pad * 2;

  const minX = p.bounds ? p.bounds.minX + 2 : 4;
  const maxX = p.bounds ? p.bounds.maxX - bubbleW - 2 : 384 - bubbleW - 4;
  const x = clamp(p.x - bubbleW / 2, minX, maxX);
  const y = clamp(p.y - bubbleH, 6, 256 - bubbleH - 6);

  ctx.fillStyle = p.hot ? "rgba(251,191,36,0.20)" : "rgba(168,85,247,0.18)";
  ctx.strokeStyle = p.hot ? "rgba(251,191,36,0.45)" : "rgba(168,85,247,0.40)";
  roundRect(ctx, x, y, bubbleW, bubbleH, 6);
  ctx.fill();
  ctx.stroke();

  // tail
  const tailX = clamp(p.x, x + 12, x + bubbleW - 12);
  ctx.fillStyle = p.hot ? "rgba(251,191,36,0.20)" : "rgba(168,85,247,0.18)";
  ctx.beginPath();
  ctx.moveTo(tailX - 4, y + bubbleH);
  ctx.lineTo(tailX + 5, y + bubbleH);
  ctx.lineTo(tailX, y + bubbleH + 7);
  ctx.closePath();
  ctx.fill();

  // text
  ctx.fillStyle = "#f8fafc";
  let yy = y + pad + 7;
  for (const line of lines) {
    ctx.fillText(line, x + pad, yy);
    yy += lineH;
  }

  // cursor blink
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = "#f8fafc";
  if (((nowMs() / 240) | 0) % 2 === 0) ctx.fillRect(x + bubbleW - pad - 6, y + bubbleH - pad - 6, 4, 1);
  ctx.restore();

  ctx.restore();
}

function drawForeground(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  // Subtle scanlines + vignette like the reference screenshot capture
  ctx.save();
  ctx.globalAlpha = 0.05;
  ctx.fillStyle = "#000";
  for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
  ctx.restore();

  const g = ctx.createRadialGradient(w / 2, h / 2, 40, w / 2, h / 2, 260);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(0,0,0,0.35)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // tiny grain dots
  ctx.save();
  ctx.globalAlpha = 0.04;
  ctx.fillStyle = "#fff";
  for (let i = 0; i < 40; i++) {
    const x = (hashStr(`${i}-${(t / 80) | 0}`) % w) | 0;
    const y = (hashStr(`${i}-${(t / 120) | 0}-y`) % h) | 0;
    ctx.fillRect(x, y, 1, 1);
  }
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
