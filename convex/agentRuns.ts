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

const TriggeredBy = v.optional(v.union(v.literal("cron"), v.literal("human"), v.literal("agent")));

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

    // Audit fields
    triggeredBy: TriggeredBy,
    modelUsed: v.optional(v.string()),
    toolsUsed: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
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
        triggeredBy: args.triggeredBy ?? existing.triggeredBy,
        modelUsed: args.modelUsed ?? existing.modelUsed,
        toolsUsed: args.toolsUsed ?? existing.toolsUsed,
        notes: args.notes ?? existing.notes,
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
      triggeredBy: args.triggeredBy,
      modelUsed: args.modelUsed,
      toolsUsed: args.toolsUsed,
      notes: args.notes,
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
    modelUsed: v.optional(v.string()),
    toolsUsed: v.optional(v.array(v.string())),
    errorLog: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const doc = await ctx.db
      .query("agentRuns")
      .withIndex("by_runId", (q) => q.eq("runId", args.runId))
      .first();

    if (!doc) throw new Error(`agentRuns.completeByRunId: runId not found: ${args.runId}`);

    const now = Date.now();
    const durationMs = doc.startedAt ? now - doc.startedAt : undefined;

    await ctx.db.patch(doc._id, {
      status: args.status,
      result: args.result,
      completedAt: now,
      durationMs,
      ...(args.modelUsed ? { modelUsed: args.modelUsed } : {}),
      ...(args.toolsUsed ? { toolsUsed: args.toolsUsed } : {}),
      ...(args.errorLog ? { errorLog: args.errorLog } : {}),
      ...(args.notes ? { notes: args.notes } : {}),
    });

    return doc._id;
  },
});

// Verify a run (manual approval)
export const verifyByRunId = mutation({
  args: {
    runId: v.string(),
    verifiedBy: v.string(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const doc = await ctx.db
      .query("agentRuns")
      .withIndex("by_runId", (q) => q.eq("runId", args.runId))
      .first();

    if (!doc) throw new Error(`agentRuns.verifyByRunId: runId not found: ${args.runId}`);

    await ctx.db.patch(doc._id, {
      verified: true,
      verifiedBy: args.verifiedBy,
      verifiedAt: Date.now(),
      ...(args.notes ? { notes: args.notes } : {}),
    });

    return doc._id;
  },
});

// Get audit summary stats
export const getAuditStats = query({
  args: {
    hours: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const since = Date.now() - (args.hours ?? 24) * 60 * 60 * 1000;
    const all = await ctx.db
      .query("agentRuns")
      .withIndex("by_started")
      .order("desc")
      .take(500);

    const recent = all.filter((r) => r.startedAt >= since);

    const byAgent: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    const byModel: Record<string, number> = {};
    let totalDuration = 0;
    let durationCount = 0;
    let verifiedCount = 0;

    for (const r of recent) {
      byAgent[r.agentId] = (byAgent[r.agentId] || 0) + 1;
      byStatus[r.status] = (byStatus[r.status] || 0) + 1;
      if ((r as any).modelUsed) byModel[(r as any).modelUsed] = (byModel[(r as any).modelUsed] || 0) + 1;
      if ((r as any).durationMs) { totalDuration += (r as any).durationMs; durationCount++; }
      if ((r as any).verified) verifiedCount++;
    }

    return {
      totalRuns: recent.length,
      byAgent,
      byStatus,
      byModel,
      avgDurationMs: durationCount > 0 ? Math.round(totalDuration / durationCount) : null,
      verifiedCount,
      unverifiedCount: recent.filter((r) => r.status === "completed" && !(r as any).verified).length,
    };
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

export const removeFileByRunId = mutation({
  args: {
    runId: v.string(),
    storageId: v.string(),
  },
  handler: async (ctx, args) => {
    const doc: any = await ctx.db
      .query("agentRuns")
      .withIndex("by_runId", (q) => q.eq("runId", args.runId))
      .first();

    if (!doc) throw new Error(`agentRuns.removeFileByRunId: runId not found: ${args.runId}`);

    const files: any[] = (doc.resultFiles ?? []) as any[];
    const next = files.filter((f) => f.storageId !== args.storageId);

    await ctx.db.patch(doc._id, { resultFiles: next });
    return doc._id;
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
