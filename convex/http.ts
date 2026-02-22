import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";

const http = httpRouter();

// OpenClaw webhook endpoint
http.route({
  path: "/openclaw/event",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const expected = process.env.OPENCLAW_WEBHOOK_TOKEN || "123bearandbear";
      const auth = request.headers.get("authorization") || "";
      if (expected) {
        const ok = auth.toLowerCase().startsWith("bearer ") && auth.slice(7).trim() === expected;
        if (!ok) {
          return new Response(JSON.stringify({ success: false, error: "unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }
      }

      const body = await request.json();
      
      // Webhook received - log for now (db operations via internal mutations)
      return new Response(JSON.stringify({ 
        success: true, 
        received: body.type,
        message: "Webhook received. Use internal mutations for DB operations." 
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (e: any) {
      return new Response(JSON.stringify({ success: false, error: String(e) }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }),
});

export default http;
