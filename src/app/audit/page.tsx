"use client";

import { useEffect, useState } from "react";
import { api } from "@/trpc/react";

export default function AuditPage() {
  const [runs, setRuns] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [filter, setFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);

  const recentRuns = api.agentRuns.getRecent.useQuery({ limit: 100 });
  const auditStats = api.agentRuns.getAuditStats.useQuery({ hours: 24 });

  useEffect(() => {
    if (recentRuns.data) {
      setRuns(recentRuns.data);
      setLoading(false);
    }
  }, [recentRuns.data]);

  useEffect(() => {
    if (auditStats.data) {
      setStats(auditStats.data);
    }
  }, [auditStats.data]);

  const filteredRuns = filter === "all" 
    ? runs 
    : runs.filter(r => r.status === filter);

  const formatDuration = (ms?: number) => {
    if (!ms) return "-";
    if (ms < 60000) return `${Math.round(ms/1000)}s`;
    return `${Math.round(ms/60000)}m`;
  };

  const getModelDisplay = (model?: string) => {
    if (!model) return <span className="text-gray-400">-</span>;
    const short = model.replace("anthropic/", "").replace("moonshot/", "").replace("minimax/", "");
    return <span className="font-mono text-xs">{short}</span>;
  };

  const getStatusBadge = (status: string, verified?: boolean) => {
    const colors: Record<string, string> = {
      completed: "bg-green-500/20 text-green-400",
      failed: "bg-red-500/20 text-red-400",
      running: "bg-blue-500/20 text-blue-400",
      queued: "bg-yellow-500/20 text-yellow-400",
    };
    return (
      <span className={`px-2 py-1 rounded text-xs font-medium ${colors[status] || "bg-gray-500/20"}`}>
        {verified && "✓ "}{status}
      </span>
    );
  };

  const getTriggerBadge = (trigger?: string) => {
    const colors: Record<string, string> = {
      cron: "bg-purple-500/20 text-purple-400",
      human: "bg-cyan-500/20 text-cyan-400",
      agent: "bg-orange-500/20 text-orange-400",
    };
    if (!trigger) return <span className="text-gray-500">-</span>;
    return <span className={`px-2 py-0.5 rounded text-xs ${colors[trigger] || "bg-gray-500/20"}`}>{trigger}</span>;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 text-white p-8">
        <div className="animate-pulse">Loading audit data...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">🛡️ Audit & Accountability</h1>
          <p className="text-gray-400">Agent execution tracking — who ran what, when, and how</p>
        </div>

        {/* Stats Cards */}
        {stats && (
          <div className="grid grid-cols-5 gap-4 mb-8">
            <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
              <div className="text-2xl font-bold">{stats.totalRuns}</div>
              <div className="text-gray-400 text-sm">Total Runs (24h)</div>
            </div>
            <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
              <div className="text-2xl font-bold text-green-400">{stats.byStatus?.completed || 0}</div>
              <div className="text-gray-400 text-sm">Completed</div>
            </div>
            <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
              <div className="text-2xl font-bold text-red-400">{stats.byStatus?.failed || 0}</div>
              <div className="text-gray-400 text-sm">Failed</div>
            </div>
            <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
              <div className="text-2xl font-bold text-blue-400">{formatDuration(stats.avgDurationMs)}</div>
              <div className="text-gray-400 text-sm">Avg Duration</div>
            </div>
            <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
              <div className="text-2xl font-bold text-yellow-400">{stats.unverifiedCount || 0}</div>
              <div className="text-gray-400 text-sm">Unverified</div>
            </div>
          </div>
        )}

        {/* Model Stats */}
        {stats?.byModel && Object.keys(stats.byModel).length > 0 && (
          <div className="mb-8">
            <h2 className="text-lg font-semibold mb-3">📊 Model Usage</h2>
            <div className="flex flex-wrap gap-2">
              {Object.entries(stats.byModel).map(([model, count]: [string, any]) => (
                <div key={model} className="bg-gray-900 rounded-lg px-4 py-2 border border-gray-800">
                  <span className="font-mono text-sm">{model.replace("anthropic/", "").replace("moonshot/", "").replace("minimax/", "")}</span>
                  <span className="ml-2 text-gray-400">×{count}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Filter */}
        <div className="mb-4 flex gap-2">
          {["all", "completed", "failed", "running"].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                filter === f 
                  ? "bg-blue-600 text-white" 
                  : "bg-gray-800 text-gray-300 hover:bg-gray-700"
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>

        {/* Runs Table */}
        <div className="bg-gray-900 rounded-lg border border-gray-800 overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-800/50 text-left text-gray-400 text-sm">
              <tr>
                <th className="p-4">Time</th>
                <th className="p-4">Agent</th>
                <th className="p-4">Task</th>
                <th className="p-4">Model</th>
                <th className="p-4">Trigger</th>
                <th className="p-4">Duration</th>
                <th className="p-4">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {filteredRuns.map((run: any) => (
                <tr key={run.runId} className="hover:bg-gray-800/30">
                  <td className="p-4 text-sm text-gray-400">
                    {new Date(run.startedAt).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td className="p-4">
                    <span className="font-medium">{run.agentName}</span>
                    <div className="text-xs text-gray-500">{run.agentId}</div>
                  </td>
                  <td className="p-4 max-w-xs">
                    <div className="truncate text-sm" title={run.task}>{run.task}</div>
                    {run.label && <div className="text-xs text-gray-500">{run.label}</div>}
                  </td>
                  <td className="p-4">{getModelDisplay(run.modelUsed)}</td>
                  <td className="p-4">{getTriggerBadge(run.triggeredBy)}</td>
                  <td className="p-4 text-sm">{formatDuration(run.durationMs)}</td>
                  <td className="p-4">
                    {getStatusBadge(run.status, run.verified)}
                    {run.errorLog && (
                      <div className="text-xs text-red-400 mt-1 truncate max-w-[200px]" title={run.errorLog}>
                        {run.errorLog}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredRuns.length === 0 && (
            <div className="p-8 text-center text-gray-500">No runs found</div>
          )}
        </div>
      </div>
    </div>
  );
}
