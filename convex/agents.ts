import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

// Get all agents
export const getAll = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("agents").order("desc").take(100);
  },
});

// Get agent by ID
export const getById = query({
  args: { id: v.id("agents") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

// Get agent by handle
export const getByHandle = query({
  args: { handle: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("agents")
      .withIndex("by_handle", (q) => q.eq("handle", args.handle))
      .first();
  },
});

// Get agents by status
export const getByStatus = query({
  args: { 
    status: v.union(v.literal("active"), v.literal("idle"), v.literal("offline"), v.literal("busy")) 
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("agents")
      .withIndex("by_status", (q) => q.eq("status", args.status))
      .order("desc")
      .take(100);
  },
});

// Create a new agent
export const create = mutation({
  args: {
    name: v.string(),
    handle: v.string(),
    avatar: v.optional(v.string()),
    role: v.string(),
    status: v.optional(v.union(v.literal("active"), v.literal("idle"), v.literal("offline"), v.literal("busy"))),
    capabilities: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("agents", {
      name: args.name,
      handle: args.handle,
      avatar: args.avatar,
      role: args.role,
      status: args.status ?? "idle",
      capabilities: args.capabilities ?? [],
      lastActive: now,
      createdAt: now,
    });
  },
});

// Update agent
export const update = mutation({
  args: {
    id: v.id("agents"),
    name: v.optional(v.string()),
    handle: v.optional(v.string()),
    avatar: v.optional(v.string()),
    role: v.optional(v.string()),
    status: v.optional(v.union(v.literal("active"), v.literal("idle"), v.literal("offline"), v.literal("busy"))),
    capabilities: v.optional(v.array(v.string())),
    lastActive: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    const existing = await ctx.db.get(id);
    if (!existing) throw new Error("Agent not found");
    
    return await ctx.db.patch(id, updates);
  },
});

// Update agent status
export const setStatus = mutation({
  args: {
    id: v.id("agents"),
    status: v.union(v.literal("active"), v.literal("idle"), v.literal("offline"), v.literal("busy")),
  },
  handler: async (ctx, args) => {
    return await ctx.db.patch(args.id, {
      status: args.status,
      lastActive: Date.now(),
    });
  },
});

// Delete agent
export const remove = mutation({
  args: { id: v.id("agents") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
  },
});

// Get agent stats
export const getStats = query({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("agents").collect();
    return {
      total: all.length,
      active: all.filter(a => a.status === "active").length,
      idle: all.filter(a => a.status === "idle").length,
      busy: all.filter(a => a.status === "busy").length,
      offline: all.filter(a => a.status === "offline").length,
    };
  },
});
