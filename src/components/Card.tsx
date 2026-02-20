"use client";

import { ReactNode } from "react";

interface CardProps {
  children: ReactNode;
  className?: string;
  title?: string;
  action?: ReactNode;
  padding?: "none" | "normal";
}

export function Card({ children, className = "", title, action, padding = "normal" }: CardProps) {
  return (
    <div className={`
      bg-card border border-border rounded-xl overflow-hidden
      ${className}
    `}>
      {(title || action) && (
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          {title && <h3 className="font-semibold text-foreground">{title}</h3>}
          {action && <div>{action}</div>}
        </div>
      )}
      <div className={padding === "normal" ? "p-6" : ""}>
        {children}
      </div>
    </div>
  );
}
