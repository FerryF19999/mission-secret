"use client";

import { useEffect, useMemo, useState, Suspense } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Card } from "@/components/Card";
import { Search, Loader2 } from "lucide-react";

const statuses = ["all", "queued", "running", "completed", "failed"] as const;

type StatusFilter = (typeof statuses)[number];

export default function RunsPage() {
  const [status, setStatus] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<any | null>(null);
  const [fileText, setFileText] = useState<string>("");
  const [fileLoading, setFileLoading] = useState<boolean>(false);
  const [fileError, setFileError] = useState<string>("");
  const [componentError, setComponentError] = useState<string>("");

  const [agentFilter, setAgentFilter] = useState<string>("all");

  // Add error boundary for queries
  let runs: any[] = [];
  let logs: any[] = [];
  let files: any[] = [];
  try {
    runs = useQuery((api as any).agentRuns.getRecent, {
      limit: 100,
      status: status === "all" ? undefined : status,
      agentId: agentFilter === "all" ? undefined : agentFilter,
    });
  } catch (e: any) {
    runs = [];
    setComponentError(e?.message || "Error loading runs");
  }

  try {
    logs = useQuery(
      api.activityLog.getByRunId,
      selectedRunId ? { runId: selectedRunId } : "skip"
    );
  } catch (e: any) {
    logs = [];
  }

  try {
    files = useQuery(
      (api as any).agentRuns.getFileUrlsByRunId,
      selectedRunId ? { runId: selectedRunId } : "skip"
    );
  } catch (e: any) {
    files = [];
  }

  // Reset file preview when switching runs
  useEffect(() => {
    setSelectedFile(null);
    setFileText("");
    setFileError("");
    setFileLoading(false);
  }, [selectedRunId]);

  // Fetch previewable text/html/json
  useEffect(() => {
    const url = selectedFile?.url as string | undefined;
    const contentType = (selectedFile?.contentType as string | undefined) || "";
    const filename = (selectedFile?.filename as string | undefined) || "";

    const isText =
      contentType.startsWith("text/") ||
      contentType === "application/json" ||
      filename.endsWith(".md") ||
      filename.endsWith(".txt") ||
      filename.endsWith(".json") ||
      filename.endsWith(".html") ||
      filename.endsWith(".htm") ||
      filename.endsWith(".css") ||
      filename.endsWith(".js");

    if (!url || !isText) return;

    let cancelled = false;
    (async () => {
      try {
        setFileLoading(true);
        setFileError("");
        const res = await fetch(url);
        const text = await res.text();
        if (cancelled) return;
        // Keep preview reasonable
        setFileText(text.slice(0, 200_000));
      } catch (e: any) {
        if (cancelled) return;
        setFileError(e?.message || String(e));
      } finally {
        if (!cancelled) setFileLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedFile]);

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
      {componentError && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
          <p className="text-red-400">Error: {componentError}</p>
          <button 
            onClick={() => setComponentError("")}
            className="mt-2 text-sm text-red-300 hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}

      <Suspense fallback={
        <div className="flex items-center justify-center p-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-muted-foreground">Loading...</span>
        </div>
      }>
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
            {(filtered ?? []).map((r: any) => (
              <button
                key={r?._id || r?.runId || Math.random()}
                onClick={() => r?.runId && setSelectedRunId(r.runId)}
                className={
                  "w-full text-left p-4 hover:bg-muted/50 transition-colors " +
                  (selectedRunId === r?.runId ? "bg-muted/40" : "")
                }
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-3">
                      <span className="font-semibold truncate">{r?.task || "Unknown task"}</span>
                      <StatusPill status={r?.status || "unknown"} />
                    </div>
                    <div className="text-sm text-muted-foreground mt-1">
                      <span className="font-mono">{r?.agentName || "unknown"}</span>
                      <span className="mx-2">•</span>
                      <span className="font-mono">{r?.runId || "N/A"}</span>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground font-mono whitespace-nowrap">
                    {r?.startedAt ? new Date(r.startedAt).toLocaleString() : "N/A"}
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
                  {files && files.length > 0 ? (
                    files.map((f: any, idx: number) => (
                    <div key={f?.storageId + idx || Math.random()} className="border border-border rounded-lg bg-muted/30">
                      <button
                        onClick={() => f && setSelectedFile(f)}
                        className={
                          "w-full text-left p-3 hover:bg-muted/40 transition-colors rounded-lg " +
                          (selectedFile?.storageId === f?.storageId ? "bg-muted/40" : "")
                        }
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-sm font-medium truncate">{f?.filename || "Unknown"}</span>
                          <span className="text-xs font-mono text-muted-foreground whitespace-nowrap">
                            {f?.size ? `${Math.round(f.size / 1024)} KB` : ""}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground font-mono mt-1 truncate">
                          {f?.contentType || "file"}
                        </div>
                      </button>
                    </div>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">No files yet.</p>
                  )}
                </div>

                {/* Preview */}
                {selectedFile && (
                  <div className="mt-3 border border-border rounded-lg p-3 bg-muted/20">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-semibold truncate">Preview: {selectedFile.filename}</div>
                      <a
                        className="text-xs font-mono text-primary hover:underline"
                        href={selectedFile.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open
                      </a>
                    </div>

                    <div className="mt-3">
                      {(() => {
                        const ct = (selectedFile.contentType || "") as string;
                        const fn = (selectedFile.filename || "") as string;
                        const url = selectedFile.url as string;

                        const isImg = ct.startsWith("image/") || /\.(png|jpg|jpeg|webp|gif)$/i.test(fn);
                        const isPdf = ct === "application/pdf" || /\.pdf$/i.test(fn);
                        const isHtml = ct === "text/html" || /\.(html|htm)$/i.test(fn);
                        const isText =
                          ct.startsWith("text/") ||
                          ct === "application/json" ||
                          /\.(md|txt|json|css|js)$/i.test(fn);

                        if (isImg) {
                          return (
                            <img
                              src={url}
                              alt={fn}
                              className="w-full rounded-md border border-border object-contain max-h-[320px]"
                            />
                          );
                        }

                        if (isPdf) {
                          return (
                            <iframe
                              src={url}
                              className="w-full h-[320px] rounded-md border border-border bg-background"
                              title={fn}
                            />
                          );
                        }

                        if (isHtml) {
                          if (fileLoading) return <p className="text-sm text-muted-foreground">Loading preview…</p>;
                          if (fileError) return <p className="text-sm text-red-400">{fileError}</p>;
                          return (
                            <iframe
                              sandbox="allow-same-origin"
                              srcDoc={fileText || ""}
                              className="w-full h-[320px] rounded-md border border-border bg-white"
                              title={fn}
                            />
                          );
                        }

                        if (isText) {
                          if (fileLoading) return <p className="text-sm text-muted-foreground">Loading preview…</p>;
                          if (fileError) return <p className="text-sm text-red-400">{fileError}</p>;
                          return (
                            <pre className="text-xs whitespace-pre-wrap max-h-[320px] overflow-auto p-3 rounded-md border border-border bg-background">
                              {fileText || "(empty)"}
                            </pre>
                          );
                        }

                        return (
                          <p className="text-sm text-muted-foreground">
                            Preview not available for this file type. Use <span className="font-mono">Open</span> to download.
                          </p>
                        );
                      })()}
                    </div>
                  </div>
                )}
              </div>

              <div>
                <h3 className="text-sm font-semibold mb-2">Logs</h3>
                <div className="space-y-3">
                  {logs && logs.length > 0 ? (
                    logs.map((l: any) => (
                    <div key={l?._id || Math.random()} className="border border-border rounded-lg p-3 bg-muted/30">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-xs font-mono text-muted-foreground">{l?.action || "unknown"}</span>
                        <span className="text-xs font-mono text-muted-foreground">
                          {l?.createdAt ? new Date(l.createdAt).toLocaleTimeString() : "N/A"}
                        </span>
                      </div>
                      {l?.response && (
                        <pre className="mt-2 text-xs whitespace-pre-wrap text-foreground/90">
                          {l.response}
                        </pre>
                      )}
                    </div>
                    ))
                  ) : (
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
      </Suspense>
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
