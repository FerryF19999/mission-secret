"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  CheckSquare,
  Bot,
  Brain,
  FileText,
  Calendar,
  Activity,
  Settings,
  Zap,
} from "lucide-react";

const navItems = [
  { href: "/", icon: LayoutDashboard, label: "Dashboard" },
  { href: "/tasks", icon: CheckSquare, label: "Tasks" },
  { href: "/team", icon: Bot, label: "Team" },
  { href: "/memory", icon: Brain, label: "Memory" },
  { href: "/content", icon: FileText, label: "Content" },
  { href: "/runs", icon: Activity, label: "Runs" },
  { href: "/calendar", icon: Calendar, label: "Calendar" },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 bg-card border-r border-border flex flex-col">
      {/* Header */}
      <div className="p-6 border-b border-border">
        <Link href="/" className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
            <Zap className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="font-mono font-bold text-lg tracking-tight">MISSION</h1>
            <p className="font-mono text-xs text-muted-foreground tracking-widest">CONTROL</p>
          </div>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
          
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`
                flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200
                ${isActive 
                  ? "bg-primary/10 text-primary border border-primary/20" 
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }
              `}
            >
              <Icon className={`w-5 h-5 ${isActive ? "text-primary" : ""}`} />
              <span className="font-medium text-sm">{item.label}</span>
              {isActive && (
                <div className="ml-auto w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-border">
        <Link
          href="/settings"
          className={`
            flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200
            ${pathname === "/settings" 
              ? "bg-primary/10 text-primary border border-primary/20" 
              : "text-muted-foreground hover:text-foreground hover:bg-muted"
            }
          `}
        >
          <Settings className="w-5 h-5" />
          <span className="font-medium text-sm">Settings</span>
        </Link>
        
        <div className="mt-4 px-4 py-3 bg-muted rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs font-mono text-emerald-400">SYSTEM ONLINE</span>
          </div>
          <p className="text-xs text-muted-foreground font-mono">
            Convex connected
          </p>
        </div>
      </div>
    </aside>
  );
}
