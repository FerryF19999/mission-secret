import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const Status = v.union(
  v.literal("queued"),
  v.literal("running"),
  v.literal("completed"),
  v.literal("failed")
);

type ResultFile = {
  storageId: string;
  filename: string;
  contentType?: string;
  size?: number;
  createdAt: number;
};

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
      resultFiles: [],
    });
  },
});

export const addFileByRunId = mutation({
  args: {
    runId: v.string(),
    storageId: v.string(),
    filename: v.string(),
    contentType: v.optional(v.string()),
    size: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const doc = await ctx.db
      .query("agentRuns")
      .withIndex("by_runId", (q) => q.eq("runId", args.runId))
      .first();

    if (!doc) throw new Error(`agentRuns.addFileByRunId: runId not found: ${args.runId}`);

    const next: ResultFile[] = [
      ...((doc.resultFiles as ResultFile[] | undefined) ?? []),
      {
        storageId: args.storageId,
        filename: args.filename,
        contentType: args.contentType,
        size: args.size,
        createdAt: Date.now(),
      },
    ];

    await ctx.db.patch(doc._id, { resultFiles: next as any });
    return doc._id;
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
    agentId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 50, 200);

    const all = await ctx.db
      .query("agentRuns")
      .withIndex("by_started")
      .order("desc")
      .take(limit);

    let list = all;
    if (args.status) list = list.filter((r) => r.status === args.status);
    if (args.agentId) list = list.filter((r) => r.agentId === args.agentId);
    return list;
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

export const getFileUrlsByRunId = query({
  args: { runId: v.string() },
  handler: async (ctx, args) => {
    const doc: any = await ctx.db
      .query("agentRuns")
      .withIndex("by_runId", (q) => q.eq("runId", args.runId))
      .first();

    if (!doc) return [];
    const files: ResultFile[] = (doc.resultFiles ?? []) as ResultFile[];

    const withUrls = await Promise.all(
      files.map(async (f) => ({
        ...f,
        url: await ctx.storage.getUrl(f.storageId as any),
      }))
    );

    return withUrls;
  },
});
