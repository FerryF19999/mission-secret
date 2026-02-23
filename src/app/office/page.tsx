"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";

type AgentStatus = "active" | "busy" | "idle" | "offline";

type RosterAgent = {
  key: "yuri" | "jarvis" | "friday" | "glass" | "epstein";
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
  key: RosterAgent["key"];
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
  lastStatus: AgentStatus;
  lastTask?: string;
  phase: number; // time accumulator
  step: number; // walk cycle accumulator
  speechStartMs: number;
  speechChars: number;
  lastClickMs: number;
};

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  kind: "spark" | "code";
  ch?: string;
  color: string;
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
  // offline should feel calm/neutral (gray), not alarming red
  return "#6b7280";
}

// WIB day/night palette
function getWibPalette(date = new Date()) {
  // WIB = UTC+7
  const utc = date.getTime() + date.getTimezoneOffset() * 60_000;
  const wib = new Date(utc + 7 * 60 * 60_000);
  const h = wib.getHours() + wib.getMinutes() / 60;

  // 0..1 day factor: 0 = midnight, 1 = noon
  const dayness = clamp(Math.sin(((h - 6) / 12) * Math.PI) * 0.9 + 0.1, 0, 1);

  const wall = mixHex("#0b1220", "#0b2033", dayness);
  const wallPanel = mixHex("#0f1a30", "#113a55", dayness);
  const floorA = mixHex("#07101f", "#0a1a2b", dayness);
  const floorB = mixHex("#0b1730", "#0c2237", dayness);
  const floorC = mixHex("#09142a", "#0b1e31", dayness);
  const ambient = dayness;

  return {
    wib,
    dayness,
    wall,
    wallPanel,
    floorA,
    floorB,
    floorC,
    ambient,
    windowSky: mixHex("#081229", "#2aa3ff", dayness),
    windowGlow: mixHex("rgba(56,189,248,0.18)", "rgba(56,189,248,0.12)", 1 - dayness),
    lampWarm: mixHex("rgba(251,191,36,0.06)", "rgba(251,191,36,0.14)", 1 - dayness),
  };
}

function hexToRgb(hex: string) {
  const h = hex.replace("#", "").trim();
  const v = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
}

function mixHex(a: string, b: string, t: number) {
  // supports #RRGGBB only; fallback to a if format unknown
  if (!a.startsWith("#") || !b.startsWith("#")) return a;
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  const r = Math.round(lerp(A.r, B.r, t));
  const g = Math.round(lerp(A.g, B.g, t));
  const bb = Math.round(lerp(A.b, B.b, t));
  return `rgb(${r} ${g} ${bb})`;
}

type AgentLook = {
  // main palette
  skin: string;
  hair: string;
  shirt: string;
  pants: string;
  shoes: string;
  accent: string;
  // accessories
  glasses?: boolean;
  beanie?: boolean;
  cap?: boolean;
  suit?: boolean;
  coat?: boolean;
};

const LOOK: Record<RosterAgent["key"], AgentLook> = {
  yuri: {
    skin: "#e8d6c2",
    hair: "#1f2937",
    shirt: "#2563eb", // blue hoodie
    pants: "#0f172a",
    shoes: "#111827",
    accent: "#93c5fd",
    glasses: true,
  },
  jarvis: {
    skin: "#ead7c7",
    hair: "#0f172a",
    shirt: "#16a34a", // green suit
    pants: "#064e3b",
    shoes: "#0b0f16",
    accent: "#86efac",
    suit: true,
  },
  friday: {
    skin: "#efd9c7",
    hair: "#111827",
    shirt: "#f97316", // creative orange
    pants: "#1f2937",
    shoes: "#111827",
    accent: "#fdba74",
    beanie: true,
  },
  glass: {
    skin: "#ead7c7",
    hair: "#111827",
    shirt: "#7c3aed", // purple coat
    pants: "#1f2937",
    shoes: "#111827",
    accent: "#d8b4fe",
    coat: true,
  },
  epstein: {
    skin: "#ead7c7",
    hair: "#111827",
    shirt: "#ef4444", // energetic
    pants: "#0f172a",
    shoes: "#111827",
    accent: "#fca5a5",
    cap: true,
  },
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
          <p className="text-sm text-muted-foreground">
            Pixel office (Canvas + Convex realtime). Click an agent to inspect what they’re doing.
          </p>
        </div>
        <div className="hidden md:flex items-center gap-3 text-xs font-mono text-muted-foreground">
          <LegendDot label="active" color="#10b981" />
          <LegendDot label="busy" color="#f59e0b" />
          <LegendDot label="idle" color="#94a3b8" />
          <LegendDot label="offline" color="#ef4444" />
        </div>
      </div>

      <OfficeCanvas agents={live} />

      <div className="text-xs text-muted-foreground font-mono">
        Animations: walk (4 frames), idle (blink + very subtle breathe), typing (hands only), minimal particles when busy. Offline desks are
        empty. Day/night palette uses WIB time.
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

  const WORLD = useMemo(() => ({ w: 384, h: 216 }), []);

  const [ready, setReady] = useState(false);
  const [selected, setSelected] = useState<RosterAgent["key"] | null>(null);
  const [muted, setMuted] = useState(true);

  const animRef = useRef<Record<string, AnimState>>({});
  const particlesRef = useRef<Record<string, Particle[]>>({});

  // minimalistic audio (typing ticks + small spark blips)
  const audioRef = useRef<{
    ctx: AudioContext | null;
    master: GainNode | null;
    lastTypeAt: Record<string, number>;
  }>({ ctx: null, master: null, lastTypeAt: {} });

  const layout = useMemo(() => {
    // world coordinates (pixels). Calm, fixed layout: each agent has a dedicated station.
    // Chairs sit slightly below desks.
    const desks = [
      { key: "yuri", desk: { x: 90, y: 90 }, chair: { x: 88, y: 112 } },
      { key: "jarvis", desk: { x: 150, y: 92 }, chair: { x: 148, y: 114 } },
      { key: "friday", desk: { x: 210, y: 90 }, chair: { x: 208, y: 112 } },
      { key: "glass", desk: { x: 270, y: 92 }, chair: { x: 268, y: 114 } },
      { key: "epstein", desk: { x: 330, y: 90 }, chair: { x: 328, y: 112 } },
    ] as const;

    // Per-desk speech bubble zones (prevents overlap between neighboring desks)
    const zones = desks.map((d, i) => {
      const prev = desks[i - 1];
      const next = desks[i + 1];
      const minX = prev ? Math.floor((prev.desk.x + d.desk.x) / 2) : 0;
      const maxX = next ? Math.floor((next.desk.x + d.desk.x) / 2) : 384;
      return { key: d.key, minX, maxX };
    });

    return { desks, zones };
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
      const cssH = Math.floor(Math.min(640, rect.width * (WORLD.h / WORLD.w)));

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

  // Pointer handling for selection + sound init gesture
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

      // init audio on first interaction
      if (!audioRef.current.ctx) {
        try {
          const AC = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
          const ctx = new AC();
          const master = ctx.createGain();
          master.gain.value = muted ? 0 : 0.25;
          master.connect(ctx.destination);
          audioRef.current.ctx = ctx;
          audioRef.current.master = master;
        } catch {
          // ignore
        }
      }

      // hit test agents
      let best: { key: RosterAgent["key"]; d: number } | null = null;
      for (const a of agents) {
        const s = animRef.current[a.key];
        if (!s) continue;
        const d = Math.hypot(s.pos.x - wx, s.pos.y - wy);
        if (d < 16 && (!best || d < best.d)) best = { key: a.key, d };
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
  }, [agents, WORLD.h, WORLD.w, muted]);

  // Reflect mute state into audio graph
  useEffect(() => {
    const master = audioRef.current.master;
    if (master) master.gain.value = muted ? 0 : 0.25;
  }, [muted]);

  useEffect(() => {
    if (!ready) return;
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let lastT = nowMs();
    let lastRenderT = lastT;

    const rosterLook = LOOK;

    const tick = () => {
      const t = nowMs();

      // 30fps cap (calmer + lighter on CPU)
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

      // pixel feel
      (ctx as any).imageSmoothingEnabled = false;

      const pal = getWibPalette(new Date());

      // precompute agent states for monitor glow and overlays
      const liveMap = new Map(agents.map((a) => [a.key, a] as const));

      drawOffice(ctx, WORLD.w, WORLD.h, t, pal, liveMap);

      // sort by y for pseudo-depth
      const sorted = [...agents].sort((a, b) => {
        const sa = animRef.current[a.key];
        const sb = animRef.current[b.key];
        return (sa?.pos.y ?? 0) - (sb?.pos.y ?? 0);
      });

      for (const a of sorted) {
        const desk = layout.desks.find((d) => d.key === a.key)!;

        // Calm office: agents stay at their desks.
        // Offline desks are empty (no character drawn).
        const target = desk.chair;

        const s = (animRef.current[a.key] ??= {
          pos: { ...target },
          vel: { x: 0, y: 0 },
          target: { ...target },
          facing: 1,
          lastStatus: a.status,
          lastTask: a.task,
          phase: Math.random() * 10,
          step: Math.random() * 10,
          speechStartMs: t,
          speechChars: 0,
          lastClickMs: 0,
        });

        // update speech typing state when task changes
        if (s.lastTask !== a.task) {
          s.lastTask = a.task;
          s.speechStartMs = t;
          s.speechChars = 0;
        }

        // update target & movement
        s.target = { ...target };

        const dx = s.target.x - s.pos.x;
        const dy = s.target.y - s.pos.y;
        const dist = Math.hypot(dx, dy);
        const walking = dist > 0.8;

        const desired = dist > 0.01 ? { x: (dx / dist) * 1, y: (dy / dist) * 1 } : { x: 0, y: 0 };
        const speed = a.status === "busy" ? 44 : 34;

        // critically damped-ish smoothing
        const accel = 12;
        s.vel.x = lerp(s.vel.x, desired.x * speed, clamp(accel * dt, 0, 1));
        s.vel.y = lerp(s.vel.y, desired.y * speed, clamp(accel * dt, 0, 1));

        s.pos.x += s.vel.x * dt;
        s.pos.y += s.vel.y * dt;

        if (Math.abs(s.vel.x) > 1) s.facing = s.vel.x < 0 ? -1 : 1;

        s.phase += dt;
        if (walking) s.step += dt * (a.status === "busy" ? 10 : 8);

        // State transitions
        if (s.lastStatus !== a.status) {
          s.lastStatus = a.status;
          // small burst when becoming busy
          if (a.status === "busy") burstParticles(particlesRef, a.key, s.pos.x, s.pos.y - 14, rosterLook[a.key].accent);
        }

        if (a.status !== "offline") {
          // shadow
          ctx.save();
          ctx.globalAlpha = 0.25;
          ctx.fillStyle = "#000";
          ctx.beginPath();
          ctx.ellipse(s.pos.x, s.pos.y + 6, 9, 4, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();

          // selected ring
          if (selected === a.key) {
            ctx.save();
            ctx.globalAlpha = 0.8;
            ctx.strokeStyle = rosterLook[a.key].accent;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.ellipse(s.pos.x, s.pos.y + 6, 13, 7, 0, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
          }

          // draw particles behind sprite
          updateAndDrawParticles(ctx, particlesRef, a.key, dt);
        }

        // draw sprite
        const atDesk = Math.hypot(s.pos.x - desk.chair.x, s.pos.y - desk.chair.y) < 5;

        // Draw the agent only when not offline (offline desk stays empty).
        if (a.status !== "offline") {
          drawAgentSprite(ctx, {
            x: s.pos.x,
            y: s.pos.y,
            look: rosterLook[a.key],
            status: a.status,
            phase: s.phase,
            step: s.step,
            walking,
            typing: atDesk && (a.status === "active" || a.status === "busy"),
            sleeping: false,
            facing: s.facing,
            clickedGlow: clamp(1 - (t - s.lastClickMs) / 220, 0, 1),
          });
        }

        // Desk label always visible and anchored to the station (not the sprite).
        drawNameLabel(ctx, desk.desk.x, desk.desk.y + 36, a.name, a.status, rosterLook[a.key].accent);

        // active/busy: speech bubble with typed text effect
        if ((a.status === "active" || a.status === "busy") && a.task) {
          const full = a.task.length > 25 ? `${a.task.slice(0, 25)}…` : a.task;
          const elapsed = Math.max(0, t - s.speechStartMs);
          const targetChars = clamp(Math.floor(elapsed / (a.status === "busy" ? 18 : 26)), 0, full.length);
          s.speechChars = Math.max(s.speechChars, targetChars);
          const shown = full.slice(0, s.speechChars);

          // Stagger bubble heights: alternate between two rows to prevent overlap
          const agentIdx = ROSTER.findIndex((r) => r.key === a.key);
          const staggerY = agentIdx % 2 === 0 ? -50 : -18;

          const zone = layout.zones.find((z) => z.key === a.key);
          drawSpeechBubble(ctx, {
            x: desk.desk.x,
            y: desk.desk.y + staggerY,
            text: shown,
            hot: a.status === "busy",
            bounds: zone ? { minX: zone.minX, maxX: zone.maxX } : undefined,
          });
        }

        // busy: very subtle particles (keep it calm)
        if (a.status === "busy") {
          const h = hashStr(a.key) % 1000;
          const prevBucket = Math.floor((t - dt * 1000 + h) / 700);
          const bucket = Math.floor((t + h) / 700);
          if (bucket !== prevBucket) {
            spawnCodeParticle(particlesRef, a.key, s.pos.x + 7 * s.facing, s.pos.y - 18, rosterLook[a.key].accent);
          }
        }

        // typing audio
        maybeTypingSound(audioRef, muted, a.key, a.status, atDesk, t);
      }

      drawForeground(ctx, WORLD.w, WORLD.h, t, pal);

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [WORLD.h, WORLD.w, agents, layout, ready, selected, muted]);

  const selectedAgent = selected ? agents.find((a) => a.key === selected) : null;

  return (
    <div className="space-y-3">
      <div
        ref={containerRef}
        className="w-full rounded-xl border border-border bg-card overflow-hidden relative"
        style={{ boxShadow: "0 0 0 1px rgba(0,0,0,0.25) inset" }}
      >
        <canvas ref={canvasRef} className="block" style={{ imageRendering: "pixelated" }} />

        <div className="absolute top-3 right-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMuted((m) => !m)}
            className="px-2 py-1 rounded-md border border-border bg-background/70 backdrop-blur text-xs font-mono"
            title="Toggle sound"
          >
            {muted ? "Sound: off" : "Sound: on"}
          </button>
        </div>

        <div className="absolute bottom-3 left-3 md:hidden text-[11px] font-mono text-muted-foreground bg-background/70 backdrop-blur border border-border rounded-md px-2 py-1">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: "#10b981" }} />a</span>
            <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: "#f59e0b" }} />b</span>
            <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: "#94a3b8" }} />i</span>
            <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: "#ef4444" }} />o</span>
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

          <div className="mt-3 flex items-center gap-2 text-xs font-mono text-muted-foreground">
            <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: "#10b981" }} />active</span>
            <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: "#f59e0b" }} />busy</span>
            <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: "#94a3b8" }} />idle</span>
            <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: "#ef4444" }} />offline</span>
            <span className="ml-auto">click agent again to close</span>
          </div>
        </div>
      ) : (
        <div className="text-xs font-mono text-muted-foreground">Tip: click an agent for details.</div>
      )}
    </div>
  );
}

function drawOffice(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  t: number,
  pal: ReturnType<typeof getWibPalette>,
  liveMap: Map<string, LiveAgent>
) {
  // Background wall
  ctx.fillStyle = pal.wall;
  ctx.fillRect(0, 0, w, h);

  // Back wall panel band
  ctx.fillStyle = pal.wallPanel;
  ctx.fillRect(0, 0, w, 68);

  // window with city
  drawWindow(ctx, w - 120, 16, 98, 44, t, pal);

  // whiteboard
  drawWhiteboard(ctx, 18, 16, 92, 44, t);

  // bookshelf + server rack cluster
  drawBookshelf(ctx, 18, 72, t);
  drawServerRack(ctx, w - 56, 76, t);

  // neon sign
  drawNeon(ctx, w / 2 - 58, 18, t);

  // Floor base
  const floorY = 68;
  ctx.fillStyle = pal.floorA;
  ctx.fillRect(0, floorY, w, h - floorY);

  // subtle patterned tiles (8x8)
  for (let y = floorY; y < h; y += 8) {
    for (let x = 0; x < w; x += 8) {
      const alt = (((x >> 3) + (y >> 3)) & 1) === 0;
      ctx.fillStyle = alt ? pal.floorB : pal.floorC;
      ctx.fillRect(x, y, 8, 8);
      // tiny speckles
      const noise = ((hashStr(`${x},${y}`) ^ ((t / 1000) | 0)) & 7) === 0;
      if (noise) {
        ctx.globalAlpha = 0.12;
        ctx.fillStyle = "#000";
        ctx.fillRect(x + 6, y + 1, 1, 1);
        ctx.globalAlpha = 1;
      }
    }
  }

  // lounge rug + couch
  drawRug(ctx, 30, 148, 150, 54, t, pal.dayness);
  drawCouch(ctx, 38, 162, t, pal.dayness);
  drawCoffeeTable(ctx, 118, 172, t);

  // plants (animated sway)
  drawPlant(ctx, 222, 158, t);
  drawPlant(ctx, 12, 156, t + 400);

  // desk bay
  const deskRowY = 84;
  const deskX0 = 62;
  const deskStep = 60;

  for (let i = 0; i < 5; i++) {
    const x = deskX0 + i * deskStep;
    // glow if agent active/busy at that desk
    const agentKey = (ROSTER[i]?.key ?? "") as string;
    const st = liveMap.get(agentKey)?.status;
    const glow = st === "active" ? 0.55 : st === "busy" ? 0.75 : 0.15;

    drawDeskCluster(ctx, x, deskRowY, t, glow);
  }

  // hanging lamps (warm at night)
  drawLamps(ctx, 86, 54, t, pal);
  drawLamps(ctx, 196, 54, t + 140, pal);
  drawLamps(ctx, 306, 54, t + 280, pal);

  // subtle light pools at night
  if (pal.dayness < 0.5) {
    ctx.save();
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = pal.lampWarm;
    ctx.fillRect(0, floorY, w, h - floorY);
    ctx.restore();
  }

  // wall trim shadow
  ctx.save();
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, floorY, w, 2);
  ctx.restore();
}

function drawForeground(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, pal: ReturnType<typeof getWibPalette>) {
  // scanlines
  ctx.save();
  ctx.globalAlpha = 0.06;
  ctx.fillStyle = "#000";
  for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
  ctx.restore();

  // vignette
  const g = ctx.createRadialGradient(w / 2, h / 2 + 10, 40, w / 2, h / 2 + 10, 260);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, pal.dayness > 0.6 ? "rgba(0,0,0,0.26)" : "rgba(0,0,0,0.42)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // clock (WIB)
  ctx.save();
  ctx.globalAlpha = 0.75;
  ctx.fillStyle = "#94a3b8";
  ctx.font = "8px ui-monospace, SFMono-Regular, Menlo, monospace";
  const d = pal.wib;
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  ctx.fillText(`WIB ${hh}:${mm}`, 10, 16);
  ctx.restore();

  // film grain dots
  ctx.save();
  ctx.globalAlpha = 0.05;
  ctx.fillStyle = "#fff";
  for (let i = 0; i < 36; i++) {
    const x = (hashStr(`${i}-${(t / 80) | 0}`) % w) | 0;
    const y = (hashStr(`${i}-${(t / 120) | 0}-y`) % h) | 0;
    ctx.fillRect(x, y, 1, 1);
  }
  ctx.restore();
}

function drawNeon(ctx: CanvasRenderingContext2D, x: number, y: number, t: number) {
  const pulse = 0.55 + 0.45 * Math.sin(t / 600);
  ctx.save();
  ctx.globalAlpha = 0.16 + 0.2 * pulse;
  ctx.fillStyle = "#22d3ee";
  roundRect(ctx, x, y, 116, 22, 6);
  ctx.fill();
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = "#a5f3fc";
  ctx.font = "9px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText("MISSION CONTROL", x + 10, y + 14);
  ctx.restore();
}

function drawWindow(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, t: number, pal: ReturnType<typeof getWibPalette>) {
  // frame
  ctx.fillStyle = "#0b1020";
  ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
  ctx.fillStyle = "#111827";
  ctx.fillRect(x, y, w, h);

  // sky
  ctx.fillStyle = pal.windowSky;
  ctx.fillRect(x + 2, y + 2, w - 4, h - 4);

  // city blocks + twinkles
  const cityY = y + Math.floor(h * 0.58);
  for (let i = 0; i < 10; i++) {
    const bx = x + 3 + i * 9;
    const bh = 6 + ((hashStr(`${i}-b`) % 12) | 0);
    ctx.fillStyle = "rgba(2,6,23,0.55)";
    ctx.fillRect(bx, cityY + (10 - (bh >> 1)), 7, bh);

    // windows
    for (let k = 0; k < 6; k++) {
      const on = ((hashStr(`${i}-${k}-${(t / 900) | 0}`) >> 2) & 7) === 0;
      if (!on) continue;
      ctx.fillStyle = "rgba(255,255,255,0.22)";
      ctx.fillRect(bx + 1 + ((k & 1) * 3), cityY + 2 + ((k >> 1) * 2), 1, 1);
    }
  }

  // glass reflection
  ctx.save();
  ctx.globalAlpha = pal.dayness > 0.5 ? 0.15 : 0.22;
  ctx.fillStyle = "#93c5fd";
  ctx.beginPath();
  ctx.moveTo(x + 4, y + 3);
  ctx.lineTo(x + 24, y + 3);
  ctx.lineTo(x + 4, y + 26);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // mullions
  ctx.strokeStyle = "rgba(148,163,184,0.35)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + w / 2, y);
  ctx.lineTo(x + w / 2, y + h);
  ctx.moveTo(x, y + h / 2);
  ctx.lineTo(x + w, y + h / 2);
  ctx.stroke();

  // border
  ctx.strokeStyle = "rgba(226,232,240,0.18)";
  ctx.strokeRect(x, y, w, h);
}

function drawWhiteboard(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, t: number) {
  ctx.fillStyle = "#0b1020";
  ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
  ctx.fillStyle = "#e5e7eb";
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "rgba(148,163,184,0.18)";
  ctx.fillRect(x, y, w, 6);

  // scribbles
  ctx.save();
  ctx.globalAlpha = 0.8;
  ctx.fillStyle = "#334155";
  ctx.fillRect(x + 8, y + 14, 30, 2);
  ctx.fillRect(x + 8, y + 20, 46, 2);
  ctx.fillRect(x + 8, y + 26, 40, 2);
  ctx.fillStyle = "#0ea5e9";
  ctx.fillRect(x + 58, y + 16, 22, 2);
  ctx.fillRect(x + 58, y + 22, 16, 2);
  ctx.fillStyle = "#f97316";
  const dot = ((Math.sin(t / 520) + 1) / 2) > 0.5;
  if (dot) ctx.fillRect(x + 76, y + 34, 2, 2);
  ctx.restore();

  // markers
  ctx.fillStyle = "#111827";
  ctx.fillRect(x + 10, y + h - 4, 30, 2);
  ctx.fillStyle = "#ef4444";
  ctx.fillRect(x + 12, y + h - 6, 4, 2);
  ctx.fillStyle = "#22c55e";
  ctx.fillRect(x + 18, y + h - 6, 4, 2);
  ctx.fillStyle = "#3b82f6";
  ctx.fillRect(x + 24, y + h - 6, 4, 2);
}

function drawBookshelf(ctx: CanvasRenderingContext2D, x: number, y: number, t: number) {
  // frame
  ctx.fillStyle = "#1f2937";
  ctx.fillRect(x, y, 46, 66);
  ctx.fillStyle = "#111827";
  ctx.fillRect(x + 2, y + 2, 42, 62);

  // shelves
  for (let i = 0; i < 3; i++) {
    const sy = y + 8 + i * 18;
    ctx.fillStyle = "#1f2937";
    ctx.fillRect(x + 2, sy, 42, 2);

    // books
    for (let k = 0; k < 7; k++) {
      const bx = x + 6 + k * 5;
      const bh = 10 + ((hashStr(`${i}-${k}`) % 6) | 0);
      const c = ["#ef4444", "#3b82f6", "#f97316", "#22c55e", "#a855f7"][k % 5];
      ctx.fillStyle = c;
      ctx.fillRect(bx, sy - bh + 14, 3, bh);
      ctx.fillStyle = "rgba(255,255,255,0.15)";
      ctx.fillRect(bx + 1, sy - bh + 16, 1, 6);
    }

    // small blinking gadget
    if (i === 2) {
      const on = ((Math.sin(t / 320) + 1) / 2) > 0.65;
      ctx.fillStyle = "#0b0f16";
      ctx.fillRect(x + 30, y + 54, 10, 6);
      ctx.fillStyle = on ? "#22c55e" : "#334155";
      ctx.fillRect(x + 38, y + 57, 1, 1);
    }
  }
}

function drawServerRack(ctx: CanvasRenderingContext2D, x: number, y: number, t: number) {
  ctx.fillStyle = "#0b0f16";
  ctx.fillRect(x, y, 34, 84);
  ctx.fillStyle = "#111827";
  ctx.fillRect(x + 2, y + 2, 30, 80);

  // rack units
  for (let i = 0; i < 7; i++) {
    const ry = y + 6 + i * 11;
    ctx.fillStyle = i % 2 === 0 ? "#0f172a" : "#0b1220";
    ctx.fillRect(x + 4, ry, 26, 9);

    // LEDs
    const blink = ((hashStr(`${i}-${(t / 600) | 0}`) & 3) === 0);
    ctx.fillStyle = blink ? "#22c55e" : "#334155";
    ctx.fillRect(x + 6, ry + 3, 1, 1);
    ctx.fillStyle = "#f59e0b";
    if (((hashStr(`${i}-a`) + ((t / 200) | 0)) & 7) === 0) ctx.fillRect(x + 8, ry + 3, 1, 1);

    // vents
    ctx.fillStyle = "rgba(148,163,184,0.15)";
    for (let k = 0; k < 6; k++) ctx.fillRect(x + 12 + k * 3, ry + 4, 1, 1);
  }

  // label
  ctx.save();
  ctx.globalAlpha = 0.75;
  ctx.fillStyle = "#93c5fd";
  ctx.font = "7px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText("RACK", x + 7, y + 14);
  ctx.restore();
}

function drawDeskCluster(ctx: CanvasRenderingContext2D, x: number, y: number, t: number, glow: number) {
  // soft shadow
  ctx.save();
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = "#000";
  ctx.fillRect(x - 4, y + 26, 56, 6);
  ctx.restore();

  // desk top with depth
  ctx.fillStyle = "#2b2f3a";
  ctx.fillRect(x, y, 52, 18);
  ctx.fillStyle = "#1c202a";
  ctx.fillRect(x, y + 16, 52, 4);

  // legs
  ctx.fillStyle = "#0b0f16";
  ctx.fillRect(x + 6, y + 20, 6, 16);
  ctx.fillRect(x + 40, y + 20, 6, 16);

  // monitor
  ctx.fillStyle = "#0b0f16";
  ctx.fillRect(x + 16, y + 2, 20, 12);
  ctx.fillStyle = "#111827";
  ctx.fillRect(x + 17, y + 3, 18, 10);

  // screen glow (active/busy)
  ctx.save();
  ctx.globalAlpha = 0.10 + 0.22 * glow;
  ctx.fillStyle = glow > 0.6 ? "#22d3ee" : "#38bdf8";
  ctx.fillRect(x + 18, y + 4, 16, 8);
  // flicker pixel
  const flick = ((hashStr(`${x}-${(t / 240) | 0}`) & 7) === 0);
  if (flick) ctx.fillRect(x + 30, y + 8, 1, 1);
  ctx.restore();

  // monitor stand
  ctx.fillStyle = "#111827";
  ctx.fillRect(x + 24, y + 14, 4, 4);

  // keyboard + mouse
  ctx.fillStyle = "#0b0f16";
  ctx.fillRect(x + 14, y + 18, 22, 4);
  ctx.fillRect(x + 38, y + 19, 4, 3);

  // mug
  ctx.fillStyle = "#334155";
  ctx.fillRect(x + 6, y + 8, 5, 6);
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.fillRect(x + 7, y + 9, 1, 3);
  ctx.strokeStyle = "rgba(226,232,240,0.25)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 6, y + 8, 5, 6);
  ctx.fillStyle = "rgba(148,163,184,0.20)";
  ctx.fillRect(x + 11, y + 10, 2, 2);

  // chair
  drawChair(ctx, x + 18, y + 26);
}

function drawChair(ctx: CanvasRenderingContext2D, x: number, y: number) {
  // seat
  ctx.fillStyle = "#111827";
  ctx.fillRect(x, y, 14, 5);
  // back
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(x + 1, y - 8, 12, 8);
  // legs
  ctx.fillStyle = "#0b0f16";
  ctx.fillRect(x + 3, y + 5, 2, 6);
  ctx.fillRect(x + 9, y + 5, 2, 6);
  // wheels
  ctx.fillRect(x + 1, y + 11, 3, 2);
  ctx.fillRect(x + 10, y + 11, 3, 2);
}

function drawRug(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, t: number, dayness: number) {
  ctx.save();
  ctx.globalAlpha = 0.16 + (1 - dayness) * 0.08;
  ctx.fillStyle = "#6366f1";
  roundRect(ctx, x, y, w, h, 8);
  ctx.fill();

  // pattern
  ctx.globalAlpha = 0.10;
  ctx.fillStyle = "#a5b4fc";
  const off = ((t / 900) | 0) % 8;
  for (let yy = y + 8; yy < y + h - 8; yy += 10) {
    for (let xx = x + 8; xx < x + w - 8; xx += 10) {
      ctx.fillRect(xx + off, yy, 2, 2);
    }
  }

  ctx.restore();
}

function drawCouch(ctx: CanvasRenderingContext2D, x: number, y: number, t: number, dayness: number) {
  // shadow
  ctx.save();
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = "#000";
  ctx.fillRect(x + 2, y + 18, 62, 6);
  ctx.restore();

  // base
  ctx.fillStyle = "#334155";
  ctx.fillRect(x, y, 66, 18);
  ctx.fillStyle = "#1f2937";
  ctx.fillRect(x, y + 16, 66, 6);

  // cushions
  ctx.fillStyle = "#475569";
  const sway = Math.sin(t / 1200) * 0.6;
  ctx.fillRect(x + 6, y + 4 + sway, 18, 10);
  ctx.fillRect(x + 26, y + 4 - sway, 18, 10);
  ctx.fillRect(x + 46, y + 4 + sway, 14, 10);

  // arm rests
  ctx.fillStyle = "#1f2937";
  ctx.fillRect(x, y + 2, 6, 16);
  ctx.fillRect(x + 60, y + 2, 6, 16);

  // throw blanket (warm at night)
  ctx.save();
  ctx.globalAlpha = 0.35 + (1 - dayness) * 0.2;
  ctx.fillStyle = "#f97316";
  ctx.fillRect(x + 42, y + 10, 18, 6);
  ctx.restore();
}

function drawCoffeeTable(ctx: CanvasRenderingContext2D, x: number, y: number, t: number) {
  // top
  ctx.fillStyle = "#2b2f3a";
  ctx.fillRect(x, y, 32, 10);
  ctx.fillStyle = "#1c202a";
  ctx.fillRect(x, y + 8, 32, 2);

  // legs
  ctx.fillStyle = "#0b0f16";
  ctx.fillRect(x + 4, y + 10, 3, 8);
  ctx.fillRect(x + 25, y + 10, 3, 8);

  // laptop
  ctx.fillStyle = "#0b0f16";
  ctx.fillRect(x + 10, y + 2, 12, 6);
  ctx.save();
  ctx.globalAlpha = 0.18 + 0.08 * ((Math.sin(t / 500) + 1) / 2);
  ctx.fillStyle = "#22d3ee";
  ctx.fillRect(x + 11, y + 3, 10, 4);
  ctx.restore();

  // notebook
  ctx.fillStyle = "#e5e7eb";
  ctx.fillRect(x + 2, y + 2, 6, 6);
  ctx.fillStyle = "rgba(148,163,184,0.6)";
  ctx.fillRect(x + 3, y + 4, 4, 1);
}

function drawPlant(ctx: CanvasRenderingContext2D, x: number, y: number, t: number) {
  // pot
  ctx.fillStyle = "#3f2d22";
  ctx.fillRect(x, y + 18, 14, 9);
  ctx.fillStyle = "#2c1f18";
  ctx.fillRect(x, y + 25, 14, 2);

  // sway
  const sway = Math.sin(t / 900) * 1.2;

  // stems
  ctx.fillStyle = "#16a34a";
  ctx.fillRect(x + 6 + sway, y + 5, 2, 14);
  ctx.fillRect(x + 3 - sway, y + 10, 2, 10);
  ctx.fillRect(x + 9 + sway, y + 10, 2, 10);

  // leaves
  ctx.fillStyle = "#22c55e";
  ctx.fillRect(x + 2, y + 8, 4, 4);
  ctx.fillRect(x + 8, y + 8, 4, 4);
  ctx.fillRect(x + 4, y + 2, 5, 5);

  // highlight
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = "#bbf7d0";
  ctx.fillRect(x + 4, y + 3, 1, 2);
  ctx.restore();
}

function drawLamps(ctx: CanvasRenderingContext2D, x: number, y: number, t: number, pal: ReturnType<typeof getWibPalette>) {
  // cable
  ctx.fillStyle = "rgba(148,163,184,0.35)";
  ctx.fillRect(x + 6, 0, 1, y);

  // shade
  ctx.fillStyle = "#0b0f16";
  ctx.fillRect(x, y, 14, 6);
  ctx.fillStyle = "#111827";
  ctx.fillRect(x + 1, y + 1, 12, 5);

  // bulb + flicker
  const flick = 0.65 + 0.35 * ((Math.sin((t + x * 13) / 240) + 1) / 2);
  const warm = (1 - pal.dayness) * flick;
  ctx.save();
  ctx.globalAlpha = 0.18 + 0.24 * warm;
  ctx.fillStyle = "#fbbf24";
  ctx.fillRect(x + 6, y + 6, 2, 2);
  ctx.restore();

  // light cone at night
  if (pal.dayness < 0.45) {
    ctx.save();
    ctx.globalAlpha = 0.05 + 0.08 * warm;
    ctx.fillStyle = "#fbbf24";
    ctx.beginPath();
    ctx.moveTo(x + 7, y + 8);
    ctx.lineTo(x - 18, y + 62);
    ctx.lineTo(x + 32, y + 62);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

function drawAgentSprite(ctx: CanvasRenderingContext2D, p: {
  x: number;
  y: number;
  look: AgentLook;
  status: AgentStatus;
  phase: number;
  step: number;
  walking: boolean;
  typing: boolean;
  sleeping: boolean;
  facing: -1 | 1;
  clickedGlow: number;
}) {
  const { x, y, look, status, phase, step, walking, typing, sleeping, facing, clickedGlow } = p;

  const alpha = status === "offline" ? 0.55 : 1;

  // sprite anchor
  const sx = Math.round(x);
  const sy = Math.round(y - 18);

  // click glow
  if (clickedGlow > 0) {
    ctx.save();
    ctx.globalAlpha = 0.22 * clickedGlow;
    ctx.fillStyle = look.accent;
    ctx.fillRect(sx - 10, sy - 6, 20, 24);
    ctx.restore();
  }

  ctx.save();
  ctx.globalAlpha = alpha;

  // Idle animation should be extremely subtle: no whole-body bobbing.
  // We keep a tiny "chest pixel" pulse instead of moving the entire sprite.
  const breathe = 0;
  const chestPulse = !walking && !typing && !sleeping ? (Math.sin(phase * 0.8) + 1) / 2 : 0;

  // walk cycle (4 frames)
  const frame = walking ? (((step * 2) | 0) % 4) : 0;
  const legA = frame === 0 ? 0 : frame === 1 ? 1 : frame === 2 ? 0 : -1;
  const legB = -legA;

  // typing arms: small, rhythmic hand movement only
  const arm = typing ? ((((phase * 6) | 0) % 2 === 0) ? 1 : 0) : 0;

  // (sleeping handled elsewhere; offline desks are empty)
  const sleepTilt = 0;

  // helper for flipping
  const px = (dx: number) => sx + dx * facing;

  // head
  ctx.fillStyle = look.skin;
  ctx.fillRect(px(-4), sy + breathe + 2, 8, 6);

  // hair / hat
  if (look.beanie) {
    ctx.fillStyle = "#f97316";
    ctx.fillRect(px(-4), sy + breathe, 8, 3);
    ctx.fillRect(px(-3), sy + breathe + 3, 6, 1);
  } else if (look.cap) {
    ctx.fillStyle = "#ef4444";
    ctx.fillRect(px(-4), sy + breathe, 8, 2);
    ctx.fillRect(px(-2), sy + breathe + 2, 6, 1);
    ctx.fillRect(px(4), sy + breathe + 2, 3, 1); // brim
  } else {
    ctx.fillStyle = look.hair;
    ctx.fillRect(px(-4), sy + breathe, 8, 2);
  }

  // glasses
  if (look.glasses) {
    ctx.fillStyle = "rgba(15,23,42,0.85)";
    ctx.fillRect(px(-3), sy + breathe + 3, 3, 2);
    ctx.fillRect(px(0), sy + breathe + 3, 3, 2);
    ctx.fillRect(px(-0), sy + breathe + 4, 1, 1);
  }

  // blink
  const blink = !walking && !sleeping && ((Math.sin(phase * 1.7 + 2) + 1) / 2) > 0.965;
  if (blink) {
    ctx.fillStyle = "rgba(15,23,42,0.8)";
    ctx.fillRect(px(-3), sy + breathe + 4, 2, 1);
    ctx.fillRect(px(1), sy + breathe + 4, 2, 1);
  } else {
    ctx.fillStyle = "rgba(15,23,42,0.8)";
    ctx.fillRect(px(-2), sy + breathe + 4, 1, 1);
    ctx.fillRect(px(2), sy + breathe + 4, 1, 1);
  }

  // body (hoodie/suit/coat)
  ctx.fillStyle = look.shirt;
  ctx.fillRect(px(-5), sy + 8 + breathe + sleepTilt, 10, 7);

  // tiny breathing hint (single pixel highlight), keeps the sprite calm
  if (chestPulse > 0.78 && !walking && !typing && !sleeping) {
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(px(-1), sy + 11, 1, 1);
    ctx.restore();
  }

  // lapels for suit
  if (look.suit) {
    ctx.fillStyle = "rgba(255,255,255,0.14)";
    ctx.fillRect(px(-2), sy + 9 + breathe, 1, 5);
    ctx.fillRect(px(1), sy + 9 + breathe, 1, 5);
  }

  // coat edge
  if (look.coat) {
    ctx.fillStyle = "rgba(255,255,255,0.10)";
    ctx.fillRect(px(-5), sy + 10 + breathe, 1, 5);
  }

  // arms
  ctx.fillStyle = look.accent;
  const armY = sy + 9 + breathe + (typing ? 2 : 0);
  ctx.fillRect(px(-7), armY + (typing ? arm : 0), 2, 5);
  ctx.fillRect(px(5), armY + (typing ? -arm : 0), 2, 5);

  // pants
  ctx.fillStyle = look.pants;
  ctx.fillRect(px(-4), sy + 15 + breathe, 8, 4);

  // legs + shoes
  ctx.fillStyle = look.pants;
  ctx.fillRect(px(-3), sy + 18 + breathe, 3, 3 + Math.max(0, legA));
  ctx.fillRect(px(0), sy + 18 + breathe, 3, 3 + Math.max(0, legB));
  ctx.fillStyle = look.shoes;
  ctx.fillRect(px(-3), sy + 21 + breathe + Math.max(0, legA), 3, 2);
  ctx.fillRect(px(0), sy + 21 + breathe + Math.max(0, legB), 3, 2);

  // Nameplate/status are rendered at the desk level for a cleaner, anchored layout.

  ctx.restore();
}

function drawNameLabel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  name: string,
  status: AgentStatus,
  accent: string
) {
  ctx.save();
  ctx.globalAlpha = 0.78;
  ctx.fillStyle = "rgba(0,0,0,0.48)";
  const label = name.slice(0, 12);
  ctx.font = "7px ui-monospace, SFMono-Regular, Menlo, monospace";
  const tw = ctx.measureText(label).width;
  const w = clamp(Math.ceil(tw) + 14, 30, 80);
  const lx = x - w / 2;

  roundRect(ctx, lx, y - 8, w, 10, 4);
  ctx.fill();

  ctx.fillStyle = statusDot(status);
  ctx.fillRect(lx + 5, y - 4, 2, 2);

  ctx.fillStyle = "#e5e7eb";
  ctx.fillText(label, lx + 10, y - 1);

  // subtle accent underline
  ctx.globalAlpha = 0.45;
  ctx.fillStyle = accent;
  ctx.fillRect(lx + 4, y + 1, w - 8, 1);
  ctx.restore();
}

function drawSpeechBubble(
  ctx: CanvasRenderingContext2D,
  p: { x: number; y: number; text: string; hot: boolean; bounds?: { minX: number; maxX: number } }
) {
  ctx.save();
  ctx.font = "7px ui-monospace, SFMono-Regular, Menlo, monospace";

  const maxW = 68;
  const lines = wrapText(ctx, p.text, maxW);

  const lineH = 9;
  const pad = 6;
  const bubbleW = Math.min(
    maxW + pad * 2,
    Math.max(52, ...lines.map((l) => ctx.measureText(l).width + pad * 2))
  );
  const bubbleH = lines.length * lineH + pad * 2;

  const minX = p.bounds ? p.bounds.minX + 4 : 6;
  const maxX = p.bounds ? p.bounds.maxX - bubbleW - 4 : 384 - bubbleW - 6;
  const x = clamp(p.x - bubbleW / 2, minX, maxX);
  const y = clamp(p.y - bubbleH, 6, 216 - bubbleH - 6);

  // bubble
  ctx.fillStyle = p.hot ? "rgba(251,191,36,0.16)" : "rgba(56,189,248,0.14)";
  ctx.strokeStyle = p.hot ? "rgba(251,191,36,0.38)" : "rgba(56,189,248,0.32)";
  roundRect(ctx, x, y, bubbleW, bubbleH, 6);
  ctx.fill();
  ctx.stroke();

  // tail
  ctx.fillStyle = p.hot ? "rgba(251,191,36,0.16)" : "rgba(56,189,248,0.14)";
  const tailX = clamp(p.x, x + 10, x + bubbleW - 10);
  ctx.beginPath();
  ctx.moveTo(tailX - 4, y + bubbleH);
  ctx.lineTo(tailX + 5, y + bubbleH);
  ctx.lineTo(tailX, y + bubbleH + 7);
  ctx.closePath();
  ctx.fill();

  // text
  ctx.fillStyle = "#e5e7eb";
  let yy = y + pad + 7;
  for (const line of lines) {
    ctx.fillText(line, x + pad, yy);
    yy += lineH;
  }

  // cursor
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = "#e5e7eb";
  if (((nowMs() / 250) | 0) % 2 === 0) {
    ctx.fillRect(x + bubbleW - pad - 6, y + bubbleH - pad - 6, 4, 1);
  }
  ctx.restore();

  ctx.restore();
}

function burstParticles(particlesRef: React.MutableRefObject<Record<string, Particle[]>>, key: string, x: number, y: number, color: string) {
  const list = (particlesRef.current[key] ??= []);
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI * 2 * i) / 6;
    const sp = 18 + (i % 3) * 10;
    list.push({
      x,
      y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp - 10,
      life: 0,
      maxLife: 0.55 + (i % 4) * 0.06,
      kind: "spark",
      color,
    });
  }
}

function spawnCodeParticle(particlesRef: React.MutableRefObject<Record<string, Particle[]>>, key: string, x: number, y: number, color: string) {
  const list = (particlesRef.current[key] ??= []);
  const chars = ["{", "}", "<", "/", ">", ";", "#", "*", "+", "="];
  const ch = chars[(hashStr(`${x}-${y}-${Math.random()}`) % chars.length) | 0];
  list.push({
    x,
    y,
    vx: (Math.random() - 0.5) * 10,
    vy: -14 - Math.random() * 12,
    life: 0,
    maxLife: 0.9 + Math.random() * 0.6,
    kind: "code",
    ch,
    color,
  });
}

function updateAndDrawParticles(
  ctx: CanvasRenderingContext2D,
  particlesRef: React.MutableRefObject<Record<string, Particle[]>>,
  key: string,
  dt: number
) {
  const list = (particlesRef.current[key] ??= []);
  if (!list.length) return;

  for (const p of list) {
    p.life += dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 26 * dt;
  }

  // draw
  for (const p of list) {
    const a = 1 - p.life / p.maxLife;
    if (a <= 0) continue;

    ctx.save();
    ctx.globalAlpha = 0.18 + 0.55 * a;
    if (p.kind === "spark") {
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
      ctx.fillRect(Math.round(p.x + 1), Math.round(p.y), 1, 1);
    } else {
      ctx.fillStyle = p.color;
      ctx.font = "7px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.fillText(p.ch ?? "*", Math.round(p.x), Math.round(p.y));
    }
    ctx.restore();
  }

  // cull
  particlesRef.current[key] = list.filter((p) => p.life < p.maxLife);
}

function maybeTypingSound(
  audioRef: React.MutableRefObject<{ ctx: AudioContext | null; master: GainNode | null; lastTypeAt: Record<string, number> }>,
  muted: boolean,
  key: string,
  status: AgentStatus,
  atDesk: boolean,
  t: number
) {
  if (muted) return;
  const ctx = audioRef.current.ctx;
  const master = audioRef.current.master;
  if (!ctx || !master) return;

  const typing = atDesk && (status === "active" || status === "busy");
  if (!typing) return;

  const cadence = status === "busy" ? 70 : 120;
  const last = audioRef.current.lastTypeAt[key] ?? 0;
  if (t - last < cadence) return;
  audioRef.current.lastTypeAt[key] = t;

  // tiny click: short noise burst + bandpass
  const dur = status === "busy" ? 0.018 : 0.014;
  const sr = ctx.sampleRate;
  const buf = ctx.createBuffer(1, Math.max(1, (dur * sr) | 0), sr);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);

  const src = ctx.createBufferSource();
  src.buffer = buf;

  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = status === "busy" ? 1800 : 1400;
  bp.Q.value = 6;

  const g = ctx.createGain();
  g.gain.value = status === "busy" ? 0.035 : 0.025;

  src.connect(bp);
  bp.connect(g);
  g.connect(master);

  const start = ctx.currentTime + 0.001;
  src.start(start);
  src.stop(start + dur);
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
