"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Card } from "@/components/Card";
import { Search } from "lucide-react";

const statuses = ["all", "queued", "running", "completed", "failed"] as const;

type StatusFilter = (typeof statuses)[number];

export default function RunsPage() {
  const [status, setStatus] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const [agentFilter, setAgentFilter] = useState<string>("all");

  const runs = useQuery((api as any).agentRuns.getRecent, {
    limit: 100,
    status: status === "all" ? undefined : status,
    agentId: agentFilter === "all" ? undefined : agentFilter,
  });

  const logs = useQuery(
    api.activityLog.getByRunId,
    selectedRunId ? { runId: selectedRunId } : "skip"
  );

  const files = useQuery(
    (api as any).agentRuns.getFileUrlsByRunId,
    selectedRunId ? { runId: selectedRunId } : "skip"
  );

  const filtered = useMemo(() => {
    const list = runs ?? [];
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter((r: any) =>
      r.agentName.toLowerCase().includes(q) ||
      r.agentId.toLowerCase().includes(q) ||
      r.task.toLowerCase().includes(q) ||
      r.runId.toLowerCase().includes(q)
    );
  }, [runs, search]);

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between gap-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Runs</h1>
          <p className="text-muted-foreground mt-1">
            Track delegated sub-agent runs (spawned tasks) and their logs
          </p>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex items-center gap-2 bg-card border border-border rounded-lg p-1 w-fit">
            {statuses.map((s) => (
              <button
              key={s}
              onClick={() => setStatus(s)}
              className={
                "px-4 py-2 rounded-md text-sm font-medium transition-colors " +
                (status === s
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted")
              }
            >
              {s === "all" ? "All" : s}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 bg-card border border-border rounded-lg p-1 w-fit">
          {[
            "all",
            "yuri",
            "jarvis",
            "friday",
            "glass",
            "epstein",
          ].map((a) => (
            <button
              key={a}
              onClick={() => setAgentFilter(a)}
              className={
                "px-4 py-2 rounded-md text-sm font-medium transition-colors " +
                (agentFilter === a
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted")
              }
            >
              {a === "all" ? "All agents" : a}
            </button>
          ))}
        </div>
        </div>

        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by agent, runId, or task…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-card border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <Card padding="none" className="xl:col-span-2">
          <div className="divide-y divide-border">
            {filtered.map((r: any) => (
              <button
                key={r._id}
                onClick={() => setSelectedRunId(r.runId)}
                className={
                  "w-full text-left p-4 hover:bg-muted/50 transition-colors " +
                  (selectedRunId === r.runId ? "bg-muted/40" : "")
                }
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-3">
                      <span className="font-semibold truncate">{r.task}</span>
                      <StatusPill status={r.status} />
                    </div>
                    <div className="text-sm text-muted-foreground mt-1">
                      <span className="font-mono">{r.agentName}</span>
                      <span className="mx-2">•</span>
                      <span className="font-mono">{r.runId}</span>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground font-mono whitespace-nowrap">
                    {new Date(r.startedAt).toLocaleString()}
                  </div>
                </div>
              </button>
            ))}

            {filtered.length === 0 && (
              <div className="p-12 text-center">
                <p className="text-muted-foreground">No runs found</p>
              </div>
            )}
          </div>
        </Card>

        <Card className="xl:col-span-1">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">Details</h2>
            {selectedRunId && (
              <span className="text-xs font-mono text-muted-foreground truncate max-w-[160px]">
                {selectedRunId}
              </span>
            )}
          </div>

          {!selectedRunId && (
            <p className="text-sm text-muted-foreground">Select a run to view logs and files.</p>
          )}

          {selectedRunId && (
            <div className="space-y-5 max-h-[65vh] overflow-auto pr-1">
              <div>
                <h3 className="text-sm font-semibold mb-2">Files</h3>
                <div className="space-y-2">
                  {(files ?? []).map((f: any, idx: number) => (
                    <a
                      key={f.storageId + idx}
                      href={f.url || "#"}
                      target="_blank"
                      rel="noreferrer"
                      className="block border border-border rounded-lg p-3 bg-muted/30 hover:bg-muted/40 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-medium truncate">{f.filename}</span>
                        <span className="text-xs font-mono text-muted-foreground whitespace-nowrap">
                          {f.size ? `${Math.round(f.size / 1024)} KB` : ""}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground font-mono mt-1 truncate">
                        {f.contentType || "file"}
                      </div>
                    </a>
                  ))}
                  {files && files.length === 0 && (
                    <p className="text-sm text-muted-foreground">No files yet.</p>
                  )}
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold mb-2">Logs</h3>
                <div className="space-y-3">
                  {(logs ?? []).map((l) => (
                    <div key={l._id} className="border border-border rounded-lg p-3 bg-muted/30">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-xs font-mono text-muted-foreground">{l.action}</span>
                        <span className="text-xs font-mono text-muted-foreground">
                          {new Date(l.createdAt).toLocaleTimeString()}
                        </span>
                      </div>
                      {l.response && (
                        <pre className="mt-2 text-xs whitespace-pre-wrap text-foreground/90">
                          {l.response}
                        </pre>
                      )}
                    </div>
                  ))}
                  {logs && logs.length === 0 && (
                    <p className="text-sm text-muted-foreground">No logs for this run yet.</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </Card>
      </div>

      <Card>
        <h2 className="font-semibold mb-2">How to send events from OpenClaw</h2>
        <p className="text-sm text-muted-foreground">
          Post JSON to Convex HTTP endpoint <span className="font-mono">/openclaw/event</span> with types like
          <span className="font-mono"> agent_run_started</span>, <span className="font-mono">agent_run_log</span>,
          and <span className="font-mono">agent_run_completed</span>.
        </p>
      </Card>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const cls =
    status === "running"
      ? "bg-blue-500/15 text-blue-300 border-blue-500/20"
      : status === "queued"
        ? "bg-amber-500/15 text-amber-300 border-amber-500/20"
        : status === "completed"
          ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/20"
          : "bg-red-500/15 text-red-300 border-red-500/20";

  return (
    <span className={"text-xs px-2 py-1 rounded-full border font-mono " + cls}>
      {status}
    </span>
  );
}
