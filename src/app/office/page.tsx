"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";

type AgentStatus = "active" | "busy" | "idle" | "offline";
type RosterKey = "yuri" | "friday" | "jarvis" | "glass" | "epstein";

type LiveAgent = { key: RosterKey; label: string; status: AgentStatus; task?: string };

type Pt = { xPct: number; yPct: number };

type Anim = {
  x: number;
  y: number;
  tx: number;
  ty: number;
  waitUntil: number;
  frame: 0 | 1 | 2 | 3;
};

const BASE_W = 1308;
const BASE_H = 521;

// Desk anchors roughly aligned to office-bg.jpg (1308x521). Tweak freely.
const DESK: Record<RosterKey, Pt> = {
  glass: { xPct: 19, yPct: 44 }, // top-left desk
  friday: { xPct: 43, yPct: 49 }, // middle
  yuri: { xPct: 21, yPct: 82 }, // bottom-left desk
  jarvis: { xPct: 42, yPct: 83 }, // bottom-right desk
  epstein: { xPct: 77, yPct: 78 }, // lounge desk
};

const ROSTER: Array<{ key: RosterKey; label: string; spriteIndex: 0 | 1 | 2 | 3 | 4 }> = [
  // characters-ref.jpg left-to-right mapping:
  // 1 Yuri, 2 Friday, 3 Jarvis, 4 Glass, 5 Epstein
  { key: "yuri", label: "Yuri", spriteIndex: 0 },
  { key: "friday", label: "Friday", spriteIndex: 1 },
  { key: "jarvis", label: "Jarvis", spriteIndex: 2 },
  { key: "glass", label: "Glass", spriteIndex: 3 },
  { key: "epstein", label: "Epstein", spriteIndex: 4 },
];

const IDLE_SPOTS: Pt[] = [
  { xPct: 16, yPct: 22 }, // shelves
  { xPct: 30, yPct: 20 },
  { xPct: 35, yPct: 45 },
  { xPct: 44, yPct: 30 },
  { xPct: 52, yPct: 56 },
  { xPct: 66, yPct: 20 }, // kitchen
  { xPct: 79, yPct: 30 },
  { xPct: 74, yPct: 78 }, // lounge
  { xPct: 90, yPct: 86 },
];

const COUCH: Pt = { xPct: 86, yPct: 86 };

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
  if (status === "active" || status === "busy") return "#22c55e"; // green
  if (status === "idle") return "#f59e0b"; // yellow
  return "#94a3b8"; // gray
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function dist(a: Pt, b: Pt) {
  const dx = a.xPct - b.xPct;
  const dy = a.yPct - b.yPct;
  return Math.hypot(dx, dy);
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function buildFourFrameSheet(spriteIndex: number) {
  // characters-ref.jpg is 160x36 with five 32x36 sprites.
  // We generate a 4-frame sheet by re-drawing the exact sprite with tiny y-offsets.
  const img = new Image();
  img.src = "/characters-ref.jpg";
  await img.decode();

  const srcX = spriteIndex * 32;
  const srcY = 0;

  const out = document.createElement("canvas");
  out.width = 32 * 4;
  out.height = 36;
  const ctx = out.getContext("2d", { alpha: true })!;
  ctx.imageSmoothingEnabled = false;

  const yOff = [0, 1, 0, 1];
  for (let f = 0; f < 4; f++) {
    ctx.clearRect(f * 32, 0, 32, 36);
    ctx.drawImage(img, srcX, srcY, 32, 36, f * 32, yOff[f], 32, 36);
  }

  return out.toDataURL("image/png");
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

  // Sprite sheets (generated from characters-ref.jpg).
  const [sheets, setSheets] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next: Record<string, string> = {};
      for (const r of ROSTER) next[r.key] = await buildFourFrameSheet(r.spriteIndex);
      if (!cancelled) setSheets(next);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Animation state: walking + 4-frame walk cycle at ~20fps.
  const animRef = useRef<Record<string, Anim>>({});
  const lastRef = useRef(0);
  const stepAccRef = useRef<Record<string, number>>({});

  // Force a React re-render at the same cadence we update animation.
  const [tick, setTick] = useState(0);

  useEffect(() => {
    // init anim states at desks
    for (const r of ROSTER) {
      if (animRef.current[r.key]) continue;
      const p = DESK[r.key];
      animRef.current[r.key] = { x: p.xPct, y: p.yPct, tx: p.xPct, ty: p.yPct, waitUntil: 0, frame: 0 };
      stepAccRef.current[r.key] = 0;
    }
  }, []);

  useEffect(() => {
    let raf = 0;
    const FPS = 20;
    const frameMs = 1000 / FPS;

    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (t - lastRef.current < frameMs) return;
      const dt = Math.min(0.08, (t - lastRef.current) / 1000 || 0.05);
      lastRef.current = t;

      for (const a of live) {
        const s = animRef.current[a.key];
        if (!s) continue;

        const isOffline = a.status === "offline";
        const isWorking = a.status === "active" || a.status === "busy";
        const isIdle = a.status === "idle";

        // Choose target based on status.
        if (isOffline) {
          s.tx = COUCH.xPct;
          s.ty = COUCH.yPct;
        } else if (isWorking) {
          const d = DESK[a.key];
          s.tx = d.xPct;
          s.ty = d.yPct;
        } else if (isIdle) {
          const at = { xPct: s.x, yPct: s.y };
          const tgt = { xPct: s.tx, yPct: s.ty };
          const arrived = dist(at, tgt) < 1.2;
          if (arrived && t > s.waitUntil) {
            const seed = a.key.charCodeAt(0) * 999 + Math.floor(t / 1000);
            const rnd = mulberry32(seed);
            const pick = IDLE_SPOTS[Math.floor(rnd() * IDLE_SPOTS.length)];
            s.tx = pick.xPct;
            s.ty = pick.yPct;
            s.waitUntil = t + (1500 + rnd() * 2500);
          }
        }

        // Movement.
        const speedPctPerSec = isWorking ? 10 : isOffline ? 5 : 6; // slow strolling
        const dx = s.tx - s.x;
        const dy = s.ty - s.y;
        const d = Math.hypot(dx, dy);
        const moving = d > 0.3;

        if (moving) {
          const step = speedPctPerSec * dt;
          const k = step / Math.max(d, 0.0001);
          s.x += dx * clamp(k, 0, 1);
          s.y += dy * clamp(k, 0, 1);
        }

        // Walk cycle: only advance frames when moving.
        const acc = (stepAccRef.current[a.key] ?? 0) + (moving ? dt : 0);
        stepAccRef.current[a.key] = acc;
        if (moving) {
          const frame = (Math.floor(acc / 0.14) % 4) as 0 | 1 | 2 | 3; // relaxed pace
          s.frame = frame;
        } else {
          s.frame = 0;
        }
      }

      setTick((x) => (x + 1) % 100000);
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [live]);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _ = tick; // referenced to ensure rerenders

  return (
    <div className="officeRoot">
      <style>{`
        .officeRoot{display:flex;gap:16px;padding:16px;min-height:calc(100vh - 64px);background:#0b1220;color:#e5e7eb;}
        @media (max-width: 900px){.officeRoot{flex-direction:column;}}

        .sceneWrap{flex:1;min-width:320px;display:flex;justify-content:center;align-items:flex-start;}
        .scene{
          position:relative;
          width:min(980px, 100%);
          aspect-ratio: ${BASE_W} / ${BASE_H};
          background-image:url('/office-bg.jpg');
          background-size:100% 100%;
          background-repeat:no-repeat;
          image-rendering: pixelated;
          border:1px solid rgba(255,255,255,0.08);
          border-radius:12px;
          overflow:hidden;
          box-shadow: 0 10px 30px rgba(0,0,0,0.35);
        }

        .marker{position:absolute;left:0;top:0;transform:translate(-50%,-100%);cursor:pointer;user-select:none;}
        .marker:focus{outline:none;}

        .sprite{
          width:32px;height:36px;
          background-repeat:no-repeat;
          image-rendering: pixelated;
          transform-origin: 50% 85%;
          transform: scale(2.5);
          filter: drop-shadow(0px 2px 0px rgba(0,0,0,0.35));
        }

        .tag{
          margin-top:10px;
          display:inline-flex;align-items:center;gap:8px;
          padding:6px 10px;
          background: rgba(2,6,23,0.78);
          border:1px solid rgba(255,255,255,0.10);
          border-radius:999px;
          font: 600 12px/1.1 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto;
          letter-spacing: 0.2px;
          white-space:nowrap;
        }
        .dot{width:8px;height:8px;border-radius:999px;box-shadow:0 0 0 2px rgba(0,0,0,0.35);}
        .selectedRing{box-shadow:0 0 0 2px rgba(148,163,184,0.35), 0 0 0 4px rgba(59,130,246,0.35); border-radius:10px; padding:2px;}

        .panel{
          width:360px;max-width:100%;
          background:rgba(2,6,23,0.75);
          border:1px solid rgba(255,255,255,0.10);
          border-radius:12px;
          padding:14px;
          height:fit-content;
          position:sticky;top:16px;
          backdrop-filter: blur(8px);
        }
        .panel h2{margin:0 0 10px 0;font:700 16px/1.2 ui-sans-serif, system-ui;}
        .panelRow{display:flex;align-items:center;justify-content:space-between;gap:10px;}
        .pill{display:inline-flex;align-items:center;gap:8px;padding:6px 10px;border-radius:999px;border:1px solid rgba(255,255,255,0.12);background:rgba(15,23,42,0.6);}
        .task{margin-top:12px;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,0.10);background:rgba(15,23,42,0.55);color:#d1d5db;white-space:pre-wrap;}
        .hint{margin-top:10px;color:#94a3b8;font-size:12px;}
      `}</style>

      <div className="sceneWrap">
        <div className="scene" aria-label="Pixel office">
          {ROSTER.map((r) => {
            const a = live.find((x) => x.key === r.key);
            const isSelected = selected === r.key;
            const s = animRef.current[r.key];
            if (!a || !s) return null;

            const isOffline = a.status === "offline";
            // per requirement: offline disappears OR sleeps on couch. We'll keep them on couch but dim.
            const opacity = isOffline ? 0.45 : 1;

            const left = `${s.x}%`;
            const top = `${s.y}%`;

            const sheetUrl = sheets[r.key];
            const frameX = -s.frame * 32;

            return (
              <button
                key={r.key}
                className="marker"
                style={{ left, top, background: "transparent", border: "none", padding: 0, opacity }}
                onClick={() => setSelected(r.key)}
                title={r.label}
              >
                <div className={isSelected ? "selectedRing" : undefined}>
                  <div
                    className="sprite"
                    style={{
                      backgroundImage: sheetUrl ? `url('${sheetUrl}')` : "none",
                      backgroundSize: `${32 * 4}px 36px`,
                      backgroundPosition: `${frameX}px 0px`,
                    }}
                  />
                </div>
                <div className="tag">
                  <span className="dot" style={{ background: statusColor(a.status) }} />
                  <span>{r.label}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <aside className="panel" aria-label="Agent details">
        <div className="panelRow">
          <h2 style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="dot" style={{ background: statusColor(selectedLive?.status ?? "offline") }} />
            <span>{selectedLive?.label ?? "Agent"}</span>
          </h2>
          <span className="pill">
            <span style={{ color: "#94a3b8", fontSize: 12 }}>Status</span>
            <span style={{ fontWeight: 700, textTransform: "capitalize" }}>{selectedLive?.status ?? "offline"}</span>
          </span>
        </div>

        <div className="task">{selectedLive?.task ? selectedLive.task : "No active task."}</div>
        <div className="hint">Click a character in the office to switch agents.</div>
      </aside>
    </div>
  );
}
