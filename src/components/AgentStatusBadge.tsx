"use client";

import { AgentStatus } from "@/types";

interface AgentStatusBadgeProps {
  status: AgentStatus;
}

export function AgentStatusBadge({ status }: AgentStatusBadgeProps) {
  const styles: Record<AgentStatus, string> = {
    active: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    idle: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    busy: "bg-red-500/20 text-red-400 border-red-500/30",
    offline: "bg-gray-500/20 text-gray-400 border-gray-500/30",
  };

  const labels: Record<AgentStatus, string> = {
    active: "Active",
    idle: "Idle",
    busy: "Busy",
    offline: "Offline",
  };

  return (
    <span className={`
      inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border
      ${styles[status]}
    `}>
      <span className={`w-1.5 h-1.5 rounded-full ${
        status === "active" ? "bg-emerald-400 animate-pulse" :
        status === "idle" ? "bg-amber-400" :
        status === "busy" ? "bg-red-400 animate-pulse" :
        "bg-gray-400"
      }`} />
      {labels[status]}
    </span>
  );
}
