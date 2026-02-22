import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";

const http = httpRouter();

// OpenClaw webhook endpoint
http.route({
  path: "/openclaw/event",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    return new Response(JSON.stringify({ success: true, message: "Webhook working!" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

export default http;
