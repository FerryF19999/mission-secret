"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";

type AgentStatus = "active" | "busy" | "idle" | "offline";

type RosterAgent = {
  key: "yuri" | "jarvis" | "friday" | "glass" | "epstein";
  label: string;
  color: string; // primary body color
  accent: string; // accent / FX color
};

const ROSTER: RosterAgent[] = [
  { key: "yuri", label: "Yuri", color: "#3b82f6", accent: "#93c5fd" }, // blue
  { key: "jarvis", label: "Jarvis", color: "#22c55e", accent: "#86efac" }, // green
  { key: "friday", label: "Friday", color: "#f97316", accent: "#fdba74" }, // orange
  { key: "glass", label: "Glass", color: "#a855f7", accent: "#d8b4fe" }, // purple
  { key: "epstein", label: "Epstein", color: "#ef4444", accent: "#fca5a5" }, // red
];

type LiveAgent = {
  key: RosterAgent["key"];
  name: string;
  status: AgentStatus;
  task?: string;
};

type Vec2 = { x: number; y: number };

type AnimState = {
  pos: Vec2; // current world coords (grid)
  target: Vec2; // where they are headed
  lastStatus: AgentStatus;
  walkUntilMs: number; // force walk animation briefly on transitions
  phase: number; // animation phase accumulator
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
  return lines.slice(0, 3);
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

export default function OfficePage() {
  const agents = useQuery(api.agents.getAll, {});
  const running = useQuery(api.agentRuns.getRecent, { status: "running", limit: 100 });

  const live: LiveAgent[] = useMemo(() => {
    const byAgentKey = new Map<string, any>();
    for (const r of running ?? []) {
      // keep the newest running task per agent (agentId is usually the agent handle, e.g. "friday")
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
            Pixel office view (real-time via Convex). Click and watch the tiny agents work.
          </p>
        </div>
        <div className="hidden md:flex items-center gap-2 text-xs font-mono text-muted-foreground">
          <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" />active</span>
          <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" />busy</span>
          <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-slate-400" />idle</span>
          <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" />offline</span>
        </div>
      </div>

      <OfficeCanvas agents={live} />

      <div className="text-xs text-muted-foreground font-mono">
        Tip: statuses map to animations — <span className="text-foreground">active</span> = typing, <span className="text-foreground">busy</span> = typing fast + sparks,
        <span className="text-foreground">idle</span> = chilling, <span className="text-foreground">offline</span> = sleeping/absent.
      </div>
    </div>
  );
}

function OfficeCanvas({ agents }: { agents: LiveAgent[] }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // world is a tiny pixel grid; we scale up for display
  const WORLD = useMemo(() => ({ w: 320, h: 180 }), []);

  // fixed layout positions in world coords
  const layout = useMemo(() => {
    const desks = [
      { key: "yuri", desk: { x: 60, y: 82 }, stand: { x: 52, y: 104 } },
      { key: "jarvis", desk: { x: 120, y: 82 }, stand: { x: 112, y: 104 } },
      { key: "friday", desk: { x: 180, y: 82 }, stand: { x: 172, y: 104 } },
      { key: "glass", desk: { x: 240, y: 82 }, stand: { x: 232, y: 104 } },
      { key: "epstein", desk: { x: 300, y: 82 }, stand: { x: 292, y: 104 } },
    ] as const;

    const lounge = [
      { key: "yuri", spot: { x: 70, y: 140 } },
      { key: "jarvis", spot: { x: 120, y: 145 } },
      { key: "friday", spot: { x: 170, y: 142 } },
      { key: "glass", spot: { x: 220, y: 146 } },
      { key: "epstein", spot: { x: 270, y: 141 } },
    ] as const;

    const sleepCorner = { x: 18, y: 152 };

    return { desks, lounge, sleepCorner };
  }, []);

  const animRef = useRef<Record<string, AnimState>>({});
  const [ready, setReady] = useState(false);

  // Resize canvas to container, keeping aspect ratio via internal scaling.
  useEffect(() => {
    const el = containerRef.current;
    const c = canvasRef.current;
    if (!el || !c) return;

    const resize = () => {
      const rect = el.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;

      // Prefer a "game-like" wide canvas; clamp height.
      const cssW = Math.floor(rect.width);
      const cssH = Math.floor(Math.min(520, rect.width * (WORLD.h / WORLD.w)));

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

  useEffect(() => {
    if (!ready) return;
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let lastT = nowMs();

    const tick = () => {
      const t = nowMs();
      const dt = clamp((t - lastT) / 1000, 0, 0.05);
      lastT = t;

      const dpr = window.devicePixelRatio || 1;
      const cssW = c.clientWidth;
      const cssH = c.clientHeight;

      // Set transform so that drawing is in world coords.
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

      drawOffice(ctx, WORLD.w, WORLD.h, t);

      // Update & draw agents
      const rosterMap = new Map(ROSTER.map((r) => [r.key, r] as const));
      for (const a of agents) {
        const meta = rosterMap.get(a.key)!;

        const desk = layout.desks.find((d) => d.key === a.key)!;
        const lounge = layout.lounge.find((d) => d.key === a.key)!;

        // Determine target based on status.
        const target =
          a.status === "active" || a.status === "busy"
            ? desk.desk
            : a.status === "idle"
              ? lounge.spot
              : layout.sleepCorner;

        const s = (animRef.current[a.key] ??= {
          pos: { ...lounge.spot },
          target: { ...target },
          lastStatus: a.status,
          walkUntilMs: 0,
          phase: Math.random() * 10,
        });

        // On status change, briefly force walk.
        if (s.lastStatus !== a.status) {
          s.walkUntilMs = t + 800;
          s.lastStatus = a.status;
          s.target = { ...target };
        } else {
          s.target = { ...target };
        }

        // Move toward target
        const dx = s.target.x - s.pos.x;
        const dy = s.target.y - s.pos.y;
        const dist = Math.hypot(dx, dy);
        const walking = dist > 0.5 || t < s.walkUntilMs;

        const speed = a.status === "busy" ? 42 : 32; // world px / sec
        if (dist > 0.01) {
          const step = Math.min(dist, speed * dt);
          s.pos.x += (dx / dist) * step;
          s.pos.y += (dy / dist) * step;
        }

        s.phase += dt * (walking ? 10 : 2);

        // Shadow
        ctx.fillStyle = "rgba(0,0,0,0.25)";
        ctx.beginPath();
        ctx.ellipse(s.pos.x, s.pos.y + 6, 7, 3, 0, 0, Math.PI * 2);
        ctx.fill();

        const atDesk = Math.hypot(s.pos.x - desk.desk.x, s.pos.y - desk.desk.y) < 6;

        // Draw agent sprite
        drawAgent(ctx, {
          x: s.pos.x,
          y: s.pos.y,
          body: meta.color,
          accent: meta.accent,
          name: a.name,
          status: a.status,
          phase: s.phase,
          walking,
          atDesk,
        });

        // Speech bubble for active runs
        if ((a.status === "active" || a.status === "busy") && a.task) {
          drawSpeech(ctx, {
            x: s.pos.x,
            y: s.pos.y - 22,
            text: a.task,
            hot: a.status === "busy",
          });
        }

        if (a.status === "offline") {
          drawZzz(ctx, { x: s.pos.x + 8, y: s.pos.y - 18, phase: s.phase });
        }
      }

      drawForeground(ctx, WORLD.w, WORLD.h, t);

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [agents, layout, ready, WORLD.h, WORLD.w]);

  return (
    <div
      ref={containerRef}
      className="w-full rounded-xl border border-border bg-card overflow-hidden"
      style={{ boxShadow: "0 0 0 1px rgba(0,0,0,0.25) inset" }}
    >
      <canvas
        ref={canvasRef}
        className="block"
        style={{ imageRendering: "pixelated" }}
      />
    </div>
  );
}

function drawOffice(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  // Walls
  ctx.fillStyle = "#0b1220";
  ctx.fillRect(0, 0, w, h);

  // Back wall panel
  ctx.fillStyle = "#0f1a30";
  ctx.fillRect(0, 0, w, 56);

  // Neon sign
  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = "#2dd4bf";
  const pulse = 0.6 + 0.4 * Math.sin(t / 600);
  ctx.globalAlpha = 0.25 + 0.25 * pulse;
  ctx.fillRect(w / 2 - 44, 14, 88, 18);
  ctx.globalAlpha = 0.9;
  ctx.font = "8px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText("MISSION CONTROL", w / 2 - 40, 26);
  ctx.restore();

  // Floor tiles
  const floorY = 56;
  ctx.fillStyle = "#07101f";
  ctx.fillRect(0, floorY, w, h - floorY);

  for (let y = floorY; y < h; y += 10) {
    for (let x = 0; x < w; x += 10) {
      const alt = ((x / 10 + y / 10) | 0) % 2 === 0;
      ctx.fillStyle = alt ? "#0b1730" : "#09142a";
      ctx.fillRect(x, y, 10, 10);
    }
  }

  // Desks row
  for (let i = 0; i < 5; i++) {
    const dx = 28 + i * 60;
    // desk top
    ctx.fillStyle = "#2b2f3a";
    ctx.fillRect(dx, 70, 48, 18);
    ctx.fillStyle = "#1c202a";
    ctx.fillRect(dx, 86, 48, 3);
    // legs
    ctx.fillStyle = "#161a22";
    ctx.fillRect(dx + 4, 89, 6, 18);
    ctx.fillRect(dx + 38, 89, 6, 18);
    // computer
    ctx.fillStyle = "#111827";
    ctx.fillRect(dx + 16, 72, 16, 10);
    ctx.fillStyle = "#22d3ee";
    ctx.globalAlpha = 0.15;
    ctx.fillRect(dx + 17, 73, 14, 8);
    ctx.globalAlpha = 1;
    // keyboard
    ctx.fillStyle = "#0b0f16";
    ctx.fillRect(dx + 14, 83, 20, 3);
  }

  // Lounge rug
  ctx.fillStyle = "rgba(99,102,241,0.12)";
  ctx.fillRect(52, 126, 216, 40);

  // Plants
  drawPlant(ctx, 10, 60);
  drawPlant(ctx, w - 22, 60);

  // Window
  ctx.fillStyle = "#0b1020";
  ctx.fillRect(w - 86, 12, 70, 32);
  ctx.fillStyle = "rgba(56,189,248,0.18)";
  ctx.fillRect(w - 84, 14, 66, 28);
  ctx.strokeStyle = "rgba(148,163,184,0.35)";
  ctx.lineWidth = 1;
  ctx.strokeRect(w - 86, 12, 70, 32);
  ctx.beginPath();
  ctx.moveTo(w - 51, 12);
  ctx.lineTo(w - 51, 44);
  ctx.moveTo(w - 86, 28);
  ctx.lineTo(w - 16, 28);
  ctx.stroke();
}

function drawForeground(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  // subtle scanlines
  ctx.save();
  ctx.globalAlpha = 0.06;
  ctx.fillStyle = "#000";
  for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
  ctx.restore();

  // vignette
  const g = ctx.createRadialGradient(w / 2, h / 2, 40, w / 2, h / 2, 220);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(0,0,0,0.35)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // tiny clock
  ctx.save();
  ctx.globalAlpha = 0.7;
  ctx.fillStyle = "#94a3b8";
  ctx.font = "8px ui-monospace, SFMono-Regular, Menlo, monospace";
  const date = new Date();
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
  ctx.fillText(`UTC ${hh}:${mm}`, 10, 16);
  ctx.restore();

  // twinkly pixel
  ctx.save();
  ctx.globalAlpha = 0.4 + 0.3 * Math.sin(t / 900);
  ctx.fillStyle = "#38bdf8";
  ctx.fillRect(22, 22, 1, 1);
  ctx.fillRect(24, 20, 1, 1);
  ctx.restore();
}

function drawPlant(ctx: CanvasRenderingContext2D, x: number, y: number) {
  // pot
  ctx.fillStyle = "#3f2d22";
  ctx.fillRect(x, y + 14, 12, 8);
  ctx.fillStyle = "#2c1f18";
  ctx.fillRect(x, y + 20, 12, 2);
  // leaves
  ctx.fillStyle = "#22c55e";
  ctx.fillRect(x + 5, y, 2, 14);
  ctx.fillRect(x + 1, y + 6, 3, 3);
  ctx.fillRect(x + 8, y + 5, 3, 3);
  ctx.fillRect(x + 3, y + 2, 3, 3);
}

function drawAgent(
  ctx: CanvasRenderingContext2D,
  p: {
    x: number;
    y: number;
    body: string;
    accent: string;
    name: string;
    status: AgentStatus;
    phase: number;
    walking: boolean;
    atDesk: boolean;
  }
) {
  const { x, y, body, accent, status, phase, walking, atDesk } = p;

  // Tiny 10x12-ish pixel person
  const bob = !walking ? Math.sin(phase * 0.9) * 0.8 : 0;
  const ty = y - 14 + bob;

  const typing = atDesk && (status === "active" || status === "busy");
  const arm = typing ? Math.sin(phase * (status === "busy" ? 3.5 : 2.2)) : 0;
  const leg = walking ? Math.sin(phase * 1.2) : 0;

  // Offline: fade out / snooze
  ctx.save();
  if (status === "offline") ctx.globalAlpha = 0.55;

  // head
  ctx.fillStyle = "#e2e8f0";
  ctx.fillRect(x - 4, ty, 8, 6);
  // hair/hat
  ctx.fillStyle = accent;
  ctx.fillRect(x - 4, ty, 8, 2);

  // body
  ctx.fillStyle = body;
  ctx.fillRect(x - 4, ty + 6, 8, 6);

  // arms
  ctx.fillStyle = accent;
  const armY = ty + 7 + (typing ? 1 : 0);
  ctx.fillRect(x - 6, armY + Math.round(arm), 2, 4);
  ctx.fillRect(x + 4, armY + Math.round(-arm), 2, 4);

  // legs
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(x - 3, ty + 12, 3, 3 + Math.round(Math.max(0, leg)));
  ctx.fillRect(x, ty + 12, 3, 3 + Math.round(Math.max(0, -leg)));

  // busy sparks
  if (status === "busy" && typing) {
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = "#fbbf24";
    const k = (Math.sin(phase * 3) + 1) / 2;
    ctx.fillRect(x + 8, ty + 6, 1, 1);
    ctx.fillRect(x + 10, ty + 4 + (k > 0.5 ? 1 : 0), 1, 1);
    ctx.fillRect(x + 9, ty + 9, 1, 1);
    ctx.globalAlpha = 1;
  }

  // name tag
  ctx.globalAlpha = 0.75;
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(x - 16, ty - 7, 32, 6);
  ctx.fillStyle = "#e5e7eb";
  ctx.font = "6px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText(p.name.slice(0, 10), x - 14, ty - 2);

  ctx.restore();
}

function drawSpeech(
  ctx: CanvasRenderingContext2D,
  p: { x: number; y: number; text: string; hot: boolean }
) {
  ctx.save();
  ctx.font = "7px ui-monospace, SFMono-Regular, Menlo, monospace";
  const maxW = 140;
  const lines = wrapText(ctx, p.text, maxW);

  const lineH = 9;
  const pad = 6;
  const bubbleW = Math.min(
    maxW + pad * 2,
    Math.max(44, ...lines.map((l) => ctx.measureText(l).width + pad * 2))
  );
  const bubbleH = lines.length * lineH + pad * 2;

  const x = clamp(p.x - bubbleW / 2, 6, 320 - bubbleW - 6);
  const y = clamp(p.y - bubbleH, 6, 180 - bubbleH - 6);

  // bubble
  ctx.fillStyle = p.hot ? "rgba(251,191,36,0.16)" : "rgba(56,189,248,0.14)";
  ctx.strokeStyle = p.hot ? "rgba(251,191,36,0.35)" : "rgba(56,189,248,0.3)";
  roundRect(ctx, x, y, bubbleW, bubbleH, 6);
  ctx.fill();
  ctx.stroke();

  // tail
  ctx.fillStyle = p.hot ? "rgba(251,191,36,0.16)" : "rgba(56,189,248,0.14)";
  ctx.beginPath();
  ctx.moveTo(p.x - 3, y + bubbleH);
  ctx.lineTo(p.x + 4, y + bubbleH);
  ctx.lineTo(p.x, y + bubbleH + 6);
  ctx.closePath();
  ctx.fill();

  // text
  ctx.fillStyle = "#e5e7eb";
  let yy = y + pad + 7;
  for (const line of lines) {
    ctx.fillText(line, x + pad, yy);
    yy += lineH;
  }

  ctx.restore();
}

function drawZzz(ctx: CanvasRenderingContext2D, p: { x: number; y: number; phase: number }) {
  ctx.save();
  ctx.globalAlpha = 0.6;
  ctx.fillStyle = "#93c5fd";
  const up = (Math.sin(p.phase * 0.8) + 1) / 2;
  ctx.font = "8px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText("Z", p.x, p.y - up * 4);
  ctx.fillText("z", p.x + 6, p.y - 6 - up * 5);
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
