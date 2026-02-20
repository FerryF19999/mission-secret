import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

// Get all memories
export const getAll = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("memories")
      .order("desc")
      .take(args.limit ?? 50);
  },
});

// Get memory by ID
export const getById = query({
  args: { id: v.id("memories") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

// Get memories by agent
export const getByAgent = query({
  args: { agentId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (!args.agentId) {
      return await ctx.db
        .query("memories")
        .filter((q) => q.eq(q.field("agentId"), undefined))
        .order("desc")
        .take(50);
    }
    return await ctx.db
      .query("memories")
      .withIndex("by_agent", (q) => q.eq("agentId", args.agentId))
      .order("desc")
      .take(50);
  },
});

// Get memories by type
export const getByType = query({
  args: { 
    type: v.union(v.literal("fact"), v.literal("insight"), v.literal("conversation"), v.literal("task")) 
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("memories")
      .withIndex("by_type", (q) => q.eq("type", args.type))
      .order("desc")
      .take(50);
  },
});

// Create a new memory
export const create = mutation({
  args: {
    agentId: v.optional(v.string()),
    type: v.union(v.literal("fact"), v.literal("insight"), v.literal("conversation"), v.literal("task")),
    content: v.string(),
    source: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    importance: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("memories", {
      agentId: args.agentId,
      type: args.type,
      content: args.content,
      source: args.source,
      tags: args.tags ?? [],
      importance: args.importance ?? 5,
      createdAt: Date.now(),
    });
  },
});

// Update memory
export const update = mutation({
  args: {
    id: v.id("memories"),
    content: v.optional(v.string()),
    source: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    importance: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    const existing = await ctx.db.get(id);
    if (!existing) throw new Error("Memory not found");
    
    return await ctx.db.patch(id, updates);
  },
});

// Delete memory
export const remove = mutation({
  args: { id: v.id("memories") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
  },
});

// Search memories (simple text search)
export const search = query({
  args: { query: v.string() },
  handler: async (ctx, args) => {
    const all = await ctx.db.query("memories").collect();
    const lowerQuery = args.query.toLowerCase();
    return all
      .filter(m => 
        m.content.toLowerCase().includes(lowerQuery) ||
        m.tags?.some(tag => tag.toLowerCase().includes(lowerQuery))
      )
      .slice(0, 20);
  },
});

// Get memory stats
export const getStats = query({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("memories").collect();
    return {
      total: all.length,
      facts: all.filter(m => m.type === "fact").length,
      insights: all.filter(m => m.type === "insight").length,
      conversations: all.filter(m => m.type === "conversation").length,
      tasks: all.filter(m => m.type === "task").length,
    };
  },
});
