import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Tasks table - for mission task management
  tasks: defineTable({
    title: v.string(),
    description: v.optional(v.string()),
    status: v.union(v.literal("pending"), v.literal("in_progress"), v.literal("completed"), v.literal("cancelled")),
    priority: v.union(v.literal("low"), v.literal("medium"), v.literal("high"), v.literal("critical")),
    assignedTo: v.optional(v.string()),
    dueDate: v.optional(v.number()),
    tags: v.optional(v.array(v.string())),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_status", ["status"])
    .index("by_priority", ["priority"])
    .index("by_assigned", ["assignedTo"]),

  // Agents table - for AI agent management
  agents: defineTable({
    name: v.string(),
    handle: v.string(),
    avatar: v.optional(v.string()),
    role: v.string(),
    description: v.optional(v.string()),
    color: v.optional(v.string()),
    status: v.union(v.literal("active"), v.literal("idle"), v.literal("offline"), v.literal("busy")),
    capabilities: v.array(v.string()),
    lastActive: v.number(),
    createdAt: v.number(),
  })
    .index("by_status", ["status"])
    .index("by_handle", ["handle"]),

  // Memories table - for agent memory/knowledge
  memories: defineTable({
    agentId: v.optional(v.string()),
    type: v.union(v.literal("fact"), v.literal("insight"), v.literal("conversation"), v.literal("task")),
    content: v.string(),
    source: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    importance: v.optional(v.number()), // 1-10 scale
    createdAt: v.number(),
  })
    .index("by_agent", ["agentId"])
    .index("by_type", ["type"])
    .index("by_created", ["createdAt"]),

  // Content items table - for content pipeline
  contentItems: defineTable({
    title: v.string(),
    type: v.union(v.literal("post"), v.literal("article"), v.literal("video"), v.literal("image"), v.literal("thread")),
    status: v.union(v.literal("idea"), v.literal("draft"), v.literal("review"), v.literal("scheduled"), v.literal("published")),
    platform: v.optional(v.string()), // twitter, linkedin, instagram, etc.
    content: v.optional(v.string()),
    scheduledFor: v.optional(v.number()),
    publishedAt: v.optional(v.number()),
    url: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_status", ["status"])
    .index("by_type", ["type"])
    .index("by_scheduled", ["scheduledFor"]),

  // Scheduled events table - for calendar
  scheduledEvents: defineTable({
    title: v.string(),
    description: v.optional(v.string()),
    startTime: v.number(),
    endTime: v.number(),
    allDay: v.optional(v.boolean()),
    type: v.union(v.literal("meeting"), v.literal("deadline"), v.literal("reminder"), v.literal("event")),
    attendees: v.optional(v.array(v.string())),
    location: v.optional(v.string()),
    color: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_start", ["startTime"])
    .index("by_type", ["type"]),

  // Activity log table - for system events
  activityLog: defineTable({
    runId: v.string(),
    action: v.string(),
    prompt: v.optional(v.string()),
    response: v.optional(v.string()),
    source: v.optional(v.string()),
    metadata: v.optional(v.record(v.string(), v.any())),
    createdAt: v.number(),
  })
    .index("by_runId", ["runId"])
    .index("by_created", ["createdAt"]),

  // Agent runs table - for tracking agent executions
  agentRuns: defineTable({
    runId: v.string(), // OpenClaw sessions_spawn runId or external correlation id
    sessionKey: v.optional(v.string()),
    label: v.optional(v.string()),

    agentId: v.string(),
    agentName: v.string(),

    task: v.string(),
    status: v.union(v.literal("queued"), v.literal("running"), v.literal("completed"), v.literal("failed")),

    result: v.optional(v.string()),

    // Files produced by the run (stored in Convex storage)
    resultFiles: v.optional(
      v.array(
        v.object({
          storageId: v.string(),
          filename: v.string(),
          contentType: v.optional(v.string()),
          size: v.optional(v.number()),
          url: v.optional(v.string()),
          createdAt: v.number(),
        })
      )
    ),

    startedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_runId", ["runId"])
    .index("by_agent", ["agentId"])
    .index("by_status", ["status"])
    .index("by_started", ["startedAt"]),
});
