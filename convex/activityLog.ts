import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

// Get all activity logs
export const getAll = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("activityLog")
      .order("desc")
      .take(args.limit ?? 100);
  },
});

// Get activity by runId
export const getByRunId = query({
  args: { runId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("activityLog")
      .withIndex("by_runId", (q) => q.eq("runId", args.runId))
      .order("desc")
      .take(100);
  },
});

// Get recent activity (last N hours)
export const getRecent = query({
  args: {
    hours: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const since = Date.now() - (args.hours ?? 24) * 60 * 60 * 1000;
    return await ctx.db
      .query("activityLog")
      .withIndex("by_created", (q) => q.gte("createdAt", since))
      .order("desc")
      .take(100);
  },
});

// Create activity log entry
export const create = mutation({
  args: {
    runId: v.string(),
    action: v.string(),
    prompt: v.optional(v.string()),
    response: v.optional(v.string()),
    source: v.optional(v.string()),
    metadata: v.optional(v.record(v.string(), v.any())),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("activityLog", {
      runId: args.runId,
      action: args.action,
      prompt: args.prompt,
      response: args.response,
      source: args.source,
      metadata: args.metadata,
      createdAt: Date.now(),
    });
  },
});

// Delete old activity logs (cleanup)
export const cleanup = mutation({
  args: {
    olderThanDays: v.number(),
  },
  handler: async (ctx, args) => {
    const cutoff = Date.now() - args.olderThanDays * 24 * 60 * 60 * 1000;
    const old = await ctx.db
      .query("activityLog")
      .withIndex("by_created", (q) => q.lt("createdAt", cutoff))
      .take(1000);
    
    for (const entry of old) {
      await ctx.db.delete(entry._id);
    }
    
    return old.length;
  },
});

// Get activity stats
export const getStats = query({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const hourAgo = now - 60 * 60 * 1000;
    const dayAgo = now - 24 * 60 * 60 * 1000;
    
    const all = await ctx.db.query("activityLog").collect();
    return {
      total: all.length,
      lastHour: all.filter(a => a.createdAt >= hourAgo).length,
      last24Hours: all.filter(a => a.createdAt >= dayAgo).length,
    };
  },
});
