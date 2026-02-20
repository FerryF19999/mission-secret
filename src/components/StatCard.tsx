"use client";

import { ReactNode } from "react";

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: ReactNode;
  trend?: {
    value: number;
    label: string;
    positive?: boolean;
  };
  color?: "blue" | "green" | "purple" | "amber" | "red";
}

const colorMap = {
  blue: "from-blue-500/20 to-blue-600/10 border-blue-500/30 text-blue-400",
  green: "from-emerald-500/20 to-emerald-600/10 border-emerald-500/30 text-emerald-400",
  purple: "from-purple-500/20 to-purple-600/10 border-purple-500/30 text-purple-400",
  amber: "from-amber-500/20 to-amber-600/10 border-amber-500/30 text-amber-400",
  red: "from-red-500/20 to-red-600/10 border-red-500/30 text-red-400",
};

export function StatCard({ title, value, subtitle, icon, trend, color = "blue" }: StatCardProps) {
  return (
    <div className={`
      relative overflow-hidden rounded-xl border bg-gradient-to-br p-6
      ${colorMap[color]}
    `}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <h3 className="text-3xl font-mono font-bold mt-2 text-foreground">{value}</h3>
          {subtitle && (
            <p className="text-sm mt-1 text-muted-foreground">{subtitle}</p>
          )}
          {trend && (
            <div className="flex items-center gap-2 mt-3">
              <span className={`text-xs font-mono px-2 py-1 rounded-full ${
                trend.positive ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"
              }`}>
                {trend.positive ? "+" : ""}{trend.value}%
              </span>
              <span className="text-xs text-muted-foreground">{trend.label}</span>
            </div>
          )}
        </div>
        <div className="p-3 rounded-lg bg-background/50 backdrop-blur">
          {icon}
        </div>
      </div>
      
      {/* Decorative grid pattern */}
      <div className="absolute inset-0 bg-grid opacity-[0.02] pointer-events-none" />
    </div>
  );
}
