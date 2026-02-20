"use client";

import { ContentStatus, ContentType } from "@/types";
import { Badge } from "./Badge";

interface ContentStatusBadgeProps {
  status: ContentStatus;
}

export function ContentStatusBadge({ status }: ContentStatusBadgeProps) {
  const variantMap: Record<ContentStatus, "default" | "success" | "warning" | "danger" | "info" | "neutral"> = {
    idea: "neutral",
    draft: "info",
    review: "warning",
    scheduled: "default",
    published: "success",
  };

  const labelMap: Record<ContentStatus, string> = {
    idea: "Idea",
    draft: "Draft",
    review: "Review",
    scheduled: "Scheduled",
    published: "Published",
  };

  return <Badge variant={variantMap[status]}>{labelMap[status]}</Badge>;
}

interface ContentTypeBadgeProps {
  type: ContentType;
}

export function ContentTypeBadge({ type }: ContentTypeBadgeProps) {
  const styles: Record<ContentType, string> = {
    post: "bg-blue-500/20 text-blue-400",
    article: "bg-purple-500/20 text-purple-400",
    video: "bg-red-500/20 text-red-400",
    image: "bg-pink-500/20 text-pink-400",
    thread: "bg-cyan-500/20 text-cyan-400",
  };

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${styles[type]}`}>
      {type.charAt(0).toUpperCase() + type.slice(1)}
    </span>
  );
}
