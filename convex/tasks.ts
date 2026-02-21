import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

const taskStatus = v.union(v.literal("pending"), v.literal("in_progress"), v.literal("completed"), v.literal("cancelled"));
const taskPriority = v.union(v.literal("low"), v.literal("medium"), v.literal("high"), v.literal("critical"));

// Get all tasks with optional filtering
export const getAll = query({
  args: {
    status: v.optional(taskStatus),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 100;
    
    if (args.status) {
      return await ctx.db
        .query("tasks")
        .withIndex("by_status", (q) => q.eq("status", args.status!))
        .order("desc")
        .take(limit);
    }
    
    return await ctx.db.query("tasks").order("desc").take(limit);
  },
});

// Get task by ID
export const getById = query({
  args: { id: v.id("tasks") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

// Get tasks by status
export const getByStatus = query({
  args: { status: taskStatus },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("tasks")
      .withIndex("by_status", (q) => q.eq("status", args.status))
      .order("desc")
      .take(100);
  },
});

// Create a new task
export const create = mutation({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
    status: v.optional(taskStatus),
    priority: v.optional(taskPriority),
    assignedTo: v.optional(v.string()),
    dueDate: v.optional(v.number()),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("tasks", {
      title: args.title,
      description: args.description,
      status: args.status ?? "pending",
      priority: args.priority ?? "medium",
      assignedTo: args.assignedTo,
      dueDate: args.dueDate,
      tags: args.tags ?? [],
      createdAt: now,
      updatedAt: now,
    });
  },
});

// Update a task
export const update = mutation({
  args: {
    id: v.id("tasks"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    status: v.optional(taskStatus),
    priority: v.optional(taskPriority),
    assignedTo: v.optional(v.string()),
    dueDate: v.optional(v.number()),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    const existing = await ctx.db.get(id);
    if (!existing) throw new Error("Task not found");
    
    return await ctx.db.patch(id, {
      ...updates,
      updatedAt: Date.now(),
    });
  },
});

// Delete a task
export const remove = mutation({
  args: { id: v.id("tasks") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
  },
});

// Get task stats
export const getStats = query({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("tasks").collect();
    return {
      total: all.length,
      pending: all.filter(t => t.status === "pending").length,
      inProgress: all.filter(t => t.status === "in_progress").length,
      completed: all.filter(t => t.status === "completed").length,
      critical: all.filter(t => t.priority === "critical" && t.status !== "completed").length,
    };
  },
});
