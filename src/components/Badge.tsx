"use client";

interface BadgeProps {
  children: React.ReactNode;
  variant?: "default" | "success" | "warning" | "danger" | "info" | "neutral";
  size?: "sm" | "md";
}

const variantStyles = {
  default: "bg-primary/20 text-primary border-primary/30",
  success: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  warning: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  danger: "bg-red-500/20 text-red-400 border-red-500/30",
  info: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  neutral: "bg-muted text-muted-foreground border-border",
};

const sizeStyles = {
  sm: "px-2 py-0.5 text-xs",
  md: "px-2.5 py-0.5 text-sm",
};

export function Badge({ children, variant = "default", size = "sm" }: BadgeProps) {
  return (
    <span className={`
      inline-flex items-center font-medium rounded-full border
      ${variantStyles[variant]}
      ${sizeStyles[size]}
    `}>
      {children}
    </span>
  );
}
