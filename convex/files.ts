import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// Signed download URL for a stored file
export const getUrl = query({
  args: { storageId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.storage.getUrl(args.storageId as any);
  },
});

// Generate a signed upload URL (client uploads file bytes directly to Convex)
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});
