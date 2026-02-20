import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

// Get all content items
export const getAll = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("contentItems")
      .order("desc")
      .take(args.limit ?? 100);
  },
});

// Get content by ID
export const getById = query({
  args: { id: v.id("contentItems") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

// Get content by status
export const getByStatus = query({
  args: { 
    status: v.union(v.literal("idea"), v.literal("draft"), v.literal("review"), v.literal("scheduled"), v.literal("published")) 
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("contentItems")
      .withIndex("by_status", (q) => q.eq("status", args.status))
      .order("desc")
      .take(100);
  },
});

// Get content by type
export const getByType = query({
  args: { 
    type: v.union(v.literal("post"), v.literal("article"), v.literal("video"), v.literal("image"), v.literal("thread")) 
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("contentItems")
      .withIndex("by_type", (q) => q.eq("type", args.type))
      .order("desc")
      .take(100);
  },
});

// Create content item
export const create = mutation({
  args: {
    title: v.string(),
    type: v.union(v.literal("post"), v.literal("article"), v.literal("video"), v.literal("image"), v.literal("thread")),
    status: v.optional(v.union(v.literal("idea"), v.literal("draft"), v.literal("review"), v.literal("scheduled"), v.literal("published"))),
    platform: v.optional(v.string()),
    content: v.optional(v.string()),
    scheduledFor: v.optional(v.number()),
    url: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("contentItems", {
      title: args.title,
      type: args.type,
      status: args.status ?? "idea",
      platform: args.platform,
      content: args.content,
      scheduledFor: args.scheduledFor,
      url: args.url,
      tags: args.tags ?? [],
      createdAt: now,
      updatedAt: now,
    });
  },
});

// Update content item
export const update = mutation({
  args: {
    id: v.id("contentItems"),
    title: v.optional(v.string()),
    status: v.optional(v.union(v.literal("idea"), v.literal("draft"), v.literal("review"), v.literal("scheduled"), v.literal("published"))),
    platform: v.optional(v.string()),
    content: v.optional(v.string()),
    scheduledFor: v.optional(v.number()),
    url: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    const existing = await ctx.db.get(id);
    if (!existing) throw new Error("Content item not found");
    
    const patch: any = {
      ...updates,
      updatedAt: Date.now(),
    };
    
    if (updates.status === "published" && existing.status !== "published") {
      patch.publishedAt = Date.now();
    }
    
    return await ctx.db.patch(id, patch);
  },
});

// Delete content item
export const remove = mutation({
  args: { id: v.id("contentItems") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
  },
});

// Get content stats
export const getStats = query({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("contentItems").collect();
    return {
      total: all.length,
      ideas: all.filter(c => c.status === "idea").length,
      drafts: all.filter(c => c.status === "draft").length,
      review: all.filter(c => c.status === "review").length,
      scheduled: all.filter(c => c.status === "scheduled").length,
      published: all.filter(c => c.status === "published").length,
    };
  },
});
