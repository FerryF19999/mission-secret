import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

// Handle agent_run_started event
export const handleAgentRunStarted = internalMutation({
  args: {
    runId: v.string(),
    sessionKey: v.optional(v.string()),
    label: v.optional(v.string()),
    agentId: v.string(),
    agentName: v.string(),
    task: v.string(),
    status: v.optional(v.string()),
    startedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    
    // Create agent run
    await ctx.db.insert("agentRuns", {
      runId: args.runId,
      sessionKey: args.sessionKey,
      label: args.label,
      agentId: args.agentId,
      agentName: args.agentName,
      task: args.task,
      status: args.status || "running",
      startedAt: args.startedAt || now,
      completedAt: undefined,
      result: undefined,
      resultFiles: [],
    });

    // Auto-create task in Tasks table
    await ctx.db.insert("tasks", {
      title: args.task,
      description: `Agent: ${args.agentName} | Run: ${args.runId}`,
      status: "in_progress",
      priority: "medium",
      assignedTo: args.agentName,
      tags: ["auto-generated", "agent-run"],
      createdAt: now,
      updatedAt: now,
    });

    // Update agent status
    const agents = await ctx.db.query("agents").collect();
    const agent = agents.find(
      (a: any) => a.handle === args.agentId || (a.name && a.name.toLowerCase() === args.agentId.toLowerCase())
    );
    if (agent) {
      await ctx.db.patch(agent._id, {
        status: "busy",
        lastActive: now,
      });
    }
  },
});

// Handle agent_run_completed event
export const handleAgentRunCompleted = internalMutation({
  args: {
    runId: v.string(),
    result: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    
    // Update agent run
    const run = await ctx.db
      .query("agentRuns")
      .withIndex("by_runId", (q) => q.eq("runId", args.runId))
      .first();
    if (run) {
      await ctx.db.patch(run._id, {
        status: "completed",
        result: args.result,
        completedAt: now,
      });
    }

    // Update linked task
    const tasks = await ctx.db.query("tasks").collect();
    const linked = tasks.find(
      (t: any) => t.description && t.description.includes(`Run: ${args.runId}`)
    );
    if (linked) {
      await ctx.db.patch(linked._id, { status: "completed", updatedAt: now });
    }

    // Update agent status back to active
    if (run) {
      const agents = await ctx.db.query("agents").collect();
      const agent = agents.find(
        (a: any) => a.handle === run.agentId || (a.name && a.name.toLowerCase() === run.agentId.toLowerCase())
      );
      if (agent) {
        await ctx.db.patch(agent._id, {
          status: "active",
          lastActive: now,
        });
      }
    }
  },
});

// Handle agent_run_failed event
export const handleAgentRunFailed = internalMutation({
  args: {
    runId: v.string(),
    error: v.optional(v.string()),
    result: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    
    // Update agent run
    const run = await ctx.db
      .query("agentRuns")
      .withIndex("by_runId", (q) => q.eq("runId", args.runId))
      .first();
    if (run) {
      await ctx.db.patch(run._id, {
        status: "failed",
        result: args.error || args.result,
        completedAt: now,
      });
    }

    // Update linked task to cancelled
    const tasks = await ctx.db.query("tasks").collect();
    const linked = tasks.find(
      (t: any) => t.description && t.description.includes(`Run: ${args.runId}`)
    );
    if (linked) {
      await ctx.db.patch(linked._id, { status: "cancelled", updatedAt: now });
    }

    // Update agent status back to active
    if (run) {
      const agents = await ctx.db.query("agents").collect();
      const agent = agents.find(
        (a: any) => a.handle === run.agentId || (a.name && a.name.toLowerCase() === run.agentId.toLowerCase())
      );
      if (agent) {
        await ctx.db.patch(agent._id, {
          status: "active",
          lastActive: now,
        });
      }
    }
  },
});

// Handle agent_run_log event
export const handleAgentRunLog = internalMutation({
  args: {
    runId: v.string(),
    action: v.optional(v.string()),
    prompt: v.optional(v.string()),
    message: v.optional(v.string()),
    source: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("activityLog", {
      runId: args.runId,
      action: args.action || "log",
      prompt: args.prompt,
      response: args.message,
      source: args.source || "openclaw",
      createdAt: Date.now(),
      metadata: args.metadata,
    });
  },
});

// Handle task_created event
export const handleTaskCreated = internalMutation({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
    priority: v.optional(v.string()),
    assignedTo: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    dueDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    
    // Create task
    await ctx.db.insert("tasks", {
      title: args.title,
      description: args.description,
      priority: args.priority || "medium",
      assignedTo: args.assignedTo,
      tags: args.tags || [],
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });

    // Auto-create calendar event if dueDate provided
    if (args.dueDate) {
      await ctx.db.insert("scheduledEvents", {
        title: `Task: ${args.title}`,
        description: args.description || `Priority: ${args.priority || "medium"}`,
        startTime: args.dueDate,
        endTime: args.dueDate + 60 * 60 * 1000, // 1 hour
        type: "task",
        createdAt: now,
      });
    }
  },
});

// Handle content_created event
export const handleContentCreated = internalMutation({
  args: {
    title: v.string(),
    contentType: v.optional(v.string()),
    platform: v.optional(v.string()),
    content: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    scheduledFor: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    
    // Create content item
    await ctx.db.insert("contentItems", {
      title: args.title,
      type: args.contentType || "post",
      platform: args.platform,
      content: args.content,
      status: "draft",
      tags: args.tags || [],
      scheduledFor: args.scheduledFor,
      createdAt: now,
      updatedAt: now,
    });

    // Auto-create calendar event if scheduledFor provided
    if (args.scheduledFor) {
      await ctx.db.insert("scheduledEvents", {
        title: `Content: ${args.title}`,
        description: `${args.platform || "post"} - draft`,
        startTime: args.scheduledFor,
        endTime: args.scheduledFor + 30 * 60 * 1000, // 30 min
        type: "content",
        createdAt: now,
      });
    }
  },
});

// Handle memory_created event
export const handleMemoryCreated = internalMutation({
  args: {
    agentId: v.optional(v.string()),
    memoryType: v.optional(v.string()),
    content: v.string(),
    source: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    importance: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("memories", {
      agentId: args.agentId,
      type: args.memoryType || "fact",
      content: args.content,
      source: args.source,
      tags: args.tags || [],
      importance: args.importance || 5,
      createdAt: Date.now(),
    });
  },
});

// Handle event_created event
export const handleEventCreated = internalMutation({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
    startTime: v.number(),
    endTime: v.optional(v.number()),
    eventType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("scheduledEvents", {
      title: args.title,
      description: args.description,
      startTime: args.startTime,
      endTime: args.endTime || args.startTime + 60 * 60 * 1000,
      type: args.eventType || "general",
      createdAt: Date.now(),
    });
  },
});

// Handle agent_status_update event
export const handleAgentStatusUpdate = internalMutation({
  args: {
    agentId: v.string(),
    status: v.string(),
  },
  handler: async (ctx, args) => {
    const agents = await ctx.db.query("agents").collect();
    const agent = agents.find(
      (a: any) => a.handle === args.agentId || (a.name && a.name.toLowerCase() === args.agentId.toLowerCase())
    );
    if (agent) {
      await ctx.db.patch(agent._id, {
        status: args.status,
        lastActive: Date.now(),
      });
    }
  },
});

// Handle agent_run_file_commit event
export const handleAgentRunFileCommit = internalMutation({
  args: {
    runId: v.string(),
    storageId: v.string(),
    filename: v.optional(v.string()),
    contentType: v.optional(v.string()),
    size: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db
      .query("agentRuns")
      .withIndex("by_runId", (q) => q.eq("runId", args.runId))
      .first();
    if (run) {
      const files = (run.resultFiles as any[]) || [];
      files.push({
        storageId: args.storageId,
        filename: args.filename || `file-${Date.now()}`,
        contentType: args.contentType,
        size: args.size,
        createdAt: Date.now(),
      });
      await ctx.db.patch(run._id, { resultFiles: files });
    }
  },
});
