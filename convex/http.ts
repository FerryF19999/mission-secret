import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";

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
      
      // Log the incoming webhook
      await ctx.runMutation(api.activityLog.create, {
        runId: body.runId || `webhook-${Date.now()}`,
        action: "webhook_received",
        source: "openclaw",
        metadata: {
          eventType: body.type || "unknown",
          payload: body,
        },
      });

      // Handle different event types
      switch (body.type) {
        case "agent_run_started":
          await ctx.runMutation((api as any).agentRuns.create, {
            runId: body.runId,
            sessionKey: body.sessionKey,
            label: body.label,
            agentId: body.agentId,
            agentName: body.agentName || body.agentId,
            task: body.task,
            status: body.status || "running",
            startedAt: body.startedAt,
          });
          break;

        case "agent_run_status":
          await ctx.runMutation((api as any).agentRuns.setStatusByRunId, {
            runId: body.runId,
            status: body.status,
          });
          break;

        case "agent_run_completed":
          await ctx.runMutation((api as any).agentRuns.completeByRunId, {
            runId: body.runId,
            status: "completed",
            result: body.result,
          });
          break;

        case "agent_run_failed":
          await ctx.runMutation((api as any).agentRuns.completeByRunId, {
            runId: body.runId,
            status: "failed",
            result: body.error || body.result,
          });
          break;

        case "agent_run_log":
          await ctx.runMutation(api.activityLog.create, {
            runId: body.runId,
            action: body.action || "log",
            prompt: body.prompt,
            response: body.message || body.response,
            source: body.source || body.agentId || "openclaw",
            metadata: body.metadata,
          });
          break;

        case "agent_run_file": {
          const bin = Buffer.from(body.dataBase64, "base64");
          const blob = new Blob([bin], { type: body.contentType || "application/octet-stream" });
          const storageId = await ctx.storage.store(blob);

          await ctx.runMutation((api as any).agentRuns.addFileByRunId, {
            runId: body.runId,
            storageId,
            filename: body.filename || `file-${Date.now()}`,
            contentType: body.contentType,
            size: body.size || bin.length,
          });

          await ctx.runMutation(api.activityLog.create, {
            runId: body.runId,
            action: "file",
            response: `Stored file: ${body.filename || "(unnamed)"}`,
            source: body.source || body.agentId || "openclaw",
            metadata: {
              filename: body.filename,
              contentType: body.contentType,
              size: body.size || bin.length,
              storageId,
            },
          });
          break;
        }
        case "task_created":
          await ctx.runMutation(api.tasks.create, {
            title: body.title,
            description: body.description,
            priority: body.priority || "medium",
            assignedTo: body.assignedTo,
            tags: body.tags,
          });
          break;

        case "memory_created":
          await ctx.runMutation(api.memories.create, {
            agentId: body.agentId,
            type: body.memoryType || "fact",
            content: body.content,
            source: body.source,
            tags: body.tags,
            importance: body.importance,
          });
          break;

        case "content_created":
          await ctx.runMutation(api.contentItems.create, {
            title: body.title,
            type: body.contentType || "post",
            platform: body.platform,
            content: body.content,
            tags: body.tags,
          });
          break;

        case "event_created":
          await ctx.runMutation(api.scheduledEvents.create, {
            title: body.title,
            description: body.description,
            startTime: body.startTime,
            endTime: body.endTime,
            type: body.eventType || "event",
            attendees: body.attendees,
            location: body.location,
          });
          break;

        case "agent_status_update":
          if (body.agentId) {
            await ctx.runMutation(api.agents.setStatus, {
              id: body.agentId,
              status: body.status || "idle",
            });
          }
          break;
      }

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("Webhook error:", error);
      return new Response(
        JSON.stringify({ success: false, error: String(error) }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  }),
});

// Health check endpoint
http.route({
  path: "/health",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    return new Response(JSON.stringify({ status: "ok", timestamp: Date.now() }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

export default http;
