import { v } from "convex/values";
import { query } from "./_generated/server";

// Get a signed download URL for a stored file
export const getUrl = query({
  args: { storageId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.storage.getUrl(args.storageId as any);
  },
});
