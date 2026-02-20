import { Id } from "../../convex/_generated/dataModel";

export type TaskStatus = "pending" | "in_progress" | "completed" | "cancelled";
export type TaskPriority = "low" | "medium" | "high" | "critical";

export interface Task {
  _id: Id<"tasks">;
  _creationTime: number;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  assignedTo?: string;
  dueDate?: number;
  tags?: string[];
  createdAt: number;
  updatedAt: number;
}

export type AgentStatus = "active" | "idle" | "offline" | "busy";

export interface Agent {
  _id: Id<"agents">;
  _creationTime: number;
  name: string;
  handle: string;
  avatar?: string;
  role: string;
  status: AgentStatus;
  capabilities: string[];
  lastActive: number;
  createdAt: number;
}

export type MemoryType = "fact" | "insight" | "conversation" | "task";

export interface Memory {
  _id: Id<"memories">;
  _creationTime: number;
  agentId?: string;
  type: MemoryType;
  content: string;
  source?: string;
  tags?: string[];
  importance?: number;
  createdAt: number;
}

export type ContentStatus = "idea" | "draft" | "review" | "scheduled" | "published";
export type ContentType = "post" | "article" | "video" | "image" | "thread";

export interface ContentItem {
  _id: Id<"contentItems">;
  _creationTime: number;
  title: string;
  type: ContentType;
  status: ContentStatus;
  platform?: string;
  content?: string;
  scheduledFor?: number;
  publishedAt?: number;
  url?: string;
  tags?: string[];
  createdAt: number;
  updatedAt: number;
}

export type EventType = "meeting" | "deadline" | "reminder" | "event";

export interface ScheduledEvent {
  _id: Id<"scheduledEvents">;
  _creationTime: number;
  title: string;
  description?: string;
  startTime: number;
  endTime: number;
  allDay?: boolean;
  type: EventType;
  attendees?: string[];
  location?: string;
  color?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ActivityLogEntry {
  _id: Id<"activityLog">;
  _creationTime: number;
  runId: string;
  action: string;
  prompt?: string;
  response?: string;
  source?: string;
  metadata?: Record<string, any>;
  createdAt: number;
}

export interface AgentRun {
  _id: Id<"agentRuns">;
  _creationTime: number;
  agentId: string;
  agentName: string;
  task: string;
  status: "running" | "completed" | "failed";
  result?: string;
  startedAt: number;
  completedAt?: number;
}
