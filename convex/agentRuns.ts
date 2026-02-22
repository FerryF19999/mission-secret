import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const Status = v.union(
  v.literal("queued"),
  v.literal("running"),
  v.literal("completed"),
  v.literal("failed")
);

export const create = mutation({
  args: {
    runId: v.string(),
    sessionKey: v.optional(v.string()),
    label: v.optional(v.string()),

    agentId: v.string(),
    agentName: v.string(),

    task: v.string(),
    status: v.optional(Status),
    startedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // De-dupe by runId
    const existing = await ctx.db
      .query("agentRuns")
      .withIndex("by_runId", (q) => q.eq("runId", args.runId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        sessionKey: args.sessionKey ?? existing.sessionKey,
        label: args.label ?? existing.label,
        agentId: args.agentId,
        agentName: args.agentName,
        task: args.task,
        status: args.status ?? existing.status,
        startedAt: args.startedAt ?? existing.startedAt,
      });
      return existing._id;
    }

    return await ctx.db.insert("agentRuns", {
      runId: args.runId,
      sessionKey: args.sessionKey,
      label: args.label,
      agentId: args.agentId,
      agentName: args.agentName,
      task: args.task,
      status: args.status ?? "queued",
      startedAt: args.startedAt ?? now,
      completedAt: undefined,
      result: undefined,
    });
  },
});

export const completeByRunId = mutation({
  args: {
    runId: v.string(),
    status: v.union(v.literal("completed"), v.literal("failed")),
    result: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const doc = await ctx.db
      .query("agentRuns")
      .withIndex("by_runId", (q) => q.eq("runId", args.runId))
      .first();

    if (!doc) throw new Error(`agentRuns.completeByRunId: runId not found: ${args.runId}`);

    await ctx.db.patch(doc._id, {
      status: args.status,
      result: args.result,
      completedAt: Date.now(),
    });

    return doc._id;
  },
});

export const setStatusByRunId = mutation({
  args: {
    runId: v.string(),
    status: Status,
  },
  handler: async (ctx, args) => {
    const doc = await ctx.db
      .query("agentRuns")
      .withIndex("by_runId", (q) => q.eq("runId", args.runId))
      .first();

    if (!doc) throw new Error(`agentRuns.setStatusByRunId: runId not found: ${args.runId}`);

    await ctx.db.patch(doc._id, {
      status: args.status,
      ...(args.status === "completed" || args.status === "failed" ? { completedAt: Date.now() } : {}),
    });

    return doc._id;
  },
});

export const getRecent = query({
  args: {
    limit: v.optional(v.number()),
    status: v.optional(Status),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 50, 200);

    const all = await ctx.db
      .query("agentRuns")
      .withIndex("by_started")
      .order("desc")
      .take(limit);

    if (!args.status) return all;
    return all.filter((r) => r.status === args.status);
  },
});

export const getByRunId = query({
  args: { runId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("agentRuns")
      .withIndex("by_runId", (q) => q.eq("runId", args.runId))
      .first();
  },
});
