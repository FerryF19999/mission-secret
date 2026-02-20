import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

// Get all events
export const getAll = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("scheduledEvents")
      .order("desc")
      .take(args.limit ?? 100);
  },
});

// Get upcoming events
export const getUpcoming = query({
  args: {
    hours: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const future = now + (args.hours ?? 24) * 60 * 60 * 1000;
    
    const events = await ctx.db
      .query("scheduledEvents")
      .withIndex("by_start", (q) => q.gte("startTime", now))
      .take(100);
    
    return events.filter(e => e.startTime <= future);
  },
});

// Get events in date range
export const getInRange = query({
  args: {
    start: v.number(),
    end: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("scheduledEvents")
      .filter((q) =>
        q.and(
          q.gte(q.field("startTime"), args.start),
          q.lte(q.field("startTime"), args.end)
        )
      )
      .order("asc")
      .take(100);
  },
});

// Get event by ID
export const getById = query({
  args: { id: v.id("scheduledEvents") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

// Create event
export const create = mutation({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
    startTime: v.number(),
    endTime: v.number(),
    allDay: v.optional(v.boolean()),
    type: v.optional(v.union(v.literal("meeting"), v.literal("deadline"), v.literal("reminder"), v.literal("event"))),
    attendees: v.optional(v.array(v.string())),
    location: v.optional(v.string()),
    color: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("scheduledEvents", {
      title: args.title,
      description: args.description,
      startTime: args.startTime,
      endTime: args.endTime,
      allDay: args.allDay ?? false,
      type: args.type ?? "event",
      attendees: args.attendees ?? [],
      location: args.location,
      color: args.color ?? "#3b82f6",
      createdAt: now,
      updatedAt: now,
    });
  },
});

// Update event
export const update = mutation({
  args: {
    id: v.id("scheduledEvents"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    startTime: v.optional(v.number()),
    endTime: v.optional(v.number()),
    allDay: v.optional(v.boolean()),
    type: v.optional(v.union(v.literal("meeting"), v.literal("deadline"), v.literal("reminder"), v.literal("event"))),
    attendees: v.optional(v.array(v.string())),
    location: v.optional(v.string()),
    color: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    const existing = await ctx.db.get(id);
    if (!existing) throw new Error("Event not found");
    
    return await ctx.db.patch(id, {
      ...updates,
      updatedAt: Date.now(),
    });
  },
});

// Delete event
export const remove = mutation({
  args: { id: v.id("scheduledEvents") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
  },
});

// Get event stats
export const getStats = query({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const dayFromNow = now + 24 * 60 * 60 * 1000;
    const weekFromNow = now + 7 * 24 * 60 * 60 * 1000;
    
    const all = await ctx.db.query("scheduledEvents").collect();
    return {
      total: all.length,
      today: all.filter(e => e.startTime >= now && e.startTime <= dayFromNow).length,
      thisWeek: all.filter(e => e.startTime >= now && e.startTime <= weekFromNow).length,
      meetings: all.filter(e => e.type === "meeting" && e.startTime >= now).length,
      deadlines: all.filter(e => e.type === "deadline" && e.startTime >= now).length,
    };
  },
});
