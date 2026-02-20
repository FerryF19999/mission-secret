"use client";

import { TaskStatus, TaskPriority } from "@/types";
import { Badge } from "./Badge";

interface TaskStatusBadgeProps {
  status: TaskStatus;
}

export function TaskStatusBadge({ status }: TaskStatusBadgeProps) {
  const variantMap: Record<TaskStatus, "default" | "success" | "warning" | "danger" | "info" | "neutral"> = {
    pending: "neutral",
    in_progress: "info",
    completed: "success",
    cancelled: "danger",
  };

  const labelMap: Record<TaskStatus, string> = {
    pending: "Pending",
    in_progress: "In Progress",
    completed: "Completed",
    cancelled: "Cancelled",
  };

  return <Badge variant={variantMap[status]}>{labelMap[status]}</Badge>;
}

interface TaskPriorityBadgeProps {
  priority: TaskPriority;
}

export function TaskPriorityBadge({ priority }: TaskPriorityBadgeProps) {
  const variantMap: Record<TaskPriority, "default" | "success" | "warning" | "danger" | "info" | "neutral"> = {
    low: "neutral",
    medium: "info",
    high: "warning",
    critical: "danger",
  };

  return (
    <Badge variant={variantMap[priority]}>
      {priority.charAt(0).toUpperCase() + priority.slice(1)}
    </Badge>
  );
}
